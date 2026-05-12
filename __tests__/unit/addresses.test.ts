import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, test } from 'vitest';
import { deriveBitcoinAddressFromSeed } from '../../src/addresses';
import type { AddressIndex } from '../../src';
import { TEST_SEED } from '../testUtils';

describe('Bitcoin address derivation', () => {
  describe('deriveBitcoinAddressFromSeed', () => {
    test('derives deterministic P2WPKH address from seed', () => {
      const result1 = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        0 as AddressIndex
      );
      const result2 = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        0 as AddressIndex
      );
      expect(result1.address).toBe(result2.address);
      expect(result1.secp256k1PublicKey).toEqual(result2.secp256k1PublicKey);
    });

    test('produces valid Bech32 mainnet address (bc1q...)', () => {
      const result = deriveBitcoinAddressFromSeed(TEST_SEED, 0 as AddressIndex);
      // P2WPKH addresses are 42 chars: bc1q (4) + 38 data chars
      expect(result.address).toMatch(/^bc1q[a-z0-9]+$/);
      expect(result.address).toHaveLength(42);
    });

    test('different indices produce different addresses', () => {
      const result0 = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        0 as AddressIndex
      );
      const result1 = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        1 as AddressIndex
      );
      const result2 = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        2 as AddressIndex
      );

      expect(result0.address).not.toBe(result1.address);
      expect(result1.address).not.toBe(result2.address);
      expect(result0.address).not.toBe(result2.address);
    });

    test('returns correct index in result', () => {
      const result = deriveBitcoinAddressFromSeed(TEST_SEED, 3 as AddressIndex);
      expect(result.index).toBe(3);
    });

    test('returns 33-byte compressed public key', () => {
      const result = deriveBitcoinAddressFromSeed(TEST_SEED, 0 as AddressIndex);
      expect(result.secp256k1PublicKey).toHaveLength(33);
    });

    test('throws on invalid address index', () => {
      expect(() =>
        deriveBitcoinAddressFromSeed(TEST_SEED, -1 as AddressIndex)
      ).toThrow(/Invalid index/);
      expect(() =>
        deriveBitcoinAddressFromSeed(TEST_SEED, 1.5 as AddressIndex)
      ).toThrow(/Invalid index/);
    });

    test('testnet produces tb1... address when network specified', () => {
      const result = deriveBitcoinAddressFromSeed(
        TEST_SEED,
        0 as AddressIndex,
        bitcoin.networks.testnet
      );
      expect(result.address).toMatch(/^tb1q[a-z0-9]+$/);
      expect(result.address).toHaveLength(42);
    });

    test('returns secp256k1PrivateKey and version for persistence', () => {
      const result = deriveBitcoinAddressFromSeed(TEST_SEED, 0 as AddressIndex);
      expect(result.secp256k1PrivateKey).toBeInstanceOf(Uint8Array);
      expect(result.secp256k1PrivateKey).toHaveLength(32);
      expect(result.version).toBeDefined();
    });
  });
});
