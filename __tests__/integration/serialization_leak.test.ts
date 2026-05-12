import { afterEach, describe, expect, it, vi } from 'vitest';
import LibQC from '../../src/libqc';
import {
  MockStorage,
  createTypedChain,
  getTestPassword,
  mockGenerateAddressFromMnemonic
} from '../testUtils';
import { countSequenceInHeapStream } from './heap-scanner';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Mnemonic } from '../../src/types';
import { BundlerConfig } from '../../src/bundler';
import { EvmAccountClient } from '../../src/account/evm/evm';

describe('Serialization Security Leak Proof', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should prove that v1 style binary storage prevents leaks', async () => {
    const chain = createTypedChain({
      chainId: 1,
      name: 'Offline EVM Test',
      network: 'testnet',
      iconUrl: 'https://example.com/chain.png',
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH'
      },
      testnet: true,
      rpcUrls: ['http://127.0.0.1:8545']
    });

    mockGenerateAddressFromMnemonic();
    vi.spyOn(EvmAccountClient.prototype, 'isPubKeyExposed').mockResolvedValue(
      false
    );

    const storage = new MockStorage(new Map());
    const vault = new LibQC(
      storage,
      [chain],
      () => ({}) as unknown as BundlerConfig
    );

    const { bytePattern, mnemonic } = (() => {
      const raw = generateMnemonic(wordlist, 256);
      const m = Mnemonic.from(new TextEncoder().encode(raw));
      return {
        bytePattern: Array.from<number>(m.subarray(0, 16)),
        mnemonic: m
      };
    })();

    await vault.importWallet(mnemonic, getTestPassword());

    const accounts = await vault.listAccounts();
    const account = await vault.getAccount(accounts[0].id);

    const persistedAddress = await (
      account as any
    ).getPersistedAddressFromAccount();
    const pkBytePattern = Array.from<number>(
      persistedAddress.secp256k1PrivateKey.subarray(0, 16)
    );
    persistedAddress.secp256k1PrivateKey.fill(0);

    for (let i = 0; i < 10; i++) {
      await vault.createAccount(chain.chainId);
    }

    const finalPrivCount = await countSequenceInHeapStream(pkBytePattern);
    const finalMnemonicCount = await countSequenceInHeapStream(bytePattern);

    expect(
      finalPrivCount,
      'Leak detected: Private key pattern found in heap!'
    ).toBe(0);
    expect(
      finalMnemonicCount,
      'Leak detected: Mnemonic pattern found in heap!'
    ).toBe(0);
  }, 90000);
});
