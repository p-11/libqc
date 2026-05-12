import { AccountId, AssetType, ChainId } from 'caip';
import { zeroAddress } from 'viem';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Main entry point exports
import { type EvmAddress, type LibQCStorage } from '../../src';

// Internal imports (not exported from main entry point)
import { AddressVersion } from '../../src/config';
import {
  type VaultEncryptionKeyWithMetadata,
  deriveEncryptionKey,
  generateScryptSalt
} from '../../src/cryptography';
import * as cryptoModule from '../../src/cryptography';
import {
  getLibQCState,
  getStateSegment,
  hasEncryptedVault,
  LibQCState,
  resumeRotationIfInterrupted,
  rotateEncryptionKey,
  setStateSegment,
  STATE_SEGMENT_KEYS,
  ROTATION_MARKER_KEY,
  ROTATION_STAGING_KEYS
} from '../../src/state';
import {
  createTestAsset,
  getTestEntropy,
  MockStorage,
  TEST_FAST_SCRYPT_PARAMS,
  getTestPassword,
  getTestSeed
} from '../testUtils';

/**
 * MockStorage that simulates real WebStorage serialization behavior
 * Uses JSON.stringify/parse to strip prototypes like WebStorage does
 */
class SerializingMockStorage implements LibQCStorage {
  constructor(private store: Map<string, string>) {}

  async get<V>(key: string): Promise<V | null> {
    const serialized = this.store.get(key);
    if (!serialized) return null;
    return JSON.parse(serialized) as V;
  }

  async put<V>(key: string, value: V): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// Convenience helper: writes all state segments so getLibQCState can assemble them.
async function seedState(
  storage: LibQCStorage,
  state: LibQCState,
  key: VaultEncryptionKeyWithMetadata
): Promise<void> {
  await Promise.all([
    setStateSegment(storage, key, 'entropy', state.entropy),
    setStateSegment(storage, key, 'seed', state.seed),
    setStateSegment(storage, key, 'addresses', state.addresses),
    setStateSegment(storage, key, 'assets', state.assets),
    setStateSegment(storage, key, 'httpSigning', state.httpSigning)
  ]);
}

async function clearSeedState(storage: LibQCStorage): Promise<void> {
  await Promise.all(
    Object.values(STATE_SEGMENT_KEYS).map(segmentKey =>
      storage.delete(segmentKey)
    )
  );
}

async function createTestEncryptionKey(): Promise<VaultEncryptionKeyWithMetadata> {
  const scryptSalt = generateScryptSalt();
  return deriveEncryptionKey(
    getTestPassword(),
    scryptSalt,
    TEST_FAST_SCRYPT_PARAMS
  );
}

describe('State Management with Encryption', () => {
  let storage: SerializingMockStorage;
  let chainId: ChainId;
  let encryptionKey: VaultEncryptionKeyWithMetadata;

  beforeEach(async () => {
    storage = new SerializingMockStorage(new Map());
    chainId = new ChainId({ namespace: 'eip155', reference: '1' });
    encryptionKey = await createTestEncryptionKey();
  });

  describe('Asset serialization and reconstruction', () => {
    test('reconstructs AssetType after encryption round-trip', async () => {
      const asset = createTestAsset(
        chainId,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDC',
        6,
        false
      );

      const state: LibQCState = {
        addresses: [],
        assets: [asset]
      };

      // Store the state (encrypts)
      await seedState(storage, state, encryptionKey);

      // Retrieve the state (decrypts and reconstructs)
      const retrievedState = await getLibQCState(storage, encryptionKey);

      // Verify the asset was properly reconstructed
      expect(retrievedState.assets).toBeDefined();
      expect(retrievedState.assets).toHaveLength(1);

      const retrievedAsset = retrievedState.assets![0];

      // Verify AssetType instance is properly reconstructed in aggregated entities
      expect(retrievedAsset.entities).toHaveLength(1);
      expect(retrievedAsset.entities[0].assetType).toBeInstanceOf(AssetType);
      expect(retrievedAsset.entities[0].assetType.toString()).toBe(
        'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );

      // Verify other properties are intact
      expect(retrievedAsset.id).toBe(asset.id);
      expect(retrievedAsset.symbol).toBe('USDC');
      expect(retrievedAsset.decimals).toBe(6);
      expect(retrievedAsset.entities[0].decimals).toBe(6);
      expect(retrievedAsset.entities[0].symbol).toBe('USDC');
    });

    test('reconstructs native asset after encryption', async () => {
      const nativeAsset = createTestAsset(
        chainId,
        zeroAddress,
        'ETH',
        18,
        true
      );

      const state: LibQCState = {
        addresses: [],
        assets: [nativeAsset]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      const retrievedAsset = retrievedState.assets![0];

      expect(retrievedAsset.entities).toHaveLength(1);
      expect(retrievedAsset.entities[0].assetType).toBeInstanceOf(AssetType);
      expect(retrievedAsset.entities[0].assetType.toString()).toBe(
        'eip155:1/slip44:60'
      );
      expect(retrievedAsset.symbol).toBe('ETH');
      expect(retrievedAsset.decimals).toBe(18);
    });

    test('reconstructs multiple assets correctly', async () => {
      const usdc = createTestAsset(
        chainId,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDC',
        6,
        false
      );
      const usdt = createTestAsset(
        chainId,
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        'USDT',
        6,
        false
      );
      const eth = createTestAsset(chainId, zeroAddress, 'ETH', 18, true);

      const state: LibQCState = {
        addresses: [],
        assets: [usdc, usdt, eth]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      expect(retrievedState.assets).toHaveLength(3);

      // Verify all AssetType instances work correctly
      retrievedState.assets!.forEach(asset => {
        expect(asset.entities.length).toBeGreaterThan(0);
        asset.entities.forEach(entity => {
          expect(entity.assetType).toBeInstanceOf(AssetType);
          expect(entity.assetType.toString()).not.toBe('[object Object]');
          expect(entity.assetType.chainId.toString()).toBe('eip155:1');
        });
      });
    });

    test('asset comparison works after encryption round-trip', async () => {
      const asset1 = createTestAsset(
        chainId,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDC',
        6,
        false
      );
      const asset2 = createTestAsset(
        chainId,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDC',
        6,
        false
      );

      const state: LibQCState = {
        addresses: [],
        assets: [asset1]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      const retrievedAsset = retrievedState.assets![0];

      // This comparison should work correctly now
      expect(retrievedAsset.entities[0].assetType.toString()).toBe(
        asset2.entities[0].assetType.toString()
      );
      expect(retrievedAsset.entities[0].assetType.toString()).toBe(
        'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );
    });
  });

  describe('Account serialization and reconstruction', () => {
    test('reconstructs AccountId and ChainId in accounts', async () => {
      const accountId = new AccountId({
        chainId,
        address: '0x1234567890123456789012345678901234567890'
      });

      const state: LibQCState = {
        addresses: [
          {
            chainType: 'evm',
            address: '0x1234567890123456789012345678901234567890' as EvmAddress,
            index: 0 as any,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xab) as any,
            secp256k1PublicKeyHash:
              '0xabcdef1234567890abcdef1234567890abcdef12' as EvmAddress,
            version: 'V1' as AddressVersion,
            accounts: [
              {
                id: accountId,
                address:
                  '0x1234567890123456789012345678901234567890' as EvmAddress,
                chainId
              }
            ]
          }
        ]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      const account = retrievedState.addresses[0].accounts[0];

      // Verify AccountId reconstruction
      expect(account.id).toBeInstanceOf(AccountId);
      expect(account.id.toString()).toBe(
        'eip155:1:0x1234567890123456789012345678901234567890'
      );

      // Verify ChainId reconstruction
      expect(account.chainId).toBeInstanceOf(ChainId);
      expect(account.chainId.toString()).toBe('eip155:1');
    });

    test('reconstructs BitcoinPersistedAddress with chainType bitcoin', async () => {
      const { AccountId } = await import('caip');
      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      const accountId = new AccountId({
        chainId: btcChainId,
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      });

      const state: LibQCState = {
        addresses: [
          {
            chainType: 'bitcoin',
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as any,
            index: 0 as any,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xaa) as any,
            version: 'V1' as AddressVersion,
            accounts: [
              {
                id: accountId,
                address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as any,
                chainId: btcChainId
              }
            ]
          }
        ]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      const addr = retrievedState.addresses[0];
      expect(addr.chainType).toBe('bitcoin');
      expect(addr.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(addr.accounts).toHaveLength(1);
      expect(addr.accounts[0].id.toString()).toContain('bip122:');
    });
  });

  describe('Empty state handling', () => {
    test('returns default state when storage is empty', async () => {
      const state = await getLibQCState(storage, encryptionKey);
      expect(state).toEqual({ addresses: [] });
    });

    test('handles undefined assets array', async () => {
      const state: LibQCState = {
        addresses: []
        // assets is undefined
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      expect(retrievedState.assets).toBeUndefined();
    });
  });

  describe('Encrypted storage verification', () => {
    test('stored data is not plaintext JSON', async () => {
      const state: LibQCState = {
        entropy: getTestEntropy(),
        seed: getTestSeed(),
        addresses: []
      };

      await seedState(storage, state, encryptionKey);

      // The raw stored value should be an EncryptedVault, not plaintext
      const raw = await storage.get<Record<string, unknown>>('state.entropy');
      expect(raw).toBeDefined();
      expect(raw).toHaveProperty('data');
      expect(raw).toHaveProperty('iv');
      expect(raw).toHaveProperty('scryptSalt');
      expect(raw).toHaveProperty('keyMetadata');

      // The mnemonic should NOT appear in the stored data
      const rawString = JSON.stringify(raw);
      expect(rawString).not.toContain('abandon');
    });

    test('hasEncryptedVault returns false when empty', async () => {
      expect(await hasEncryptedVault(storage)).toBe(false);
    });

    test('hasEncryptedVault returns true after storing state', async () => {
      await seedState(storage, { addresses: [] }, encryptionKey);
      expect(await hasEncryptedVault(storage)).toBe(true);
    });
  });

  describe('Mixed chain assets', () => {
    test('reconstructs assets from different chains', async () => {
      const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '137' });

      const ethMainnet = createTestAsset(
        chainId1,
        zeroAddress,
        'ETH',
        18,
        true
      );
      const maticPolygon = createTestAsset(
        chainId2,
        zeroAddress,
        'MATIC',
        18,
        true
      );
      const usdcMainnet = createTestAsset(
        chainId1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDC',
        6,
        false
      );

      const state: LibQCState = {
        addresses: [],
        assets: [ethMainnet, maticPolygon, usdcMainnet]
      };

      await seedState(storage, state, encryptionKey);
      const retrievedState = await getLibQCState(storage, encryptionKey);

      expect(retrievedState.assets).toHaveLength(3);

      const eth = retrievedState.assets!.find(a => a.symbol === 'ETH');
      const matic = retrievedState.assets!.find(a => a.symbol === 'MATIC');
      const usdc = retrievedState.assets!.find(a => a.symbol === 'USDC');

      expect(eth?.entities[0].assetType.chainId.toString()).toBe('eip155:1');
      expect(eth?.entities[0].assetType.toString()).toBe('eip155:1/slip44:60');

      expect(matic?.entities[0].assetType.chainId.toString()).toBe(
        'eip155:137'
      );
      expect(matic?.entities[0].assetType.toString()).toBe(
        'eip155:137/slip44:60'
      );

      expect(usdc?.entities[0].assetType.chainId.toString()).toBe('eip155:1');
      expect(usdc?.entities[0].assetType.toString()).toBe(
        'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );
    });
  });

  describe('State clearing', () => {
    test('seedState with empty state clears all data including nested structures', async () => {
      const { AccountId } = await import('caip');

      // Set up complex state with all fields and nested structures
      const accountId = new AccountId({
        chainId,
        address: '0x1234567890123456789012345678901234567890'
      });

      const initialState: LibQCState = {
        entropy: getTestEntropy(),
        seed: getTestSeed(),
        addresses: [
          {
            chainType: 'evm',
            address: '0x1234567890123456789012345678901234567890' as EvmAddress,
            index: 0 as any,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xab) as any,
            secp256k1PublicKeyHash:
              '0xabcdef1234567890abcdef1234567890abcdef12' as EvmAddress,
            version: 'V1' as AddressVersion,
            accounts: [
              {
                id: accountId,
                address:
                  '0x1234567890123456789012345678901234567890' as EvmAddress,
                chainId
              }
            ]
          },
          {
            chainType: 'evm',
            address: '0x9876543210987654321098765432109876543210' as EvmAddress,
            index: 1 as any,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xdc) as any,
            secp256k1PublicKeyHash:
              '0xdcbaef1234567890abcdef1234567890abcdef12' as EvmAddress,
            version: 'V1' as AddressVersion,
            accounts: []
          }
        ],
        assets: [
          createTestAsset(chainId, zeroAddress, 'ETH', 18, true),
          createTestAsset(
            chainId,
            '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            'USDC',
            6,
            false
          ),
          createTestAsset(
            chainId,
            '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            'USDT',
            6,
            false
          )
        ]
      };

      await seedState(storage, initialState, encryptionKey);

      // Verify state is set
      let state = await getLibQCState(storage, encryptionKey);
      expect(state.entropy).toBeDefined();
      expect(state.seed).toBeDefined();
      expect(state.addresses).toHaveLength(2);
      expect(state.assets).toHaveLength(3);

      // Clear state
      await clearSeedState(storage);

      // Verify all data is cleared and matches default state
      state = await getLibQCState(storage, encryptionKey);
      expect(state.entropy).toBeUndefined();
      expect(state.seed).toBeUndefined();
      expect(state.addresses).toEqual([]);
      expect(state.assets).toBeUndefined();
      expect(state).toEqual({ addresses: [] });
    });

    test('multiple consecutive clears maintain clean state', async () => {
      // Set initial state
      await seedState(
        storage,
        { entropy: getTestEntropy(), seed: getTestSeed(), addresses: [] },
        encryptionKey
      );

      // Clear multiple times
      await clearSeedState(storage);
      await clearSeedState(storage);
      await clearSeedState(storage);

      // State should still be clean
      const state = await getLibQCState(storage, encryptionKey);
      expect(state).toEqual({ addresses: [] });
    });

    test('clearing already empty state is idempotent', async () => {
      // Start with empty state
      const stateBefore = await getLibQCState(storage, encryptionKey);
      expect(stateBefore).toEqual({ addresses: [] });

      // Clear the already empty state
      await clearSeedState(storage);

      // State should remain empty
      const stateAfter = await getLibQCState(storage, encryptionKey);
      expect(stateAfter).toEqual({ addresses: [] });
      expect(stateAfter).toEqual(stateBefore);
    });

    test('state clearing persists across storage retrieval', async () => {
      // Set up state
      const initialState: LibQCState = {
        entropy: getTestEntropy(),
        seed: getTestSeed(),
        addresses: [
          {
            chainType: 'evm',
            address: '0x1234567890123456789012345678901234567890' as EvmAddress,
            index: 0 as any,
            secp256k1PrivateKey: new Uint8Array(32).fill(0xab) as any,
            secp256k1PublicKeyHash:
              '0xabcdef1234567890abcdef1234567890abcdef12' as EvmAddress,
            version: 'V1' as AddressVersion,
            accounts: []
          }
        ],
        assets: [createTestAsset(chainId, zeroAddress, 'ETH', 18, true)]
      };

      await seedState(storage, initialState, encryptionKey);

      // Clear state
      await clearSeedState(storage);

      // Retrieve multiple times - should remain cleared
      const state1 = await getLibQCState(storage, encryptionKey);
      const state2 = await getLibQCState(storage, encryptionKey);
      const state3 = await getLibQCState(storage, encryptionKey);

      expect(state1).toEqual({ addresses: [] });
      expect(state2).toEqual({ addresses: [] });
      expect(state3).toEqual({ addresses: [] });
    });
  });
});

async function createTestKey(): Promise<VaultEncryptionKeyWithMetadata> {
  return deriveEncryptionKey(
    getTestPassword(),
    generateScryptSalt(),
    TEST_FAST_SCRYPT_PARAMS
  );
}

describe('Segmented State', () => {
  let storage: MockStorage;
  let encryptionKey: VaultEncryptionKeyWithMetadata;

  beforeEach(async () => {
    storage = new MockStorage(new Map());
    encryptionKey = await createTestKey();
  });

  describe('segment isolation', () => {
    test('writing addresses segment does not create entropy segment', async () => {
      await setStateSegment(storage, encryptionKey, 'addresses', []);

      expect(await storage.has(STATE_SEGMENT_KEYS.entropy)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.addresses)).toBe(true);
    });

    test('reading entropy returns undefined when only addresses segment exists', async () => {
      await setStateSegment(storage, encryptionKey, 'addresses', []);

      const entropy = await getStateSegment(storage, encryptionKey, 'entropy');
      expect(entropy).toBeUndefined();
    });
  });

  describe('no cross-segment decryption', () => {
    test('getStateSegment(addresses) calls decryptData exactly once', async () => {
      // Write two segments so both exist
      await setStateSegment(storage, encryptionKey, 'addresses', []);
      await setStateSegment(storage, encryptionKey, 'entropy', undefined);

      const decryptSpy = vi.spyOn(cryptoModule, 'decryptData');

      await getStateSegment(storage, encryptionKey, 'addresses');

      expect(decryptSpy).toHaveBeenCalledTimes(1);
      decryptSpy.mockRestore();
    });
  });

  describe('hasEncryptedVault', () => {
    test('returns false on empty storage', async () => {
      expect(await hasEncryptedVault(storage)).toBe(false);
    });

    test('returns true when all four segments are present', async () => {
      await Promise.all([
        setStateSegment(storage, encryptionKey, 'entropy', undefined),
        setStateSegment(storage, encryptionKey, 'seed', undefined),
        setStateSegment(storage, encryptionKey, 'addresses', []),
        setStateSegment(storage, encryptionKey, 'assets', undefined)
      ]);
      expect(await hasEncryptedVault(storage)).toBe(true);
    });

    test('returns false when only some segments are present', async () => {
      await setStateSegment(storage, encryptionKey, 'addresses', []);
      expect(await hasEncryptedVault(storage)).toBe(false);
    });
  });

  describe('cross-key re-encryption', () => {
    test('segments written with old key cannot be read with new key', async () => {
      const oldKey = await createTestKey();
      const newKey = await createTestKey();

      await setStateSegment(storage, oldKey, 'addresses', []);

      await expect(
        getStateSegment(storage, newKey, 'addresses')
      ).rejects.toThrow();
    });
  });

  describe('rotateEncryptionKey', () => {
    test('all segments readable with new key after rotation', async () => {
      const { IncorrectPasswordError } = await import('../../src');
      const oldKey = await createTestKey();
      const newKey = await createTestKey();

      const entropy = getTestEntropy();
      const seed = getTestSeed();
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const asset = createTestAsset(chainId, zeroAddress, 'ETH', 18, true);

      await setStateSegment(storage, oldKey, 'entropy', entropy);
      await setStateSegment(storage, oldKey, 'seed', seed);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', [asset]);

      await rotateEncryptionKey(storage, oldKey, newKey);

      expect(await getStateSegment(storage, newKey, 'entropy')).toStrictEqual(
        entropy
      );
      expect(await getStateSegment(storage, newKey, 'seed')).toStrictEqual(
        seed
      );
      expect(await getStateSegment(storage, newKey, 'addresses')).toEqual([]);
      const readAssets = await getStateSegment(storage, newKey, 'assets');
      expect(readAssets).toHaveLength(1);
      expect(readAssets![0].symbol).toBe('ETH');

      await expect(getStateSegment(storage, oldKey, 'entropy')).rejects.toThrow(
        IncorrectPasswordError
      );
      await expect(getStateSegment(storage, oldKey, 'seed')).rejects.toThrow(
        IncorrectPasswordError
      );
      await expect(
        getStateSegment(storage, oldKey, 'addresses')
      ).rejects.toThrow(IncorrectPasswordError);
      await expect(getStateSegment(storage, oldKey, 'assets')).rejects.toThrow(
        IncorrectPasswordError
      );
      await expect(
        getStateSegment(storage, oldKey, 'httpSigning')
      ).rejects.toThrow(IncorrectPasswordError);
    });

    test('staging keys and rotation marker are cleaned up after rotation', async () => {
      const oldKey = await createTestKey();
      const newKey = await createTestKey();

      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);

      await rotateEncryptionKey(storage, oldKey, newKey);

      expect(await storage.has(ROTATION_MARKER_KEY)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.entropy)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.seed)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.addresses)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.assets)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.httpSigning)).toBe(false);
    });

    test('httpSigning segment survives rotation', async () => {
      const { ml_dsa65 } = await import('@noble/post-quantum/ml-dsa.js');
      const oldKey = await createTestKey();
      const newKey = await createTestKey();
      const keys = ml_dsa65.keygen();
      const httpSigning = {
        keyId: 'test-key-id',
        mlDsa65SecretKey: new Uint8Array(keys.secretKey)
      };
      keys.secretKey.fill(0);
      keys.publicKey.fill(0);

      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);
      await setStateSegment(storage, oldKey, 'withdrawals', undefined);
      await setStateSegment(storage, oldKey, 'httpSigning', httpSigning);

      await rotateEncryptionKey(storage, oldKey, newKey);

      const read = await getStateSegment(storage, newKey, 'httpSigning');
      expect(read?.keyId).toBe('test-key-id');
      expect(read?.mlDsa65SecretKey).toEqual(httpSigning.mlDsa65SecretKey);
      httpSigning.mlDsa65SecretKey.fill(0);
      read?.mlDsa65SecretKey.fill(0);
    });
  });

  describe('resumeRotationIfInterrupted', () => {
    test('no-ops when rotation marker is absent', async () => {
      const key = await createTestKey();
      await setStateSegment(storage, key, 'addresses', []);

      await expect(
        resumeRotationIfInterrupted(storage)
      ).resolves.toBeUndefined();
      expect(await storage.has(STATE_SEGMENT_KEYS.addresses)).toBe(true);
    });

    test('completes an interrupted rotation when marker is present', async () => {
      const oldKey = await createTestKey();
      const newKey = await createTestKey();
      const stagingStorage = new MockStorage(new Map());

      // Write initial state with old key
      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);
      await setStateSegment(storage, oldKey, 'httpSigning', undefined);
      await setStateSegment(storage, oldKey, 'withdrawals', undefined);

      // Build new-key blobs for all segments (simulate completed phase-1).
      await setStateSegment(stagingStorage, newKey, 'entropy', undefined);
      const newEntropyBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.entropy
      );
      await setStateSegment(stagingStorage, newKey, 'seed', undefined);
      const newSeedBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.seed);
      await setStateSegment(stagingStorage, newKey, 'addresses', []);
      const newAddressesBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.addresses
      );
      await setStateSegment(stagingStorage, newKey, 'assets', undefined);
      const newAssetsBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.assets);
      await setStateSegment(stagingStorage, newKey, 'withdrawals', undefined);
      const newWithdrawalsBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.withdrawals
      );
      await setStateSegment(stagingStorage, newKey, 'httpSigning', undefined);
      const newHttpSigningBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.httpSigning
      );

      // Place new-key blobs at staging keys and write the rotation marker
      await storage.put(ROTATION_STAGING_KEYS.entropy, newEntropyBlob);
      await storage.put(ROTATION_STAGING_KEYS.seed, newSeedBlob);
      await storage.put(ROTATION_STAGING_KEYS.addresses, newAddressesBlob);
      await storage.put(ROTATION_STAGING_KEYS.assets, newAssetsBlob);
      await storage.put(ROTATION_STAGING_KEYS.httpSigning, newHttpSigningBlob);
      await storage.put(ROTATION_STAGING_KEYS.withdrawals, newWithdrawalsBlob);
      await storage.put(ROTATION_MARKER_KEY, true);

      await resumeRotationIfInterrupted(storage);

      // Marker and staging keys cleaned up
      expect(await storage.has(ROTATION_MARKER_KEY)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.entropy)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.seed)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.addresses)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.assets)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.httpSigning)).toBe(false);
      expect(await storage.has(ROTATION_STAGING_KEYS.withdrawals)).toBe(false);

      // All main keys now hold new-key blobs and are readable with newKey
      await expect(
        getStateSegment(storage, newKey, 'entropy')
      ).resolves.toBeUndefined();
      await expect(
        getStateSegment(storage, newKey, 'seed')
      ).resolves.toBeUndefined();
      await expect(
        getStateSegment(storage, newKey, 'addresses')
      ).resolves.toEqual([]);
      await expect(
        getStateSegment(storage, newKey, 'assets')
      ).resolves.toBeUndefined();
      await expect(
        getStateSegment(storage, newKey, 'withdrawals')
      ).resolves.toBeUndefined();
      await expect(
        getStateSegment(storage, newKey, 'httpSigning')
      ).resolves.toBeUndefined();

      // Old key can no longer decrypt any segment
      await expect(
        getStateSegment(storage, oldKey, 'entropy')
      ).rejects.toThrow();
      await expect(getStateSegment(storage, oldKey, 'seed')).rejects.toThrow();
      await expect(
        getStateSegment(storage, oldKey, 'addresses')
      ).rejects.toThrow();
      await expect(
        getStateSegment(storage, oldKey, 'assets')
      ).rejects.toThrow();
      await expect(
        getStateSegment(storage, oldKey, 'withdrawals')
      ).rejects.toThrow();
      await expect(
        getStateSegment(storage, oldKey, 'httpSigning')
      ).rejects.toThrow();
    });

    test('completes a pre-PR interrupted rotation that lacks the withdrawals segment (ENG-1791)', async () => {
      const oldKey = await createTestKey();
      const newKey = await createTestKey();
      const stagingStorage = new MockStorage(new Map());

      // Set up a pre-ENG-1791 vault: only the original core segments exist.
      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);

      // Build new-key blobs for the original core segments only — simulating a
      // rotation that completed phase-1 under the previous SDK release and
      // crashed before commit. No `withdrawals` staging blob exists.
      await setStateSegment(stagingStorage, newKey, 'entropy', undefined);
      const newEntropyBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.entropy
      );
      await setStateSegment(stagingStorage, newKey, 'seed', undefined);
      const newSeedBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.seed);
      await setStateSegment(stagingStorage, newKey, 'addresses', []);
      const newAddressesBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.addresses
      );
      await setStateSegment(stagingStorage, newKey, 'assets', undefined);
      const newAssetsBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.assets);
      await setStateSegment(stagingStorage, newKey, 'httpSigning', undefined);
      const newHttpSigningBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.httpSigning
      );

      // Clear withdrawals entirely (pre-PR vaults never had this segment).
      await storage.delete(STATE_SEGMENT_KEYS.withdrawals);

      await storage.put(ROTATION_STAGING_KEYS.entropy, newEntropyBlob);
      await storage.put(ROTATION_STAGING_KEYS.seed, newSeedBlob);
      await storage.put(ROTATION_STAGING_KEYS.addresses, newAddressesBlob);
      await storage.put(ROTATION_STAGING_KEYS.assets, newAssetsBlob);
      await storage.put(ROTATION_STAGING_KEYS.httpSigning, newHttpSigningBlob);
      // Intentionally omit ROTATION_STAGING_KEYS.withdrawals — this is what
      // a pre-ENG-1791 in-flight rotation looks like under the new SDK.
      await storage.put(ROTATION_MARKER_KEY, true);

      await expect(resumeRotationIfInterrupted(storage)).resolves.not.toThrow();

      expect(await storage.has(ROTATION_MARKER_KEY)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.withdrawals)).toBe(false);
      await expect(
        getStateSegment(storage, newKey, 'addresses')
      ).resolves.toEqual([]);
    });

    test('completes an interrupted rotation from before httpSigning existed', async () => {
      const oldKey = await createTestKey();
      const newKey = await createTestKey();
      const stagingStorage = new MockStorage(new Map());

      // Set up a pre-httpSigning vault where all older segments exist.
      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);
      await setStateSegment(storage, oldKey, 'withdrawals', undefined);
      await storage.delete(STATE_SEGMENT_KEYS.httpSigning);

      // Simulate a completed phase-1 rotation from an SDK that had no
      // httpSigning segment, so no httpSigning staging blob was produced.
      await setStateSegment(stagingStorage, newKey, 'entropy', undefined);
      const newEntropyBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.entropy
      );
      await setStateSegment(stagingStorage, newKey, 'seed', undefined);
      const newSeedBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.seed);
      await setStateSegment(stagingStorage, newKey, 'addresses', []);
      const newAddressesBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.addresses
      );
      await setStateSegment(stagingStorage, newKey, 'assets', undefined);
      const newAssetsBlob = await stagingStorage.get(STATE_SEGMENT_KEYS.assets);
      await setStateSegment(stagingStorage, newKey, 'withdrawals', undefined);
      const newWithdrawalsBlob = await stagingStorage.get(
        STATE_SEGMENT_KEYS.withdrawals
      );

      await storage.put(ROTATION_STAGING_KEYS.entropy, newEntropyBlob);
      await storage.put(ROTATION_STAGING_KEYS.seed, newSeedBlob);
      await storage.put(ROTATION_STAGING_KEYS.addresses, newAddressesBlob);
      await storage.put(ROTATION_STAGING_KEYS.assets, newAssetsBlob);
      await storage.put(ROTATION_STAGING_KEYS.withdrawals, newWithdrawalsBlob);
      await storage.put(ROTATION_MARKER_KEY, true);

      await expect(resumeRotationIfInterrupted(storage)).resolves.not.toThrow();

      expect(await storage.has(ROTATION_MARKER_KEY)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.httpSigning)).toBe(false);
      await expect(
        getStateSegment(storage, newKey, 'withdrawals')
      ).resolves.toBeUndefined();
    });

    test('still throws when a populated segment has no staging blob', async () => {
      const oldKey = await createTestKey();

      // Healthy vault with an existing withdrawals segment.
      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);
      await setStateSegment(storage, oldKey, 'withdrawals', []);

      // Marker present but withdrawals staging blob missing — corrupted state.
      await storage.put(ROTATION_STAGING_KEYS.entropy, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.seed, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.addresses, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.assets, {} as never);
      await storage.put(ROTATION_MARKER_KEY, true);

      await expect(resumeRotationIfInterrupted(storage)).rejects.toThrow(
        /withdrawals/
      );
    });

    test('throws when a core segment is missing in both staging and main keys', async () => {
      const oldKey = await createTestKey();

      await setStateSegment(storage, oldKey, 'entropy', undefined);
      await setStateSegment(storage, oldKey, 'seed', undefined);
      await setStateSegment(storage, oldKey, 'addresses', []);
      await setStateSegment(storage, oldKey, 'assets', undefined);

      await storage.put(ROTATION_STAGING_KEYS.seed, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.addresses, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.assets, {} as never);
      await storage.put(ROTATION_STAGING_KEYS.withdrawals, {} as never);
      await storage.delete(ROTATION_STAGING_KEYS.entropy);
      await storage.delete(STATE_SEGMENT_KEYS.entropy);
      await storage.put(ROTATION_MARKER_KEY, true);

      await expect(resumeRotationIfInterrupted(storage)).rejects.toThrow(
        /entropy/
      );
    });
  });
});
