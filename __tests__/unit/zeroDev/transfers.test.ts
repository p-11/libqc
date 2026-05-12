import { AccountId, ChainId } from 'caip';
import type { PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedAccount, ReadOnlyAccount } from '../../../src/account';
import type { BundlerConfig } from '../../../src/bundler';
import { SECP256K1_VALIDATOR_ADDRESS } from '../../../src/config';
import {
  CallGasLimit,
  EvmAddress,
  GasCostEstimate,
  PaymasterPostOpGasLimit,
  PaymasterVerificationGasLimit,
  PreVerificationGas,
  RpcUrl,
  UserOperationCall,
  UserOperationData,
  UserOperationValue,
  VerificationGasLimit
} from '../../../src/types';
import {
  getKernelGasCostEstimate,
  sendKernelUserOperation,
  type GetGasCostEstimateConfig,
  type SendKernelUserOperationConfig
} from '../../../src/zeroDev/transfers';

// Mock @zerodev/sdk
vi.mock('@zerodev/sdk', () => ({
  createKernelAccountClient: vi.fn()
}));

// Mock the accounts module
vi.mock('../../../src/zeroDev/accounts', () => ({
  generateAuthorizedKernelAccount: vi.fn(),
  generateReadOnlyKernelAccount: vi.fn(),
  DEFAULT_KERNEL_VERSION: '0.3.3',
  DEFAULT_ENTRY_POINT: {
    address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
  }
}));

// Mock the bundler module
vi.mock('../../../src/bundler', () => ({
  getBundlerClient: vi.fn()
}));

// Mock viem/accounts
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn()
}));

// Mock the transports module
vi.mock('../../../src/transports', () => ({
  makeTransport: vi.fn(() => ({})),
  makeBundlerTransport: vi.fn(() => ({}))
}));

describe('zeroDev/transfers.ts', () => {
  let mockPublicClient: Partial<PublicClient>;
  let mockBundlerConfig: BundlerConfig;
  let mockAccount: any;
  let mockKernelClient: any;
  let mockBundlerClient: any;
  let mockAuthorizedAccount: AuthorizedAccount;
  let mockReadOnlyAccount: ReadOnlyAccount;
  let testAccountId: AccountId;
  let testUserOperationCall: UserOperationCall;
  let mockSigner: any;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const testChainId = new ChainId({ namespace: 'eip155', reference: '1' });
    const testAddress =
      '0x1234567890123456789012345678901234567890' as EvmAddress;
    testAccountId = new AccountId({
      chainId: testChainId,
      address: testAddress
    });

    mockPublicClient = {
      chain: mainnet,
      estimateFeesPerGas: vi.fn().mockResolvedValue({
        maxFeePerGas: 6_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n
      })
    };

    mockBundlerConfig = {
      chain: mainnet,
      urls: ['http://localhost:8545' as RpcUrl],
      headers: {}
    };

    testUserOperationCall = {
      to: '0x9876543210987654321098765432109876543210' as EvmAddress,
      value: 1000n as UserOperationValue,
      data: '0x' as UserOperationData
    };

    mockAccount = {
      encodeCalls: vi.fn().mockResolvedValue('0xencodedCallData'),
      kernelPluginManager: {
        getValidatorInitData: vi.fn().mockResolvedValue({
          validatorAddress: SECP256K1_VALIDATOR_ADDRESS // Default to secp256k1
        })
      }
    };

    const mockValidator = {} as any;

    // Mock authorized account
    mockAuthorizedAccount = {
      accountId: testAccountId,
      getAddress: vi.fn().mockReturnValue(testAddress),
      getAuthorizedKernelAccount: vi.fn().mockReturnValue({
        account: mockAccount,
        validator: mockValidator
      })
    } satisfies AuthorizedAccount;

    // Mock read-only account
    mockReadOnlyAccount = {
      accountId: testAccountId,
      getAddress: vi.fn().mockReturnValue(testAddress),
      getReadOnlyKernelAccount: vi.fn().mockReturnValue(mockAccount)
    } satisfies ReadOnlyAccount;

    mockKernelClient = {
      sendUserOperation: vi.fn(),
      waitForUserOperationReceipt: vi.fn(),
      prepareUserOperation: vi.fn(),
      account: mockAccount
    };

    mockBundlerClient = {
      prepareUserOperation: vi.fn()
    };

    mockSigner = {
      address: testAddress,
      signMessage: vi.fn(),
      signTransaction: vi.fn()
    };

    const { generateAuthorizedKernelAccount, generateReadOnlyKernelAccount } =
      await import('../../../src/zeroDev/accounts');
    vi.mocked(generateAuthorizedKernelAccount).mockResolvedValue(mockAccount);
    vi.mocked(generateReadOnlyKernelAccount).mockResolvedValue(mockAccount);

    const { createKernelAccountClient } = await import('@zerodev/sdk');
    vi.mocked(createKernelAccountClient).mockReturnValue(mockKernelClient);

    const { getBundlerClient } = await import('../../../src/bundler');
    vi.mocked(getBundlerClient).mockReturnValue(mockBundlerClient);

    const { privateKeyToAccount } = await import('viem/accounts');
    vi.mocked(privateKeyToAccount).mockReturnValue(mockSigner);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('sendKernelUserOperation', () => {
    it('sends a user operation successfully', async () => {
      const userOpHash = '0xuserOpHash123' as `0x${string}`;
      const blockNumber = 12345n;
      const transactionHash = '0xtxHash456' as `0x${string}`;
      const estimatedGas = {
        callGasLimit: 50000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };

      mockKernelClient.prepareUserOperation.mockResolvedValue(estimatedGas);
      mockKernelClient.sendUserOperation.mockResolvedValue(userOpHash);
      mockKernelClient.waitForUserOperationReceipt.mockResolvedValue({
        receipt: {
          blockNumber,
          transactionHash
        }
      });

      const config: SendKernelUserOperationConfig = {
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      const result = await sendKernelUserOperation(config);

      expect(result).toEqual({
        userOpHash,
        receipt: {
          blockNumber,
          transactionHash
        }
      });

      expect(
        mockAuthorizedAccount.getAuthorizedKernelAccount
      ).toHaveBeenCalled();

      expect(mockAccount.encodeCalls).toHaveBeenCalledWith([
        testUserOperationCall
      ]);
      expect(mockAccount.encodeCalls).toHaveBeenCalledTimes(1);
      expect(mockKernelClient.prepareUserOperation).toHaveBeenCalledWith({
        callData: '0xencodedCallData'
      });
      expect(mockKernelClient.sendUserOperation).toHaveBeenCalledWith({
        callData: '0xencodedCallData',
        callGasLimit: estimatedGas.callGasLimit,
        preVerificationGas: estimatedGas.preVerificationGas,
        verificationGasLimit: estimatedGas.verificationGasLimit
      });
      expect(mockKernelClient.waitForUserOperationReceipt).toHaveBeenCalledWith(
        {
          hash: userOpHash
        }
      );
    });

    it('propagates errors from sendUserOperation', async () => {
      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: 50000n,
        preVerificationGas: 21000n,
        verificationGasLimit: 100000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      });
      mockKernelClient.sendUserOperation.mockRejectedValue(
        new Error('Failed to send user operation')
      );

      const config: SendKernelUserOperationConfig = {
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(sendKernelUserOperation(config)).rejects.toThrow(
        'Failed to send user operation'
      );
    });

    it('propagates errors from waitForUserOperationReceipt', async () => {
      const userOpHash = '0xuserOpHash123' as `0x${string}`;
      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: 50000n,
        preVerificationGas: 21000n,
        verificationGasLimit: 100000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      });
      mockKernelClient.sendUserOperation.mockResolvedValue(userOpHash);
      mockKernelClient.waitForUserOperationReceipt.mockRejectedValue(
        new Error('Failed to wait for receipt')
      );

      const config: SendKernelUserOperationConfig = {
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(sendKernelUserOperation(config)).rejects.toThrow(
        'Failed to wait for receipt'
      );
    });

    it('throws error when authorized account has no kernel account', async () => {
      const accountWithNoKernel = {
        address: testAccountId.address as EvmAddress,
        getAuthorizedKernelAccount: () => {
          throw new Error(
            'ZeroDev Kernel account not initialized for this account type'
          );
        }
      };

      const config: SendKernelUserOperationConfig = {
        authorizedAccount: accountWithNoKernel as any,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(sendKernelUserOperation(config)).rejects.toThrow(
        'ZeroDev Kernel account not initialized for this account type'
      );
    });

    it('passes paymaster gas fields through when present', async () => {
      const userOpHash = '0xuserOpHash123' as `0x${string}`;
      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: 50000n,
        preVerificationGas: 21000n,
        verificationGasLimit: 100000n,
        paymasterVerificationGasLimit: 35000n,
        paymasterPostOpGasLimit: 15000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      });
      mockKernelClient.sendUserOperation.mockResolvedValue(userOpHash);
      mockKernelClient.waitForUserOperationReceipt.mockResolvedValue({
        receipt: {
          blockNumber: 12345n,
          transactionHash: '0xtxHash456' as `0x${string}`
        }
      });

      await sendKernelUserOperation({
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      });

      expect(mockAccount.encodeCalls).toHaveBeenCalledTimes(1);
      expect(mockKernelClient.sendUserOperation).toHaveBeenCalledWith({
        callData: '0xencodedCallData',
        callGasLimit: 50000n,
        preVerificationGas: 21000n,
        verificationGasLimit: 100000n,
        paymasterVerificationGasLimit: 35000n,
        paymasterPostOpGasLimit: 15000n
      });
    });

    it('pins maxFeePerGas from gasLimits so estimate and send use the same price', async () => {
      const pinnedFeePerGas = 2_000_000_000n;
      const pinnedPriorityFeePerGas = 1_000_000_000n;
      const gasLimits: GasCostEstimate = {
        callGasLimit: 50000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        maxFeePerGas: pinnedFeePerGas,
        maxPriorityFeePerGas: pinnedPriorityFeePerGas
      };

      mockKernelClient.prepareUserOperation.mockResolvedValue(gasLimits);
      mockKernelClient.sendUserOperation.mockResolvedValue(
        '0xhash' as `0x${string}`
      );
      mockKernelClient.waitForUserOperationReceipt.mockResolvedValue({
        receipt: { blockNumber: 1n, transactionHash: '0xtx' as `0x${string}` }
      });

      await sendKernelUserOperation({
        authorizedAccount: mockAuthorizedAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall,
        gasLimits
      });

      const { createKernelAccountClient } = await import('@zerodev/sdk');
      const capturedConfig = vi.mocked(createKernelAccountClient).mock
        .calls[0][0] as any;
      const estimateFeesPerGas =
        capturedConfig.userOperation?.estimateFeesPerGas;
      expect(estimateFeesPerGas).toBeDefined();
      await expect(estimateFeesPerGas({})).resolves.toEqual({
        maxFeePerGas: pinnedFeePerGas,
        maxPriorityFeePerGas: pinnedPriorityFeePerGas
      });
    });
  });

  describe('getKernelGasCostEstimate', () => {
    it('gets a gas cost estimate successfully', async () => {
      const estimatedGas: GasCostEstimate = {
        callGasLimit: 50000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };

      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: estimatedGas.callGasLimit,
        preVerificationGas: estimatedGas.preVerificationGas,
        verificationGasLimit: estimatedGas.verificationGasLimit,
        maxFeePerGas: estimatedGas.maxFeePerGas,
        maxPriorityFeePerGas: estimatedGas.maxPriorityFeePerGas
      });

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      const result = await getKernelGasCostEstimate(config);

      expect(result).toEqual(estimatedGas);

      expect(mockReadOnlyAccount.getReadOnlyKernelAccount).toHaveBeenCalled();

      const { createKernelAccountClient } = await import('@zerodev/sdk');
      expect(createKernelAccountClient).toHaveBeenCalledWith(
        expect.objectContaining({
          userOperation: expect.objectContaining({
            estimateFeesPerGas: expect.any(Function)
          })
        })
      );

      expect(mockAccount.encodeCalls).toHaveBeenCalledWith([
        testUserOperationCall
      ]);
      expect(mockKernelClient.prepareUserOperation).toHaveBeenCalledWith({
        callData: '0xencodedCallData'
        // No explicit verificationGasLimit for secp256k1 (default)
      });
    });

    it('returns a non-zero gas estimate', async () => {
      const estimatedGas: GasCostEstimate = {
        callGasLimit: 100000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };

      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: estimatedGas.callGasLimit,
        preVerificationGas: estimatedGas.preVerificationGas,
        verificationGasLimit: estimatedGas.verificationGasLimit,
        maxFeePerGas: estimatedGas.maxFeePerGas,
        maxPriorityFeePerGas: estimatedGas.maxPriorityFeePerGas
      });

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      const result = await getKernelGasCostEstimate(config);

      expect(result.callGasLimit).toBeGreaterThan(0n);
      expect(result.preVerificationGas).toBeGreaterThan(0n);
      expect(result.verificationGasLimit).toBeGreaterThan(0n);
      expect(result).toEqual(estimatedGas);
    });

    it('preserves paymaster gas fields when present', async () => {
      const estimatedGas: GasCostEstimate = {
        callGasLimit: 50000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        paymasterVerificationGasLimit: 35000n as PaymasterVerificationGasLimit,
        paymasterPostOpGasLimit: 15000n as PaymasterPostOpGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };

      mockKernelClient.prepareUserOperation.mockResolvedValue({
        callGasLimit: estimatedGas.callGasLimit,
        preVerificationGas: estimatedGas.preVerificationGas,
        verificationGasLimit: estimatedGas.verificationGasLimit,
        paymasterVerificationGasLimit:
          estimatedGas.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: estimatedGas.paymasterPostOpGasLimit,
        maxFeePerGas: estimatedGas.maxFeePerGas,
        maxPriorityFeePerGas: estimatedGas.maxPriorityFeePerGas
      });

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      const result = await getKernelGasCostEstimate(config);

      expect(result).toEqual(estimatedGas);
    });

    it('handles different user operation calls', async () => {
      const estimatedGas1: GasCostEstimate = {
        callGasLimit: 50000n as CallGasLimit,
        preVerificationGas: 21000n as PreVerificationGas,
        verificationGasLimit: 100000n as VerificationGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };
      const estimatedGas2: GasCostEstimate = {
        callGasLimit: 75000n as CallGasLimit,
        preVerificationGas: 25000n as PreVerificationGas,
        verificationGasLimit: 120000n as VerificationGasLimit,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      };

      const userOpCall1: UserOperationCall = {
        to: '0x1111111111111111111111111111111111111111' as EvmAddress,
        value: 1000n as UserOperationValue,
        data: '0x' as UserOperationData
      };

      const userOpCall2: UserOperationCall = {
        to: '0x2222222222222222222222222222222222222222' as EvmAddress,
        value: 2000n as UserOperationValue,
        data: '0x1234' as UserOperationData
      };

      mockKernelClient.prepareUserOperation
        .mockResolvedValueOnce({
          callGasLimit: estimatedGas1.callGasLimit,
          preVerificationGas: estimatedGas1.preVerificationGas,
          verificationGasLimit: estimatedGas1.verificationGasLimit,
          maxFeePerGas: estimatedGas1.maxFeePerGas,
          maxPriorityFeePerGas: estimatedGas1.maxPriorityFeePerGas
        })
        .mockResolvedValueOnce({
          callGasLimit: estimatedGas2.callGasLimit,
          preVerificationGas: estimatedGas2.preVerificationGas,
          verificationGasLimit: estimatedGas2.verificationGasLimit,
          maxFeePerGas: estimatedGas2.maxFeePerGas,
          maxPriorityFeePerGas: estimatedGas2.maxPriorityFeePerGas
        });

      const config1: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: userOpCall1
      };

      const config2: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: userOpCall2
      };

      const result1 = await getKernelGasCostEstimate(config1);
      const result2 = await getKernelGasCostEstimate(config2);

      expect(result1).toEqual(estimatedGas1);
      expect(result2).toEqual(estimatedGas2);
      expect(mockAccount.encodeCalls).toHaveBeenCalledTimes(2);
    });

    it('propagates errors from getReadOnlyKernelAccount', async () => {
      vi.mocked(
        mockReadOnlyAccount.getReadOnlyKernelAccount
      ).mockImplementation(() => {
        throw new Error('Failed to get read-only account');
      });

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(getKernelGasCostEstimate(config)).rejects.toThrow(
        'Failed to get read-only account'
      );
    });

    it('propagates errors from prepareUserOperation', async () => {
      mockKernelClient.prepareUserOperation.mockRejectedValue(
        new Error('Failed to estimate gas')
      );

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: mockReadOnlyAccount,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(getKernelGasCostEstimate(config)).rejects.toThrow(
        'Failed to estimate gas'
      );
    });

    it('throws error when read-only account has no kernel account', async () => {
      const accountWithNoKernel = {
        address: testAccountId.address as EvmAddress,
        getReadOnlyKernelAccount: () => {
          throw new Error(
            'ZeroDev Kernel account not initialized for this account type'
          );
        }
      };

      const config: GetGasCostEstimateConfig = {
        readOnlyAccount: accountWithNoKernel as any,
        publicClient: mockPublicClient as PublicClient,
        bundlerConfig: mockBundlerConfig,
        userOperationCall: testUserOperationCall
      };

      await expect(getKernelGasCostEstimate(config)).rejects.toThrow(
        'ZeroDev Kernel account not initialized for this account type'
      );
    });
  });
});
