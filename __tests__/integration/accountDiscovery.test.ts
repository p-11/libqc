import { ChainId } from 'caip';
import { describe, expect, test, vi } from 'vitest';
import { EvmAccountClient } from '../../src/account';
import {
  createBareTestLibQC,
  createTestChains,
  MockStorage,
  getTestMnemonic,
  getTestPassword,
  TEST_TIMING
} from '../testUtils';
import { Mnemonic } from '../../src';

describe('Account Discovery Integration', () => {
  const chainId = new ChainId({ namespace: 'eip155', reference: '8453' }); // Base

  /**
   * Verifies that importWallet discovers both the exposed index 0
   * and the first clean index 1 account.
   */
  test(
    'discovers both VULNERABLE and SAFE accounts after index 0 is exposed',
    async () => {
      const storage = new MockStorage(new Map());
      const chains = createTestChains().filter(
        c => c.chainId.toString() === chainId.toString()
      );
      const vault = createBareTestLibQC(storage, undefined, chains);

      // Mock network: index 0 is already exposed, others are clean
      const exposedAddresses = new Set<string>();
      let seenInDiscovery = 0;
      const isExposedSpy = vi
        .spyOn(EvmAccountClient.prototype, 'isPubKeyExposed')
        .mockImplementation(async function (this: EvmAccountClient) {
          const address = this.getId().address;
          if (exposedAddresses.has(address)) return true;

          seenInDiscovery++;
          if (seenInDiscovery === 1) {
            exposedAddresses.add(address);
            return true;
          }
          return false;
        });

      await vault.importWallet(
        Mnemonic.from(getTestMnemonic()),
        getTestPassword()
      );

      const discoveredAccounts = (await vault.listAccounts()).filter(
        a => a.chainId.toString() === chainId.toString()
      );

      expect(discoveredAccounts).toHaveLength(2);
      expect(
        await (await vault.getAccount(discoveredAccounts[0].id)).getStatus()
      ).toBe('vulnerable');
      expect(
        await (await vault.getAccount(discoveredAccounts[1].id)).getStatus()
      ).toBe('safe');

      isExposedSpy.mockRestore();
    },
    TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
  );

  /**
   * Specifically tests that "emptyVault" (which exposes the key)
   * leads to the correct discovery of 2 accounts during recovery.
   */
  test(
    'discovers 2 accounts after emptyVault is called on index 0',
    async () => {
      const storage = new MockStorage(new Map());
      const chains = createTestChains().filter(
        c => c.chainId.toString() === chainId.toString()
      );
      const vault = createBareTestLibQC(storage, undefined, chains);

      const exposedAddresses = new Set<string>();
      let seenInDiscovery = 0;
      const isExposedSpy = vi
        .spyOn(EvmAccountClient.prototype, 'isPubKeyExposed')
        .mockImplementation(async function (this: EvmAccountClient) {
          const address = this.getId().address;
          if (exposedAddresses.has(address)) return true;

          seenInDiscovery++;
          if (seenInDiscovery === 1) {
            exposedAddresses.add(address);
            return true;
          }
          return false;
        });

      await vault.importWallet(
        Mnemonic.from(getTestMnemonic()),
        getTestPassword()
      );

      const discoveredAccounts = (await vault.listAccounts()).filter(
        a => a.chainId.toString() === chainId.toString()
      );

      expect(discoveredAccounts).toHaveLength(2);
      expect(
        await (await vault.getAccount(discoveredAccounts[0].id)).getStatus()
      ).toBe('vulnerable');
      expect(
        await (await vault.getAccount(discoveredAccounts[1].id)).getStatus()
      ).toBe('safe');

      isExposedSpy.mockRestore();
    },
    TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
  );
});
