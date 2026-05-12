import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { LibQCStorage } from '../storage';
import type { VaultEncryptionKeyWithMetadata } from '../cryptography';
import {
  setStateSegment,
  type PersistedHttpSigningCredentials
} from '../state';
import { registerPublicKey } from './registerPublicKey';
import type { SignedHttpConfig } from './config';
import { normalizeRegisterUrl } from './config';

/**
 * Generates ML-DSA-65 keys, registers the public key, and persists the secret
 * in the encrypted `httpSigning` state segment.
 *
 * @param storage - Wallet storage
 * @param encryptionKey - Active vault encryption key
 * @param signedHttp - Signed HTTP configuration
 * @returns Credentials to cache in memory (caller-owned secret bytes)
 */
export async function generateRegisterAndPersistHttpSigning(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  signedHttp: SignedHttpConfig
): Promise<PersistedHttpSigningCredentials> {
  const keys = ml_dsa65.keygen();
  let persisted: PersistedHttpSigningCredentials | undefined;
  let succeeded = false;

  try {
    const registerBase = normalizeRegisterUrl(signedHttp.registerUrl);
    const keyId = await registerPublicKey(registerBase, keys.publicKey);

    persisted = {
      keyId,
      mlDsa65SecretKey: new Uint8Array(keys.secretKey)
    };

    await setStateSegment(storage, encryptionKey, 'httpSigning', persisted);
    succeeded = true;
    return persisted;
  } finally {
    keys.secretKey.fill(0);
    keys.publicKey.fill(0);
    if (!succeeded && persisted) {
      persisted.mlDsa65SecretKey.fill(0);
    }
  }
}
