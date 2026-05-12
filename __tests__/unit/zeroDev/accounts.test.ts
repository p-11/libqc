import { isAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { AddressVersion } from '../../../src/config';
import {
  generateAddressV1,
  DEFAULT_KERNEL_VERSION
} from '../../../src/zeroDev/accounts';
import type { AddressIndex } from '../../../src/types';
import { TEST_SEED } from '../../testUtils';

/**
 * generateAddressV1 is a pure offline CREATE2 computation — no mocks needed.
 *
 * The pinned Kernel address below was cross-validated against the prior
 * eth_call-based derivation path (createKernelAccount → on-chain resolution)
 * confirming that getKernelAddressFromECDSA produces the identical address
 * for the same (eoaAddress, entryPoint, kernelVersion, index) tuple.
 */

const EXPECTED_KERNEL_ADDRESS = '0x2D02E0c31958b9074F96FF71B42b416fD2c35675';
const EXPECTED_EOA_ADDRESS = '0xAF63d7aD8f14e499097F4E95e9bf55883d93da7E';

describe('generateAddressV1', () => {
  it('returns expected shape', async () => {
    const result = await generateAddressV1(TEST_SEED, 0 as AddressIndex);

    expect(result.index).toBe(0);
    expect(isAddress(result.address)).toBe(true);
    expect(isAddress(result.secp256k1PublicKeyHash)).toBe(true);
    expect(result.secp256k1PrivateKey).toBeInstanceOf(Uint8Array);
    expect(result.secp256k1PrivateKey).toHaveLength(32);
    expect(result.version).toBe(AddressVersion.V1);
  });

  it('produces pinned Kernel address for TEST_SEED at index 0', async () => {
    const result = await generateAddressV1(TEST_SEED, 0 as AddressIndex);

    expect(result.address).toBe(EXPECTED_KERNEL_ADDRESS);
    expect(result.secp256k1PublicKeyHash).toBe(EXPECTED_EOA_ADDRESS);
  });

  it('is deterministic — same seed and index always produces same output', async () => {
    const [r1, r2] = await Promise.all([
      generateAddressV1(TEST_SEED, 0 as AddressIndex),
      generateAddressV1(TEST_SEED, 0 as AddressIndex)
    ]);

    expect(r1.address).toBe(r2.address);
    expect(r1.secp256k1PublicKeyHash).toBe(r2.secp256k1PublicKeyHash);
    expect(r1.secp256k1PrivateKey).toEqual(r2.secp256k1PrivateKey);
  });

  it('produces distinct addresses for distinct indices', async () => {
    const [r0, r1] = await Promise.all([
      generateAddressV1(TEST_SEED, 0 as AddressIndex),
      generateAddressV1(TEST_SEED, 1 as AddressIndex)
    ]);

    expect(r0.address).not.toBe(r1.address);
    expect(r0.secp256k1PublicKeyHash).not.toBe(r1.secp256k1PublicKeyHash);
  });

  it('throws when initCodeHash is absent for the kernel version', async () => {
    const sdkModule = await import('@zerodev/sdk');
    const entry =
      sdkModule.constants.KernelVersionToAddressesMap[DEFAULT_KERNEL_VERSION];
    const originalHash = entry.initCodeHash;

    // Simulate a future SDK that ships a map entry but omits initCodeHash
    Object.defineProperty(entry, 'initCodeHash', {
      value: undefined,
      configurable: true
    });

    await expect(
      generateAddressV1(TEST_SEED, 0 as AddressIndex)
    ).rejects.toThrow('initCodeHash not available');

    Object.defineProperty(entry, 'initCodeHash', {
      value: originalHash,
      configurable: true
    });
  });
});
