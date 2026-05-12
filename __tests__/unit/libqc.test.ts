/**
 * Unit tests for LibQC local operations (no network required)
 *
 * These tests verify LibQC functionality that doesn't require network access:
 * - Mnemonic generation and validation
 * - State management (clear, persistence)
 * - Asset management (add, remove, list tokens)
 * - Address version persistence
 * - Lock/unlock lifecycle
 */

import { wordlist } from '@scure/bip39/wordlists/english.js';
import { AccountId, ChainId } from 'caip';
import { type PublicClient } from 'viem';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Main entry point exports
import {
  ForceNewAddress,
  LibQC,
  Mnemonic,
  type MnemonicGuess,
  MnemonicIndex,
  MnemonicWord,
  type BundlerConfigProvider,
  type RpcUrl,
  type Symbol,
  VaultLockedError,
  type BitcoinActivity,
  toChain
} from '../../src';

// Internal imports (not exported from main entry point)
import { getAssetBySymbol } from '../../src/assets';
import { BitcoinAccountClient } from '../../src/account';
import { EsploraBitcoinApi } from '../../src/account/bitcoin/esplora';
import { MNEMONIC_STRENGTH } from '../../src/config';
import { validateMnemonic } from '../../src/cryptography';
import { getLibQCState, STATE_SEGMENT_KEYS } from '../../src/state';
import { setStateSegment } from '../../src/state';
import type { WithdrawalRecord } from '../../src/types';
import {
  captureGeneratedMnemonic,
  createBitcoinChainSpec,
  createBitcoinTestnetChainSpec,
  createTypedChain,
  MockStorage,
  createBareTestLibQC,
  createNoDiscoveryChainSpec,
  createTestChains,
  createTestLibQC,
  getTestPassword,
  mockGenerateAddressFromSeed,
  TEST_FAST_SCRYPT_PARAMS,
  withCryptoOverride
} from '../testUtils';

describe('LibQC Local Operations', () => {
  beforeEach(() => {
    mockGenerateAddressFromSeed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateMnemonic', () => {
    test('generates a valid mnemonic', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(mnemonic => {
        expect(mnemonic).toBeDefined();
        expect(mnemonic).toBeInstanceOf(Uint8Array);
        expect(() => validateMnemonic(mnemonic)).not.toThrow();
      });
    });

    test('generates a 24-word mnemonic for 256-bit strength', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(mnemonic => {
        const words = new TextDecoder().decode(mnemonic).split(' ');
        // 256-bit strength generates 24 words
        expect(words).toHaveLength(24);
      });
    });

    test('entropy and seed are stored encrypted (not plaintext)', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(async mnemonic => {
        const mnemonicWords = new TextDecoder().decode(mnemonic).split(' ');

        // 1. Check entropy is encrypted
        const rawEntropy =
          await storage.get<Record<string, unknown>>('state.entropy');
        expect(rawEntropy).toBeDefined();
        expect(rawEntropy).toHaveProperty('data');
        expect(rawEntropy).toHaveProperty('iv');

        // 2. Check seed is encrypted
        const rawSeed =
          await storage.get<Record<string, unknown>>('state.seed');
        expect(rawSeed).toBeDefined();
        expect(rawSeed).toHaveProperty('data');
        expect(rawSeed).toHaveProperty('iv');

        // 3. Sanity check: no mnemonic word should appear in the ciphertext
        const entropyCiphertext = (rawEntropy as { data: string }).data;
        const seedCiphertext = (rawSeed as { data: string }).data;

        for (const word of mnemonicWords) {
          expect(entropyCiphertext).not.toContain(word);
          expect(seedCiphertext).not.toContain(word);
        }
      });
    });

    test('throws error if mnemonic already exists in storage', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Generate first mnemonic
      await vault.generateMnemonic(() => true);

      // Attempt to generate second mnemonic should throw
      await expect(vault.generateMnemonic(() => true)).rejects.toThrow(
        'Seed or entropy already exists in storage'
      );
    });

    test('all words are from the BIP39 English wordlist', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(mnemonic => {
        const words = new TextDecoder().decode(mnemonic).split(' ');
        const wordlistSet = new Set(wordlist);

        words.forEach(word => {
          expect(wordlistSet.has(word)).toBe(true);
        });
      });
    });

    test('generated mnemonic contains no extra whitespace', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(mnemonic => {
        const mnemonicString = new TextDecoder().decode(mnemonic);
        expect(mnemonicString).not.toMatch(/\s{2,}/); // No multiple spaces
        expect(mnemonicString).not.toMatch(/^\s/); // No leading whitespace
        expect(mnemonicString).not.toMatch(/\s$/); // No trailing whitespace
      });
    });

    test('uses correct MNEMONIC_STRENGTH constant', () => {
      // Verify the constant is set correctly for 24-word mnemonics
      expect(MNEMONIC_STRENGTH).toBe(256);
    });

    test('different storage instances generate unique mnemonics', async () => {
      const storage1 = new MockStorage(new Map());
      const storage2 = new MockStorage(new Map());
      const storage3 = new MockStorage(new Map());

      const { vault: vault1 } = await createTestLibQC(storage1);
      const { vault: vault2 } = await createTestLibQC(storage2);
      const { vault: vault3 } = await createTestLibQC(storage3);

      const mnemonic1 = await vault1.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );
      const mnemonic2 = await vault2.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );
      const mnemonic3 = await vault3.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );

      expect(mnemonic1).not.toStrictEqual(mnemonic2);
      expect(mnemonic2).not.toStrictEqual(mnemonic3);
      expect(mnemonic1).not.toStrictEqual(mnemonic3);
    });

    test('generated mnemonic words are lowercase', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(mnemonic => {
        const words = new TextDecoder().decode(mnemonic).split(' ');
        words.forEach(word => {
          expect(word).toBe(word.toLowerCase());
        });
      });
    });

    test('mnemonic is usable after encryption round-trip', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Generate mnemonic (which encrypts and stores it)
      await vault.generateMnemonic(() => true);

      // Get a test chain ID
      const testChains = createTestChains();
      const chainId = testChains[0].chainId;

      // This internally calls getMnemonic which decrypts
      const account = await vault.createAccount(chainId);

      expect(account).toBeDefined();
      expect(account.getId()).toBeDefined();
    });

    test('mnemonic persists across LibQC instances with same storage', async () => {
      const storage = new MockStorage(new Map());

      // Generate mnemonic in first instance
      const { vault: vault1 } = await createTestLibQC(storage);
      const words = await vault1.generateMnemonic(mnemonic =>
        new TextDecoder().decode(mnemonic).split(' ')
      );

      // Create new instance with same storage and unlock
      const vault2 = createBareTestLibQC(storage);
      await vault2.unlock(getTestPassword());

      // Verify mnemonic can be validated in new instance
      const guesses = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[2]),
          index: MnemonicIndex.from(2)
        },
        {
          word: MnemonicWord.from(words[3]),
          index: MnemonicIndex.from(3)
        }
      ];

      const isValid = await vault2.validateMnemonic(guesses);
      expect(isValid).toBe(true);
    });

    test('does not throw when state is cleared and mnemonic is regenerated', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Generate first mnemonic
      const mnemonic1 = await vault.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );
      expect(mnemonic1).toBeDefined();

      // Clear state (erases the vault)
      await vault.clearState();

      // Need to set password again since vault was destroyed
      await vault.setPassword(getTestPassword());

      const mnemonic2 = await vault.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );
      expect(mnemonic2).toBeDefined();
      expect(mnemonic2).not.toStrictEqual(mnemonic1);
    });

    test('entropy and seed persist in storage after generation', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      const mnemonic = await vault.generateMnemonic(m =>
        Mnemonic.from(new Uint8Array(m))
      );

      // Check state has the mnemonic (as entropy) and the seed
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.entropy).toBeDefined();
      expect(state.entropy!.length).toBe(32);
      expect(state.seed).toBeDefined();
      expect(state.seed!.length).toBe(64);

      // Verify that reconstructing mnemonic from entropy matches the original
      const reconstructedMnemonic = await vault.exportMnemonic(
        getTestPassword(),
        exportedMnemonic => Mnemonic.from(new Uint8Array(exportedMnemonic))
      );
      expect(reconstructedMnemonic).toStrictEqual(mnemonic);
    });

    test('throws VaultLockedError when vault is locked', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      vault.lock();

      await expect(vault.generateMnemonic(() => true)).rejects.toThrow(
        VaultLockedError
      );
    });

    test('fails when crypto.getRandomValues is unavailable', async () => {
      const storage = new MockStorage(new Map());
      const vault = createBareTestLibQC(storage);
      await vault.setPassword(getTestPassword());

      // Keep crypto.subtle so getLibQCState can decrypt state,
      // but remove getRandomValues so @scure/bip39's entropy call fails.
      await withCryptoOverride(
        { subtle: globalThis.crypto.subtle } as Crypto,
        async () => {
          await expect(vault.generateMnemonic(() => true)).rejects.toThrow(
            /getRandomValues/i
          );
        }
      );
    });
  });

  describe('exportMnemonic', () => {
    test('supports scoped callback export and returns the callback result', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const generatedMnemonic = await captureGeneratedMnemonic(vault);

      const wordCount = await vault.exportMnemonic(
        getTestPassword(),
        exportedMnemonic => {
          expect(exportedMnemonic).toBeInstanceOf(Uint8Array);
          expect(exportedMnemonic).toStrictEqual(generatedMnemonic);
          return new TextDecoder().decode(exportedMnemonic).split(' ').length;
        }
      );

      expect(wordCount).toBe(24);
      generatedMnemonic.fill(0);
    });

    test('propagates callback errors from scoped mnemonic export', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const generatedMnemonic = await captureGeneratedMnemonic(vault);

      await expect(
        vault.exportMnemonic(getTestPassword(), () => {
          throw new Error('export callback failed');
        })
      ).rejects.toThrow('export callback failed');

      generatedMnemonic.fill(0);
    });
  });

  describe('wallet import', () => {
    const VALID_24_WORD =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

    let storage: MockStorage;
    let vault: LibQC;

    beforeEach(() => {
      storage = new MockStorage(new Map());
      vault = createBareTestLibQC(storage);
    });

    test('loads HTTP signing before discovery when signed RPC is enabled', async () => {
      const chain = createTypedChain({
        chainId: 1,
        name: 'Ethereum stub',
        network: 'testnet',
        iconUrl: 'https://example.com/eth.png',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: true,
        rpcUrls: ['https://rpc.example/v1']
      });
      const bundlerConfigProvider: BundlerConfigProvider = () => ({
        chain: toChain(chain),
        urls: ['https://bundler.example'] as RpcUrl[],
        headers: {}
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes('/v1/keys')) {
            return new Response(JSON.stringify({ key_id: 'test-key-id' }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            });
          }
          return new Response('unexpected fetch in test', { status: 500 });
        }
      );

      const signedVault = new LibQC(
        storage,
        [chain],
        bundlerConfigProvider,
        TEST_FAST_SCRYPT_PARAMS,
        { registerUrl: 'https://register.example/' }
      );

      type PublicClientRegistry = {
        getByChainId: (chainId: ChainId) => PublicClient;
      };
      vi.spyOn(
        (
          signedVault as unknown as {
            publicClientRegistry: PublicClientRegistry;
          }
        ).publicClientRegistry,
        'getByChainId'
      ).mockImplementation(() => {
        return {
          chain: {
            id: 1,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
          },
          getCode: vi.fn().mockResolvedValue('0x')
        } as unknown as PublicClient;
      });

      await signedVault.importWallet(
        Mnemonic.from(new TextEncoder().encode(VALID_24_WORD)),
        getTestPassword()
      );

      const ref = (
        signedVault as unknown as {
          httpSigningTransportRef: {
            vaultUnlocked: boolean;
            credentials: { keyId: string } | undefined;
          };
        }
      ).httpSigningTransportRef;
      expect(ref.vaultUnlocked).toBe(true);
      expect(ref.credentials?.keyId).toBe('test-key-id');
    });

    test('imports a valid 24-word mnemonic and discovers all exposed accounts plus first clean account for all supported chains', async () => {
      // Mock getCode (EVM) and getActivities (BTC) to simulate discovery
      // Simulate that indices 0 and 1 are exposed, and index 2 is clean.
      const getCodeSpy = vi.spyOn(
        (vault as any).publicClientRegistry,
        'getByChainId'
      );
      const btcActivitiesSpy = vi.spyOn(
        EsploraBitcoinApi.prototype,
        'getActivities'
      );

      const evmExposedWallets = new Set<string>();

      // EVM: Return code only for the first two addresses (shared across chains)
      getCodeSpy.mockImplementation((...args: any[]) => {
        const chainId = args[0] as ChainId;

        return {
          chain: {
            id: Number(chainId.reference),
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
          },
          getCode: vi.fn().mockImplementation(async (params: any) => {
            const addr = (params.address as string).toLowerCase();

            // EntryPoint or system addresses often start with 0x000
            if (addr.startsWith('0x000')) return '0x123';

            if (evmExposedWallets.has(addr)) return '0x123';

            if (evmExposedWallets.size < 2) {
              evmExposedWallets.add(addr);
              return '0x123';
            }
            return '0x';
          })
        } as unknown as PublicClient;
      });

      let btcCallCount = 0;
      // BTC: Return activities only for the first two addresses
      btcActivitiesSpy.mockImplementation(async (address: string) => {
        btcCallCount++;
        return (
          btcCallCount <= 2
            ? ([
                {
                  type: 'BitcoinTransaction' as any,
                  data: { from: [address] }
                } as any
              ] as unknown)
            : ([] as unknown)
        ) as BitcoinActivity[];
      });

      await vault.importWallet(
        Mnemonic.from(new TextEncoder().encode(VALID_24_WORD)),
        getTestPassword()
      );

      expect(vault.isUnlocked()).toBe(true);
      const encryptionKey = (vault as any).encryptionKey;
      const state = await getLibQCState(storage, encryptionKey);

      const accounts = await vault.listAccounts();
      // Discovery should now include indices 0, 1 (exposed) AND index 2 (clean)
      // For each of the 3 chains (ETH, Base, BTC) -> 3 * 3 = 9 accounts
      expect(accounts).toHaveLength(9);

      // We should have 6 address entries in state (3 indices for EVM, 3 for BTC)
      expect(state.addresses).toHaveLength(6);

      // Check indices are correct (0, 1, 2 for both EVM and BTC)
      const evmIndices = state.addresses
        .filter(a => a.chainType === 'evm')
        .map(a => a.index)
        .sort();
      const btcIndices = state.addresses
        .filter(a => a.chainType === 'bitcoin')
        .map(a => a.index)
        .sort();

      expect(evmIndices).toEqual([0, 1, 2]);
      expect(btcIndices).toEqual([0, 1, 2]);

      getCodeSpy.mockRestore();
      btcActivitiesSpy.mockRestore();
    });

    test('rejects 12-word mnemonics during import', async () => {
      const VALID_12_WORD =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      await expect(
        vault.importWallet(
          Mnemonic.from(new TextEncoder().encode(VALID_12_WORD)),
          getTestPassword()
        )
      ).rejects.toThrow(/only supports 24-word mnemonics/);
    });

    test('normalizes mnemonic before storing it during import', async () => {
      const mixedCaseMnemonic =
        '  ABANDON abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ART  ';

      // Use a no-discovery vault — chains are irrelevant to normalization, and
      // discovery would make real network calls (Bitcoin Esplora) in a unit test.
      const noDiscoveryVault = createBareTestLibQC(storage, undefined, [
        createNoDiscoveryChainSpec()
      ]);
      await noDiscoveryVault.importWallet(
        Mnemonic.from(new TextEncoder().encode(mixedCaseMnemonic)),
        getTestPassword()
      );

      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from('abandon'),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from('abandon'),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from('abandon'),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from('art'),
          index: MnemonicIndex.from(23)
        }
      ];

      expect(await noDiscoveryVault.validateMnemonic(guesses)).toBe(true);
    });

    test('rejects 12-word mnemonics during import', async () => {
      const VALID_12_WORD =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      await expect(
        vault.importWallet(
          Mnemonic.from(new TextEncoder().encode(VALID_12_WORD)),
          getTestPassword()
        )
      ).rejects.toThrow(/only supports 24-word mnemonics/);
    });

    test('rejects import when vault already exists', async () => {
      await vault.setPassword(getTestPassword());
      await vault.generateMnemonic(() => true);

      await expect(
        vault.importWallet(
          Mnemonic.from(new TextEncoder().encode(VALID_24_WORD)),
          getTestPassword()
        )
      ).rejects.toThrow(/Seed or entropy already exists/);
    });
  });

  describe('validateMnemonic', () => {
    test('static validator returns the mnemonic for a valid 24-word mnemonic', () => {
      const validMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

      expect(
        LibQC.validateMnemonic(new TextEncoder().encode(validMnemonic))
      ).toStrictEqual(Mnemonic.from(new TextEncoder().encode(validMnemonic)));
    });

    test('static validator throws for any 12-token mnemonic format', () => {
      const twelveWordMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

      expect(() =>
        LibQC.validateMnemonic(new TextEncoder().encode(twelveWordMnemonic))
      ).toThrow(/only supports 24-word mnemonics/);
    });

    test('static validator throws for a 24-word mnemonic with invalid checksum', () => {
      const invalidChecksum =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

      expect(() =>
        LibQC.validateMnemonic(new TextEncoder().encode(invalidChecksum))
      ).toThrow(/checksum failed/);
    });

    test('returns true when all guesses match the mnemonic', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[22]),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from(words[23]),
          index: MnemonicIndex.from(23)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(true);
    });

    test('returns false when a guess does not match', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from('wrongword'),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from(words[23]),
          index: MnemonicIndex.from(23)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });

    test('returns false when a guess has wrong index', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[2]),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from(words[23]),
          index: MnemonicIndex.from(23)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });

    test('throws error if fewer than 4 guesses are supplied', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from('word1'),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from('word2'),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from('word3'),
          index: MnemonicIndex.from(2)
        }
        // Only 3 guesses, need at least 4
      ];

      await expect(vault.validateMnemonic(guesses)).rejects.toThrow(
        'At least 4 guesses are required, but only 3 were provided'
      );
    });

    test('throws error if no guesses are supplied', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      await expect(vault.validateMnemonic([])).rejects.toThrow(
        'At least 4 guesses are required, but only 0 were provided'
      );
    });

    test('throws error if mnemonic is not found in storage', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      // Don't generate mnemonic

      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from('word1'),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from('word2'),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from('word3'),
          index: MnemonicIndex.from(2)
        },
        {
          word: MnemonicWord.from('word4'),
          index: MnemonicIndex.from(3)
        }
      ];

      await expect(vault.validateMnemonic(guesses)).rejects.toThrow(
        'Seed not found in storage'
      );
    });

    test('works with more than 4 guesses', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[5]),
          index: MnemonicIndex.from(5)
        },
        {
          word: MnemonicWord.from(words[10]),
          index: MnemonicIndex.from(10)
        },
        {
          word: MnemonicWord.from(words[15]),
          index: MnemonicIndex.from(15)
        },
        {
          word: MnemonicWord.from(words[20]),
          index: MnemonicIndex.from(20)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(true);
    });

    test('returns false when multiple guesses are wrong', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from('wrong1'),
          index: MnemonicIndex.from(0)
        }, // Wrong
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from('wrong2'),
          index: MnemonicIndex.from(2)
        }, // Wrong
        {
          word: MnemonicWord.from(words[3]),
          index: MnemonicIndex.from(3)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });

    test('returns false when index is out of bounds (too high)', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[22]),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from('word'),
          index: MnemonicIndex.from(99)
        } // Out of bounds
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });

    test('returns false when index is out of bounds (negative)', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(words[0]),
          index: MnemonicIndex.from(0)
        },
        {
          word: MnemonicWord.from(words[1]),
          index: MnemonicIndex.from(1)
        },
        {
          word: MnemonicWord.from(words[22]),
          index: MnemonicIndex.from(22)
        },
        {
          word: MnemonicWord.from('word'),
          index: MnemonicIndex.from(-1)
        } // Out of bounds
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });

    test('returns false when mnemonic guesses have whitespace', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const words = new TextDecoder().decode(mnemonic).split(' ');
      const guesses: MnemonicGuess[] = [
        {
          word: MnemonicWord.from(` ${words[0]} `),
          index: MnemonicIndex.from(0)
        }, // Leading and trailing spaces
        {
          word: MnemonicWord.from(` ${words[1]}`),
          index: MnemonicIndex.from(1)
        }, // Leading space
        {
          word: MnemonicWord.from(`${words[22]} `),
          index: MnemonicIndex.from(22)
        }, // Trailing space
        {
          word: MnemonicWord.from(words[23]),
          index: MnemonicIndex.from(23)
        }
      ];

      const result = await vault.validateMnemonic(guesses);
      expect(result).toBe(false);
    });
  });

  describe('Asset Management', () => {
    test('adds and lists assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Initially no assets
      let assets = await vault.listAssets();
      expect(assets).toHaveLength(0);

      // Add USDC
      const addedUsdc = await vault.addToken('USDC' as Symbol);
      assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe(addedUsdc.id);

      // Add USDT
      const addedUsdt = await vault.addToken('USDT' as Symbol);
      assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.some(a => a.id === addedUsdc.id)).toBe(true);
      expect(assets.some(a => a.id === addedUsdt.id)).toBe(true);
    });

    test('removes assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const addedAsset1 = await vault.addToken('USDC' as Symbol);
      const addedAsset2 = await vault.addToken('USDT' as Symbol);
      const addedAsset3 = await vault.addToken('DAI' as Symbol);

      let assets = await vault.listAssets();
      expect(assets).toHaveLength(3);

      // Remove middle asset
      await vault.removeToken(addedAsset2);
      assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets).toContainEqual(addedAsset1);
      expect(assets).toContainEqual(addedAsset3);
      expect(assets).not.toContainEqual(addedAsset2);
    });

    test('prevents duplicate asset additions', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);

      // Attempt to add same asset again
      await expect(vault.addToken('USDC' as Symbol)).rejects.toThrow(
        'already tracked'
      );

      // Verify only one asset exists
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
    });

    test('assets persist with mnemonic and accounts', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Generate mnemonic
      await captureGeneratedMnemonic(vault);

      // Create account - this will auto-add native asset for chain 8453
      const chainId2 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      await vault.createAccount(chainId2);

      // Add token
      await vault.addToken('USDC' as Symbol);

      // Verify both assets exist (USDC + native ETH)
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.find(a => a.symbol === 'USDC')).toBeDefined();
      expect(assets.find(a => a.symbol === 'ETH')).toBeDefined();

      // Verify account exists
      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(1);
    });

    test('automatically adds native asset when creating first account on chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      // Initially no assets
      let assets = await vault.listAssets();
      expect(assets).toHaveLength(0);

      // Create account - should automatically add native asset
      await vault.createAccount(chainId);

      // Verify native asset was added
      assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe('ETH');
      expect(assets[0].id).toBe('p11:eth');
      expect(assets[0].decimals).toBe(18);
    });

    test('does not duplicate native asset when creating multiple accounts on same chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      // Create three accounts on same chain
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);

      // Only one native asset should exist (ETH is aggregated across chains)
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe('ETH');
      expect(assets[0].id).toBe('p11:eth');
    });

    test('handles case-insensitive asset matching', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Add USDC
      const usdc = await vault.addToken('USDC' as Symbol);

      // Should reject adding the same asset again
      await expect(vault.addToken('USDC' as Symbol)).rejects.toThrow(
        'already tracked'
      );

      // Remove the asset
      await vault.removeToken(usdc);

      // Verify asset was removed
      const assets = await vault.listAssets();
      expect(assets).toHaveLength(0);
    });

    test('asset data persists across new LibQC instances', async () => {
      const storage = new MockStorage(new Map());
      const { vault: vault1 } = await createTestLibQC(storage);

      const addedAsset1 = await vault1.addToken('USDC' as Symbol);
      const addedAsset2 = await vault1.addToken('USDT' as Symbol);

      // Create new instance with same storage, unlock with same password
      const vault2 = createBareTestLibQC(storage);
      await vault2.unlock(getTestPassword());
      const assets = await vault2.listAssets();

      expect(assets).toHaveLength(2);
      expect(assets.some(a => a.id === addedAsset1.id)).toBe(true);
      expect(assets.some(a => a.id === addedAsset2.id)).toBe(true);

      // Remove asset using new instance
      await vault2.removeToken(addedAsset1);

      // Create third instance to verify
      const vault3 = createBareTestLibQC(storage);
      await vault3.unlock(getTestPassword());
      const assetsAfterRemoval = await vault3.listAssets();

      expect(assetsAfterRemoval).toHaveLength(1);
      expect(assetsAfterRemoval[0].id).toBe(addedAsset2.id);
    });

    test('error handling for removing non-existent asset', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const { getAssetBySymbol } = await import('../../src/assets');
      const usdc = getAssetBySymbol('USDC' as Symbol);
      expect(usdc).toBeDefined();

      // Try to remove asset that was never added
      await expect(vault.removeToken(usdc!)).rejects.toThrow('not tracked');

      // Add and remove asset
      const addedAsset = await vault.addToken('USDC' as Symbol);
      await vault.removeToken(addedAsset);

      // Try to remove again
      await expect(vault.removeToken(addedAsset)).rejects.toThrow(
        'not tracked'
      );
    });

    test('native assets added on account creation, tokens added manually', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      // Create account - native asset auto-added
      await vault.createAccount(chainId);

      // Manually add a token
      const usdc = await vault.addToken('USDC' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(2);
      expect(assets.find(a => a.symbol === 'ETH')).toBeDefined();
      expect(assets.find(a => a.id === usdc.id)).toBeDefined();
    });

    test('handles assets with various decimal places', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.addToken('USDC' as Symbol);
      await vault.addToken('DAI' as Symbol);
      await vault.addToken('wBTC' as Symbol);

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(3);
      expect(assets.find(a => a.symbol === 'USDC')?.decimals).toBe(6);
      expect(assets.find(a => a.symbol === 'DAI')?.decimals).toBe(18);
      expect(assets.find(a => a.symbol === 'wBTC')?.decimals).toBe(8);
    });
  });

  describe('getTotalBalances', () => {
    test('calls listAccounts exactly once across multiple accounts and assets', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const eth1 = new ChainId({ namespace: 'eip155', reference: '1' });
      const base = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(eth1);
      await vault.createAccount(base);

      // BTC has no entity on EVM chains → AssetEntityNotFoundError swallowed →
      // 0n balance, no RPC calls, so no network mocking needed here.
      const btcAsset = getAssetBySymbol('BTC' as Symbol)!;
      const listAccountsSpy = vi.spyOn(vault, 'listAccounts');

      const results = await vault.getTotalBalances([btcAsset, btcAsset]);

      expect(listAccountsSpy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results[0].balance).toBe(0n);
      expect(results[1].balance).toBe(0n);
    });

    test('returns empty array without querying state for empty asset list', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      const listAccountsSpy = vi.spyOn(vault, 'listAccounts');

      const results = await vault.getTotalBalances([]);

      expect(results).toHaveLength(0);
      expect(listAccountsSpy).not.toHaveBeenCalled();
    });

    test('getTotalBalance delegates to getTotalBalances', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const btcAsset = getAssetBySymbol('BTC' as Symbol)!;
      const getTotalBalancesSpy = vi.spyOn(vault, 'getTotalBalances');

      const result = await vault.getTotalBalance(btcAsset);

      expect(getTotalBalancesSpy).toHaveBeenCalledWith([btcAsset]);
      expect(result.balance).toBe(0n);
      expect(result.decimals).toBe(btcAsset.decimals);
      expect(result.symbol).toBe(btcAsset.symbol);
    });
  });

  describe('clearState', () => {
    test('clears all state and allows fresh wallet creation', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      // Set up complete wallet state with all components
      const mnemonic1 = await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);
      await vault.addToken('USDC' as Symbol);

      // Verify everything is set
      expect(await vault.checkPassword(getTestPassword())).toBe(true);
      expect((await vault.listAccounts()).length).toBe(1);
      expect((await vault.listAssets()).length).toBe(2); // Native ETH + USDC

      // Clear state
      await vault.clearState();

      // Verify all state is cleared
      await expect(vault.checkPassword(getTestPassword())).rejects.toThrow();

      // Verify can create fresh wallet
      await vault.setPassword(getTestPassword());
      const mnemonic2 = await captureGeneratedMnemonic(vault);
      expect(mnemonic2).not.toStrictEqual(mnemonic1);

      await vault.createAccount(chainId);
      expect(await vault.checkPassword(getTestPassword())).toBe(true);
      expect((await vault.listAccounts()).length).toBe(1);
    });

    test('multiple consecutive clear calls work without errors', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await captureGeneratedMnemonic(vault);

      // Clear multiple times
      await vault.clearState();
      await vault.clearState();
      await vault.clearState();

      // Should still be able to generate new mnemonic
      await vault.setPassword(getTestPassword());
      const mnemonic = await captureGeneratedMnemonic(vault);
      expect(mnemonic).toBeDefined();
    });

    test('clearing when state is already empty works', async () => {
      const storage = new MockStorage(new Map());
      const vault = createBareTestLibQC(storage);

      // State is empty, clear should work without error
      await expect(vault.clearState()).resolves.not.toThrow();

      // Should be able to use LibQC normally after clearing empty state
      await vault.setPassword(getTestPassword());
      const mnemonic = await captureGeneratedMnemonic(vault);
      expect(mnemonic).toBeDefined();
    });

    test('removes the withdrawals segment alongside the other segments (ENG-1791)', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);

      // Seed a withdrawals segment so its key is present in storage.
      await setStateSegment(storage, encryptionKey, 'withdrawals', []);
      expect(await storage.has(STATE_SEGMENT_KEYS.withdrawals)).toBe(true);

      await vault.clearState();

      expect(await storage.has(STATE_SEGMENT_KEYS.entropy)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.seed)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.addresses)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.assets)).toBe(false);
      expect(await storage.has(STATE_SEGMENT_KEYS.withdrawals)).toBe(false);
    });

    test('listWithdrawals filters by accountId', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage, [
        createNoDiscoveryChainSpec()
      ]);

      const accountA = new AccountId({
        chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
        address: '0x1111111111111111111111111111111111111111'
      });
      const accountB = new AccountId({
        chainId: new ChainId({ namespace: 'eip155', reference: '8453' }),
        address: '0x2222222222222222222222222222222222222222'
      });

      const records: WithdrawalRecord[] = [
        {
          id: 'record-a',
          accountId: accountA.toString(),
          destinationAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          destinationChain: accountA.chainId.toString(),
          status: 'sent',
          txRefs: [],
          initiatedAt: 2,
          sentAt: 2,
          completedAt: null,
          failedAt: null
        },
        {
          id: 'record-b',
          accountId: accountB.toString(),
          destinationAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          destinationChain: accountB.chainId.toString(),
          status: 'withdrawn',
          txRefs: [],
          initiatedAt: 1,
          sentAt: 1,
          completedAt: 1,
          failedAt: null
        }
      ];

      await setStateSegment(storage, encryptionKey, 'withdrawals', records);

      const filtered = await vault.listWithdrawals(accountA);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('record-a');
    });

    test('refreshWithdrawalLifecycle persists reconciled record updates', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage, [
        createNoDiscoveryChainSpec()
      ]);

      const account = new AccountId({
        chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
        address: '0x3333333333333333333333333333333333333333'
      });
      const pending: WithdrawalRecord = {
        id: 'record-pending',
        accountId: account.toString(),
        destinationAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        destinationChain: account.chainId.toString(),
        status: 'pending',
        txRefs: [],
        initiatedAt: 10,
        sentAt: null,
        completedAt: null,
        failedAt: null
      };

      await setStateSegment(storage, encryptionKey, 'withdrawals', [pending]);
      const reconciledRecord: WithdrawalRecord = {
        ...pending,
        status: 'withdrawn',
        sentAt: 11,
        completedAt: 12
      };

      const reconcileWithdrawalRecord = vi
        .fn()
        .mockResolvedValue(reconciledRecord);
      vi.spyOn(vault as any, 'getAccount').mockResolvedValue({
        reconcileWithdrawalRecord
      });

      const refreshed = await vault.refreshWithdrawalLifecycle(account);
      expect(refreshed[0]).toEqual(reconciledRecord);

      const persisted = await getLibQCState(storage, encryptionKey);
      expect(persisted.withdrawals?.[0]).toEqual(reconciledRecord);
    });

    test('state persistence after clear across new LibQC instances', async () => {
      const storage = new MockStorage(new Map());

      // First instance: generate mnemonic and create account
      const { vault: vault1 } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault1);
      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault1.createAccount(chainId);

      // Clear state
      await vault1.clearState();

      // Create new instance with same storage
      const vault2 = createBareTestLibQC(storage);
      expect(await vault2.hasPassword()).toBe(false);

      // Verify state is clear in new instance
      await vault2.setPassword(getTestPassword());
      expect(await vault2.listAccounts()).toHaveLength(0);
      expect(await vault2.listAssets()).toHaveLength(0);

      // Should be able to generate mnemonic in new instance
      const mnemonic = await captureGeneratedMnemonic(vault2);
      expect(mnemonic).toBeDefined();
    });
  });

  describe('address version persistence', () => {
    test('stores version in encrypted state when creating an account', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);

      // Check that the address in state has the version field
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(1);
      expect(state.addresses[0].version).toBeDefined();
      expect(state.addresses[0].version).toBe('V1');
    });

    test('version persists across multiple account creations', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId1 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '1' });

      await vault.createAccount(chainId1);
      await vault.createAccount(chainId2);

      // Check that the address in state still has version
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(1); // Same address reused
      expect(state.addresses[0].version).toBe('V1');
    });

    test('each address in state has version field when creating multiple addresses', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      // Create 3 accounts, which will create 3 different addresses
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);

      // Check that all addresses in state have version field
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(3);

      state.addresses.forEach((address, index) => {
        expect(address.version).toBeDefined();
        expect(address.version).toBe('V1');
        expect(address.index).toBe(index);
      });
    });

    test('entropy and seed persist in storage after generation', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      const mnemonic = await captureGeneratedMnemonic(vault);

      const state = await getLibQCState(storage, encryptionKey);
      expect(state.entropy).toBeDefined();
      // It should now be entropy (32 bytes), not words.
      expect(state.entropy!.length).toBe(32);
      expect(state.seed).toBeDefined();
      expect(state.seed!.length).toBe(64);

      // Verify that reconstructing mnemonic from entropy matches the original
      const reconstructedMnemonic = await vault.exportMnemonic(
        getTestPassword(),
        exportedMnemonic => Mnemonic.from(new Uint8Array(exportedMnemonic))
      );
      expect(reconstructedMnemonic).toStrictEqual(mnemonic);
    });

    test('version is stored when forceNewAddress is true', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);
      await vault.createAccount(chainId, true as ForceNewAddress);

      // Check that both addresses have version
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(2);
      expect(state.addresses[0].version).toBe('V1');
      expect(state.addresses[1].version).toBe('V1');
    });

    test('version matches CURRENT_DEFAULT_ADDRESS_VERSION', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await captureGeneratedMnemonic(vault);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);

      const state = await getLibQCState(storage, encryptionKey);

      const { CURRENT_DEFAULT_ADDRESS_VERSION } = await import(
        '../../src/config'
      );
      expect(state.addresses[0].version).toBe(CURRENT_DEFAULT_ADDRESS_VERSION);
    });

    test('supports complex cross-chain mirroring and diversification (BTC, ETH, Base)', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage, [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createTypedChain({
          chainId: 8453,
          name: 'Base',
          network: 'base',
          iconUrl: 'https://example.com/base.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://base.example.org']
        }),
        createBitcoinChainSpec()
      ]);
      await captureGeneratedMnemonic(vault);

      const ethChainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      // 1. Create ETH -> idx 0
      const ethAccount = await vault.createAccount(ethChainId);
      expect(ethAccount.getId().address).toMatch(/^0x/);

      // 2. Create Base (no force) -> idx 0 (Mirroring)
      const baseAccount1 = await vault.createAccount(baseChainId);
      expect(baseAccount1.getId().address).toBe(ethAccount.getId().address);

      // 3. Create BTC (no force) -> idx 0 (Mirroring Index, though address is different)
      const btcAccount1 = await vault.createAccount(btcChainId);
      expect(btcAccount1.getId().address).toMatch(/^bc1q/);

      // 4. Create BTC (force) -> idx 1 (Diversification)
      const btcAccount2 = await vault.createAccount(
        btcChainId,
        true as ForceNewAddress
      );
      expect(btcAccount2.getId().address).not.toBe(btcAccount1.getId().address);

      // 5. Create Base (force) -> idx 2 (Diversification - incrementing from max idx 1)
      const baseAccount2 = await vault.createAccount(
        baseChainId,
        true as ForceNewAddress
      );
      expect(baseAccount2.getId().address).not.toBe(
        baseAccount1.getId().address
      );

      // 6. Verify state indices
      const state = await getLibQCState(storage, encryptionKey);
      // There should be 4 address records:
      // - EVM index 0 (shared by ETH and Base)
      // - Bitcoin index 0 (used by BTC)
      // - Bitcoin index 1 (forced for BTC)
      // - EVM index 2 (forced for Base, incremented from max global index 1)
      expect(state.addresses).toHaveLength(4);

      // We check that the INDICES used are correct.
      // Note: BTC and EVM maintain separate index counters in this version of libqc.
      const indices = state.addresses.map(a => a.index).sort((a, b) => a - b);
      expect(indices).toEqual([0, 0, 1, 1]); // idx 0/1 for Bitcoin, idx 0/1 for EVM

      // 7. Verify account list
      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(5); // ETH(0), Base(0), BTC(0), BTC(1), Base(2)
    });

    test('Mirroring/Growth strategy: reuses indices for new chains, grows for same chains', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createTypedChain({
          chainId: 8453,
          name: 'Base',
          network: 'base',
          iconUrl: 'https://example.com/base.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://base.example.org']
        })
      ]);
      await captureGeneratedMnemonic(vault);

      const eth = new ChainId({ namespace: 'eip155', reference: '1' });
      const base = new ChainId({ namespace: 'eip155', reference: '8453' });

      const acc1 = await vault.createAccount(eth); // eth -> idx 0
      const acc2 = await vault.createAccount(base); // base -> idx 0 (mirroring)
      const acc3 = await vault.createAccount(eth); // eth -> idx 1 (growth)
      const acc4 = await vault.createAccount(base); // base -> idx 1 (growth)
      const acc5 = await vault.createAccount(base); // base -> idx 2 (growth)

      expect(acc1.getId().address).toBe(acc2.getId().address); // mirrored idx 0
      expect(acc3.getId().address).toBe(acc4.getId().address); // mirrored idx 1
      expect(acc5.getId().address).not.toBe(acc4.getId().address); // new idx 2

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(5);
      expect(new Set(accounts.map(a => a.address)).size).toBe(3); // idx 0, 1, 2
    });

    test('Strict Diversification strategy: forces new index even for new chains when forceNewAddress is true', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createTypedChain({
          chainId: 8453,
          name: 'Base',
          network: 'base',
          iconUrl: 'https://example.com/base.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://base.example.org']
        })
      ]);
      await captureGeneratedMnemonic(vault);

      const eth = new ChainId({ namespace: 'eip155', reference: '1' });
      const base = new ChainId({ namespace: 'eip155', reference: '8453' });

      const acc1 = await vault.createAccount(eth, true as ForceNewAddress); // eth -> idx 0
      const acc2 = await vault.createAccount(base, true as ForceNewAddress); // base -> idx 1 (diversification)
      const acc3 = await vault.createAccount(eth, true as ForceNewAddress); // eth -> idx 2
      const acc4 = await vault.createAccount(base, true as ForceNewAddress); // base -> idx 3
      const acc5 = await vault.createAccount(base, true as ForceNewAddress); // base -> idx 4

      const addresses = [
        acc1.getId().address,
        acc2.getId().address,
        acc3.getId().address,
        acc4.getId().address,
        acc5.getId().address
      ];

      // All addresses must be unique
      expect(new Set(addresses).size).toBe(5);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(5);
    });
  });

  describe('Bitcoin account creation', () => {
    test('creates Bitcoin account and returns BitcoinAccountClient', async () => {
      const chains = [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createBitcoinChainSpec()
      ];

      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, chains);
      await captureGeneratedMnemonic(vault);

      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      const account = await vault.createAccount(btcChainId);

      expect(account).toBeInstanceOf(BitcoinAccountClient);
      expect(account.getId().toString()).toContain('bip122:');
      expect(account.getId().address).toMatch(/^bc1q/);
    });

    test('Bitcoin accounts are non-idempotent by default (always new address)', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, [
        createBitcoinChainSpec()
      ]);
      await captureGeneratedMnemonic(vault);

      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      const account1 = await vault.createAccount(btcChainId);
      const account2 = await vault.createAccount(btcChainId);

      expect(account1.getId().address).not.toBe(account2.getId().address);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(2);
    });

    test('creates multiple unique Bitcoin accounts', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage, [
        createBitcoinChainSpec()
      ]);
      await captureGeneratedMnemonic(vault);

      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      // Create 3 unique accounts
      const acc1 = await vault.createAccount(btcChainId); // idx 0
      const acc2 = await vault.createAccount(btcChainId); // idx 1
      const acc3 = await vault.createAccount(btcChainId); // idx 2

      expect(acc1.getId().address).not.toBe(acc2.getId().address);
      expect(acc2.getId().address).not.toBe(acc3.getId().address);
      expect(acc1.getId().address).not.toBe(acc3.getId().address);

      // Verify state records
      const state = await getLibQCState(storage, encryptionKey);
      expect(
        state.addresses.filter(a => a.chainType === 'bitcoin')
      ).toHaveLength(3);

      const indices = state.addresses
        .filter(a => a.chainType === 'bitcoin')
        .map(a => a.index)
        .sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2]);
    });

    test('forceNewAddress should work for Bitcoin and return a new account', async () => {
      const chains = [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createBitcoinChainSpec()
      ];

      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, chains);
      await captureGeneratedMnemonic(vault);

      const btcChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });

      const account1 = await vault.createAccount(btcChainId);
      const account2 = await vault.createAccount(
        btcChainId,
        true as ForceNewAddress
      );

      expect(account1.getId().toString()).not.toBe(account2.getId().toString());
      expect(account2).toBeInstanceOf(BitcoinAccountClient);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(2);
    });

    test('creates separate address for Bitcoin testnet when mainnet exists (bc1 vs tb1)', async () => {
      const chains = [
        createTypedChain({
          chainId: 1,
          name: 'Ethereum',
          network: 'mainnet',
          iconUrl: 'https://example.com/eth.png',
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          testnet: false,
          rpcUrls: ['https://eth.example.org']
        }),
        createBitcoinChainSpec(),
        createBitcoinTestnetChainSpec()
      ];

      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage, chains);
      await captureGeneratedMnemonic(vault);

      const btcMainnetChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000019d6689c085ae165831e93'
      });
      const btcTestnetChainId = new ChainId({
        namespace: 'bip122',
        reference: '000000000933ea01ad0ee984209779ba'
      });

      const mainnetAccount = await vault.createAccount(btcMainnetChainId);
      const testnetAccount = await vault.createAccount(btcTestnetChainId);

      expect(mainnetAccount.getId().address).toMatch(/^bc1q/);
      expect(testnetAccount.getId().address).toMatch(/^tb1q/);
      expect(mainnetAccount.getId().address).not.toBe(
        testnetAccount.getId().address
      );
    });
  });
});
