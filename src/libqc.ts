import { networks as bitcoinNetworks } from 'bitcoinjs-lib';
import { mnemonicToSeedSync, entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js'; // P11TODO: Support more languages
import { AccountId, ChainId } from 'caip';
import type { AccountClientInterface } from './account/client';
import { BitcoinAccountClient } from './account/bitcoin';
import { EsploraBitcoinApi } from './account/bitcoin/esplora';
import { EvmAccountClient } from './account/evm';
import {
  deriveBitcoinAddressFromSeed,
  generateAddressFromSeed
} from './addresses';
import {
  BITCOIN_TESTNET_REF,
  isBitcoinAddressForChain,
  isBitcoinChain,
  isEvmChain
} from './chain';
import {
  getAssetBySymbol,
  getNativeAsset,
  getSupportedAssets,
  normaliseBalance,
  validateAssetMetadata
} from './assets';
import type { BundlerConfig } from './bundler';
import {
  AddressVersion,
  CURRENT_DEFAULT_ADDRESS_VERSION,
  MAX_ACCOUNT_ITERATION,
  MIN_MNEMONIC_GUESSES,
  MNEMONIC_STRENGTH
} from './config';
import { base64 } from '@scure/base';
import {
  validateMnemonic,
  validatePassword,
  type VaultEncryptionKeyWithMetadata,
  type EncryptedVault,
  type ScryptParams,
  type ScryptSalt,
  deriveEncryptionKey,
  generateScryptSalt,
  mnemonicToEntropyBytes,
  getSecureRandomBytes
} from './cryptography';
import {
  AssetEntityNotFoundError,
  ExistingPasswordMismatchError,
  ExistingPasswordRequiredError,
  IncorrectPasswordError,
  InvalidPasswordFormatError,
  NonErc20TokenBalanceError,
  NoPasswordSetError,
  VaultLockedError
} from './errors';
import { generateRegisterAndPersistHttpSigning } from './httpSigning/provision';
import type { SignedHttpConfig } from './httpSigning/config';
import type { HttpSigningTransportRef } from './httpSigning/transportRef';
import {
  ChainSpecification,
  createEvmReadOnlyChainClients,
  EvmReadOnlyChainClients
} from './publicClients';
import { getErc20TokenDetails } from './publicReads';
import {
  type BitcoinPersistedAddress,
  type EvmPersistedAddress,
  type LibQCState,
  type PersistedAccount,
  type PersistedAddress,
  type PersistedHttpSigningCredentials,
  getStateSegment,
  resumeRotationIfInterrupted,
  rotateEncryptionKey,
  ROTATION_MARKER_KEY,
  ROTATION_STAGING_KEYS,
  setStateSegment,
  STATE_SEGMENT_KEYS,
  zeroLibQCState
} from './state';
import { AsyncMutex, LibQCStorage } from './storage';
import {
  EvmAddress,
  AddressIndex,
  Asset,
  BitcoinAddress,
  BalanceBigInt,
  BalanceResult,
  Decimals,
  Entropy,
  ForceNewAddress,
  Mnemonic,
  Password,
  Seed,
  type IsValidMnemonic,
  type IsValidPassword,
  type MnemonicGuess,
  type Symbol,
  type TokenDetails,
  type WithdrawalRecord
} from './types';
import { listWithdrawalRecords, replaceWithdrawalRecord } from './withdrawals';

export type BundlerConfigProvider = (chainId: ChainId) => BundlerConfig;

export type { SignedHttpConfig } from './httpSigning/config';
type MnemonicScopeCallback<T> = (mnemonic: Mnemonic) => Promise<T> | T;
type ReconcileableAccountClient = AccountClientInterface & {
  reconcileWithdrawalRecord(
    record: WithdrawalRecord
  ): Promise<WithdrawalRecord>;
};

function isReconcileableAccountClient(
  account: AccountClientInterface
): account is ReconcileableAccountClient {
  return (
    'reconcileWithdrawalRecord' in account &&
    typeof account.reconcileWithdrawalRecord === 'function'
  );
}

/**
 * Main LibQC client for managing smart wallet operations
 *
 * All sensitive state is encrypted at rest using AES-256-GCM. The user must
 * set a password (which creates the vault) and call unlock() before performing
 * any wallet operations.
 *
 * @example
 * ```typescript
 * const vault = new LibQC(storage, chains, bundlerConfigProvider);
 *
 * // First time setup
 * await vault.setPassword(password);
 * // vault is auto-unlocked after setPassword
 *
 * // Generate mnemonic
 * const mnemonic = await vault.generateMnemonic();
 *
 * // Returning user
 * await vault.unlock(password);
 * const accounts = await vault.listAccounts();
 * ```
 */
export default class LibQC {
  private publicClientRegistry: EvmReadOnlyChainClients;
  private bundlerConfigProvider: BundlerConfigProvider;
  private chains: ChainSpecification[];
  private encryptionKey?: VaultEncryptionKeyWithMetadata;
  private scryptParams?: ScryptParams;
  private readonly signedHttpConfig?: SignedHttpConfig;
  private readonly httpSigningTransportRef: HttpSigningTransportRef;
  private readonly storageLock = new AsyncMutex();

  /**
   * Creates a new LibQC client instance
   *
   * @param storage - Storage implementation for persisting wallet state
   * @param chains - Array of blockchain chain specifications to support
   * @param bundlerConfigProvider - Function that provides bundler config for a given chain
   * @param scryptParams - Optional scrypt parameters for key derivation (defaults to production-strength values)
   * @param signedHttp - Optional ML-DSA-65 signed JSON-RPC (register worker URL)
   *
   * @example
   * ```typescript
   * const vault = new LibQC(
   *   ...params
   * );
   */
  public constructor(
    private storage: LibQCStorage,
    chains: ChainSpecification[],
    bundlerConfigProvider: BundlerConfigProvider,
    scryptParams?: ScryptParams,
    signedHttp?: SignedHttpConfig
  ) {
    this.chains = chains;
    this.signedHttpConfig = signedHttp;
    this.httpSigningTransportRef = {
      signingEnabled: signedHttp !== undefined,
      vaultUnlocked: false,
      credentials: undefined
    };
    this.publicClientRegistry = createEvmReadOnlyChainClients(
      this.chains,
      signedHttp !== undefined ? this.httpSigningTransportRef : undefined
    );
    this.bundlerConfigProvider = bundlerConfigProvider;
    this.scryptParams = scryptParams;
  }

  /**
   * Validates mnemonic phrase formatting for LibQC import and derivation
   *
   * Accepts only 24-token phrases and normalizes whitespace/casing.
   *
   * @param mnemonic - The mnemonic bytes to validate
   * @returns Canonical normalized mnemonic phrase
   * @throws Error if mnemonic is invalid (including BIP-39 checksum failure)
   */
  public static validateMnemonic(mnemonic: Uint8Array): Mnemonic {
    return validateMnemonic(mnemonic);
  }

  /**
   * Unlocks the vault by deriving the encryption key from the password
   *
   * Reads the encrypted vault from storage, derives the key via scrypt,
   * and verifies the password by attempting decryption. On success the
   * derived key is cached for subsequent operations.
   *
   * @param password - Caller-owned password bytes; caller should wipe with
   * `fill(0)` once this call is complete and the password is no longer needed
   * @throws {NoPasswordSetError} If no vault exists yet
   * @throws {IncorrectPasswordError} If the password is wrong
   * @throws {KeyDerivationError} If key material import fails
   * @throws {VaultCorruptedError} If the stored vault data is structurally invalid
   * @remarks `unlock` runs entirely outside the storage lock (scrypt is slow).
   * A concurrent `clearState` can delete the vault between the existence check
   * here and the key being cached, in that case subsequent reads will throw.
   * These operations are inherently conflicting; callers must not race them.
   */
  public async unlock(password: Password): Promise<void> {
    if (!(await this.hasPassword())) {
      throw new NoPasswordSetError();
    }

    await resumeRotationIfInterrupted(this.storage);

    const { salt, scryptParams } = await this.readVaultKeyDerivationParams();
    const key = await deriveEncryptionKey(password, salt, scryptParams);

    // Verify the password is correct by attempting decryption.
    const addresses = await getStateSegment(this.storage, key, 'addresses');
    zeroLibQCState({ addresses });

    if (this.signedHttpConfig) {
      await this.ensureHttpSigningLoaded(key);
    }

    this.encryptionKey = key;
  }

  /**
   * Locks the vault by clearing the cached encryption key from memory
   */
  public lock(): void {
    this.clearHttpSigningFromRef();
    this.encryptionKey = undefined;
  }

  /**
   * Returns whether the vault is currently unlocked
   *
   * @returns True if the encryption key is cached in memory
   */
  public isUnlocked(): boolean {
    return this.encryptionKey !== undefined;
  }

  /**
   * Checks whether a password has been set (i.e. an encrypted vault exists)
   *
   * Does NOT require the vault to be unlocked.
   *
   * @returns True if an encrypted vault exists in storage
   */
  public async hasPassword(): Promise<boolean> {
    return this.storage.has(STATE_SEGMENT_KEYS.addresses);
  }

  /**
   * Generates a new mnemonic and stores it securely
   *
   * @remarks Entropy generation is delegated to @scure/bip39's internal
   * crypto.getRandomValues call.
   *
   * Ownership model:
   * - `generateMnemonic()` returns a caller-owned buffer; caller must zero it
   *   with `fill(0)` when done.
   * - `generateMnemonic(callback)` keeps mnemonic usage scoped and LibQC zeros
   *   callback buffers automatically after use.
   *
   * @param callback Scoped callback for safe mnemonic handling
   * @returns Callback result
   * @throws {VaultLockedError} If the vault is locked
   * @throws Error if a mnemonic already exists in storage
   */
  public async generateMnemonic<T>(
    callback: MnemonicScopeCallback<T>
  ): Promise<T> {
    return this.storageLock.run(async () => {
      const encryptionKey = this.requireUnlocked();
      const [existingEntropy, existingSeed] = await Promise.all([
        getStateSegment(this.storage, encryptionKey, 'entropy'),
        getStateSegment(this.storage, encryptionKey, 'seed')
      ]);

      try {
        if (existingEntropy || existingSeed) {
          throw new Error(
            'Seed or entropy already exists in storage. Clear state before generating a new mnemonic.'
          );
        }
      } finally {
        existingEntropy?.fill(0);
        existingSeed?.fill(0);
      }

      // Generate raw entropy first (256 bits for 24 words)
      const entropy = getSecureRandomBytes(MNEMONIC_STRENGTH / 8) as Entropy;
      const mnemonic = entropyToMnemonic(entropy, wordlist);

      // Derive seed once during generation and store it to avoid repeated
      // string conversions and heap leaks during key derivation.
      const seedBytes = mnemonicToSeedSync(mnemonic);
      const seed = Seed.from(seedBytes);
      try {
        await Promise.all([
          setStateSegment(this.storage, encryptionKey, 'entropy', entropy),
          setStateSegment(this.storage, encryptionKey, 'seed', seed)
        ]);
      } finally {
        entropy.fill(0);
        seed.fill(0);
        seedBytes.fill(0);
      }

      const mnemonicBytes = new TextEncoder().encode(mnemonic);

      const scopedMnemonic = Mnemonic.from(mnemonicBytes);
      try {
        return await callback(scopedMnemonic);
      } finally {
        scopedMnemonic.fill(0);
        mnemonicBytes.fill(0);
      }
    });
  }

  /**
   * Imports a wallet from a mnemonic and protects it with a password
   *
   * Validates the mnemonic and password format first, then atomically checks
   * for an existing vault and writes the new state under the storage lock.
   * This prevents two concurrent importWallet calls from overwriting each
   * other's vault. Call clearState() first if overwriting is intended.
   *
   * It also performs automatic discovery of the first 10 addresses for each
   * supported network (Ethereum, Base and Bitcoin).
   *
   * When signed JSON-RPC is configured, ML-DSA credentials are loaded (or
   * provisioned) before discovery, consistent with `unlock()`.
   *
   * @param mnemonic - Caller-owned 24-token mnemonic bytes; caller should wipe
   * with `fill(0)` when no longer needed
   * @param password - Caller-owned password bytes; caller should wipe with
   * `fill(0)` when no longer needed
   * @throws {InvalidPasswordFormatError} If password format is invalid
   * @throws {Error} If mnemonic is invalid
   * @throws {Error} If a vault already exists in storage
   */
  public async importWallet(
    mnemonic: Mnemonic,
    password: Password
  ): Promise<void> {
    const validatedMnemonic = validateMnemonic(mnemonic);

    try {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        throw new InvalidPasswordFormatError(
          `Password does not meet requirements: ${passwordValidation.failedRequirements.join(', ')}`
        );
      }

      // Fail fast before the expensive key derivation.
      const [existingEntropy, existingSeed] = await Promise.all([
        this.storage.has(STATE_SEGMENT_KEYS.entropy),
        this.storage.has(STATE_SEGMENT_KEYS.seed)
      ]);
      if (existingEntropy || existingSeed) {
        throw new Error(
          'Seed or entropy already exists in storage. Clear state before importing a new wallet.'
        );
      }

      // Key derivation is intentionally slow (scrypt); perform it outside the lock
      // so we do not hold the mutex during the expensive computation.
      const salt = generateScryptSalt();
      const encryptionKey = await deriveEncryptionKey(
        password,
        salt,
        this.scryptParams
      );

      // Atomically re-check and write under the lock to guard against concurrent
      // imports both passing the existence check above.
      await this.storageLock.run(async () => {
        const [hasEntropy, hasSeed] = await Promise.all([
          this.storage.has(STATE_SEGMENT_KEYS.entropy),
          this.storage.has(STATE_SEGMENT_KEYS.seed)
        ]);
        if (hasEntropy || hasSeed) {
          throw new Error(
            'Seed or entropy already exists in storage. Clear state before importing a new wallet.'
          );
        }

        const entropy = mnemonicToEntropyBytes(validatedMnemonic) as Entropy;
        const seedBytes = mnemonicToSeedSync(
          new TextDecoder().decode(validatedMnemonic)
        );
        let seed: Seed | undefined;

        try {
          seed = Seed.from(seedBytes);

          await Promise.all([
            setStateSegment(this.storage, encryptionKey, 'entropy', entropy),
            setStateSegment(this.storage, encryptionKey, 'seed', seed),
            setStateSegment(this.storage, encryptionKey, 'addresses', []),
            setStateSegment(this.storage, encryptionKey, 'assets', undefined)
          ]);

          this.encryptionKey = encryptionKey;
        } finally {
          entropy.fill(0);
          seed?.fill(0);
          seedBytes.fill(0);
          validatedMnemonic.fill(0);
          mnemonic.fill(0);
        }
      });

      // Signed JSON-RPC requires ML-DSA credentials and vaultUnlocked on the
      // transport ref — same as unlock(). importWallet caches the encryption key
      // but did not previously load signing state, so discovery RPCs failed.
      if (this.signedHttpConfig) {
        await this.ensureHttpSigningLoaded(this.requireUnlocked());
      }

      // Discover accounts until the first clean (non-exposed) address is found.
      // Each createAccount call acquires storageLock independently.
      for (const chain of this.chains) {
        if (isEvmChain(chain.chainId) || isBitcoinChain(chain.chainId)) {
          for (let i = 0; i < MAX_ACCOUNT_ITERATION; i++) {
            const account = await this.createAccount(
              chain.chainId,
              undefined,
              undefined,
              i as AddressIndex
            );
            const isExposed = await account.isPubKeyExposed();

            if (!isExposed) {
              // Found the first clean address and added it. Now we stop.
              break;
            }
          }
        }
      }
    } finally {
      validatedMnemonic.fill(0);
    }
  }

  /**
   * Validates that specific mnemonic words match the securely stored entropy.
   *
   * @param guesses An array of mnemonic word guesses with their BIP-39 indices
   * @returns Whether all provided guesses match the stored wallet state
   * @throws {VaultLockedError} If the vault is locked
   * @throws Error if fewer than 4 guesses are supplied
   * @throws Error if seed or entropy is not found in storage
   */
  public async validateMnemonic(
    guesses: MnemonicGuess[]
  ): Promise<IsValidMnemonic> {
    const encryptionKey = this.requireUnlocked();

    // Check if fewer than 4 guesses are supplied
    if (guesses.length < MIN_MNEMONIC_GUESSES) {
      throw new Error(
        `At least ${MIN_MNEMONIC_GUESSES} guesses are required, but only ${guesses.length} were provided`
      );
    }

    const entropy = await getStateSegment(
      this.storage,
      encryptionKey,
      'entropy'
    );
    if (!entropy) {
      throw new Error('Seed not found in storage');
    }

    try {
      const words = entropyToMnemonic(entropy, wordlist).split(' ');
      const allGuessesMatch = guesses.every(guess => {
        const word = words[guess.index];
        if (!word) {
          return false;
        }

        const expected = (guess.word as string).toLowerCase();
        const matches = word.toLowerCase() === expected;

        return matches;
      });

      return allGuessesMatch as IsValidMnemonic;
    } finally {
      entropy.fill(0);
    }
  }

  /**
   * Returns the BIP-39 recovery phrase after re-confirming the caller's password.
   *
   * Requires the vault to be unlocked. The password is re-derived and verified
   * against the stored ciphertext before the mnemonic is released — this prevents
   * silent extraction when a screen is left open by an unattended user.
   *
   * This method keeps mnemonic usage scoped. LibQC zeros the callback buffer
   * automatically after use. If the caller needs an owned copy, they must
   * create it inside the callback and wipe that copy manually when done.
   *
   * @param password - Caller-owned password bytes; caller should wipe with
   * `fill(0)` once this call is complete
   * @param callback - Scoped callback for safe mnemonic handling
   * @returns Callback result
   * @throws {VaultLockedError} If the vault is locked
   * @throws {IncorrectPasswordError} If the supplied password is wrong
   * @throws Error if the mnemonic is not found in storage
   */
  public async exportMnemonic<T>(
    password: Password,
    callback: MnemonicScopeCallback<T>
  ): Promise<T> {
    const encryptionKey = this.requireUnlocked();
    const isValid = await this.checkPassword(password);
    if (!isValid) {
      throw new IncorrectPasswordError();
    }

    const entropy = await getStateSegment(
      this.storage,
      encryptionKey,
      'entropy'
    );
    if (!entropy) {
      throw new Error('Seed not found in storage');
    }

    let mnemonicBytes: Uint8Array | undefined;
    try {
      const mnemonic = entropyToMnemonic(entropy, wordlist);
      mnemonicBytes = new TextEncoder().encode(mnemonic);

      const scopedMnemonic = Mnemonic.from(mnemonicBytes);
      try {
        return await callback(scopedMnemonic);
      } finally {
        scopedMnemonic.fill(0);
      }
    } finally {
      mnemonicBytes?.fill(0);
      entropy.fill(0);
    }
  }

  /**
   * Sets the password for the wallet and stores it securely
   *
   * If the wallet already has an existing password, then setting a new one requires the existing one to be passed in
   *
   * @param password Caller-owned password bytes; caller should wipe with
   * `fill(0)` when no longer needed
   * @param existingPassword Caller-owned existing password bytes (if provided);
   * caller should wipe with `fill(0)` when no longer needed
   * @throws {InvalidPasswordFormatError} If password format is invalid
   * @throws {ExistingPasswordRequiredError} If existing password is required but not provided
   * @throws {ExistingPasswordMismatchError} If existing password is provided but does not match
   * @throws {KeyDerivationError} If key material import fails
   * @throws {VaultCorruptedError} If the stored vault data is structurally invalid
   */
  public async setPassword(
    password: Password,
    existingPassword?: Password
  ): Promise<void> {
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw new InvalidPasswordFormatError(
        `Password does not meet requirements: ${validation.failedRequirements.join(', ')}`
      );
    }

    // Derive the new key outside the lock — scrypt is intentionally slow.
    const salt = generateScryptSalt();
    const encryptionKey = await deriveEncryptionKey(
      password,
      salt,
      this.scryptParams
    );

    const vaultExists = await this.storage.has(STATE_SEGMENT_KEYS.addresses);
    if (vaultExists) {
      if (!existingPassword) {
        throw new ExistingPasswordRequiredError();
      }

      const isValid = await this.checkPassword(existingPassword);
      if (!isValid) {
        throw new ExistingPasswordMismatchError();
      }
    }

    return this.storageLock.run(async () => {
      // Re-check inside the lock (TOCTOU guard).
      const lockedVaultExists = await this.storage.has(
        STATE_SEGMENT_KEYS.addresses
      );

      if (lockedVaultExists && !vaultExists) {
        // A concurrent setPassword call created the vault between our outer
        // existence check and the lock acquire. Reject rather than silently
        // overwriting the newly created vault with a different key.
        throw new Error(
          'Vault was created concurrently. Call setPassword only once per installation.'
        );
      }

      if (lockedVaultExists) {
        const currentKey = this.requireUnlocked();
        await rotateEncryptionKey(this.storage, currentKey, encryptionKey);
      } else {
        await Promise.all([
          setStateSegment(this.storage, encryptionKey, 'addresses', []),
          setStateSegment(this.storage, encryptionKey, 'assets', undefined)
        ]);
        if (this.signedHttpConfig) {
          const creds = await generateRegisterAndPersistHttpSigning(
            this.storage,
            encryptionKey,
            this.signedHttpConfig
          );
          this.applyHttpSigningCredentials(creds);
        }
      }
      this.encryptionKey = encryptionKey;
    });
  }

  /**
   * Checks if the provided password matches the vault password
   *
   * Derives a key from the password and attempts decryption without
   * changing the current unlock state.
   *
   * @param password - Caller-owned password bytes; caller should wipe with
   * `fill(0)` when no longer needed
   * @returns Branded boolean indicating if the password is valid
   * @throws {NoPasswordSetError} If no vault exists
   * @throws {KeyDerivationError} If key material import fails
   * @throws {VaultCorruptedError} If the stored vault data is structurally invalid
   */
  public async checkPassword(password: Password): Promise<IsValidPassword> {
    if (!(await this.hasPassword())) {
      throw new NoPasswordSetError();
    }

    try {
      const { salt, scryptParams } = await this.readVaultKeyDerivationParams();
      const key = await deriveEncryptionKey(password, salt, scryptParams);
      const addresses = await getStateSegment(this.storage, key, 'addresses');
      zeroLibQCState({ addresses });
      return true as IsValidPassword;
    } catch (error) {
      if (error instanceof IncorrectPasswordError) {
        return false as IsValidPassword;
      }
      throw error;
    }
  }

  /**
   * Clears all internal LibQC state and locks the vault
   *
   * This method removes the encrypted vault from storage and clears the
   * cached encryption key. After calling this, the wallet is in the
   * "NoVault" state.
   *
   * @returns Promise that resolves when state has been cleared
   */
  public async clearState(): Promise<void> {
    return this.storageLock.run(async () => {
      this.lock();
      await Promise.all([
        ...Object.values(STATE_SEGMENT_KEYS).map(k => this.storage.delete(k)),
        this.storage.delete(ROTATION_MARKER_KEY),
        ...Object.values(ROTATION_STAGING_KEYS).map(k => this.storage.delete(k))
      ]);
    });
  }

  /**
   * Creates a new account on a chain
   *
   * EVM: If an account already exists on a chain this will always create with a new address.
   * If an account doesn't exist, an existing address will be used unless forceNewAddress is set to true.
   *
   * Bitcoin: If an account already exists on a chain this will always create with a new address.
   * If an account doesn't exist, an existing address will be used unless forceNewAddress is set to true.
   *
   * @param chainId The chain to create the account on
   * @param forceNewAddress Forces the account to be created with a new address (EVM only; ignored for Bitcoin)
   * @param version The address version to use
   * @param indexOverride Optional index to use for account creation. If not provided, it will be derived.
   * @returns An account client
   * @throws {VaultLockedError} If the vault is locked
   */
  public async createAccount(
    chainId: ChainId,
    forceNewAddress?: ForceNewAddress,
    version: AddressVersion = CURRENT_DEFAULT_ADDRESS_VERSION,
    indexOverride?: AddressIndex
  ): Promise<AccountClientInterface> {
    return this.storageLock.run(async () => {
      const encryptionKey = this.requireUnlocked();
      if (!isEvmChain(chainId) && !isBitcoinChain(chainId)) {
        throw new Error(`Unsupported chain: ${chainId.toString()}`);
      }

      const addresses = await getStateSegment(
        this.storage,
        encryptionKey,
        'addresses'
      );

      try {
        return await this.getSeed(async seed => {
          const index =
            indexOverride ??
            this.getIndexForAccountCreation(
              { addresses },
              chainId,
              forceNewAddress
            );

          if (isBitcoinChain(chainId)) {
            const existingBtcAccount = addresses
              .filter(
                (a): a is BitcoinPersistedAddress =>
                  a.chainType === 'bitcoin' && a.index === index
              )
              .flatMap(a => a.accounts)
              .find(a => a.chainId.toString() === chainId.toString());
            if (existingBtcAccount) {
              return this.getAccount(existingBtcAccount.id);
            }
            return this.createBitcoinAccount(
              addresses,
              chainId,
              seed,
              index,
              version,
              encryptionKey
            );
          }

          return this.createEvmAccount(
            addresses,
            chainId,
            seed,
            index,
            version,
            encryptionKey
          );
        });
      } finally {
        zeroLibQCState({ addresses });
      }
    });
  }

  /**
   * Creates an EVM account on the given chain.
   *
   * @remarks Must only be called from within a `storageLock.run()` callback.
   * Calling it outside the lock is a data race. Never re-acquire the lock
   * inside this method, doing so will deadlock.
   */
  private async createEvmAccount(
    addresses: PersistedAddress[],
    chainId: ChainId,
    seed: Seed,
    index: AddressIndex,
    version: AddressVersion,
    encryptionKey: VaultEncryptionKeyWithMetadata
  ): Promise<AccountClientInterface> {
    const evmAddresses = addresses.filter(
      (a): a is EvmPersistedAddress => a.chainType === 'evm'
    );
    let workingAddresses = addresses;

    try {
      if (!evmAddresses.some(a => a.index === index)) {
        const generated = await generateAddressFromSeed(seed, index, version);
        workingAddresses = [
          ...addresses,
          { chainType: 'evm' as const, ...generated, accounts: [] }
        ];
      }

      const evmAddressesAfter = workingAddresses.filter(
        (a): a is EvmPersistedAddress => a.chainType === 'evm'
      );
      const address = evmAddressesAfter.find(a => a.index === index);

      if (!address) {
        throw new Error(`Failed to find/create address for index ${index}`);
      }

      const account: PersistedAccount = {
        id: new AccountId({
          chainId,
          address: address.address
        }),
        address: address.address,
        chainId
      };

      const needsAccount = !address.accounts.some(
        a => a.chainId.toString() === chainId.toString()
      );
      if (needsAccount) {
        workingAddresses = workingAddresses.map(a =>
          a === address
            ? { ...address, accounts: [...address.accounts, account] }
            : a
        );
      }

      await setStateSegment(
        this.storage,
        encryptionKey,
        'addresses',
        workingAddresses
      );

      const publicClient = this.publicClientRegistry.getByChainId(chainId);
      const chain = publicClient.chain;
      if (!chain) {
        throw new Error('Chain information not available');
      }

      // Add the native asset to the wallet if it is not already tracked
      const nativeAsset = getNativeAsset(chain);
      if (!(await this.isAssetTracked(nativeAsset))) {
        await this.addAssetInternal(nativeAsset);
      }

      return this.getAccount(account.id);
    } finally {
      zeroLibQCState({ addresses: workingAddresses });
    }
  }

  /**
   * Creates a Bitcoin account on the given chain.
   *
   * @remarks Must only be called from within a `storageLock.run()` callback.
   * Calling it outside the lock is a data race. Never re-acquire the lock
   * inside this method, doing so will deadlock.
   */
  private async createBitcoinAccount(
    addresses: PersistedAddress[],
    chainId: ChainId,
    seed: Seed,
    index: AddressIndex,
    version: AddressVersion,
    encryptionKey: VaultEncryptionKeyWithMetadata
  ): Promise<AccountClientInterface> {
    const chainSpec = this.chains.find(
      c => c.chainId.toString() === chainId.toString()
    );
    if (!chainSpec) {
      throw new Error(`Chain ${chainId.toString()} not configured`);
    }

    const network =
      chainId.reference === BITCOIN_TESTNET_REF
        ? bitcoinNetworks.testnet
        : bitcoinNetworks.bitcoin;

    let workingAddresses = addresses;

    try {
      const existingAddress = workingAddresses.find(
        (a): a is BitcoinPersistedAddress =>
          a.chainType === 'bitcoin' &&
          a.index === index &&
          isBitcoinAddressForChain(a.address as BitcoinAddress, chainId)
      );

      let addressEntry: BitcoinPersistedAddress;
      if (!existingAddress) {
        const result = deriveBitcoinAddressFromSeed(
          seed,
          index,
          network,
          version
        );
        addressEntry = {
          chainType: 'bitcoin',
          address: result.address,
          index: result.index,
          secp256k1PrivateKey: result.secp256k1PrivateKey,
          accounts: [],
          version: result.version
        };
      } else {
        addressEntry = existingAddress;
      }

      const account: PersistedAccount = {
        id: new AccountId({ chainId, address: addressEntry.address }),
        address: addressEntry.address,
        chainId
      };

      const needsAccount = !addressEntry.accounts.some(
        a => a.chainId.toString() === chainId.toString()
      );
      const updatedEntry: BitcoinPersistedAddress = needsAccount
        ? { ...addressEntry, accounts: [...addressEntry.accounts, account] }
        : addressEntry;
      const isNew = !addresses.some(a => a === addressEntry);
      workingAddresses = isNew
        ? [...addresses, updatedEntry]
        : addresses.map(a => (a === addressEntry ? updatedEntry : a));

      await setStateSegment(
        this.storage,
        encryptionKey,
        'addresses',
        workingAddresses
      );

      // Add the native asset to the wallet if it is not already tracked
      const nativeAsset = getNativeAsset(chainSpec);
      if (!(await this.isAssetTracked(nativeAsset))) {
        await this.addAssetInternal(nativeAsset);
      }

      return this.getAccount(account.id);
    } finally {
      zeroLibQCState({ addresses: workingAddresses });
    }
  }

  /**
   * List all accounts
   *
   * @returns A list of accounts
   * @throws {VaultLockedError} If the vault is locked
   */
  public async listAccounts(): Promise<PersistedAccount[]> {
    const encryptionKey = this.requireUnlocked();

    const addresses = await getStateSegment(
      this.storage,
      encryptionKey,
      'addresses'
    );

    try {
      return addresses.flatMap(address => address.accounts);
    } finally {
      zeroLibQCState({ addresses });
    }
  }

  /**
   * Gets an account client for an account ID i.e. a CAIP10 identifier
   *
   * @param id A CAIP10 account identifier
   * @returns An account client
   * @throws {VaultLockedError} If the vault is locked
   */
  public async getAccount(id: AccountId): Promise<AccountClientInterface> {
    const encryptionKey = this.requireUnlocked();
    const account = (await this.listAccounts()).find(
      a => a.id.toString() === id.toString()
    );

    if (!account) {
      throw new Error(`Account ${id.toString()} not found`);
    }

    return this.buildAccountClient(account, encryptionKey);
  }

  /**
   * Constructs an account client for an already-loaded PersistedAccount.
   *
   * Separated from getAccount so that callers that already hold the account
   * list (e.g. getTotalBalances) can build clients without triggering an
   * extra listAccounts/state-decrypt round-trip per account.
   */
  private buildAccountClient(
    account: PersistedAccount,
    encryptionKey: VaultEncryptionKeyWithMetadata
  ): AccountClientInterface {
    if (!isEvmChain(account.chainId) && !isBitcoinChain(account.chainId)) {
      throw new Error(`Unsupported chain: ${account.chainId.toString()}`);
    }

    if (isBitcoinChain(account.chainId)) {
      const chainSpec = this.chains.find(
        c => c.chainId.toString() === account.chainId.toString()
      );
      if (!chainSpec) {
        throw new Error(`Chain ${account.chainId.toString()} not configured`);
      }
      const baseUrl = chainSpec.rpcUrls[0] as string;
      if (!baseUrl) {
        throw new Error(
          `No API base URL configured for Bitcoin chain ${account.chainId.toString()}`
        );
      }
      const api = new EsploraBitcoinApi(baseUrl);
      return new BitcoinAccountClient(
        account,
        this.storage,
        encryptionKey,
        api,
        chainSpec
      );
    }

    const bundlerBase = this.bundlerConfigProvider(account.chainId);
    const bundlerConfig: BundlerConfig =
      this.signedHttpConfig !== undefined
        ? {
            ...bundlerBase,
            httpSigningRef: this.httpSigningTransportRef
          }
        : bundlerBase;

    return new EvmAccountClient(
      account,
      this.storage,
      encryptionKey,
      this.publicClientRegistry.getByChainId(account.chainId),
      bundlerConfig
    );
  }

  /**
   * Checks if an asset is tracked
   *
   * @param asset The asset to check
   * @returns Whether the asset is tracked
   * @throws {VaultLockedError} If the vault is locked
   */
  public async isAssetTracked(asset: Asset): Promise<boolean> {
    const encryptionKey = this.requireUnlocked();

    const assets = await getStateSegment(this.storage, encryptionKey, 'assets');
    return assets?.some(a => a.id.toString() === asset.id.toString()) ?? false;
  }

  /**
   * Adds an ERC-20 token to the wallet
   *
   * Native assets are automatically added when creating an account on a chain
   * and should not be manually added using this method.
   *
   * @param symbol - Token symbol
   * @returns The added token asset
   * @throws {VaultLockedError} If the vault is locked
   * @throws Error if the token is already tracked
   */
  public async addToken(symbol: Symbol): Promise<Asset> {
    return this.storageLock.run(async () => {
      this.requireUnlocked();

      const asset = getAssetBySymbol(symbol);

      if (!asset) {
        throw new Error(`Token ${symbol} not supported`);
      }

      await this.addAssetInternal(asset);

      return asset;
    });
  }

  /**
   * Lists all assets that have been added
   *
   * @returns An array of added assets
   * @throws {VaultLockedError} If the vault is locked
   */
  public async listAssets(): Promise<Asset[]> {
    const encryptionKey = this.requireUnlocked();

    const assets = await getStateSegment(this.storage, encryptionKey, 'assets');
    return assets ?? [];
  }

  /**
   * Gets all supported assets that can be added to the wallet
   *
   * When a chainId is provided, only returns assets that have entities for the specified chain.
   * The returned assets still contain all their entities across all chains, not just the filtered chain.
   *
   * @param chainId Optional chain ID to filter assets by
   * @returns An array of supported assets
   */
  public getSupportedAssets(chainId?: ChainId): Asset[] {
    const allAssets = getSupportedAssets();

    // If no chainId filter is provided, return all assets
    if (!chainId) {
      return allAssets;
    }

    // Filter assets to only those that have entities for the specified chain
    return allAssets.filter(asset =>
      asset.entities.some(
        entity => entity.assetType.chainId.toString() === chainId.toString()
      )
    );
  }

  /**
   * Gets all supported chains configured for this LibQC instance
   *
   * Returns the chain specifications that were provided during construction.
   * These chains should align with the assets defined in assets.json (Ethereum and Base).
   *
   * @returns An array of configured chain specifications
   */
  public getSupportedChains(): ChainSpecification[] {
    return this.chains;
  }

  /**
   * Removes an ERC-20 token from the wallet
   *
   * Native assets cannot be removed as they are automatically managed per chain.
   *
   * @param asset The token asset to remove
   * @throws {VaultLockedError} If the vault is locked
   * @throws Error if the token is not tracked
   * @throws Error if attempting to remove a native asset
   */
  public async removeToken(asset: Asset): Promise<void> {
    return this.storageLock.run(async () => {
      const encryptionKey = this.requireUnlocked();

      const accounts = await this.listAccounts();

      const accountsWithNativeAsset = accounts.filter(account => {
        if (isBitcoinChain(account.chainId)) {
          const chainSpec = this.chains.find(
            c => c.chainId.toString() === account.chainId.toString()
          );
          if (!chainSpec) return false;
          const nativeAsset = getNativeAsset(chainSpec);
          return nativeAsset.id === asset.id;
        }
        const publicClient = this.publicClientRegistry.getByChainId(
          account.chainId
        );
        const nativeAsset = getNativeAsset(publicClient.chain!);
        return nativeAsset.id === asset.id;
      });

      if (accountsWithNativeAsset.length > 0) {
        throw new Error(
          `Cannot remove ${asset.symbol} as it is the native asset for an account`
        );
      }

      const assets =
        (
          await getStateSegment(this.storage, encryptionKey, 'assets')
        )?.slice() ?? [];

      // Find the asset by aggregate asset ID
      const assetIndex = assets.findIndex(
        a => a.id.toString() === asset.id.toString()
      );

      if (assetIndex === -1) {
        throw new Error(`Token ${asset.id.toString()} is not tracked`);
      }

      // Remove the asset
      assets.splice(assetIndex, 1);

      await setStateSegment(this.storage, encryptionKey, 'assets', assets);
    });
  }

  /**
   * Gets the aggregate total balance of an asset across all accounts
   *
   * This function goes through all accounts and sums the balances of the asset across all accounts.
   * If an account is on a chain that does not support the asset then it is ignored.
   * If an account has no balance of the asset then it is ignored/assumed to be 0.
   *
   * @param asset The asset to get the balance of
   * @returns The aggregate total asset balance across all accounts
   * @throws {VaultLockedError} If the vault is locked
   * @throws {InvalidAssetDecimalsError} If the asset has invalid decimal configuration
   * @throws {InvalidAssetMetadataError} If the asset has missing or incomplete metadata
   * @throws {OnChainDecimalsMismatchError} If any account's on-chain
   *   decimals disagree with the entity definition — this is treated as
   *   a configuration error and intentionally fails the entire call
   *   rather than returning a partial (silently wrong) result.
   */
  public async getTotalBalance(asset: Asset): Promise<BalanceResult> {
    const [result] = await this.getTotalBalances([asset]);
    return result;
  }

  /**
   * Gets the aggregate balance of an array of assets across all accounts
   *
   * Calls listAccounts once, builds all account clients upfront, then
   * dispatches every (account × asset) getBalance call in a single
   * Promise.all so all EVM readContract calls land in the same multicall
   * batch window — minimizing RPC round-trips and 429 errors.
   *
   * Per asset, balances are summed at the highest precision available
   * across chains, then truncated to asset.decimals once at the end.
   * Scaling each chain's balance down individually would discard sub-unit
   * remainders per chain; summing first preserves dust that collectively
   * rounds up to a whole target unit.
   *
   * @param assets The assets to get the balances of
   * @returns The balances of the assets across all accounts
   * @throws {VaultLockedError} If the vault is locked
   * @throws {InvalidAssetDecimalsError} If any asset has invalid decimal configuration
   * @throws {InvalidAssetMetadataError} If any asset has missing or incomplete metadata
   * @throws {OnChainDecimalsMismatchError} If any account's on-chain
   *   decimals disagree with the entity definition — this is treated as
   *   a configuration error and intentionally fails the entire call
   *   rather than returning a partial (silently wrong) result.
   */
  public async getTotalBalances(assets: Asset[]): Promise<BalanceResult[]> {
    if (assets.length === 0) return [];

    const encryptionKey = this.requireUnlocked();
    assets.forEach(asset => validateAssetMetadata(asset));
    const persistedAccounts = await this.listAccounts();
    const clients = persistedAccounts.map(account =>
      this.buildAccountClient(account, encryptionKey)
    );

    // Flatten to (clientIndex, assetIndex) pairs and fire all balance reads
    // in one Promise.all so EVM readContract calls share a multicall window.
    // AssetEntityNotFoundError / NonErc20TokenBalanceError mean the asset
    // doesn't exist on that chain — skip. OnChainDecimalsMismatchError is
    // a config error and must propagate so callers aren't silently given
    // wrong totals.
    const pairs = clients.flatMap((_, ci) =>
      assets.map((_, ai) => ({ ci, ai }))
    );

    const results = await Promise.all(
      pairs.map(async ({ ci, ai }) => {
        try {
          return await clients[ci].getBalance(assets[ai]);
        } catch (error) {
          if (
            error instanceof AssetEntityNotFoundError ||
            error instanceof NonErc20TokenBalanceError
          ) {
            return null;
          }
          throw error;
        }
      })
    );

    return assets.map((asset, ai) => {
      const validBalances = pairs
        .map((pair, i) => (pair.ai === ai ? results[i] : null))
        .filter((r): r is BalanceResult => r !== null);

      const maxDecimals = validBalances.reduce(
        (m, b) => Math.max(m, b.decimals),
        asset.decimals as number
      ) as Decimals;

      const sumAtMax = validBalances.reduce(
        (acc, b) =>
          (acc +
            normaliseBalance(
              b.balance,
              b.decimals,
              maxDecimals
            )) as BalanceBigInt,
        0n as BalanceBigInt
      );

      const balance = normaliseBalance(sumAtMax, maxDecimals, asset.decimals);

      return {
        balance,
        decimals: asset.decimals,
        symbol: asset.symbol
      };
    });
  }

  /**
   * Reads an ERC20 contract in order to return the token details for a given token address and chain
   *
   * @param chainId The chain to read the token on
   * @param tokenAddress The address of the token to read
   * @returns The token details
   */
  public async readErc20TokenDetails(
    chainId: ChainId,
    tokenAddress: EvmAddress
  ): Promise<TokenDetails> {
    const publicClient = this.publicClientRegistry.getByChainId(chainId);
    const tokenDetails = await getErc20TokenDetails(publicClient, tokenAddress);
    return tokenDetails;
  }

  /**
   * Lists SDK-owned withdrawal lifecycle records (ENG-1791).
   *
   * Records are persisted by `emptyVault` and advanced by
   * `refreshWithdrawalLifecycle`. They form the canonical source of truth
   * for withdrawal state and are returned newest-first by `initiatedAt`.
   *
   * @param accountId Optional CAIP-10 account filter
   * @returns Withdrawal records, newest-first
   * @throws {VaultLockedError} If the vault is locked
   */
  public async listWithdrawals(
    accountId?: AccountId
  ): Promise<WithdrawalRecord[]> {
    const encryptionKey = this.requireUnlocked();
    return listWithdrawalRecords(this.storage, encryptionKey, accountId);
  }

  /**
   * Reconciles withdrawal lifecycle records for an account against on-chain
   * state and persists transitions (ENG-1791).
   *
   * Iterates non-terminal records (status='pending' or 'sent') for the given
   * account, asks the appropriate account client to reconcile each record
   * against the chain, and writes back any updated records. Terminal records
   * ('withdrawn' / 'failed') are returned unchanged.
   *
   * Reconciliation is deterministic: pending → sent on confirmation, sent →
   * withdrawn once the source balance has been swept, and 'failed' only when
   * an explicit non-throw failure is observed.
   *
   * @param accountId The CAIP-10 account whose withdrawals should be refreshed
   * @returns The full set of records for the account, newest-first
   * @throws {VaultLockedError} If the vault is locked
   */
  public async refreshWithdrawalLifecycle(
    accountId: AccountId
  ): Promise<WithdrawalRecord[]> {
    // Capture the encryption key once so the per-record write loop below
    // uses the same key for every replaceWithdrawalRecord call. The reads
    // ahead of the loop go through the public `listWithdrawals` helper,
    // which itself enforces the unlock check — a lock that takes effect
    // during reads will abort the operation before any write happens, so
    // partial-write hazards are avoided either way.
    const encryptionKey = this.requireUnlocked();

    const account = await this.getAccount(accountId);
    if (!isReconcileableAccountClient(account)) {
      throw new Error(
        `Account client for ${accountId.toString()} does not support withdrawal reconciliation`
      );
    }
    const records = await listWithdrawalRecords(
      this.storage,
      encryptionKey,
      accountId
    );

    const reconciled = await Promise.all(
      records.map(async record => {
        if (record.status === 'withdrawn' || record.status === 'failed') {
          return { record, changed: false };
        }
        const next = await account.reconcileWithdrawalRecord(record);
        return { record: next, changed: next !== record };
      })
    );

    for (const { record, changed } of reconciled) {
      if (changed) {
        await replaceWithdrawalRecord(this.storage, encryptionKey, record);
      }
    }

    return reconciled.map(r => r.record);
  }

  /**
   * Reads the seed from storage and executes a callback with a scoped
   * seed buffer.
   *
   * The seed buffer is always zeroed before this method resolves or rejects.
   *
   * @param callback - Scoped seed handler
   * @returns Callback result
   * @throws {VaultLockedError} If the vault is locked
   * @throws Error if the seed is not found in storage
   */
  private async getSeed<T>(
    callback: (seed: Seed) => Promise<T> | T
  ): Promise<T> {
    const encryptionKey = this.requireUnlocked();

    const seed = await getStateSegment(this.storage, encryptionKey, 'seed');

    if (!seed) {
      throw new Error('Seed not found in storage');
    }

    try {
      return await callback(seed);
    } finally {
      seed.fill(0);
    }
  }

  /**
   * Internal method to add any asset (native or token) to the wallet
   *
   * This bypasses token-only restrictions and is used internally for
   * adding native assets during account creation.
   *
   * @param asset The asset to add
   * @throws Error if the asset is already tracked
   * @remarks Must only be called from within a `storageLock.run()` callback.
   * Never re-acquire the lock inside this method — doing so will deadlock.
   */
  private async addAssetInternal(asset: Asset): Promise<void> {
    const encryptionKey = this.requireUnlocked();

    // Read-then-write on the same fetched value avoids a race where two
    // concurrent addToken calls both pass the duplicate check on stale data.
    const existing = await getStateSegment(
      this.storage,
      encryptionKey,
      'assets'
    );

    if (existing?.some(a => a.id.toString() === asset.id.toString())) {
      throw new Error(`Asset ${asset.id.toString()} is already tracked`);
    }

    const assets = existing ? [...existing, asset] : [asset];

    await setStateSegment(this.storage, encryptionKey, 'assets', assets);
  }

  /**
   * Gets the first free index for account creation
   *
   * Filters addresses by chain type (EVM vs Bitcoin) and returns the index
   * within that filtered list. For Bitcoin, addresses are further filtered by
   * network (mainnet bc1 vs testnet tb1) since address encodings differ per network.
   *
   * @param state - Current LibQC state
   * @param chainId - The ID of the chain to create the account on
   * @param forceNewAddress - Whether to force a new address to be created
   * @returns The index for account creation (within the chain-type- and network-filtered list)
   */
  private getIndexForAccountCreation(
    state: LibQCState,
    chainId: ChainId,
    forceNewAddress?: boolean
  ): AddressIndex {
    const chainType = isBitcoinChain(chainId) ? 'bitcoin' : 'evm';
    let filtered = state.addresses.filter(a => a.chainType === chainType);

    if (chainType === 'bitcoin') {
      filtered = filtered.filter(a =>
        isBitcoinAddressForChain(a.address as BitcoinAddress, chainId)
      );
    }

    if (filtered.length === 0) return 0 as AddressIndex;
    if (forceNewAddress) return filtered.length as AddressIndex;

    return filtered.reduce((idx, address) => {
      return address.accounts.some(
        a => a.chainId.toString() === chainId.toString()
      )
        ? idx + 1
        : idx;
    }, 0) as AddressIndex;
  }

  /**
   * Loads ML-DSA HTTP signing credentials from storage, or provisions and
   * persists them when signed HTTP is enabled and the segment is absent.
   *
   * @param encryptionKey - Vault key used to decrypt the `httpSigning` segment
   */
  private async ensureHttpSigningLoaded(
    encryptionKey: VaultEncryptionKeyWithMetadata
  ): Promise<void> {
    if (!this.signedHttpConfig) {
      return;
    }
    let segment = await getStateSegment(
      this.storage,
      encryptionKey,
      'httpSigning'
    );
    if (!segment) {
      segment = await generateRegisterAndPersistHttpSigning(
        this.storage,
        encryptionKey,
        this.signedHttpConfig
      );
    }
    this.applyHttpSigningCredentials(segment);
  }

  /**
   * Copies persisted signing material into the transport ref for viem `fetchFn`.
   *
   * @param persisted - Decrypted segment value (zeroed after copying sensitive fields)
   */
  private applyHttpSigningCredentials(
    persisted: PersistedHttpSigningCredentials
  ): void {
    if (!this.httpSigningTransportRef.signingEnabled) {
      return;
    }
    this.httpSigningTransportRef.vaultUnlocked = true;
    this.httpSigningTransportRef.credentials = {
      keyId: persisted.keyId,
      mlDsa65SecretKey: new Uint8Array(persisted.mlDsa65SecretKey)
    };
    zeroLibQCState({ httpSigning: persisted });
  }

  /**
   * Clears ML-DSA signing material from the in-memory transport ref.
   */
  private clearHttpSigningFromRef(): void {
    const creds = this.httpSigningTransportRef.credentials;
    if (creds) {
      creds.mlDsa65SecretKey.fill(0);
    }
    this.httpSigningTransportRef.credentials = undefined;
    this.httpSigningTransportRef.vaultUnlocked = false;
  }

  /**
   * Guards operations that require the vault to be unlocked
   *
   * @returns The cached encryption key
   * @throws {VaultLockedError} If the encryption key is not cached
   */
  private requireUnlocked(): VaultEncryptionKeyWithMetadata {
    if (!this.encryptionKey) {
      throw new VaultLockedError();
    }
    return this.encryptionKey;
  }

  /**
   * Reads the key derivation metadata from the encrypted vault without decrypting
   *
   * Returns the scrypt salt (decoded from base64) and the scrypt params
   * that were used when the vault was originally encrypted. These stored
   * params must be used when re-deriving the key to ensure compatibility
   * even if the default scrypt params change in a future release.
   *
   * @returns The raw scrypt salt and the scrypt params stored in the vault
   * @throws {NoPasswordSetError} If no vault exists
   */
  private async readVaultKeyDerivationParams(): Promise<{
    salt: ScryptSalt;
    scryptParams: ScryptParams;
  }> {
    const vault = await this.storage.get<EncryptedVault>(
      STATE_SEGMENT_KEYS.addresses
    );

    if (!vault) {
      throw new NoPasswordSetError();
    }
    return {
      salt: base64.decode(vault.scryptSalt) as ScryptSalt,
      scryptParams: vault.keyMetadata.params
    };
  }
}
