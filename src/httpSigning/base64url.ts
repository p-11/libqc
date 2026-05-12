import { base64urlnopad } from '@scure/base';

/**
 * Encodes bytes as unpadded base64url (RFC 4648 §5).
 *
 * @param bytes - Raw bytes to encode
 * @returns Base64url string without padding
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

/**
 * Decodes an unpadded base64url string to bytes.
 *
 * @param s - Base64url-encoded string
 * @returns Decoded bytes
 */
export function decodeBase64Url(s: string): Uint8Array {
  return base64urlnopad.decode(s);
}
