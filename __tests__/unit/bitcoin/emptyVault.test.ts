import { AccountId, ChainId } from 'caip';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp from '@noble/secp256k1';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainSpecification,
  type LibQCStorage,
  type Symbol
} from '../../../src';
import { BitcoinAccountClient } from '../../../src/account/bitcoin';
import type { BitcoinChainApi } from '../../../src/account/bitcoin/api';
import type { VaultEncryptionKeyWithMetadata } from '../../../src/cryptography';
import {
  InvalidDestinationAddressError,
  NoWithdrawableAssetsError
} from '../../../src/errors';
import { getAssetBySymbol } from '../../../src/assets';
import type { PersistedAccount } from '../../../src/state';
import * as stateModule from '../../../src/state';
import * as withdrawalsModule from '../../../src/withdrawals';
import {
  buildSweepTransaction,
  validateBitcoinDestinationAddress
} from '../../../src/account/bitcoin/emptyVault';

const MOCK_ENCRYPTION_KEY = {} as VaultEncryptionKeyWithMetadata;
const btcChainId = new ChainId({
  namespace: 'bip122',
  reference: '000000000019d6689c085ae165831e93'
});
const destinationAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const sweepPrivateKeyBytes = new Uint8Array(32).fill(1);
const sweepAddress = bitcoin.payments.p2wpkh({
  pubkey: secp.getPublicKey(sweepPrivateKeyBytes, true),
  network: bitcoin.networks.bitcoin
}).address!;
const sweepAccount = {
  id: new AccountId({ chainId: btcChainId, address: sweepAddress }),
  address: sweepAddress as any,
  chainId: btcChainId
} as PersistedAccount;
const btcAsset = getAssetBySymbol('BTC' as Symbol)!;

const chainSpec = {
  nativeCurrency: {
    symbol: 'BTC' as Symbol,
    decimals: 8,
    name: 'Bitcoin'
  }
} as ChainSpecification;

function createPersistedBitcoinState(): stateModule.LibQCState {
  return {
    addresses: [
      {
        chainType: 'bitcoin' as const,
        address: sweepAddress as any,
        index: 0 as any,
        secp256k1PrivateKey: new Uint8Array(sweepPrivateKeyBytes) as any,
        accounts: [
          {
            id: sweepAccount.id,
            address: sweepAddress as any,
            chainId: btcChainId
          }
        ],
        version: 'V1' as any
      }
    ],
    assets: [btcAsset]
  };
}

let mockStorage: LibQCStorage;

beforeEach(() => {
  vi.restoreAllMocks();

  mockStorage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(true)
  };

  // emptyVault persists a WithdrawalRecord (ENG-1791); bypass real encryption
  // since these tests use a placeholder encryption key.
  vi.spyOn(withdrawalsModule, 'recordWithdrawal').mockResolvedValue(
    {} as never
  );
});

function createClient(api: BitcoinChainApi): BitcoinAccountClient {
  return new BitcoinAccountClient(
    sweepAccount,
    mockStorage,
    MOCK_ENCRYPTION_KEY,
    api,
    chainSpec
  );
}

function createMockApi(
  overrides: Partial<BitcoinChainApi> = {}
): BitcoinChainApi {
  return {
    getBalance: vi.fn().mockResolvedValue({
      funded: 120000n,
      spent: 0n
    }),
    getActivities: vi.fn().mockResolvedValue([]),
    getMempoolTxs: vi.fn().mockResolvedValue([]),
    getUtxos: vi.fn().mockResolvedValue([
      { txid: '11'.repeat(32), vout: 0, value: 50000n },
      { txid: '22'.repeat(32), vout: 1, value: 70000n }
    ]),
    getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(2),
    broadcastTransaction: vi.fn().mockResolvedValue(''),
    getTxStatus: vi.fn().mockResolvedValue({ confirmed: false }),
    ...overrides
  };
}

// P2TR destination address derived from a known private key.
// Generated here (not at module level) to ensure initEccLib() has run via the
// BitcoinAccountClient import above.
function getP2trDestinationAddress(): string {
  const privKey = Buffer.from('2'.repeat(64), 'hex');
  const pubKey = secp.getPublicKey(privKey, true);
  const xOnlyPubKey = pubKey.slice(1); // 32-byte x-only
  return bitcoin.payments.p2tr({
    internalPubkey: xOnlyPubKey,
    network: bitcoin.networks.bitcoin
  }).address!;
}

describe('BitcoinAccountClient.emptyVault', () => {
  it('sweeps all BTC to a P2TR (Taproot) destination address', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const p2trAddress = getP2trDestinationAddress();
    const broadcastTransaction = vi.fn().mockResolvedValue('sweep-txid-p2tr');
    const mockApi = createMockApi({ broadcastTransaction });
    const client = createClient(mockApi);

    const result = await client.emptyVault(p2trAddress);

    expect(result.destinationAddress).toBe(p2trAddress);
    expect(broadcastTransaction).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]+$/)
    );
    const txId = result.txIdentifiers[0];
    expect(txId?.chain).toBe('bitcoin');
    if (txId?.chain === 'bitcoin') {
      expect(txId.data.txid).toBe('sweep-txid-p2tr');
    }
  });

  it('sweeps all BTC to the destination address in a single transaction', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );
    const recordSpy = vi
      .spyOn(withdrawalsModule, 'recordWithdrawal')
      .mockResolvedValue({} as never);

    const broadcastTransaction = vi.fn().mockResolvedValue('sweep-txid');
    const mockApi = createMockApi({
      broadcastTransaction
    });

    const client = createClient(mockApi);

    const result = await client.emptyVault(destinationAddress);

    // ENG-1791: a 'pending' lifecycle record is persisted before returning.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const recordInput = recordSpy.mock.calls[0][2];
    expect(recordInput).toMatchObject({
      accountId: sweepAccount.id,
      initialStatus: 'pending',
      destinationAddress,
      destinationChain: btcChainId.toString()
    });
    expect(recordInput.txRefs).toEqual(result.txIdentifiers);

    expect(mockApi.getUtxos).toHaveBeenCalledWith(sweepAddress);
    expect(mockApi.getFeeRateSatsPerVByte).toHaveBeenCalled();
    expect(broadcastTransaction).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]+$/)
    );
    expect(result).toEqual({
      accountId: sweepAccount.id.toString(),
      destinationAddress,
      destinationChain: sweepAccount.id.chainId.toString(),
      transferredAssetCount: 1,
      transferredNativeAsset: true,
      status: 'pending',
      txIdentifiers: [
        {
          chain: 'bitcoin',
          data: {
            txid: 'sweep-txid',
            explorerUrl: 'https://mempool.space/tx/sweep-txid'
          }
        }
      ]
    });
  });

  it('still returns success when lifecycle persistence fails after broadcast', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );
    vi.spyOn(withdrawalsModule, 'recordWithdrawal').mockRejectedValue(
      new Error('storage unavailable')
    );

    const broadcastTransaction = vi.fn().mockResolvedValue('sweep-txid');
    const mockApi = createMockApi({ broadcastTransaction });
    const client = createClient(mockApi);

    const result = await client.emptyVault(destinationAddress);

    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('pending');
    expect(result.txIdentifiers).toHaveLength(1);
  });

  it('throws InvalidDestinationAddressError for an invalid Bitcoin destination', async () => {
    const client = createClient(
      createMockApi({
        getBalance: vi.fn().mockResolvedValue({
          funded: 100000n,
          spent: 0n
        })
      })
    );

    await expect(client.emptyVault('not-an-address')).rejects.toThrow(
      InvalidDestinationAddressError
    );
  });

  it('throws NoWithdrawableAssetsError when fees consume the remaining balance', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const broadcastTransaction = vi.fn();
    const mockApi = createMockApi({
      getBalance: vi.fn().mockResolvedValue({
        funded: 100n,
        spent: 0n
      }),
      getUtxos: vi
        .fn()
        .mockResolvedValue([{ txid: '33'.repeat(32), vout: 0, value: 100n }]),
      broadcastTransaction
    });
    const client = createClient(mockApi);

    await expect(client.emptyVault(destinationAddress)).rejects.toThrow(
      NoWithdrawableAssetsError
    );
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it('throws NoWithdrawableAssetsError when all UTXOs have zero value', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const broadcastTransaction = vi.fn();
    const mockApi = createMockApi({
      getUtxos: vi.fn().mockResolvedValue([
        { txid: '55'.repeat(32), vout: 0, value: 0n },
        { txid: '66'.repeat(32), vout: 1, value: 0n }
      ]),
      broadcastTransaction
    });
    const client = createClient(mockApi);

    await expect(client.emptyVault(destinationAddress)).rejects.toThrow(
      NoWithdrawableAssetsError
    );
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it('throws NoWithdrawableAssetsError when the output amount is below the dust limit', async () => {
    // 1 P2WPKH input, 1 P2PKH output (25-byte script), fee rate 1 sat/vB:
    // fee = (11 + 68 + 9 + 25) × 1 = 113 sats; amountToSend = 650 - 113 = 537 < 546 (P2PKH dust limit)
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const broadcastTransaction = vi.fn();
    const mockApi = createMockApi({
      getBalance: vi.fn().mockResolvedValue({ funded: 650n, spent: 0n }),
      getUtxos: vi
        .fn()
        .mockResolvedValue([{ txid: '77'.repeat(32), vout: 0, value: 650n }]),
      getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
      broadcastTransaction
    });
    const client = createClient(mockApi);

    await expect(client.emptyVault(destinationAddress)).rejects.toThrow(
      NoWithdrawableAssetsError
    );
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });
});

describe('BitcoinAccountClient.estimateEmptyVaultFee', () => {
  it('estimates fee for a P2TR destination address', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const p2trAddress = getP2trDestinationAddress();
    const mockApi = createMockApi();
    const client = createClient(mockApi);

    // 2 P2WPKH inputs (68 vbytes each), 1 P2TR output (34-byte script → 9 + 34 = 43 vbytes),
    // overhead 11 vbytes → (11 + 68*2 + 43) × 2 sat/vB = 190 × 2 = 380 sats
    const fee = await client.estimateEmptyVaultFee(p2trAddress);
    expect(fee).toBe(380n);
    expect(mockApi.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('returns the estimated fee in satoshis without broadcasting', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const mockApi = createMockApi();
    const client = createClient(mockApi);

    const fee = await client.estimateEmptyVaultFee(destinationAddress);

    // 2 P2WPKH inputs (68 vbytes each), 1 P2PKH output (25-byte script),
    // overhead 11 vbytes, output overhead 9 vbytes -> 181 vbytes × 2 sat/vB = 362 sats
    expect(fee).toBe(362n);
    expect(mockApi.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('throws InvalidDestinationAddressError for an invalid destination', async () => {
    const client = createClient(createMockApi());

    await expect(
      client.estimateEmptyVaultFee('not-an-address')
    ).rejects.toThrow(InvalidDestinationAddressError);
  });

  it('throws NoWithdrawableAssetsError when the account balance is zero', async () => {
    const client = createClient(
      createMockApi({
        getBalance: vi.fn().mockResolvedValue({ funded: 0n, spent: 0n })
      })
    );

    await expect(
      client.estimateEmptyVaultFee(destinationAddress)
    ).rejects.toThrow(NoWithdrawableAssetsError);
  });

  it('throws NoWithdrawableAssetsError when fees exceed the UTXO value', async () => {
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const client = createClient(
      createMockApi({
        getBalance: vi.fn().mockResolvedValue({ funded: 100n, spent: 0n }),
        getUtxos: vi
          .fn()
          .mockResolvedValue([{ txid: '44'.repeat(32), vout: 0, value: 100n }])
      })
    );

    await expect(
      client.estimateEmptyVaultFee(destinationAddress)
    ).rejects.toThrow(NoWithdrawableAssetsError);
  });

  it('throws NoWithdrawableAssetsError when the output amount is below the dust limit', async () => {
    // 1 P2WPKH input, 1 P2PKH output (25-byte script), fee rate 1 sat/vB:
    // fee = (11 + 68 + 9 + 25) × 1 = 113 sats; amountToSend = 650 - 113 = 537 < 546 (P2PKH dust limit)
    vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue(
      createPersistedBitcoinState()
    );

    const client = createClient(
      createMockApi({
        getBalance: vi.fn().mockResolvedValue({ funded: 650n, spent: 0n }),
        getUtxos: vi
          .fn()
          .mockResolvedValue([{ txid: '88'.repeat(32), vout: 0, value: 650n }]),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1)
      })
    );

    await expect(
      client.estimateEmptyVaultFee(destinationAddress)
    ).rejects.toThrow(NoWithdrawableAssetsError);
  });
});

describe('BitcoinAccountClient.reconcileWithdrawalRecord', () => {
  function buildPendingRecord(): {
    id: string;
    accountId: string;
    destinationAddress: any;
    destinationChain: string;
    status: 'pending';
    txRefs: { chain: 'bitcoin'; data: { txid: any; explorerUrl: null } }[];
    initiatedAt: number;
    sentAt: null;
    completedAt: null;
    failedAt: null;
  } {
    return {
      id: 'rec-1',
      accountId: sweepAccount.id.toString(),
      destinationAddress,
      destinationChain: btcChainId.toString(),
      status: 'pending',
      txRefs: [
        {
          chain: 'bitcoin',
          data: { txid: 'sweep-txid' as any, explorerUrl: null }
        }
      ],
      initiatedAt: 1,
      sentAt: null,
      completedAt: null,
      failedAt: null
    };
  }

  it('keeps record at pending when tx is not yet confirmed', async () => {
    const mockApi = createMockApi({
      getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
    });
    const client = createClient(mockApi);
    const record = buildPendingRecord();

    const next = await client.reconcileWithdrawalRecord(record);

    expect(next.status).toBe('pending');
    expect(mockApi.getTxStatus).toHaveBeenCalledWith('sweep-txid');
  });

  it('advances pending → withdrawn when confirmed and source balance zero', async () => {
    const mockApi = createMockApi({
      getTxStatus: vi.fn().mockResolvedValue({ confirmed: true }),
      getBalance: vi.fn().mockResolvedValue({ funded: 100n, spent: 100n })
    });
    const client = createClient(mockApi);
    const record = buildPendingRecord();

    const next = await client.reconcileWithdrawalRecord(record);

    expect(next.status).toBe('withdrawn');
    expect(next.sentAt).toBeTypeOf('number');
    expect(next.completedAt).toBeTypeOf('number');
  });

  it('advances pending → sent when confirmed but residual balance remains', async () => {
    const mockApi = createMockApi({
      getTxStatus: vi.fn().mockResolvedValue({ confirmed: true }),
      getBalance: vi.fn().mockResolvedValue({ funded: 200n, spent: 100n })
    });
    const client = createClient(mockApi);
    const record = buildPendingRecord();

    const next = await client.reconcileWithdrawalRecord(record);

    expect(next.status).toBe('sent');
    expect(next.completedAt).toBeNull();
  });

  it('does not query balance when no tx is confirmed', async () => {
    const getBalance = vi.fn();
    const mockApi = createMockApi({
      getTxStatus: vi.fn().mockResolvedValue({ confirmed: false }),
      getBalance
    });
    const client = createClient(mockApi);
    await client.reconcileWithdrawalRecord(buildPendingRecord());

    expect(getBalance).not.toHaveBeenCalled();
  });

  it('treats a non-positive funded-spent net as zero balance', async () => {
    // Mirrors the defensive guard in BitcoinAccountClient.getBalance: any
    // funded <= spent counts as no withdrawable balance, not strict equality.
    const mockApi = createMockApi({
      getTxStatus: vi.fn().mockResolvedValue({ confirmed: true }),
      getBalance: vi.fn().mockResolvedValue({ funded: 100n, spent: 200n })
    });
    const client = createClient(mockApi);

    const next = await client.reconcileWithdrawalRecord(buildPendingRecord());

    expect(next.status).toBe('withdrawn');
  });
});

describe('buildSweepTransaction', () => {
  it('produces witness signatures that verify against the BIP143 sighash', () => {
    const network = bitcoin.networks.bitcoin;
    const privateKey = new Uint8Array(32).fill(0xab) as any;
    const publicKey = secp.getPublicKey(privateKey, true);
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: publicKey, network });
    const fromAddress = p2wpkh.address! as any;
    const witnessScript = p2wpkh.output!;

    const utxos = [
      { txid: 'aa'.repeat(32) as any, vout: 0, value: 50000n },
      { txid: 'bb'.repeat(32) as any, vout: 1, value: 60000n }
    ];

    const { outputScript } = validateBitcoinDestinationAddress(
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      network
    );

    const txHex = buildSweepTransaction({
      accountId: 'test',
      fromAddress,
      outputScript,
      utxos,
      feeRateSatsPerVByte: 1,
      privateKey,
      network
    });

    const tx = bitcoin.Transaction.fromHex(txHex);

    // P2WPKH signs over P2PKH scriptCode per BIP143, not the P2WPKH output script
    const p2pkhScript = bitcoin.payments.p2pkh({
      hash: witnessScript.slice(2)
    }).output!;

    utxos.forEach((utxo, i) => {
      const sighash = tx.hashForWitnessV0(
        i,
        p2pkhScript,
        utxo.value,
        bitcoin.Transaction.SIGHASH_ALL
      );
      const witnessItem = tx.ins[i].witness[0] as Buffer;
      const { signature: compactSig } =
        bitcoin.script.signature.decode(witnessItem);
      expect(
        secp.verify(compactSig, sighash, publicKey, {
          prehash: false,
          lowS: true
        })
      ).toBe(true);
    });
  });
});
