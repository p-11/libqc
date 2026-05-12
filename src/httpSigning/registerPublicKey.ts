import { SUPPORTED_SIGNING_ALGORITHM } from './constants';
import { encodeBase64Url } from './base64url';

/**
 * Registers an ML-DSA-65 public key with the registration worker.
 *
 * @param registerBaseUrl - Worker base URL (no trailing slash)
 * @param publicKey - Raw ML-DSA-65 public key bytes
 * @returns Server-assigned `key_id`
 * @throws Error if the HTTP request fails or the response is invalid
 */
export async function registerPublicKey(
  registerBaseUrl: string,
  publicKey: Uint8Array
): Promise<string> {
  const url = `${registerBaseUrl}/v1/keys`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      algorithm: SUPPORTED_SIGNING_ALGORITHM,
      publicKey: encodeBase64Url(publicKey)
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ML-DSA key registration failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { key_id?: string };
  if (typeof json.key_id !== 'string') {
    throw new Error(`Register response missing key_id: ${text}`);
  }
  return json.key_id;
}
