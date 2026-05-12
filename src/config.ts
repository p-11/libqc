/*
 * This file contains configuration settings for the @project-eleven/libqc library.
 */

/**
 * Deployed SECP256k1 ECDSA validator contract address
 */
export const SECP256K1_VALIDATOR_ADDRESS =
  '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57';

/**
 * Address version enumeration
 *
 * As LibQC evolves, we may deploy new address generation schemes with
 * improved security or functionality. This enum tracks which version
 * an address uses to ensure correct derivation and configuration.
 */
export enum AddressVersion {
  /**
   * Version 1: SECP256k1-based addresses
   */
  V1 = 'V1'
}

/**
 * The default address version for new address generation
 *
 * This constant determines which address version is used when creating
 * new addresses. When a new address is generated, it will use the version specified by this constant.
 */
export const CURRENT_DEFAULT_ADDRESS_VERSION = AddressVersion.V1;

/**
 * Mnemonic strength in bits for BIP-39 generation
 *
 * 256 bits corresponds to a 24-word mnemonic phrase, providing
 * the highest level of security for HD wallet generation.
 */
export const MNEMONIC_STRENGTH = 256;

/**
 * Minimum number of word guesses required for mnemonic validation
 *
 * This constant enforces that at least 4 random words must be provided
 * when validating a stored mnemonic.
 */
export const MIN_MNEMONIC_GUESSES = 4;

/**
 * Maximum number of account iterations for wallet discovery
 *
 * This limit prevents infinite loops and protects against excessive network
 * requests during the initial wallet recovery process.
 */
export const MAX_ACCOUNT_ITERATION = 50;
