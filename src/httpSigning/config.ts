/**
 * Optional LibQC configuration for ML-DSA–signed JSON-RPC over HTTP.
 */
export interface SignedHttpConfig {
  /**
   * Base URL of the key registration worker (no trailing slash), e.g.
   * `https://register.example.com`.
   */
  readonly registerUrl: string;
}

/**
 * Normalizes a register worker base URL (strips trailing slashes).
 *
 * @param registerUrl - Raw URL from configuration
 * @returns Sanitized base URL
 */
export function normalizeRegisterUrl(registerUrl: string): string {
  return registerUrl.replace(/\/+$/u, '');
}
