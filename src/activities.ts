import { AccountId } from 'caip';
import { PublicClient } from 'viem';
import { BundlerConfig, getBundlerClient } from './bundler';
import {
  BitcoinAddress,
  BlockNumber,
  EvmAddress,
  GetActivityFilters,
  TransactionValue
} from './types';
import { getKernelActivities, getTokenActivities } from './zeroDev/activities';

/** EVM-specific activities - use in all ZeroDev code */
export type EvmActivity = NativeTransactionActivity | Erc20TransactionActivity;

/** Bitcoin-specific activity */
export type BitcoinTransactionActivityData = {
  /** Source addresses from all transaction inputs (vins); may be multiple for UTXO consolidation */
  from: BitcoinAddress[];
  to: BitcoinAddress;
  value: TransactionValue;
  txid: string;
  /** Block explorer URL for this transaction, or null if unavailable */
  explorerUrl: string | null;
};
export type BitcoinTransactionActivity = BaseActivity<
  ActivityType.BitcoinTransaction,
  BitcoinTransactionActivityData
>;
export type BitcoinActivity = BitcoinTransactionActivity;

/** Chain-agnostic union for AccountClientInterface.getActivities() */
export type Activity = EvmActivity | BitcoinActivity;

export enum ActivityType {
  NativeTransaction = 'NativeTransaction',
  Erc20Transaction = 'Erc20Transaction',
  BitcoinTransaction = 'BitcoinTransaction'
}

type BaseActivity<T, D> = {
  type: T;
  blockNumber: BlockNumber;
  data: D;
};

export type NativeTransactionActivity = BaseActivity<
  ActivityType.NativeTransaction,
  NativeTransactionActivityData
>;
export type Erc20TransactionActivity = BaseActivity<
  ActivityType.Erc20Transaction,
  Erc20TransactionActivityData
>;

export type NativeTransactionActivityData = {
  from: EvmAddress;
  to: EvmAddress;
  value: TransactionValue;
  txHash: `0x${string}` | null;
  explorerUrl: string | null;
};

export type Erc20TransactionActivityData = {
  from: EvmAddress;
  to: EvmAddress;
  value: TransactionValue;
  contract: EvmAddress;
  txHash: `0x${string}` | null;
  explorerUrl: string | null;
};

/**
 * Retrieves activity history for a smart wallet account
 *
 * This function fetches and aggregates on-chain activities for an account.
 *
 * The function:
 * 1. Fetches kernel-level activities (native transfers, validator changes, Atlas ops)
 * 2. Optionally fetches ERC-20 token transfer activities if token filters provided
 * 3. Applies type filters if specified
 * 4. Sorts all activities by block number
 *
 * @param account - The account identifier to get activities for
 * @param publicClient - Public client for reading blockchain state
 * @param bundlerConfig - Bundler configuration for accessing user operation data
 * @param filters - Optional filters to narrow down activities
 * @param filters.tokens - Array of ERC-20 token addresses to filter by
 * @param filters.types - Array of activity types to include
 * @returns Array of activities sorted by block number (most recent first)
 *
 * @example
 * ```typescript
 * // Get all activities
 * const allActivities = await getActivities(accountId, publicClient, bundlerConfig);
 *
 * // Get only token transfer activities
 * const tokenActivities = await getActivities(
 *   accountId,
 *   publicClient,
 *   bundlerConfig,
 *   { types: [ActivityType.Erc20Transaction] }
 * );
 *
 * // Get activities for specific tokens
 * const usdcActivities = await getActivities(
 *   accountId,
 *   publicClient,
 *   bundlerConfig,
 *   { tokens: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'] }
 * );
 * ```
 */
export async function getActivities(
  account: AccountId,
  publicClient: PublicClient,
  bundlerConfig: BundlerConfig,
  filters?: GetActivityFilters
): Promise<EvmActivity[]> {
  const bundlerClient = getBundlerClient(bundlerConfig);

  const kernelActivities = await getKernelActivities(
    publicClient,
    bundlerClient,
    account.address as EvmAddress
  );

  let activities = kernelActivities;

  if (filters?.tokens) {
    const tokens = filters.tokens.map(t => t.toLowerCase() as EvmAddress);

    const tokenActivities = await Promise.all(
      tokens.map(token =>
        getTokenActivities(publicClient, account.address as EvmAddress, token)
      )
    );

    activities = [
      ...activities.filter(activity => {
        if (activity.type === ActivityType.Erc20Transaction) {
          return tokens.includes(activity.data.contract);
        }

        return true;
      }),
      ...tokenActivities.flat()
    ];
  }

  if (filters?.types) {
    activities = activities.filter(activity =>
      filters.types!.includes(activity.type)
    );
  }

  // Naive sorting by blocknumber in descending order
  return activities.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));
}
