import { AccountId } from 'caip';
import type { PublicClient } from 'viem';
import type { BundlerConfig } from '../../bundler';
import type { EvmAddress } from '../../types';
import type {
  AuthorizedKernelAccount,
  ReadOnlyKernelAccount
} from '../../zeroDev/accounts';

/**
 * Interface for an authorized account that can sign transactions
 *
 * This interface provides an abstraction layer for accounts with signing capabilities,
 * designed to support multiple Account Abstraction (AA) providers (e.g., ZeroDev, Biconomy).
 *
 * @example
 * ```typescript
 * const account = await getAuthorizedAccount(publicClient, persistedAddress, validatorConfig);
 * const kernelAccount = account.getAuthorizedKernelAccount();
 * ```
 */
export interface AuthorizedAccount {
  readonly accountId: AccountId;
  getAddress(): EvmAddress;
  getAuthorizedKernelAccount(): AuthorizedKernelAccount;
}

/**
 * Interface for a read-only account that cannot sign transactions
 *
 * This interface provides an abstraction layer for accounts without signing capabilities,
 * designed to support multiple Account Abstraction (AA) providers (e.g., ZeroDev, Biconomy).
 *
 * @example
 * ```typescript
 * const account = await getReadOnlyAccount(publicClient, persistedAddress, validatorConfig);
 * const kernelAccount = account.getReadOnlyKernelAccount();
 * ```
 */
export interface ReadOnlyAccount {
  readonly accountId: AccountId;
  getAddress(): EvmAddress;
  getReadOnlyKernelAccount(): ReadOnlyKernelAccount;
}

/**
 * Configuration for switching validators
 */
export interface SetValidatorConfig {
  /** The authorized account with current validator */
  currentAuthorizedAccount: AuthorizedAccount;
  /** The authorized account with new validator */
  newAuthorizedAccount: AuthorizedAccount;
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
}
