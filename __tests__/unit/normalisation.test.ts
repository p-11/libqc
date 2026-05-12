import { AccountId, ChainId } from 'caip';
import { describe, expect, test, vi } from 'vitest';

import {
  type Address,
  type Asset,
  type AssetId,
  type AssetName,
  type BalanceBigInt,
  type Decimals,
  type Symbol,
  InvalidAssetDecimalsError,
  InvalidAssetMetadataError,
  normaliseBalance,
  validateAssetDecimals,
  validateAssetMetadata
} from '../../src';

import {
  captureGeneratedMnemonic,
  createMultiChainTestAsset,
  createTestLibQC,
  MockStorage
} from '../testUtils';

// Mock the publicReads module so EvmAccountClient.getBalance does not
// attempt real RPC calls. The wiring tests below drive these mocks
// per-account to verify cross-chain aggregation in LibQC.getTotalBalances.
vi.mock('../../src/publicReads', () => ({
  getNativeBalance: vi.fn(),
  getErc20TokenBalanceByChain: vi.fn()
}));

import {
  getErc20TokenBalanceByChain,
  getNativeBalance
} from '../../src/publicReads';

// ---------------------------------------------------------------------------
// normaliseBalance
// ---------------------------------------------------------------------------
describe('normaliseBalance', () => {
  test('returns the same value when decimals are equal', () => {
    const amount = 1_000_000n as BalanceBigInt;
    const result = normaliseBalance(amount, 6 as Decimals, 6 as Decimals);
    expect(result).toBe(amount);
  });

  test('scales up when target > source (6 -> 18)', () => {
    const result = normaliseBalance(
      1_000_000n as BalanceBigInt,
      6 as Decimals,
      18 as Decimals
    );
    expect(result).toBe(1_000_000_000_000_000_000n);
  });

  test('scales down when target < source (18 -> 6)', () => {
    const result = normaliseBalance(
      1_000_000_000_000_000_000n as BalanceBigInt,
      18 as Decimals,
      6 as Decimals
    );
    expect(result).toBe(1_000_000n);
  });

  test('truncates toward zero when scaling down', () => {
    // 1.5 token at 18 decimals -> 6 decimals = 1_500_000 (floor)
    const result = normaliseBalance(
      1_500_000_000_000_000_000n as BalanceBigInt,
      18 as Decimals,
      6 as Decimals
    );
    expect(result).toBe(1_500_000n);
  });

  test('truncates sub-unit remainder when scaling down', () => {
    // 1.000000000000000001 at 18 decimals -> 6 decimals = 1_000_000
    const result = normaliseBalance(
      1_000_000_000_000_000_001n as BalanceBigInt,
      18 as Decimals,
      6 as Decimals
    );
    expect(result).toBe(1_000_000n);
  });

  test('returns zero for zero balance regardless of decimals', () => {
    expect(
      normaliseBalance(0n as BalanceBigInt, 6 as Decimals, 18 as Decimals)
    ).toBe(0n);
    expect(
      normaliseBalance(0n as BalanceBigInt, 18 as Decimals, 6 as Decimals)
    ).toBe(0n);
  });

  test('handles large values correctly', () => {
    // 1 billion tokens at 18 decimals
    const amount = 1_000_000_000_000_000_000_000_000_000n as BalanceBigInt;
    const result = normaliseBalance(amount, 18 as Decimals, 6 as Decimals);
    expect(result).toBe(1_000_000_000_000_000n);
  });

  test('scales between arbitrary decimal pairs (8 -> 6)', () => {
    // 1 WBTC at 8 decimals -> 6 decimals
    const result = normaliseBalance(
      100_000_000n as BalanceBigInt,
      8 as Decimals,
      6 as Decimals
    );
    expect(result).toBe(1_000_000n);
  });

  test('scales between arbitrary decimal pairs (6 -> 8)', () => {
    const result = normaliseBalance(
      1_000_000n as BalanceBigInt,
      6 as Decimals,
      8 as Decimals
    );
    expect(result).toBe(100_000_000n);
  });

  test('handles zero-decimal source (0 -> 6)', () => {
    // 5 whole tokens at 0 decimals -> 6 decimals
    const result = normaliseBalance(
      5n as BalanceBigInt,
      0 as Decimals,
      6 as Decimals
    );
    expect(result).toBe(5_000_000n);
  });

  test('handles zero-decimal target (6 -> 0)', () => {
    // 5.5 tokens at 6 decimals -> 0 decimals (floor)
    const result = normaliseBalance(
      5_500_000n as BalanceBigInt,
      6 as Decimals,
      0 as Decimals
    );
    expect(result).toBe(5n);
  });

  test('handles zero-decimal to zero-decimal (0 -> 0)', () => {
    const result = normaliseBalance(
      42n as BalanceBigInt,
      0 as Decimals,
      0 as Decimals
    );
    expect(result).toBe(42n);
  });

  test('throws on negative source decimals', () => {
    expect(() =>
      normaliseBalance(1n as BalanceBigInt, -1 as Decimals, 6 as Decimals)
    ).toThrow(InvalidAssetDecimalsError);
  });

  test('throws on negative target decimals', () => {
    expect(() =>
      normaliseBalance(1n as BalanceBigInt, 6 as Decimals, -1 as Decimals)
    ).toThrow(InvalidAssetDecimalsError);
  });

  test('throws on non-integer source decimals', () => {
    expect(() =>
      normaliseBalance(1n as BalanceBigInt, 6.5 as Decimals, 18 as Decimals)
    ).toThrow(InvalidAssetDecimalsError);
  });

  test('throws on non-integer target decimals', () => {
    expect(() =>
      normaliseBalance(1n as BalanceBigInt, 6 as Decimals, 18.5 as Decimals)
    ).toThrow(InvalidAssetDecimalsError);
  });
});

// ---------------------------------------------------------------------------
// validateAssetDecimals
// ---------------------------------------------------------------------------
describe('validateAssetDecimals', () => {
  const chainA = new ChainId({
    namespace: 'eip155',
    reference: '1'
  });

  test('passes for asset with matching parent and entity decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          decimals: 6
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).not.toThrow();
  });

  test('passes for asset with differing parent and entity decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          decimals: 18
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).not.toThrow();
  });

  test('throws on negative parent decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: -1,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws on negative entity decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: -2
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws on non-integer parent decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6.5,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws on non-integer entity decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 1.5
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws on undefined (missing) parent decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: undefined as unknown as number,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws on undefined (missing) entity decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: undefined as unknown as number
        }
      ]
    });
    expect(() => validateAssetDecimals(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });
});

// ---------------------------------------------------------------------------
// validateAssetMetadata
// ---------------------------------------------------------------------------
describe('validateAssetMetadata', () => {
  const chainA = new ChainId({
    namespace: 'eip155',
    reference: '1'
  });

  test('passes for valid asset with complete metadata', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 18
        }
      ]
    });
    expect(() => validateAssetMetadata(asset)).not.toThrow();
  });

  test('throws InvalidAssetDecimalsError for invalid decimals', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: -1,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws InvalidAssetMetadataError for missing entity symbol', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    // Force-clear the symbol to simulate incomplete metadata
    asset.entities[0].symbol = '' as Symbol;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing entity name', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.entities[0].name = '' as Asset['name'];

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for undefined entity symbol', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.entities[0].symbol = undefined as unknown as Symbol;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing parent id', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.id = '' as AssetId;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing parent symbol', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.symbol = '' as Symbol;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing parent name', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.name = '' as AssetName;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for empty entities array', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.entities = [];

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for duplicate entities on the same chain', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        },
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000002',
          decimals: 18
        }
      ]
    });

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for undefined parent id', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    asset.id = undefined as unknown as AssetId;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing entities array', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    (asset as unknown as { entities: undefined }).entities = undefined;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for missing entity assetType', () => {
    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    (asset.entities[0] as unknown as { assetType: undefined }).assetType =
      undefined;

    expect(() => validateAssetMetadata(asset)).toThrow(
      InvalidAssetMetadataError
    );
  });
});

// ---------------------------------------------------------------------------
// Aggregation correctness (pure-function composition)
// ---------------------------------------------------------------------------
describe('normaliseBalance aggregation', () => {
  test('sums correctly when all chains have identical decimals', () => {
    const balances = [
      { amount: 1_000_000n as BalanceBigInt, decimals: 6 as Decimals },
      { amount: 2_000_000n as BalanceBigInt, decimals: 6 as Decimals }
    ];
    const parentDecimals = 6 as Decimals;

    const total = balances.reduce(
      (acc, b) =>
        (acc +
          normaliseBalance(
            b.amount,
            b.decimals,
            parentDecimals
          )) as BalanceBigInt,
      0n as BalanceBigInt
    );

    expect(total).toBe(3_000_000n);
  });

  test('sums correctly when chains have differing decimals', () => {
    // Chain A: 1 USDC at 6 decimals
    // Chain B: 2 USDC at 18 decimals
    // Parent: 6 decimals
    const balances = [
      { amount: 1_000_000n as BalanceBigInt, decimals: 6 as Decimals },
      {
        amount: 2_000_000_000_000_000_000n as BalanceBigInt,
        decimals: 18 as Decimals
      }
    ];
    const parentDecimals = 6 as Decimals;

    const total = balances.reduce(
      (acc, b) =>
        (acc +
          normaliseBalance(
            b.amount,
            b.decimals,
            parentDecimals
          )) as BalanceBigInt,
      0n as BalanceBigInt
    );

    // 1 + 2 = 3 USDC at 6 decimals
    expect(total).toBe(3_000_000n);
  });

  test('truncation during aggregation uses floor', () => {
    // Chain A: 1.000000 USDC at 6 decimals
    // Chain B: 0.000000000000000001 USDC at 18 decimals (sub-unit)
    // Parent: 6 decimals
    const balances = [
      { amount: 1_000_000n as BalanceBigInt, decimals: 6 as Decimals },
      { amount: 1n as BalanceBigInt, decimals: 18 as Decimals }
    ];
    const parentDecimals = 6 as Decimals;

    const total = balances.reduce(
      (acc, b) =>
        (acc +
          normaliseBalance(
            b.amount,
            b.decimals,
            parentDecimals
          )) as BalanceBigInt,
      0n as BalanceBigInt
    );

    // 1n at 18 dec -> 0n at 6 dec (truncated), so total = 1_000_000
    expect(total).toBe(1_000_000n);
  });

  test('three-chain aggregation with mixed decimals', () => {
    // Chain A: 1 token at 6 decimals
    // Chain B: 1 token at 8 decimals
    // Chain C: 1 token at 18 decimals
    // Parent: 8 decimals
    const balances = [
      { amount: 1_000_000n as BalanceBigInt, decimals: 6 as Decimals },
      {
        amount: 100_000_000n as BalanceBigInt,
        decimals: 8 as Decimals
      },
      {
        amount: 1_000_000_000_000_000_000n as BalanceBigInt,
        decimals: 18 as Decimals
      }
    ];
    const parentDecimals = 8 as Decimals;

    const total = balances.reduce(
      (acc, b) =>
        (acc +
          normaliseBalance(
            b.amount,
            b.decimals,
            parentDecimals
          )) as BalanceBigInt,
      0n as BalanceBigInt
    );

    // 1*10^8 + 1*10^8 + 1*10^8 = 3*10^8
    expect(total).toBe(300_000_000n);
  });
});

// ---------------------------------------------------------------------------
// LibQC.getTotalBalance wiring
// ---------------------------------------------------------------------------
describe('LibQC.getTotalBalance wiring', () => {
  const chainA = new ChainId({
    namespace: 'eip155',
    reference: '1'
  });
  const chainB = new ChainId({
    namespace: 'eip155',
    reference: '8453'
  });

  test('normalises balances with differing decimals before summing', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6
        },
        {
          chainId: chainB,
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          decimals: 18
        }
      ]
    });

    const accountA = new AccountId({
      chainId: { namespace: 'eip155', reference: '1' },
      address: '0x1111111111111111111111111111111111111111'
    });
    const accountB = new AccountId({
      chainId: { namespace: 'eip155', reference: '8453' },
      address: '0x2222222222222222222222222222222222222222'
    });

    vi.spyOn(vault, 'listAccounts').mockResolvedValue([
      { id: accountA, address: accountA.address as Address, chainId: chainA },
      { id: accountB, address: accountB.address as Address, chainId: chainB }
    ]);

    // Mock the ERC-20 read at the publicReads boundary so the real
    // EvmAccountClient runs but never hits the network. Branch on
    // accountId so each chain reports its own balance + decimals.
    vi.mocked(getErc20TokenBalanceByChain).mockImplementation(
      async (_publicClient, accountId) =>
        accountId.toString() === accountA.toString()
          ? {
              balance: 1_000_000n as BalanceBigInt, // 1 USDC at 6 dec
              decimals: 6 as Decimals,
              symbol: 'USDC' as Symbol
            }
          : {
              balance: 2_000_000_000_000_000_000n as BalanceBigInt, // 2 USDC at 18 dec
              decimals: 18 as Decimals,
              symbol: 'USDC' as Symbol
            }
    );

    const result = await vault.getTotalBalance(asset);

    // 1 USDC (6 dec) + 2 USDC (18 dec -> normalised to 6 dec) = 3 USDC
    expect(result.balance).toBe(3_000_000n);
    expect(result.decimals).toBe(6);
    expect(result.symbol).toBe('USDC');
  });

  test('sums correctly when all chains have identical decimals', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    // Use the registry id for native ETH so EvmAccountClient routes
    // this through getNativeBalance (which we mock below) rather than
    // falling through to the ERC-20 path.
    const asset = createMultiChainTestAsset({
      id: 'p11:eth',
      symbol: 'ETH',
      decimals: 18,
      entities: [
        {
          chainId: chainA,
          address: '0x0',
          decimals: 18,
          isNative: true
        },
        {
          chainId: chainB,
          address: '0x0',
          decimals: 18,
          isNative: true
        }
      ]
    });

    const accountA = new AccountId({
      chainId: { namespace: 'eip155', reference: '1' },
      address: '0x1111111111111111111111111111111111111111'
    });
    const accountB = new AccountId({
      chainId: { namespace: 'eip155', reference: '8453' },
      address: '0x2222222222222222222222222222222222222222'
    });

    vi.spyOn(vault, 'listAccounts').mockResolvedValue([
      { id: accountA, address: accountA.address as Address, chainId: chainA },
      { id: accountB, address: accountB.address as Address, chainId: chainB }
    ]);

    vi.mocked(getNativeBalance).mockResolvedValue({
      balance: 1_000_000_000_000_000_000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    });

    const result = await vault.getTotalBalance(asset);

    expect(result.balance).toBe(2_000_000_000_000_000_000n);
    expect(result.decimals).toBe(18);
  });

  test('preserves dust that individually truncates to zero', async () => {
    // Two balances of 600_000_000_000n at 18 decimals against a
    // 6-decimal asset each normalise to 0 individually, but together
    // contribute 1 at 6 decimals (1_200_000_000_000 / 10^12 = 1).
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 18
        },
        {
          chainId: chainB,
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          decimals: 18
        }
      ]
    });

    const accountA = new AccountId({
      chainId: { namespace: 'eip155', reference: '1' },
      address: '0x1111111111111111111111111111111111111111'
    });
    const accountB = new AccountId({
      chainId: { namespace: 'eip155', reference: '8453' },
      address: '0x2222222222222222222222222222222222222222'
    });

    vi.spyOn(vault, 'listAccounts').mockResolvedValue([
      { id: accountA, address: accountA.address as Address, chainId: chainA },
      { id: accountB, address: accountB.address as Address, chainId: chainB }
    ]);

    vi.mocked(getErc20TokenBalanceByChain).mockResolvedValue({
      balance: 600_000_000_000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'USDC' as Symbol
    });

    const result = await vault.getTotalBalance(asset);

    // 600_000_000_000 + 600_000_000_000 = 1_200_000_000_000
    // scaled from 18 to 6: 1_200_000_000_000 / 10^12 = 1
    expect(result.balance).toBe(1n);
    expect(result.decimals).toBe(6);
  });

  test('throws InvalidAssetDecimalsError for invalid asset', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const badAsset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: -1,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });

    await expect(vault.getTotalBalance(badAsset)).rejects.toThrow(
      InvalidAssetDecimalsError
    );
  });

  test('throws InvalidAssetMetadataError for asset with empty entities', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const badAsset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    badAsset.entities = [];

    await expect(vault.getTotalBalance(badAsset)).rejects.toThrow(
      InvalidAssetMetadataError
    );
  });

  test('throws InvalidAssetMetadataError for asset with missing symbol', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const badAsset = createMultiChainTestAsset({
      symbol: 'BAD',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0x0000000000000000000000000000000000000001',
          decimals: 6
        }
      ]
    });
    badAsset.symbol = '' as Symbol;

    await expect(vault.getTotalBalance(badAsset)).rejects.toThrow(
      InvalidAssetMetadataError
    );
  });

  test('returns zero balance when no accounts hold the asset', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const asset = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6
        }
      ]
    });

    // No accounts at all
    vi.spyOn(vault, 'listAccounts').mockResolvedValue([]);

    const result = await vault.getTotalBalance(asset);

    expect(result.balance).toBe(0n);
    expect(result.decimals).toBe(6);
    expect(result.symbol).toBe('USDC');
  });
});

// ---------------------------------------------------------------------------
// LibQC.getTotalBalances (plural) wiring
// ---------------------------------------------------------------------------
describe('LibQC.getTotalBalances wiring', () => {
  const chainA = new ChainId({
    namespace: 'eip155',
    reference: '1'
  });
  const chainB = new ChainId({
    namespace: 'eip155',
    reference: '8453'
  });

  test('normalises each asset independently with mixed decimals', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    // USDC: parent 6, chain A entity 6, chain B entity 18
    const usdc = createMultiChainTestAsset({
      symbol: 'USDC',
      decimals: 6,
      entities: [
        {
          chainId: chainA,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6
        },
        {
          chainId: chainB,
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          decimals: 18
        }
      ]
    });

    // ETH: parent 18, same decimals on both chains. Use the registry id
    // so EvmAccountClient routes through the native-balance path.
    const eth = createMultiChainTestAsset({
      id: 'p11:eth',
      symbol: 'ETH',
      decimals: 18,
      entities: [
        {
          chainId: chainA,
          address: '0x0',
          decimals: 18,
          isNative: true
        },
        {
          chainId: chainB,
          address: '0x0',
          decimals: 18,
          isNative: true
        }
      ]
    });

    const accountA = new AccountId({
      chainId: { namespace: 'eip155', reference: '1' },
      address: '0x1111111111111111111111111111111111111111'
    });
    const accountB = new AccountId({
      chainId: { namespace: 'eip155', reference: '8453' },
      address: '0x2222222222222222222222222222222222222222'
    });

    vi.spyOn(vault, 'listAccounts').mockResolvedValue([
      {
        id: accountA,
        address: accountA.address as Address,
        chainId: chainA
      },
      {
        id: accountB,
        address: accountB.address as Address,
        chainId: chainB
      }
    ]);

    // ERC-20 USDC: chain A reports 6 dec, chain B reports 18 dec.
    vi.mocked(getErc20TokenBalanceByChain).mockImplementation(
      async (_publicClient, accountId) =>
        accountId.toString() === accountA.toString()
          ? {
              balance: 1_000_000n as BalanceBigInt, // 1 USDC at 6 dec
              decimals: 6 as Decimals,
              symbol: 'USDC' as Symbol
            }
          : {
              balance: 2_000_000_000_000_000_000n as BalanceBigInt, // 2 USDC at 18 dec
              decimals: 18 as Decimals,
              symbol: 'USDC' as Symbol
            }
    );

    // Native ETH: 1 ETH on each chain at 18 dec.
    vi.mocked(getNativeBalance).mockResolvedValue({
      balance: 1_000_000_000_000_000_000n as BalanceBigInt,
      decimals: 18 as Decimals,
      symbol: 'ETH' as Symbol
    });

    const [usdcResult, ethResult] = await vault.getTotalBalances([usdc, eth]);

    // USDC: 1 (6 dec) + 2 (18 dec -> 6 dec) = 3 at 6 dec
    expect(usdcResult.balance).toBe(3_000_000n);
    expect(usdcResult.decimals).toBe(6);
    expect(usdcResult.symbol).toBe('USDC');

    // ETH: 1 + 1 = 2 at 18 dec (same decimals throughout)
    expect(ethResult.balance).toBe(2_000_000_000_000_000_000n);
    expect(ethResult.decimals).toBe(18);
    expect(ethResult.symbol).toBe('ETH');
  });
});
