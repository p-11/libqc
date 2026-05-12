import {
  getKernelAddressFromECDSA,
  signerToEcdsaValidator
} from '@zerodev/ecdsa-validator';
import {
  constants,
  createKernelAccount,
  type CreateKernelAccountReturnType
} from '@zerodev/sdk';
import { KERNEL_V3_3, getEntryPoint } from '@zerodev/sdk/constants';
import type { KernelValidator } from '@zerodev/sdk/types';
import { type PublicClient } from 'viem';
import { toAccount } from 'viem/accounts';
import { createPrivateKeyAccount } from '../account/evm/utils';
import { ValidatorType } from '../account/evm/config';
import { AddressVersion } from '../config';
import type {
  Secp256k1PrivateKeyBytes,
  Secp256k1Signer
} from '../cryptography';
import { deriveSecp256k1PrivateKey } from '../cryptography';
import type { AddressIndex, Brand, EvmAddress, Seed } from '../types';

/**
 * Default kernel version for account creation
 */
export const DEFAULT_KERNEL_VERSION = KERNEL_V3_3;

/**
 * Default entry point version
 */
export const DEFAULT_ENTRY_POINT = getEntryPoint('0.7');

/**
 * Authorized validator types for kernel accounts
 */
export type KernelAuth = {
  type: ValidatorType.SECP256k1;
  signer: Secp256k1Signer;
};

/**
 * Stub auth for read-only kernel accounts
 *
 * Uses stub signers that throw errors when signing methods are called,
 * allowing account creation for gas estimation without access to private keys.
 */
export type KernelStubAuth = {
  type: ValidatorType.SECP256k1;
  stubSigner: Secp256k1Signer;
};

/**
 * Authorized kernel account with validator
 *
 * Contains both the kernel account and the validator plugin that was used to create it.
 * This allows easy access to the validator for operations like changeSudoValidator.
 */
export type AuthorizedKernelAccount = {
  account: CreateKernelAccountReturnType;
  validator: KernelValidator<string>;
};

/**
 * Branded type for read-only kernel accounts
 */
export type ReadOnlyKernelAccount = Brand<
  CreateKernelAccountReturnType,
  'ReadOnlyKernelAccount'
>;

/**
 * Address information including address and private key
 */
export type GeneratedAddressDataV1 = {
  /**
   * Address index (0-based)
   */
  index: AddressIndex;

  /**
   * Address (works across all chains)
   */
  address: EvmAddress;

  secp256k1PublicKeyHash: EvmAddress;

  /**
   * Secp256k1 private key
   * P11TODO: This should be returned encrypted and base64-encoded in the future
   */
  secp256k1PrivateKey: Secp256k1PrivateKeyBytes;

  /**
   * Version of the address
   */
  version: AddressVersion;
};

/**
 * Generate an authorized kernel account client
 *
 * Creates a kernel account with the specified validator and configuration.
 *
 * @param publicClient A viem PublicClient for the chain
 * @param auth The authorized validator (currently only Secp256k1Validator supported)
 * @param kernelVersion The kernel version to use (default: KERNEL_V3_3)
 * @param entryPoint The entry point to use (default: 0.7)
 * @param address Optional account address (for existing accounts)
 * @param factoryIndex CREATE2 index baked into Kernel factory data (must match address derivation)
 * @returns Authorized kernel account containing both account and validator
 *
 * P11TODO: add unit tests for `generateAuthorizedKernelAccount`
 *
 */
export async function generateAuthorizedKernelAccount(
  publicClient: PublicClient,
  auth: KernelAuth,
  kernelVersion: typeof DEFAULT_KERNEL_VERSION = DEFAULT_KERNEL_VERSION,
  entryPoint: typeof DEFAULT_ENTRY_POINT = DEFAULT_ENTRY_POINT,
  address?: EvmAddress,
  factoryIndex: AddressIndex = 0 as AddressIndex
): Promise<AuthorizedKernelAccount> {
  // P11TODO: maybe add extra check that account generation is wanted when address isn't included
  // P11TODO: when address is included, we can do extra checks that the auth matches the account

  // Create validator based on type
  const validator: KernelValidator<string> = await signerToEcdsaValidator(
    publicClient,
    {
      signer: auth.signer,
      entryPoint,
      kernelVersion
    }
  );

  // Create kernel account (this derives the account address)
  const account = await createKernelAccount(publicClient, {
    plugins: {
      sudo: validator
    },
    entryPoint,
    kernelVersion,
    index: BigInt(factoryIndex),
    ...(address && { address })
  });

  return { account, validator };
}

/**
 * Create a stub signer for Secp256k1 public key hash
 *
 * The stub signer has the correct address but throws errors when
 * any signing methods are called, preventing accidental use in
 * operations that require actual signing.
 *
 * P11TODO: Add unit tests for createSecp256k1StubSigner to verify:
 * - Creates signer with correct address
 * - All signing methods (sign, signMessage, signTransaction, signTypedData, signAuthorization) throw appropriate errors
 * - Error messages are correct
 *
 * @param secp256k1PublicKeyHash The Secp256k1 public key hash
 * @returns A stub signer that throws on signing attempts
 */
export function createSecp256k1StubSigner(
  secp256k1PublicKeyHash: EvmAddress
): Secp256k1Signer {
  return toAccount({
    address: secp256k1PublicKeyHash,
    // eslint-disable-next-line @typescript-eslint/require-await
    async sign({ hash: _hash }) {
      throw new Error(
        'sign() should not be called during read-only operations'
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async signAuthorization(_authorization) {
      throw new Error(
        'signAuthorization() should not be called during read-only operations'
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async signMessage({ message: _message }) {
      throw new Error(
        'signMessage() should not be called during read-only operations'
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async signTransaction(_transaction, { serializer: _serializer } = {}) {
      throw new Error(
        'signTransaction() should not be called during read-only operations'
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async signTypedData(_typedData) {
      throw new Error(
        'signTypedData() should not be called during read-only operations'
      );
    }
  });
}

/**
 * Generate a read only kernel account client
 *
 * Uses a stub signer to create a kernel account client for an existing account.
 *
 * @param publicClient A viem PublicClient for the chain
 * @param stubAuth The stub auth configuration with stub signer
 * @param kernelVersion The kernel version to use (default: KERNEL_V3_3)
 * @param entryPoint The entry point to use (default: 0.7)
 * @param address The account address (required for read-only accounts)
 * @param factoryIndex CREATE2 index baked into Kernel factory data (must match address derivation)
 * @returns The kernel account client
 */
export async function generateReadOnlyKernelAccount(
  publicClient: PublicClient,
  stubAuth: KernelStubAuth,
  kernelVersion: typeof DEFAULT_KERNEL_VERSION = DEFAULT_KERNEL_VERSION,
  entryPoint: typeof DEFAULT_ENTRY_POINT = DEFAULT_ENTRY_POINT,
  address: EvmAddress,
  factoryIndex: AddressIndex = 0 as AddressIndex
): Promise<ReadOnlyKernelAccount> {
  // Create stub validator based on type
  const stubValidator: KernelValidator<string> = await signerToEcdsaValidator(
    publicClient,
    {
      signer: stubAuth.stubSigner,
      entryPoint,
      kernelVersion
    }
  );

  return (await createKernelAccount(publicClient, {
    plugins: {
      sudo: stubValidator
    },
    entryPoint,
    kernelVersion,
    index: BigInt(factoryIndex),
    address
  })) as ReadOnlyKernelAccount;
}

/**
 * Generate a single address (V1) from a mnemonic at a specific index.
 *
 * This is the V1 implementation that handles all the derivation logic:
 * - Derives secp256k1 private key using BIP-85
 * - Converts to signer
 * - Computes the KernelV3.3 counterfactual address offline via CREATE2
 *
 * No RPC call is made. The Kernel account address is a deterministic CREATE2
 * computation: given the factory address, the ECDSA validator address, and the
 * signer's EOA address, the result is the same on every EVM chain. The
 * `initCodeHash` stored in `KernelVersionToAddressesMap` captures the proxy
 * creation bytecode hash for the current kernel version, making the full
 * derivation self-contained.
 *
 * @param mnemonic BIP-39 mnemonic phrase (24 words)
 * @param index Address index (0-based)
 * @returns Address data with index, address, private key, and version
 */
export async function generateAddressV1(
  seed: Seed,
  index: AddressIndex
): Promise<GeneratedAddressDataV1> {
  // Step 1: Derive secp256k1 private key for this address
  const secp256k1PrivateKey = deriveSecp256k1PrivateKey(seed, index);
  // Ownership transfers to the caller on success. On any failure path the
  // finally block zeroes the buffer so it never lingers in the heap.
  let transferPrivateKeyOwnershipToCaller = false;

  try {
    // P11TODO private key likely not needed in this `signer`,
    //         as no signing is done here.
    //         public key would likely suffice, but may require
    //         custom `Secp256k1Signer` implementation
    // P11TODO move `signer` into WASM
    // Step 2: Convert private key to signer (EOA address is used as validator input)
    const signer = createPrivateKeyAccount(secp256k1PrivateKey);

    // Step 3: Compute the KernelV3 counterfactual address offline.
    //
    // KernelVersionToAddressesMap["0.3.3"].initCodeHash captures the keccak256
    // of the proxy creation bytecode for Kernel v3.3 (derived from the
    // accountImplementationAddress). Passing it here avoids any eth_call — the
    // address is a pure CREATE2 computation:
    //   keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
    // where salt = keccak256(abi.encode(initializeCalldata, index)).
    const versionData =
      constants.KernelVersionToAddressesMap[DEFAULT_KERNEL_VERSION];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!versionData?.initCodeHash) {
      // Guard against a future SDK version that drops the pre-computed hash for
      // the selected kernel version, or removes the version key entirely.
      // Should never fire for Kernel V3+.
      throw new Error(
        `initCodeHash not available for kernel version ${DEFAULT_KERNEL_VERSION}. ` +
          'Cannot derive EVM address offline.'
      );
    }

    const { initCodeHash } = versionData;

    const kernelAddress = await getKernelAddressFromECDSA({
      entryPoint: DEFAULT_ENTRY_POINT,
      kernelVersion: DEFAULT_KERNEL_VERSION,
      eoaAddress: signer.address,
      index: BigInt(index),
      initCodeHash
    });

    // Step 4: Assemble address object
    transferPrivateKeyOwnershipToCaller = true;
    return {
      index,
      address: kernelAddress,
      secp256k1PublicKeyHash: signer.address,
      secp256k1PrivateKey: secp256k1PrivateKey,
      version: AddressVersion.V1
    };
  } finally {
    if (!transferPrivateKeyOwnershipToCaller) {
      secp256k1PrivateKey.fill(0);
    }
  }
}
