import { sha256 } from '@noble/hashes/sha2.js';

export interface CanonicalSigningMessageParams {
  readonly keyId: string;
  readonly method: string;
  readonly pathnameWithSearch: string;
  readonly bodySha256Hex: string;
  readonly expUnixString: string;
  readonly nonce: string;
}

/**
 * Builds the UTF-8 message bytes signed for each proxied HTTP request.
 *
 * @remarks The format is versioned so the proxy can reject unknown schemes.
 * Keep this byte-for-byte aligned with the Cloudflare verification worker.
 *
 * @param params - Fields bound into the signing string
 * @returns UTF-8 encoded canonical message
 */
export function buildCanonicalSigningMessage(
  params: CanonicalSigningMessageParams
): Uint8Array {
  const lines = [
    'libqc-signed-http-v1',
    params.keyId,
    params.method,
    params.pathnameWithSearch,
    params.bodySha256Hex,
    params.expUnixString,
    params.nonce
  ];
  return new TextEncoder().encode(lines.join('\n'));
}

/**
 * Computes a lowercase hex SHA-256 digest of the given bytes.
 *
 * @param bodyBytes - Request body (empty array for no body)
 * @returns 64-character lowercase hex string
 */
export function sha256Hex(bodyBytes: Uint8Array): string {
  const digest = sha256(bodyBytes);
  let out = '';
  for (const byte of digest) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
