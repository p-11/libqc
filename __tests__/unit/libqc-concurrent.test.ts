/**
 * Concurrent access tests for LibQC storage operations
 *
 * These tests verify that the AsyncMutex lock prevents lost updates and
 * state corruption when multiple storage-mutating operations are triggered
 * in parallel — the scenario that arises when a Chrome Extension fires
 * concurrent operations from background and foreground scripts.
 *
 * Each test uses Promise.allSettled (or Promise.all where both ops should
 * succeed) to fire operations concurrently before awaiting any of them.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Main entry point exports
import { type Symbol } from '../../src';

// Internal imports
import { getLibQCState } from '../../src/state';
import {
  captureGeneratedMnemonic,
  MockStorage,
  getTestMnemonic,
  createBareTestLibQC,
  createNoDiscoveryChainSpec,
  createTestLibQC,
  createTestChains,
  getTestPassword,
  mockGenerateAddressFromMnemonic
} from '../testUtils';

describe('LibQC concurrent storage operations', () => {
  beforeEach(() => {
    mockGenerateAddressFromMnemonic();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateMnemonic', () => {
    test('concurrent calls: exactly one succeeds and one throws "already exists"', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);

      // Fire both without awaiting so they queue concurrently
      const results = await Promise.allSettled([
        captureGeneratedMnemonic(vault),
        captureGeneratedMnemonic(vault)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { message: expect.stringContaining('already exists') }
      });

      // State contains exactly one mnemonic
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.entropy).toBeDefined();
      expect(state.seed).toBeDefined();
    });
  });

  describe('addToken', () => {
    test('concurrent addToken for same token: one succeeds, one throws "already tracked"', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const results = await Promise.allSettled([
        vault.addToken('USDC' as Symbol),
        vault.addToken('USDC' as Symbol)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { message: expect.stringContaining('already tracked') }
      });

      // Exactly one USDC in storage
      const assets = await vault.listAssets();
      expect(assets.filter(a => a.symbol === 'USDC')).toHaveLength(1);
    });

    test('concurrent addToken for different tokens: both are tracked (no lost updates)', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Both should succeed — different assets
      await Promise.all([
        vault.addToken('USDC' as Symbol),
        vault.addToken('USDT' as Symbol)
      ]);

      const assets = await vault.listAssets();
      expect(assets.some(a => a.symbol === 'USDC')).toBe(true);
      expect(assets.some(a => a.symbol === 'USDT')).toBe(true);
      // No duplication and no lost update
      expect(assets.filter(a => a.symbol === 'USDC')).toHaveLength(1);
      expect(assets.filter(a => a.symbol === 'USDT')).toHaveLength(1);
    });

    test('three concurrent addToken calls for different tokens: all tracked', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await Promise.all([
        vault.addToken('USDC' as Symbol),
        vault.addToken('USDT' as Symbol),
        vault.addToken('DAI' as Symbol)
      ]);

      const assets = await vault.listAssets();
      const symbols = assets.map(a => a.symbol);
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('DAI');
      // Exactly one of each — no duplicates from concurrent writes
      expect(assets.filter(a => a.symbol === 'USDC')).toHaveLength(1);
      expect(assets.filter(a => a.symbol === 'USDT')).toHaveLength(1);
      expect(assets.filter(a => a.symbol === 'DAI')).toHaveLength(1);
    });
  });

  describe('removeToken', () => {
    test('concurrent removeToken + addToken for same asset: state is consistent', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);
      const usdc = (await vault.listAssets()).find(a => a.symbol === 'USDC')!;

      // One removes, one re-adds concurrently — outcome is deterministic
      // (serialized by lock) but we only assert consistency: at most one USDC
      await Promise.allSettled([
        vault.removeToken(usdc),
        vault.addToken('USDC' as Symbol)
      ]);

      const assets = await vault.listAssets();
      // Must not be duplicated regardless of execution order
      expect(
        assets.filter(a => a.symbol === 'USDC').length
      ).toBeLessThanOrEqual(1);
    });

    test('concurrent removeToken + removeToken for same asset: exactly one succeeds, one throws "not tracked"', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);
      const usdc = (await vault.listAssets()).find(a => a.symbol === 'USDC')!;

      const results = await Promise.allSettled([
        vault.removeToken(usdc),
        vault.removeToken(usdc)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { message: expect.stringContaining('not tracked') }
      });

      // USDC is gone — the successful remove persisted
      const assets = await vault.listAssets();
      expect(assets.filter(a => a.symbol === 'USDC')).toHaveLength(0);
    });
  });

  describe('createAccount + addToken', () => {
    test('concurrent createAccount and addToken: state includes both new account and token', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await captureGeneratedMnemonic(vault);

      const testChains = createTestChains();
      const chainId = testChains[0].chainId; // eip155:1

      await Promise.all([
        vault.createAccount(chainId),
        vault.addToken('USDC' as Symbol)
      ]);

      const accounts = await vault.listAccounts();
      const assets = await vault.listAssets();

      // Account was created
      expect(accounts).toHaveLength(1);
      // Native ETH added by createAccount + USDC added by addToken — no lost update
      expect(assets.some(a => a.symbol === 'ETH')).toBe(true);
      expect(assets.some(a => a.symbol === 'USDC')).toBe(true);
    });
  });

  describe('state integrity under concurrency', () => {
    test('many concurrent addToken calls produce no duplicates', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const symbols: Symbol[] = [
        'USDC' as Symbol,
        'USDT' as Symbol,
        'DAI' as Symbol,
        'wETH' as Symbol,
        'LINK' as Symbol
      ];

      // Fire all concurrently
      await Promise.allSettled(symbols.map(s => vault.addToken(s)));

      const assets = await vault.listAssets();
      // Each symbol appears at most once (no duplicate writes from lost updates)
      for (const sym of symbols) {
        expect(
          assets.filter(a => a.symbol === sym).length,
          `${sym} should appear at most once`
        ).toBeLessThanOrEqual(1);
      }
    });

    test('concurrent generateMnemonic and addToken: vault remains usable', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // generateMnemonic and addToken both do read-modify-write; both should succeed
      await Promise.all([
        captureGeneratedMnemonic(vault),
        vault.addToken('USDC' as Symbol)
      ]);

      // Mnemonic and token both persisted
      const assets = await vault.listAssets();
      expect(assets.some(a => a.symbol === 'USDC')).toBe(true);
    });
  });

  describe('importWallet', () => {
    test('concurrent importWallet calls: exactly one vault written, second throws "already exists"', async () => {
      const storage = new MockStorage(new Map());
      // Use a non-EVM, non-Bitcoin chain so importWallet skips account discovery
      // (which would make real network calls). This test only exercises the
      // vault-creation lock, not the discovery loop.
      const vault = createBareTestLibQC(storage, undefined, [
        createNoDiscoveryChainSpec()
      ]);

      const results = await Promise.allSettled([
        vault.importWallet(getTestMnemonic(), getTestPassword()),
        vault.importWallet(getTestMnemonic(), getTestPassword())
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { message: expect.stringContaining('already exists') }
      });
    });
  });
});
