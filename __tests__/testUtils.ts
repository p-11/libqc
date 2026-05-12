import { AccountId, AssetType, ChainId } from 'caip';
import { createPublicClient, getAddress, http, parseEther, toHex } from 'viem';
import { vi } from 'vitest';

// Main entry point exports
import {
  IconUrl,
  LibQC,
  toChain,
  type Asset,
  type AssetId,
  type AssetName,
  type BundlerConfig,
  type BundlerConfigProvider,
  type ChainName,
  type ChainNetwork,
  type ChainSpecification,
  type Decimals,
  type LibQCStorage,
  type RpcUrl,
  type Symbol,
  type Testnet,
  Seed
} from '../src';

// Internal imports (not exported from main entry point)
import { base64 } from '@scure/base';
import { mnemonicToSeedSync } from '@scure/bip39';
import { Entropy, Mnemonic } from '../src';
import {
  deriveEncryptionKey,
  mnemonicToEntropyBytes,
  type VaultEncryptionKeyWithMetadata,
  type EncryptedVault,
  type ScryptParams,
  type ScryptCostParameter,
  type ScryptBlockSize,
  type ScryptParallelism,
  type ScryptSalt
} from '../src/cryptography';
import {
  createEvmReadOnlyChainClients,
  type EvmReadOnlyChainClients
} from '../src/publicClients';
import { Password } from '../src/types';
import type { GeneratedAddressDataV1 } from '../src/zeroDev/accounts';
import * as addressesModule from '../src/addresses';

/**
 * Centralized test timing constants
 *
 * All wait times and timeouts for integration tests should be defined here
 * for easy tuning and consistency across the test suite.
 */
export const TEST_TIMING = {
  /** Wait time in ms for domains to be indexed after registration */
  DOMAIN_INDEX_WAIT_MS: 3000,

  /** Default timeout in ms for tests involving network operations */
  NETWORK_TEST_TIMEOUT_MS: 60000
} as const;

/**
 * Simple in-memory storage implementation for testing
 *
 * Implements LibQCStorage interface using a Map for in-memory persistence.
 * Useful for unit and integration tests that need a simple storage layer.
 *
 * @example
 * ```typescript
 * const storage = new MockStorage(new Map());
 * const { vault } = await createTestLibQC(storage);
 * ```
 */
export class MockStorage implements LibQCStorage {
  constructor(private store: Map<string, unknown>) {}

  async get<V>(key: string): Promise<V | null> {
    return (this.store.get(key) as V) ?? null;
  }

  async put<V>(key: string, value: V): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Master xprv from the BIP-85 specification, used by all official test vectors.
 * DO NOT use for production or real funds.
 */
// prettier-ignore
export const BIP85_SPEC_XPRV =
  'xprv9s21ZrQH143K2LBWUUQRFXhucrQqBpKdRRxNVq2zBqsx8HVqFk2uYo8kmbaLLHRdqtQpUm98uKfu3vca1LqdGhUtyoFnCNkfmXRyPXLjbKb';

/**
 * Test mnemonic for deterministic testing
 * DO NOT use this mnemonic for production or real funds
 */
export const TEST_MNEMONIC_PHRASE =
  'abstract reform twelve inspire cry master vague skirt mention ill velvet nice limit input present old equip double best doctor decrease survey spray wife';
export const TEST_MNEMONIC = Mnemonic.from(
  new TextEncoder().encode(TEST_MNEMONIC_PHRASE)
);
export const TEST_ENTROPY = Entropy.from(mnemonicToEntropyBytes(TEST_MNEMONIC));
export const TEST_SEED = Seed.from(mnemonicToSeedSync(TEST_MNEMONIC_PHRASE));

/**
 * Creates chain specifications for testing
 *
 * Expects TEST_ETH_L1_RPC_URL and TEST_BASE_RPC_URL to be set in .env file
 *
 * Returns configurations for Ethereum and Base testnets using Tenderly virtual testnets.
 * These chains are configured via environment variables to allow testing against
 * different RPC endpoints without code changes.
 *
 * Required environment variables:
 * - TEST_ETH_L1_RPC_URL: Tenderly virtual testnet RPC URL for Ethereum
 * - TEST_BASE_RPC_URL: Tenderly virtual testnet RPC URL for Base
 *
 * @returns Array of chain specifications for Ethereum and Base testnets
 * @throws Error if required environment variables are not set
 *
 * @example
 * ```typescript
 * const chains = createTestChains();
 * const vault = new LibQC(storage, chains, bundlerConfigProvider);
 * ```
 */
export function createTestChains(): ChainSpecification[] {
  if (!process.env.TEST_ETH_L1_RPC_URL) {
    throw new Error('TEST_ETH_L1_RPC_URL environment variable is not set.');
  }

  if (!process.env.TEST_BASE_RPC_URL) {
    throw new Error('TEST_BASE_RPC_URL environment variable is not set.');
  }

  return [
    {
      id: 1,
      chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
      name: 'Tenderly ETH Testnet' as ChainName,
      network: 'testnet' as ChainNetwork,
      iconUrl: 'https://example.com/eth.png' as IconUrl,
      nativeCurrency: {
        decimals: 18 as Decimals,
        name: 'Ether' as AssetName,
        symbol: 'ETH' as Symbol
      },
      testnet: true as Testnet,
      rpcUrls: [process.env.TEST_ETH_L1_RPC_URL as RpcUrl]
    },
    {
      id: 8453,
      chainId: new ChainId({ namespace: 'eip155', reference: '8453' }),
      name: 'Tenderly Base Testnet' as ChainName,
      network: 'testnet' as ChainNetwork,
      iconUrl: 'https://example.com/base.png' as IconUrl,
      nativeCurrency: {
        decimals: 18 as Decimals,
        name: 'Ether' as AssetName,
        symbol: 'ETH' as Symbol
      },
      testnet: true as Testnet,
      rpcUrls: [process.env.TEST_BASE_RPC_URL as RpcUrl]
    },
    createBitcoinChainSpec()
  ];
}

/**
 * Bitcoin mainnet chain specification for testing
 *
 * Uses Blockstream Esplora API. rpcUrls are repurposed as API base URLs.
 */
export function createBitcoinChainSpec(): ChainSpecification {
  return {
    id: 0,
    chainId: new ChainId({
      namespace: 'bip122',
      reference: '000000000019d6689c085ae165831e93'
    }),
    name: 'Bitcoin' as ChainName,
    network: 'mainnet' as ChainNetwork,
    iconUrl: 'https://example.com/btc.png' as IconUrl,
    nativeCurrency: {
      decimals: 8 as Decimals,
      name: 'Bitcoin' as AssetName,
      symbol: 'BTC' as Symbol
    },
    testnet: false as Testnet,
    rpcUrls: ['https://blockstream.info/api'] as RpcUrl[]
  };
}

/**
 * Bitcoin testnet chain specification for testing
 *
 * Uses Blockstream Esplora testnet API. rpcUrls are repurposed as API base URLs.
 */
export function createBitcoinTestnetChainSpec(): ChainSpecification {
  return {
    id: 0,
    chainId: new ChainId({
      namespace: 'bip122',
      reference: '000000000933ea01ad0ee984209779ba'
    }),
    name: 'Bitcoin Testnet' as ChainName,
    network: 'testnet' as ChainNetwork,
    iconUrl: 'https://example.com/btc-testnet.png' as IconUrl,
    nativeCurrency: {
      decimals: 8 as Decimals,
      name: 'Bitcoin Testnet' as AssetName,
      symbol: 'BTC' as Symbol
    },
    testnet: true as Testnet,
    rpcUrls: ['https://blockstream.info/testnet/api'] as RpcUrl[]
  };
}

/**
 * Creates a single chain specification with a non-EVM, non-Bitcoin namespace.
 *
 * Use this when you need to instantiate LibQC (which requires at least one
 * chain) but must not trigger account discovery during importWallet. Because
 * the namespace is neither 'eip155' nor 'bip122', the discovery loop in
 * importWallet skips it entirely — no network calls are made.
 */
export function createNoDiscoveryChainSpec(): ChainSpecification {
  return {
    id: 0,
    chainId: new ChainId({ namespace: 'dummy', reference: '0' }),
    name: 'Dummy' as ChainName,
    network: 'testnet' as ChainNetwork,
    iconUrl: 'https://example.com' as IconUrl,
    nativeCurrency: {
      decimals: 0 as Decimals,
      name: 'Dummy' as AssetName,
      symbol: 'DMY' as Symbol
    },
    testnet: true as Testnet,
    rpcUrls: [] as RpcUrl[]
  };
}

/**
 * Creates read-only blockchain clients for testing
 *
 * Returns viem PublicClient instances configured for all test chains.
 * These clients can read blockchain state but cannot send transactions.
 *
 * @returns ReadOnlyChainClients object with clients for each test chain
 * @throws Error if required environment variables are not set (via createTestChains)
 *
 * @example
 * ```typescript
 * const clients = createTestClients();
 * const balance = await clients.clients[0].getBalance({ address: '0x...' });
 * ```
 */
export function createTestClients(): EvmReadOnlyChainClients {
  return createEvmReadOnlyChainClients(createTestChains());
}

/**
 * Converts a plain object to a properly typed ChainSpecification
 *
 * This helper applies LibQC's branded types (ChainName, RpcUrl, etc.) to a plain
 * JavaScript object. Useful in unit tests where you need to create chain configs
 * from plain objects without dealing with type casting.
 *
 * @param config Plain object with chain configuration
 * @param config.chainId Numeric chain ID (e.g., 1 for Ethereum, 8453 for Base)
 * @param config.name Human-readable chain name
 * @param config.network Network identifier (e.g., 'mainnet', 'testnet')
 * @param config.iconUrl URL to chain icon
 * @param config.nativeCurrency Native currency configuration
 * @param config.testnet Whether this is a testnet
 * @param config.rpcUrls Array of RPC endpoint URLs
 * @returns Properly typed ChainSpecification
 *
 * @example
 * ```typescript
 * const chain = createTypedChain({
 *   chainId: 1,
 *   name: 'Ethereum',
 *   network: 'mainnet',
 *   iconUrl: 'https://example.com/eth.png',
 *   nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
 *   testnet: false,
 *   rpcUrls: ['https://eth.llamarpc.com']
 * });
 * ```
 */
export function createTypedChain(config: {
  chainId: number;
  name: string;
  network: string;
  iconUrl: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  testnet: boolean;
  rpcUrls: string[];
}): ChainSpecification {
  return {
    id: config.chainId,
    chainId: new ChainId({
      namespace: 'eip155',
      reference: String(config.chainId)
    }),
    name: config.name as ChainName,
    network: config.network as ChainNetwork,
    iconUrl: config.iconUrl as IconUrl,
    nativeCurrency: {
      decimals: config.nativeCurrency.decimals as Decimals,
      name: config.nativeCurrency.name as AssetName,
      symbol: config.nativeCurrency.symbol as Symbol
    },
    testnet: config.testnet as Testnet,
    rpcUrls: config.rpcUrls as RpcUrl[]
  };
}

/**
 * Creates a bundler configuration provider for multi-chain testing
 *
 * Returns a function that automatically selects the correct ERC-4337 bundler
 * configuration based on the chain being used. This enables transparent multi-chain
 * support in tests - the same LibQC instance can send transactions on different chains.
 *
 * Required environment variables:
 * - TEST_ETH_BUNDLER_RPC_URL: Bundler RPC for Ethereum (e.g., Pimlico, Alchemy)
 * - TEST_ETH_BUNDLER_API_KEY: API key for Ethereum bundler
 * - TEST_BASE_BUNDLER_RPC_URL: Bundler RPC for Base
 * - TEST_BASE_BUNDLER_API_KEY: API key for Base bundler
 *
 * @param chains Chain specifications to create bundler configs for
 * @returns Function that provides bundler config for a given chain
 * @throws Error if chain is not found or environment variables are not set
 *
 * @example
 * ```typescript
 * const provider = createBundlerConfigProvider(createTestChains());
 * const ethConfig = provider(new ChainId({ namespace: 'eip155', reference: '1' }));
 * // Returns bundler config with Ethereum bundler URL and API key
 * ```
 */
export function createBundlerConfigProvider(
  chains: ChainSpecification[]
): BundlerConfigProvider {
  return (chainId: ChainId): BundlerConfig => {
    const chain = chains.find(c => c.chainId.toString() === chainId.toString());
    if (!chain) {
      throw new Error(`Chain ${chainId.toString()} not found`);
    }

    // Get chain-specific bundler configuration
    let bundlerRpcUrl: string;
    let bundlerApiKey: string;

    if (chainId.toString() === 'eip155:1') {
      // Ethereum
      bundlerRpcUrl = process.env.TEST_ETH_BUNDLER_RPC_URL!;
      bundlerApiKey = process.env.TEST_ETH_BUNDLER_API_KEY!;
    } else if (chainId.toString() === 'eip155:8453') {
      // Base
      bundlerRpcUrl = process.env.TEST_BASE_BUNDLER_RPC_URL!;
      bundlerApiKey = process.env.TEST_BASE_BUNDLER_API_KEY!;
    } else if (chainId.toString() === 'eip155:137') {
      // Polygon
      // P11TODO: This is not supported but needed for tests which test functions don't work on chains we don't support yet
      // Consider removing this logic and those tests or removing this TODO
      bundlerRpcUrl = 'not-supported';
      bundlerApiKey = 'not-supported';
    } else if (chainId.namespace === 'bip122') {
      // Bitcoin - bundler not used; return placeholder
      bundlerRpcUrl = 'https://blockstream.info/api';
      bundlerApiKey = 'unused';
    } else {
      throw new Error(
        `No bundler configuration for chain ${chainId.toString()}`
      );
    }

    return {
      chain: toChain(chain),
      urls: [bundlerRpcUrl as RpcUrl],
      headers: {
        Authorization: `Bearer ${bundlerApiKey}`
      }
    };
  };
}

/**
 * Reduced scrypt params for fast test execution.
 */
export const TEST_FAST_SCRYPT_PARAMS: ScryptParams = {
  N: 1024 as ScryptCostParameter,
  r: 8 as ScryptBlockSize,
  p: 1 as ScryptParallelism
};

/** Standard test password used across tests */
export const getTestPassword = () =>
  Password.from(new TextEncoder().encode('Test-Password-123!'));
export const getTestMnemonic = () => Mnemonic.from(TEST_MNEMONIC);
export const getTestEntropy = () => Entropy.from(TEST_ENTROPY);
export const getTestSeed = () => Seed.from(TEST_SEED);

/**
 * Temporarily replaces globalThis.crypto for the duration of `fn`,
 * restoring the original afterwards.
 */
export async function withCryptoOverride<T>(
  cryptoOverride: Crypto | undefined,
  fn: () => Promise<T> | T
): Promise<T> {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoOverride,
    configurable: true
  });

  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true
    });
  }
}

/**
 * Creates an unlocked LibQC instance ready for testing
 *
 * Sets a password using TEST_PASSWORD, which creates the encrypted vault
 * and leaves the instance unlocked. Also returns the encryption key for
 * tests that need to inspect decrypted state directly via getLibQCState.
 *
 * @param storage - The storage implementation to use
 * @param chains - Optional chain specifications (defaults to createTestChains())
 * @returns The unlocked vault and its encryption key
 *
 * @example
 * ```typescript
 * const storage = new MockStorage(new Map());
 * const { vault, encryptionKey } = await createTestLibQC(storage);
 * await vault.generateMnemonic(() => true);
 * const account = await vault.createAccount(ethChainId);
 * const state = await getLibQCState(storage, encryptionKey);
 * ```
 */
export async function createTestLibQC(
  storage: LibQCStorage,
  chains?: ChainSpecification[]
): Promise<{ vault: LibQC; encryptionKey: VaultEncryptionKeyWithMetadata }> {
  const vault = createBareTestLibQC(storage, undefined, chains);
  await vault.setPassword(getTestPassword());

  const encryptedVault = await storage.get<EncryptedVault>('state.addresses');
  if (!encryptedVault) {
    throw new Error('No encrypted vault found after setPassword');
  }
  const encryptionKey = await deriveEncryptionKey(
    getTestPassword(),
    base64.decode(encryptedVault.scryptSalt) as ScryptSalt,
    TEST_FAST_SCRYPT_PARAMS
  );

  return { vault, encryptionKey };
}

/**
 * Creates a bare LibQC instance without setting a password
 *
 * Use this only for tests that need to control the password/lock lifecycle
 * manually (e.g. password tests, lock tests, second-instance-with-same-storage tests).
 * Most tests should use {@link createTestLibQC} instead.
 *
 * @param storage - The storage implementation to use
 * @param scryptParams - Optional scrypt params override (defaults to TEST_FAST_SCRYPT_PARAMS)
 * @param chains - Optional chain specifications (defaults to createTestChains())
 * @returns A configured but uninitialized LibQC instance (no vault, no password)
 */
export function createBareTestLibQC(
  storage: LibQCStorage,
  scryptParams?: ScryptParams,
  chains?: ChainSpecification[]
): LibQC {
  const testChains = chains || createTestChains();
  const bundlerConfigProvider = createBundlerConfigProvider(testChains);
  return new LibQC(
    storage,
    testChains,
    bundlerConfigProvider,
    scryptParams ?? TEST_FAST_SCRYPT_PARAMS
  );
}

/**
 * Mocks EVM address generation so unit tests can create EVM accounts without RPC calls.
 *
 * The returned addresses are deterministic per index and preserve the requested
 * version field so persistence tests can still verify stored metadata.
 */
export function mockGenerateAddressFromSeed() {
  return vi
    .spyOn(addressesModule, 'generateAddressFromSeed')
    .mockImplementation(
      async (_mnemonic, index, version): Promise<GeneratedAddressDataV1> => {
        const numericIndex = Number(index);
        const address = getAddress(
          `0x${(numericIndex + 1).toString(16).padStart(40, '1')}`
        );
        const owner = getAddress(
          `0x${(numericIndex + 101).toString(16).padStart(40, '2')}`
        );

        return {
          index,
          address,
          secp256k1PublicKeyHash: owner,
          secp256k1PrivateKey: new Uint8Array(32).fill(
            (numericIndex % 250) + 1
          ) as any,
          version
        };
      }
    );
}

/**
 * Backward-compatible alias used by older tests that still talk about mnemonic-based derivation.
 */
export function mockGenerateAddressFromMnemonic() {
  return mockGenerateAddressFromSeed();
}

/**
 * Generates a mnemonic and returns a caller-owned copy for assertions.
 */
export async function captureGeneratedMnemonic(
  vault: LibQC
): Promise<Mnemonic> {
  return vault.generateMnemonic(mnemonic =>
    Mnemonic.from(new Uint8Array(mnemonic))
  );
}

/**
 * Funds an account with native ETH using Tenderly's virtual testnet faucet
 *
 * Uses Tenderly's `tenderly_setBalance` RPC method to instantly set the account
 * balance. This only works on Tenderly virtual testnets, not on real networks.
 *
 * @param accountId CAIP-10 account identifier specifying address and chain
 * @param amountInEth Amount of ETH to fund (default: 1 ETH)
 * @throws Error if chain is not found in test chains
 * @throws Error if Tenderly RPC call fails
 *
 * @example
 * ```typescript
 * const accountId = new AccountId('eip155:1:0x1234...5678');
 * await fundAccount(accountId, 10); // Fund with 10 ETH
 * ```
 */
export async function fundAccount(
  accountId: AccountId,
  amountInEth: number = 1
): Promise<void> {
  const chains = createTestChains();
  const chain = chains.find(
    c => c.chainId.toString() === accountId.chainId.toString()
  );
  if (!chain) {
    throw new Error(`Chain ${accountId.chainId.toString()} not found`);
  }

  const client = createPublicClient({
    chain: toChain(chain),
    transport: http(chain.rpcUrls[0])
  });

  // Convert ETH amount to wei hex
  const amountInWei = toHex(parseEther(amountInEth.toString()));

  await client.request({
    // @ts-expect-error viem types don't support custom tenderly RPC calls
    method: 'tenderly_setBalance',
    // @ts-expect-error viem types don't support custom tenderly RPC calls
    params: [[accountId.address], amountInWei]
  });
}

/**
 * Funds an account with ERC-20 tokens using Tenderly's virtual testnet faucet
 *
 * Uses Tenderly's `tenderly_setErc20Balance` RPC method to instantly set the token
 * balance. This only works on Tenderly virtual testnets, not on real networks.
 *
 * Note: The amount should be in the token's smallest unit (e.g., for USDC with
 * 6 decimals, pass 1000000n for 1 USDC).
 *
 * @param tokenAddress ERC-20 contract address (e.g., USDC on Base)
 * @param accountId CAIP-10 account identifier specifying address and chain
 * @param amount Token amount in smallest unit (bigint)
 * @throws Error if chain is not found in test chains
 * @throws Error if Tenderly RPC call fails
 *
 * @example
 * ```typescript
 * const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
 * const accountId = new AccountId('eip155:8453:0x1234...5678');
 * await fundAccountWithErc20(USDC_BASE, accountId, 1000n * 10n ** 6n); // 1000 USDC
 * ```
 */
export async function fundAccountWithErc20(
  tokenAddress: string,
  accountId: AccountId,
  amount: bigint
): Promise<void> {
  const chains = createTestChains();
  const chain = chains.find(
    c => c.chainId.toString() === accountId.chainId.toString()
  );
  if (!chain) {
    throw new Error(`Chain ${accountId.chainId.toString()} not found`);
  }

  const client = createPublicClient({
    chain: toChain(chain),
    transport: http(chain.rpcUrls[0])
  });

  await client.request({
    // @ts-expect-error viem types don't support custom tenderly RPC calls
    method: 'tenderly_setErc20Balance',
    // @ts-expect-error viem types don't support custom tenderly RPC calls
    params: [tokenAddress, [accountId.address], toHex(amount)]
  });
}

/**
 * Creates a test asset with proper CAIP-19 aggregated asset structure
 *
 * Creates a minimal Asset object suitable for unit testing. The asset has a single
 * entity for the specified chain. For integration tests, prefer using real assets
 * from `getAssetBySymbol()` or LibQC's asset registry.
 *
 * Native vs ERC-20:
 * - Native assets use the slip44 namespace (e.g., ETH)
 * - ERC-20 tokens use the erc20 namespace with contract address
 *
 * @param chainId CAIP-2 chain identifier (e.g., eip155:1 for Ethereum)
 * @param address Contract address for ERC-20, or zero address for native assets
 * @param symbol Asset symbol (e.g., 'ETH', 'USDC')
 * @param decimals Number of decimals (e.g., 18 for ETH, 6 for USDC)
 * @param isNative True for native assets (ETH), false for ERC-20 tokens
 * @returns Properly formatted Asset object with CAIP-19 entity
 *
 * @example
 * ```typescript
 * // Create native ETH asset
 * const eth = createTestAsset(
 *   new ChainId({ namespace: 'eip155', reference: '1' }),
 *   '0x0000000000000000000000000000000000000000',
 *   'ETH',
 *   18,
 *   true
 * );
 *
 * // Create USDC token asset
 * const usdc = createTestAsset(
 *   new ChainId({ namespace: 'eip155', reference: '8453' }),
 *   '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
 *   'USDC',
 *   6,
 *   false
 * );
 * ```
 */
export function createTestAsset(
  chainId: ChainId,
  address: string,
  symbol: string,
  decimals: number,
  isNative: boolean = false
): Asset {
  return createMultiChainTestAsset({
    id: `p11:test-${symbol.toLowerCase()}-${chainId.reference}`,
    symbol,
    decimals,
    entities: [{ chainId, address, decimals, isNative }]
  });
}

/**
 * Creates a test asset with multiple entities on different chains,
 * each potentially with its own decimal precision.
 *
 * @example
 * ```typescript
 * const usdc = createMultiChainTestAsset({
 *   symbol: 'USDC',
 *   decimals: 6,
 *   entities: [
 *     {
 *       chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
 *       address: '0xa0b8...eb48',
 *       decimals: 6,
 *     },
 *     {
 *       chainId: new ChainId({ namespace: 'eip155', reference: '8453' }),
 *       address: '0x8335...2913',
 *       decimals: 18,
 *     },
 *   ],
 * });
 *
 * // Native Bitcoin asset (coinType '0')
 * const btc = createMultiChainTestAsset({
 *   symbol: 'BTC',
 *   decimals: 8,
 *   entities: [
 *     {
 *       chainId: new ChainId({ namespace: 'bip122', reference: '000...000' }),
 *       address: '0x0',
 *       decimals: 8,
 *       isNative: true,
 *       coinType: '0',
 *     },
 *   ],
 * });
 * ```
 */
export function createMultiChainTestAsset(config: {
  id?: string;
  symbol: string;
  decimals: number;
  entities: Array<{
    chainId: ChainId;
    address: string;
    decimals: number;
    isNative?: boolean;
    /** SLIP-44 coin type for native assets (default '60' = ETH) */
    coinType?: string;
  }>;
}): Asset {
  const symbol = config.symbol;
  const id = (config.id ?? `p11:test-${symbol.toLowerCase()}`) as AssetId;
  const iconUrl = `https://example.com/${symbol.toLowerCase()}.png` as IconUrl;

  return {
    id,
    symbol: symbol as Symbol,
    name: symbol as AssetName,
    decimals: config.decimals as Decimals,
    iconUrl,
    entities: config.entities.map(e => {
      const assetType = e.isNative
        ? new AssetType({
            chainId: {
              namespace: e.chainId.namespace,
              reference: e.chainId.reference
            },
            assetName: {
              namespace: 'slip44',
              reference: e.coinType ?? '60'
            }
          })
        : new AssetType({
            chainId: {
              namespace: e.chainId.namespace,
              reference: e.chainId.reference
            },
            assetName: {
              namespace: 'erc20',
              reference: e.address.toLowerCase()
            }
          });

      return {
        assetType,
        decimals: e.decimals as Decimals,
        name: symbol as AssetName,
        symbol: symbol as Symbol
      };
    })
  };
}
