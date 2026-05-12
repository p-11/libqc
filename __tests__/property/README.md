# Property-Based Tests for `cryptography.ts`

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check)
to generate random inputs and assert invariants that must hold for all values.

## How to run

```bash
pnpm test:property                         # default (200 fast / 20 slow runs)
PROPERTY_NUM_RUNS=2000 pnpm test:property  # deeper coverage (nightly)
```

## Covered functions

| Function | Invariants |
|----------|-----------|
| `validatePassword` | Evaluates requirements, returns `PasswordValidationResult` |
| `validateMnemonic` | 12/24 tokens accepted, other counts rejected, output trimmed, idempotent |
| `deriveBip85Entropy` | Deterministic, correct output length, collision resistance (index, appNo), rejects invalid lengths (> 64, ≤ 0, fractional) |
| `deriveSecp256k1PrivateKey` | Deterministic, 0x + 64 hex format, different indices differ, rejects invalid mnemonics/indices |
| `deriveBitcoinPrivateKey` | Deterministic, 32-byte Uint8Array, differs from EVM at same index, copy isolation, rejects invalid mnemonics/indices |
| `getSecureRandomBytes` | Correct length, successive calls differ, invalid inputs throw |
| `deriveEncryptionKey` | Deterministic + interchangeable + non-extractable, different passwords/salts non-interchangeable, bounded scrypt param fuzzing (interchangeability + metadata echo) |
| `encryptData / decryptData` | Round-trip, IV freshness, wrong-key rejection |
| Vault corruption | Byte flip, malformed base64 (5 classes), wrong IV length, metadata mutation (salt, version, scrypt N) |
| Vault versioning | Current vault schema is V1; non-current versions are rejected |
| Invalid UTF-8 decrypt | Encrypted non-UTF-8 bytes produce VaultCorruptedError |
| `serializeMetadataForAAD` | Deterministic, valid UTF-8, field round-trip, insertion-order canonicalization |

## `normaliseBalance` invariants

| Invariant | Description |
|-----------|-------------|
| Identity | `normalise(x, d, d) === x` |
| Round-trip | Scale up then down recovers original (`lo→hi→lo === identity`) |
| Non-negative | Output `>= 0` for any non-negative input |
| Monotonicity | `x > y` implies `normalise(x) >= normalise(y)` |
| Transitivity | `a→b→c === a→c` when only scaling up (sorted decimals) |
| Invalid decimals | Negative or non-integer decimals always throw `InvalidAssetDecimalsError` |

## Custom arbitraries

Reusable generators live in `arbitraries.ts`:

| Arbitrary | Description |
|-----------|-------------|
| `arbTokenString12/24` | Random non-whitespace token strings (not BIP-39 words — see note below) |
| `arbAddressIndex` | 0..100, typed as `AddressIndex` |
| `arbSmallAddressIndex` | 0..20, for expensive key derivation tests |
| `arbValidEntropyLength` | 1..64, typed as `EntropyLength` |
| `arbAppNumber` | 0..65535, typed as `AppNumber` |
| `arbNonEmptyPlaintext` | Grapheme-based Unicode string (1-5000 chars) |
| `arbScryptSalt` | Random 32-byte `Uint8Array`, typed as `ScryptSalt` |
| `arbMalformedBase64` | 5 classes: non-alphabet chars, wrong length, excess padding, trailing garbage, misplaced padding |
| `arbNonCurrentVersion` | Random int != `ENCRYPTED_VAULT_VERSION_V1` |
| `arbDifferentScryptN` | Random int != `TEST_FAST_SCRYPT_PARAMS.N` |
| `arbMetadataForAAD` | Random vault metadata record |
| `arbInvalidMnemonic` | 1-30 tokens, count != 12 and != 24 |
| `arbNegativeIndex` | Negative integers, typed as `AddressIndex` |
| `arbNonIntegerIndex` | Non-integer floats, typed as `AddressIndex` |
| `arbInvalidUtf8Bytes` | Byte arrays that fail UTF-8 decoding |
| `arbMetadataForAADPair` | Pair of equivalent metadata with reversed JS property insertion order |
| `arbSmallScryptParams` | Bounded scrypt params (N <= 2048) for fast fuzzing |
| `arbDecimals` | Non-negative integer 0..30 (covers all real-world token decimals) |
| `arbBalanceBigInt` | Non-negative BigInt 0..10^30 |

**Note on mnemonic arbitraries:** `arbTokenString12/24` generate arbitrary
non-whitespace tokens, not real BIP-39 words. This matches the current
`validateMnemonic()` which only checks word count. When BIP-39 wordlist/checksum
validation is added, these arbitraries must be updated.

## How to replay a failure

fast-check prints a seed on failure. Re-run with:

```typescript
fc.assert(fc.property(...), { numRuns: NUM_RUNS, seed: <seed> });
```

Or set `FC_SEED` environment variable for the entire suite.
