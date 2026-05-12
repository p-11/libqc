import { ChainId } from 'caip';
import { parseEther } from 'viem';
import { describe, expect, test } from 'vitest';

// Internal imports (not exported from main entry point)
import { EvmAccountClient, getAuthorizedAccount } from '../../src/account';
import { EvmPersistedAddress, getLibQCState } from '../../src/state';
import { sendTransfer } from '../../src/transfers';
import {
  captureGeneratedMnemonic,
  createBundlerConfigProvider,
  createTestChains,
  createTestClients,
  createTestLibQC,
  fundAccount,
  MockStorage,
  TEST_TIMING
} from '../testUtils';
import { TransactionValue } from '../../src';

/**
 * Integration test for AccountClient.isPubKeyExposed()
 *
 * Verifies that:
 * 1. A newly created (undeployed) account returns isPubKeyExposed === false
 * 2. After sending a transfer (which deploys the smart account), isPubKeyExposed === true
 *
 * The transfer is sent using the sendTransfer function (which goes through the ERC-4337
 * bundler) since smart accounts cannot use raw viem sendTransaction.
 */
describe('AccountClient.isPubKeyExposed', () => {
  test(
    'returns false for undeployed account and true after first transfer',
    async () => {
      const storage = new MockStorage(new Map());
      const chains = createTestChains();
      const { vault, encryptionKey } = await createTestLibQC(storage, chains);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      // Create account
      const account = (await vault.createAccount(chainId)) as EvmAccountClient;

      // Fund account with ETH for gas
      await fundAccount(account.getId(), 0.01);

      // Before any transaction: account is not deployed, public key not exposed
      const isExposedBefore = await account.isPubKeyExposed();
      expect(isExposedBefore).toBe(false);

      // Send a transfer to deploy the account (using sendTransfer via bundler)
      const state = await getLibQCState(storage, encryptionKey);
      const persistedAddress = state.addresses.find(
        addr => addr.address === account.getId().address
      );
      if (!persistedAddress) {
        throw new Error('Persisted address not found for account');
      }

      const config = await account.getConfig();
      const chainClients = createTestClients();
      const publicClient = chainClients.getByChainId(chainId);
      const bundlerConfigProvider = createBundlerConfigProvider(chains);
      const bundlerConfig = bundlerConfigProvider(chainId);

      const authorizedAccount = await getAuthorizedAccount(
        publicClient,
        account.getId(),
        persistedAddress as EvmPersistedAddress,
        config.validatorConfig,
        storage
      );

      // Send native ETH transfer to a burn address (deploys the account)
      const burnAddress =
        '0x0000000000000000000000000000000000000001' as `0x${string}`;
      await sendTransfer({
        authorizedAccount,
        amount: parseEther('0.0001') as TransactionValue,
        to: burnAddress,
        publicClient,
        bundlerConfig
      });

      // After transfer: account is deployed, public key is exposed
      const isExposedAfter = await account.isPubKeyExposed();
      expect(isExposedAfter).toBe(true);
    },
    TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
  );
});
