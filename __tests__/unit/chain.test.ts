import { ChainId } from 'caip';
import { describe, expect, test } from 'vitest';
import {
  BITCOIN_MAINNET_REF,
  BITCOIN_TESTNET_REF,
  isBitcoinAddressForChain,
  isBitcoinChain,
  isEvmChain
} from '../../src/chain';
import type { BitcoinAddress } from '../../src/types';

/**
 * Chain helpers for Bitcoin vs EVM. Bitcoin uses bip122 namespace and bc1/tb1
 * addresses; EVM uses eip155. These determine which account client and APIs to use.
 */
describe('chain', () => {
  describe('isBitcoinChain', () => {
    test('returns true for Bitcoin mainnet (bip122 namespace)', () => {
      const chainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_MAINNET_REF
      });
      expect(isBitcoinChain(chainId)).toBe(true);
    });

    test('returns true for Bitcoin testnet', () => {
      const chainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_TESTNET_REF
      });
      expect(isBitcoinChain(chainId)).toBe(true);
    });

    test('returns false for EVM chains (eip155 namespace)', () => {
      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isBitcoinChain(chainId)).toBe(false);
    });
  });

  describe('isBitcoinAddressForChain', () => {
    test('bc1q mainnet address matches Bitcoin mainnet chain', () => {
      const mainnetAddr =
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as BitcoinAddress;
      const mainnetChainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_MAINNET_REF
      });
      expect(isBitcoinAddressForChain(mainnetAddr, mainnetChainId)).toBe(true);
    });

    test('tb1q testnet address matches Bitcoin testnet chain', () => {
      const testnetAddr =
        'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as BitcoinAddress;
      const testnetChainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_TESTNET_REF
      });
      expect(isBitcoinAddressForChain(testnetAddr, testnetChainId)).toBe(true);
    });

    test('bc1q mainnet address does not match Bitcoin testnet (wrong HRP)', () => {
      const mainnetAddr =
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as BitcoinAddress;
      const testnetChainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_TESTNET_REF
      });
      expect(isBitcoinAddressForChain(mainnetAddr, testnetChainId)).toBe(false);
    });

    test('tb1q testnet address does not match Bitcoin mainnet (wrong HRP)', () => {
      const testnetAddr =
        'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as BitcoinAddress;
      const mainnetChainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_MAINNET_REF
      });
      expect(isBitcoinAddressForChain(testnetAddr, mainnetChainId)).toBe(false);
    });

    test('returns false for non-bip122 chain (EVM chain passed by mistake)', () => {
      const mainnetAddr =
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as BitcoinAddress;
      const evmChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isBitcoinAddressForChain(mainnetAddr, evmChainId)).toBe(false);
    });
  });

  describe('isEvmChain', () => {
    test('returns true for Ethereum mainnet', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      expect(isEvmChain(chainId)).toBe(true);
    });

    test('returns false for Bitcoin chains', () => {
      const chainId = new ChainId({
        namespace: 'bip122',
        reference: BITCOIN_MAINNET_REF
      });
      expect(isEvmChain(chainId)).toBe(false);
    });
  });
});
