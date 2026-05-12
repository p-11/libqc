import { isAddress } from 'viem';

// Main entry point exports
import { type AddressIndex } from '../../src';

// Internal imports (not exported from main entry point)
import {
  generateAddressesFromSeed,
  generateAddressFromSeed
} from '../../src/addresses';
import { AddressVersion } from '../../src/config';
import { deriveSecp256k1PrivateKey } from '../../src/cryptography';
import { mnemonicToSeedSync } from '@scure/bip39';
import { Seed } from '../../src/types';
import { TEST_SEED } from '../testUtils';

describe('generateAddressFromSeed', () => {
  test('generates valid address at specific index', async () => {
    const address = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    expect(address.index).toBe(0);
    expect(isAddress(address.address)).toBe(true);
    expect(isAddress(address.secp256k1PublicKeyHash)).toBe(true);
    expect(address.secp256k1PrivateKey).toBeInstanceOf(Uint8Array);
    expect(address.secp256k1PrivateKey).toHaveLength(32);
  });

  test('same mnemonic and index produces same address', async () => {
    const address1 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    const address2 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    expect(address1).toEqual(address2);
    expect(address1.address).toBe('0x2D02E0c31958b9074F96FF71B42b416fD2c35675');
    expect(Buffer.from(address1.secp256k1PrivateKey).toString('hex')).toBe(
      '8274cc510999e281f6ff8e90d9cad85f64854b0786e376300ccdc4a236203beb'
    );
  });

  test('different indices produce different addresses', async () => {
    const address0 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    const address1 = await generateAddressFromSeed(
      TEST_SEED,
      1 as AddressIndex,
      AddressVersion.V1
    );

    expect(address0.address).not.toBe(address1.address);
    expect(address0.secp256k1PublicKeyHash).not.toBe(
      address1.secp256k1PublicKeyHash
    );
    expect(address0.secp256k1PrivateKey).not.toEqual(
      address1.secp256k1PrivateKey
    );
  });

  test('throws on negative address index', async () => {
    await expect(
      generateAddressFromSeed(TEST_SEED, -1 as AddressIndex, AddressVersion.V1)
    ).rejects.toThrow(/Invalid index/);
  });

  test('throws on non-integer index', async () => {
    await expect(
      generateAddressFromSeed(TEST_SEED, 1.5 as AddressIndex, AddressVersion.V1)
    ).rejects.toThrow(/Invalid index/);
  });

  test('throws on unsupported address version', async () => {
    const unsupportedVersion = 'V_UNSUPPORTED' as AddressVersion;

    await expect(
      generateAddressFromSeed(TEST_SEED, 0 as AddressIndex, unsupportedVersion)
    ).rejects.toThrow('Unsupported address version');
  });

  test('private key matches cryptography module derivation', async () => {
    const expectedPrivateKey = deriveSecp256k1PrivateKey(
      TEST_SEED,
      3 as AddressIndex
    );
    const address = await generateAddressFromSeed(
      TEST_SEED,
      3 as AddressIndex,
      AddressVersion.V1
    );

    expect(address.secp256k1PrivateKey).toEqual(expectedPrivateKey);
  });

  test('returns correct address version (V1)', async () => {
    const address = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    expect(address.version).toBe(AddressVersion.V1);
  });

  test('address version is consistent across multiple calls with same mnemonic and index', async () => {
    const address1 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    const address2 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    expect(address1.version).toBe(address2.version);
    expect(address1.version).toBe(AddressVersion.V1);
  });

  test('version is consistent across different indices', async () => {
    const address0 = await generateAddressFromSeed(
      TEST_SEED,
      0 as AddressIndex,
      AddressVersion.V1
    );

    const address1 = await generateAddressFromSeed(
      TEST_SEED,
      1 as AddressIndex,
      AddressVersion.V1
    );

    const address5 = await generateAddressFromSeed(
      TEST_SEED,
      5 as AddressIndex,
      AddressVersion.V1
    );

    expect(address0.version).toBe(AddressVersion.V1);
    expect(address1.version).toBe(AddressVersion.V1);
    expect(address5.version).toBe(AddressVersion.V1);
  });
});

describe('generateAddressesFromSeed tests', () => {
  describe('end-to-end address generation', () => {
    test('generates multiple valid addresses', async () => {
      const addresses = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      expect(addresses).toHaveLength(2);
      addresses.forEach((address, idx) => {
        expect(address.index).toBe(idx);
        expect(isAddress(address.address)).toBe(true);
        expect(isAddress(address.secp256k1PublicKeyHash)).toBe(true);
        expect(address.secp256k1PrivateKey).toBeInstanceOf(Uint8Array);
        expect(address.secp256k1PrivateKey).toHaveLength(32);
      });
    });

    test('all addresses have unique addresses and private keys', async () => {
      const addresses = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      const addressesList = addresses.map(a => a.address);
      const publicKeyHashes = addresses.map(a => a.secp256k1PublicKeyHash);
      const privateKeyHexes = addresses.map(a =>
        Buffer.from(a.secp256k1PrivateKey).toString('hex')
      );

      expect(new Set(addressesList).size).toBe(2);
      expect(new Set(publicKeyHashes).size).toBe(2);
      expect(new Set(privateKeyHexes).size).toBe(2);
    });

    test('all addresses have version field set to V1', async () => {
      const addresses = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      expect(addresses).toHaveLength(2);
      addresses.forEach(address => {
        expect(address.version).toBe(AddressVersion.V1);
      });
    });
  });

  describe('determinism', () => {
    test('same mnemonic produces same addresses', async () => {
      const addresses1 = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      const addresses2 = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      // P11TODO double-check that all equality checks in tests are deep checks
      expect(addresses1).toEqual(addresses2);
    });

    test('different mnemonics produce different addresses', async () => {
      const seed1 = Seed.from(
        mnemonicToSeedSync(
          'wisdom monster cabin cabin seat rescue erode curve draft health element hole guilt syrup program project account subject goat defy govern icon rough rubber'
        )
      );
      const seed2 = Seed.from(
        mnemonicToSeedSync(
          'dad promote panel snow ecology execute baby need cram render speak cute exist apple vast spread wheel embark able zone large robust toe evoke'
        )
      );

      const addresses1 = await generateAddressesFromSeed(
        seed1,
        AddressVersion.V1
      );

      const addresses2 = await generateAddressesFromSeed(
        seed2,
        AddressVersion.V1
      );

      // Combine all addresses, public key hashes, and private keys - should have 4 unique values each
      const allAddresses = [
        ...addresses1.map(a => a.address),
        ...addresses2.map(a => a.address)
      ];
      const allPublicKeyHashes = [
        ...addresses1.map(a => a.secp256k1PublicKeyHash),
        ...addresses2.map(a => a.secp256k1PublicKeyHash)
      ];
      const allPrivateKeyHexes = [
        ...addresses1.map(a =>
          Buffer.from(a.secp256k1PrivateKey).toString('hex')
        ),
        ...addresses2.map(a =>
          Buffer.from(a.secp256k1PrivateKey).toString('hex')
        )
      ];

      expect(new Set(allAddresses).size).toBe(4);
      expect(new Set(allPublicKeyHashes).size).toBe(4);
      expect(new Set(allPrivateKeyHexes).size).toBe(4);
    });
  });

  // P11TODO add tests for cross-chain address generation consistency

  describe('error handling', () => {
    test('throws on invalid seed length', async () => {
      await expect(
        generateAddressesFromSeed(
          Seed.from(new Uint8Array(0)),
          AddressVersion.V1
        )
      ).rejects.toThrow(/seed length/i);
    });
  });

  describe('integration between singular and plural', () => {
    test('generateAddressesFromSeed matches multiple generateAddressFromSeed calls', async () => {
      const addressesFromPlural = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      const addressesFromSingular = await Promise.all([
        generateAddressFromSeed(
          TEST_SEED,
          0 as AddressIndex,
          AddressVersion.V1
        ),
        generateAddressFromSeed(TEST_SEED, 1 as AddressIndex, AddressVersion.V1)
      ]);

      expect(addressesFromPlural).toHaveLength(2);
      expect(addressesFromSingular).toHaveLength(2);
      expect(addressesFromPlural).toEqual(addressesFromSingular);
    });
  });

  describe('integration with cryptography layer', () => {
    test('uses correct private keys for address derivation', async () => {
      // Derive private key using cryptography module
      const expectedPrivateKey = deriveSecp256k1PrivateKey(
        TEST_SEED,
        0 as AddressIndex
      );

      // Generate address
      const addresses = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      expect(addresses[0].secp256k1PrivateKey).toEqual(expectedPrivateKey);
    });

    test('private keys match indices correctly', async () => {
      const addresses = await generateAddressesFromSeed(
        TEST_SEED,
        AddressVersion.V1
      );

      addresses.forEach(address => {
        const expectedPrivateKey = deriveSecp256k1PrivateKey(
          TEST_SEED,
          address.index
        );
        expect(address.secp256k1PrivateKey).toEqual(expectedPrivateKey);
      });
    });
  });
});
