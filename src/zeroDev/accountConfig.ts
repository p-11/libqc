import { KernelV3_3AccountAbi } from '@zerodev/sdk';
import { getAddress, PublicClient } from 'viem';
import type { EvmAddress } from '../types';
import {
  detectValidatorType,
  getDefaultValidatorConfigForVersion,
  ValidatorConfig
} from '../account/evm/config';
import type { AuthorizedAccount } from '../account/evm/types';
import type { BundlerConfig } from '../bundler';
import { AddressVersion } from '../config';
import { ValidatorAddress } from '../types';

/**
 * Get the current validator config for a account
 *
 * @param publicClient
 * @param address
 * @returns ValidatorConfig
 */
export async function getValidatorConfig(
  publicClient: PublicClient,
  address: EvmAddress,
  version: AddressVersion
): Promise<ValidatorConfig> {
  // Ensure account is deployed
  const code = await publicClient.getCode({ address });
  if (!code || code === '0x') {
    // If the account is not deployed, we can use the default validator for the default account version
    return getDefaultValidatorConfigForVersion(version);
  }
  const raw = await publicClient.readContract({
    address,
    abi: KernelV3_3AccountAbi,
    functionName: 'rootValidator'
  }); // 22 bytes
  /*
    rootValidator returns bytes21. Expect: 21 bytes -> 22 hex chars after stripping 0x

    A bytes21 value must always decode to 21 bytes.

    Hex strings from viem look like "0x" + hex data:
      - "0x" prefix is 2 chars.
      - 21 bytes is 42 hex chars.
      - Total expected length = 2 + 42 = 44 chars.
  */
  if (raw.length !== 2 + 42) {
    throw new Error(
      `Invalid rootValidator response length: expected 21 bytes, got ${raw.length / 2 - 1} bytes`
    );
  }
  const hex = raw.slice(2); // strip 0x => 44 hex chars
  const validatorAddressHex = `0x${hex.slice(2, 42)}`; // extract characters 2-41 (40 hex chars for 20-byte address) from the 44-character hex string
  const validatorAddress = getAddress(validatorAddressHex) as ValidatorAddress; // validate checksum-normalize
  return {
    type: detectValidatorType(validatorAddress),
    address: validatorAddress
  };
}

/**
 * Configuration for setting a new kernel validator
 */
export interface SetKernelValidatorConfig {
  /** The current authorized account (with current validator) */
  currentAuthorizedAccount: AuthorizedAccount;
  /** The new authorized account (with new validator) */
  newAuthorizedAccount: AuthorizedAccount;
  /** Public client for chain interactions */
  publicClient: PublicClient;
  /** Bundler config for sending user operations */
  bundlerConfig: BundlerConfig;
}
