import { vi, describe, it, expect } from 'vitest';
import { HDKey } from '@scure/bip32';
import * as scryptModule from '@noble/hashes/scrypt.js';
import * as hmacModule from '@noble/hashes/hmac.js';
import * as cryptography from '../../src/cryptography';
import {
  deriveBip85Entropy,
  deriveSecp256k1PrivateKey,
  deriveBitcoinPrivateKey,
  deriveEncryptionKey,
  AppNumber,
  EntropyLength,
  ScryptSalt,
  ScryptParams
} from '../../src/cryptography';
import { deriveBitcoinAddressFromSeed } from '../../src/addresses';
import { AddressIndex, Password, Seed } from '../../src/types';

vi.mock('@noble/hashes/scrypt.js', async () => {
  const actual = await vi.importActual<
    typeof import('@noble/hashes/scrypt.js')
  >('@noble/hashes/scrypt.js');
  return { ...actual, scrypt: vi.fn() };
});

vi.mock('@noble/hashes/hmac.js', async () => {
  const actual = await vi.importActual<typeof import('@noble/hashes/hmac.js')>(
    '@noble/hashes/hmac.js'
  );
  return { ...actual, hmac: vi.fn() };
});

describe('cryptography security zeroing', () => {
  it('should zero out the private key buffer in deriveBip85Entropy', () => {
    vi.mocked(hmacModule.hmac).mockReturnValue(new Uint8Array(64));

    const seed = new Uint8Array(64).fill(0x01);
    const root = HDKey.fromMasterSeed(seed);
    let capturedPrivKey: Uint8Array | undefined;

    const originalDerive = root.derive.bind(root);
    vi.spyOn(root, 'derive').mockImplementation((path: string) => {
      const node = originalDerive(path);
      const privKey = node.privateKey;
      if (!privKey) throw new Error('no private key');
      capturedPrivKey = privKey;

      Object.defineProperty(node, 'privateKey', {
        get: () => privKey,
        configurable: true
      });

      vi.spyOn(node, 'wipePrivateData').mockImplementation(() => node);
      return node;
    });

    deriveBip85Entropy(
      root,
      0 as AddressIndex,
      32 as EntropyLength,
      1234 as AppNumber
    );
    expect(capturedPrivKey).toEqual(
      new Uint8Array(capturedPrivKey!.length).fill(0)
    );
  });

  it('does not mutate the caller-owned seed buffer in deriveSecp256k1PrivateKey', () => {
    const seed = Seed.from(new Uint8Array(64).fill(0x02));
    const snapshot = new Uint8Array(seed);

    deriveSecp256k1PrivateKey(seed, 0 as AddressIndex);

    expect(seed).toEqual(snapshot);
  });

  it('should zero out the entropy buffer in deriveBitcoinPrivateKey', () => {
    const trackedEntropy = new Uint8Array(64).fill(0x05);
    trackedEntropy.slice = vi.fn().mockReturnValue(trackedEntropy);

    vi.mocked(hmacModule.hmac).mockReturnValue(trackedEntropy);
    const seed = Seed.from(new Uint8Array(64).fill(0x09));

    deriveBitcoinPrivateKey(seed, 0 as AddressIndex);
    expect(new Uint8Array(trackedEntropy)).toEqual(new Uint8Array(64).fill(0));
  });

  it('should zero out the key material buffer in deriveEncryptionKey', async () => {
    const trackedKeyMaterial = new Uint8Array(32).fill(0x03);
    vi.mocked(scryptModule.scrypt).mockReturnValue(trackedKeyMaterial);

    const password = new Uint8Array(16).fill(0x06) as Password;
    const salt = new Uint8Array(32).fill(0x04) as ScryptSalt;
    const params = { N: 2, r: 8, p: 1 } as ScryptParams;

    await deriveEncryptionKey(password, salt, params);

    expect(trackedKeyMaterial).toEqual(new Uint8Array(32).fill(0));
    expect(password[0]).toBe(0x06);
  });

  it('should zero out the private key in deriveBitcoinAddressFromSeed', () => {
    const trackedPrivKey = new Uint8Array(32).fill(0x07);
    vi.spyOn(cryptography, 'deriveBitcoinPrivateKey').mockReturnValue(
      trackedPrivKey
    );

    const seed = Seed.from(new Uint8Array(64).fill(0x0a));
    deriveBitcoinAddressFromSeed(seed, 0 as AddressIndex);

    expect(trackedPrivKey).toEqual(new Uint8Array(32).fill(0));
  });
});
