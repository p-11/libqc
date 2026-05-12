import fc from 'fast-check';
import { base64 } from '@scure/base';
import type { AddressIndex } from '../../src/types';
import type {
  AppNumber,
  EntropyLength,
  ScryptBlockSize,
  ScryptCostParameter,
  ScryptParallelism,
  ScryptSalt
} from '../../src/cryptography';
import {
  ENCRYPTED_VAULT_VERSION_V1,
  KDF_ALGORITHM
} from '../../src/cryptography';
import { TEST_FAST_SCRYPT_PARAMS, TEST_MNEMONIC_PHRASE } from '../testUtils';

// ---------------------------------------------------------------------------
// Mnemonic / token-string arbitraries
//
// These generate arbitrary non-whitespace tokens, NOT real BIP-39 words.
// This matches the current validateMnemonic() which only checks word count.
// ---------------------------------------------------------------------------

/** A non-whitespace token (1-10 chars) */
const arbWord = fc.stringMatching(/^\S{1,10}$/);

/** 12 random non-whitespace tokens joined by space */
export const arbTokenString12 = fc
  .array(arbWord, { minLength: 12, maxLength: 12 })
  .map(ws => ws.join(' '));

/** 24 random non-whitespace tokens joined by space */
export const arbTokenString24 = fc
  .array(arbWord, { minLength: 24, maxLength: 24 })
  .map(ws => ws.join(' '));

/** Known-valid 24-word mnemonic fixture (uses shared TEST_MNEMONIC_PHRASE) */
export const arbValidMnemonic24 = fc.constant(TEST_MNEMONIC_PHRASE);

/** Wrong word count: 0-11, 13-23, or 25-30 */
export const arbInvalidTokenString = fc
  .nat({ max: 30 })
  .filter(n => n !== 24)
  .chain(n => fc.array(arbWord, { minLength: n, maxLength: n }))
  .map(ws => ws.join(' '));

/** Whitespace arbitrary for padding */
const arbWhitespace = fc
  .array(fc.constantFrom(' ', '\t', '\n'), {
    minLength: 0,
    maxLength: 5
  })
  .map(cs => cs.join(''));

/** Valid 24-word mnemonic wrapped in random leading/trailing whitespace */
export const arbWhitespaceWrapped = fc
  .tuple(arbWhitespace, arbValidMnemonic24, arbWhitespace)
  .map(([pre, s, suf]) => pre + s + suf);

// ---------------------------------------------------------------------------
// Numeric arbitraries
// ---------------------------------------------------------------------------

/** Address index 0..100 */
export const arbAddressIndex = fc.nat({ max: 100 }).map(n => n as AddressIndex);

/** Small address index 0..20 (for expensive key derivation tests) */
export const arbSmallAddressIndex = fc
  .integer({ min: 0, max: 20 })
  .map(n => n as AddressIndex);

/** Valid BIP-32/BIP-39 entropy length 16..64 bytes (128..512 bits) */
export const arbValidEntropyLength = fc
  .integer({ min: 16, max: 64 })
  .map(n => n as EntropyLength);

/** Application number 0..65535 */
export const arbAppNumber = fc
  .integer({ min: 0, max: 65535 })
  .map(n => n as AppNumber);

/** Positive integer 1..1024 */
export const arbPositiveInteger = fc.integer({ min: 1, max: 1024 });

/** Invalid length values: 0, negative, float, NaN, Infinity */
export const arbInvalidLength = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -1000, max: -1 }),
  fc.integer({ min: 0, max: 1000 }).map(n => n + 0.5),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity)
);

// ---------------------------------------------------------------------------
// String / plaintext arbitraries
// ---------------------------------------------------------------------------

/** Non-empty grapheme-based Unicode string (1-5000 chars) */
export const arbNonEmptyPlaintext = fc.string({
  minLength: 1,
  maxLength: 5000,
  unit: 'grapheme'
});

// ---------------------------------------------------------------------------
// Vault metadata arbitraries
// ---------------------------------------------------------------------------

/** Random 32-byte salt (typed as ScryptSalt) */
export const arbScryptSalt = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map(b => b as ScryptSalt);

/**
 * Strings that are not valid base64. Covers multiple malformation classes:
 * - Characters outside the base64 alphabet
 * - Valid-alphabet strings with bad padding (e.g. "AAAA====", "AA=")
 * - Valid-alphabet strings with wrong length (e.g. "AAAAA", "A")
 * - Trailing garbage after padding (e.g. "AAAA==XX")
 *
 * All generated strings are verified to actually fail @scure/base base64.decode.
 */
const arbBase64Char = fc.stringMatching(/^[A-Za-z0-9+/]$/);

export const arbMalformedBase64 = fc
  .oneof(
    // Class 1: non-base64 characters
    fc.stringMatching(/^[^A-Za-z0-9+/=]{1,50}$/),
    // Class 2: wrong length (not multiple of 4, no valid padding)
    fc
      .array(arbBase64Char, { minLength: 1, maxLength: 50 })
      .map(cs => cs.join(''))
      .filter(s => s.length % 4 !== 0),
    // Class 3: excess padding
    fc
      .array(arbBase64Char, { minLength: 4, maxLength: 40 })
      .map(cs => cs.join(''))
      .filter(s => s.length % 4 === 0)
      .map(s => s + '===='),
    // Class 4: trailing garbage after padding
    fc
      .tuple(
        fc
          .array(arbBase64Char, { minLength: 2, maxLength: 20 })
          .map(cs => cs.join('')),
        fc
          .array(arbBase64Char, { minLength: 1, maxLength: 5 })
          .map(cs => cs.join(''))
      )
      .map(([body, tail]) => body + '==' + tail),
    // Class 5: single padding char in wrong position
    fc
      .array(arbBase64Char, { minLength: 1, maxLength: 20 })
      .map(cs => cs.join('') + '=')
      .filter(s => s.length % 4 !== 0)
  )
  .filter(s => {
    // Safety net: ensure @scure/base actually rejects it
    try {
      base64.decode(s);
      return false;
    } catch {
      return true;
    }
  });

/** Random vault version != ENCRYPTED_VAULT_VERSION_V1 */
export const arbNonCurrentVersion = fc
  .integer({ min: 0, max: 1000 })
  .filter(n => n !== (ENCRYPTED_VAULT_VERSION_V1 as number));

/** Random scrypt N that differs from TEST_FAST_SCRYPT_PARAMS.N */
export const arbDifferentScryptN = fc
  .integer({ min: 1, max: 100000 })
  .filter(n => n !== (TEST_FAST_SCRYPT_PARAMS.N as number));

/** Generates a MetadataForAAD-shaped object */
export const arbMetadataForAAD = fc.record({
  version: fc.integer({ min: 1, max: 10 }),
  scryptSalt: fc.base64String({ minLength: 44, maxLength: 44 }),
  keyMetadata: fc.record({
    algorithm: fc.constant(KDF_ALGORITHM),
    params: fc.record({
      N: fc.constantFrom(1024, 2048, 4096, 131072),
      r: fc.constantFrom(8, 16),
      p: fc.constantFrom(1, 2)
    })
  })
});

// ---------------------------------------------------------------------------
// Invalid-input arbitraries
// ---------------------------------------------------------------------------

/** Mnemonic with wrong word count (1-30 tokens, ≠ 12 and ≠ 24) */
export const arbInvalidMnemonic = fc
  .integer({ min: 1, max: 30 })
  .filter(n => n !== 24)
  .chain(n => fc.array(arbWord, { minLength: n, maxLength: n }))
  .map(ws => ws.join(' '));

/** Negative address index */
export const arbNegativeIndex = fc
  .integer({ min: -1000, max: -1 })
  .map(n => n as AddressIndex);

/** Non-integer address index (floats) */
export const arbNonIntegerIndex = fc
  .integer({ min: 0, max: 1000 })
  .map(n => n + 0.5)
  .map(n => n as AddressIndex);

/** Byte array guaranteed to not be valid UTF-8 */
export const arbInvalidUtf8Bytes = fc
  .uint8Array({ minLength: 1, maxLength: 200 })
  .filter(bytes => {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return false;
    } catch {
      return true;
    }
  });

/**
 * Pair of MetadataForAAD objects with identical values but different
 * JS property insertion order, for testing canonicalization.
 */
export const arbMetadataForAADPair = arbMetadataForAAD.map(meta => {
  // Object A: natural insertion order
  const a = {
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
  // Object B: reversed insertion order
  const paramsB: Record<string, unknown> = {};
  paramsB['p'] = meta.keyMetadata.params.p;
  paramsB['r'] = meta.keyMetadata.params.r;
  paramsB['N'] = meta.keyMetadata.params.N;
  const keyMetadataB: Record<string, unknown> = {};
  keyMetadataB['params'] = paramsB;
  keyMetadataB['algorithm'] = meta.keyMetadata.algorithm;
  const b: Record<string, unknown> = {};
  b['keyMetadata'] = keyMetadataB;
  b['scryptSalt'] = meta.scryptSalt;
  b['version'] = meta.version;
  return { a, b };
});

// ---------------------------------------------------------------------------
// Balance / decimal arbitraries
// ---------------------------------------------------------------------------

/** Non-negative decimals 0..30 (covers all real-world token decimals) */
export const arbDecimals = fc.integer({ min: 0, max: 30 });

/**
 * Non-negative BigInt balance (0..10^30).
 * Upper bound is well above realistic balances to stress precision paths.
 */
export const arbBalanceBigInt = fc.bigInt({ min: 0n, max: 10n ** 30n });

/** Small scrypt params for bounded fuzzing (N ≤ 2048 for speed) */
export const arbSmallScryptParams = fc.record({
  N: fc.constantFrom(256, 512, 1024, 2048).map(n => n as ScryptCostParameter),
  r: fc.constantFrom(1, 2, 4, 8).map(n => n as ScryptBlockSize),
  p: fc.constantFrom(1, 2).map(n => n as ScryptParallelism)
});
