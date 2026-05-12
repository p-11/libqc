import { ChainId } from 'caip';
import { BitcoinAddress } from './types';

/** Bitcoin mainnet CAIP-2 reference (genesis block hash) */
export const BITCOIN_MAINNET_REF = '000000000019d6689c085ae165831e93';

/** Bitcoin testnet CAIP-2 reference */
export const BITCOIN_TESTNET_REF = '000000000933ea01ad0ee984209779ba';

/**
 * Checks if the chain is an EVM chain (eip155 namespace)
 *
 * @param chainId - CAIP-2 chain identifier
 * @returns True if the chain uses the eip155 namespace (Ethereum, Base, etc.)
 */
export function isEvmChain(chainId: ChainId): boolean {
  return chainId.namespace === 'eip155';
}

/**
 * Checks if the chain is a Bitcoin chain (bip122 namespace)
 *
 * @param chainId - CAIP-2 chain identifier
 * @returns True if the chain uses the bip122 namespace (Bitcoin mainnet, testnet, etc.)
 */
export function isBitcoinChain(chainId: ChainId): boolean {
  return chainId.namespace === 'bip122';
}

/**
 * Checks whether a Bitcoin address (Bech32) belongs to the network of the given chain.
 *
 * Unlike EVM where 0x addresses are shared across mainnet/testnet, Bitcoin uses different
 * HRPs: bc1 for mainnet, tb1 for testnet. An address must match the chain's network.
 *
 * @param address - Bitcoin address (e.g. bc1q..., tb1q...)
 * @param chainId - CAIP-2 chain identifier (bip122 namespace)
 * @returns True if the address encoding matches the chain's network
 */
export function isBitcoinAddressForChain(
  address: BitcoinAddress,
  chainId: ChainId
): boolean {
  if (chainId.namespace !== 'bip122') return false;
  const isTestnet = chainId.reference === BITCOIN_TESTNET_REF;
  return isTestnet ? address.startsWith('tb1') : address.startsWith('bc1');
}
