/**
 * ZeroDev Transaction and Transfer Logic
 *
 * This module handles the creation, estimation, and submission of UserOperations
 * for ZeroDev Kernel smart accounts.
 *
 * FEE ESTIMATION NOTE:
 * UserOperation gas units are estimated by the bundler via eth_estimateUserOperationGas,
 * but fee prices (maxFeePerGas/maxPriorityFeePerGas) are read from the execution RPC via
 * publicClient.estimateFeesPerGas. This keeps fee values consistent between the estimation
 * pass and the send pass, which matters for emptyVault sweep reserve calculations.
 */
import { createKernelAccountClient } from '@zerodev/sdk';
import type { Client, PublicClient } from 'viem';

import type { AuthorizedAccount, ReadOnlyAccount } from '../account/evm';
import type { BundlerConfig } from '../bundler';
import { MissingChainError } from '../errors';
import { makeBundlerTransport } from '../transports';
import { GasCostEstimate, UserOperationCall } from '../types';

/**
 * Result of sending a kernel operation
 */
export interface KernelUserOperationResult {
  /** The user operation hash */
  userOpHash: `0x${string}`;
  /** The transaction receipt */
  receipt: {
    blockNumber: bigint;
    /** Actual on-chain transaction hash (ENG-170) */
    transactionHash: `0x${string}`;
  };
}

/**
 * Configuration for sending a kernel user operation
 */
export interface SendKernelUserOperationConfig {
  /** The authorized account to use for signing */
  authorizedAccount: AuthorizedAccount;
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
  /** The user operation call to send */
  userOperationCall: UserOperationCall;
  /** Gas limits from a prior estimation pass. When provided, viem skips
   * eth_estimateUserOperationGas required for native sweeps, where bundler
   * prefund deduction causes a full-balance transfer to revert. */
  gasLimits?: GasCostEstimate;
}

interface PimlicoGasPrice {
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

interface PimlicoGetUserOperationGasPrice {
  Method: 'pimlico_getUserOperationGasPrice';
  Parameters?: never;
  ReturnType: {
    slow: PimlicoGasPrice;
    standard: PimlicoGasPrice;
    fast: PimlicoGasPrice;
  };
}

async function getFeesPerGas(
  bundlerClient: Client
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const suggestions =
    await bundlerClient.request<PimlicoGetUserOperationGasPrice>({
      method: 'pimlico_getUserOperationGasPrice'
    });

  return {
    maxFeePerGas: BigInt(suggestions.standard.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(suggestions.standard.maxPriorityFeePerGas)
  };
}

/**
 * Sends a user operation using ZeroDev Kernel smart account
 *
 * This is the ZeroDev-specific implementation for sending user operations
 *
 * @param config The user operation configuration
 * @returns The user operation hash and receipt
 *
 * @throws {MissingChainError} If publicClient does not have a chain configured
 * @throws {Error} If the transaction fails to send
 */
export async function sendKernelUserOperation({
  publicClient,
  bundlerConfig,
  authorizedAccount,
  userOperationCall,
  gasLimits
}: SendKernelUserOperationConfig): Promise<KernelUserOperationResult> {
  // Get the kernel account from the authorized account
  const authorizedKernelAccount =
    authorizedAccount.getAuthorizedKernelAccount();

  // Validate chain is present
  if (!publicClient.chain) {
    throw new MissingChainError();
  }

  // Create kernel account client - this is the proper way to send user operations with ZeroDev
  // When gasLimits is provided (emptyVault path), pin maxFeePerGas to the value from
  // estimation so the prefund calculation and the signed UserOp use the same price.
  // Re-fetching here would open a race where a price increase between estimate and send
  // causes amountToSend to exceed the balance remaining after the actual prefund.
  const kernelClient = createKernelAccountClient({
    account: authorizedKernelAccount.account,
    chain: publicClient.chain,
    bundlerTransport:
      bundlerConfig.httpSigningRef !== undefined
        ? makeBundlerTransport(bundlerConfig.urls, bundlerConfig.headers, {
            httpSigningRef: bundlerConfig.httpSigningRef
          })
        : makeBundlerTransport(bundlerConfig.urls, bundlerConfig.headers),
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: gasLimits
        ? () =>
            Promise.resolve({
              maxFeePerGas: gasLimits.maxFeePerGas,
              maxPriorityFeePerGas: gasLimits.maxPriorityFeePerGas
            })
        : ({ bundlerClient }) => getFeesPerGas(bundlerClient)
    }
  });

  const callData = await authorizedKernelAccount.account.encodeCalls([
    userOperationCall
  ]);

  const op = (await kernelClient.prepareUserOperation({
    callData,
    ...(gasLimits && {
      callGasLimit: gasLimits.callGasLimit,
      verificationGasLimit: gasLimits.verificationGasLimit,
      preVerificationGas: gasLimits.preVerificationGas
    })
  })) as unknown as GasCostEstimate;

  const sendArgs = {
    callData,
    callGasLimit: op.callGasLimit,
    preVerificationGas: op.preVerificationGas,
    verificationGasLimit: op.verificationGasLimit,
    ...(op.paymasterVerificationGasLimit !== undefined
      ? { paymasterVerificationGasLimit: op.paymasterVerificationGasLimit }
      : {}),
    ...(op.paymasterPostOpGasLimit !== undefined
      ? { paymasterPostOpGasLimit: op.paymasterPostOpGasLimit }
      : {})
  };

  const userOpHash = await kernelClient.sendUserOperation(sendArgs);

  // P11TODO: make call whether to wait for the transaction to be mined or not
  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash
  });

  return {
    userOpHash,
    receipt: {
      blockNumber: receipt.receipt.blockNumber,
      transactionHash: receipt.receipt.transactionHash
    }
  };
}

export interface GetGasCostEstimateConfig {
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** The read-only account to use for estimation */
  readOnlyAccount: ReadOnlyAccount;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
  /** The user operation call to estimate the gas cost for */
  userOperationCall: UserOperationCall;
}

/**
 * Gets a gas cost estimate for a user operation
 *
 * This is the ZeroDev-specific implementation for getting a gas cost estimate for a user operation
 *
 * @param config The gas cost estimate configuration
 * @returns The gas cost estimate
 *
 * @throws {MissingChainError} If publicClient does not have a chain configured
 * @throws {Error} If the gas cost estimate fails to be retrieved
 */
export async function getKernelGasCostEstimate({
  publicClient,
  bundlerConfig,
  readOnlyAccount,
  userOperationCall
}: GetGasCostEstimateConfig): Promise<GasCostEstimate> {
  // Get the kernel account from the read-only account
  const account = readOnlyAccount.getReadOnlyKernelAccount();

  // Validate chain is present
  if (!publicClient.chain) {
    throw new MissingChainError();
  }

  const kernelClient = createKernelAccountClient({
    account,
    chain: publicClient.chain,
    bundlerTransport:
      bundlerConfig.httpSigningRef !== undefined
        ? makeBundlerTransport(bundlerConfig.urls, bundlerConfig.headers, {
            httpSigningRef: bundlerConfig.httpSigningRef
          })
        : makeBundlerTransport(bundlerConfig.urls, bundlerConfig.headers),
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: ({ bundlerClient }) => getFeesPerGas(bundlerClient)
    }
  });

  const callData = await kernelClient.account.encodeCalls([userOperationCall]);

  const op = (await kernelClient.prepareUserOperation({
    callData
  })) as unknown as GasCostEstimate;

  return op;
}
