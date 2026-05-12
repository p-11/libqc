import { AccountId } from 'caip';
import { type PublicClient } from 'viem';
import { KernelAccountNotInitializedError } from '../../errors';
import { type EvmPersistedAddress } from '../../state';
import type { EvmAddress } from '../../types';
import {
  createSecp256k1StubSigner,
  DEFAULT_ENTRY_POINT,
  DEFAULT_KERNEL_VERSION,
  generateReadOnlyKernelAccount,
  type KernelStubAuth,
  type ReadOnlyKernelAccount
} from '../../zeroDev/accounts';
import { ValidatorType, type ValidatorConfig } from './config';
import type { ReadOnlyAccount } from './types';

/**
 * Concrete implementation of ReadOnlyAccount for Secp256k1 validator
 *
 * This class encapsulates all the logic for creating and managing
 * a read-only account using the Secp256k1 ECDSA validator with a stub signer.
 */
class Secp256k1ReadOnlyAccount implements ReadOnlyAccount {
  public readonly accountId: AccountId;
  private readonly readOnlyKernelAccount?: ReadOnlyKernelAccount;

  /**
   * Private constructor - use static create() method instead
   *
   * @param accountId The account ID
   * @param readOnlyKernelAccount The underlying kernel account (optional for forward compatibility)
   */
  private constructor(
    accountId: AccountId,
    readOnlyKernelAccount?: ReadOnlyKernelAccount
  ) {
    this.accountId = accountId;
    this.readOnlyKernelAccount = readOnlyKernelAccount;
  }

  /**
   * Create a new Secp256k1ReadOnlyAccount
   *
   * @param publicClient The public client for blockchain interactions
   * @param persistedAddress The persisted address data containing public key hash
   * @returns A new Secp256k1ReadOnlyAccount instance
   *
   * @throws {Error} If persistedAddress.secp256k1PublicKeyHash is undefined or invalid.
   *                 This is a critical failure point as the public key hash is required for gas estimation.
   * @throws {MissingChainError} If publicClient.chain is undefined or doesn't have an id
   */
  public static async create(
    publicClient: PublicClient,
    accountId: AccountId,
    persistedAddress: EvmPersistedAddress
  ): Promise<Secp256k1ReadOnlyAccount> {
    try {
      const stubSigner = createSecp256k1StubSigner(
        persistedAddress.secp256k1PublicKeyHash
      );
      const stubAuth: KernelStubAuth = {
        type: ValidatorType.SECP256k1,
        stubSigner
      };

      const readOnlyKernelAccount = await generateReadOnlyKernelAccount(
        publicClient,
        stubAuth,
        DEFAULT_KERNEL_VERSION,
        DEFAULT_ENTRY_POINT,
        persistedAddress.address,
        persistedAddress.index
      );

      return new Secp256k1ReadOnlyAccount(accountId, readOnlyKernelAccount);
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
   * Get the read-only kernel account for estimation operations
   *
   * @returns The kernel account
   * @throws Error if ZeroDev Kernel account is not initialized
   */
  public getReadOnlyKernelAccount(): ReadOnlyKernelAccount {
    if (!this.readOnlyKernelAccount) {
      throw new KernelAccountNotInitializedError();
    }
    return this.readOnlyKernelAccount;
  }
}

/**
 * Get a read-only account for the specified validator type
 *
 * Factory function that creates the appropriate read-only account
 * implementation based on the validator configuration.
 *
 * The chain ID is inferred from the publicClient's chain configuration.
 *
 * @param publicClient The public client for blockchain interactions
 * @param persistedAddress The persisted address data
 * @param validatorConfig The validator configuration
 * @returns A read-only account implementation
 *
 * @throws {Error} If the validator type is not supported
 * @throws {MissingChainError} If publicClient.chain is undefined or doesn't have an id
 */
export async function getReadOnlyAccount(
  publicClient: PublicClient,
  accountId: AccountId,
  persistedAddress: EvmPersistedAddress,
  _validatorConfig: ValidatorConfig
): Promise<ReadOnlyAccount> {
  return Secp256k1ReadOnlyAccount.create(
    publicClient,
    accountId,
    persistedAddress
  );
}
