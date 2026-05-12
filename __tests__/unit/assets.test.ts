import { AssetType, ChainId } from 'caip';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Main entry point exports
import {
  type Asset,
  type AssetId,
  type AssetName,
  type Decimals,
  type IconUrl,
  type Symbol
} from '../../src';

// Internal imports (not exported from main entry point)
import {
  getAssetBySymbol,
  isErc20Token,
  isNativeAsset
} from '../../src/assets';
import { getLibQCState } from '../../src/state';
import {
  captureGeneratedMnemonic,
  MockStorage,
  createBareTestLibQC,
  createTestLibQC,
  getTestPassword,
  mockGenerateAddressFromMnemonic
} from '../testUtils';

describe('LibQC Asset Management', () => {
  beforeEach(() => {
    mockGenerateAddressFromMnemonic();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addToken', () => {
    test('adds a token successfully', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const result = await vault.addToken('USDC' as Symbol);

      expect(result.symbol).toBe('USDC');
      expect(result.id).toBe('p11:usdc');
      expect(result.decimals).toBe(6);
      expect(result.iconUrl).toBeDefined();
      expect(result.iconUrl).toBe(
        'https://assets.coingecko.com/coins/images/6319/large/usdc.png'
      );
      expect(result.entities.length).toBeGreaterThan(0);

      // Verify asset is in storage
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(result.id);
      expect(assets[0].iconUrl).toBeDefined();
      expect(assets[0].iconUrl).toBe(result.iconUrl);
    });

    test('adds multiple tokens successfully', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);
      const dai = await vault.addToken('DAI' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(3);
      expect(assets.some(a => a.id === usdc.id)).toBe(true);
      expect(assets.some(a => a.id === usdt.id)).toBe(true);
      expect(assets.some(a => a.id === dai.id)).toBe(true);
    });

    test('throws error when adding duplicate token', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      await expect(vault.addToken('USDC' as Symbol)).rejects.toThrow(
        `Asset ${usdc.id.toString()} is already tracked`
      );
    });

    test('throws error when adding unsupported token', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await expect(vault.addToken('INVALID' as Symbol)).rejects.toThrow(
        'Token INVALID not supported'
      );
    });

    test('persists tokens across LibQC instances', async () => {
      const storage = new MockStorage(new Map());
      const { vault: vault1 } = await createTestLibQC(storage);

      const usdc = await vault1.addToken('USDC' as Symbol);

      // Create new LibQC instance with same storage
      const vault2 = createBareTestLibQC(storage);
      await vault2.unlock(getTestPassword());
      const assets = await vault2.listAssets();

      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(usdc.id);
    });

    test('creates token with correct properties', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const token = await vault.addToken('USDC' as Symbol);

      expect(token.id).toBe('p11:usdc');
      expect(token.symbol).toBe('USDC');
      expect(token.decimals).toBe(6);
      expect(token.entities.length).toBeGreaterThan(0);
    });

    test('token persists in storage state', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      // Check state directly
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.assets).toBeDefined();
      expect(state.assets).toHaveLength(1);
      expect(state.assets![0].id).toBe(usdc.id);
      expect(state.assets![0].iconUrl).toBeDefined();
      expect(state.assets![0].iconUrl).toBe(usdc.iconUrl);
    });

    test('handles tokens with different decimals', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol); // 6 decimals
      await vault.addToken('DAI' as Symbol); // 18 decimals
      await vault.addToken('wBTC' as Symbol); // 8 decimals

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(3);
      expect(assets.find(a => a.symbol === 'USDC')?.decimals).toBe(6);
      expect(assets.find(a => a.symbol === 'DAI')?.decimals).toBe(18);
      expect(assets.find(a => a.symbol === 'wBTC')?.decimals).toBe(8);
    });

    test('token has aggregated entities for multiple chains', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      // USDC should have entities for both Ethereum and Base
      expect(usdc.entities.length).toBeGreaterThanOrEqual(2);
      const ethereumEntity = usdc.entities.find(
        entity => entity.assetType.chainId.toString() === 'eip155:1'
      );
      const baseEntity = usdc.entities.find(
        entity => entity.assetType.chainId.toString() === 'eip155:8453'
      );

      expect(ethereumEntity).toBeDefined();
      expect(baseEntity).toBeDefined();
    });
  });

  describe('listAssets', () => {
    test('returns empty array when no assets added', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const assets = await vault.listAssets();
      expect(assets).toEqual([]);
    });

    test('returns all added assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.some(a => a.id === usdc.id)).toBe(true);
      expect(assets.some(a => a.id === usdt.id)).toBe(true);
    });

    test('returns assets in order they were added', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);
      const dai = await vault.addToken('DAI' as Symbol);

      const assets = await vault.listAssets();
      expect(assets[0].id).toBe(usdc.id);
      expect(assets[1].id).toBe(usdt.id);
      expect(assets[2].id).toBe(dai.id);
    });

    test('returns empty array after storage is cleared', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);

      await storage.clear();

      const { vault: vault2 } = await createTestLibQC(storage);
      const assets = await vault2.listAssets();
      expect(assets).toEqual([]);
    });

    test('returns complete asset metadata', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);

      const assets = await vault.listAssets();
      expect(assets[0].id).toBe('p11:usdc');
      expect(assets[0].symbol).toBe('USDC');
      expect(assets[0].decimals).toBe(6);
      expect(assets[0].iconUrl).toBeDefined();
      expect(assets[0].iconUrl).toBe(
        'https://assets.coingecko.com/coins/images/6319/large/usdc.png'
      );
      expect(assets[0].entities.length).toBeGreaterThan(0);
    });
  });

  describe('removeToken', () => {
    test('removes a token successfully', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      await vault.removeToken(usdc);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(0);
    });

    test('removes correct token when multiple exist', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);
      const dai = await vault.addToken('DAI' as Symbol);

      await vault.removeToken(usdt);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.some(a => a.id === usdc.id)).toBe(true);
      expect(assets.some(a => a.id === dai.id)).toBe(true);
      expect(assets.some(a => a.id === usdt.id)).toBe(false);
    });

    test('throws error when removing non-tracked token', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      await expect(vault.removeToken(usdc!)).rejects.toThrow('is not tracked');
    });

    test('throws error when removing from empty asset list', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      await expect(vault.removeToken(usdc!)).rejects.toThrow('is not tracked');
    });

    test('asset lookups return isolated CAIP objects', () => {
      const first = getAssetBySymbol('USDC' as Symbol)!;
      const second = getAssetBySymbol('USDC' as Symbol)!;

      first.entities[0].assetType.chainId.reference = '999999';

      expect(second.entities[0].assetType.chainId.reference).not.toBe('999999');
    });

    test('can add token again after removing it', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      await vault.removeToken(usdc);

      const usdc2 = await vault.addToken('USDC' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(usdc2.id);
    });

    test('removal persists across LibQC instances', async () => {
      const storage = new MockStorage(new Map());
      const { vault: vault1 } = await createTestLibQC(storage);

      const usdc = await vault1.addToken('USDC' as Symbol);
      const usdt = await vault1.addToken('USDT' as Symbol);

      await vault1.removeToken(usdc);

      // Create new LibQC instance with same storage
      const vault2 = createBareTestLibQC(storage);
      await vault2.unlock(getTestPassword());
      const assets = await vault2.listAssets();

      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(usdt.id);
    });

    test('token removal persists in storage state', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);

      await vault.removeToken(usdc);

      // Check state directly
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.assets).toBeDefined();
      expect(state.assets).toHaveLength(1);
      expect(state.assets?.[0].id).toBe(usdt.id);
    });

    test('throws error when attempting to remove native asset for an account', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      // Generate mnemonic first
      await captureGeneratedMnemonic(vault);

      // Create an account - this automatically adds the native asset (ETH)
      await vault.createAccount(chainId);

      // Get the native asset
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      const nativeAsset = assets[0];
      expect(nativeAsset.symbol).toBe('ETH');

      // Attempt to remove the native asset should throw an error
      await expect(vault.removeToken(nativeAsset)).rejects.toThrow(
        'Cannot remove ETH as it is the native asset for an account'
      );

      // Verify the asset is still tracked
      const remainingAssets = await vault.listAssets();
      expect(remainingAssets).toHaveLength(1);
      expect(remainingAssets[0].id).toBe(nativeAsset.id);
    });
  });

  describe('Asset Management Integration', () => {
    test('manages tokens independently of accounts', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Add token before creating any accounts
      await vault.addToken('USDC' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(0);
    });

    test('tokens persist when mnemonic is generated', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      await captureGeneratedMnemonic(vault);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(usdc.id);
    });

    test('handles multiple token operations in sequence', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);
      const usdt = await vault.addToken('USDT' as Symbol);
      await vault.removeToken(usdc);
      const dai = await vault.addToken('DAI' as Symbol);
      const wbtc = await vault.addToken('wBTC' as Symbol);
      await vault.removeToken(dai);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.some(a => a.id === usdt.id)).toBe(true);
      expect(assets.some(a => a.id === wbtc.id)).toBe(true);
    });

    test('native assets are added automatically on account creation', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      // Generate mnemonic first
      await captureGeneratedMnemonic(vault);

      // Create an account - this should automatically add the native asset
      await vault.createAccount(chainId);

      const assets = await vault.listAssets();

      // Should have 1 asset (the native asset - ETH)
      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe('ETH');
      expect(assets[0].id).toBe('p11:eth');

      // Now manually add a token
      const usdc = await vault.addToken('USDC' as Symbol);

      const updatedAssets = await vault.listAssets();
      expect(updatedAssets).toHaveLength(2);
      expect(updatedAssets.some(a => a.symbol === 'ETH')).toBe(true);
      expect(updatedAssets.some(a => a.id === usdc.id)).toBe(true);
    });

    test('isAssetTracked returns true for tracked assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = await vault.addToken('USDC' as Symbol);

      const isTracked = await vault.isAssetTracked(usdc);
      expect(isTracked).toBe(true);
    });

    test('isAssetTracked returns false for untracked assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      const isTracked = await vault.isAssetTracked(usdc!);
      expect(isTracked).toBe(false);
    });
  });

  describe('getAssetBySymbol', () => {
    test('should be case-insensitive and match "Eth" to "ETH"', () => {
      const asset = getAssetBySymbol('Eth' as Symbol);
      expect(asset).toBeDefined();
      expect(asset?.symbol).toBe('ETH');
      expect(asset?.id).toBe('p11:eth');
    });

    test('should be case-insensitive and match "eth" to "ETH"', () => {
      const asset = getAssetBySymbol('eth' as Symbol);
      expect(asset).toBeDefined();
      expect(asset?.symbol).toBe('ETH');
      expect(asset?.id).toBe('p11:eth');
    });

    test('should be case-insensitive and match "Usdc" to "USDC"', () => {
      const asset = getAssetBySymbol('Usdc' as Symbol);
      expect(asset).toBeDefined();
      expect(asset?.symbol).toBe('USDC');
      expect(asset?.id).toBe('p11:usdc');
    });

    test('should still work with exact case match', () => {
      const asset = getAssetBySymbol('ETH' as Symbol);
      expect(asset).toBeDefined();
      expect(asset?.symbol).toBe('ETH');
      expect(asset?.iconUrl).toBeDefined();
      expect(asset?.iconUrl).toBe(
        'https://assets.coingecko.com/coins/images/279/large/ethereum.png'
      );
    });
  });

  describe('iconUrl field', () => {
    test('all assets from getSupportedAssets have iconUrl', () => {
      const storage = new MockStorage(new Map());
      const vault = createBareTestLibQC(storage);

      const assets = vault.getSupportedAssets();

      assets.forEach(asset => {
        expect(asset.iconUrl).toBeDefined();
        expect(typeof asset.iconUrl).toBe('string');
        expect(asset.iconUrl.length).toBeGreaterThan(0);
        expect(asset.iconUrl).toContain('http');
      });
    });
  });

  describe('isErc20Token', () => {
    test('returns true for ERC-20 token asset', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const erc20Asset: Asset = {
        id: 'p11:test-usdc' as AssetId,
        symbol: 'USDC' as Symbol,
        name: 'USD Coin' as AssetName,
        decimals: 6 as Decimals,
        iconUrl: 'https://example.com/usdc.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
              }
            }),
            decimals: 6 as Decimals,
            name: 'USD Coin' as AssetName,
            symbol: 'USDC' as Symbol
          }
        ]
      };

      expect(isErc20Token(erc20Asset, chainId)).toBe(true);
    });

    test('returns true for asset with multiple entities where at least one is ERC-20', () => {
      const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '8453' });
      const multiChainAsset: Asset = {
        id: 'p11:test-usdc' as AssetId,
        symbol: 'USDC' as Symbol,
        name: 'USD Coin' as AssetName,
        decimals: 6 as Decimals,
        iconUrl: 'https://example.com/usdc.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId1.namespace,
                reference: chainId1.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
              }
            }),
            decimals: 6 as Decimals,
            name: 'USD Coin' as AssetName,
            symbol: 'USDC' as Symbol
          },
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId2.namespace,
                reference: chainId2.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
              }
            }),
            decimals: 6 as Decimals,
            name: 'USD Coin' as AssetName,
            symbol: 'USDC' as Symbol
          }
        ]
      };

      // Should return true for chainId1 (Ethereum)
      expect(isErc20Token(multiChainAsset, chainId1)).toBe(true);
      // Should return true for chainId2 (Base)
      expect(isErc20Token(multiChainAsset, chainId2)).toBe(true);
    });

    test('returns chain-specific result - asset can be ERC-20 on one chain but not another', () => {
      const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '8453' });
      const mixedAsset: Asset = {
        id: 'p11:test-mixed' as AssetId,
        symbol: 'MIXED' as Symbol,
        name: 'Mixed Asset' as AssetName,
        decimals: 18 as Decimals,
        iconUrl: 'https://example.com/mixed.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId1.namespace,
                reference: chainId1.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Mixed Asset' as AssetName,
            symbol: 'MIXED' as Symbol
          },
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId2.namespace,
                reference: chainId2.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Mixed Asset' as AssetName,
            symbol: 'MIXED' as Symbol
          }
        ]
      };

      // Should return true for chainId1 (ERC-20 on Ethereum)
      expect(isErc20Token(mixedAsset, chainId1)).toBe(true);
      // Should return false for chainId2 (native asset on Base)
      expect(isErc20Token(mixedAsset, chainId2)).toBe(false);
    });

    test('returns false for native asset (slip44)', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const nativeAsset: Asset = {
        id: 'p11:eth' as AssetId,
        symbol: 'ETH' as Symbol,
        name: 'Ether' as AssetName,
        decimals: 18 as Decimals,
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Ether' as AssetName,
            symbol: 'ETH' as Symbol
          }
        ]
      };

      expect(isErc20Token(nativeAsset, chainId)).toBe(false);
    });

    test('returns false for non-ERC-20 token (e.g., ERC-721)', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const nftAsset: Asset = {
        id: 'p11:test-nft' as AssetId,
        symbol: 'NFT' as Symbol,
        name: 'NFT' as AssetName,
        decimals: 0 as Decimals,
        iconUrl: 'https://example.com/nft.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'erc721',
                reference: '0x1234567890123456789012345678901234567890'
              }
            }),
            decimals: 0 as Decimals,
            name: 'NFT' as AssetName,
            symbol: 'NFT' as Symbol
          }
        ]
      };

      expect(isErc20Token(nftAsset, chainId)).toBe(false);
    });

    test('returns false for asset with no entities', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const emptyAsset: Asset = {
        id: 'p11:test-empty' as AssetId,
        symbol: 'EMPTY' as Symbol,
        name: 'Empty Asset' as AssetName,
        decimals: 0 as Decimals,
        iconUrl: 'https://example.com/empty.png' as IconUrl,
        entities: []
      };

      expect(isErc20Token(emptyAsset, chainId)).toBe(false);
    });

    test('works with real USDC asset from getAssetBySymbol', () => {
      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      // USDC should be ERC-20 on Ethereum
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isErc20Token(usdc!, ethereumChainId)).toBe(true);

      // USDC should be ERC-20 on Base
      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      expect(isErc20Token(usdc!, baseChainId)).toBe(true);
    });

    test('works with real ETH asset from getAssetBySymbol', () => {
      const eth = getAssetBySymbol('ETH' as Symbol);
      expect(eth).toBeDefined();

      // ETH is a native asset, not ERC-20 on any chain
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isErc20Token(eth!, ethereumChainId)).toBe(false);

      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      expect(isErc20Token(eth!, baseChainId)).toBe(false);
    });
  });

  describe('isNativeAsset', () => {
    test('returns true for native asset (slip44)', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const nativeAsset: Asset = {
        id: 'p11:eth' as AssetId,
        symbol: 'ETH' as Symbol,
        name: 'Ether' as AssetName,
        decimals: 18 as Decimals,
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Ether' as AssetName,
            symbol: 'ETH' as Symbol
          }
        ]
      };

      expect(isNativeAsset(nativeAsset, chainId)).toBe(true);
    });

    test('returns true for asset with multiple entities where at least one is native', () => {
      const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '8453' });
      const multiChainAsset: Asset = {
        id: 'p11:eth' as AssetId,
        symbol: 'ETH' as Symbol,
        name: 'Ethereum' as AssetName,
        decimals: 18 as Decimals,
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId1.namespace,
                reference: chainId1.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Ethereum' as AssetName,
            symbol: 'ETH' as Symbol
          },
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId2.namespace,
                reference: chainId2.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Ethereum' as AssetName,
            symbol: 'ETH' as Symbol
          }
        ]
      };

      // Should return true for chainId1 (Ethereum)
      expect(isNativeAsset(multiChainAsset, chainId1)).toBe(true);
      // Should return true for chainId2 (Base)
      expect(isNativeAsset(multiChainAsset, chainId2)).toBe(true);
    });

    test('returns chain-specific result - asset can be native on one chain but not another', () => {
      const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '8453' });
      const mixedAsset: Asset = {
        id: 'p11:test-mixed' as AssetId,
        symbol: 'MIXED' as Symbol,
        name: 'Mixed Asset' as AssetName,
        decimals: 18 as Decimals,
        iconUrl: 'https://example.com/mixed.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId1.namespace,
                reference: chainId1.reference
              },
              assetName: {
                namespace: 'slip44',
                reference: '60'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Mixed Native' as AssetName,
            symbol: 'MIXED' as Symbol
          },
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId2.namespace,
                reference: chainId2.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0x1234567890123456789012345678901234567890'
              }
            }),
            decimals: 18 as Decimals,
            name: 'Mixed Token' as AssetName,
            symbol: 'MIXED' as Symbol
          }
        ]
      };

      // Should return true for chainId1 (native on Ethereum)
      expect(isNativeAsset(mixedAsset, chainId1)).toBe(true);
      // Should return false for chainId2 (ERC-20 on Base)
      expect(isNativeAsset(mixedAsset, chainId2)).toBe(false);
    });

    test('returns false for ERC-20 token', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const erc20Asset: Asset = {
        id: 'p11:usdc' as AssetId,
        symbol: 'USDC' as Symbol,
        name: 'USD Coin' as AssetName,
        decimals: 6 as Decimals,
        iconUrl: 'https://example.com/usdc.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'erc20',
                reference: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
              }
            }),
            decimals: 6 as Decimals,
            name: 'USD Coin' as AssetName,
            symbol: 'USDC' as Symbol
          }
        ]
      };

      expect(isNativeAsset(erc20Asset, chainId)).toBe(false);
    });

    test('returns false for non-native token (e.g., ERC-721)', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const nftAsset: Asset = {
        id: 'p11:test-nft' as AssetId,
        symbol: 'NFT' as Symbol,
        name: 'NFT' as AssetName,
        decimals: 0 as Decimals,
        iconUrl: 'https://example.com/nft.png' as IconUrl,
        entities: [
          {
            assetType: new AssetType({
              chainId: {
                namespace: chainId.namespace,
                reference: chainId.reference
              },
              assetName: {
                namespace: 'erc721',
                reference: '0x1234567890123456789012345678901234567890'
              }
            }),
            decimals: 0 as Decimals,
            name: 'NFT' as AssetName,
            symbol: 'NFT' as Symbol
          }
        ]
      };

      expect(isNativeAsset(nftAsset, chainId)).toBe(false);
    });

    test('returns false for asset with no entities', () => {
      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const emptyAsset: Asset = {
        id: 'p11:test-empty' as AssetId,
        symbol: 'EMPTY' as Symbol,
        name: 'Empty Asset' as AssetName,
        decimals: 0 as Decimals,
        iconUrl: 'https://example.com/empty.png' as IconUrl,
        entities: []
      };

      expect(isNativeAsset(emptyAsset, chainId)).toBe(false);
    });

    test('works with real ETH asset from getAssetBySymbol', () => {
      const eth = getAssetBySymbol('ETH' as Symbol);
      expect(eth).toBeDefined();

      // ETH is a native asset on Ethereum
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isNativeAsset(eth!, ethereumChainId)).toBe(true);

      // ETH is also a native asset on Base
      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      expect(isNativeAsset(eth!, baseChainId)).toBe(true);
    });

    test('works with real USDC asset from getAssetBySymbol', () => {
      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      // USDC is an ERC-20 token, not a native asset on any chain
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      expect(isNativeAsset(usdc!, ethereumChainId)).toBe(false);

      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      expect(isNativeAsset(usdc!, baseChainId)).toBe(false);
    });
  });

  describe('getSupportedAssets', () => {
    test('returns all supported assets when no filter provided', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const assets = vault.getSupportedAssets();

      // Should return all assets from assets.json
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.some(a => a.symbol === 'ETH')).toBe(true);
      expect(assets.some(a => a.symbol === 'USDC')).toBe(true);
      expect(assets.some(a => a.symbol === 'USDT')).toBe(true);
      assets.forEach(asset => {
        expect(asset.iconUrl).toBeDefined();
        expect(typeof asset.iconUrl).toBe('string');
        expect(asset.iconUrl).toContain('http');
      });
    });

    test('returns only assets available on specified chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const assets = vault.getSupportedAssets(ethereumChainId);

      // All returned assets should have at least one entity for Ethereum
      expect(assets.length).toBeGreaterThan(0);
      assets.forEach(asset => {
        const hasEthereumEntity = asset.entities.some(
          entity =>
            entity.assetType.chainId.toString() === ethereumChainId.toString()
        );
        expect(hasEthereumEntity).toBe(true);
      });
    });

    test('filtered assets maintain all entities, not just filtered chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const assets = vault.getSupportedAssets(ethereumChainId);

      // Find USDC which exists on multiple chains
      const usdc = assets.find(a => a.symbol === 'USDC');
      expect(usdc).toBeDefined();

      // Should have entities for both Ethereum and Base
      expect(usdc!.entities.length).toBeGreaterThanOrEqual(2);
      const hasEthereum = usdc!.entities.some(
        e => e.assetType.chainId.toString() === 'eip155:1'
      );
      const hasBase = usdc!.entities.some(
        e => e.assetType.chainId.toString() === 'eip155:8453'
      );
      expect(hasEthereum).toBe(true);
      expect(hasBase).toBe(true);
    });

    test('returns empty array for chain with no assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      // Use a chain ID that doesn't exist in assets.json
      const unknownChainId = new ChainId({
        namespace: 'eip155',
        reference: '999999'
      });

      const assets = vault.getSupportedAssets(unknownChainId);

      expect(assets).toEqual([]);
    });

    test('returns same results for different LibQC instances', async () => {
      const storage1 = new MockStorage(new Map());
      const storage2 = new MockStorage(new Map());
      const { vault: vault1 } = await createTestLibQC(storage1);
      const { vault: vault2 } = await createTestLibQC(storage2);

      const assets1 = vault1.getSupportedAssets();
      const assets2 = vault2.getSupportedAssets();

      expect(assets1.length).toBe(assets2.length);
      expect(assets1.map(a => a.id).sort()).toEqual(
        assets2.map(a => a.id).sort()
      );
    });

    test('returns assets for Base chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      const assets = vault.getSupportedAssets(baseChainId);

      // Should include common assets on Base
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.some(a => a.symbol === 'ETH')).toBe(true);
      expect(assets.some(a => a.symbol === 'USDC')).toBe(true);
    });
  });

  describe('getSupportedChains', () => {
    test('returns @project-eleven/libqc defined chains', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const supportedChains = vault.getSupportedChains();

      // libqc defines its own chains (Ethereum, Base, and Bitcoin)
      expect(supportedChains.length).toBe(3);
      expect(supportedChains.some(c => c.id === 1)).toBe(true); // Ethereum
      expect(supportedChains.some(c => c.id === 8453)).toBe(true); // Base
    });

    test('returned chains have correct structure', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();

      expect(chains.length).toBeGreaterThan(0);
      chains.forEach(chain => {
        expect(chain).toHaveProperty('id');
        expect(chain).toHaveProperty('chainId');
        expect(chain).toHaveProperty('name');
        expect(chain).toHaveProperty('network');
        expect(chain).toHaveProperty('nativeCurrency');
        expect(chain).toHaveProperty('testnet');
        expect(chain).toHaveProperty('rpcUrls');
        expect(chain.nativeCurrency).toHaveProperty('decimals');
        expect(chain.nativeCurrency).toHaveProperty('name');
        expect(chain.nativeCurrency).toHaveProperty('symbol');
      });
    });

    test('returns consistent results across calls', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains1 = vault.getSupportedChains();
      const chains2 = vault.getSupportedChains();

      expect(chains1).toEqual(chains2);
    });

    test('does not return empty array', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();

      expect(chains.length).toBeGreaterThan(0);
    });

    test('chains include Base chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();

      const baseChain = chains.find(c => c.id === 8453);
      expect(baseChain).toBeDefined();
      expect(baseChain?.chainId.toString()).toBe('eip155:8453');
    });

    test('chains include Ethereum chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();

      const ethChain = chains.find(c => c.id === 1);
      expect(ethChain).toBeDefined();
      expect(ethChain?.chainId.toString()).toBe('eip155:1');
    });
  });

  describe('getSupportedAssets and getSupportedChains', () => {
    test('EVM assets have entities for supported EVM chains', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();
      const assets = vault.getSupportedAssets();

      // Each asset with eip155 entities should have at least one entity for a supported chain.
      // Assets like BTC (bip122 only) are excluded when vault is configured for EVM only.
      const evmAssets = assets.filter(asset =>
        asset.entities.some(e => e.assetType.chainId.namespace === 'eip155')
      );
      evmAssets.forEach(asset => {
        const hasEntityForSupportedChain = asset.entities.some(entity =>
          chains.some(
            chain =>
              chain.chainId.toString() === entity.assetType.chainId.toString()
          )
        );
        expect(hasEntityForSupportedChain).toBe(true);
      });
    });

    test('filtering by each supported chain returns non-empty results for native assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chains = vault.getSupportedChains();

      // Filter to only test chains that have assets in assets.json (Ethereum mainnet and Base)
      const chainsWithAssets = chains.filter(
        c =>
          c.chainId.toString() === 'eip155:1' ||
          c.chainId.toString() === 'eip155:8453'
      );

      chainsWithAssets.forEach(chain => {
        const assets = vault.getSupportedAssets(chain.chainId);
        // Each chain should have at least the native asset
        expect(assets.length).toBeGreaterThan(0);
        // Should have native ETH for EVM chains
        const hasNativeAsset = assets.some(
          a => a.symbol === chain.nativeCurrency.symbol
        );
        expect(hasNativeAsset).toBe(true);
      });
    });
  });
});
