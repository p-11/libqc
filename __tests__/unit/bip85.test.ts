/**
 * BIP-85 spec compliance: verifies deriveBip85Entropy output against
 * official test vectors from bip-0085.mediawiki. Only 3-level hardened
 * paths (m/83696968'/<appNo>'/<index>') are testable through LibQC's
 * helper; deeper paths (BIP-39, HEX, PWD, DICE) are not supported.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { base58check } from '@scure/base';
import { HDKey } from '@scure/bip32';

import { type AddressIndex } from '../../src';
import {
  deriveBip85Entropy,
  deriveBitcoinPrivateKey,
  type AppNumber,
  type EntropyLength
} from '../../src/cryptography';
import { BIP85_SPEC_XPRV, bytesToHex, getTestSeed } from '../testUtils';

const bs58check = base58check(sha256);

describe('BIP-85 Specification Compliance', () => {
  const root = HDKey.fromExtendedKey(BIP85_SPEC_XPRV);

  // prettier-ignore
  const specVectors = [
    { name: "raw entropy - m/83696968'/0'/0' (spec case 1)", index: 0, length: 64, appNo: 0, expected: 'efecfbccffea313214232d29e71563d941229afb4338c21f9517c41aaa0d16f00b83d2a09ef747e7a64e8e2bd5a14869e693da66ce94ac2da570ab7ee48618f7' },
    { name: "raw entropy - m/83696968'/0'/1' (spec case 2)", index: 1, length: 64, appNo: 0, expected: '70c6e3e8ebee8dc4c0dbba66076819bb8c09672527c4277ca8729532ad711872218f826919f6b67218adde99018a6df9095ab2b58d803b5b93ec9802085a690e' },
    { name: "HD-Seed WIF entropy - m/83696968'/2'/0' (first 32 bytes)", index: 0, length: 32, appNo: 2, expected: '7040bb53104f27367f317558e78a994ada7296c6fde36a364e5baf206e502bb1' },
  ];

  describe('Official BIP-85 Test Vectors (bip-0085)', () => {
    test.each(specVectors)('$name', ({ index, length, appNo, expected }) => {
      const entropy = deriveBip85Entropy(
        root,
        index as AddressIndex,
        length as EntropyLength,
        appNo as AppNumber
      );
      expect(bytesToHex(entropy)).toBe(expected);
    });

    test("HD-Seed WIF - m/83696968'/2'/0' encodes to published WIF string", () => {
      const entropy = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        32 as EntropyLength,
        2 as AppNumber
      );
      // WIF = Base58Check(0x80 + 32-byte key + 0x01 compression flag)
      const wifPayload = new Uint8Array(34);
      wifPayload[0] = 0x80;
      wifPayload.set(entropy, 1);
      wifPayload[33] = 0x01;
      expect(bs58check.encode(wifPayload)).toBe(
        'Kzyv4uF39d4Jrw2W7UryTHwZr1zQVNk4dAFyqE6BuMrMh1Za7uhp'
      );
    });

    test("XPRV - m/83696968'/32'/0' encodes to published XPRV string", () => {
      const entropy = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        64 as EntropyLength,
        32 as AppNumber
      );
      const chainCode = entropy.slice(0, 32);
      const privateKey = entropy.slice(32, 64);
      // XPRV = Base58Check(version + depth + fingerprint + child + chainCode + 0x00 + key)
      const xprvPayload = new Uint8Array(78);
      xprvPayload.set([0x04, 0x88, 0xad, 0xe4], 0); // version
      // depth=0, fingerprint=0, child=0 are already zero-filled
      xprvPayload.set(chainCode, 13);
      // xprvPayload[45] = 0x00 already zero
      xprvPayload.set(privateKey, 46);
      expect(bs58check.encode(xprvPayload)).toBe(
        // prettier-ignore
        'xprv9s21ZrQH143K2srSbCSg4m4kLvPMzcWydgmKEnMmoZUurYuBuYG46c6P71UGXMzmriLzCCBvKQWBUv3vPB3m1SATMhp3uEjXHJ42jFg7myX'
      );
    });
  });

  describe('Entropy prefix consistency', () => {
    test('shorter entropy is a prefix of longer entropy from the same path', () => {
      const e16 = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        16 as EntropyLength,
        0 as AppNumber
      );
      const e32 = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        32 as EntropyLength,
        0 as AppNumber
      );
      const e64 = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        64 as EntropyLength,
        0 as AppNumber
      );

      expect(bytesToHex(e16)).toBe(bytesToHex(e64).slice(0, 32));
      expect(bytesToHex(e32)).toBe(bytesToHex(e64).slice(0, 64));
    });
  });

  describe('Invalid entropyLength', () => {
    test('rejects entropyLength = 0', () => {
      expect(() =>
        deriveBip85Entropy(
          root,
          0 as AddressIndex,
          0 as EntropyLength,
          0 as AppNumber
        )
      ).toThrow(/Entropy length/);
    });

    test('rejects fractional entropyLength', () => {
      expect(() =>
        deriveBip85Entropy(
          root,
          0 as AddressIndex,
          1.5 as EntropyLength,
          0 as AppNumber
        )
      ).toThrow(/Entropy length/);
    });

    test('rejects negative entropyLength', () => {
      expect(() =>
        deriveBip85Entropy(
          root,
          0 as AddressIndex,
          -1 as EntropyLength,
          0 as AppNumber
        )
      ).toThrow(/Entropy length/);
    });
  });

  describe('Boundary lengths', () => {
    test('entropyLength = 1 returns single byte matching first byte of full output', () => {
      const e1 = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        1 as EntropyLength,
        0 as AppNumber
      );
      const e64 = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        64 as EntropyLength,
        0 as AppNumber
      );
      expect(e1).toHaveLength(1);
      expect(bytesToHex(e1)).toBe(bytesToHex(e64).slice(0, 2));
    });
  });

  describe('Caller mutation stability', () => {
    test('mutating a returned result does not affect subsequent derivations', () => {
      let first: Uint8Array | undefined = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        32 as EntropyLength,
        0 as AppNumber
      );
      const firstHex = bytesToHex(first);
      first.fill(0);
      first = undefined;

      const second = deriveBip85Entropy(
        root,
        0 as AddressIndex,
        32 as EntropyLength,
        0 as AppNumber
      );
      expect(bytesToHex(second)).toBe(firstHex);
    });
  });

  // Pinned from current implementation - guards against accidental changes,
  // not independently sourced from the BIP-85 specification.
  // secp256k1 wrapper regression vectors are in cryptography.test.ts.
  describe('LibQC wrapper regression vectors (not spec validation)', () => {
    // prettier-ignore
    const bitcoinVectors = [
      { name: 'index 0', index: 0, expected: 'a22df5bf041dc0bc6a1e87da0566ed9dbe249ed80df615096f5f4a371c91d013' },
      { name: 'index 1', index: 1, expected: 'c39d8023a7b27d2ddccfd49f632b7e7df5f8e1e54e42b94b1e25b4d86ec8e613' },
    ];

    test.each(bitcoinVectors)(
      'deriveBitcoinPrivateKey - $name pinned output',
      ({ index, expected }) => {
        const key = deriveBitcoinPrivateKey(
          getTestSeed(),
          index as AddressIndex
        );
        expect(bytesToHex(key)).toBe(expected);
      }
    );
  });
});
