import { Chain } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import type { HttpSigningTransportRef } from './httpSigning/transportRef';
import { makeTransport } from './transports';
import { RpcUrl } from './types';

// P11TODO: remove auth headers once we use a public bundler

/**
 * Configuration for bundler connections
 */
export type BundlerConfig = {
  /** The blockchain chain the bundler operates on */
  chain: Chain;
  /** Array of bundler RPC URLs (supports fallback if multiple) */
  urls: RpcUrl[];
  /** HTTP headers for bundler requests (e.g., API keys) */
  headers: HeadersInit;
  /**
   * When set (same ref as chain RPC), bundler JSON-RPC uses ML-DSA-65 signing.
   */
  httpSigningRef?: HttpSigningTransportRef;
};

/**
 * Creates a bundler client for user operations
 *
 * The bundler client is used to submit user operations to the bundler service,
 * which then batches and submits them to the entry point contract. The client
 * is configured with a specific chain and RPC URLs, with optional fallback support.
 *
 * @param config - Configuration object containing chain, RPC URLs, and headers
 * @param config.chain - The viem Chain object the bundler operates on
 * @param config.urls - Array of bundler RPC URLs (supports fallback if multiple provided)
 * @param config.headers - HTTP headers to include in bundler requests (e.g., API keys)
 * @returns A viem bundler client configured for submitting user operations
 *
 * @example
 * ```typescript
 * const bundlerConfig: BundlerConfig = {
 *   chain: mainnet,
 *   urls: ['https://bundler.example.com/rpc'],
 *   headers: { 'X-API-Key': 'your-api-key' }
 * };
 * const bundler = getBundlerClient(bundlerConfig);
 * ```
 */
export function getBundlerClient(config: BundlerConfig) {
  const transport =
    config.httpSigningRef !== undefined
      ? makeTransport(config.urls, config.headers, {
          httpSigningRef: config.httpSigningRef
        })
      : makeTransport(config.urls, config.headers);

  return createBundlerClient({
    chain: config.chain,
    transport
  });
}
