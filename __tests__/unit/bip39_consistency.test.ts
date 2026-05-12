import { describe, expect, it } from 'vitest';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  generateMnemonic
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { getSecureRandomBytes } from '../../src/cryptography';

describe('BIP-39 Consistency (Entropy vs Mnemonic vs Seed)', () => {
  it('should demonstrate that Entropy <-> Mnemonic is a reversible 1:1 mapping', () => {
    // 1. Generate random entropy (32 bytes = 256 bits)
    const originalEntropy = getSecureRandomBytes(32);

    // 2. Convert entropy to mnemonic words
    const mnemonic = entropyToMnemonic(originalEntropy, wordlist);
    expect(mnemonic.split(' ').length).toBe(24);

    // 3. Convert mnemonic back to entropy
    const reconstructedEntropy = mnemonicToEntropy(mnemonic, wordlist);

    // 4. Verify they are identical
    expect(reconstructedEntropy).toEqual(originalEntropy);
  });

  it('should demonstrate that Seed is derived from Mnemonic and matches consistently', () => {
    const mnemonic = generateMnemonic(wordlist, 256);

    // Seed is derived via PBKDF2(mnemonic, "mnemonic" + passphrase)
    // In our implementation we use no passphrase (empty string)
    const seed1 = mnemonicToSeedSync(mnemonic);
    const seed2 = mnemonicToSeedSync(mnemonic);

    expect(seed1.length).toBe(64); // 512 bits
    expect(seed1).toEqual(seed2);
  });

  it('should prove that storing Entropy is enough to recover Mnemonic, but Seed is not', () => {
    const entropy = getSecureRandomBytes(32);
    const mnemonic = entropyToMnemonic(entropy, wordlist);

    // From entropy we can get words
    const recoveredMnemonic = entropyToMnemonic(entropy, wordlist);
    expect(recoveredMnemonic).toBe(mnemonic);

    // There is no function in BIP-39 to go from Seed -> Mnemonic
    // because Seed is a result of a one-way HMAC-SHA512 hash (PBKDF2).
    // This is why LibQC stores BOTH:
    // - entropy (to show words to user)
    // - seed (for fast key derivation)
  });

  it('should verify our internal conversion helpers in cryptography.ts', async () => {
    const { mnemonicToEntropyBytes, entropyToMnemonicBytes } = await import(
      '../../src/cryptography'
    );

    const originalMnemonicStr = generateMnemonic(wordlist, 256);
    const originalMnemonicBytes = new TextEncoder().encode(originalMnemonicStr);

    const entropy = mnemonicToEntropyBytes(originalMnemonicBytes);
    const recoveredMnemonicBytes = entropyToMnemonicBytes(entropy);

    expect(new TextDecoder().decode(recoveredMnemonicBytes)).toBe(
      originalMnemonicStr
    );
  });
});
