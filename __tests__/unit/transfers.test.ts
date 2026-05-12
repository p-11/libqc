import { AccountId, ChainId } from 'caip';
import type { PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Main entry point exports
import {
  type BlockNumber,
  type BundlerConfig,
  type EvmAddress,
  type CallGasLimit,
  type GasCostEstimate,
  type PreVerificationGas,
  type RpcUrl,
  type TransactionValue,
  type VerificationGasLimit
} from '../../src';

// Internal imports (not exported from main entry point)
import type { AuthorizedAccount, ReadOnlyAccount } from '../../src/account';
import { ActivityType } from '../../src/activities';
import { getTransferGasCostEstimate, sendTransfer } from '../../src/transfers';

// Mock the zeroDev transfers module
vi.mock('../../src/zeroDev/transfers', () => ({
  sendKernelUserOperation: vi.fn(),
  getKernelGasCostEstimate: vi.fn()
}));

// Mock viem encodeFunctionData
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    encodeFunctionData: vi.fn()
  };
});

describe('transfers.ts - sendTransfer', () => {
  let mockPublicClient: Partial<PublicClient>;
  let mockBundlerConfig: BundlerConfig;
  let mockAuthorizedAccount: AuthorizedAccount;
  let mockReadOnlyAccount: ReadOnlyAccount;

  const testAddress =
    '0x1234567890123456789012345678901234567890' as EvmAddress;
  const testToAddress =
    '0x9876543210987654321098765432109876543210' as EvmAddress;
  const testTokenAddress =
    '0xTokenAddress123456789012345678901234567890' as EvmAddress;
  const testAmount = 1000n as TransactionValue;
  const testBlockNumber = 12345n as BlockNumber;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPublicClient = {
      chain: mainnet
    };

    // Mock bundler config
    mockBundlerConfig = {
      chain: mainnet,
      urls: ['http://localhost:8545' as RpcUrl],
      headers: {}
    };

    // Mock authorized account
    mockAuthorizedAccount = {
      accountId: new AccountId({
        chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
        address: testAddress
      }),
      getAddress: vi.fn().mockReturnValue(testAddress),
      getAuthorizedKernelAccount: vi.fn().mockReturnValue({
        address: testAddress,
        encodeCalls: vi.fn()
      })
    } satisfies AuthorizedAccount;

    // Mock read-only account
    mockReadOnlyAccount = {
      accountId: new AccountId({
        chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
        address: testAddress
      }),
      getAddress: vi.fn().mockReturnValue(testAddress),
      getReadOnlyKernelAccount: vi.fn().mockReturnValue({
        address: testAddress,
        encodeCalls: vi.fn()
      })
    } satisfies ReadOnlyAccount;

    const { sendKernelUserOperation } = await import(
      '../../src/zeroDev/transfers'
    );
    vi.mocked(sendKernelUserOperation).mockResolvedValue({
      userOpHash: '0xuserOpHash123' as `0x${string}`,
      receipt: {
        blockNumber: testBlockNumber,
        transactionHash: '0xtxHash456' as `0x${string}`
      }
    });

    // Mock encodeFunctionData for ERC-20 transfers
    const { encodeFunctionData } = await import('viem');
    vi.mocked(encodeFunctionData).mockReturnValue(
      '0xencodedData' as `0x${string}`
    );
  });

  describe('native token transfers', () => {
    it('sends a native token transfer with correct parameters', async () => {
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(sendKernelUserOperation).toHaveBeenCalledWith({
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: {
          to: testToAddress,
          value: testAmount,
          data: '0x'
        }
      });

      expect(result.activity).toEqual({
        type: ActivityType.NativeTransaction,
        blockNumber: testBlockNumber,
        data: {
          from: testAddress,
          to: testToAddress,
          value: testAmount,
          txHash: '0xtxHash456',
          explorerUrl: 'https://etherscan.io/tx/0xtxHash456'
        }
      });
      expect(result.txHash).toBe('0xtxHash456');
      expect(result.userOpHash).toBe('0xuserOpHash123');
    });

    it('creates a NativeTransaction activity without token field', async () => {
      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result.activity.type).toBe(ActivityType.NativeTransaction);
      expect('contract' in result.activity.data).toBe(false);
    });
  });

  describe('ERC-20 token transfers', () => {
    it('sends an ERC-20 token transfer with correct parameters', async () => {
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );
      const { encodeFunctionData } = await import('viem');

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        token: testTokenAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(encodeFunctionData).toHaveBeenCalledWith({
        abi: expect.any(Array),
        functionName: 'transfer',
        args: [testToAddress, testAmount]
      });

      expect(sendKernelUserOperation).toHaveBeenCalledWith({
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: {
          to: testTokenAddress,
          value: 0n,
          data: '0xencodedData'
        }
      });

      expect(result.activity).toEqual({
        type: ActivityType.Erc20Transaction,
        blockNumber: testBlockNumber,
        data: {
          from: testAddress,
          to: testToAddress,
          value: testAmount,
          contract: testTokenAddress,
          txHash: '0xtxHash456',
          explorerUrl: 'https://etherscan.io/tx/0xtxHash456'
        }
      });
    });

    it('creates an Erc20Transaction activity with contract field', async () => {
      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        token: testTokenAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result.activity.type).toBe(ActivityType.Erc20Transaction);
      if (result.activity.type === ActivityType.Erc20Transaction) {
        expect(result.activity.data.contract).toBe(testTokenAddress);
      } else {
        throw new Error('Expected Erc20Transaction activity type');
      }
    });
  });

  describe('activity creation', () => {
    it('includes correct block number from receipt', async () => {
      const customBlockNumber = 98765n as BlockNumber;
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      vi.mocked(sendKernelUserOperation).mockResolvedValue({
        userOpHash: '0xuserOpHash123' as `0x${string}`,
        receipt: {
          blockNumber: customBlockNumber,
          transactionHash: '0xtxHash456' as `0x${string}`
        }
      });

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result.activity.blockNumber).toBe(customBlockNumber);
    });

    it('includes from address from authorized account', async () => {
      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      if (
        result.activity.type === ActivityType.NativeTransaction ||
        result.activity.type === ActivityType.Erc20Transaction
      ) {
        expect(result.activity.data.from).toBe(testAddress);
      } else {
        throw new Error(
          'Expected NativeTransaction or Erc20Transaction activity type'
        );
      }
    });

    it('includes correct to address in activity', async () => {
      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      if (
        result.activity.type === ActivityType.NativeTransaction ||
        result.activity.type === ActivityType.Erc20Transaction
      ) {
        expect(result.activity.data.to).toBe(testToAddress);
      } else {
        throw new Error(
          'Expected NativeTransaction or Erc20Transaction activity type'
        );
      }
    });

    it('includes correct amount in activity', async () => {
      const customAmount = 5000n as TransactionValue;

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: customAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      if (
        result.activity.type === ActivityType.NativeTransaction ||
        result.activity.type === ActivityType.Erc20Transaction
      ) {
        expect(result.activity.data.value).toBe(customAmount);
      } else {
        throw new Error(
          'Expected NativeTransaction or Erc20Transaction activity type'
        );
      }
    });
  });

  describe('edge cases', () => {
    it('handles transfer of 0 amount', async () => {
      const zeroAmount = 0n as TransactionValue;
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: zeroAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(sendKernelUserOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          userOperationCall: expect.objectContaining({
            value: zeroAmount
          })
        })
      );
      if (
        result.activity.type === ActivityType.NativeTransaction ||
        result.activity.type === ActivityType.Erc20Transaction
      ) {
        expect(result.activity.data.value).toBe(zeroAmount);
      } else {
        throw new Error(
          'Expected NativeTransaction or Erc20Transaction activity type'
        );
      }
    });

    it('handles very large amounts', async () => {
      const largeAmount = BigInt(
        '1000000000000000000000000'
      ) as TransactionValue;

      const result = await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: largeAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      if (
        result.activity.type === ActivityType.NativeTransaction ||
        result.activity.type === ActivityType.Erc20Transaction
      ) {
        expect(result.activity.data.value).toBe(largeAmount);
      } else {
        throw new Error(
          'Expected NativeTransaction or Erc20Transaction activity type'
        );
      }
    });

    it('handles transfers to same address as sender', async () => {
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testAddress, // Same as sender
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(sendKernelUserOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizedAccount: mockAuthorizedAccount,
          userOperationCall: expect.objectContaining({
            to: testAddress
          })
        })
      );
    });

    it('passes through all client parameters correctly', async () => {
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      await sendTransfer({
        authorizedAccount: mockAuthorizedAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(sendKernelUserOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizedAccount: mockAuthorizedAccount,
          publicClient: mockPublicClient,
          bundlerConfig: mockBundlerConfig,
          userOperationCall: expect.objectContaining({
            to: testToAddress,
            value: testAmount,
            data: '0x'
          })
        })
      );
    });
  });

  describe('error propagation', () => {
    it('propagates errors from sendKernelUserOperation', async () => {
      const { sendKernelUserOperation } = await import(
        '../../src/zeroDev/transfers'
      );

      vi.mocked(sendKernelUserOperation).mockRejectedValue(
        new Error('Transaction failed')
      );

      await expect(
        sendTransfer({
          authorizedAccount: mockAuthorizedAccount,
          amount: testAmount,
          to: testToAddress,
          publicClient: mockPublicClient as PublicClient,
          bundlerConfig: mockBundlerConfig
        })
      ).rejects.toThrow('Transaction failed');
    });
  });

  describe('getGasCostEstimate', () => {
    const testGasEstimate: GasCostEstimate = {
      callGasLimit: 50000n as CallGasLimit,
      preVerificationGas: 21000n as PreVerificationGas,
      verificationGasLimit: 100000n as VerificationGasLimit,
      maxFeePerGas: 1_000_000n,
      maxPriorityFeePerGas: 500_000n
    };

    beforeEach(async () => {
      const { getKernelGasCostEstimate } = await import(
        '../../src/zeroDev/transfers'
      );
      vi.mocked(getKernelGasCostEstimate).mockResolvedValue(testGasEstimate);
    });

    it('gets a gas cost estimate for native token transfer', async () => {
      const { getKernelGasCostEstimate } = await import(
        '../../src/zeroDev/transfers'
      );

      const result = await getTransferGasCostEstimate({
        readOnlyAccount: mockReadOnlyAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result).toEqual(testGasEstimate);

      expect(getKernelGasCostEstimate).toHaveBeenCalledWith({
        publicClient: mockPublicClient,
        readOnlyAccount: mockReadOnlyAccount,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: {
          to: testToAddress,
          value: testAmount,
          data: '0x'
        }
      });
    });

    it('gets a gas cost estimate for ERC-20 token transfer', async () => {
      const { getKernelGasCostEstimate } = await import(
        '../../src/zeroDev/transfers'
      );
      const { encodeFunctionData } = await import('viem');

      const result = await getTransferGasCostEstimate({
        readOnlyAccount: mockReadOnlyAccount,
        amount: testAmount,
        to: testToAddress,
        token: testTokenAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result).toEqual(testGasEstimate);

      expect(encodeFunctionData).toHaveBeenCalledWith({
        abi: expect.any(Array),
        functionName: 'transfer',
        args: [testToAddress, testAmount]
      });

      expect(getKernelGasCostEstimate).toHaveBeenCalledWith({
        publicClient: mockPublicClient,
        readOnlyAccount: mockReadOnlyAccount,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: {
          to: testTokenAddress,
          value: 0n,
          data: '0xencodedData'
        }
      });
    });

    it('propagates errors from getKernelGasCostEstimate', async () => {
      const { getKernelGasCostEstimate } = await import(
        '../../src/zeroDev/transfers'
      );

      vi.mocked(getKernelGasCostEstimate).mockRejectedValue(
        new Error('Failed to estimate gas')
      );

      await expect(
        getTransferGasCostEstimate({
          readOnlyAccount: mockReadOnlyAccount,
          amount: testAmount,
          to: testToAddress,
          publicClient: mockPublicClient as PublicClient,
          bundlerConfig: mockBundlerConfig
        })
      ).rejects.toThrow('Failed to estimate gas');
    });

    it('returns a non-zero gas estimate', async () => {
      const result = await getTransferGasCostEstimate({
        readOnlyAccount: mockReadOnlyAccount,
        amount: testAmount,
        to: testToAddress,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig
      });

      expect(result.callGasLimit).toBeGreaterThan(0n);
      expect(result.preVerificationGas).toBeGreaterThan(0n);
      expect(result.verificationGasLimit).toBeGreaterThan(0n);
      expect(result).toEqual(testGasEstimate);
    });
  });
});
