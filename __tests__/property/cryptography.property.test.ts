import fc from 'fast-check';
import { base64 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { type AddressIndex, Password } from '../../src';
import {
  decryptData,
  deriveBip85Entropy,
  deriveBitcoinPrivateKey,
  deriveEncryptionKey,
  deriveSecp256k1PrivateKey,
  encryptData,
  generateScryptSalt,
  getSecureRandomBytes,
  KDF_ALGORITHM,
  serializeMetadataForAAD,
  validateMnemonic,
  validatePassword,
  type AppNumber,
  type EntropyLength,
  type Base64Ciphertext,
  type Base64Iv,
  type Base64ScryptSalt,
  type EncryptedVault,
  type EncryptedVaultVersion,
  type ScryptCostParameter,
  type ScryptParams,
  type VaultEncryptionKeyWithMetadata
} from '../../src/cryptography';
import { IncorrectPasswordError, VaultCorruptedError } from '../../src/errors';
import {
  TEST_FAST_SCRYPT_PARAMS,
  getTestMnemonic,
  getTestSeed
} from '../testUtils';
import {
  arbAddressIndex,
  arbAppNumber,
  arbDifferentScryptN,
  arbInvalidLength,
  arbInvalidTokenString,
  arbInvalidUtf8Bytes,
  arbMalformedBase64,
  arbMetadataForAAD,
  arbMetadataForAADPair,
  arbNegativeIndex,
  arbNonCurrentVersion,
  arbNonEmptyPlaintext,
  arbNonIntegerIndex,
  arbPositiveInteger,
  arbScryptSalt,
  arbSmallAddressIndex,
  arbSmallScryptParams,
  arbTokenString12,
  arbValidEntropyLength,
  arbValidMnemonic24,
  arbWhitespaceWrapped
} from './arbitraries';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NUM_RUNS = Number(process.env.PROPERTY_NUM_RUNS) || 200;
const NUM_RUNS_SLOW = Math.ceil(NUM_RUNS / 10);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let sharedKey: VaultEncryptionKeyWithMetadata;
let wrongKey: VaultEncryptionKeyWithMetadata;
let masterHDKey: HDKey;

beforeAll(async () => {
  const salt = generateScryptSalt();
  sharedKey = await deriveEncryptionKey(
    Password.from(new TextEncoder().encode('property-test-password-1')),
    salt,
    TEST_FAST_SCRYPT_PARAMS
  );
  wrongKey = await deriveEncryptionKey(
    Password.from(new TextEncoder().encode('property-test-password-2')),
    salt,
    TEST_FAST_SCRYPT_PARAMS
  );
  const seed = mnemonicToSeedSync(new TextDecoder().decode(getTestMnemonic()));
  masterHDKey = HDKey.fromMasterSeed(seed);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cryptography (property-based)', () => {
  // -----------------------------------------------------------------------
  // validatePassword
  // -----------------------------------------------------------------------
  describe('validatePassword', () => {
    // Builds a password guaranteed to satisfy all five requirements:
    // 1+ uppercase, 1+ lowercase, 1+ digit, 1 special char, padded to >= 8 chars.
    const arbCompliantPassword = fc
      .tuple(
        fc.stringMatching(/^[A-Z]{1,3}$/),
        fc.stringMatching(/^[a-z]{1,3}$/),
        fc.stringMatching(/^[0-9]{1,3}$/),
        fc.constantFrom('!', '@', '#', '$', '%', '-', '_', '?'),
        fc.string({ unit: 'grapheme-ascii', minLength: 0, maxLength: 10 })
      )
      .map(([up, lo, dig, sp, extra]) => {
        const pw = up + lo + dig + sp + extra;
        return pw.length >= 8 ? pw : pw + 'abcdef'.slice(0, 8 - pw.length);
      });

    it('returns valid: true for any compliant password', () => {
      fc.assert(
        fc.property(arbCompliantPassword, pw => {
          const result = validatePassword(new TextEncoder().encode(pw));
          expect(result.valid).toBe(true);
          expect(result.requirements.minLength).toBe(true);
          expect(result.requirements.uppercase).toBe(true);
          expect(result.requirements.lowercase).toBe(true);
          expect(result.requirements.digit).toBe(true);
          expect(result.requirements.specialChar).toBe(true);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('returns minLength: false and valid: false for any password under 8 characters', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 7 }), pw => {
          const result = validatePassword(new TextEncoder().encode(pw));
          expect(result.requirements.minLength).toBe(false);
          expect(result.valid).toBe(false);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('valid is true iff every requirement is true', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 200 }), pw => {
          const result = validatePassword(new TextEncoder().encode(pw));
          const allMet =
            result.requirements.minLength &&
            result.requirements.uppercase &&
            result.requirements.lowercase &&
            result.requirements.digit &&
            result.requirements.specialChar &&
            result.requirements.asciiOnly;
          expect(result.valid).toBe(allMet);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('never throws for any string input', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), pw => {
          expect(() =>
            validatePassword(new TextEncoder().encode(pw))
          ).not.toThrow();
        }),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateMnemonic
  // -----------------------------------------------------------------------
  describe('validateMnemonic', () => {
    it('rejects any 12-token string', () => {
      fc.assert(
        fc.property(arbTokenString12, s => {
          expect(() => validateMnemonic(new TextEncoder().encode(s))).toThrow(
            /only supports 24-word mnemonics/
          );
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('accepts valid 24-word mnemonics', () => {
      fc.assert(
        fc.property(arbValidMnemonic24, s => {
          expect(() =>
            validateMnemonic(new TextEncoder().encode(s))
          ).not.toThrow();
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('rejects word count not in {24}', () => {
      fc.assert(
        fc.property(arbInvalidTokenString, s => {
          expect(() => validateMnemonic(new TextEncoder().encode(s))).toThrow(
            /Invalid mnemonic/
          );
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('output is trimmed regardless of surrounding whitespace', () => {
      fc.assert(
        fc.property(arbWhitespaceWrapped, s => {
          const result = validateMnemonic(new TextEncoder().encode(s));
          const decoded = new TextDecoder().decode(result);
          expect(decoded).toBe(decoded.trim());
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('idempotent for valid inputs', () => {
      fc.assert(
        fc.property(arbValidMnemonic24, s => {
          const first = validateMnemonic(new TextEncoder().encode(s));
          const second = validateMnemonic(first);
          expect(first).toEqual(second);
        }),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveBip85Entropy
  // -----------------------------------------------------------------------
  describe('deriveBip85Entropy', () => {
    it('deterministic — same inputs produce same output', () => {
      fc.assert(
        fc.property(
          arbAddressIndex,
          arbValidEntropyLength,
          arbAppNumber,
          (idx, len, appNo) => {
            const a = deriveBip85Entropy(masterHDKey, idx, len, appNo);
            const b = deriveBip85Entropy(masterHDKey, idx, len, appNo);
            expect(a).toEqual(b);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('output length equals requested entropyLength', () => {
      fc.assert(
        fc.property(
          arbAddressIndex,
          arbValidEntropyLength,
          arbAppNumber,
          (idx, len, appNo) => {
            const result = deriveBip85Entropy(masterHDKey, idx, len, appNo);
            expect(result).toHaveLength(len);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('different addressIndex produces different output', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99 }),
          arbValidEntropyLength,
          arbAppNumber,
          (idx, len, appNo) => {
            const a = deriveBip85Entropy(
              masterHDKey,
              idx as AddressIndex,
              len,
              appNo
            );
            const b = deriveBip85Entropy(
              masterHDKey,
              (idx + 1) as AddressIndex,
              len,
              appNo
            );
            expect(a).not.toEqual(b);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('different appNo produces different output', () => {
      fc.assert(
        fc.property(
          arbAddressIndex,
          arbValidEntropyLength,
          fc.integer({ min: 0, max: 65534 }),
          (idx, len, appNo) => {
            const a = deriveBip85Entropy(
              masterHDKey,
              idx,
              len,
              appNo as AppNumber
            );
            const b = deriveBip85Entropy(
              masterHDKey,
              idx,
              len,
              (appNo + 1) as AppNumber
            );
            expect(a).not.toEqual(b);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('throws for invalid entropyLength', () => {
      const invalidEntropyLength = fc.oneof(
        fc.integer({ min: 65, max: 128 }),
        fc.integer({ min: -100, max: 0 }),
        fc
          .double({ min: 1, max: 64, noNaN: true })
          .filter(n => !Number.isInteger(n))
      );
      fc.assert(
        fc.property(
          arbAddressIndex,
          invalidEntropyLength,
          arbAppNumber,
          (idx, len, appNo) => {
            expect(() =>
              deriveBip85Entropy(masterHDKey, idx, len as EntropyLength, appNo)
            ).toThrow(/Entropy length/);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveSecp256k1PrivateKey / deriveBitcoinPrivateKey
  // -----------------------------------------------------------------------
  describe('deriveSecp256k1PrivateKey / deriveBitcoinPrivateKey', () => {
    it('secp256k1 deterministic', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const a = deriveSecp256k1PrivateKey(getTestSeed(), idx);
          const b = deriveSecp256k1PrivateKey(getTestSeed(), idx);
          expect(a).toEqual(b);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('bitcoin deterministic', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const a = deriveBitcoinPrivateKey(getTestSeed(), idx);
          const b = deriveBitcoinPrivateKey(getTestSeed(), idx);
          expect(a).toEqual(b);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('EVM key differs from Bitcoin key for same mnemonic + index', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const evmKey = deriveSecp256k1PrivateKey(getTestSeed(), idx);
          const btcKey = deriveBitcoinPrivateKey(getTestSeed(), idx);
          expect(evmKey).not.toEqual(btcKey);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('secp256k1 format is 32-byte Uint8Array', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const key = deriveSecp256k1PrivateKey(getTestSeed(), idx);
          expect(key).toBeInstanceOf(Uint8Array);
          expect(key).toHaveLength(32);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('bitcoin is 32-byte Uint8Array', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const key = deriveBitcoinPrivateKey(getTestSeed(), idx);
          expect(key).toBeInstanceOf(Uint8Array);
          expect(key).toHaveLength(32);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('different indices produce different keys', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 19 }).map(n => n as AddressIndex), // max 19 so idx+1 stays <= 20
          idx => {
            const a = deriveSecp256k1PrivateKey(getTestSeed(), idx);
            const b = deriveSecp256k1PrivateKey(
              getTestSeed(),
              ((idx as number) + 1) as AddressIndex
            );
            expect(a).not.toEqual(b);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // getSecureRandomBytes
  // -----------------------------------------------------------------------
  describe('getSecureRandomBytes', () => {
    it('output length equals requested', () => {
      fc.assert(
        fc.property(arbPositiveInteger, len => {
          expect(getSecureRandomBytes(len)).toHaveLength(len);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('successive calls differ for 32+ bytes', () => {
      fc.assert(
        fc.property(fc.integer({ min: 32, max: 256 }), len => {
          const a = getSecureRandomBytes(len);
          const b = getSecureRandomBytes(len);
          expect(a).not.toEqual(b);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('throws RangeError for invalid inputs', () => {
      fc.assert(
        fc.property(arbInvalidLength, len => {
          expect(() => getSecureRandomBytes(len)).toThrow(RangeError);
        }),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveEncryptionKey
  // -----------------------------------------------------------------------
  describe('deriveEncryptionKey', () => {
    it('deterministic, interchangeable, and non-extractable AES-GCM', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 8, maxLength: 50 }),
          async pw => {
            const salt = generateScryptSalt();
            const [key1, key2] = await Promise.all([
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw)),
                salt,
                TEST_FAST_SCRYPT_PARAMS
              ),
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw)),
                salt,
                TEST_FAST_SCRYPT_PARAMS
              )
            ]);

            // Key metadata invariants
            expect(key1.aes256GcmKey.extractable).toBe(false);
            expect(key1.aes256GcmKey.algorithm).toEqual({
              name: 'AES-GCM',
              length: 256
            });

            // Interchangeability: key2 can decrypt what key1 encrypted
            const vault = await encryptData(
              key1,
              new TextEncoder().encode('test-plaintext')
            );
            const decrypted = await decryptData(key2, vault);
            expect(decrypted).toEqual(utf8ToBytes('test-plaintext'));
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('different passwords produce non-interchangeable keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.string({ minLength: 8, maxLength: 50 }),
          async (pw1, pw2) => {
            fc.pre(pw1 !== pw2);
            const salt = generateScryptSalt();
            const [key1, key2] = await Promise.all([
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw1)),
                salt,
                TEST_FAST_SCRYPT_PARAMS
              ),
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw2)),
                salt,
                TEST_FAST_SCRYPT_PARAMS
              )
            ]);
            const vault = await encryptData(
              key1,
              new TextEncoder().encode('test-plaintext')
            );
            await expect(decryptData(key2, vault)).rejects.toThrow(
              IncorrectPasswordError
            );
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('different salts produce non-interchangeable keys', async () => {
      await fc.assert(
        fc.asyncProperty(arbScryptSalt, arbScryptSalt, async (salt1, salt2) => {
          fc.pre(!salt1.every((b, i) => b === salt2[i]));
          const pw = Password.from(
            new TextEncoder().encode('same-password-here')
          );
          const [key1, key2] = await Promise.all([
            deriveEncryptionKey(pw, salt1, TEST_FAST_SCRYPT_PARAMS),
            deriveEncryptionKey(pw, salt2, TEST_FAST_SCRYPT_PARAMS)
          ]);
          const vault = await encryptData(
            key1,
            new TextEncoder().encode('test-plaintext')
          );
          await expect(decryptData(key2, vault)).rejects.toThrow(
            IncorrectPasswordError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // encryptData / decryptData
  // -----------------------------------------------------------------------
  describe('encryptData / decryptData', () => {
    it('round-trip invariant for any non-empty string', async () => {
      await fc.assert(
        fc.asyncProperty(arbNonEmptyPlaintext, async pt => {
          const vault = await encryptData(
            sharedKey,
            new TextEncoder().encode(pt)
          );
          const decrypted = await decryptData(sharedKey, vault);
          expect(decrypted).toEqual(utf8ToBytes(pt));
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('each encryption produces different ciphertext (IV freshness)', async () => {
      await fc.assert(
        fc.asyncProperty(arbNonEmptyPlaintext, async pt => {
          const v1 = await encryptData(sharedKey, new TextEncoder().encode(pt));
          const v2 = await encryptData(sharedKey, new TextEncoder().encode(pt));
          expect(v1.data).not.toBe(v2.data);
          expect(v1.iv).not.toBe(v2.iv);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('wrong key throws IncorrectPasswordError', async () => {
      await fc.assert(
        fc.asyncProperty(arbNonEmptyPlaintext, async pt => {
          const vault = await encryptData(
            sharedKey,
            new TextEncoder().encode(pt)
          );
          await expect(decryptData(wrongKey, vault)).rejects.toThrow(
            IncorrectPasswordError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // vault corruption / failure modes
  // -----------------------------------------------------------------------
  describe('vault corruption / failure modes', () => {
    let corruptionVault: EncryptedVault;
    beforeAll(async () => {
      corruptionVault = await encryptData(
        sharedKey,
        new TextEncoder().encode('test-data')
      );
    });

    it('flip one byte in ciphertext produces IncorrectPasswordError', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbNonEmptyPlaintext,
          fc.nat(),
          async (pt, posSeed) => {
            const vault = await encryptData(
              sharedKey,
              new TextEncoder().encode(pt)
            );
            const ciphertextBytes = base64.decode(vault.data);
            const pos = posSeed % ciphertextBytes.length;
            ciphertextBytes[pos] ^= 0x01;
            const tampered: EncryptedVault = {
              ...vault,
              data: base64.encode(ciphertextBytes) as Base64Ciphertext
            };
            await expect(decryptData(sharedKey, tampered)).rejects.toThrow(
              IncorrectPasswordError
            );
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('corrupted base64 in data field produces VaultCorruptedError', async () => {
      await fc.assert(
        fc.asyncProperty(arbMalformedBase64, async badData => {
          const corrupted: EncryptedVault = {
            ...corruptionVault,
            data: badData as Base64Ciphertext
          };
          await expect(decryptData(sharedKey, corrupted)).rejects.toThrow(
            VaultCorruptedError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('corrupted base64 in IV field produces VaultCorruptedError', async () => {
      await fc.assert(
        fc.asyncProperty(arbMalformedBase64, async badIv => {
          const corrupted: EncryptedVault = {
            ...corruptionVault,
            iv: badIv as Base64Iv
          };
          await expect(decryptData(sharedKey, corrupted)).rejects.toThrow(
            VaultCorruptedError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('truncated IV (wrong length) produces VaultCorruptedError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 32 }).filter(n => n !== 12),
          async ivLen => {
            const badIv = base64.encode(new Uint8Array(ivLen)) as Base64Iv;
            const corrupted: EncryptedVault = {
              ...corruptionVault,
              iv: badIv
            };
            await expect(decryptData(sharedKey, corrupted)).rejects.toThrow(
              VaultCorruptedError
            );
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('mutated scryptSalt in metadata produces IncorrectPasswordError', async () => {
      await fc.assert(
        fc.asyncProperty(arbScryptSalt, async fakeSaltBytes => {
          const fakeSalt = base64.encode(fakeSaltBytes) as Base64ScryptSalt;
          fc.pre(fakeSalt !== corruptionVault.scryptSalt);
          const tampered: EncryptedVault = {
            ...corruptionVault,
            scryptSalt: fakeSalt
          };
          await expect(decryptData(sharedKey, tampered)).rejects.toThrow(
            IncorrectPasswordError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('mutated version in metadata produces VaultCorruptedError', async () => {
      await fc.assert(
        fc.asyncProperty(arbNonCurrentVersion, async version => {
          const tampered: EncryptedVault = {
            ...corruptionVault,
            version: version as EncryptedVaultVersion
          };
          await expect(decryptData(sharedKey, tampered)).rejects.toThrow(
            VaultCorruptedError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('mutated keyMetadata.params.N produces IncorrectPasswordError', async () => {
      await fc.assert(
        fc.asyncProperty(arbDifferentScryptN, async n => {
          const tampered: EncryptedVault = {
            ...corruptionVault,
            keyMetadata: {
              ...corruptionVault.keyMetadata,
              params: {
                ...corruptionVault.keyMetadata.params,
                N: n as ScryptCostParameter
              }
            }
          };
          await expect(decryptData(sharedKey, tampered)).rejects.toThrow(
            IncorrectPasswordError
          );
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // serializeMetadataForAAD
  // -----------------------------------------------------------------------
  describe('serializeMetadataForAAD', () => {
    it('deterministic — same input produces same output', () => {
      fc.assert(
        fc.property(arbMetadataForAAD, meta => {
          const a = serializeMetadataForAAD(meta as never);
          const b = serializeMetadataForAAD(meta as never);
          expect(a).toEqual(b);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('output is valid UTF-8', () => {
      fc.assert(
        fc.property(arbMetadataForAAD, meta => {
          const bytes = serializeMetadataForAAD(meta as never);
          const decoder = new TextDecoder('utf-8', { fatal: true });
          expect(() => decoder.decode(bytes)).not.toThrow();
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('parsed output contains all input fields', () => {
      fc.assert(
        fc.property(arbMetadataForAAD, meta => {
          const bytes = serializeMetadataForAAD(meta as never);
          const decoder = new TextDecoder('utf-8', { fatal: true });
          const parsed = JSON.parse(decoder.decode(bytes));
          expect(parsed.version).toBe(meta.version);
          expect(parsed.scryptSalt).toBe(meta.scryptSalt);
          expect(parsed.keyMetadata.algorithm).toBe(meta.keyMetadata.algorithm);
          expect(parsed.keyMetadata.params.N).toBe(meta.keyMetadata.params.N);
          expect(parsed.keyMetadata.params.r).toBe(meta.keyMetadata.params.r);
          expect(parsed.keyMetadata.params.p).toBe(meta.keyMetadata.params.p);
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('byte-identical output regardless of JS property insertion order', () => {
      fc.assert(
        fc.property(arbMetadataForAADPair, ({ a, b }) => {
          const bytesA = serializeMetadataForAAD(a as never);
          const bytesB = serializeMetadataForAAD(b as never);
          expect(bytesA).toEqual(bytesB);
        }),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveSecp256k1PrivateKey / deriveBitcoinPrivateKey — invalid indices
  // -----------------------------------------------------------------------
  describe('deriveSecp256k1PrivateKey / deriveBitcoinPrivateKey — invalid indices', () => {
    it('rejects negative address indices', () => {
      fc.assert(
        fc.property(arbNegativeIndex, idx => {
          expect(() => deriveSecp256k1PrivateKey(getTestSeed(), idx)).toThrow(
            /Invalid address index/
          );
          expect(() => deriveBitcoinPrivateKey(getTestSeed(), idx)).toThrow(
            /Invalid address index/
          );
        }),
        { numRuns: NUM_RUNS }
      );
    });

    it('rejects non-integer address indices', () => {
      fc.assert(
        fc.property(arbNonIntegerIndex, idx => {
          expect(() => deriveSecp256k1PrivateKey(getTestSeed(), idx)).toThrow(
            /Invalid address index/
          );
          expect(() => deriveBitcoinPrivateKey(getTestSeed(), idx)).toThrow(
            /Invalid address index/
          );
        }),
        { numRuns: NUM_RUNS }
      );
    });
  });

  // -----------------------------------------------------------------------
  // Invalid UTF-8 decrypt path
  // -----------------------------------------------------------------------
  describe('invalid UTF-8 decrypt path', () => {
    it('encrypted invalid UTF-8 bytes are returned as-is (byte-oriented decryption)', async () => {
      await fc.assert(
        fc.asyncProperty(arbInvalidUtf8Bytes, async invalidBytes => {
          const expected = new Uint8Array(invalidBytes);
          const vault = await encryptData(
            sharedKey,
            new Uint8Array(invalidBytes)
          );
          const decrypted = await decryptData(sharedKey, vault);
          expect(decrypted).toEqual(expected);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveBitcoinPrivateKey — copy isolation
  // -----------------------------------------------------------------------
  describe('deriveBitcoinPrivateKey — copy isolation', () => {
    it('mutating returned key does not affect subsequent derivations', () => {
      fc.assert(
        fc.property(arbSmallAddressIndex, idx => {
          const key1 = deriveBitcoinPrivateKey(getTestSeed(), idx);
          const key1Copy = new Uint8Array(key1);
          key1.fill(0xff);
          const key2 = deriveBitcoinPrivateKey(getTestSeed(), idx);
          expect(key2).toEqual(key1Copy);
        }),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });

  // -----------------------------------------------------------------------
  // deriveEncryptionKey — scrypt parameter fuzzing
  // -----------------------------------------------------------------------
  describe('deriveEncryptionKey — scrypt parameter fuzzing', () => {
    it('same params + password + salt produce interchangeable keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 8, maxLength: 30 }),
          arbSmallScryptParams,
          async (pw, params) => {
            const salt = generateScryptSalt();
            const [key1, key2] = await Promise.all([
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw)),
                salt,
                params as ScryptParams
              ),
              deriveEncryptionKey(
                Password.from(new TextEncoder().encode(pw)),
                salt,
                params as ScryptParams
              )
            ]);
            const vault = await encryptData(
              key1,
              new TextEncoder().encode('interchangeability-test')
            );
            const decrypted = await decryptData(key2, vault);
            expect(decrypted).toEqual(utf8ToBytes('interchangeability-test'));
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });

    it('metadata echoes scrypt params exactly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 8, maxLength: 30 }),
          arbSmallScryptParams,
          async (pw, params) => {
            const salt = generateScryptSalt();
            const key = await deriveEncryptionKey(
              Password.from(new TextEncoder().encode(pw)),
              salt,
              params as ScryptParams
            );
            expect(key.derivationOptions.algorithm).toBe(KDF_ALGORITHM);
            expect(key.derivationOptions.params.N).toBe(params.N);
            expect(key.derivationOptions.params.r).toBe(params.r);
            expect(key.derivationOptions.params.p).toBe(params.p);
          }
        ),
        { numRuns: NUM_RUNS_SLOW }
      );
    });
  });
});
