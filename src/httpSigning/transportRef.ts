/**
 * Mutable credentials used by the signed HTTP {@link fetch} wrapper.
 * `LibQC` updates this object on unlock / lock / provisioning.
 */
export interface HttpSigningTransportRef {
  /** True when the app enabled signed HTTP (register URL was configured). */
  readonly signingEnabled: boolean;
  /** True after successful unlock or immediately after first `setPassword`. */
  vaultUnlocked: boolean;
  /** Present while the vault is unlocked and ML-DSA credentials are loaded. */
  credentials: HttpSigningCredentials | undefined;
}

export interface HttpSigningCredentials {
  readonly keyId: string;
  /** ML-DSA-65 secret key bytes (length per `ml_dsa65.lengths.secretKey`). */
  mlDsa65SecretKey: Uint8Array;
}
