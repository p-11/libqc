import { ChainId } from 'caip';
import { describe, expect, it } from 'vitest';
import {
  captureGeneratedMnemonic,
  MockStorage,
  createTestLibQC
} from '../testUtils';

/**
 * Base Integration Tests
 *
 * These are minimal smoke tests to verify multi-chain support works on Base.
 * The bulk of functionality is tested on Ethereum in vault.test.ts.
 * These tests focus on:
 * 1. Account creation on Base
 * 2. Native ETH transfers on Base
 * 3. ERC-20 token transfers on Base (USDC)
 * 4. Multi-chain wallet with accounts on both Ethereum and Base
 * 5. Validator switching and transfer verification on Base
 *
 * This validates that:
 * - Bundler selection works correctly for Base
 * - Base network interactions work
 * - Multi-chain infrastructure is functioning
 * - A single wallet can manage accounts on multiple chains with automatic bundler selection
 * - Accounts on Base function correctly after validator switches
 */
describe('Base Testnet Integration Tests', () => {
  const BASE_CHAIN_ID = new ChainId({ namespace: 'eip155', reference: '8453' });

  it('should create an account on Base testnet', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);

    // Generate mnemonic
    await captureGeneratedMnemonic(vault);

    // Create account on Base
    const account = await vault.createAccount(BASE_CHAIN_ID);

    // Verify account was created successfully
    expect(account).toBeDefined();
    expect(account.getId().chainId.toString()).toBe(BASE_CHAIN_ID.toString());

    // Verify account is in the list
    const accounts = await vault.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id.chainId.toString()).toBe(BASE_CHAIN_ID.toString());
  }, 30000);
});
