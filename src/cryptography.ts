import { hmac } from '@noble/hashes/hmac.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import {
  validateMnemonic as bip39ValidateMnemonic,
  entropyToMnemonic,
  mnemonicToEntropy
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  CsprngUnavailableError,
  EmptyPlaintextError,
  IncorrectPasswordError,
  KeyDerivationError,
  VaultCorruptedError
} from './errors';
import {
  Mnemonic,
  Password,
  Seed,
  type AddressIndex,
  type Brand
} from './types';

// P11TODO move all cryptography operations into WASM
// P11TODO destroy all sensitive data as thoroughly as possible

/**
 * Strongly-typed aliases for cryptographic primitives
 */
export type Secp256k1PrivateKeyBytes = Brand<
  Uint8Array,
  'Secp256k1PrivateKeyBytes'
>;
export type EntropyLength = Brand<number, 'EntropyLength'>;
export type AppNumber = Brand<number, 'AppNumber'>;

export type PasswordRequirementId =
  | 'asciiOnly'
  | 'minLength'
  | 'uppercase'
  | 'lowercase'
  | 'digit'
  | 'specialChar';

export type PasswordValidationResult = {
  valid: boolean;
  requirements: Record<PasswordRequirementId, boolean>;
  failedRequirements: PasswordRequirementId[];
};

/**
 * Type alias for secp256k1 signer (compatible with ZeroDev's Signer type)
 */
export type { Signer as Secp256k1Signer } from '@zerodev/sdk/types';

/**
 * BIP-85 Constants
 */
const BIP85_PURPOSE = 83696968; // "BIPS" on phone keypad
const BIP85_HMAC_KEY = 'bip-entropy-from-k'; // from BIP-85 standard

// P11TODO decide on final `APP_NO`s for BIP-85 derivation

/**
 * LibQC base application number for BIP-85 derivation
 * First 4 digits of sha256("PROJECTELEVEN") hex digest
 */
export const LIBQC_APP_NO_BASE = 4860 as AppNumber;

// P11TODO add extra logic to ensure no two app numbers are ever the same
/**
 * Application number for secp256k1 private key derivations
 * Derived from LibQC base + 1 to distinguish from other key types
 */
export const LIBQC_SECP256K1_APP_NO = (LIBQC_APP_NO_BASE + 1) as AppNumber; // 4861

/**
 * Application number for Bitcoin private key derivations
 * Derived from LibQC base + 2 to distinguish from EVM keys
 */
export const LIBQC_BITCOIN_APP_NO = (LIBQC_APP_NO_BASE + 2) as AppNumber; // 4862

/**
 * Length of entropy needed for secp256k1 private keys (32 bytes)
 */
const SECP256K1_ENTROPY_LENGTH = 32 as EntropyLength;

/**
 * Validate that a mnemonic is properly formatted for LibQC import and derivation
 * @param mnemonic The mnemonic bytes to validate
 * @returns The validated mnemonic in canonical single-spaced form
 * @throws Error if the mnemonic is invalid
 */
export function validateMnemonic(mnemonic: Uint8Array): Mnemonic {
  // Count words by counting spaces in the byte array
  let wordCount = 0;
  let inWord = false;
  for (let i = 0; i < mnemonic.length; i++) {
    const char = mnemonic[i];
    const isSpace =
      char === 0x20 || char === 0x09 || char === 0x0a || char === 0x0d;
    if (!isSpace && !inWord) {
      wordCount++;
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }

  if (wordCount !== 24) {
    throw new Error(
      'Invalid mnemonic phrase: LibQC only supports 24-word mnemonics for security reasons'
    );
  }

  // BIP-39 validation library requires a string, so we create it here
  // as late as possible. We normalize to lowercase and single spaces.
  /**
   * P11TODO: This creates an immutable JS string which remains in the V8 heap
   * until GC. This is a known limitation of current 3rd-party BIP-39 libraries.
   * Targeted fix for Phase 2: Either move mnemonic validation and derivation to
   * WASM or replace/patch the BIP-39 library so secrets never need to hit the
   * JS heap as strings.
   */
  const normalizedStr = new TextDecoder()
    .decode(mnemonic)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  // Perform full BIP-39 validation (checksum and wordlist)
  if (!bip39ValidateMnemonic(normalizedStr, wordlist)) {
    throw new Error(
      'Invalid mnemonic phrase: checksum failed or contains words not in the English wordlist'
    );
  }

  return Mnemonic.from(new TextEncoder().encode(normalizedStr));
}

/**
 * Converts a mnemonic phrase to its raw entropy bytes
 * @param mnemonic The mnemonic bytes (UTF-8 encoded words)
 * @returns 32 bytes of entropy
 */
export function mnemonicToEntropyBytes(mnemonic: Uint8Array): Uint8Array {
  const mnemonicStr = new TextDecoder().decode(mnemonic);
  return mnemonicToEntropy(mnemonicStr, wordlist);
}

/**
 * Converts raw entropy bytes to a mnemonic phrase
 * @param entropy 32 bytes of entropy
 * @returns The mnemonic bytes (UTF-8 encoded words)
 */
export function entropyToMnemonicBytes(entropy: Uint8Array): Mnemonic {
  const mnemonicStr = entropyToMnemonic(entropy, wordlist);
  return Mnemonic.from(new TextEncoder().encode(mnemonicStr));
}

/**
 * Validates a password against the Project Eleven password policy.
 *
 * Password policy (ASCII-only by design — non-ASCII characters are rejected):
 * - asciiOnly:    Printable ASCII characters only (U+0020–U+007E)
 * - minLength:    At least 8 characters
 * - uppercase:    At least one uppercase letter (A–Z)
 * - lowercase:    At least one lowercase letter (a–z)
 * - digit:        At least one digit (0–9)
 * - specialChar:  At least one non-alphanumeric ASCII character
 *
 * This function never throws. Use it to get per-requirement pass/fail state
 * for live UI indicators. The `valid` field is `true` only when all six
 * requirements are met simultaneously.
 *
 * @param input The password bytes to evaluate
 * @returns A PasswordValidationResult with a `valid` boolean and a
 *   per-requirement breakdown
 */
export function validatePassword(input: Uint8Array): PasswordValidationResult {
  const requirements: Record<PasswordRequirementId, boolean> = {
    asciiOnly: true,
    minLength: input.length >= 8,
    uppercase: false,
    lowercase: false,
    digit: false,
    specialChar: false
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    // ASCII only: Printable ASCII characters only (U+0020–U+007E)
    if (char < 0x20 || char > 0x7e) {
      requirements.asciiOnly = false;
    }

    if (char >= 65 && char <= 90) {
      // A-Z
      requirements.uppercase = true;
    } else if (char >= 97 && char <= 122) {
      // a-z
      requirements.lowercase = true;
    } else if (char >= 48 && char <= 57) {
      // 0-9
      requirements.digit = true;
    } else if (char >= 0x20 && char <= 0x7e) {
      // Printable ASCII but not alphanumeric
      requirements.specialChar = true;
    }
  }

  const valid =
    requirements.asciiOnly &&
    requirements.minLength &&
    requirements.uppercase &&
    requirements.lowercase &&
    requirements.digit &&
    requirements.specialChar;

  const failedRequirements = (
    Object.keys(requirements) as PasswordRequirementId[]
  ).filter(id => !requirements[id]);

  return { valid, requirements, failedRequirements };
}

/**
 * Derive raw entropy via BIP-85 from an HDKey master node
 *
 * BIP-85 derivation path: m/83696968'/<app_no>'/<address_index>'
 *
 * P11TODO add Brand types for BIP-85 parameters
 *
 * @param root HDKey master node
 * @param addressIndex Address index for derivation
 * @param entropyLength Number of bytes of entropy needed
 * @param appNo Application number for BIP-85 derivation
 * @returns Sliced HMAC-SHA512 output as Uint8Array
 */
export function deriveBip85Entropy(
  root: HDKey,
  addressIndex: AddressIndex,
  entropyLength: EntropyLength,
  appNo: AppNumber
): Uint8Array {
  if (
    !Number.isInteger(entropyLength) ||
    entropyLength < 1 ||
    entropyLength > 64
  ) {
    throw new Error(
      `Entropy length must be an integer between 1 and 64 bytes, got ${entropyLength}`
    );
  }

  // BIP-85 derivation path: m/83696968'/<app_no>'/<address_index>'
  const path = `m/${BIP85_PURPOSE}'/${appNo}'/${addressIndex}'`;
  const node = root.derive(path);

  let privKey = node.privateKey;
  if (!privKey) {
    throw new Error('No private key at this derivation path');
  }

  // Apply BIP-85 HMAC-SHA512
  const full = hmac(sha512, utf8ToBytes(BIP85_HMAC_KEY), privKey);

  /**
   * Best-effort memory zeroing
   *
   * Note: JavaScript engines may optimize away this call
   * or copy key material during garbage collection.
   * This does not guarantee immediate or complete removal
   * of sensitive data from memory.
   */
  privKey.fill(0);
  privKey = null;
  node.wipePrivateData();

  // Return specified number of bytes
  return full.slice(0, entropyLength);
}

/**
 * Internal helper function to derive BIP-85 entropy from a seed.
 *
 * This function handles:
 * 1. Master HDKey creation from the 64-byte seed
 * 2. BIP-85 path-based entropy derivation
 * 3. Aggressive memory zeroing of master HDKey private data
 *
 * It avoids all intermediate string conversions to minimize JS heap exposure.
 *
 * @param seed The 64-byte BIP-39 seed (Uint8Array)
 * @param addressIndex The address index (0-based)
 * @param entropyLength Number of bytes of entropy needed (typically 32)
 * @param appNo Application number for BIP-85 derivation (vault-specific)
 * @returns The derived entropy as a Uint8Array
 *
 * @internal
 */
export function deriveBip85EntropyFromSeed(
  seed: Seed,
  addressIndex: AddressIndex,
  entropyLength: EntropyLength,
  appNo: AppNumber
): Uint8Array {
  if (addressIndex < 0 || !Number.isInteger(addressIndex)) {
    throw new Error(
      `Invalid address index: must be a non-negative integer, got ${addressIndex}`
    );
  }

  // Create master HDKey from seed
  const masterHDKey = HDKey.fromMasterSeed(seed);

  try {
    // Derive entropy via BIP-85
    const entropy = deriveBip85Entropy(
      masterHDKey,
      addressIndex,
      entropyLength,
      appNo
    );

    /**
     * Best-effort memory zeroing
     */
    masterHDKey.wipePrivateData();

    return entropy;
  } finally {
    masterHDKey.wipePrivateData();
  }
}

/**
 * Derive a secp256k1 private key from a seed and address index using BIP-85
 * Same private key is used across all chains for the same address index
 *
 * @param seed The BIP-39 seed (64 bytes)
 * @param addressIndex The address index (0-based)
 * @returns The derived private key as a hex string
 */
export function deriveSecp256k1PrivateKey(
  seed: Seed,
  addressIndex: AddressIndex
): Secp256k1PrivateKeyBytes {
  // P11TODO avoid passing around sensitive data as strings
  let entropy: Uint8Array | undefined = deriveBip85EntropyFromSeed(
    seed,
    addressIndex,
    SECP256K1_ENTROPY_LENGTH,
    LIBQC_SECP256K1_APP_NO
  );

  try {
    return new Uint8Array(entropy) as Secp256k1PrivateKeyBytes;
  } finally {
    /**
     * Best-effort memory zeroing
     */
    entropy.fill(0);
    entropy = undefined;
  }
}

/**
 * Derive a Bitcoin private key from a seed and address index using BIP-85
 *
 * Uses the same BIP-85 derivation as EVM keys but with a dedicated Bitcoin app number.
 * Same seed + index produces a related but different key for Bitcoin vs EVM.
 *
 * @param seed The BIP-39 seed (64 bytes)
 * @param addressIndex The address index (0-based)
 * @returns The derived 32-byte private key (for use with bitcoinjs-lib, ecpair, etc.)
 */
export function deriveBitcoinPrivateKey(
  seed: Seed,
  addressIndex: AddressIndex
): Uint8Array {
  let entropy: Uint8Array | undefined = deriveBip85EntropyFromSeed(
    seed,
    addressIndex,
    SECP256K1_ENTROPY_LENGTH,
    LIBQC_BITCOIN_APP_NO
  );

  try {
    // Return a copy so caller can zero it; we zero the original
    return new Uint8Array(entropy);
  } finally {
    /**
     * Best-effort memory zeroing
     */
    entropy.fill(0);
    entropy = undefined;
  }
}

// ---------------------------------------------------------------------------
// Encryption (AES-256-GCM vault encryption)
// ---------------------------------------------------------------------------

const AES_GCM = 'AES-GCM';
const IV_BYTE_LENGTH = 12;
const SCRYPT_SALT_BYTE_LENGTH = 32;
const AES_256_GCM_KEY_BYTE_LENGTH = 32;

/**
 * Length of fixed zero-padding appended to plaintext for key commitment.
 * AES-GCM is not key-committing; a ciphertext can decrypt under multiple keys.
 * Appending 32 zero bytes and verifying them on decrypt ensures only the correct
 * key can produce valid ciphertext (2^-256 probability for wrong key).
 */
const KEY_COMMITMENT_PADDING_BYTE_LENGTH = 32;

/** Key derivation function identifier, stored in vault metadata for forward compatibility */
export const KDF_ALGORITHM = 'scrypt' as const;

/**
 * Current encrypted vault schema version (V1): key-commitment padding + CBOR payload
 */
export const ENCRYPTED_VAULT_VERSION_V1 = 1 as EncryptedVaultVersion;

/**
 * Branded types for cryptographic parameters to prevent accidental misuse
 */
export type ScryptCostParameter = Brand<number, 'ScryptCostParameter'>;
export type ScryptBlockSize = Brand<number, 'ScryptBlockSize'>;
export type ScryptParallelism = Brand<number, 'ScryptParallelism'>;
export type EncryptedVaultVersion = Brand<number, 'EncryptedVaultVersion'>;
export type ScryptSalt = Brand<Uint8Array, 'ScryptSalt'>;
export type AesGcmIv = Brand<Uint8Array, 'AesGcmIv'>;
export type Base64Ciphertext = Brand<string, 'Base64Ciphertext'>;
export type Base64Iv = Brand<string, 'Base64Iv'>;
export type Base64ScryptSalt = Brand<string, 'Base64ScryptSalt'>;

/**
 * Default scrypt parameters.
 * N=131072 (2^17) requires ~128MB of memory, making GPU/ASIC attacks expensive.
 * r=8 and p=1 are standard recommendations, e.g. the OWASP Password Storage Cheat Sheet.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: (2 ** 17) as ScryptCostParameter,
  r: 8 as ScryptBlockSize,
  p: 1 as ScryptParallelism
};

/**
 * Scrypt key derivation parameters stored alongside the vault for forward compatibility
 */
export interface ScryptParams {
  /** CPU/memory cost parameter (power of 2) */
  N: ScryptCostParameter;
  /** Block size parameter */
  r: ScryptBlockSize;
  /** Parallelism parameter */
  p: ScryptParallelism;
}

/**
 * Metadata describing how the encryption key was derived
 */

const MIN_SCRYPT_N = 2 ** 10;
const MAX_SCRYPT_N = 2 ** 17;
const MAX_SCRYPT_R = 8;
const MAX_SCRYPT_P = 2;

// SECURITY FIX: Bound public KDF parameters to prevent resource exhaustion.
// Validates persisted or caller-provided scrypt parameters before allocating any KDF work.
export function validateScryptParams(params: ScryptParams): ScryptParams {
  const { N, r, p } = params as unknown as { N: number; r: number; p: number };
  const validN = Number.isSafeInteger(N) && N >= MIN_SCRYPT_N && N <= MAX_SCRYPT_N && (N & (N - 1)) === 0;
  const validR = Number.isSafeInteger(r) && r >= 1 && r <= MAX_SCRYPT_R;
  const validP = Number.isSafeInteger(p) && p >= 1 && p <= MAX_SCRYPT_P;

  if (!validN || !validR || !validP) {
    throw new RangeError('Invalid scrypt parameters: values exceed the supported resource limits');
  }

  return {
    N: N as ScryptCostParameter,
    r: r as ScryptBlockSize,
    p: p as ScryptParallelism
  };
}

export interface KeyDerivationOptions {
  algorithm: typeof KDF_ALGORITHM;
  params: ScryptParams;
}

/**
 * A vault encryption key derived from a user password via scrypt,
 * bundled with the derivation metadata and salt needed to re-derive it.
 */
export interface VaultEncryptionKeyWithMetadata {
  /** Non-extractable AES-256-GCM CryptoKey */
  aes256GcmKey: CryptoKey;
  /** How the key was derived (algorithm + params) */
  derivationOptions: KeyDerivationOptions;
  /** Raw salt bytes used during scrypt key derivation */
  scryptSalt: ScryptSalt;
}

/**
 * The encrypted vault blob persisted to storage
 */
export interface EncryptedVault {
  /** Encrypted vault schema version */
  version: EncryptedVaultVersion;
  /** Base64-encoded AES-GCM ciphertext */
  data: Base64Ciphertext;
  /** Base64-encoded 12-byte initialization vector */
  iv: Base64Iv;
  /** Base64-encoded scrypt salt used for key derivation */
  scryptSalt: Base64ScryptSalt;
  /** Key derivation metadata for forward compatibility */
  keyMetadata: KeyDerivationOptions;
}

/**
 * Metadata fields serialized into AES-GCM additionalData for authentication
 */
interface MetadataForAAD {
  version: EncryptedVaultVersion;
  scryptSalt: string;
  keyMetadata: KeyDerivationOptions;
}

/**
 * Constant-time check that all bytes in the array are zero.
 * Used for key-commitment padding verification to avoid timing side channels.
 *
 * @param bytes - The bytes to check
 * @returns True if all bytes are zero
 */
function constantTimeEqualsZero(bytes: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < bytes.length; i++) {
    diff |= bytes[i];
  }
  return diff === 0;
}

/**
 * Serializes vault metadata to a canonical byte representation for use as AES-GCM
 * additionalData. Ensures deterministic output via fixed key ordering. Exported for
 * use in tests that construct vaults manually.
 *
 * @param meta - The metadata to serialize
 * @returns UTF-8 encoded bytes for the additionalData parameter
 */
export function serializeMetadataForAAD(meta: MetadataForAAD): Uint8Array {
  const obj = {
    version: meta.version,
    scryptSalt: meta.scryptSalt,
    keyMetadata: {
      algorithm: meta.keyMetadata.algorithm,
      params: {
        N: meta.keyMetadata.params.N,
        r: meta.keyMetadata.params.r,
        p: meta.keyMetadata.params.p
      }
    }
  };
  return utf8ToBytes(JSON.stringify(obj));
}

/**
 * Returns cryptographically secure random bytes from the Web Crypto CSPRNG
 *
 * This is the single approved entry point for all random byte generation
 * in LibQC. All cryptographic operations that need randomness must call
 * this function rather than globalThis.crypto.getRandomValues directly.
 *
 * @remarks Entropy sourced from Web Crypto CSPRNG
 * (globalThis.crypto.getRandomValues).
 *
 * @param length - Number of random bytes to generate (must be a positive integer)
 * @returns A Uint8Array filled with secure random bytes
 * @throws {RangeError} If length is not a positive integer
 * @throws {CsprngUnavailableError} If globalThis.crypto.getRandomValues is
 * not available
 */
export function getSecureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(
      `getSecureRandomBytes: length must be a positive integer, got ${length}`
    );
  }

  // Runtime guard: globalThis.crypto may be undefined in non-browser
  // environments (e.g. Node.js < 19) despite TypeScript's DOM lib
  // declaring it as always-present.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new CsprngUnavailableError();
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generates a cryptographically random 32-byte salt for scrypt key derivation
 *
 * @remarks Entropy sourced from Web Crypto CSPRNG via getSecureRandomBytes.
 *
 * @returns 32 random bytes suitable for use as a scrypt salt
 * @throws {CsprngUnavailableError} If secure randomness is unavailable
 */
export function generateScryptSalt(): ScryptSalt {
  return getSecureRandomBytes(SCRYPT_SALT_BYTE_LENGTH) as ScryptSalt;
}

/**
 * Derives an AES-256-GCM CryptoKey from a password and salt using scrypt
 *
 * Uses scrypt from @noble/hashes to derive 32 bytes of key material,
 * then imports into Web Crypto API as a non-extractable AES-GCM key.
 * The raw scrypt output bytes are zeroed immediately after import.
 *
 * @param password - The user's password
 * @param scryptSalt - Raw salt bytes for scrypt key derivation
 * @param params - Scrypt parameters (defaults to N=2^17, r=8, p=1)
 * @returns A VaultEncryptionKeyWithMetadata containing the CryptoKey, derivation options, and salt
 * @throws {KeyDerivationError} If the Web Crypto key import fails
 */
export async function deriveEncryptionKey(
  password: Password,
  scryptSalt: ScryptSalt,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS
): Promise<VaultEncryptionKeyWithMetadata> {
  const validatedParams = validateScryptParams(params);
  let keyMaterial: Uint8Array | undefined = scrypt(password, scryptSalt, {
    N: validatedParams.N,
    r: validatedParams.r,
    p: validatedParams.p,
    dkLen: AES_256_GCM_KEY_BYTE_LENGTH
  });

  try {
    const aes256GcmKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyMaterial as BufferSource,
      AES_GCM,
      false,
      ['encrypt', 'decrypt']
    );

    return {
      aes256GcmKey,
      derivationOptions: { algorithm: KDF_ALGORITHM, params: validatedParams },
      scryptSalt
    };
  } catch (error) {
    throw new KeyDerivationError(
      error instanceof Error ? error.message : 'Failed to import key material'
    );
  } finally {
    keyMaterial.fill(0);
    keyMaterial = undefined;
  }
}

/**
 * Encrypts a plaintext string using AES-256-GCM with the provided encryption key
 *
 * Generates a fresh random 12-byte IV for each encryption (NIST-recommended size).
 * Appends 32 zero bytes (key-commitment padding) to the plaintext before encryption;
 * this makes the scheme key-committing and prevents password reset without knowing
 * the correct password. Vault metadata (version, scryptSalt, keyMetadata) is
 * authenticated via the AES-GCM additionalData (AAD) field but not encrypted.
 *
 * @remarks IV entropy sourced from Web Crypto CSPRNG via getSecureRandomBytes.
 *
 * @param key - The encryption key to encrypt with
 * @param plaintext - The plaintext string to encrypt (must be non-empty)
 * @returns An EncryptedVault object ready for storage
 * @throws {EmptyPlaintextError} If plaintext is an empty string
 * @throws {CsprngUnavailableError} If secure randomness is unavailable
 */
export async function encryptData(
  key: VaultEncryptionKeyWithMetadata,
  plaintextBytes: Uint8Array
): Promise<EncryptedVault> {
  if (plaintextBytes.length === 0) {
    throw new EmptyPlaintextError();
  }

  const iv = getSecureRandomBytes(IV_BYTE_LENGTH) as AesGcmIv;
  const padded = new Uint8Array(
    plaintextBytes.length + KEY_COMMITMENT_PADDING_BYTE_LENGTH
  );
  padded.set(plaintextBytes);
  let encoded: Uint8Array | undefined = padded;
  let cipherBytes: Uint8Array | undefined;

  const aad = serializeMetadataForAAD({
    version: ENCRYPTED_VAULT_VERSION_V1,
    scryptSalt: base64.encode(key.scryptSalt),
    keyMetadata: key.derivationOptions
  });

  try {
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      {
        name: AES_GCM,
        iv: iv as BufferSource,
        additionalData: aad as BufferSource
      },
      key.aes256GcmKey,
      encoded as BufferSource
    );
    cipherBytes = new Uint8Array(cipherBuffer);

    return {
      version: ENCRYPTED_VAULT_VERSION_V1,
      data: base64.encode(cipherBytes) as Base64Ciphertext,
      iv: base64.encode(iv) as Base64Iv,
      scryptSalt: base64.encode(key.scryptSalt) as Base64ScryptSalt,
      keyMetadata: key.derivationOptions
    };
  } finally {
    if (cipherBytes) {
      cipherBytes.fill(0);
      cipherBytes = undefined;
    }
    iv.fill(0);
    padded.fill(0);
    plaintextBytes.fill(0);
    encoded = undefined;
  }
}

/**
 * Decrypts an EncryptedVault using AES-256-GCM with the provided encryption key
 *
 * Vault metadata (version, scryptSalt, keyMetadata) must match the authenticated
 * additionalData used during encryption. If metadata was tampered, decryption fails.
 *
 * Only the current V1 vault schema is supported. After AES-GCM decryption,
 * the 32-byte key-commitment padding is verified and stripped.
 *
 * @param key - The encryption key to decrypt with
 * @param vault - The encrypted vault payload
 * @returns The decrypted plaintext bytes
 * @throws {VaultCorruptedError} If vault data is structurally invalid (bad base64, wrong IV length)
 * @throws {IncorrectPasswordError} If decryption fails due to wrong password, tampered ciphertext, tampered metadata, or invalid key-commitment padding
 */
export async function decryptData(
  key: VaultEncryptionKeyWithMetadata,
  vault: EncryptedVault
): Promise<Uint8Array> {
  let encryptedData: Uint8Array | undefined;
  let iv: AesGcmIv | undefined;

  try {
    encryptedData = base64.decode(vault.data);
  } catch {
    throw new VaultCorruptedError('ciphertext is not valid base64');
  }

  try {
    iv = base64.decode(vault.iv) as AesGcmIv;
  } catch {
    throw new VaultCorruptedError('IV is not valid base64');
  }

  if (iv.length !== IV_BYTE_LENGTH) {
    throw new VaultCorruptedError(
      `IV must be ${IV_BYTE_LENGTH} bytes, got ${iv.length}`
    );
  }

  if (vault.version !== ENCRYPTED_VAULT_VERSION_V1) {
    throw new VaultCorruptedError(
      `unsupported encrypted vault version ${vault.version}`
    );
  }

  const aad = serializeMetadataForAAD({
    version: vault.version,
    scryptSalt: vault.scryptSalt,
    keyMetadata: vault.keyMetadata
  });

  let decryptedBuffer: ArrayBuffer | undefined;
  try {
    try {
      decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        {
          name: AES_GCM,
          iv: iv as BufferSource,
          additionalData: aad as BufferSource
        },
        key.aes256GcmKey,
        encryptedData as BufferSource
      );
    } catch {
      throw new IncorrectPasswordError();
    }

    let decryptedBytes: Uint8Array | null = new Uint8Array(decryptedBuffer);

    if (decryptedBytes.length < KEY_COMMITMENT_PADDING_BYTE_LENGTH) {
      decryptedBytes.fill(0);
      decryptedBytes = null;
      throw new IncorrectPasswordError();
    }
    const paddingStart =
      decryptedBytes.length - KEY_COMMITMENT_PADDING_BYTE_LENGTH;
    const padding = decryptedBytes.subarray(paddingStart);
    if (!constantTimeEqualsZero(padding)) {
      decryptedBytes.fill(0);
      decryptedBytes = null;
      throw new IncorrectPasswordError();
    }

    const plaintextLength =
      decryptedBytes.length - KEY_COMMITMENT_PADDING_BYTE_LENGTH;
    const plaintextBytes = decryptedBytes.subarray(0, plaintextLength);

    const result = new Uint8Array(plaintextBytes);
    decryptedBytes.fill(0);
    decryptedBytes = null;
    return result;
  } finally {
    if (decryptedBuffer) {
      new Uint8Array(decryptedBuffer).fill(0);
      decryptedBuffer = undefined;
    }
    encryptedData.fill(0);
    encryptedData = undefined;
    iv.fill(0);
    iv = undefined;
  }
}