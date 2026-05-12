import { ChainId } from 'caip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mnemonic, ActivityType } from '../../src/types';
import { BitcoinAccountClient } from '../../src';
import { EvmAccountClient } from '../../src/account';
import { mnemonicToEntropyBytes } from '../../src/cryptography';
import {
  MockStorage,
  createBareTestLibQC,
  createBitcoinTestnetChainSpec,
  createTestChains,
  getTestPassword,
  mockGenerateAddressFromMnemonic
} from '../testUtils';
import * as transfers from '../../src/transfers';
import * as accountModule from '../../src/account';
import * as bitcoinEmptyVaultModule from '../../src/account/bitcoin/emptyVault';
import { countSequenceInHeapStream } from './heap-scanner';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// Mock the transfer logic
vi.mock('../../src/transfers', async () => {
  const actual = await vi.importActual('../../src/transfers');
  return {
    ...actual,
    sendTransfer: vi.fn()
  };
});

// Mock the Bitcoin API logic
vi.mock('../../src/account/bitcoin/esplora', () => ({
  EsploraBitcoinApi: class {
    getBalance = vi.fn().mockResolvedValue({ funded: 100000n, spent: 0n });
    getActivities = vi.fn().mockResolvedValue([]);
    getMempoolTxs = vi.fn().mockResolvedValue([]);
    broadcastTransaction = vi.fn().mockResolvedValue('test-txid');
    getUtxos = vi.fn().mockResolvedValue([
      {
        txid: '0000000000000000000000000000000000000000000000000000000000000000',
        vout: 0,
        value: 100000n
      }
    ]);
    getFeeRateSatsPerVByte = vi.fn().mockResolvedValue(1);
  }
}));

import { BITCOIN_TESTNET_REF } from '../../src/chain';

describe('E2E Transaction Integration Flow', () => {
  const ETH_CHAIN = { namespace: 'eip155', reference: '1' } as const;
  const BTC_CHAIN = {
    namespace: 'bip122',
    reference: BITCOIN_TESTNET_REF
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateAddressFromMnemonic();
    vi.spyOn(EvmAccountClient.prototype, 'isPubKeyExposed').mockResolvedValue(
      false
    );
    vi.spyOn(accountModule, 'getAuthorizedAccount').mockResolvedValue({
      getAddress: vi.fn(),
      getAuthorizedKernelAccount: vi.fn()
    } as any);
    vi.spyOn(bitcoinEmptyVaultModule, 'buildSweepTransaction').mockReturnValue(
      '02000000000100' as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should import wallet, create EVM and BTC accounts, and perform 2 transactions', async () => {
    // This test ensures that the full transaction flow (EVM + Bitcoin) remains functional
    // while implementing memory security measures.
    const storage = new MockStorage(new Map());
    const vault = createBareTestLibQC(storage, undefined, [
      ...createTestChains(),
      createBitcoinTestnetChainSpec()
    ]);

    // Stage 1: Prepare probe patterns for mnemonic, entropy and seed.
    const {
      mnemonicBytes,
      entropyPattern,
      seedPattern,
      countBeforeMnemonic,
      countBeforeEntropy,
      countBeforeSeed,
      mnemonicToImport
    } = await (async () => {
      const rawMnemonic = generateMnemonic(wordlist, 256);
      const m = Mnemonic.from(new TextEncoder().encode(rawMnemonic));
      const mnemonicBytes = Array.from(m);

      const entropy = mnemonicToEntropyBytes(m);
      const entropyPattern = Array.from(entropy.subarray(0, 16));

      const seed = mnemonicToSeedSync(rawMnemonic);
      const seedPattern = Array.from(seed.subarray(0, 16));

      const countBeforeMnemonic =
        await countSequenceInHeapStream(mnemonicBytes);
      const countBeforeEntropy =
        await countSequenceInHeapStream(entropyPattern);
      const countBeforeSeed = await countSequenceInHeapStream(seedPattern);

      entropy.fill(0);
      seed.fill(0);

      return {
        mnemonicBytes,
        entropyPattern,
        seedPattern,
        countBeforeMnemonic,
        countBeforeEntropy,
        countBeforeSeed,
        mnemonicToImport: m
      };
    })();

    // Mnemonic is found because 'rawMnemonic' string is in scope during measurement.
    // Entropy/Seed are 0 because they are handled as raw bytes (Uint8Array),
    // which prevents them from leaking to the V8 heap as strings.
    expect(countBeforeMnemonic).toBeGreaterThan(0);
    expect(countBeforeEntropy).toBe(0);
    expect(countBeforeSeed).toBe(0);

    // Stage 2: Use it in importWallet which uses createAccount
    // Both importWallet and createAccount are hardened to zero out their internal copies.
    await vault.importWallet(mnemonicToImport, getTestPassword());

    // Stage 3: Check if mnemonic/entropy/seed are no longer left behind in memory.
    const countAfterImportMnemonic =
      await countSequenceInHeapStream(mnemonicBytes);
    const countAfterImportEntropy =
      await countSequenceInHeapStream(entropyPattern);
    const countAfterImportSeed = await countSequenceInHeapStream(seedPattern);
    // After import, 'rawMnemonic' string is out of scope (GC'd) and all internal
    // copies are zeroed, so all counts must be 0.
    expect(countAfterImportMnemonic).toBe(0);
    expect(countAfterImportEntropy).toBe(0);
    expect(countAfterImportSeed).toBe(0);

    // Perform EVM and BTC account operations to ensure functionality remains intact
    const evmAccount = await vault.createAccount(new ChainId(ETH_CHAIN));
    expect(evmAccount).toBeDefined();

    const btcAccount = await vault.createAccount(new ChainId(BTC_CHAIN));
    expect(btcAccount).toBeDefined();

    // Perform EVM Transaction
    const authorizedEvmAccount = await accountModule.getAuthorizedAccount(
      (evmAccount as any).publicClient,
      evmAccount.getId(),
      await (evmAccount as any).getPersistedAddressFromAccount(),
      {} as any,
      storage
    );

    vi.mocked(transfers.sendTransfer).mockResolvedValue({
      activity: {
        type: ActivityType.NativeTransaction,
        blockNumber: 12345n,
        data: {
          from: (evmAccount.getId() as any).address,
          to: '0x9876543210987654321098765432109876543210',
          value: 1000n
        }
      },
      txHash: '0xtxHash' as `0x${string}`,
      userOpHash: '0xuserOpHash' as `0x${string}`
    } as any);

    const evmResult = await transfers.sendTransfer({
      authorizedAccount: authorizedEvmAccount,
      amount: 1000n as any,
      to: '0x9876543210987654321098765432109876543210' as any,
      publicClient: (evmAccount as any).publicClient,
      bundlerConfig: (evmAccount as any).bundlerConfig
    });

    expect(evmResult.activity.type).toBe(ActivityType.NativeTransaction);
    expect(transfers.sendTransfer).toHaveBeenCalledTimes(1);

    // Perform Bitcoin Transaction (Sweep)
    const btcResult = await (btcAccount as BitcoinAccountClient).emptyVault(
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
    );

    const btcTxId = btcResult.txIdentifiers[0];
    expect(btcTxId?.chain).toBe('bitcoin');
    if (btcTxId?.chain === 'bitcoin') {
      expect(btcTxId.data.txid).toBe('test-txid');
    }
    expect(btcResult.transferredAssetCount).toBe(1);

    expect(evmResult).toBeDefined();
    expect(btcResult).toBeDefined();

    const accounts = await vault.listAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(2);

    // Final security check: still no mnemonic/entropy/seed in heap after all transactions
    const finalMnemonicCount = await countSequenceInHeapStream(mnemonicBytes);
    const finalEntropyCount = await countSequenceInHeapStream(entropyPattern);
    const finalSeedCount = await countSequenceInHeapStream(seedPattern);
    // Final security check: ensure no subsequent operations (EVM/BTC txs)
    // leaked sensitive data back to the heap.
    expect(finalMnemonicCount).toBe(0);
    expect(finalEntropyCount).toBe(0);
    expect(finalSeedCount).toBe(0);
  }, 60000);
});
