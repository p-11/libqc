import { AccountId, AssetType, ChainId } from 'caip';
import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Main entry point exports
import {
  type Address,
  type Asset,
  type AssetId,
  type AssetName,
  type BalanceBigInt,
  type BundlerConfig,
  type Decimals,
  type LibQCStorage,
  type Symbol,
  IconUrl
} from '../../src';

// Internal imports (not exported from main entry point)
import { EvmAccountClient } from '../../src/account';
import type { VaultEncryptionKeyWithMetadata } from '../../src/cryptography';
import {
  AssetEntityNotFoundError,
  InvalidAssetMetadataError,
  NonErc20TokenBalanceError,
  OnChainDecimalsMismatchError
} from '../../src/errors';
import { getLibQCState, PersistedAccount } from '../../src/state';
import { createMultiChainTestAsset, createTestAsset } from '../testUtils';

const MOCK_ENCRYPTION_KEY = {} as VaultEncryptionKeyWithMetadata;

// Mock the activities module
vi.mock('../../src/activities', async () => {
  const actual = await vi.importActual('../../src/activities');
  return {
    ...actual,
    getActivities: vi.fn()
  };
});

// Mock the bundler module
vi.mock('../../src/bundler', () => ({
  getBundlerClient: vi.fn()
}));

// Mock the publicReads module
vi.mock('../../src/publicReads', () => ({
  getNativeBalance: vi.fn(),
  getErc20TokenBalanceByChain: vi.fn()
}));

// Mock the account evm modules
vi.mock('../../src/account/evm/authorized', () => ({
  getAuthorizedAccount: vi.fn()
}));

vi.mock('../../src/account/evm/readOnly', () => ({
  getReadOnlyAccount: vi.fn()
}));

vi.mock('../../src/account/evm/config', async () => {
  const actual = await vi.importActual('../../src/account/evm/config');
  return {
    ...actual,
    getAccountConfig: vi.fn()
  };
});

// Mock getLibQCState so the encrypted vault can be bypassed in unit tests
vi.mock('../../src/state', async () => {
  const actual = await vi.importActual('../../src/state');
  return {
    ...actual,
    getLibQCState: vi.fn()
  };
});

// P11TODO: Add unit tests for EvmAccountClient methods:
// - sendTransfer
// - getTransferGasCostEstimate
// - registerDomainName (should also test ATLAS_SUPPORTED_CHAINS validation)
// - registerAssetRecord (should also test ATLAS_SUPPORTED_CHAINS validation)
describe('EvmAccountClient - getBalance', () => {
  let mockStorage: LibQCStorage;
  let mockPublicClient: PublicClient;
  let mockBundlerConfig: BundlerConfig;
  let testAccount: PersistedAccount;
  let accountClient: EvmAccountClient;

  const testAddress = '0x1234567890123456789012345678901234567890' as Address;
  const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      clear: vi.fn()
    } as unknown as LibQCStorage;

    mockPublicClient = {
      chain: {
        id: 1,
        name: 'Ethereum',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }
      }
    } as PublicClient;

    mockBundlerConfig = {
      chain: { id: 1, name: 'Ethereum' } as any,
      urls: ['https://bundler.example.com'] as any,
      headers: {}
    };

    testAccount = {
      id: new AccountId({
        chainId: testChainId,
        address: testAddress
      }),
      address: testAddress,
      chainId: testChainId
    };

    accountClient = new EvmAccountClient(
      testAccount,
      mockStorage,
      MOCK_ENCRYPTION_KEY,
      mockPublicClient,
      mockBundlerConfig
    );
  });

  it('calls getNativeBalance for native asset', async () => {
    const { getNativeBalance } = await import('../../src/publicReads');
    const { getNativeAsset } = await import('../../src/assets');

    // Use the actual native asset from the chain, not a test asset
    const nativeAsset = getNativeAsset(mockPublicClient.chain!);

    const mockBalanceResult = {
      balance: 1000000000000000000n as BalanceBigInt, // 1 ETH
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    };

    vi.mocked(getNativeBalance).mockResolvedValue(mockBalanceResult);

    const result = await accountClient.getBalance(nativeAsset);

    expect(getNativeBalance).toHaveBeenCalledWith(
      mockPublicClient,
      testAccount.id
    );
    expect(result).toEqual(mockBalanceResult);
  });

  it('throws OnChainDecimalsMismatchError for native asset with mismatched entity decimals', async () => {
    const { getNativeBalance } = await import('../../src/publicReads');
    const { getNativeAsset } = await import('../../src/assets');

    const realNative = getNativeAsset(mockPublicClient.chain!);
    // Build a native asset whose entity decimals (8) differ from
    // what viem's chain reports (18).
    const mismatchedNative = createMultiChainTestAsset({
      id: realNative.id,
      symbol: 'ETH',
      decimals: 18,
      entities: [
        {
          chainId: testChainId,
          address: '0x0',
          decimals: 8,
          isNative: true
        }
      ]
    });

    vi.mocked(getNativeBalance).mockResolvedValue({
      balance: 1000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    });

    await expect(accountClient.getBalance(mismatchedNative)).rejects.toThrow(
      OnChainDecimalsMismatchError
    );
  });

  it('throws AssetEntityNotFoundError for native asset with no entity on this chain', async () => {
    const { getNativeAsset } = await import('../../src/assets');

    const realNative = getNativeAsset(mockPublicClient.chain!);
    // Native asset that has no entity for the test chain
    const noEntityNative = createMultiChainTestAsset({
      id: realNative.id,
      symbol: 'ETH',
      decimals: 18,
      entities: [
        {
          chainId: new ChainId({
            namespace: 'eip155',
            reference: '999999'
          }),
          address: '0x0',
          decimals: 18,
          isNative: true
        }
      ]
    });

    await expect(accountClient.getBalance(noEntityNative)).rejects.toThrow(
      AssetEntityNotFoundError
    );
  });

  it('calls getErc20TokenBalanceByChain for ERC-20 token asset', async () => {
    const { getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const tokenAddress = '0xToken1234567890123456789012345678901234' as Address;
    const tokenAsset = createTestAsset(
      testChainId,
      tokenAddress,
      'USDC',
      6,
      false
    );

    const mockBalanceResult = {
      balance: 1000000n as BalanceBigInt, // 1 USDC (6 decimals)
      decimals: 6 as Decimals,
      symbol: 'USDC' as Symbol
    };

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue(mockBalanceResult);

    const result = await accountClient.getBalance(tokenAsset);

    // Address is normalized to lowercase in the aggregated entity
    const normalizedAddress = tokenAddress.toLowerCase() as Address;
    expect(getErc20TokenBalanceByChain).toHaveBeenCalledWith(
      mockPublicClient,
      testAccount.id,
      normalizedAddress
    );
    expect(result).toEqual(mockBalanceResult);
  });

  it('throws OnChainDecimalsMismatchError when on-chain decimals differ from entity', async () => {
    const { getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const tokenAddress =
      '0x1111111111111111111111111111111111111111' as Address;
    // Entity decimals (18) differ from on-chain decimals (6)
    const tokenAsset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: testChainId,
          address: tokenAddress,
          decimals: 18
        }
      ]
    });

    // On-chain contract reports 6 decimals
    const onChainResult = {
      balance: 1000000n as BalanceBigInt,
      decimals: 6 as Decimals,
      symbol: 'USDC' as Symbol
    };

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue(onChainResult);

    await expect(accountClient.getBalance(tokenAsset)).rejects.toThrow(
      OnChainDecimalsMismatchError
    );
  });

  it('returns balance when on-chain decimals match entity decimals', async () => {
    const { getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const tokenAddress =
      '0x1111111111111111111111111111111111111111' as Address;
    const tokenAsset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: testChainId,
          address: tokenAddress,
          decimals: 6
        }
      ]
    });

    const onChainResult = {
      balance: 1000000n as BalanceBigInt,
      decimals: 6 as Decimals,
      symbol: 'USDC' as Symbol
    };

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue(onChainResult);

    const result = await accountClient.getBalance(tokenAsset);

    expect(result.decimals).toBe(6);
    expect(result.balance).toBe(1000000n);
  });

  it('throws InvalidAssetMetadataError when on-chain symbol differs from entity', async () => {
    const { getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const tokenAddress =
      '0x1111111111111111111111111111111111111111' as Address;
    const tokenAsset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: testChainId,
          address: tokenAddress,
          decimals: 6
        }
      ]
    });

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue({
      balance: 1000000n as BalanceBigInt,
      decimals: 6 as Decimals,
      symbol: 'FAKE' as Symbol
    });

    await expect(accountClient.getBalance(tokenAsset)).rejects.toThrow(
      InvalidAssetMetadataError
    );
  });

  it('accepts on-chain symbol differences that are only casing', async () => {
    const { getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const tokenAddress =
      '0x1111111111111111111111111111111111111111' as Address;
    const tokenAsset = createMultiChainTestAsset({
      symbol: 'wETH',
      decimals: 18,
      entities: [
        {
          chainId: testChainId,
          address: tokenAddress,
          decimals: 18
        }
      ]
    });

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue({
      balance: 1000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'WETH' as Symbol
    });

    const result = await accountClient.getBalance(tokenAsset);

    expect(result.symbol).toBe('WETH');
    expect(result.decimals).toBe(18);
  });

  it('throws error when getting balance of non-ERC-20 token', async () => {
    const tokenAddress = '0xToken1234567890123456789012345678901234' as Address;

    // Create an asset with a non-ERC-20 namespace (e.g., ERC-721)
    const nonErc20Asset: Asset = {
      id: 'p11:test-nft-1' as AssetId,
      symbol: 'NFT' as Symbol,
      name: 'NFT' as AssetName,
      decimals: 0 as Decimals,
      iconUrl: 'https://example.com/nft.png' as IconUrl,
      entities: [
        {
          assetType: new AssetType({
            chainId: {
              namespace: testChainId.namespace,
              reference: testChainId.reference
            },
            assetName: {
              namespace: 'erc721', // Non-ERC-20 namespace
              reference: tokenAddress.toLowerCase()
            }
          }),
          decimals: 0 as Decimals,
          name: 'NFT' as AssetName,
          symbol: 'NFT' as Symbol
        }
      ]
    };

    await expect(accountClient.getBalance(nonErc20Asset)).rejects.toThrow(
      NonErc20TokenBalanceError
    );
  });
});

describe('EvmAccountClient - getBalances', () => {
  let mockStorage: LibQCStorage;
  let mockPublicClient: PublicClient;
  let mockBundlerConfig: BundlerConfig;
  let testAccount: PersistedAccount;
  let accountClient: EvmAccountClient;

  const testAddress = '0x1234567890123456789012345678901234567890' as Address;
  const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      clear: vi.fn()
    } as unknown as LibQCStorage;

    mockPublicClient = {
      chain: {
        id: 1,
        name: 'Ethereum',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }
      }
    } as PublicClient;

    mockBundlerConfig = {
      chain: { id: 1, name: 'Ethereum' } as any,
      urls: ['https://bundler.example.com'] as any,
      headers: {}
    };

    testAccount = {
      id: new AccountId({
        chainId: testChainId,
        address: testAddress
      }),
      address: testAddress,
      chainId: testChainId
    };

    accountClient = new EvmAccountClient(
      testAccount,
      mockStorage,
      MOCK_ENCRYPTION_KEY,
      mockPublicClient,
      mockBundlerConfig
    );
  });

  it('calls getBalance for each asset in the array', async () => {
    const { getNativeBalance, getErc20TokenBalanceByChain } = await import(
      '../../src/publicReads'
    );
    const { getNativeAsset } = await import('../../src/assets');

    // Use the actual native asset from the chain, not a test asset
    const nativeAsset = getNativeAsset(mockPublicClient.chain!);

    const tokenAddress1 =
      '0xToken1234567890123456789012345678901234' as Address;
    const tokenAsset1 = createTestAsset(
      testChainId,
      tokenAddress1,
      'USDC',
      6,
      false
    );

    const tokenAddress2 =
      '0xToken5678901234567890123456789012345678' as Address;
    const tokenAsset2 = createTestAsset(
      testChainId,
      tokenAddress2,
      'DAI',
      18,
      false
    );

    const mockNativeBalance = {
      balance: 1000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    };

    const mockTokenBalance1 = {
      balance: 1000000n as BalanceBigInt,
      decimals: 6 as Decimals,
      symbol: 'USDC' as Symbol
    };

    const mockTokenBalance2 = {
      balance: 2000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'DAI' as Symbol
    };

    vi.mocked(getNativeBalance).mockResolvedValue(mockNativeBalance);
    vi.mocked(getErc20TokenBalanceByChain)
      .mockResolvedValueOnce(mockTokenBalance1)
      .mockResolvedValueOnce(mockTokenBalance2);

    const assets = [nativeAsset, tokenAsset1, tokenAsset2];
    const result = await accountClient.getBalances(assets);

    expect(getNativeBalance).toHaveBeenCalledTimes(1);
    expect(getNativeBalance).toHaveBeenCalledWith(
      mockPublicClient,
      testAccount.id
    );
    expect(getErc20TokenBalanceByChain).toHaveBeenCalledTimes(2);
    // Addresses are normalized to lowercase in aggregated entities
    expect(getErc20TokenBalanceByChain).toHaveBeenCalledWith(
      mockPublicClient,
      testAccount.id,
      tokenAddress1.toLowerCase() as Address
    );
    expect(getErc20TokenBalanceByChain).toHaveBeenCalledWith(
      mockPublicClient,
      testAccount.id,
      tokenAddress2.toLowerCase() as Address
    );
    expect(result).toEqual([
      mockNativeBalance,
      mockTokenBalance1,
      mockTokenBalance2
    ]);
  });

  it('handles empty assets array', async () => {
    const result = await accountClient.getBalances([]);

    expect(result).toEqual([]);
  });

  it('handles multiple native assets', async () => {
    const { getNativeBalance } = await import('../../src/publicReads');
    const { getNativeAsset } = await import('../../src/assets');

    // Use the actual native asset from the chain for both
    const nativeAsset = getNativeAsset(mockPublicClient.chain!);
    const nativeAsset1 = nativeAsset;
    const nativeAsset2 = nativeAsset;

    const mockBalance1 = {
      balance: 1000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    };

    const mockBalance2 = {
      balance: 2000000000000000000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    };

    vi.mocked(getNativeBalance)
      .mockResolvedValueOnce(mockBalance1)
      .mockResolvedValueOnce(mockBalance2);

    const result = await accountClient.getBalances([
      nativeAsset1,
      nativeAsset2
    ]);

    expect(getNativeBalance).toHaveBeenCalledTimes(2);
    expect(result).toEqual([mockBalance1, mockBalance2]);
  });
});

describe('EvmAccountClient - listAssets', () => {
  let mockStorage: LibQCStorage;
  let mockPublicClient: PublicClient;
  let mockBundlerConfig: BundlerConfig;
  let testAccount: PersistedAccount;
  let accountClient: EvmAccountClient;

  const testAddress = '0x1234567890123456789012345678901234567890' as Address;
  const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });
  const baseChainId = new ChainId({ namespace: 'eip155', reference: '8453' });

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      clear: vi.fn()
    } as unknown as LibQCStorage;

    mockPublicClient = {
      chain: { id: 1, name: 'Ethereum' }
    } as PublicClient;

    mockBundlerConfig = {
      chain: { id: 1, name: 'Ethereum' } as any,
      urls: ['https://bundler.example.com'] as any,
      headers: {}
    };

    testAccount = {
      id: new AccountId({
        chainId: testChainId,
        address: testAddress
      }),
      address: testAddress,
      chainId: testChainId
    };

    accountClient = new EvmAccountClient(
      testAccount,
      mockStorage,
      MOCK_ENCRYPTION_KEY,
      mockPublicClient,
      mockBundlerConfig
    );
  });

  it('returns assets that have entities on the account chain', async () => {
    // Create assets with entities on different chains
    const usdcAsset = createTestAsset(
      testChainId,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'USDC',
      6
    );
    const ethAsset = createTestAsset(testChainId, '0x0', 'ETH', 18, true);

    vi.mocked(getLibQCState).mockResolvedValue({
      addresses: [],
      assets: [usdcAsset, ethAsset]
    });

    const result = await accountClient.listAssets();

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(usdcAsset);
    expect(result).toContainEqual(ethAsset);
  });

  it('filters out assets that do not have entities on the account chain', async () => {
    // Create assets on Ethereum (chain 1) and Base (chain 8453)
    const ethAsset = createTestAsset(testChainId, '0x0', 'ETH', 18, true);
    const baseAsset = createTestAsset(baseChainId, '0x0', 'ETH', 18, true);

    vi.mocked(getLibQCState).mockResolvedValue({
      addresses: [],
      assets: [ethAsset, baseAsset]
    });

    const result = await accountClient.listAssets();

    // Only ETH asset on Ethereum chain should be returned
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(ethAsset);
    expect(result).not.toContainEqual(baseAsset);
  });

  it('returns empty array when no assets are in state', async () => {
    vi.mocked(getLibQCState).mockResolvedValue({
      addresses: [],
      assets: []
    });

    const result = await accountClient.listAssets();

    expect(result).toEqual([]);
  });

  it('returns empty array when state has no assets property', async () => {
    vi.mocked(getLibQCState).mockResolvedValue({
      addresses: []
    });

    const result = await accountClient.listAssets();

    expect(result).toEqual([]);
  });

  it('returns empty array when no assets match the account chain', async () => {
    // Create assets only on Base chain
    const baseAsset1 = createTestAsset(baseChainId, '0x0', 'ETH', 18, true);
    const baseAsset2 = createTestAsset(
      baseChainId,
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'USDC',
      6
    );

    vi.mocked(getLibQCState).mockResolvedValue({
      addresses: [],
      assets: [baseAsset1, baseAsset2]
    });

    const result = await accountClient.listAssets();

    expect(result).toEqual([]);
  });
});

describe('EvmAccountClient - private key zeroing in failure paths', () => {
  let mockStorage: LibQCStorage;
  let mockPublicClient: PublicClient;
  let mockBundlerConfig: BundlerConfig;
  let testAccount: PersistedAccount;
  let accountClient: EvmAccountClient;

  const testAddress = '0x1234567890123456789012345678901234567890' as Address;
  const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      clear: vi.fn()
    } as unknown as LibQCStorage;

    mockPublicClient = {
      chain: {
        id: 1,
        name: 'Ethereum',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }
      }
    } as PublicClient;

    mockBundlerConfig = {
      chain: { id: 1, name: 'Ethereum' } as any,
      urls: ['https://bundler.example.com'] as any,
      headers: {}
    };

    testAccount = {
      id: new AccountId({
        chainId: testChainId,
        address: testAddress
      }),
      address: testAddress,
      chainId: testChainId
    };

    accountClient = new EvmAccountClient(
      testAccount,
      mockStorage,
      MOCK_ENCRYPTION_KEY,
      mockPublicClient,
      mockBundlerConfig
    );
  });

  it('zeroes persistedAddress private key when getTransferGasCostEstimate fails before account creation', async () => {
    const canary = new Uint8Array(32).fill(0xd1);
    const persistedAddress = {
      chainType: 'evm',
      address: testAddress,
      index: 0,
      secp256k1PrivateKey: canary,
      secp256k1PublicKeyHash: testAddress,
      accounts: [],
      version: 'V1'
    } as any;

    vi.spyOn(
      accountClient as any,
      'getPersistedAddressFromAccount'
    ).mockResolvedValue(persistedAddress);
    vi.spyOn(accountClient, 'getConfig').mockRejectedValue(
      new Error('forced getConfig failure')
    );

    await expect(
      accountClient.getTransferGasCostEstimate(1n as any, testAddress as any)
    ).rejects.toThrow('forced getConfig failure');

    expect(Array.from(canary).every(byte => byte === 0)).toBe(true);
  });

  it('zeroes persistedAddress private key when sendTransfer fails before authorized account creation', async () => {
    const canary = new Uint8Array(32).fill(0xd2);
    const persistedAddress = {
      chainType: 'evm',
      address: testAddress,
      index: 0,
      secp256k1PrivateKey: canary,
      secp256k1PublicKeyHash: testAddress,
      accounts: [],
      version: 'V1'
    } as any;

    vi.spyOn(
      accountClient as any,
      'getPersistedAddressFromAccount'
    ).mockResolvedValue(persistedAddress);
    vi.spyOn(accountClient, 'getConfig').mockRejectedValue(
      new Error('forced getConfig failure')
    );

    await expect(
      (accountClient as any).sendTransfer(1n, testAddress)
    ).rejects.toThrow('forced getConfig failure');

    expect(Array.from(canary).every(byte => byte === 0)).toBe(true);
  });
});
