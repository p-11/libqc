import type { PublicClient } from 'viem';
import type { BundlerClient } from 'viem/account-abstraction';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityType } from '../../../src/activities';
import { type EvmAddress, type TransactionValue } from '../../../src/types';
import {
  getKernelActivities,
  getTokenActivities
} from '../../../src/zeroDev/activities';

// Mock viem's decodeFunctionData
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    decodeFunctionData: vi.fn()
  };
});

describe('ZeroDev Activities', () => {
  describe('getKernelActivities', () => {
    let mockPublicClient: Partial<PublicClient>;
    let mockBundlerClient: Partial<BundlerClient>;
    const testAddress =
      '0x1234567890123456789012345678901234567890' as EvmAddress;

    /**
     * Helper function to mock getContractEvents based on event name.
     * The function is called twice: first for UserOperationEvent, then for Received.
     *
     * @param userOpLogs - Mock logs to return for UserOperationEvent query
     * @param receivedEvents - Mock events to return for Received query
     */
    function mockGetContractEvents(
      userOpLogs: unknown[] = [],
      receivedEvents: unknown[] = []
    ): void {
      vi.mocked(mockPublicClient.getContractEvents!).mockImplementation(
        (params: unknown) => {
          const { eventName } = params as { eventName?: string };
          if (eventName === 'UserOperationEvent') {
            return Promise.resolve(userOpLogs as any);
          }
          if (eventName === 'Received') {
            return Promise.resolve(receivedEvents as any);
          }
          return Promise.resolve([]);
        }
      );
    }

    beforeEach(() => {
      vi.clearAllMocks();

      mockPublicClient = {
        getContractEvents: vi.fn()
      };

      mockBundlerClient = {
        getUserOperation: vi.fn()
      };
    });

    it('returns empty array when no UserOperationEvent logs or Received events exist', async () => {
      mockGetContractEvents([], []);

      const result = await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(result).toEqual([]);
      expect(mockPublicClient.getContractEvents).toHaveBeenCalledWith({
        fromBlock: 0n,
        toBlock: 'latest',
        address: expect.any(String),
        abi: expect.any(Array),
        eventName: 'UserOperationEvent',
        args: {
          sender: testAddress
        }
      });
    });

    it('queries UserOperationEvent logs for the given address', async () => {
      mockGetContractEvents([], []);

      await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(mockPublicClient.getContractEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'UserOperationEvent',
          args: {
            sender: testAddress
          }
        })
      );
    });

    it('queries Received events for the given address', async () => {
      mockGetContractEvents([], []);

      await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(mockPublicClient.getContractEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'Received',
          address: testAddress
        })
      );
    });

    it('fetches user operations for each log', async () => {
      const mockLogs = [
        {
          blockNumber: 100n,
          args: { userOpHash: '0xhash1' }
        },
        {
          blockNumber: 101n,
          args: { userOpHash: '0xhash2' }
        }
      ];

      mockGetContractEvents(mockLogs, []);

      const { decodeFunctionData } = await import('viem');
      vi.mocked(decodeFunctionData).mockReturnValue({
        functionName: 'unknown',
        args: []
      } as any);

      vi.mocked(mockBundlerClient.getUserOperation!).mockResolvedValue({
        userOperation: {
          callData: '0x',
          sender: testAddress
        }
      } as any);

      await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(mockBundlerClient.getUserOperation).toHaveBeenCalledTimes(2);
      expect(mockBundlerClient.getUserOperation).toHaveBeenCalledWith({
        hash: '0xhash1'
      });
      expect(mockBundlerClient.getUserOperation).toHaveBeenCalledWith({
        hash: '0xhash2'
      });
    });

    it('decodes execute function and returns native transaction activity', async () => {
      const mockLog = {
        blockNumber: 100n,
        transactionHash: '0xexecutetxhash1' as `0x${string}`,
        args: { userOpHash: '0xhash1' }
      };

      mockGetContractEvents([mockLog], []);

      const { decodeFunctionData } = await import('viem');

      // Mock decoding of kernel execute with single mode (0x00)
      // ExecutionCallData format: to (40 hex chars) + value (64 hex chars)
      const executionCallData =
        '0x9876543210987654321098765432109876543210' + // to address (40 chars)
        '0000000000000000000000000000000000000000000000000de0b6b3a7640000'; // 1 ETH in hex (64 chars)

      vi.mocked(decodeFunctionData).mockReturnValue({
        functionName: 'execute',
        args: [
          '0x00000000000000000000000000000000000000000000000000000000',
          executionCallData
        ]
      } as any);

      vi.mocked(mockBundlerClient.getUserOperation!).mockResolvedValue({
        userOperation: {
          callData: '0xexecute',
          sender: testAddress
        }
      } as any);

      const result = await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: ActivityType.NativeTransaction,
        blockNumber: 100n,
        data: {
          from: testAddress,
          to: '0x9876543210987654321098765432109876543210',
          value: 1000000000000000000n,
          txHash: '0xexecutetxhash1',
          explorerUrl: null
        }
      });
    });

    it('returns empty array for unknown function names when no Received events', async () => {
      const mockLog = {
        blockNumber: 300n,
        args: { userOpHash: '0xhash3' }
      };

      mockGetContractEvents([mockLog], []);

      const { decodeFunctionData } = await import('viem');

      vi.mocked(decodeFunctionData).mockReturnValue({
        functionName: 'unknownFunction',
        args: []
      } as any);

      vi.mocked(mockBundlerClient.getUserOperation!).mockResolvedValue({
        userOperation: {
          callData: '0xunknown',
          sender: testAddress
        }
      } as any);

      const result = await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(result).toEqual([]);
    });

    it('returns native transaction activities for Received events', async () => {
      const senderAddress =
        '0x9999999999999999999999999999999999999999' as EvmAddress;
      const receivedAmount = 500000000000000000n as TransactionValue; // 0.5 ETH

      const mockReceivedEvents = [
        {
          blockNumber: 150n,
          transactionHash: '0xreceivedhash1' as `0x${string}`,
          address: testAddress,
          args: {
            sender: senderAddress,
            amount: receivedAmount
          }
        }
      ];

      mockGetContractEvents([], mockReceivedEvents);

      const result = await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: ActivityType.NativeTransaction,
        blockNumber: 150n,
        data: {
          from: senderAddress,
          to: testAddress,
          value: receivedAmount,
          txHash: '0xreceivedhash1',
          explorerUrl: null
        }
      });
    });

    it('returns multiple native transaction activities for multiple Received events', async () => {
      const sender1 =
        '0x1111111111111111111111111111111111111111' as EvmAddress;
      const sender2 =
        '0x2222222222222222222222222222222222222222' as EvmAddress;

      const mockReceivedEvents = [
        {
          blockNumber: 100n,
          address: testAddress,
          args: {
            sender: sender1,
            amount: 1000000000000000000n // 1 ETH
          }
        },
        {
          blockNumber: 200n,
          address: testAddress,
          args: {
            sender: sender2,
            amount: 2000000000000000000n // 2 ETH
          }
        }
      ];

      mockGetContractEvents([], mockReceivedEvents);

      const result = await getKernelActivities(
        mockPublicClient as PublicClient,
        mockBundlerClient as BundlerClient,
        testAddress
      );

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(ActivityType.NativeTransaction);
      expect(result[0].blockNumber).toBe(100n);
      if (result[0].type === ActivityType.NativeTransaction) {
        expect(result[0].data.from).toBe(sender1);
        expect(result[0].data.value).toBe(1000000000000000000n);
      }

      expect(result[1].type).toBe(ActivityType.NativeTransaction);
      expect(result[1].blockNumber).toBe(200n);
      if (result[1].type === ActivityType.NativeTransaction) {
        expect(result[1].data.from).toBe(sender2);
        expect(result[1].data.value).toBe(2000000000000000000n);
      }
    });
  });

  describe('getTokenActivities', () => {
    let mockPublicClient: Partial<PublicClient>;
    const walletAddress =
      '0x1234567890123456789012345678901234567890' as EvmAddress;
    const tokenAddress =
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as EvmAddress;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPublicClient = {
        getContractEvents: vi.fn()
      };
    });

    it('returns empty array when no Transfer events exist', async () => {
      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue([]);

      const result = await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(result).toEqual([]);
    });

    it('queries Transfer events for the given token and address', async () => {
      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue([]);

      await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(mockPublicClient.getContractEvents).toHaveBeenCalledWith({
        fromBlock: 0n,
        toBlock: 'latest',
        address: tokenAddress,
        abi: expect.any(Array),
        eventName: 'Transfer',
        args: {
          to: walletAddress
        }
      });
    });

    it('returns ERC-20 transaction activities for incoming transfers', async () => {
      const fromAddress =
        '0x9999999999999999999999999999999999999999' as EvmAddress;
      const transferValue = 1000000n as TransactionValue;

      const mockLogs = [
        {
          blockNumber: 100n,
          transactionHash: '0xtokentxhash1' as `0x${string}`,
          args: {
            from: fromAddress,
            to: walletAddress,
            value: transferValue
          }
        }
      ];

      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue(
        mockLogs as any
      );

      const result = await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: ActivityType.Erc20Transaction,
        blockNumber: 100n,
        data: {
          from: fromAddress,
          to: walletAddress,
          value: transferValue,
          contract: tokenAddress,
          txHash: '0xtokentxhash1',
          explorerUrl: null
        }
      });
    });

    it('returns multiple ERC-20 transaction activities for multiple transfers', async () => {
      const fromAddress1 =
        '0x1111111111111111111111111111111111111111' as EvmAddress;
      const fromAddress2 =
        '0x2222222222222222222222222222222222222222' as EvmAddress;

      const mockLogs = [
        {
          blockNumber: 100n,
          args: {
            from: fromAddress1,
            to: walletAddress,
            value: 1000000n
          }
        },
        {
          blockNumber: 101n,
          args: {
            from: fromAddress2,
            to: walletAddress,
            value: 2000000n
          }
        }
      ];

      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue(
        mockLogs as any
      );

      const result = await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(result).toHaveLength(2);
      expect(result[0].data.from).toBe(fromAddress1);
      expect(result[0].data.value).toBe(1000000n);
      expect(result[1].data.from).toBe(fromAddress2);
      expect(result[1].data.value).toBe(2000000n);
    });

    it('includes correct block numbers in activities', async () => {
      const mockLogs = [
        {
          blockNumber: 12345n,
          args: {
            from: '0x1111111111111111111111111111111111111111' as EvmAddress,
            to: walletAddress,
            value: 1000000n
          }
        }
      ];

      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue(
        mockLogs as any
      );

      const result = await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(result[0].blockNumber).toBe(12345n);
    });

    it('includes the token contract address in each activity', async () => {
      const mockLogs = [
        {
          blockNumber: 100n,
          args: {
            from: '0x1111111111111111111111111111111111111111' as EvmAddress,
            to: walletAddress,
            value: 1000000n
          }
        }
      ];

      vi.mocked(mockPublicClient.getContractEvents!).mockResolvedValue(
        mockLogs as any
      );

      const result = await getTokenActivities(
        mockPublicClient as PublicClient,
        walletAddress,
        tokenAddress
      );

      expect(result[0].data.contract).toBe(tokenAddress);
    });
  });
});
