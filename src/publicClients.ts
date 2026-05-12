import { ChainId } from 'caip';
import { isEvmChain } from './chain';
import {
  Chain,
  // P11TODO: add alias for PublicClient for better readability, e.g. ReadOnlyChainClient
  PublicClient,
  createPublicClient,
  defineChain
} from 'viem';
import type { HttpSigningTransportRef } from './httpSigning/transportRef';
import { makeTransport } from './transports';
import {
  AssetName,
  ChainName,
  ChainNetwork,
  Decimals,
  IconUrl,
  RpcUrl,
  Symbol,
  Testnet
} from './types';

/**
 * Specification for configuring a blockchain chain
 *
 * Contains all information needed to connect to and identify a blockchain,
 * including RPC endpoints, native currency details, and chain metadata.
 */
export type ChainSpecification = {
  /** Numeric chain ID (e.g., 1 for Ethereum mainnet) */
  id: number;
  /** CAIP-2 chain identifier (e.g., eip155:1) */
  chainId: ChainId;
  /** Human-readable chain name */
  name: ChainName;
  /** Network identifier (e.g., 'mainnet', 'sepolia') */
  network: ChainNetwork;
  /** URL to chain icon/logo */
  iconUrl: IconUrl;
  /** Native currency configuration */
  nativeCurrency: {
    decimals: Decimals;
    name: AssetName;
    symbol: Symbol;
  };
  /** Whether this is a testnet */
  testnet: Testnet;
  /** RPC URLs in priority order for fallback */
  rpcUrls: RpcUrl[];
};

/**
 * Registry of read-only blockchain clients
 *
 * Provides convenient access to PublicClients for multiple chains
 * with lookup by chain ID or network name.
 */
export type EvmReadOnlyChainClients = {
  /** Get a client by CAIP-2 chain ID */
  getByChainId: (_chainId: ChainId) => PublicClient;
  /** Get a client by network name */
  getByChainNetwork: (_network: ChainNetwork) => PublicClient;
  /** Get all clients as a map */
  all: () => ReadonlyMap<string, PublicClient>;
};

/**
 * Converts a ChainSpecification to a viem Chain object
 *
 * This function transforms our custom ChainSpecification format into the
 * Chain format expected by viem.
 *
 * @param d - The chain specification to convert
 * @returns A viem Chain object with RPC URLs and native currency configured
 *
 * @example
 * ```typescript
 * const spec: ChainSpecification = {
 *   id: 1,
 *   chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
 *   name: 'Ethereum',
 *   network: 'mainnet',
 *   // ... other fields
 * };
 * const chain = toChain(spec);
 * ```
 */
export function toChain(d: ChainSpecification): Chain {
  return defineChain({
    id: d.id,
    name: d.name,
    network: d.network,
    nativeCurrency: d.nativeCurrency,
    rpcUrls: {
      default: { http: d.rpcUrls },
      public: { http: d.rpcUrls }
    },
    testnet: d.testnet,
    custom: {
      caipChainId: d.chainId
    }
  });
}

/**
 * Creates a registry of read-only public clients for multiple chains
 *
 * This function initializes one PublicClient per chain specification and
 * provides convenient lookup methods by chain ID or network name.
 *
 * The registry validates that:
 * - At least one chain is provided
 * - No duplicate chain IDs exist
 *
 * @param chains - Array of chain specifications to create clients for
 * @returns A registry object with methods to retrieve clients by chain ID or network name
 *
 * @throws {Error} If no chains are provided
 * @throws {Error} If duplicate chain IDs are detected
 *
 * @example
 * ```typescript
 * const chains: ChainSpecification[] = [
 *   {
 *     id: 1,
 *     chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
 *     name: 'Ethereum',
 *     network: 'mainnet',
 *     rpcUrls: ['https://eth.llamarpc.com'],
 *     // ... other fields
 *   }
 * ];
 * const registry = createReadOnlyChainClients(chains);
 * const ethClient = registry.getByChainNetwork('mainnet');
 * ```
 */
/**
 * Creates a registry of read-only public clients for EVM chains only
 *
 * Bitcoin chains (bip122) are skipped—use ChainSpecification and this.chains
 * in LibQC for Bitcoin config (e.g. Esplora API URLs).
 */
export function createEvmReadOnlyChainClients(
  chains: ChainSpecification[],
  httpSigningRef?: HttpSigningTransportRef
): EvmReadOnlyChainClients {
  if (chains.length === 0) throw new Error('No chains provided');
  const evmChains = chains.filter(c => isEvmChain(c.chainId));

  const byId = new Map<string, PublicClient>();
  const nameToId = new Map<ChainNetwork, string>();

  for (const c of evmChains) {
    if (byId.has(c.chainId.toString()))
      throw new Error(`Duplicate chainId ${c.chainId.toString()}`);

    const client = createPublicClient({
      chain: toChain(c),
      transport: makeTransport(c.rpcUrls, undefined, { httpSigningRef }),
      batch: { multicall: true }
    });

    byId.set(c.chainId.toString(), client);
    nameToId.set(c.network, c.chainId.toString());
  }

  return {
    getByChainId: (chainId: ChainId) => {
      const client = byId.get(chainId.toString());
      if (!client) throw new Error(`Unknown chainId ${chainId.toString()}`);
      return client;
    },
    getByChainNetwork: (network: ChainNetwork) => {
      const id = nameToId.get(network);
      if (id == null) throw new Error(`Unknown network ${network}`);
      return byId.get(id)!;
    },
    all: () => byId
  };
}
