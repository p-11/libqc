import { AccountId, ChainId } from 'caip';
import { type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ValidatorType,
  type ValidatorConfig,
  getAuthorizedAccount,
  getReadOnlyAccount
} from '../../src/account';
import type { EvmPersistedAddress } from '../../src/state';
import type { AddressIndex, EvmAddress } from '../../src/types';
import { MockStorage, getTestMnemonic } from '../testUtils';

// Mock the ZeroDev accounts module
vi.mock('../../src/zeroDev/accounts', () => ({
  generateAuthorizedKernelAccount: vi.fn(),
  generateReadOnlyKernelAccount: vi.fn(),
  createSecp256k1StubSigner: vi.fn(),
  DEFAULT_KERNEL_VERSION: 'v3.3',
  DEFAULT_ENTRY_POINT: '0.7'
}));

// Mock viem/accounts
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(),
  toAccount: vi.fn()
}));

// Mock evm/utils
vi.mock('../../src/account/evm/utils', () => ({
  createPrivateKeyAccount: vi.fn()
}));

describe('accounts.ts', () => {
  let mockPublicClient: Partial<PublicClient>;
  let mockPersistedAddress: EvmPersistedAddress;
  let mockValidatorConfig: ValidatorConfig;
  let mockAccountId: AccountId;
  let mockStorage: MockStorage;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock storage with valid mnemonic
    const storageMap = new Map();
    storageMap.set('state', {
      mnemonic: getTestMnemonic(),
      addresses: [
        {
          address: '0x1234567890123456789012345678901234567890',
          index: 0,
          secp256k1PrivateKey: new Uint8Array(32).fill(0xab) as any,
          secp256k1PublicKeyHash: '0xabcdef1234567890abcdef1234567890abcdef12',
          accounts: [],
          version: 'V1'
        }
      ]
    });
    mockStorage = new MockStorage(storageMap);

    mockPublicClient = {
      chain: mainnet
    };

    mockPersistedAddress = {
      chainType: 'evm' as const,
      address: '0x1234567890123456789012345678901234567890' as EvmAddress,
      index: 0 as AddressIndex,
      secp256k1PrivateKey: new Uint8Array(32).fill(0xab) as any,
      secp256k1PublicKeyHash:
        '0xabcdef1234567890abcdef1234567890abcdef12' as EvmAddress,
      accounts: [],
      version: 'V1' as any
    };

    mockValidatorConfig = {
      type: ValidatorType.SECP256k1,
      address: '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57' as any
    };

    mockAccountId = new AccountId({
      chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
      address: mockPersistedAddress.address
    });
  });

  describe('getAuthorizedAccount factory', () => {
    it('creates Secp256k1AuthorizedAccount for SECP256k1 validator', async () => {
      const { generateAuthorizedKernelAccount } = await import(
        '../../src/zeroDev/accounts'
      );
      const { createPrivateKeyAccount } = await import(
        '../../src/account/evm/utils'
      );

      const mockSigner = {
        address: mockPersistedAddress.secp256k1PublicKeyHash,
        signMessage: vi.fn(),
        signTransaction: vi.fn()
      };

      const mockKernelAccount = {
        address: mockPersistedAddress.address,
        encodeCalls: vi.fn()
      };

      vi.mocked(createPrivateKeyAccount).mockReturnValue(mockSigner as any);
      vi.mocked(generateAuthorizedKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const expectedKey = new Uint8Array(
        mockPersistedAddress.secp256k1PrivateKey
      );
      const account = await getAuthorizedAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig,
        mockStorage
      );

      expect(account).toBeDefined();
      expect(account.accountId.address).toBe(mockPersistedAddress.address);
      expect(createPrivateKeyAccount).toHaveBeenCalledWith(expectedKey);
      expect(generateAuthorizedKernelAccount).toHaveBeenCalledWith(
        mockPublicClient,
        expect.objectContaining({
          type: ValidatorType.SECP256k1,
          signer: mockSigner
        }),
        'v3.3',
        '0.7',
        mockPersistedAddress.address,
        mockPersistedAddress.index
      );
    });

    it('returns an object implementing AuthorizedAccount interface', async () => {
      const { generateAuthorizedKernelAccount } = await import(
        '../../src/zeroDev/accounts'
      );
      const { createPrivateKeyAccount } = await import(
        '../../src/account/evm/utils'
      );

      const mockSigner = { address: '0x123', signMessage: vi.fn() };
      const mockKernelAccount = { address: mockPersistedAddress.address };

      vi.mocked(createPrivateKeyAccount).mockReturnValue(mockSigner as any);
      vi.mocked(generateAuthorizedKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const account = await getAuthorizedAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig,
        mockStorage
      );

      // Check interface compliance
      expect(account).toHaveProperty('accountId');
      expect(account.accountId).toHaveProperty('address');
      expect(account).toHaveProperty('getAuthorizedKernelAccount');
      expect(typeof account.getAuthorizedKernelAccount).toBe('function');
    });

    it('getAuthorizedKernelAccount returns the kernel account', async () => {
      const { generateAuthorizedKernelAccount } = await import(
        '../../src/zeroDev/accounts'
      );
      const { createPrivateKeyAccount } = await import(
        '../../src/account/evm/utils'
      );

      const mockSigner = { address: '0x123' };
      const mockKernelAccount = {
        address: mockPersistedAddress.address,
        someMethod: vi.fn()
      };

      vi.mocked(createPrivateKeyAccount).mockReturnValue(mockSigner as any);
      vi.mocked(generateAuthorizedKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const account = await getAuthorizedAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig,
        mockStorage
      );

      const kernelAccount = account.getAuthorizedKernelAccount();
      expect(kernelAccount).toBe(mockKernelAccount);
    });
  });

  describe('getReadOnlyAccount factory', () => {
    it('creates Secp256k1ReadOnlyAccount for SECP256k1 validator', async () => {
      const { generateReadOnlyKernelAccount, createSecp256k1StubSigner } =
        await import('../../src/zeroDev/accounts');

      const mockStubSigner = {
        address: mockPersistedAddress.secp256k1PublicKeyHash,
        sign: vi.fn(),
        signMessage: vi.fn()
      };

      const mockKernelAccount = {
        address: mockPersistedAddress.address,
        encodeCalls: vi.fn()
      };

      vi.mocked(createSecp256k1StubSigner).mockReturnValue(
        mockStubSigner as any
      );
      vi.mocked(generateReadOnlyKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const account = await getReadOnlyAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig
      );

      expect(account).toBeDefined();
      expect(account.accountId.address).toBe(mockPersistedAddress.address);
      expect(createSecp256k1StubSigner).toHaveBeenCalledWith(
        mockPersistedAddress.secp256k1PublicKeyHash
      );
      expect(generateReadOnlyKernelAccount).toHaveBeenCalledWith(
        mockPublicClient,
        expect.objectContaining({
          type: ValidatorType.SECP256k1,
          stubSigner: mockStubSigner
        }),
        'v3.3',
        '0.7',
        mockPersistedAddress.address,
        mockPersistedAddress.index
      );
    });

    it('returns an object implementing ReadOnlyAccount interface', async () => {
      const { generateReadOnlyKernelAccount, createSecp256k1StubSigner } =
        await import('../../src/zeroDev/accounts');

      const mockStubSigner = { address: '0x123' };
      const mockKernelAccount = { address: mockPersistedAddress.address };

      vi.mocked(createSecp256k1StubSigner).mockReturnValue(
        mockStubSigner as any
      );
      vi.mocked(generateReadOnlyKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const account = await getReadOnlyAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig
      );

      // Check interface compliance
      expect(account).toHaveProperty('accountId');
      expect(account.accountId).toHaveProperty('address');
      expect(account).toHaveProperty('getReadOnlyKernelAccount');
      expect(typeof account.getReadOnlyKernelAccount).toBe('function');
    });

    it('getReadOnlyKernelAccount returns the kernel account', async () => {
      const { generateReadOnlyKernelAccount, createSecp256k1StubSigner } =
        await import('../../src/zeroDev/accounts');

      const mockStubSigner = { address: '0x123' };
      const mockKernelAccount = {
        address: mockPersistedAddress.address,
        someMethod: vi.fn()
      };

      vi.mocked(createSecp256k1StubSigner).mockReturnValue(
        mockStubSigner as any
      );
      vi.mocked(generateReadOnlyKernelAccount).mockResolvedValue(
        mockKernelAccount as any
      );

      const account = await getReadOnlyAccount(
        mockPublicClient as PublicClient,
        mockAccountId,
        mockPersistedAddress,
        mockValidatorConfig
      );

      const kernelAccount = account.getReadOnlyKernelAccount();
      expect(kernelAccount).toBe(mockKernelAccount);
    });
  });
});
