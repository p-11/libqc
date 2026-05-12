import { encodeFunctionData, erc20Abi, PublicClient } from 'viem';
import type { AuthorizedAccount, ReadOnlyAccount } from './account';
import { Activity, ActivityType } from './activities';
import { BundlerConfig } from './bundler';
import {
  EvmAddress,
  BlockNumber,
  GasCostEstimate,
  TransactionValue,
  UserOperationCall,
  UserOperationData,
  UserOperationValue
} from './types';
import { getKernelGasCostEstimate, sendKernelUserOperation } from './zeroDev';

/**
 * Configuration for sending a transfer
 */
export interface SendTransferConfig {
  /** The authorized account to send from */
  authorizedAccount: AuthorizedAccount;
  /** The amount to transfer */
  amount: TransactionValue;
  /** The destination address */
  to: EvmAddress;
  /** Optional ERC-20 token address (omit for native token) */
  token?: EvmAddress;
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
  /** Pre-computed gas limits; when provided, bypasses eth_estimateUserOperationGas */
  gasLimits?: GasCostEstimate;
}

/**
 * Result of a completed transfer (ENG-170).
 */
export type SendTransferResult = {
  activity: Activity;
  txHash: `0x${string}`;
  userOpHash: `0x${string}`;
};

/**
 * Sends a transfer transaction
 *
 * Handles both native token transfers and ERC-20 token transfers.
 *
 * @param config The transfer configuration
 * @returns The transfer result with activity and on-chain tx identifiers
 *
 * @throws {Error} If the transaction fails to send
 */
export async function sendTransfer({
  authorizedAccount,
  amount,
  to,
  token,
  publicClient,
  bundlerConfig,
  gasLimits
}: SendTransferConfig): Promise<SendTransferResult> {
  const fromAddress = authorizedAccount.getAddress();

  const result = await sendKernelUserOperation({
    publicClient,
    bundlerConfig,
    authorizedAccount,
    userOperationCall: prepareTransferUserOperationCall({
      token,
      destinationAddress: to,
      amount
    }),
    gasLimits
  });

  const blockNumber = result.receipt.blockNumber as BlockNumber;
  const txHash = result.receipt.transactionHash;
  const userOpHash = result.userOpHash;
  const explorerBase = publicClient.chain?.blockExplorers?.default.url ?? null;
  const explorerUrl = explorerBase ? `${explorerBase}/tx/${txHash}` : null;

  const activity: Activity = token
    ? {
        type: ActivityType.Erc20Transaction,
        blockNumber,
        data: {
          from: fromAddress,
          to,
          value: amount,
          contract: token,
          txHash,
          explorerUrl
        }
      }
    : {
        type: ActivityType.NativeTransaction,
        blockNumber,
        data: { from: fromAddress, to, value: amount, txHash, explorerUrl }
      };

  return { activity, txHash, userOpHash };
}

type TransferGasCostEstimateParams = {
  /** The read-only account to use for estimation */
  readOnlyAccount: ReadOnlyAccount;
  /** The destination address or domain name */
  to: EvmAddress;
  /** Optional ERC-20 token address (omit for native token) */
  token?: EvmAddress;
  /** The amount to transfer */
  amount: TransactionValue;
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
};

/**
 * Get the estimated gas cost for a transfer
 *
 * @param config The gas cost estimate configuration
 * @returns The gas cost estimate
 */
export async function getTransferGasCostEstimate({
  readOnlyAccount,
  to,
  token,
  amount,
  publicClient,
  bundlerConfig
}: TransferGasCostEstimateParams): Promise<GasCostEstimate> {
  return await getKernelGasCostEstimate({
    publicClient,
    bundlerConfig,
    readOnlyAccount,
    userOperationCall: prepareTransferUserOperationCall({
      token,
      destinationAddress: to,
      amount
    })
  });
}

type TransferUserOperation = {
  /** Optional ERC-20 token address (omit for native token) */
  token?: EvmAddress;
  /** The destination address */
  destinationAddress: EvmAddress;
  /** The amount to transfer */
  amount: TransactionValue;
};

/**
 * Prepares a transfer into a user operation call
 *
 * @param transfer The transfer to prepare
 * @returns The user operation call
 */
function prepareTransferUserOperationCall(
  transfer: TransferUserOperation
): UserOperationCall {
  return transfer.token
    ? {
        to: transfer.token,
        value: 0n as UserOperationValue,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [transfer.destinationAddress, transfer.amount]
        }) as UserOperationData
      }
    : {
        to: transfer.destinationAddress,
        value: transfer.amount as unknown as UserOperationValue,
        data: '0x' as const as UserOperationData
      };
}
