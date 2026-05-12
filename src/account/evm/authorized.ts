import { AccountId } from 'caip';
import { type PublicClient } from 'viem';
import { createPrivateKeyAccount } from './utils';
import { KernelAccountNotInitializedError } from '../../errors';
import { type EvmPersistedAddress } from '../../state';
import type { LibQCStorage } from '../../storage';
import type { EvmAddress } from '../../types';
import {
  DEFAULT_ENTRY_POINT,
  DEFAULT_KERNEL_VERSION,
  generateAuthorizedKernelAccount,
  type AuthorizedKernelAccount,
  type KernelAuth
} from '../../zeroDev/accounts';
import { ValidatorType, type ValidatorConfig } from './config';
import type { AuthorizedAccount } from './types';

/**
 * Concrete implementation of AuthorizedAccount for Secp256k1 validator
 *
 * This class encapsulates all the logic for creating and managing
 * an authorized account using the Secp256k1 ECDSA validator.
 */
class Secp256k1AuthorizedAccount implements AuthorizedAccount {
  public readonly accountId: AccountId;
  private readonly authorizedKernelAccount?: AuthorizedKernelAccount;

  /**
   * Private constructor - use static create() method instead
   *
   * @param accountId The account ID
   * @param authorizedKernelAccount The underlying kernel account (optional for forward compatibility)
   */
  private constructor(
    accountId: AccountId,
    authorizedKernelAccount?: AuthorizedKernelAccount
  ) {
    this.accountId = accountId;
    this.authorizedKernelAccount = authorizedKernelAccount;
  }

  /**
   * Create a new Secp256k1AuthorizedAccount
   *
   * @param publicClient The public client for blockchain interactions
   * @param persistedAddress The persisted address data containing private key
   * @param storage Storage for persisting derived keys
   * @returns A new Secp256k1AuthorizedAccount instance
   *
   * @throws {Error} If persistedAddress.secp256k1PrivateKey is undefined or invalid.
   *                 This is a critical failure point as the private key is required for signing.
   * @throws {MissingChainError} If publicClient.chain is undefined or doesn't have an id
   */
  public static async create(
    publicClient: PublicClient,
    accountId: AccountId,
    persistedAddress: EvmPersistedAddress,
    _storage: LibQCStorage
  ): Promise<Secp256k1AuthorizedAccount> {
    // Note: storage parameter currently unused for Secp256k1 because we currently
    // don't delete Secp256k1 keys, but may be used in future if key deletion is supported

    try {
      // Use our secure implementation that avoids creating immutable hex strings in memory.
      const signer = createPrivateKeyAccount(
        new Uint8Array(persistedAddress.secp256k1PrivateKey)
      );
      const auth: KernelAuth = {
        type: ValidatorType.SECP256k1,
        signer
      };

      const authorizedKernelAccount = await generateAuthorizedKernelAccount(
        publicClient,
        auth,
        DEFAULT_KERNEL_VERSION,
        DEFAULT_ENTRY_POINT,
        persistedAddress.address,
        persistedAddress.index
      );

      return new Secp256k1AuthorizedAccount(accountId, authorizedKernelAccount);
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Get the account address as an Address type
   *
   * @returns The account address as an Address type
   */
  public getAddress(): EvmAddress {
    return this.accountId.address as EvmAddress;
  }

  /**
   * Get the authorized kernel account for signing operations
   *
   * @returns The kernel account with validator
   * @throws Error if ZeroDev Kernel account is not initialized
   */
  public getAuthorizedKernelAccount(): AuthorizedKernelAccount {
    if (!this.authorizedKernelAccount) {
      throw new KernelAccountNotInitializedError();
    }
    return this.authorizedKernelAccount;
  }
}

/**
 * Get an authorized account for the specified validator type
 *
 * Factory function that creates the appropriate authorized account
 * implementation based on the validator configuration.
 *
 * The chain ID is inferred from the publicClient's chain configuration.
 *
 * @param publicClient The public client for blockchain interactions
 * @param accountId The account ID
 * @param persistedAddress The persisted address data
 * @param validatorConfig The validator configuration
 * @param storage Storage for persisting derived keys
 * @returns An authorized account implementation
 *
 * @throws {Error} If the validator type is not supported
 * @throws {MissingChainError} If publicClient.chain is undefined or doesn't have an id
 */
export async function getAuthorizedAccount(
  publicClient: PublicClient,
  accountId: AccountId,
  persistedAddress: EvmPersistedAddress,
  _validatorConfig: ValidatorConfig,
  storage: LibQCStorage
): Promise<AuthorizedAccount> {
  return Secp256k1AuthorizedAccount.create(
    publicClient,
    accountId,
    persistedAddress,
    storage
  );
}
