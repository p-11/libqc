import { AccountId, ChainId } from 'caip';
import type { Address, Hex, PublicClient } from 'viem';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the ZeroDev accountConfig module
vi.mock('../../src/zeroDev/accountConfig', async () => {
  const actual = await vi.importActual('../../src/zeroDev/accountConfig');
  return {
    ...actual,
    setKernelValidator: vi.fn()
  };
});

// Main entry point exports
import { type ValidatorAddress } from '../../src';

// Internal imports (not exported from main entry point)
import {
  createValidatorConfig,
  getAccountConfig,
  getDefaultValidatorConfigForVersion,
  ValidatorType
} from '../../src/account';
import {
  AddressVersion,
  CURRENT_DEFAULT_ADDRESS_VERSION,
  SECP256K1_VALIDATOR_ADDRESS
} from '../../src/config';
import type { EvmReadOnlyChainClients } from '../../src/publicClients';

type MockPublicClient = Pick<PublicClient, 'getCode' | 'readContract'>;

type MockReadOnlyChainClients = Pick<EvmReadOnlyChainClients, 'getByChainId'>;

describe('getAccountConfig', () => {
  let mockPublicClient: MockPublicClient;
  let readOnlyChainClients: MockReadOnlyChainClients;

  const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
  const accountAddress =
    '0x1111111111111111111111111111111111111111' as Address;
  const accountId = new AccountId({ chainId, address: accountAddress });

  function makeRootValidatorBytes(address: ValidatorAddress): Hex {
    const body = address.toLowerCase().replace(/^0x/, '');
    const head = '01';
    return `0x${head}${body}` as Hex;
  }

  beforeEach(() => {
    mockPublicClient = {
      getCode: vi.fn(),
      readContract: vi.fn()
    };

    readOnlyChainClients = {
      getByChainId: vi.fn(() => mockPublicClient as PublicClient)
    };
  });

  describe('when account is not deployed', () => {
    test('returns default validator config for the current default address version', async () => {
      (mockPublicClient.getCode as ReturnType<typeof vi.fn>).mockResolvedValue(
        '0x'
      );

      const publicClient = readOnlyChainClients.getByChainId(chainId);

      const config = await getAccountConfig(
        accountId,
        publicClient,
        CURRENT_DEFAULT_ADDRESS_VERSION
      );
      expect(publicClient.getCode).toHaveBeenCalledWith({
        address: accountAddress
      });
      expect(mockPublicClient.readContract).not.toHaveBeenCalled();
      expect(config.id.toString()).toBe(accountId.toString());

      switch (CURRENT_DEFAULT_ADDRESS_VERSION) {
        // If the default version is V1, assert the expected default validator.
        case AddressVersion.V1:
          expect(config.validatorConfig.type).toBe(ValidatorType.SECP256k1);
          expect(config.validatorConfig.address).toBe(
            SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
          );
          break;
        default:
          // P11TODO: Future-proof guard:
          // If we introduce a new default version, this test must be updated
          throw new Error(
            `Unhandled CURRENT_DEFAULT_ADDRESS_VERSION in test: ${CURRENT_DEFAULT_ADDRESS_VERSION as string}.`
          );
      }
    });

    test('treats missing code as not deployed and uses default validator config', async () => {
      const publicClient = readOnlyChainClients.getByChainId(chainId);

      const config = await getAccountConfig(
        accountId,
        publicClient,
        CURRENT_DEFAULT_ADDRESS_VERSION
      );

      expect(publicClient.getCode).toHaveBeenCalledWith({
        address: accountAddress
      });
      expect(mockPublicClient.readContract).not.toHaveBeenCalled();
      expect(config.id.toString()).toBe(accountId.toString());
      expect(config.validatorConfig.type).toBe(ValidatorType.SECP256k1);
      expect(config.validatorConfig.address).toBe(
        SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
      );
    });
  });

  describe('when account is deployed with a known validator', () => {
    test('returns secp256k1 validator config when rootValidator encodes the secp256k1 validator address', async () => {
      (mockPublicClient.getCode as ReturnType<typeof vi.fn>).mockResolvedValue(
        '0x6000'
      );
      (
        mockPublicClient.readContract as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeRootValidatorBytes(
          SECP256K1_VALIDATOR_ADDRESS.toLowerCase() as ValidatorAddress
        )
      );

      const publicClient = readOnlyChainClients.getByChainId(chainId);

      const config = await getAccountConfig(
        accountId,
        publicClient,
        AddressVersion.V1
      );

      expect(publicClient.getCode).toHaveBeenCalledWith({
        address: accountAddress
      });
      expect(mockPublicClient.getCode).toHaveBeenCalledWith({
        address: accountAddress
      });
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: accountAddress,
          functionName: 'rootValidator'
        })
      );

      expect(config.id.toString()).toBe(accountId.toString());
      expect(config.validatorConfig.type).toBe(ValidatorType.SECP256k1);
      expect(config.validatorConfig.address).toBe(
        SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
      );
    });
  });

  describe('error handling', () => {
    test('throws when rootValidator encodes an unknown validator address', async () => {
      (mockPublicClient.getCode as ReturnType<typeof vi.fn>).mockResolvedValue(
        '0x6000'
      );

      const unknownValidatorAddress =
        '0x9999999999999999999999999999999999999999' as ValidatorAddress;

      (
        mockPublicClient.readContract as ReturnType<typeof vi.fn>
      ).mockResolvedValue(makeRootValidatorBytes(unknownValidatorAddress));

      const publicClient = readOnlyChainClients.getByChainId(chainId);

      await expect(
        getAccountConfig(accountId, publicClient, AddressVersion.V1)
      ).rejects.toThrow(/Unknown validator address/);
      expect(publicClient.getCode).toHaveBeenCalledWith({
        address: accountAddress
      });
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: accountAddress,
          functionName: 'rootValidator'
        })
      );
    });
  });

  describe('integration with chain clients', () => {
    test('routes by chain id and uses the public client returned by readOnlyChainClients', async () => {
      const otherChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const otherAccountId = new AccountId({
        chainId: otherChainId,
        address: accountAddress
      });

      (mockPublicClient.getCode as ReturnType<typeof vi.fn>).mockResolvedValue(
        '0x6000'
      );
      (
        mockPublicClient.readContract as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeRootValidatorBytes(
          SECP256K1_VALIDATOR_ADDRESS.toLowerCase() as ValidatorAddress
        )
      );

      const publicClient = readOnlyChainClients.getByChainId(otherChainId);
      const otherAccountAddress = otherAccountId.address as Address;
      await getAccountConfig(otherAccountId, publicClient, AddressVersion.V1);

      expect(publicClient.getCode).toHaveBeenCalledWith({
        address: otherAccountId.address
      });
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: otherAccountAddress,
          functionName: 'rootValidator'
        })
      );
    });
  });

  describe('default validator config by version', () => {
    test('returns default config for supported version', () => {
      const config = getDefaultValidatorConfigForVersion(AddressVersion.V1);

      expect(config.type).toBe(ValidatorType.SECP256k1);
      expect(config.address).toBe(
        SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
      );
    });

    test('throws on unsupported address version', () => {
      const unsupportedVersion = 'V_UNSUPPORTED' as AddressVersion;

      expect(() => {
        getDefaultValidatorConfigForVersion(unsupportedVersion);
      }).toThrow('Unsupported address version');
    });
  });

  describe('defensive behavior for unsupported default address versions', () => {
    test('throws when CURRENT_DEFAULT_ADDRESS_VERSION has no default validator config', async () => {
      // Make sure we get a fresh module instance with our mock applied
      vi.resetModules();

      vi.doMock('../../src/config', async () => {
        const actual =
          await vi.importActual<typeof import('../../src/config')>(
            '../../src/config'
          );

        const unsupportedVersion = 'UNSUPPORTED_VERSION' as AddressVersion;

        return {
          ...actual,
          CURRENT_DEFAULT_ADDRESS_VERSION: unsupportedVersion
        };
      });

      // Import after mocking so this instance sees the unsupported version
      const { getAccountConfig: getAccountConfigWithMockedVersion } =
        await import('../../src/account/evm/config');

      const mockPublicClientUnsupported: MockPublicClient = {
        getCode: vi.fn().mockResolvedValue('0x'),
        readContract: vi.fn()
      };

      const readOnlyChainClientsUnsupported: MockReadOnlyChainClients = {
        getByChainId: vi.fn(
          () => mockPublicClientUnsupported as unknown as PublicClient
        )
      };

      const chainIdUnsupported = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const accountAddressUnsupported =
        '0x2222222222222222222222222222222222222222' as Address;
      const accountIdUnsupported = new AccountId({
        chainId: chainIdUnsupported,
        address: accountAddressUnsupported
      });

      const publicClientUnsupported =
        readOnlyChainClientsUnsupported.getByChainId(chainIdUnsupported);

      await expect(
        getAccountConfigWithMockedVersion(
          accountIdUnsupported,
          publicClientUnsupported,
          'UNSUPPORTED_VERSION' as AddressVersion
        )
      ).rejects.toThrow(/Unsupported address version/);
      expect(publicClientUnsupported.getCode).toHaveBeenCalledWith({
        address: accountIdUnsupported.address
      });
      expect(mockPublicClientUnsupported.readContract).not.toHaveBeenCalled();
    });
  });
});

describe('createValidatorConfig', () => {
  test('creates Secp256k1 validator config', () => {
    const config = createValidatorConfig(ValidatorType.SECP256k1);

    expect(config.type).toBe(ValidatorType.SECP256k1);
    expect(config.address).toBe(
      SECP256K1_VALIDATOR_ADDRESS as ValidatorAddress
    );
  });
});
