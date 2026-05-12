import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { HDKey } from '@scure/bip32';

// Main entry point exports
import { type AddressIndex, Password, Seed, validatePassword } from '../../src';

// Internal imports (not exported from main entry point)
import {
  decryptData,
  DEFAULT_SCRYPT_PARAMS,
  deriveBip85Entropy,
  deriveBitcoinPrivateKey,
  deriveEncryptionKey,
  deriveSecp256k1PrivateKey,
  ENCRYPTED_VAULT_VERSION_V1,
  encryptData,
  EntropyLength,
  getSecureRandomBytes,
  LIBQC_APP_NO_BASE,
  generateScryptSalt,
  KDF_ALGORITHM,
  LIBQC_SECP256K1_APP_NO,
  validateMnemonic,
  type Base64Ciphertext,
  type Base64Iv,
  type Base64ScryptSalt,
  type EncryptedVault,
  type ScryptCostParameter
} from '../../src/cryptography';
import {
  CsprngUnavailableError,
  EmptyPlaintextError,
  IncorrectPasswordError,
  KeyDerivationError,
  VaultCorruptedError
} from '../../src/errors';
import {
  BIP85_SPEC_XPRV,
  bytesToHex,
  TEST_FAST_SCRYPT_PARAMS,
  getTestSeed,
  withCryptoOverride
} from '../testUtils';

const ENCRYPTION_PWD = Password.from(
  new TextEncoder().encode('test-password-123')
);
const ENCRYPTION_ALTERNATE_PASSWORD = Password.from(
  new TextEncoder().encode('different-password-456')
);

/**
 * Generates a realistic vault-sized plaintext string for encryption tests
 */
function generateTestPlaintext(): string {
  return JSON.stringify({
    mnemonic: 'abandon '.repeat(23) + 'art',
    addresses: [
      {
        address: `0x${'a1b2c3d4e5'.repeat(4)}`,
        index: 0,
        secp256k1PrivateKey: new Uint8Array(32).fill(0xff)
      }
    ]
  });
}

// P11TODO: add fuzz testing

describe('cryptography module', () => {
  describe('deriveSecp256k1PrivateKey', () => {
    test('derives deterministic private key from mnemonic', () => {
      const key1 = deriveSecp256k1PrivateKey(getTestSeed(), 0 as AddressIndex);
      const key2 = deriveSecp256k1PrivateKey(getTestSeed(), 0 as AddressIndex);
      expect(key1).toEqual(key2);
      expect(bytesToHex(key1)).toBe(
        '8274cc510999e281f6ff8e90d9cad85f64854b0786e376300ccdc4a236203beb'
      );
    });

    test('different account indices produce different keys', () => {
      const key0 = deriveSecp256k1PrivateKey(getTestSeed(), 0 as AddressIndex);
      const key1 = deriveSecp256k1PrivateKey(getTestSeed(), 1 as AddressIndex);
      const key2 = deriveSecp256k1PrivateKey(getTestSeed(), 2 as AddressIndex);

      expect(key0).not.toEqual(key1);
      expect(key1).not.toEqual(key2);
      expect(key0).not.toEqual(key2);
    });

    test('returns a Uint8Array private key', () => {
      const key = deriveSecp256k1PrivateKey(getTestSeed(), 0 as AddressIndex);
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key).toHaveLength(32);
    });

    test('throws on invalid address index', () => {
      expect(() =>
        deriveSecp256k1PrivateKey(getTestSeed(), -1 as AddressIndex)
      ).toThrow(/Invalid address index/);
      expect(() =>
        deriveSecp256k1PrivateKey(getTestSeed(), 1.5 as AddressIndex)
      ).toThrow(/Invalid address index/);
    });

    test('throws on invalid seed length', () => {
      expect(() =>
        deriveSecp256k1PrivateKey(
          Seed.from(new Uint8Array(0)),
          0 as AddressIndex
        )
      ).toThrow(/seed length/i);
      expect(() =>
        deriveSecp256k1PrivateKey(
          Seed.from(new Uint8Array(8)),
          0 as AddressIndex
        )
      ).toThrow(/seed length/i);
    });

    test('produces 32-byte private keys', () => {
      const key = deriveSecp256k1PrivateKey(getTestSeed(), 0 as AddressIndex);
      expect(key).toHaveLength(32);
    });
  });

  describe('deriveBitcoinPrivateKey', () => {
    test('derives deterministic 32-byte private key from seed', () => {
      const key1 = deriveBitcoinPrivateKey(getTestSeed(), 0 as AddressIndex);
      const key2 = deriveBitcoinPrivateKey(getTestSeed(), 0 as AddressIndex);
      expect(key1).toHaveLength(32);
      expect(key2).toHaveLength(32);
      expect(key1).toEqual(key2);
    });

    test('different account indices produce different keys', () => {
      const key0 = deriveBitcoinPrivateKey(getTestSeed(), 0 as AddressIndex);
      const key1 = deriveBitcoinPrivateKey(getTestSeed(), 1 as AddressIndex);
      const key2 = deriveBitcoinPrivateKey(getTestSeed(), 2 as AddressIndex);

      expect(key0).not.toEqual(key1);
      expect(key1).not.toEqual(key2);
      expect(key0).not.toEqual(key2);
    });

    test('Bitcoin key differs from EVM key at same index', () => {
      const btcKey = deriveBitcoinPrivateKey(getTestSeed(), 0 as AddressIndex);
      const evmKey = deriveSecp256k1PrivateKey(
        getTestSeed(),
        0 as AddressIndex
      );
      expect(btcKey).not.toEqual(evmKey);
    });

    test('throws on invalid address index', () => {
      expect(() =>
        deriveBitcoinPrivateKey(getTestSeed(), -1 as AddressIndex)
      ).toThrow(/Invalid address index/);
      expect(() =>
        deriveBitcoinPrivateKey(getTestSeed(), 1.5 as AddressIndex)
      ).toThrow(/Invalid address index/);
    });

    test('throws on invalid seed length', () => {
      expect(() =>
        deriveBitcoinPrivateKey(Seed.from(new Uint8Array(0)), 0 as AddressIndex)
      ).toThrow(/seed length/i);
    });
  });

  describe('mnemonic validation', () => {
    test('accepts valid 24-word mnemonic', () => {
      const validMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
      expect(() =>
        validateMnemonic(new TextEncoder().encode(validMnemonic))
      ).not.toThrow();
    });

    test('rejects valid 12-word mnemonic', () => {
      const validMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(() =>
        validateMnemonic(new TextEncoder().encode(validMnemonic))
      ).toThrow(/only supports 24-word mnemonics/);
    });

    test('rejects mnemonic with wrong word count', () => {
      const invalidMnemonic = 'word word word word word';
      expect(() =>
        validateMnemonic(new TextEncoder().encode(invalidMnemonic))
      ).toThrow(/Invalid mnemonic/);
    });

    test('rejects mnemonic with non-BIP-39 words when token count is 24', () => {
      const invalidWordMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzz';
      expect(() =>
        validateMnemonic(new TextEncoder().encode(invalidWordMnemonic))
      ).toThrow(/contains words not in the English wordlist/);
    });

    test('rejects mnemonic with invalid checksum when token count is 24', () => {
      const invalidChecksumMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      expect(() =>
        validateMnemonic(new TextEncoder().encode(invalidChecksumMnemonic))
      ).toThrow(/checksum failed/);
    });
  });

  describe('BIP-85 entropy derivation determinism', () => {
    test('index 0, length 64', () => {
      const entropy = deriveBip85Entropy(
        HDKey.fromExtendedKey(BIP85_SPEC_XPRV),
        0 as AddressIndex,
        64 as EntropyLength,
        LIBQC_SECP256K1_APP_NO
      );
      const hex = bytesToHex(entropy);
      expect(hex).toBe(
        'bcf153ae11df4a753b4186bffe8ab2f4e8594a12f6f3ee1dc0022a146ab3b019dbcaf6754511e3b1d06da33f465dc1070c90c160f271b4a178c63498c0f5019b'
      );
    });

    test('index 1, length 64', () => {
      const entropy = deriveBip85Entropy(
        HDKey.fromExtendedKey(BIP85_SPEC_XPRV),
        1 as AddressIndex,
        64 as EntropyLength,
        LIBQC_SECP256K1_APP_NO
      );
      const hex = bytesToHex(entropy);
      expect(hex).toBe(
        '74634f3ea7bfc6eff511043c055c40e0b3c61c3ec61c17e652e5f99d7e23e0f92cb1692556eaf4c133664fb22fa1064061e2c052a063a959772295e1f25b9a80'
      );
    });
  });

  describe('password validation', () => {
    test('returns valid: true for a fully compliant password', () => {
      const result = validatePassword(
        Password.from(new TextEncoder().encode('ValidPass123!'))
      );
      expect(result.valid).toBe(true);
      expect(Object.values(result.requirements).every(Boolean)).toBe(true);
    });

    test('accepts a password with exactly 8 characters that meets all requirements', () => {
      const result = validatePassword(
        Password.from(new TextEncoder().encode('Valid1!x'))
      ); // 8 chars
      expect(result.valid).toBe(true);
      expect(result.requirements.minLength).toBe(true);
    });

    test('accepts a long password that meets all requirements', () => {
      const long = Password.from(
        new TextEncoder().encode('ValidPass1!' + 'x'.repeat(89))
      ); // 100 chars total
      const result = validatePassword(long);
      expect(result.valid).toBe(true);
    });

    test('accepts a password with spaces (space counts as special character)', () => {
      const result = validatePassword(
        new TextEncoder().encode('My Password 123')
      );
      expect(result.valid).toBe(true);
      expect(result.requirements.specialChar).toBe(true);
    });

    test('returns valid: false for a password with fewer than 8 characters', () => {
      const result = validatePassword(new TextEncoder().encode('Short1!')); // 7 chars
      expect(result.valid).toBe(false);
      expect(result.requirements.minLength).toBe(false);
    });

    test('returns valid: false for an empty password', () => {
      const result = validatePassword(new TextEncoder().encode(''));
      expect(result.valid).toBe(false);
      expect(result.requirements.minLength).toBe(false);
    });

    test('returns valid: false for a password with only 7 characters', () => {
      const result = validatePassword(new TextEncoder().encode('VaPas1!')); // 7 chars
      expect(result.valid).toBe(false);
      expect(result.requirements.minLength).toBe(false);
    });
  });

  describe('generateScryptSalt', () => {
    it('should generate a 32-byte Uint8Array salt', () => {
      const salt = generateScryptSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(32);
    });

    it('should generate different salts each time', () => {
      const salt1 = generateScryptSalt();
      const salt2 = generateScryptSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('deriveEncryptionKey', () => {
    it('should derive an encryption key from password and salt', async () => {
      const scryptSalt = generateScryptSalt();
      const encryptionKeyWithMetadata = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        scryptSalt,
        TEST_FAST_SCRYPT_PARAMS
      );

      expect(encryptionKeyWithMetadata.aes256GcmKey).toBeInstanceOf(CryptoKey);
      expect(encryptionKeyWithMetadata.scryptSalt).toEqual(scryptSalt);
      expect(encryptionKeyWithMetadata.derivationOptions.algorithm).toBe(
        KDF_ALGORITHM
      );
      expect(encryptionKeyWithMetadata.derivationOptions.params).toEqual(
        TEST_FAST_SCRYPT_PARAMS
      );
    });

    it('should derive the same key for the same password and salt', async () => {
      const salt = generateScryptSalt();
      const key1 = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );
      const key2 = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      // We can't compare CryptoKeys directly, but we can verify both decrypt each other's data
      const plaintext = generateTestPlaintext();
      const vault = await encryptData(
        key1,
        new TextEncoder().encode(plaintext)
      );
      const decrypted = await decryptData(key2, vault);
      expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    });

    it('should derive different keys for different passwords', async () => {
      const salt = generateScryptSalt();
      const key1 = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );
      const key2 = await deriveEncryptionKey(
        ENCRYPTION_ALTERNATE_PASSWORD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key1,
        new TextEncoder().encode(generateTestPlaintext())
      );

      await expect(decryptData(key2, vault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should derive different keys for different salts', async () => {
      const salt1 = generateScryptSalt();
      const salt2 = generateScryptSalt();
      const key1 = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt1,
        TEST_FAST_SCRYPT_PARAMS
      );
      const key2 = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt2,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key1,
        new TextEncoder().encode(generateTestPlaintext())
      );

      await expect(decryptData(key2, vault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should produce a non-extractable CryptoKey', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      expect(key.aes256GcmKey.extractable).toBe(false);
      expect(key.aes256GcmKey.algorithm).toEqual({
        name: 'AES-GCM',
        length: 256
      });
    });

    it('should work with production scrypt params (N=2^17) in < 1s', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        DEFAULT_SCRYPT_PARAMS
      );

      expect(key.aes256GcmKey).toBeInstanceOf(CryptoKey);
      expect(key.derivationOptions.params).toEqual(DEFAULT_SCRYPT_PARAMS);

      const plaintext = generateTestPlaintext();
      const vault = await encryptData(key, new TextEncoder().encode(plaintext));
      const decrypted = await decryptData(key, vault);
      expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    }, 1_000);
  });

  describe('encryptData / decryptData', () => {
    it('should round-trip encrypt and decrypt a string', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const plaintext = generateTestPlaintext();
      const vault = await encryptData(key, new TextEncoder().encode(plaintext));
      const decrypted = await decryptData(key, vault);

      expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (fresh IV)', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const plaintext = generateTestPlaintext();
      const vault1 = await encryptData(
        key,
        new TextEncoder().encode(plaintext)
      );
      const vault2 = await encryptData(
        key,
        new TextEncoder().encode(plaintext)
      );

      expect(vault1.data).not.toBe(vault2.data);
      expect(vault1.iv).not.toBe(vault2.iv);
    });

    it('should include version, base64-encoded scryptSalt, and keyMetadata in the vault', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );

      expect(vault.version).toBe(ENCRYPTED_VAULT_VERSION_V1);
      expect(vault.keyMetadata).toEqual({
        algorithm: KDF_ALGORITHM,
        params: TEST_FAST_SCRYPT_PARAMS
      });

      // scryptSalt: valid base64, decodes to exactly 32 bytes
      const decodedSalt = base64.decode(vault.scryptSalt);
      expect(decodedSalt).toHaveLength(32);
      expect(decodedSalt).toEqual(salt);

      // iv: valid base64, decodes to exactly 12 bytes
      const decodedIv = base64.decode(vault.iv);
      expect(decodedIv).toHaveLength(12);

      // data: valid base64, decodes to non-empty ciphertext
      const decodedData = base64.decode(vault.data);
      expect(decodedData.length).toBeGreaterThan(0);
    });

    it('should throw IncorrectPasswordError when decrypting with wrong key', async () => {
      const salt = generateScryptSalt();
      const correctKey = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );
      const wrongKey = await deriveEncryptionKey(
        ENCRYPTION_ALTERNATE_PASSWORD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        correctKey,
        new TextEncoder().encode(generateTestPlaintext())
      );

      await expect(decryptData(wrongKey, vault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should throw IncorrectPasswordError when ciphertext is tampered but maintains base64', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );

      // Flip a byte in the middle of the base64 data to corrupt ciphertext
      const chars = vault.data.split('');
      const midIdx = Math.floor(chars.length / 2);
      chars[midIdx] = chars[midIdx] === 'A' ? 'B' : 'A';
      const tamperedVault = {
        ...vault,
        data: chars.join('') as Base64Ciphertext
      };

      await expect(decryptData(key, tamperedVault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should throw VaultCorruptedError when ciphertext base64 is invalid', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      const corruptedVault = {
        ...vault,
        data: '!!!not-valid-base64!!!' as Base64Ciphertext
      };

      await expect(decryptData(key, corruptedVault)).rejects.toThrow(
        VaultCorruptedError
      );
    });

    it('should throw VaultCorruptedError when IV base64 is invalid', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      const corruptedVault = {
        ...vault,
        iv: '!!!not-valid-base64!!!' as Base64Iv
      };

      await expect(decryptData(key, corruptedVault)).rejects.toThrow(
        VaultCorruptedError
      );
    });

    it('should throw VaultCorruptedError when IV has wrong length', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      // Encode a 6-byte IV instead of the required 12
      const shortIv = base64.encode(new Uint8Array(6)) as Base64Iv;
      const corruptedVault = { ...vault, iv: shortIv };

      await expect(decryptData(key, corruptedVault)).rejects.toThrow(
        VaultCorruptedError
      );
    });

    test('should successfully decrypt invalid UTF-8 bytes as a raw array', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0x80, 0x81, 0xc0]);
      const expected = new Uint8Array(invalidUtf8);
      const vault = await encryptData(key, new Uint8Array(invalidUtf8));
      const decrypted = await decryptData(key, vault);
      expect(decrypted).toEqual(expected);
    });

    it('should throw IncorrectPasswordError when metadata keyMetadata.params.N is tampered', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      const tamperedVault: EncryptedVault = {
        ...vault,
        keyMetadata: {
          ...vault.keyMetadata,
          params: { ...vault.keyMetadata.params, N: 2 as ScryptCostParameter }
        }
      };

      await expect(decryptData(key, tamperedVault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should throw IncorrectPasswordError when metadata scryptSalt is tampered', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      const tamperedSalt = base64.encode(new Uint8Array(32).fill(0));
      const tamperedVault = {
        ...vault,
        scryptSalt: tamperedSalt as Base64ScryptSalt
      };

      await expect(decryptData(key, tamperedVault)).rejects.toThrow(
        IncorrectPasswordError
      );
    });

    it('should throw VaultCorruptedError when metadata version is tampered', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      const vault = await encryptData(
        key,
        new TextEncoder().encode(generateTestPlaintext())
      );
      const tamperedVault = {
        ...vault,
        version: 2 as EncryptedVault['version']
      };

      await expect(decryptData(key, tamperedVault)).rejects.toThrow(
        VaultCorruptedError
      );
    });

    it('should reject empty plaintext', async () => {
      const salt = generateScryptSalt();
      const key = await deriveEncryptionKey(
        ENCRYPTION_PWD,
        salt,
        TEST_FAST_SCRYPT_PARAMS
      );

      await expect(
        encryptData(key, new TextEncoder().encode(''))
      ).rejects.toThrow(EmptyPlaintextError);
    });
  });

  describe('deriveEncryptionKey error handling', () => {
    it('should throw KeyDerivationError when importKey fails', async () => {
      const salt = generateScryptSalt();

      // Temporarily replace subtle.importKey to simulate failure
      const originalImportKey = globalThis.crypto.subtle.importKey;
      globalThis.crypto.subtle.importKey = () =>
        Promise.reject(new Error('Simulated importKey failure'));

      try {
        await expect(
          deriveEncryptionKey(ENCRYPTION_PWD, salt, TEST_FAST_SCRYPT_PARAMS)
        ).rejects.toThrow(KeyDerivationError);
      } finally {
        globalThis.crypto.subtle.importKey = originalImportKey;
      }
    });
  });

  describe('app number derivation from PROJECTELEVEN hash', () => {
    test('LIBQC_APP_NO_BASE equals first 4 digits of sha256(PROJECTELEVEN)', () => {
      const hash = sha256(utf8ToBytes('PROJECTELEVEN'));
      // sha256("PROJECTELEVEN") = 48608ece0cec89729f24cfaad5e3b2a1d6fe50e33a2305a509fee41587376c88
      const hashHex = bytesToHex(hash);
      // First 4 hex chars: "4860" → 4860
      const appNo = Number(hashHex.slice(0, 4));
      expect(appNo).toBe(LIBQC_APP_NO_BASE);
    });
  });

  describe('CSPRNG randomness behaviour', () => {
    describe('getSecureRandomBytes', () => {
      it('should return bytes of the requested length', () => {
        expect(getSecureRandomBytes(16)).toHaveLength(16);
        expect(getSecureRandomBytes(32)).toHaveLength(32);
        expect(getSecureRandomBytes(64)).toHaveLength(64);
      });

      it('should return a Uint8Array', () => {
        expect(getSecureRandomBytes(8)).toBeInstanceOf(Uint8Array);
      });

      it('should produce different output on successive calls', () => {
        const a = getSecureRandomBytes(32);
        const b = getSecureRandomBytes(32);
        expect(a).not.toEqual(b);
      });

      it('should throw RangeError for zero length', () => {
        expect(() => getSecureRandomBytes(0)).toThrow(RangeError);
      });

      it('should throw RangeError for negative length', () => {
        expect(() => getSecureRandomBytes(-1)).toThrow(RangeError);
      });

      it('should throw RangeError for NaN', () => {
        expect(() => getSecureRandomBytes(NaN)).toThrow(RangeError);
      });

      it('should throw RangeError for non-integer', () => {
        expect(() => getSecureRandomBytes(1.5)).toThrow(RangeError);
      });

      it('should throw CsprngUnavailableError when crypto is undefined', async () => {
        await withCryptoOverride(undefined, () => {
          expect(() => getSecureRandomBytes(32)).toThrow(
            CsprngUnavailableError
          );
        });
      });

      it('should throw CsprngUnavailableError when getRandomValues is missing', async () => {
        await withCryptoOverride(
          { subtle: globalThis.crypto.subtle } as Crypto,
          () => {
            expect(() => getSecureRandomBytes(32)).toThrow(
              CsprngUnavailableError
            );
          }
        );
      });
    });

    describe('generateScryptSalt uses getSecureRandomBytes', () => {
      it('should throw CsprngUnavailableError when crypto is unavailable', async () => {
        await withCryptoOverride(undefined, () => {
          expect(() => generateScryptSalt()).toThrow(CsprngUnavailableError);
        });
      });
    });

    describe('encryptData IV randomness', () => {
      it('should generate a fresh IV for every encryption', async () => {
        const salt = generateScryptSalt();
        const key = await deriveEncryptionKey(
          ENCRYPTION_PWD,
          salt,
          TEST_FAST_SCRYPT_PARAMS
        );
        const plaintext = generateTestPlaintext();

        const ivs = new Set<string>();
        for (let i = 0; i < 10; i++) {
          const vault = await encryptData(
            key,
            new TextEncoder().encode(plaintext)
          );
          ivs.add(vault.iv);
        }
        // All 10 IVs must be unique
        expect(ivs.size).toBe(10);
      });

      it('should throw CsprngUnavailableError when crypto is unavailable during encryption', async () => {
        const salt = generateScryptSalt();
        const key = await deriveEncryptionKey(
          ENCRYPTION_PWD,
          salt,
          TEST_FAST_SCRYPT_PARAMS
        );

        await withCryptoOverride(undefined, async () => {
          await expect(
            encryptData(key, new TextEncoder().encode(generateTestPlaintext()))
          ).rejects.toThrow(CsprngUnavailableError);
        });
      });
    });
  });
});
