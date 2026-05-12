export type { SignedHttpConfig } from './config';
export { normalizeRegisterUrl } from './config';
export {
  HEADER_KEY_ID,
  HEADER_SIGNATURE,
  HEADER_SIGNED_EXPIRES,
  HEADER_SIGNED_NONCE,
  SUPPORTED_SIGNING_ALGORITHM
} from './constants';
export {
  buildCanonicalSigningMessage,
  sha256Hex,
  type CanonicalSigningMessageParams
} from './canonical';
export { encodeBase64Url, decodeBase64Url } from './base64url';
export { registerPublicKey } from './registerPublicKey';
export { createSignedHttpFetchFn } from './signedFetch';
export type {
  HttpSigningTransportRef,
  HttpSigningCredentials
} from './transportRef';
export { generateRegisterAndPersistHttpSigning } from './provision';
