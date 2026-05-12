/* eslint-disable no-console */
import { describe, expect, test } from 'vitest';
import { ChainId } from 'caip';
import {
  MockStorage,
  getTestPassword,
  fundAccount,
  createTestChains,
  createBundlerConfigProvider
} from '../testUtils';
import { LibQC } from '../../src';
import { Mnemonic } from '../../src/types';
import type { EvmAccountClient } from '../../src/account';
import type { EvmAddress, TransactionValue } from '../../src/types';

describe('Recovery and Simulation Integration Test', () => {
  // Provided mnemonic phrase (converted to Uint8Array)
  const MNEMONIC = Mnemonic.from(
    new TextEncoder().encode(
      'together math party audit sound tornado toilet maximum unveil gallery actual local timber tide blossom kiwi steak play volume lunar smoke name tonight foot'
    )
  );

  test('recovers vault from mnemonic and simulates a transaction on Ethereum', async () => {
    console.log('[Test] Starting recovery test...');
    const storage = new MockStorage(new Map());

    // Create LibQC instance with potential bundler override
    // Filter to Ethereum only to avoid Bitcoin discovery timeouts
    const testChains = createTestChains().filter(
      c => c.chainId.toString() === 'eip155:1'
    );
    const bundlerRpcUrl =
      process.env.VITE_ETHEREUM_BUNDLER_RPC_URL ||
      process.env.TEST_ETH_BUNDLER_RPC_URL;

    const bundlerConfigProvider = (chainId: ChainId) => {
      const chain = testChains.find(
        c => c.chainId.toString() === chainId.toString()
      );
      if (!chain) throw new Error(`Chain ${chainId.toString()} not found`);

      if (chainId.toString() === 'eip155:1' && bundlerRpcUrl) {
        return {
          chain: { id: 1 } as any,
          urls: [bundlerRpcUrl as any],
          headers: { 'X-API-Key': process.env.TEST_ETH_BUNDLER_API_KEY || '' }
        };
      }
      // Fallback to default test provider
      const defaultChains = createTestChains();
      const defaultProvider = createBundlerConfigProvider(defaultChains);
      return defaultProvider(chainId);
    };

    const vault = new LibQC(storage, testChains, bundlerConfigProvider);

    // 1. Recover wallet (Import mnemonic)
    console.log('[Test] Importing wallet...');
    await vault.importWallet(MNEMONIC, getTestPassword());

    expect(vault.isUnlocked()).toBe(true);
    console.log('[Test] Wallet recovered and unlocked.');

    // 2. Verify accounts were discovered
    const accounts = await vault.listAccounts();
    console.log(`[Test] Discovered ${accounts.length} accounts.`);

    const ethChainId = new ChainId({ namespace: 'eip155', reference: '1' });
    const ethAccount = accounts.find(
      a => a.chainId.toString() === ethChainId.toString()
    );

    expect(ethAccount).toBeDefined();
    console.log('[Test] Ethereum account found:', ethAccount!.address);

    // 3. Get Account Client
    const accountClient = (await vault.getAccount(
      ethAccount!.id
    )) as EvmAccountClient;

    // 4. Fund account on Tenderly
    console.log('[Test] Funding account on Tenderly...');
    await fundAccount(ethAccount!.id, 1);

    // 5. Actually perform a transfer to trigger full signing and submission
    const dummyAddress =
      '0x1234567890123456789012345678901234567890' as EvmAddress;

    console.log('[Test] Performing transfer for account:', ethAccount!.address);

    try {
      // First, get estimate (triggers [libqc][zeroDev] Estimation logs)
      await accountClient.getTransferGasCostEstimate(
        1n as TransactionValue,
        dummyAddress
      );
      console.log('[Test] Estimate success.');

      // Then, send transfer (triggers [libqc][signer] and [libqc][zeroDev] Submission logs)
      // Using any cast to access private sendTransfer for testing
      const activity = await (accountClient as any).sendTransfer(
        1n as TransactionValue,
        dummyAddress
      );

      console.log('[Test] Transfer successful! Activity:', activity.type);
    } catch (error) {
      console.error('[Test] Operation failed!', error);
      throw error;
    }
  }, 100000);
});
