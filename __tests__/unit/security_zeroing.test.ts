import { vi, describe, it, expect } from 'vitest';
import { AddressIndex, Mnemonic, Password, Seed } from '../../src/types';
import * as cryptography from '../../src/cryptography';
import { deriveBitcoinAddressFromSeed } from '../../src/addresses';
import { countSequenceInHeapStream } from '../integration/heap-scanner';
import {
  captureGeneratedMnemonic,
  createTestLibQC,
  MockStorage,
  createBareTestLibQC,
  createBitcoinChainSpec,
  createNoDiscoveryChainSpec,
  getTestPassword,
  getTestSeed
} from '../testUtils';
import { MnemonicWord, MnemonicIndex } from '../../src/types';
import type { MnemonicGuess } from '../../src/types';
import * as stateModule from '../../src/state';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateAddressV1 } from '../../src/zeroDev/accounts';
import * as zeroDevAccounts from '../../src/zeroDev/accounts';
import { getAuthorizedAccount } from '../../src/account/evm/authorized';
import { AddressVersion } from '../../src/config';
import { EsploraBitcoinApi } from '../../src/account/bitcoin/esplora';
import { base64 } from '@scure/base';

const canaryState = {
  trigger: null as string | null,
  buffer: null as Uint8Array | null
};

vi.mock('@zerodev/ecdsa-validator', async () => {
  const actual = await vi.importActual<
    typeof import('@zerodev/ecdsa-validator')
  >('@zerodev/ecdsa-validator');

  return {
    ...actual,
    signerToEcdsaValidator: vi.fn().mockResolvedValue({})
  };
});

vi.mock('@zerodev/sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@zerodev/sdk')>('@zerodev/sdk');

  return {
    ...actual,
    createKernelAccount: vi.fn().mockResolvedValue({
      address: '0x123'
    })
  };
});

vi.mock('@noble/hashes/utils.js', async () => {
  const actual = await vi.importActual<typeof import('@noble/hashes/utils.js')>(
    '@noble/hashes/utils.js'
  );
  return {
    ...actual,
    utf8ToBytes: vi.fn((str: string): Uint8Array => {
      if (canaryState.trigger === str && canaryState.buffer) {
        return canaryState.buffer;
      }
      return actual.utf8ToBytes(str);
    })
  };
});

describe('Security: Physical Memory Scan', () => {
  it('should physically zero out the private key buffer in deriveBitcoinAddressFromSeed', () => {
    const canaryPrivKey = new Uint8Array(32).fill(0xaa);
    vi.spyOn(cryptography, 'deriveBitcoinPrivateKey').mockReturnValue(
      canaryPrivKey as any
    );

    deriveBitcoinAddressFromSeed(getTestSeed(), 0 as AddressIndex);

    const allZeros = new Uint8Array(32).fill(0);
    expect(canaryPrivKey).toEqual(allZeros);
  });

  it('should keep caller-owned private key live in generateAddressV1 until caller zeroes it', async () => {
    const TARGET_BYTE = 0xfd;
    const canary = new Uint8Array(32).fill(TARGET_BYTE);
    const RAW_BYTE_SEQUENCE = Array.from(canary.subarray(0, 16));

    vi.spyOn(cryptography, 'deriveSecp256k1PrivateKey').mockReturnValue(
      canary as any
    );

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    const result = await generateAddressV1(getTestSeed(), 0 as AddressIndex);
    expect(result.secp256k1PrivateKey).toBe(canary);

    const isZeroed = Array.from(canary).every(byte => byte === 0);
    expect(isZeroed, 'Caller-owned private key should not be zeroed').toBe(
      false
    );

    const callerOwnedBufferPreserved = Array.from(canary).every(
      byte => byte === TARGET_BYTE
    );
    expect(
      callerOwnedBufferPreserved,
      'Caller-owned private key was unexpectedly modified'
    ).toBe(true);

    result.secp256k1PrivateKey.fill(0);

    const occurrences = await countSequenceInHeapStream(RAW_BYTE_SEQUENCE);
    expect(occurrences, 'Private key pattern still found in heap').toBe(0);

    vi.restoreAllMocks();
  });

  it('should transfer private key ownership to caller in generateAddressV1 (no extra copy)', async () => {
    const TARGET_BYTE = 0xf1;
    const canary = new Uint8Array(32).fill(TARGET_BYTE);

    vi.spyOn(cryptography, 'deriveSecp256k1PrivateKey').mockReturnValue(
      canary as any
    );

    const result = await generateAddressV1(getTestSeed(), 0 as AddressIndex);

    try {
      expect(result.secp256k1PrivateKey).toBe(canary);

      const originalNotZeroedBeforeCallerWipe = Array.from(canary).every(
        byte => byte === TARGET_BYTE
      );
      expect(
        originalNotZeroedBeforeCallerWipe,
        'Key should remain intact until caller wipes caller-owned buffer'
      ).toBe(true);
    } finally {
      result.secp256k1PrivateKey.fill(0);
      canary.fill(0);
      vi.restoreAllMocks();
    }
  });

  it('should physically zero out the private key buffer in getAuthorizedAccount', async () => {
    const canaryKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) canaryKey[i] = 0x20 + i; // unique pattern
    const RAW_BYTE_SEQUENCE = Array.from(canaryKey.subarray(0, 16));

    const persistedAddress = {
      chainType: 'evm',
      address: '0x123' as any,
      index: 0 as AddressIndex,
      secp256k1PrivateKey: canaryKey as any,
      secp256k1PublicKeyHash: '0x456' as any,
      version: AddressVersion.V1,
      accounts: []
    } as any;

    // Mock generateAuthorizedKernelAccount to avoid real SDK calls
    vi.spyOn(
      zeroDevAccounts,
      'generateAuthorizedKernelAccount'
    ).mockResolvedValue({
      account: { address: '0x123' },
      validator: {}
    } as any);

    const mockPublicClient = {
      chain: { id: 1 }
    } as any;

    const mockAccountId = {
      toString: () => 'eip155:1:0x123',
      address: '0x123'
    } as any;

    const mockStorage = {} as any;

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    await getAuthorizedAccount(
      mockPublicClient,
      mockAccountId,
      persistedAddress,
      {} as any,
      mockStorage
    );

    // The original buffer must be zeroed
    const isZeroed = Array.from(canaryKey).every(byte => byte === 0);
    expect(
      isZeroed,
      'Original private key buffer in persistedAddress was not zeroed'
    ).toBe(true);

    vi.restoreAllMocks();
  });

  it('should not find the key pattern in heap after successful derivation', async () => {
    const TARGET_BYTE = 0xfe;
    const RAW_BYTE_SEQUENCE = Array.from({ length: 8 }, () => TARGET_BYTE);

    const canary = new Uint8Array(32).fill(TARGET_BYTE);
    vi.spyOn(cryptography, 'deriveBitcoinPrivateKey').mockReturnValue(canary);

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    deriveBitcoinAddressFromSeed(getTestSeed(), 2 as AddressIndex);

    expect(new Uint8Array(canary)).toEqual(new Uint8Array(32).fill(0));

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);
  });

  it('should find the key pattern in heap when buffer zeroing is bypassed', async () => {
    const TARGET_BYTE = 0xfe;
    const RAW_BYTE_SEQUENCE = Array.from({ length: 8 }, () => TARGET_BYTE);

    // Mock deriveBitcoinPrivateKey to return our canary
    const canary = new Uint8Array(32).fill(TARGET_BYTE);
    vi.spyOn(cryptography, 'deriveBitcoinPrivateKey').mockReturnValue(canary);

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    canary.fill = function () {
      return this;
    };

    const registry: any[] = [];
    const OriginalUint8Array = Uint8Array;
    (globalThis as any).Uint8Array = new Proxy(OriginalUint8Array, {
      construct(target, args, newTarget) {
        const instance = Reflect.construct(target, args, newTarget) as object;
        registry.push(instance);
        return instance;
      }
    });

    try {
      deriveBitcoinAddressFromSeed(getTestSeed(), 3 as AddressIndex);

      expect(new OriginalUint8Array(canary.subarray(0, 8))).toEqual(
        new OriginalUint8Array(8).fill(TARGET_BYTE)
      );

      const patternMatch = registry.some(buf => {
        if (buf.length < 8) return false;
        for (let i = 0; i <= buf.length - 8; i++) {
          let match = true;
          for (let j = 0; j < 8; j++) {
            if (buf[i + j] !== TARGET_BYTE) {
              match = false;
              break;
            }
          }
          if (match) return true;
        }
        return false;
      });

      expect(
        patternMatch,
        'Leaked pattern was not found in any allocated buffer'
      ).toBe(true);
    } finally {
      globalThis.Uint8Array = OriginalUint8Array;
      vi.restoreAllMocks();
    }
  });
});

describe('Security: validateMnemonic memory zeroing', () => {
  it('should validate guesses successfully and leave the wallet usable afterwards', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    const mnemonic = await captureGeneratedMnemonic(vault);
    const words = new TextDecoder().decode(mnemonic).split(' ');

    const guesses: MnemonicGuess[] = [
      { word: MnemonicWord.from(words[0]), index: MnemonicIndex.from(0) },
      { word: MnemonicWord.from(words[1]), index: MnemonicIndex.from(1) },
      { word: MnemonicWord.from(words[2]), index: MnemonicIndex.from(2) },
      { word: MnemonicWord.from(words[3]), index: MnemonicIndex.from(3) }
    ];

    const result = await vault.validateMnemonic(guesses);
    expect(result).toBe(true);
    const exportedMnemonic = await vault.exportMnemonic(
      getTestPassword(),
      (mnemonic: Mnemonic) => Mnemonic.from(new Uint8Array(mnemonic))
    );
    expect(new TextDecoder().decode(exportedMnemonic).split(' ')).toHaveLength(
      24
    );
    mnemonic.fill(0);
    exportedMnemonic.fill(0);
  });

  it('should return false for wrong guesses and leave the wallet usable afterwards', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    await captureGeneratedMnemonic(vault);

    const wrongGuesses: MnemonicGuess[] = [
      { word: MnemonicWord.from('wrong'), index: MnemonicIndex.from(0) },
      { word: MnemonicWord.from('guess'), index: MnemonicIndex.from(1) },
      { word: MnemonicWord.from('here'), index: MnemonicIndex.from(2) },
      { word: MnemonicWord.from('today'), index: MnemonicIndex.from(3) }
    ];

    const result = await vault.validateMnemonic(wrongGuesses);
    expect(result).toBe(false);
    const exportedMnemonic = await vault.exportMnemonic(
      getTestPassword(),
      (mnemonic: Mnemonic) => Mnemonic.from(new Uint8Array(mnemonic))
    );
    expect(new TextDecoder().decode(exportedMnemonic).split(' ')).toHaveLength(
      24
    );
    exportedMnemonic.fill(0);
  });

  it('should leave the encrypted recovery phrase reconstructible after validateMnemonic', async () => {
    const storage = new MockStorage(new Map());
    const { vault } = await createTestLibQC(storage);
    const mnemonic = await captureGeneratedMnemonic(vault);
    const words = new TextDecoder().decode(mnemonic).split(' ');

    const guesses: MnemonicGuess[] = [
      { word: MnemonicWord.from(words[0]), index: MnemonicIndex.from(0) },
      { word: MnemonicWord.from(words[1]), index: MnemonicIndex.from(1) },
      { word: MnemonicWord.from(words[2]), index: MnemonicIndex.from(2) },
      { word: MnemonicWord.from(words[3]), index: MnemonicIndex.from(3) }
    ];

    // validateMnemonic should succeed and clean up internal state
    const result = await vault.validateMnemonic(guesses);
    expect(result).toBe(true);

    // after validation, the mnemonic should still be reconstructible from storage
    // (only the in-memory copy was zeroed, not the encrypted vault)
    const exportedMnemonic = await vault.exportMnemonic(
      getTestPassword(),
      (mnemonic: Mnemonic) => Mnemonic.from(new Uint8Array(mnemonic))
    );
    expect(new TextDecoder().decode(exportedMnemonic).split(' ')).toHaveLength(
      24
    );
    mnemonic.fill(0);
    exportedMnemonic.fill(0);
  });
});

describe('Security: decryptData memory zeroing', () => {
  it('should zero the buffer via finally block even if an unexpected error occurs in decryptData', async () => {
    const canary = new Uint8Array(64).fill(0xbb);
    const canaryBuffer = canary.buffer;
    const decryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockResolvedValue(canaryBuffer);
    const RealUint8Array = Uint8Array;

    let thrown = false;
    const uint8Spy = vi
      .spyOn(globalThis, 'Uint8Array')
      .mockImplementation(function (
        arg: any,
        offset?: number,
        length?: number
      ) {
        // Only throw the FIRST time we see this buffer, to allow the finally block to use it for zeroing
        if (arg === canaryBuffer && !thrown) {
          thrown = true;
          throw new Error('Simulated unexpected error');
        }
        return new RealUint8Array(arg, offset, length);
      } as any);

    try {
      const password = Password.from(new TextEncoder().encode('Password123!'));
      const salt = cryptography.generateScryptSalt();
      const key = await cryptography.deriveEncryptionKey(
        password,
        salt,
        cryptography.DEFAULT_SCRYPT_PARAMS
      );
      const vault = await cryptography.encryptData(
        key,
        new TextEncoder().encode('dummy')
      );

      await expect(cryptography.decryptData(key, vault)).rejects.toThrow(
        'Simulated unexpected error'
      );

      const isZeroed = Array.from(new RealUint8Array(canaryBuffer)).every(
        b => b === 0
      );
      expect(isZeroed, 'Buffer was NOT zeroed by the finally block!').toBe(
        true
      );
    } finally {
      decryptSpy.mockRestore();
      uint8Spy.mockRestore();
    }
  });

  it('should physically zero out the decrypted buffer after successful decryption', async () => {
    const canary = new Uint8Array(100).fill(0xaa);
    canary.fill(0, canary.length - 32);

    const decryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockResolvedValue(canary.buffer);
    const decodeSpy = vi
      .spyOn(TextDecoder.prototype, 'decode')
      .mockReturnValue('success');

    const password = Password.from(new TextEncoder().encode('Password123!'));
    const salt = cryptography.generateScryptSalt();
    const key = await cryptography.deriveEncryptionKey(
      password,
      salt,
      cryptography.DEFAULT_SCRYPT_PARAMS
    );
    const vault = await cryptography.encryptData(
      key,
      new TextEncoder().encode('dummy')
    );

    await cryptography.decryptData(key, vault);

    expect(canary.every(b => b === 0)).toBe(true);

    decryptSpy.mockRestore();
    decodeSpy.mockRestore();
  });

  it('should physically zero out the decrypted buffer even when decryption fails', async () => {
    // Fill buffer with 0xbb to intentionally trigger padding validation failure
    const canary = new Uint8Array(100).fill(0xbb);

    const decryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockResolvedValue(canary.buffer);

    const password = Password.from(new TextEncoder().encode('Password123!'));
    const salt = cryptography.generateScryptSalt();
    const key = await cryptography.deriveEncryptionKey(
      password,
      salt,
      cryptography.DEFAULT_SCRYPT_PARAMS
    );
    const vault = await cryptography.encryptData(
      key,
      new TextEncoder().encode('dummy')
    );

    await expect(cryptography.decryptData(key, vault)).rejects.toThrow();

    expect(canary.every(b => b === 0)).toBe(true);

    decryptSpy.mockRestore();
  });

  it('should not find the decrypted data pattern in heap after decryptData', async () => {
    const TARGET_BYTE = 0xf1;
    const canary = new Uint8Array(64).fill(TARGET_BYTE);
    canary.fill(0, canary.length - 32); // Ensure padding is valid to avoid IncorrectPasswordError
    const RAW_BYTE_SEQUENCE = Array.from(canary.subarray(0, 16));

    const decryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockResolvedValue(canary.buffer);
    const canaryResult = new Uint8Array(canary.buffer);

    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    const password = Password.from(new TextEncoder().encode('Password123!'));
    const salt = cryptography.generateScryptSalt();
    const key = await cryptography.deriveEncryptionKey(
      password,
      salt,
      cryptography.DEFAULT_SCRYPT_PARAMS
    );
    const vault = await cryptography.encryptData(
      key,
      new TextEncoder().encode('dummy')
    );

    const result = await cryptography.decryptData(key, vault);

    const isZeroed = Array.from(canaryResult).every(b => b === 0);
    expect(isZeroed, 'Canary result buffer in decryptData was not zeroed').toBe(
      true
    );
    result.fill(0);

    const occurrences = await countSequenceInHeapStream(RAW_BYTE_SEQUENCE);
    expect(
      occurrences,
      'Decrypted data pattern still found in heap after decryptData'
    ).toBe(0);

    decryptSpy.mockRestore();
  });

  it('should physically zero out the temporary plaintext buffer in encryptData', async () => {
    // We use a specific pattern for the canary
    const TARGET_BYTE = 0xcc;
    const canary = new Uint8Array(32).fill(TARGET_BYTE);
    const RAW_BYTE_SEQUENCE = Array.from(canary.subarray(0, 16));

    // Setup the mock trigger for utf8ToBytes
    canaryState.trigger = 'dummy-secret';
    canaryState.buffer = canary;

    // Capture the padded buffer by spying on crypto.subtle.encrypt
    let capturedPadded: Uint8Array | null = null;
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementation(async (_alg, _key, data) => {
        // Create a view on the SAME ArrayBuffer to observe its zeroing
        if (data instanceof Uint8Array) {
          capturedPadded = data;
        } else if (data instanceof ArrayBuffer) {
          capturedPadded = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
          capturedPadded = new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength
          );
        }
        // Return a small, valid ArrayBuffer so the rest of the function doesn't crash
        return new ArrayBuffer(100);
      });

    // Initial check (must be 0)
    expect(await countSequenceInHeapStream(RAW_BYTE_SEQUENCE)).toBe(0);

    const password = Password.from(new TextEncoder().encode('Password123!'));
    const salt = cryptography.generateScryptSalt();
    const key = await cryptography.deriveEncryptionKey(password, salt);

    // Trigger the operation with our canary
    await cryptography.encryptData(key, canary);

    // 1. Check if the local reference (plaintextBytes) was zeroed
    const isPlaintextZeroed = Array.from(canary).every(b => b === 0);
    expect(
      isPlaintextZeroed,
      'Temporary plaintext buffer in encryptData was not zeroed'
    ).toBe(true);

    // 2. Check the captured padded buffer
    // Note: In some environments (like Node.js), WebCrypto passes a copy of the buffer.
    // If it's a copy, it won't be zeroed even if the original in cryptography.ts was.
    // However, if it IS a reference, it MUST be zeroed.
    if (capturedPadded) {
      const isPaddedZeroed = Array.from(capturedPadded).every(b => b === 0);
      if (!isPaddedZeroed) {
        // We log it, but we let the Heap Scanner be the judge if this was just a copy
        // Or we can fail here if we suspect it should be a reference.
        // For security hardening testing, if ANY buffer remains, it's a fail.
        expect(
          isPaddedZeroed,
          'Padded/Encoded buffer was not zeroed! (Found in captured reference)'
        ).toBe(true);
      }
    }

    // 3. Check if any copies remain on the heap
    // This is the absolute source of truth. If cryptography.ts failed to zero its internal 'padded' buffer,
    // the Heap Scanner will find the RAW_BYTE_SEQUENCE.
    const occurrences = await countSequenceInHeapStream(RAW_BYTE_SEQUENCE);
    expect(
      occurrences,
      'Sensitive data pattern still found in heap! Memory hardening failed (potential leak in padded/encoded buffer).'
    ).toBe(0);

    // Cleanup
    canaryState.trigger = null;
    canaryState.buffer = null;
    encryptSpy.mockRestore();
  });

  it('should zero temporary ciphertext bytes in encryptData after base64 encoding', async () => {
    const ciphertextCanary = new Uint8Array(73).fill(0xee);
    let capturedCipherBytes: Uint8Array | null = null;

    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockResolvedValue(ciphertextCanary.buffer);
    const originalEncode = base64.encode;
    const encodeSpy = vi.spyOn(base64, 'encode').mockImplementation(input => {
      if (input.length === ciphertextCanary.length && input[0] === 0xee) {
        capturedCipherBytes = input;
      }
      return originalEncode(input);
    });

    try {
      const password = Password.from(new TextEncoder().encode('Password123!'));
      const salt = cryptography.generateScryptSalt();
      const key = await cryptography.deriveEncryptionKey(
        password,
        salt,
        cryptography.DEFAULT_SCRYPT_PARAMS
      );

      await cryptography.encryptData(key, new Uint8Array([1, 2, 3, 4]));

      expect(capturedCipherBytes).not.toBeNull();
      expect(capturedCipherBytes!.every(b => b === 0)).toBe(true);
      expect(ciphertextCanary.every(b => b === 0)).toBe(true);
    } finally {
      encryptSpy.mockRestore();
      encodeSpy.mockRestore();
    }
  });

  it('should zero encryptedData and IV buffers in decryptData when decryption fails', async () => {
    const ciphertextCanary = new Uint8Array(64).fill(0xa5);
    const ivCanary = new Uint8Array(12).fill(0x5a);

    const originalDecode = base64.decode;
    const decodeSpy = vi.spyOn(base64, 'decode').mockImplementation(input => {
      if (input === 'mock-ciphertext') {
        return ciphertextCanary;
      }
      if (input === 'mock-iv') {
        return ivCanary;
      }
      return originalDecode(input);
    });
    const decryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'decrypt')
      .mockRejectedValue(new Error('decrypt failure'));

    try {
      const password = Password.from(new TextEncoder().encode('Password123!'));
      const salt = cryptography.generateScryptSalt();
      const key = await cryptography.deriveEncryptionKey(
        password,
        salt,
        cryptography.DEFAULT_SCRYPT_PARAMS
      );
      const templateVault = await cryptography.encryptData(
        key,
        new TextEncoder().encode('template')
      );
      const vault = {
        ...templateVault,
        data: 'mock-ciphertext' as any,
        iv: 'mock-iv' as any
      };

      await expect(cryptography.decryptData(key, vault)).rejects.toThrow();

      expect(ciphertextCanary.every(b => b === 0)).toBe(true);
      expect(ivCanary.every(b => b === 0)).toBe(true);
    } finally {
      decodeSpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });
});

describe('Security: LibQC State Zeroing', () => {
  let storage: MockStorage;
  let vault: any; // Using any as we use createBareTestLibQC which returns LibQC
  let password: Password;

  beforeEach(async () => {
    storage = new MockStorage(new Map());
    const chains = [createBitcoinChainSpec()];
    vault = createBareTestLibQC(storage, undefined, chains);
    password = getTestPassword();
    await vault.setPassword(password);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should zero out state after unlock', async () => {
    const zeroLibQCStateSpy = vi.spyOn(stateModule, 'zeroLibQCState');

    await vault.unlock(getTestPassword());

    expect(zeroLibQCStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: expect.any(Array) })
    );
  });

  it('init flow zeroes internal entropy and seed buffers after generateMnemonic', async () => {
    await vault.unlock(password);
    const originalSetStateSegment = stateModule.setStateSegment;
    const setStateSegmentSpy = vi.spyOn(stateModule, 'setStateSegment');
    let capturedEntropy: Uint8Array | null = null;
    let capturedSeed: Uint8Array | null = null;

    setStateSegmentSpy.mockImplementation(async (s, k, segment, value) => {
      if (segment === 'entropy' && value) {
        capturedEntropy = value as Uint8Array;
      }
      if (segment === 'seed' && value) {
        capturedSeed = value as Uint8Array;
      }
      return originalSetStateSegment(s, k, segment, value);
    });

    const mnemonic = await captureGeneratedMnemonic(vault);

    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every((b: number) => b === 0)).toBe(true);
    expect(capturedSeed).not.toBeNull();
    expect(capturedSeed!.every((b: number) => b === 0)).toBe(true);
    expect(mnemonic).toBeDefined();
    expect(mnemonic.every((b: number) => b === 0)).toBe(false);
    mnemonic.fill(0);
  });

  it('generateMnemonic zeroes the temporary seed bytes returned by mnemonicToSeedSync', async () => {
    await vault.unlock(password);
    const originalSeedFrom = Seed.from;
    const rawSeedInputs: Uint8Array[] = [];

    vi.spyOn(Seed, 'from').mockImplementation(
      (value: Uint8Array | Record<number, number>) => {
        if (value instanceof Uint8Array) {
          rawSeedInputs.push(value);
        }
        return originalSeedFrom(value);
      }
    );

    const mnemonic = await captureGeneratedMnemonic(vault);

    expect(rawSeedInputs).toHaveLength(1);
    expect(rawSeedInputs[0]?.every(byte => byte === 0)).toBe(true);
    mnemonic.fill(0);
  });

  it('generateMnemonic zeroes temporary seed bytes even when state persistence fails', async () => {
    await vault.unlock(password);
    const originalSeedFrom = Seed.from;
    const rawSeedInputs: Uint8Array[] = [];
    let capturedEntropy: Uint8Array | null = null;
    let capturedSeed: Uint8Array | null = null;

    vi.spyOn(Seed, 'from').mockImplementation(
      (value: Uint8Array | Record<number, number>) => {
        if (value instanceof Uint8Array) {
          rawSeedInputs.push(value);
        }
        return originalSeedFrom(value);
      }
    );

    vi.spyOn(stateModule, 'setStateSegment').mockImplementation(
      async (_storage, _key, segment, value) => {
        if (segment === 'entropy' && value) {
          capturedEntropy = value as Uint8Array;
        }
        if (segment === 'seed' && value) {
          capturedSeed = value as Uint8Array;
        }
        throw new Error(`failed to persist ${segment}`);
      }
    );

    await expect(vault.generateMnemonic(() => true)).rejects.toThrow(
      /failed to persist/
    );

    expect(rawSeedInputs).toHaveLength(1);
    expect(rawSeedInputs[0]?.every(byte => byte === 0)).toBe(true);
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every(byte => byte === 0)).toBe(true);
    expect(capturedSeed).not.toBeNull();
    expect(capturedSeed!.every(byte => byte === 0)).toBe(true);
  });

  it('init flow zeroes scoped mnemonic callback buffer after use', async () => {
    await vault.unlock(password);
    let callbackMnemonic: Uint8Array | null = null;

    const callbackResult = await vault.generateMnemonic(
      (mnemonic: Uint8Array) => {
        callbackMnemonic = mnemonic;
        return new TextDecoder().decode(mnemonic).split(' ').length;
      }
    );

    if (callbackResult instanceof Uint8Array) {
      callbackResult.fill(0);
    }

    expect(callbackResult).toBe(24);
    expect(callbackMnemonic).not.toBeNull();
    expect(callbackMnemonic!.every((b: number) => b === 0)).toBe(true);
  });

  it('show mnemonic flow zeroes internal entropy and returns caller-owned mnemonic', async () => {
    await vault.unlock(password);
    await captureGeneratedMnemonic(vault);
    const { getStateSegment: originalGetStateSegment } =
      await vi.importActual<typeof import('../../src/state')>(
        '../../src/state'
      );
    const getStateSegmentSpy = vi.spyOn(stateModule, 'getStateSegment');
    let capturedEntropy: Uint8Array | null = null;

    getStateSegmentSpy.mockImplementation(async (s, k, segment) => {
      const value = await originalGetStateSegment(s, k, segment);
      if (segment === 'entropy' && value) {
        capturedEntropy = value as Uint8Array;
      }
      return value;
    });

    const exportedMnemonic = await vault.exportMnemonic(
      getTestPassword(),
      (mnemonic: Mnemonic) => Mnemonic.from(new Uint8Array(mnemonic))
    );
    expect(new TextDecoder().decode(exportedMnemonic).split(' ')).toHaveLength(
      24
    );
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every((b: number) => b === 0)).toBe(true);
    expect(exportedMnemonic.every((b: number) => b === 0)).toBe(false);
    exportedMnemonic.fill(0);
  });

  it('show mnemonic flow zeroes scoped mnemonic callback buffer after use', async () => {
    await vault.unlock(password);
    await captureGeneratedMnemonic(vault);
    let callbackMnemonic: Uint8Array | null = null;

    const callbackResult = await vault.exportMnemonic(
      getTestPassword(),
      (mnemonic: Mnemonic) => {
        callbackMnemonic = mnemonic;
        return new TextDecoder().decode(mnemonic).split(' ').length;
      }
    );

    expect(callbackResult).toBe(24);
    expect(callbackMnemonic).not.toBeNull();
    expect(callbackMnemonic!.every((b: number) => b === 0)).toBe(true);
  });

  it('show mnemonic flow zeroes scoped mnemonic callback buffer and entropy when callback throws', async () => {
    await vault.unlock(password);
    await captureGeneratedMnemonic(vault);
    const { getStateSegment: originalGetStateSegment } =
      await vi.importActual<typeof import('../../src/state')>(
        '../../src/state'
      );
    const getStateSegmentSpy = vi.spyOn(stateModule, 'getStateSegment');
    let callbackMnemonic: Uint8Array | null = null;
    let capturedEntropy: Uint8Array | null = null;

    getStateSegmentSpy.mockImplementation(async (s, k, segment) => {
      const value = await originalGetStateSegment(s, k, segment);
      if (segment === 'entropy' && value) {
        capturedEntropy = value as Uint8Array;
      }
      return value;
    });

    await expect(
      vault.exportMnemonic(getTestPassword(), (mnemonic: Mnemonic) => {
        callbackMnemonic = mnemonic;
        throw new Error('export callback failed');
      })
    ).rejects.toThrow('export callback failed');

    expect(callbackMnemonic).not.toBeNull();
    expect(callbackMnemonic!.every((b: number) => b === 0)).toBe(true);
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every((b: number) => b === 0)).toBe(true);
  });

  it('should zero out state after listAccounts', async () => {
    await vault.unlock(password);
    const { getStateSegment: originalGetStateSegment } =
      await vi.importActual<typeof import('../../src/state')>(
        '../../src/state'
      );
    const getStateSegmentSpy = vi.spyOn(stateModule, 'getStateSegment');
    let capturedAddresses: stateModule.LibQCState['addresses'] | null = null;

    getStateSegmentSpy.mockImplementation(async (s, k, segment) => {
      const value = await originalGetStateSegment(s, k, segment);
      if (segment === 'addresses') {
        capturedAddresses = value as stateModule.LibQCState['addresses'];
      }
      return value;
    });

    await vault.listAccounts();

    expect(capturedAddresses).not.toBeNull();
    expect(
      capturedAddresses!.every(addr =>
        addr.secp256k1PrivateKey.every((b: number) => b === 0)
      )
    ).toBe(true);
  });

  it('should only read the assets segment after listAssets', async () => {
    await vault.unlock(password);
    const getStateSegmentSpy = vi.spyOn(stateModule, 'getStateSegment');

    await vault.listAssets();

    expect(getStateSegmentSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'assets'
    );
    expect(
      getStateSegmentSpy.mock.calls.every(
        ([, , segment]) => segment === 'assets'
      )
    ).toBe(true);
  });

  it('should only read the assets segment after isAssetTracked', async () => {
    await vault.unlock(password);
    const getStateSegmentSpy = vi.spyOn(stateModule, 'getStateSegment');

    const asset = { id: 'p11:test' } as any;
    await vault.isAssetTracked(asset);

    expect(getStateSegmentSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'assets'
    );
    expect(
      getStateSegmentSpy.mock.calls.every(
        ([, , segment]) => segment === 'assets'
      )
    ).toBe(true);
  });

  it('should zero out state after setPassword', async () => {
    const zeroLibQCStateSpy = vi.spyOn(stateModule, 'zeroLibQCState');

    const newPassword = Password.from(
      new TextEncoder().encode('NewSecurePass123!')
    );
    await vault.setPassword(newPassword, password);

    expect(zeroLibQCStateSpy).toHaveBeenCalled();
  });

  it('recovery flow zeroes caller mnemonic, validated mnemonic, entropy and seed on successful import', async () => {
    const localStorage = new MockStorage(new Map());
    const localVault = createBareTestLibQC(localStorage, undefined, [
      createNoDiscoveryChainSpec()
    ]);
    const originalValidateMnemonic = cryptography.validateMnemonic;
    const originalSetStateSegment = stateModule.setStateSegment;
    const originalSeedFrom = Seed.from;
    let capturedValidatedMnemonic: Mnemonic | undefined;
    let capturedEntropy: Uint8Array | null = null;
    let capturedSeed: Uint8Array | null = null;
    const rawSeedInputs: Uint8Array[] = [];

    vi.spyOn(cryptography, 'validateMnemonic').mockImplementation(mnemonic => {
      const validated = originalValidateMnemonic(mnemonic);
      capturedValidatedMnemonic = validated;
      return validated;
    });

    vi.spyOn(Seed, 'from').mockImplementation(
      (value: Uint8Array | Record<number, number>) => {
        if (value instanceof Uint8Array) {
          rawSeedInputs.push(value);
        }
        return originalSeedFrom(value);
      }
    );

    vi.spyOn(stateModule, 'setStateSegment').mockImplementation(
      async (storageArg, encryptionKeyArg, segment, value) => {
        if (segment === 'entropy' && value) {
          capturedEntropy = value as Uint8Array;
        }
        if (segment === 'seed' && value) {
          capturedSeed = value as Uint8Array;
        }

        return originalSetStateSegment(
          storageArg,
          encryptionKeyArg,
          segment,
          value
        );
      }
    );

    const callerMnemonic = Mnemonic.from(
      new TextEncoder().encode(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
      )
    );

    await localVault.importWallet(callerMnemonic, getTestPassword());

    expect(capturedValidatedMnemonic).toBeDefined();
    expect(capturedValidatedMnemonic).not.toBe(callerMnemonic);
    expect(capturedValidatedMnemonic!.every(byte => byte === 0)).toBe(true);
    expect(rawSeedInputs).toHaveLength(1);
    expect(rawSeedInputs[0]?.every(byte => byte === 0)).toBe(true);
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every(byte => byte === 0)).toBe(true);
    expect(capturedSeed).not.toBeNull();
    expect(capturedSeed!.every(byte => byte === 0)).toBe(true);
    expect(callerMnemonic.every(byte => byte === 0)).toBe(true);
  });

  it('recovery flow zeroes temporary seed bytes, entropy and seed when persistence fails', async () => {
    const localStorage = new MockStorage(new Map());
    const localVault = createBareTestLibQC(localStorage, undefined, [
      createNoDiscoveryChainSpec()
    ]);
    const originalValidateMnemonic = cryptography.validateMnemonic;
    const originalSeedFrom = Seed.from;
    let capturedValidatedMnemonic: Mnemonic | undefined;
    let capturedEntropy: Uint8Array | null = null;
    let capturedSeed: Uint8Array | null = null;
    const rawSeedInputs: Uint8Array[] = [];

    vi.spyOn(cryptography, 'validateMnemonic').mockImplementation(mnemonic => {
      const validated = originalValidateMnemonic(mnemonic);
      capturedValidatedMnemonic = validated;
      return validated;
    });

    vi.spyOn(Seed, 'from').mockImplementation(
      (value: Uint8Array | Record<number, number>) => {
        if (value instanceof Uint8Array) {
          rawSeedInputs.push(value);
        }
        return originalSeedFrom(value);
      }
    );

    vi.spyOn(stateModule, 'setStateSegment').mockImplementation(
      async (_storageArg, _encryptionKeyArg, segment, value) => {
        if (segment === 'entropy' && value) {
          capturedEntropy = value as Uint8Array;
        }
        if (segment === 'seed' && value) {
          capturedSeed = value as Uint8Array;
        }

        throw new Error(`failed to persist ${segment}`);
      }
    );

    const callerMnemonic = Mnemonic.from(
      new TextEncoder().encode(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
      )
    );

    await expect(
      localVault.importWallet(callerMnemonic, getTestPassword())
    ).rejects.toThrow(/failed to persist/);

    expect(capturedValidatedMnemonic).toBeDefined();
    expect(capturedValidatedMnemonic).not.toBe(callerMnemonic);
    expect(capturedValidatedMnemonic!.every(byte => byte === 0)).toBe(true);
    expect(rawSeedInputs).toHaveLength(1);
    expect(rawSeedInputs[0]?.every(byte => byte === 0)).toBe(true);
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every(byte => byte === 0)).toBe(true);
    expect(capturedSeed).not.toBeNull();
    expect(capturedSeed!.every(byte => byte === 0)).toBe(true);
    expect(callerMnemonic.every(byte => byte === 0)).toBe(true);
  });

  it('recovery flow zeroes validated mnemonic, entropy and seed even when discovery fails', async () => {
    const localStorage = new MockStorage(new Map());
    const localVault = createBareTestLibQC(localStorage, undefined, [
      createBitcoinChainSpec()
    ]);
    const originalValidateMnemonic = cryptography.validateMnemonic;
    const originalSetStateSegment = stateModule.setStateSegment;
    let capturedInternalMnemonic: Mnemonic | undefined;
    let capturedEntropy: Uint8Array | null = null;
    let capturedSeed: Uint8Array | null = null;

    vi.spyOn(cryptography, 'validateMnemonic').mockImplementation(mnemonic => {
      const validated = originalValidateMnemonic(mnemonic);
      capturedInternalMnemonic = validated;
      return validated;
    });

    vi.spyOn(stateModule, 'setStateSegment').mockImplementation(
      async (storageArg, encryptionKeyArg, segment, value) => {
        if (segment === 'entropy' && value) {
          capturedEntropy = value as Uint8Array;
        }
        if (segment === 'seed' && value) {
          capturedSeed = value as Uint8Array;
        }

        return originalSetStateSegment(
          storageArg,
          encryptionKeyArg,
          segment,
          value
        );
      }
    );

    vi.spyOn(localVault, 'createAccount').mockRejectedValue(
      new Error('discovery failed')
    );

    const callerMnemonic = Mnemonic.from(
      new TextEncoder().encode(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
      )
    );

    await expect(
      localVault.importWallet(callerMnemonic, getTestPassword())
    ).rejects.toThrow('discovery failed');

    expect(capturedInternalMnemonic).toBeDefined();
    expect(capturedInternalMnemonic).not.toBe(callerMnemonic);
    expect(capturedInternalMnemonic!.every(byte => byte === 0)).toBe(true);
    expect(capturedEntropy).not.toBeNull();
    expect(capturedEntropy!.every(byte => byte === 0)).toBe(true);
    expect(capturedSeed).not.toBeNull();
    expect(capturedSeed!.every(byte => byte === 0)).toBe(true);
    expect(callerMnemonic.every(byte => byte === 0)).toBe(true);
  });

  it('should not find sensitive patterns in heap after full LibQC lifecycle', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST') {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          );
        }
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      });

    const localStorage = new MockStorage(new Map());
    const chains = [createBitcoinChainSpec()];
    const localVault = createBareTestLibQC(localStorage, undefined, chains);
    vi.spyOn(EsploraBitcoinApi.prototype, 'getActivities').mockResolvedValue(
      []
    );

    const rawMnemonicStr = generateMnemonic(wordlist, 256);
    const rawMnemonic = Mnemonic.from(new TextEncoder().encode(rawMnemonicStr));
    const pattern = Array.from(rawMnemonic.subarray(0, 16));

    await localVault.importWallet(rawMnemonic, password);
    await localVault.unlock(password);

    const accounts = await localVault.listAccounts();
    const account = await localVault.getAccount(accounts[0].id);
    await account.listAssets();

    rawMnemonic.fill(0);

    const occurrences = await countSequenceInHeapStream(pattern);
    expect(occurrences).toBeLessThan(2);

    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  }, 60000);

  it('should physically zero out secp256r1PublicKey in zeroLibQCState', () => {
    const canary = new Uint8Array(33).fill(0x77);
    const state = {
      addresses: [
        {
          secp256k1PrivateKey: new Uint8Array(32),
          chainData: [
            {
              secp256r1PublicKey: canary
            }
          ]
        }
      ]
    };

    stateModule.zeroLibQCState(state);

    expect(canary.every(b => b === 0)).toBe(true);
  });
});
