import { AccountId, ChainId } from 'caip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActivityType,
  ChainSpecification,
  type Asset,
  type LibQCStorage,
  type Symbol
} from '../../../src';
import { BitcoinAccountClient } from '../../../src/account/bitcoin';
import type { BitcoinChainApi } from '../../../src/account/bitcoin/api';
import { EsploraBitcoinApi } from '../../../src/account/bitcoin/esplora';
import type { VaultEncryptionKeyWithMetadata } from '../../../src/cryptography';
import {
  AssetEntityNotFoundError,
  InvalidAssetMetadataError
} from '../../../src/errors';
import { PersistedAccount } from '../../../src/state';
import * as stateModule from '../../../src/state';
import { getAssetBySymbol } from '../../../src/assets';
import { createMultiChainTestAsset } from '../../testUtils';

const MOCK_ENCRYPTION_KEY = {} as VaultEncryptionKeyWithMetadata;

const ESPLORA_BASE_URL = 'https://blockstream.info/api';

function createTestApi(baseUrl: string = ESPLORA_BASE_URL): BitcoinChainApi {
  return new EsploraBitcoinApi(baseUrl);
}

/**
 * Bitcoin logic tests use mocked fetch to avoid Blockstream API dependency.
 * Each test explains the real-life scenario it validates.
 */
describe('BitcoinAccountClient', () => {
  let mockStorage: LibQCStorage;
  let testAccount: PersistedAccount;
  let btcAsset: Asset;
  const btcChainId = new ChainId({
    namespace: 'bip122',
    reference: '000000000019d6689c085ae165831e93'
  });
  const testAddress = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

  const chainSpec = {
    nativeCurrency: {
      symbol: 'BTC' as Symbol,
      decimals: 8,
      name: 'Bitcoin'
    }
  } as ChainSpecification;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockStorage = {
      get: vi.fn().mockResolvedValue({
        addresses: [
          {
            chainType: 'bitcoin',
            address: testAddress,
            index: 0,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xa),
            accounts: [],
            version: 'V1'
          }
        ],
        assets: []
      }),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(true)
    };

    testAccount = {
      id: new AccountId({ chainId: btcChainId, address: testAddress }),
      address: testAddress as any,
      chainId: btcChainId
    };

    btcAsset = getAssetBySymbol('BTC' as Symbol)!;
  });

  describe('getId', () => {
    it('returns the account id', () => {
      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );
      expect(client.getId().toString()).toBe(
        `bip122:000000000019d6689c085ae165831e93:${testAddress}`
      );
    });
  });

  describe('getBalance', () => {
    it('fetches balance from Esplora and returns BalanceResult (normal wallet with received and spent UTXOs)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chain_stats: {
              funded_txo_sum: 100000,
              spent_txo_sum: 30000
            }
          })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const balance = await client.getBalance(btcAsset);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://blockstream.info/api/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      );
      expect(balance.balance).toBe(70000n);
      expect(balance.decimals).toBe(8);
      expect(balance.symbol).toBe('BTC');
    });

    it('throws InvalidAssetMetadataError for impossible Bitcoin entity decimals', async () => {
      const mockApi: BitcoinChainApi = {
        getBalance: vi
          .fn()
          .mockResolvedValue({ funded: 100000000n, spent: 0n }),
        getActivities: vi.fn().mockResolvedValue([]),
        getUtxos: vi.fn().mockResolvedValue([]),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
        broadcastTransaction: vi.fn().mockResolvedValue(''),
        getMempoolTxs: vi.fn().mockResolvedValue([]),
        getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
      };
      // Entity decimals (10) differ from parent decimals (8)
      const multiChainBtc = createMultiChainTestAsset({
        id: 'p11:btc',
        symbol: 'BTC',
        decimals: 8,
        entities: [
          {
            chainId: btcChainId,
            address: '0x0',
            decimals: 10,
            isNative: true,
            coinType: '0'
          }
        ]
      });

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        mockApi,
        chainSpec
      );

      await expect(client.getBalance(multiChainBtc)).rejects.toThrow(
        InvalidAssetMetadataError
      );
    });

    it('throws InvalidAssetMetadataError when Bitcoin asset config matches itself but not the chain decimals', async () => {
      const mockApi: BitcoinChainApi = {
        getBalance: vi
          .fn()
          .mockResolvedValue({ funded: 100000000n, spent: 0n }),
        getActivities: vi.fn().mockResolvedValue([]),
        getUtxos: vi.fn().mockResolvedValue([]),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
        broadcastTransaction: vi.fn().mockResolvedValue(''),
        getMempoolTxs: vi.fn().mockResolvedValue([]),
        getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
      };
      const misconfiguredBtc = createMultiChainTestAsset({
        id: 'p11:btc',
        symbol: 'BTC',
        decimals: 10,
        entities: [
          {
            chainId: btcChainId,
            address: '0x0',
            decimals: 10,
            isNative: true,
            coinType: '0'
          }
        ]
      });

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        mockApi,
        chainSpec
      );

      await expect(client.getBalance(misconfiguredBtc)).rejects.toThrow(
        InvalidAssetMetadataError
      );
    });

    it('throws AssetEntityNotFoundError for non-native asset (Bitcoin only supports BTC, not tokens)', async () => {
      const usdcAsset = getAssetBySymbol('USDC' as Symbol)!;
      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      await expect(client.getBalance(usdcAsset)).rejects.toThrow(
        AssetEntityNotFoundError
      );
    });

    it('throws when API getBalance fails (misconfigured chain spec or missing env)', async () => {
      const mockApi: BitcoinChainApi = {
        getBalance: vi
          .fn()
          .mockRejectedValue(
            new Error('No API base URL configured for Bitcoin chain')
          ),
        getActivities: vi.fn().mockResolvedValue([]),
        getMempoolTxs: vi.fn().mockResolvedValue([]),
        getUtxos: vi.fn().mockResolvedValue([]),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
        broadcastTransaction: vi.fn().mockResolvedValue(''),
        getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
      };
      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        mockApi,
        chainSpec
      );

      await expect(client.getBalance(btcAsset)).rejects.toThrow(
        'No API base URL configured for Bitcoin chain'
      );
    });

    it('throws when Blockstream API returns 4xx/5xx (rate limit, downtime, or invalid address)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      await expect(client.getBalance(btcAsset)).rejects.toThrow(
        'Bitcoin API error: 429 Too Many Requests'
      );
    });

    it('handles API response with empty chain_stats (API schema change or partial response)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chain_stats: {} })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const balance = await client.getBalance(btcAsset);

      expect(balance.balance).toBe(0n);
    });

    it('clamps balance to zero when spent exceeds funded (data anomaly or race condition)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chain_stats: {
              funded_txo_sum: 10000,
              spent_txo_sum: 50000
            }
          })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const balance = await client.getBalance(btcAsset);

      expect(balance.balance).toBe(0n);
    });

    it('normalizes trailing slash in API base URL (user config typo)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chain_stats: { funded_txo_sum: 50000, spent_txo_sum: 0 }
          })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi('https://blockstream.info/api/'),
        chainSpec
      );

      await client.getBalance(btcAsset);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://blockstream.info/api/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      );
    });

    it('returns zero balance for fresh address (new wallet, never received)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }
          })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const balance = await client.getBalance(btcAsset);

      expect(balance.balance).toBe(0n);
    });
  });

  describe('getBalances', () => {
    it('fetches multiple asset balances in parallel (balance overview screen)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0 }
          })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const balances = await client.getBalances([btcAsset]);

      expect(balances).toHaveLength(1);
      expect(balances[0].balance).toBe(100000n);
    });
  });

  describe('getActivities', () => {
    it('fetches incoming tx from Esplora and maps to BitcoinTransactionActivity (user received payment)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'abc123',
              status: { block_height: 800000 },
              vin: [
                {
                  prevout: {
                    value: 50000,
                    scriptpubkey_address: 'bc1qsender...'
                  }
                }
              ],
              vout: [
                {
                  value: 40000,
                  scriptpubkey_address: testAddress
                },
                {
                  value: 9000,
                  scriptpubkey_address: 'bc1qother...'
                }
              ]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://blockstream.info/api/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh/txs'
      );
      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe('BitcoinTransaction');
      expect(activities[0].blockNumber).toBe(800000n);
      const btcActivity = activities[0];
      if (btcActivity.type === ActivityType.BitcoinTransaction) {
        expect(btcActivity.data.txid).toBe('abc123');
        expect(btcActivity.data.value).toBe(40000n);
        expect(btcActivity.data.from).toEqual(['bc1qsender...']);
      }
    });

    it('maps outgoing tx with correct from/to and value (user sent BTC to another address)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'send123',
              status: { block_height: 800100 },
              vin: [
                {
                  prevout: {
                    value: 100000,
                    scriptpubkey_address: testAddress
                  }
                }
              ],
              vout: [
                { value: 50000, scriptpubkey_address: 'bc1qrecipient...' },
                { value: 45000, scriptpubkey_address: testAddress }
              ]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.from).toContain(testAddress);
        expect(activities[0].data.to).toBe('bc1qrecipient...');
        expect(activities[0].data.value).toBe(55000n);
        expect(activities[0].data.txid).toBe('send123');
      }
    });

    it('uses unknown for recipient when payment goes to non-address output (OP_RETURN, provably unspendable)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'opreturn123',
              status: { block_height: 800101 },
              vin: [
                {
                  prevout: {
                    value: 100000,
                    scriptpubkey_address: testAddress
                  }
                }
              ],
              vout: [
                { value: 50000, scriptpubkey_address: undefined },
                { value: 45000, scriptpubkey_address: testAddress }
              ]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.to).toBe('unknown');
        expect(activities[0].data.value).toBe(55000n);
      }
    });

    it('omits transactions with net zero (change back to self, internal consolidation)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'zeronet123',
              status: { block_height: 800099 },
              vin: [
                {
                  prevout: {
                    value: 50000,
                    scriptpubkey_address: testAddress
                  }
                }
              ],
              vout: [{ value: 50000, scriptpubkey_address: testAddress }]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(0);
    });

    it('omits unconfirmed (mempool) transactions (only show confirmed for accurate history)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'unconfirmed123',
              status: { confirmed: false },
              vin: [
                { prevout: { value: 10000, scriptpubkey_address: 'bc1q...' } }
              ],
              vout: [{ value: 10000, scriptpubkey_address: testAddress }]
            },
            {
              txid: 'confirmed456',
              status: { block_height: 800000 },
              vin: [
                { prevout: { value: 50000, scriptpubkey_address: 'bc1q...' } }
              ],
              vout: [{ value: 50000, scriptpubkey_address: testAddress }]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.txid).toBe('confirmed456');
      }
    });

    it('maps multiple vins to from addresses (multi-input payment from several sources)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'multi123',
              status: { block_height: 800002 },
              vin: [
                {
                  prevout: {
                    value: 30000,
                    scriptpubkey_address: 'bc1qsender1...'
                  }
                },
                {
                  prevout: {
                    value: 20000,
                    scriptpubkey_address: 'bc1qsender2...'
                  }
                }
              ],
              vout: [
                {
                  value: 45000,
                  scriptpubkey_address: testAddress
                },
                { value: 4000, scriptpubkey_address: 'bc1qchange...' }
              ]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.from).toEqual(
          expect.arrayContaining(['bc1qsender1...', 'bc1qsender2...'])
        );
        expect(activities[0].data.from).toHaveLength(2);
      }
    });

    it('handles transactions with empty vins (coinbase/mining reward to address)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'coinbase123',
              status: { block_height: 800001 },
              vin: [],
              vout: [
                {
                  value: 625000000,
                  scriptpubkey_address: testAddress
                }
              ]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe('BitcoinTransaction');
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.from).toEqual(['unknown']);
        expect(activities[0].data.to).toBe(testAddress);
        expect(activities[0].data.value).toBe(625000000n);
        expect(activities[0].data.txid).toBe('coinbase123');
      }
    });

    it('returns empty array when API returns no activities (offline or misconfigured chain)', async () => {
      const mockApi: BitcoinChainApi = {
        getBalance: vi.fn().mockResolvedValue({ funded: 0n, spent: 0n }),
        getActivities: vi.fn().mockResolvedValue([]),
        getMempoolTxs: vi.fn().mockResolvedValue([]),
        getUtxos: vi.fn().mockResolvedValue([]),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
        broadcastTransaction: vi.fn().mockResolvedValue(''),
        getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
      };
      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        mockApi,
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toEqual([]);
    });

    it('throws when Blockstream API returns error for tx history (API down, rate limit)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      await expect(client.getActivities()).rejects.toThrow(
        'Bitcoin API error: 503 Service Unavailable'
      );
    });

    it('returns empty array when API returns non-array (malformed response)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ not: 'an array' })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toEqual([]);
    });

    it('uses unknown for vin without prevout (coinbase inputs, malformed API)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'partial123',
              status: { block_height: 800003 },
              vin: [{ prevout: undefined }],
              vout: [{ value: 10000, scriptpubkey_address: testAddress }]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(1);
      if (activities[0].type === ActivityType.BitcoinTransaction) {
        expect(activities[0].data.from).toContain('unknown');
      }
    });

    it('filters by activity type when filter provided (e.g. only Bitcoin txs)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'filtered123',
              status: { block_height: 800004 },
              vin: [
                {
                  prevout: {
                    value: 50000,
                    scriptpubkey_address: 'bc1qsender...'
                  }
                }
              ],
              vout: [{ value: 50000, scriptpubkey_address: testAddress }]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities({
        types: [ActivityType.BitcoinTransaction]
      });

      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe(ActivityType.BitcoinTransaction);
    });

    it('sorts activities by block number descending (newest first for history UI)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              txid: 'old',
              status: { block_height: 800000 },
              vin: [
                {
                  prevout: {
                    value: 10000,
                    scriptpubkey_address: 'bc1qa...'
                  }
                }
              ],
              vout: [{ value: 10000, scriptpubkey_address: testAddress }]
            },
            {
              txid: 'new',
              status: { block_height: 800010 },
              vin: [
                {
                  prevout: {
                    value: 20000,
                    scriptpubkey_address: 'bc1qb...'
                  }
                }
              ],
              vout: [{ value: 20000, scriptpubkey_address: testAddress }]
            }
          ])
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const activities = await client.getActivities();

      expect(activities).toHaveLength(2);
      expect(activities[0].blockNumber).toBe(800010n);
      expect(activities[1].blockNumber).toBe(800000n);
    });
  });

  describe('listAssets', () => {
    it('returns assets filtered by chain (BTC for Bitcoin mainnet account)', async () => {
      vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue({
        addresses: [
          {
            chainType: 'bitcoin',
            address: testAddress,
            index: 0,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xa),
            accounts: [
              { id: testAccount.id, address: testAddress, chainId: btcChainId }
            ],
            version: 'V1'
          } as any
        ],
        assets: [btcAsset]
      });

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const assets = await client.listAssets();
      expect(assets).toContainEqual(expect.objectContaining({ symbol: 'BTC' }));
    });

    it('returns empty array when no assets tracked for chain (minimal state)', async () => {
      vi.spyOn(stateModule, 'getLibQCState').mockResolvedValue({
        addresses: [
          {
            chainType: 'bitcoin',
            address: testAddress,
            index: 0,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xa),
            accounts: [
              { id: testAccount.id, address: testAddress, chainId: btcChainId }
            ],
            version: 'V1'
          } as any
        ],
        assets: []
      });

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const assets = await client.listAssets();
      expect(assets).toEqual([]);
    });
  });

  describe('isPubKeyExposed', () => {
    it('returns false when wallet has no outgoing tx (receive-only or fresh wallet)', async () => {
      const confirmedTxs = [
        {
          txid: 'receive-only',
          status: { block_height: 800000 },
          vin: [
            { prevout: { value: 50000, scriptpubkey_address: 'bc1qsender...' } }
          ],
          vout: [{ value: 50000, scriptpubkey_address: testAddress }]
        }
      ];
      // First call: /txs (confirmed) — second call: /txs/mempool (empty)
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(confirmedTxs)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const exposed = await client.isPubKeyExposed();
      expect(exposed).toBe(false);
    });

    it('returns true when wallet has a confirmed outgoing tx (pubkey visible in spent UTXO)', async () => {
      const confirmedTxs = [
        {
          txid: 'sent123',
          status: { block_height: 800100 },
          vin: [
            { prevout: { value: 100000, scriptpubkey_address: testAddress } }
          ],
          vout: [
            { value: 50000, scriptpubkey_address: 'bc1qrecipient...' },
            { value: 45000, scriptpubkey_address: testAddress }
          ]
        }
      ];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(confirmedTxs)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const exposed = await client.isPubKeyExposed();
      expect(exposed).toBe(true);
    });

    it('returns true when wallet has a pending mempool spend (pubkey exposed before confirmation)', async () => {
      // No confirmed outgoing txs, but a mempool tx where our address is a sender
      const mempoolTxs = [
        {
          txid: 'mempool-send',
          status: {},
          vin: [
            { prevout: { value: 80000, scriptpubkey_address: testAddress } }
          ],
          vout: [{ value: 75000, scriptpubkey_address: 'bc1qrecipient...' }]
        }
      ];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]) // /txs: no confirmed txs
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mempoolTxs) // /txs/mempool: pending spend
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const exposed = await client.isPubKeyExposed();
      expect(exposed).toBe(true);
    });

    it('returns false when mempool has only incoming txs (not a spend)', async () => {
      const mempoolTxs = [
        {
          txid: 'mempool-receive',
          status: {},
          vin: [
            { prevout: { value: 50000, scriptpubkey_address: 'bc1qsender...' } }
          ],
          vout: [{ value: 50000, scriptpubkey_address: testAddress }]
        }
      ];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mempoolTxs)
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        createTestApi(),
        chainSpec
      );

      const exposed = await client.isPubKeyExposed();
      expect(exposed).toBe(false);
    });
  });

  describe('private key zeroing in failure paths', () => {
    it('zeroes persistedAddress private key when getSweepContext fails after address load', async () => {
      const canary = new Uint8Array(32).fill(0xe1);
      const persistedAddress = {
        chainType: 'bitcoin',
        address: testAddress,
        index: 0,
        secp256k1PrivateKey: canary,
        accounts: [],
        version: 'V1'
      } as any;

      const mockApi: BitcoinChainApi = {
        getBalance: vi.fn().mockResolvedValue({ funded: 1n, spent: 0n }),
        getActivities: vi.fn().mockResolvedValue([]),
        getMempoolTxs: vi.fn().mockResolvedValue([]),
        getUtxos: vi.fn().mockRejectedValue(new Error('forced UTXO failure')),
        getFeeRateSatsPerVByte: vi.fn().mockResolvedValue(1),
        broadcastTransaction: vi.fn().mockResolvedValue('txid'),
        getTxStatus: vi.fn().mockResolvedValue({ confirmed: false })
      };

      const client = new BitcoinAccountClient(
        testAccount,
        mockStorage,
        MOCK_ENCRYPTION_KEY,
        mockApi,
        chainSpec
      );

      vi.spyOn(
        client as any,
        'getPersistedAddressFromAccount'
      ).mockResolvedValue(persistedAddress);
      vi.spyOn(client, 'getBalance').mockResolvedValue({
        balance: 1n as any,
        decimals: 8 as any,
        symbol: 'BTC' as any
      });

      await expect(
        (client as any).getSweepContext(testAddress)
      ).rejects.toThrow('forced UTXO failure');

      expect(Array.from(canary).every(byte => byte === 0)).toBe(true);
    });
  });
});
