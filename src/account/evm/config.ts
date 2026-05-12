import { AccountId } from 'caip';
import { PublicClient } from 'viem';
import type { EvmAddress } from '../../types';
import { AddressVersion, SECP256K1_VALIDATOR_ADDRESS } from '../../config';
import { ValidatorAddress } from '../../types';
import { getValidatorConfig } from '../../zeroDev/accountConfig';

/**
 * Validator type
 */
export enum ValidatorType {
  /**
   * SECP256k1 ECDSA validator
   */
  SECP256k1 = 'secp256k1'
}

/**
 * Validator configuration
 */
export type ValidatorConfig = {
  /**
   * Validator type
   */
  type: ValidatorType;
  /**
   * Validator address
   */
  address: ValidatorAddress;
};

/**
 * Account config
 */
export type AccountConfig = {
  /**
   * Account ID
   */
  id: AccountId;

  /**
   * Validator configuration
   */
  validatorConfig: ValidatorConfig;
};

/**
 * Detect validator type from address
 *
 * This function maps known validator contract addresses to their
 * corresponding validator types. It's used during account config
 * retrieval to determine which validator is currently active.
 *
 * @param addr - The validator contract address to identify
 * @returns The validator type (SECP256k1 or MLDSA_44)
 *
 * @throws {Error} If the address doesn't match any known validator
 *
 * @example
 * ```typescript
 * const type = detectValidatorType('0x845ADb2C711129d4f3966735eD98a9F09fC4cE57');
 * console.log(type); // ValidatorType.SECP256k1
 * ```
 */
export function detectValidatorType(addr: ValidatorAddress): ValidatorType {
  const map: Partial<Record<string, ValidatorType>> = {
    [SECP256K1_VALIDATOR_ADDRESS.toLowerCase()]: ValidatorType.SECP256k1
  };

  const type = map[addr.toLowerCase()];
  if (!type) {
    throw new Error(`Unknown validator address: ${addr}`);
  }

  return type;
}

/**
 * Map from address version to default validator config.
 * Extend this as you add new versions.
 */
const DEFAULT_VALIDATOR_BY_VERSION: Partial<
  Record<AddressVersion, ValidatorConfig>
> = {
  [AddressVersion.V1]: {
    type: ValidatorType.SECP256k1,
    address: SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
  }
};

/**
 * Gets the default validator configuration for a given address version
 *
 * Each address version may have a different default validator that's used during initial
 * address creation.
 *
 * @param version - The address version to get the default validator for
 * @returns The default validator configuration for the specified version
 *
 * @throws {Error} If the address version is not supported
 *
 * @example
 * ```typescript
 * const config = getDefaultValidatorConfigForVersion(AddressVersion.V1);
 * console.log(config.type); // ValidatorType.SECP256k1
 * ```
 */
export function getDefaultValidatorConfigForVersion(
  version: AddressVersion
): ValidatorConfig {
  const config = DEFAULT_VALIDATOR_BY_VERSION[version];
  if (!config) {
    throw new Error(`Unsupported address version: ${version}`);
  }
  return config;
}

/**
 * Retrieves the configuration for a specific account
 *
 * Since LibQC accounts are modular and upgradeable, their configuration
 * (particularly the active validator) can change over time. This function
 * fetches the current on-chain configuration for an account.
 *
 * @param accountId - The CAIP-10 account identifier
 * @param publicClient - Public client for reading blockchain state
 * @param version - The address version
 * @returns The current account configuration
 *
 * @example
 * ```typescript
 * const config = await getAccountConfig(
 *   accountId,
 *   publicClient,
 *   AddressVersion.V1
 * );
 * console.log(`Active validator: ${config.validatorConfig.type}`);
 * ```
 */
export async function getAccountConfig(
  accountId: AccountId,
  publicClient: PublicClient,
  version: AddressVersion
): Promise<AccountConfig> {
  const validatorConfig = await getValidatorConfig(
    publicClient,
    accountId.address as EvmAddress,
    version
  );
  return {
    id: accountId,
    validatorConfig
  };
}

/**
 * Creates a validator configuration for a given validator type
 *
 * @param type The validator type
 * @returns The validator configuration
 */
export function createValidatorConfig(type: ValidatorType): ValidatorConfig {
  return {
    type,
    address: SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
  };
}
