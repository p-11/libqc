import { ChainId } from 'caip';
import type { AssetId } from './types';

/**
 * Error thrown when an asset entity is not found
 */
export class AssetEntityNotFoundError extends Error {
  constructor(assetId: AssetId, chainId: ChainId) {
    super(
      `Entity not found for asset ${assetId} on chain ${chainId.toString()}`
    );
  }
}

/**
 * Error thrown when trying to get the balance of a non-ERC-20 token
 */
export class NonErc20TokenBalanceError extends Error {
  constructor(assetId: AssetId, chainId: ChainId) {
    super(
      `Non-ERC-20 token ${assetId} on chain ${chainId.toString()} is not supported`
    );
  }
}

/**
 * Error throw when an invalid password format is provided
 */
export class InvalidPasswordFormatError extends Error {
  constructor(reason: string) {
    super(`Invalid password format: ${reason}`);
  }
}

/**
 * Error thrown when an existing password is required but not provided
 */
export class ExistingPasswordRequiredError extends Error {
  constructor() {
    super('Existing password is required');
  }
}

/**
 * Error thrown when an existing password does not match the stored password
 */
export class ExistingPasswordMismatchError extends Error {
  constructor() {
    super('Existing password does not match');
  }
}

/**
 * Error thrown when no password has been set (i.e. no encrypted vault exists)
 */
export class NoPasswordSetError extends Error {
  constructor() {
    super('No password has been set');
  }
}

/**
 * Error thrown when an operation is attempted while the vault is locked
 */
export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked. Call unlock() with the correct password first.');
  }
}

/**
 * Error thrown when decryption fails due to an incorrect password
 */
export class IncorrectPasswordError extends Error {
  constructor() {
    super('Incorrect password');
  }
}

/**
 * Error thrown when vault data is structurally invalid (e.g. bad base64, wrong IV length)
 */
export class VaultCorruptedError extends Error {
  constructor(reason: string) {
    super(`Vault data is corrupted: ${reason}`);
  }
}

/**
 * Error thrown when attempting to encrypt an empty plaintext
 */
export class EmptyPlaintextError extends Error {
  constructor() {
    super('Cannot encrypt empty plaintext');
  }
}

/**
 * Error thrown when key derivation fails (e.g. Web Crypto importKey rejection)
 */
export class KeyDerivationError extends Error {
  constructor(reason: string) {
    super(`Key derivation failed: ${reason}`);
  }
}

/**
 * Error thrown when the Web Crypto CSPRNG (globalThis.crypto.getRandomValues)
 * is not available in the current runtime environment
 */
export class CsprngUnavailableError extends Error {
  constructor() {
    super(
      'Cryptographically secure random number generator is unavailable. ' +
        'globalThis.crypto.getRandomValues is required but was not found. ' +
        'Ensure you are running in a supported environment ' +
        '(modern browser or Node.js >= 19).'
    );
  }
}

/**
 * Error thrown when an asset has invalid decimal configuration
 */
export class InvalidAssetDecimalsError extends Error {
  constructor(reason: string) {
    super(`Invalid asset decimals: ${reason}`);
  }
}

/**
 * Error thrown when an asset has missing or invalid metadata
 */
export class InvalidAssetMetadataError extends Error {
  constructor(reason: string) {
    super(`Invalid asset metadata: ${reason}`);
  }
}

/**
 * Error thrown when on-chain decimals do not match the entity decimals
 * configured in assets.json
 */
export class OnChainDecimalsMismatchError extends Error {
  constructor(
    assetId: AssetId,
    chainId: ChainId,
    entityDecimals: number,
    onChainDecimals: number
  ) {
    super(
      `On-chain decimals (${onChainDecimals}) for asset ${assetId} on chain ${chainId.toString()} do not match entity decimals (${entityDecimals})`
    );
  }
}

/**
 * Error thrown when an asset type is not supported
 */
export class UnsupportedAssetTypeError extends Error {
  constructor(assetId: AssetId, chainId: ChainId) {
    super(
      `Unsupported asset type for asset ${assetId} on chain ${chainId.toString()}. Only native and ERC-20 assets are supported for transfers.`
    );
  }
}

/**
 * Error thrown when an invalid destination address is provided
 */
export class InvalidDestinationAddressError extends Error {
  constructor(address: string) {
    super(`Invalid destination address: ${address}`);
  }
}

/**
 * Error thrown when a vault has no withdrawable assets
 */
export class NoWithdrawableAssetsError extends Error {
  constructor(accountId: string) {
    super(`No withdrawable assets found for account ${accountId}`);
  }
}

/**
 * Error thrown when the native asset balance is too small to cover gas costs
 */
export class InsufficientNativeBalanceForGasError extends Error {
  constructor(accountId: string) {
    super(
      `Native asset balance for account ${accountId} is insufficient to cover gas costs`
    );
  }
}

/**
 * Error thrown when a PublicClient is missing required chain information
 *
 * This occurs when a PublicClient is created without a chain or the chain
 * doesn't have an id property. All blockchain operations require a valid
 * chain to determine which network to interact with.
 */
export class MissingChainError extends Error {
  constructor() {
    super(
      'PublicClient must have a chain with an id. Ensure the client was created with a valid chain configuration.'
    );
  }
}

/**
 * Error thrown when an operation is not supported by the ML-DSA-44 validator
 */
export class NotSupportedByMlDsa44ValidatorError extends Error {
  constructor(operation: string) {
    super(`${operation} is not supported by ML-DSA-44 validator`);
  }
}

/**
 * Error thrown when attempting to sign with an ML-DSA-44 stub signer
 */
export class MlDsa44StubSignerError extends Error {
  constructor() {
    super('Cannot sign with ML-DSA-44 stub signer');
  }
}

/**
 * Error thrown when ML-DSA-44 private key is missing from persisted address
 */
export class MlDsa44PrivateKeyMissingError extends Error {
  constructor() {
    super(
      'ML-DSA-44 private key not found in persisted address. Keys must be derived before creating authorized account.'
    );
  }
}

/**
 * Error thrown when ML-DSA-44 public key hash is missing from persisted address
 */
export class MlDsa44PublicKeyHashMissingError extends Error {
  constructor() {
    super(
      'ML-DSA-44 public key hash not found in persisted address. Keys must be derived before creating read-only account.'
    );
  }
}

/**
 * Error thrown when ML-DSA-44 public key hash mismatch occurs
 */
export class MlDsa44PublicKeyHashMismatchError extends Error {
  constructor() {
    super(
      'ML-DSA-44 public key hash mismatch: derived public key hash does not match stored value'
    );
  }
}

/**
 * Error thrown when ZeroDev Kernel account is not initialized
 */
export class KernelAccountNotInitializedError extends Error {
  constructor() {
    super('ZeroDev Kernel account not initialized for this account type');
  }
}

/**
 * Error thrown when attempting to set a validator that is already in use
 */
export class AlreadyUsingValidatorError extends Error {
  constructor(validatorType: string) {
    super(`Account is already using ${validatorType} validator`);
  }
}

/**
 * Error thrown when mnemonic is required but not available
 */
export class MnemonicRequiredError extends Error {
  constructor(operation: string) {
    super(`Mnemonic is required to ${operation}`);
  }
}

/**
 * Error thrown when a validator switch user operation fails
 */
export class ValidatorSwitchFailedError extends Error {
  constructor() {
    super('User operation for validator switch failed');
  }
}

/**
 * Error thrown when no address is found at the specified index
 */
export class AddressNotFoundAtIndexError extends Error {
  constructor(index: number, expectedAddress: string) {
    super(`No address found at index ${index}. Expected: ${expectedAddress}`);
  }
}

/**
 * Error thrown when address at index does not match expected address
 */
export class AddressIndexMismatchError extends Error {
  constructor(index: number, expectedAddress: string, actualAddress: string) {
    super(
      `Address at index ${index} does not match expected address ${expectedAddress}. Found: ${actualAddress}`
    );
  }
}

/**
 * Error thrown when a withdrawal record cannot be located by id.
 */
export class WithdrawalRecordNotFoundError extends Error {
  constructor(id: string) {
    super(`Withdrawal record not found: ${id}`);
  }
}
