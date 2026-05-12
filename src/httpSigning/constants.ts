/**
 * HTTP header names for ML-DSA–signed JSON-RPC requests.
 * Must match the verifying proxy worker.
 */
export const HEADER_KEY_ID = 'X-Key-Id';
export const HEADER_SIGNATURE = 'X-Signature';
export const HEADER_SIGNED_EXPIRES = 'X-Signed-Expires';
export const HEADER_SIGNED_NONCE = 'X-Signed-Nonce';

/**
 * Algorithm label sent to the key registration worker (`POST .../v1/keys`).
 * Must match the worker’s allowlist.
 */
export const SUPPORTED_SIGNING_ALGORITHM = 'ML-DSA-65';
