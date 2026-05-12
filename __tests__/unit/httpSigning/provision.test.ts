import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultEncryptionKeyWithMetadata } from '../../../src/cryptography';
import { generateRegisterAndPersistHttpSigning } from '../../../src/httpSigning/provision';
import { registerPublicKey } from '../../../src/httpSigning/registerPublicKey';
import type { LibQCStorage } from '../../../src/storage';
import { setStateSegment } from '../../../src/state';

vi.mock('@noble/post-quantum/ml-dsa.js', () => ({
  ml_dsa65: {
    keygen: vi.fn()
  }
}));

vi.mock('../../../src/httpSigning/registerPublicKey', () => ({
  registerPublicKey: vi.fn()
}));

vi.mock('../../../src/state', async () => {
  const actual = await vi.importActual('../../../src/state');
  return {
    ...actual,
    setStateSegment: vi.fn()
  };
});

describe('generateRegisterAndPersistHttpSigning', () => {
  const storage = {} as LibQCStorage;
  const encryptionKey = {} as VaultEncryptionKeyWithMetadata;
  const signedHttp = { registerUrl: 'https://register.example/' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zeroes generated secret/public keys when key registration fails', async () => {
    const secretKey = new Uint8Array([1, 2, 3, 4]);
    const publicKey = new Uint8Array([9, 8, 7, 6]);
    vi.mocked(ml_dsa65.keygen).mockReturnValue({ secretKey, publicKey } as any);
    vi.mocked(registerPublicKey).mockRejectedValue(
      new Error('network failure')
    );

    await expect(
      generateRegisterAndPersistHttpSigning(storage, encryptionKey, signedHttp)
    ).rejects.toThrow(/network failure/u);

    expect(secretKey).toEqual(new Uint8Array(secretKey.length));
    expect(publicKey).toEqual(new Uint8Array(publicKey.length));
    expect(setStateSegment).not.toHaveBeenCalled();
  });

  it('zeroes generated keys and persisted secret copy when persistence fails', async () => {
    const secretKey = new Uint8Array([5, 6, 7, 8]);
    const publicKey = new Uint8Array([2, 3, 4, 5]);
    vi.mocked(ml_dsa65.keygen).mockReturnValue({ secretKey, publicKey } as any);
    vi.mocked(registerPublicKey).mockResolvedValue('kid-123');
    vi.mocked(setStateSegment).mockRejectedValue(new Error('storage failure'));

    await expect(
      generateRegisterAndPersistHttpSigning(storage, encryptionKey, signedHttp)
    ).rejects.toThrow(/storage failure/u);

    expect(secretKey).toEqual(new Uint8Array(secretKey.length));
    expect(publicKey).toEqual(new Uint8Array(publicKey.length));
    expect(setStateSegment).toHaveBeenCalledTimes(1);
    const persistedArg = vi.mocked(setStateSegment).mock.calls[0]?.[3] as
      | { mlDsa65SecretKey: Uint8Array }
      | undefined;
    expect(persistedArg).toBeDefined();
    expect(persistedArg?.mlDsa65SecretKey).toEqual(
      new Uint8Array(secretKey.length)
    );
  });

  it('returns caller-owned persisted secret when persistence succeeds', async () => {
    const secretKey = new Uint8Array([10, 11, 12, 13]);
    const publicKey = new Uint8Array([20, 21, 22, 23]);
    vi.mocked(ml_dsa65.keygen).mockReturnValue({ secretKey, publicKey } as any);
    vi.mocked(registerPublicKey).mockResolvedValue('kid-success');
    vi.mocked(setStateSegment).mockResolvedValue(undefined);

    const persisted = await generateRegisterAndPersistHttpSigning(
      storage,
      encryptionKey,
      signedHttp
    );

    expect(persisted.keyId).toBe('kid-success');
    expect(persisted.mlDsa65SecretKey).toEqual(
      new Uint8Array([10, 11, 12, 13])
    );
    expect(secretKey).toEqual(new Uint8Array(secretKey.length));
    expect(publicKey).toEqual(new Uint8Array(publicKey.length));
  });
});
