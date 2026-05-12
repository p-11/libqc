import { fallback, http, Transport } from 'viem';
import { createSignedHttpFetchFn } from './httpSigning/signedFetch';
import type { HttpSigningTransportRef } from './httpSigning/transportRef';
import { RpcUrl } from './types';

export type MakeTransportOptions = {
  /**
   * When set, wraps `fetch` to attach ML-DSA-65 signing headers for each request.
   */
  readonly httpSigningRef?: HttpSigningTransportRef;
};

/**
 * Creates an HTTP transport with automatic fallback support
 *
 * P11TODO: remove auth headers once we use a public bundler
 *
 * @param urls - Array of RPC URLs to use (in priority order for fallback)
 * @param additionalHeaders - Optional HTTP headers to include in all requests
 * @param options - Optional signing and other transport options
 * @returns A viem Transport configured with the specified URLs and headers
 *
 * @example
 * ```typescript
 * // Single RPC URL
 * const transport = makeTransport(['https://eth.llamarpc.com']);
 *
 * // Multiple URLs with fallback
 * const transportWithFallback = makeTransport([
 *   'https://primary.rpc.com',
 *   'https://backup.rpc.com'
 * ]);
 *
 * // With authentication headers
 * const authenticatedTransport = makeTransport(
 *   ['https://api.example.com/rpc'],
 *   { 'Authorization': 'Bearer token123' }
 * );
 * ```
 */
export function makeTransport(
  urls: RpcUrl[],
  additionalHeaders?: HeadersInit,
  options?: MakeTransportOptions
): Transport {
  const fetchFn =
    options?.httpSigningRef !== undefined
      ? createSignedHttpFetchFn(
          globalThis.fetch.bind(globalThis),
          options.httpSigningRef
        )
      : undefined;

  return urls.length > 1
    ? fallback(urls.map(u => makeTransport([u], additionalHeaders, options)))
    : http(urls[0], {
        batch: true,
        ...(fetchFn ? { fetchFn } : {}),
        fetchOptions: {
          headers: additionalHeaders
        }
      });
}

/**
 * Creates an HTTP transport for ERC-4337 bundler endpoints.
 * Bundlers do not support JSON-RPC batch requests, so batching is disabled.
 */
export function makeBundlerTransport(
  urls: RpcUrl[],
  additionalHeaders?: HeadersInit,
  options?: MakeTransportOptions
): Transport {
  const fetchFn =
    options?.httpSigningRef !== undefined
      ? createSignedHttpFetchFn(
          globalThis.fetch.bind(globalThis),
          options.httpSigningRef
        )
      : undefined;

  return urls.length > 1
    ? fallback(
        urls.map(u => makeBundlerTransport([u], additionalHeaders, options))
      )
    : http(urls[0], {
        batch: false,
        ...(fetchFn ? { fetchFn } : {}),
        fetchOptions: {
          headers: additionalHeaders
        }
      });
}
