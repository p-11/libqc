import * as secp from '@noble/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { AddressVersion, CURRENT_DEFAULT_ADDRESS_VERSION } from './config';
import {
  deriveBitcoinPrivateKey,
  type Secp256k1PrivateKeyBytes
} from './cryptography';
import type { AddressIndex, BitcoinAddress, Seed } from './types';
import {
  generateAddressV1,
  type GeneratedAddressDataV1
} from './zeroDev/accounts';

/**
 * Default number of cross-chain addresses to generate
 */
const DEFAULT_NUM_CROSS_CHAIN_ADDRESSES = 2;

/**
 * Full Bitcoin address derivation result for persistence (mirrors EVM GeneratedAddressDataV1)
 */
export type GeneratedBitcoinAddressData = {
  /** Native SegWit (P2WPKH) address, e.g. bc1q... */
  address: BitcoinAddress;
  /** Address index used for derivation */
  index: AddressIndex;
  /**
   * Caller-owned binary private key for signing.
   * The caller must wipe this buffer with `fill(0)` when no longer needed.
   */
  secp256k1PrivateKey: Secp256k1PrivateKeyBytes;
  /** Compressed public key (33 bytes) */
  secp256k1PublicKey: Uint8Array;
  /** Address version */
  version: AddressVersion;
};

/**
 * Derive a Bitcoin P2WPKH address from a seed and address index using BIP-85
 *
 * Uses the same BIP-85 derivation approach as EVM keys but with a dedicated
 * Bitcoin app number. Same seed + index produces a related but different
 * key for Bitcoin vs EVM (one logical identity, different addresses per chain type).
 *
 * Returns full persistence data including private key, mirroring generateAddressFromSeed for EVM.
 *
 * @param seed BIP-39 seed (64 bytes)
 * @param index Address index (0-based)
 * @param network Optional network (default: bitcoin mainnet)
 * @param version Optional address version (default: CURRENT_DEFAULT_ADDRESS_VERSION)
 * @returns Full Bitcoin address data for persistence (address, index, secp256k1PrivateKey, version)
 *
 * @example
 * ```typescript
 * const result = deriveBitcoinAddressFromSeed(
 *   seed,
 *   0 as AddressIndex
 * );
 * // result.address => 'bc1q...'
 * // result.secp256k1PrivateKey => '0x...'
 * ```
 */
export function deriveBitcoinAddressFromSeed(
  seed: Seed,
  index: AddressIndex,
  network: bitcoin.Network = bitcoin.networks.bitcoin,
  version: AddressVersion = CURRENT_DEFAULT_ADDRESS_VERSION
): GeneratedBitcoinAddressData {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(
      `Invalid index: must be a non-negative integer, got ${index}`
    );
  }

  let privKey: Uint8Array | undefined = deriveBitcoinPrivateKey(seed, index);

  try {
    // Encode private key to hex before zeroing (for persistence)
    const secp256k1PrivateKey = new Uint8Array(
      privKey
    ) as Secp256k1PrivateKeyBytes;

    const publicKey = secp.getPublicKey(privKey, true);
    const payment = bitcoin.payments.p2wpkh({
      pubkey: publicKey,
      network
    });

    if (!payment.address) {
      throw new Error('Failed to derive Bitcoin address');
    }

    return {
      address: payment.address as BitcoinAddress,
      index,
      secp256k1PrivateKey,
      secp256k1PublicKey: new Uint8Array(publicKey),
      version
    };
  } finally {
    /**
     * Best-effort memory zeroing
     */
    privKey.fill(0);
    privKey = undefined;
  }
}

/**
 * Generate a single address from a seed at a specific index
 *
 * This function generates one address using deterministic BIP-85 derivation.
 * The same seed and index will always produce the same address
 * across all EVM chains.
 *
 * Use this function to generate additional addresses incrementally after
 * initial address generation.
 *
 * Derivation uses BIP-85: m/83696968'/<vault_app_no>'/<address_index>'
 *
 * @param seed BIP-39 seed (64 bytes)
 * @param index Address index (0-based) - each index produces a unique address that works across all chains
 * @param version Address version to generate
 * @returns A single address with index, address, private key, and version
 *
 * @example
 * ```typescript
 * // Generate address at index 0
 * const address0 = await generateAddressFromSeed(
 *   seed,
 *   0,
 *   AddressVersion.V1
 * );
 *
 * // Later, generate address at index 5
 * const address5 = await generateAddressFromSeed(
 *   seed,
 *   5,
 *   AddressVersion.V1
 * );
 * ```
 */
export async function generateAddressFromSeed(
  seed: Seed,
  index: AddressIndex,
  version: AddressVersion
): Promise<GeneratedAddressDataV1> {
  // P11TODO check upper limit on number of possible addresses
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(
      `Invalid index: must be a non-negative integer, got ${index}`
    );
  }
  switch (version) {
    // P11TODO: Remove this eslint disable rule once we add a new address version.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    case AddressVersion.V1:
      return generateAddressV1(seed, index);
    default:
      // Throw error for unsupported versions
      throw new Error(`Unsupported address version: ${version as string}`);
  }
}

/**
 * Generate multiple addresses from a seed
 *
 * Each address uses a deterministic BIP-85 derivation and produces
 * the same address across all EVM chains.
 *
 * Always generates DEFAULT_NUM_CROSS_CHAIN_ADDRESSES cross-chain addresses.
 *
 * For generating additional addresses later, use generateAddressFromSeed
 * with a specific index.
 *
 * Derivation uses BIP-85: m/83696968'/<vault_app_no>'/<address_index>'
 *
 * @param seed BIP-39 seed (64 bytes)
 * @param version Address version to generate
 * @returns Array of DEFAULT_NUM_CROSS_CHAIN_ADDRESSES addresses with index, address, private key, and version
 *
 * @example
 * ```typescript
 * const addresses = await generateAddressesFromSeed(
 *   seed,
 *   AddressVersion.V1
 * );
 * // Returns: [
 * //   { index: 0, address: '0x...', secp256k1PrivateKey: '0x...' },
 * //   { index: 1, address: '0x...', secp256k1PrivateKey: '0x...' }
 * // ]
 * ```
 */
export async function generateAddressesFromSeed(
  seed: Seed,
  version: AddressVersion
): Promise<GeneratedAddressDataV1[]> {
  const numAddresses = DEFAULT_NUM_CROSS_CHAIN_ADDRESSES;

  // Generate all addresses in parallel
  return Promise.all(
    Array.from({ length: numAddresses }, (_, index) =>
      generateAddressFromSeed(seed, index as AddressIndex, version)
    )
  );
}
