import { AccountId, ChainId } from 'caip';
import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Main entry point exports
import {
  type BlockNumber,
  type BundlerConfig,
  type EvmAddress,
  type TransactionValue
} from '../../src';

// Internal imports (not exported from main entry point)
import {
  ActivityType,
  Erc20TransactionActivity,
  getActivities,
  type EvmActivity,
  type NativeTransactionActivityData
} from '../../src/activities';

// Mock the zeroDev activities module
vi.mock('../../src/zeroDev/activities', () => ({
  getKernelActivities: vi.fn(),
  getTokenActivities: vi.fn()
}));

// Mock the bundler module
vi.mock('../../src/bundler', () => ({
  getBundlerClient: vi.fn()
}));

describe('activities.ts - getActivities', () => {
  let mockPublicClient: PublicClient;
  let mockBundlerClient: any;
  let bundlerConfig: BundlerConfig;

  const testAddress =
    '0x1234567890123456789012345678901234567890' as EvmAddress;
  const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });
  const testAccountId = new AccountId({
    chainId: testChainId,
    address: testAddress
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPublicClient = {
      chain: { id: 1, name: 'Ethereum' }
    } as PublicClient;

    mockBundlerClient = {
      sendUserOperation: vi.fn()
    };

    bundlerConfig = {
      chain: { id: 1, name: 'Ethereum' } as any,
      urls: ['https://bundler.example.com'] as any,
      headers: {}
    };

    const { getBundlerClient } = await import('../../src/bundler');
    vi.mocked(getBundlerClient).mockReturnValue(mockBundlerClient);
  });

  it('creates bundler client with provided config', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );
    const { getBundlerClient } = await import('../../src/bundler');

    vi.mocked(getKernelActivities).mockResolvedValue([]);

    await getActivities(testAccountId, mockPublicClient, bundlerConfig);

    expect(getBundlerClient).toHaveBeenCalledWith(bundlerConfig);
  });

  it('calls getKernelActivities with correct parameters', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );
    vi.mocked(getKernelActivities).mockResolvedValue([]);

    await getActivities(testAccountId, mockPublicClient, bundlerConfig);

    expect(getKernelActivities).toHaveBeenCalledWith(
      mockPublicClient,
      mockBundlerClient,
      testAddress
    );
  });

  it('returns kernel activities when no filters are provided', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig
    );

    expect(result).toEqual(mockActivities);
  });

  it('sorts activities by block number in descending order', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 300n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xdef' as EvmAddress,
          value: 2000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 200n as BlockNumber,
        data: {
          from: testAddress,
          to: '0x123' as EvmAddress,
          value: 3000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig
    );

    expect(result[0].blockNumber).toBe(300n);
    expect(result[1].blockNumber).toBe(200n);
    expect(result[2].blockNumber).toBe(100n);
  });

  it('filters activities by token addresses', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const tokenAddress =
      '0xTokenAddress123456789012345678901234567890' as EvmAddress;
    const otherTokenAddress =
      '0xOtherToken123456789012345678901234567890' as EvmAddress;

    const kernelActivities: EvmActivity[] = [
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          contract: tokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 101n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xdef' as EvmAddress,
          value: 2000n as TransactionValue,
          contract: otherTokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    const tokenActivities: Erc20TransactionActivity[] = [
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 102n as BlockNumber,
        data: {
          from: '0x999' as EvmAddress,
          to: testAddress,
          value: 5000n as TransactionValue,
          contract: tokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(kernelActivities);
    vi.mocked(getTokenActivities).mockResolvedValue(tokenActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      { tokens: [tokenAddress] }
    );

    // Should include only activities for the specified token
    expect(result).toHaveLength(2);
    expect(
      (result as Erc20TransactionActivity[]).every(
        a => a.data.contract === tokenAddress.toLowerCase()
      )
    ).toBe(true);
  });

  it('calls getTokenActivities for each token filter', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const token1 = '0xToken1234567890123456789012345678901234567' as EvmAddress;
    const token2 = '0xToken2345678901234567890123456789012345678' as EvmAddress;

    vi.mocked(getKernelActivities).mockResolvedValue([]);
    vi.mocked(getTokenActivities).mockResolvedValue([]);

    await getActivities(testAccountId, mockPublicClient, bundlerConfig, {
      tokens: [token1, token2]
    });

    expect(getTokenActivities).toHaveBeenCalledTimes(2);
    expect(getTokenActivities).toHaveBeenCalledWith(
      mockPublicClient,
      testAddress,
      token1.toLowerCase()
    );
    expect(getTokenActivities).toHaveBeenCalledWith(
      mockPublicClient,
      testAddress,
      token2.toLowerCase()
    );
  });

  it('converts token addresses to lowercase when filtering', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const tokenAddress =
      '0xABCDEF123456789012345678901234567890ABCD' as EvmAddress;

    vi.mocked(getKernelActivities).mockResolvedValue([]);
    vi.mocked(getTokenActivities).mockResolvedValue([]);

    await getActivities(testAccountId, mockPublicClient, bundlerConfig, {
      tokens: [tokenAddress]
    });

    expect(getTokenActivities).toHaveBeenCalledWith(
      mockPublicClient,
      testAddress,
      tokenAddress.toLowerCase()
    );
  });

  it('filters activities by type', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 101n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xdef' as EvmAddress,
          value: 2000n as TransactionValue,
          contract: '0xtoken' as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      { types: [ActivityType.NativeTransaction, ActivityType.Erc20Transaction] }
    );

    expect(result).toHaveLength(2);
  });

  it('filters by both tokens and types', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const tokenAddress =
      '0xToken1234567890123456789012345678901234567' as EvmAddress;

    const kernelActivities: EvmActivity[] = [
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          contract: tokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 101n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xdef' as EvmAddress,
          value: 2000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    const tokenActivities: Erc20TransactionActivity[] = [
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 102n as BlockNumber,
        data: {
          from: '0x999' as EvmAddress,
          to: testAddress,
          value: 5000n as TransactionValue,
          contract: tokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(kernelActivities);
    vi.mocked(getTokenActivities).mockResolvedValue(tokenActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      {
        tokens: [tokenAddress],
        types: [ActivityType.Erc20Transaction]
      }
    );

    expect(result).toHaveLength(2);
    expect(result.every(a => a.type === ActivityType.Erc20Transaction)).toBe(
      true
    );
    expect(
      (result as Erc20TransactionActivity[]).every(
        a => a.data.contract === tokenAddress.toLowerCase()
      )
    ).toBe(true);
  });

  it('returns empty array when no activities exist', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    vi.mocked(getKernelActivities).mockResolvedValue([]);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig
    );

    expect(result).toEqual([]);
  });

  it('returns incoming native transaction activities from Received events', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const senderAddress =
      '0x9999999999999999999999999999999999999999' as EvmAddress;

    // Mock activities that include incoming native transactions (from Received events)
    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: senderAddress,
          to: testAddress, // The recipient is the test account
          value: 1000000000000000000n as TransactionValue, // 1 ETH
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig
    );

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(ActivityType.NativeTransaction);
    expect((result[0].data as NativeTransactionActivityData).from).toBe(
      senderAddress
    );
    expect((result[0].data as NativeTransactionActivityData).to).toBe(
      testAddress
    );
    expect((result[0].data as NativeTransactionActivityData).value).toBe(
      1000000000000000000n
    );
  });

  it('includes both outgoing and incoming native transactions', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const recipientAddress =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as EvmAddress;
    const senderAddress =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as EvmAddress;

    // Mock activities that include both outgoing (from UserOp) and incoming (from Received)
    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress, // Outgoing: test account sends
          to: recipientAddress,
          value: 500000000000000000n as TransactionValue, // 0.5 ETH sent
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 150n as BlockNumber,
        data: {
          from: senderAddress, // Incoming: test account receives
          to: testAddress,
          value: 1000000000000000000n as TransactionValue, // 1 ETH received
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig
    );

    expect(result).toHaveLength(2);

    // Results should be sorted by block number descending
    expect(result[0].blockNumber).toBe(150n);
    expect((result[0].data as NativeTransactionActivityData).to).toBe(
      testAddress
    ); // Incoming
    expect(result[1].blockNumber).toBe(100n);
    expect((result[1].data as NativeTransactionActivityData).from).toBe(
      testAddress
    ); // Outgoing
  });

  it('handles empty token filter array', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      { tokens: [] }
    );

    // With empty token array, should filter to only ERC20 transactions matching empty array
    expect(getTokenActivities).not.toHaveBeenCalled();
    expect(result).toEqual(mockActivities);
  });

  it('handles empty types filter array', async () => {
    const { getKernelActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const mockActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(mockActivities);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      { types: [] }
    );

    expect(result).toEqual([]);
  });

  it('token filter only filters ERC-20 transactions, preserving other activity types', async () => {
    const { getKernelActivities, getTokenActivities } = await import(
      '../../src/zeroDev/activities'
    );

    const tokenAddress =
      '0xToken1234567890123456789012345678901234567' as EvmAddress;
    const otherTokenAddress =
      '0xOtherToken123456789012345678901234567890' as EvmAddress;

    // Kernel activities include various types, not just ERC-20
    const kernelActivities: EvmActivity[] = [
      {
        type: ActivityType.NativeTransaction,
        blockNumber: 100n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xabcd' as EvmAddress,
          value: 1000n as TransactionValue,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 102n as BlockNumber,
        data: {
          from: testAddress,
          to: '0xdef' as EvmAddress,
          value: 2000n as TransactionValue,
          contract: tokenAddress.toLowerCase() as EvmAddress,
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      },
      {
        type: ActivityType.Erc20Transaction,
        blockNumber: 103n as BlockNumber,
        data: {
          from: testAddress,
          to: '0x123' as EvmAddress,
          value: 3000n as TransactionValue,
          contract: otherTokenAddress.toLowerCase() as EvmAddress, // Different token - should be filtered out
          txHash: '0xabc123' as `0x${string}`,
          explorerUrl: null
        }
      }
    ];

    vi.mocked(getKernelActivities).mockResolvedValue(kernelActivities);
    vi.mocked(getTokenActivities).mockResolvedValue([]);

    const result = await getActivities(
      testAccountId,
      mockPublicClient,
      bundlerConfig,
      { tokens: [tokenAddress] }
    );

    // Should include: NativeTransaction, ChangeValidator, and the matching ERC-20 transaction
    // Should NOT include: the ERC-20 transaction with otherTokenAddress
    expect(result).toHaveLength(2);

    // Verify non-ERC20 activity types are preserved
    expect(result.some(a => a.type === ActivityType.NativeTransaction)).toBe(
      true
    );

    // Verify only the matching ERC-20 transaction is included
    const erc20Activities = result.filter(
      a => a.type === ActivityType.Erc20Transaction
    );
    expect(erc20Activities).toHaveLength(1);
    expect(erc20Activities[0].data.contract).toBe(tokenAddress.toLowerCase());
  });
});
