/**
 * Verifies that scripts/exportPrivateKeys.mjs reproduces libqc's own BIP-85
 * derivation for both EVM and Bitcoin, and that the WIF/address encodings
 * are correct. Acts as a regression guard against drift between the
 * recovery script and the SDK's canonical key derivation.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { getAddress, bytesToHex } from 'viem';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { getPublicKey } from '@noble/secp256k1';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import * as bitcoin from 'bitcoinjs-lib';

import {
  deriveSecp256k1PrivateKey,
  deriveBitcoinPrivateKey
} from '../../src/cryptography';
import { deriveBitcoinAddressFromSeed } from '../../src/addresses';
import { generateAddressV1 } from '../../src/zeroDev/accounts';
import { AddressIndex } from '../../src/types';
import { TEST_MNEMONIC_PHRASE, TEST_SEED } from '../testUtils';

const SCRIPT = resolve(__dirname, '../../scripts/exportPrivateKeys.mjs');

const toHex = (b: Uint8Array): string =>
  '0x' +
  Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');

type ScriptAccount = {
  index: number;
  evm: {
    privateKeyHex: string;
    /** Kernel V3.3 smart-account address — the address shown in libqc. */
    smartAccountAddress: string;
    /** EOA owner address — what `privateKeyToAddress(priv)` returns. */
    ownerAddress: string;
  };
  btc: { privateKeyHex: string; wif: string; address: string };
};

type ScriptOutput = {
  network: 'mainnet' | 'testnet';
  accounts: ScriptAccount[];
};

type RunOptions = {
  start?: number;
  count?: number;
  indices?: number[];
  testnet?: boolean;
  json?: boolean;
  mnemonicFile?: string;
  /** Raw args appended after the structured flags above. */
  extraArgs?: string[];
  /**
   * Mnemonic to pipe via stdin. Defaults to TEST_MNEMONIC_PHRASE.
   * Pass `null` to suppress stdin entirely (e.g. when reading from a file
   * or exercising arg-validation paths that exit before reading stdin).
   */
  stdin?: string | null;
};

function runScript(opts: RunOptions = {}): SpawnSyncReturns<string> {
  const args = [SCRIPT];
  if (opts.start !== undefined) args.push('--start', String(opts.start));
  if (opts.count !== undefined) args.push('--count', String(opts.count));
  if (opts.indices !== undefined) {
    args.push('--indices', opts.indices.join(','));
  }
  if (opts.testnet) args.push('--testnet');
  if (opts.json) args.push('--json');
  if (opts.mnemonicFile) args.push('--mnemonic-file', opts.mnemonicFile);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const input =
    opts.stdin === null ? undefined : (opts.stdin ?? TEST_MNEMONIC_PHRASE);

  return spawnSync('node', args, { input, encoding: 'utf8' });
}

function runScriptJson(opts: RunOptions = {}): ScriptOutput {
  const result = runScript({ ...opts, json: true });
  if (result.status !== 0) {
    throw new Error(`script exited with ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as ScriptOutput;
}

describe('exportPrivateKeys.mjs recovery script', () => {
  describe('key derivation', () => {
    it('produces the same EVM and BTC keys/addresses as libqc itself', async () => {
      const indices = [0, 1, 5, 19];
      const { network, accounts } = runScriptJson({ indices });

      expect(network).toBe('mainnet');
      expect(accounts).toHaveLength(indices.length);

      for (const account of accounts) {
        const idx = account.index as AddressIndex;

        // EVM private key + owner EOA: derive privkey via libqc, derive owner
        // address via raw secp + keccak (the path used by
        // createPrivateKeyAccount in src/account/evm/utils.ts). Cross-checks
        // the script's owner-address path against an independent computation
        // rather than viem's privateKeyToAddress (which the script uses).
        const expectedEvmPrivBytes = deriveSecp256k1PrivateKey(TEST_SEED, idx);
        const expectedEvmPriv = toHex(expectedEvmPrivBytes);
        const expectedEvmPub = getPublicKey(expectedEvmPrivBytes, false);
        const expectedOwnerAddr = getAddress(
          bytesToHex(keccak_256(expectedEvmPub.subarray(1)).slice(-20))
        );
        expect(account.evm.privateKeyHex).toBe(expectedEvmPriv);
        expect(account.evm.ownerAddress).toBe(expectedOwnerAddr);

        // EVM Kernel smart-account address: must match the SDK's own
        // generateAddressV1 derivation. Any drift in entry point, kernel
        // version, factory index, or initCodeHash between the script and the
        // SDK fails this assertion.
        const expectedV1 = await generateAddressV1(TEST_SEED, idx);
        expect(account.evm.smartAccountAddress).toBe(expectedV1.address);
        expect(account.evm.ownerAddress).toBe(
          expectedV1.secp256k1PublicKeyHash
        );

        // BTC
        const expectedBtcPrivBytes = deriveBitcoinPrivateKey(TEST_SEED, idx);
        const expectedBtcAddr = deriveBitcoinAddressFromSeed(TEST_SEED, idx);
        expect(account.btc.privateKeyHex).toBe(toHex(expectedBtcPrivBytes));
        expect(account.btc.address).toBe(expectedBtcAddr.address);

        // WIF: decode and verify mainnet prefix (0x80), compressed flag
        // (0x01), and that the embedded 32-byte private key matches what
        // libqc derives.
        const decoded = base58check(sha256).decode(account.btc.wif);
        expect(decoded).toHaveLength(34);
        expect(decoded[0]).toBe(0x80);
        expect(decoded[33]).toBe(0x01);
        expect(decoded.slice(1, 33)).toEqual(expectedBtcPrivBytes);
      }
    });

    it('--testnet emits tb1q addresses, 0xEF WIF prefix, same priv keys', () => {
      const indices = [0, 3];
      const { network, accounts } = runScriptJson({ testnet: true, indices });

      expect(network).toBe('testnet');
      expect(accounts).toHaveLength(indices.length);

      for (const account of accounts) {
        const idx = account.index as AddressIndex;

        // Bitcoin private key is network-independent; only the address
        // encoding and WIF version byte differ.
        const expectedPrivBytes = deriveBitcoinPrivateKey(TEST_SEED, idx);
        expect(account.btc.privateKeyHex).toBe(toHex(expectedPrivBytes));

        const expectedAddr = deriveBitcoinAddressFromSeed(
          TEST_SEED,
          idx,
          bitcoin.networks.testnet
        );
        expect(account.btc.address).toBe(expectedAddr.address);
        expect(account.btc.address.startsWith('tb1q')).toBe(true);

        const decoded = base58check(sha256).decode(account.btc.wif);
        expect(decoded[0]).toBe(0xef);
        expect(decoded[33]).toBe(0x01);
        expect(decoded.slice(1, 33)).toEqual(expectedPrivBytes);
      }
    });
  });

  describe('index selection', () => {
    it('--start defaults --count to 20', () => {
      const { accounts } = runScriptJson({ start: 0 });
      expect(accounts.map(a => a.index)).toEqual(
        Array.from({ length: 20 }, (_, i) => i)
      );
    });

    it('--start and --count combine into a contiguous window', () => {
      const { accounts } = runScriptJson({ start: 5, count: 3 });
      expect(accounts.map(a => a.index)).toEqual([5, 6, 7]);
    });

    it('--indices preserves caller-supplied order and overrides start/count', () => {
      const { accounts } = runScriptJson({
        indices: [7, 2, 11],
        start: 0,
        count: 100
      });
      expect(accounts.map(a => a.index)).toEqual([7, 2, 11]);
    });
  });

  describe('mnemonic input', () => {
    it('reads mnemonic from --mnemonic-file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'libqc-export-test-'));
      const file = join(dir, 'mnemonic.txt');
      writeFileSync(file, `${TEST_MNEMONIC_PHRASE}\n`);
      try {
        const { accounts } = runScriptJson({
          mnemonicFile: file,
          indices: [0],
          stdin: null
        });
        const expected = deriveSecp256k1PrivateKey(
          TEST_SEED,
          0 as AddressIndex
        );
        expect(accounts[0].evm.privateKeyHex).toBe(toHex(expected));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects mnemonic passed via argv', () => {
      const result = runScript({
        extraArgs: ['--mnemonic', TEST_MNEMONIC_PHRASE],
        stdin: null
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Refusing to read mnemonic from argv/);
    });

    it('rejects non-24-word mnemonics', () => {
      const result = runScript({
        indices: [0],
        stdin: 'word '.repeat(12).trim()
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/24-word/);
    });

    it('rejects 24-word mnemonics with an invalid BIP-39 checksum', () => {
      // 24 valid wordlist entries; "abandon" x24 is a well-known invalid
      // checksum (the canonical valid form is "abandon" x23 + "art").
      const result = runScript({
        indices: [0],
        stdin: 'abandon '.repeat(24).trim()
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/checksum/i);
    });

    it('rejects empty stdin when no --mnemonic-file is given', () => {
      const result = runScript({ indices: [0], stdin: '' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/No mnemonic provided/);
    });
  });

  describe('argument validation', () => {
    it('rejects unknown arguments', () => {
      const result = runScript({ extraArgs: ['--bogus'], stdin: null });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Unknown argument/);
    });

    it('rejects a flag that is missing its value', () => {
      const result = runScript({ extraArgs: ['--start'], stdin: null });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Missing value for --start/);
    });

    it('rejects negative --start', () => {
      const result = runScript({ start: -1, stdin: null });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/--start must be >= 0/);
    });

    it('rejects --count <= 0', () => {
      const result = runScript({ count: 0, stdin: null });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/--count must be >= 1/);
    });

    it('rejects negative entries in --indices', () => {
      const result = runScript({
        extraArgs: ['--indices', '0,-1,2'],
        stdin: null
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/non-negative integers/);
    });

    it('rejects non-integer entries in --indices', () => {
      const result = runScript({
        extraArgs: ['--indices', '0,abc'],
        stdin: null
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/non-negative integers/);
    });
  });

  describe('output format', () => {
    it('non-JSON output prints a human-readable table with keys to stdout', () => {
      const result = runScript({ indices: [0] });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Index 0');
      expect(result.stdout).toContain('EVM private key');
      expect(result.stdout).toContain('BTC WIF');
      expect(result.stdout).toContain('MAINNET');
    });

    it('--testnet table output reports TESTNET network', () => {
      const result = runScript({ indices: [0], testnet: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('TESTNET');
    });

    it('--help exits 0 with usage on stderr and no keys on stdout', () => {
      const result = runScript({ extraArgs: ['--help'], stdin: null });
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/Usage:/);
      // Help should never leak example keys to stdout.
      expect(result.stdout).not.toMatch(/private key/i);
    });
  });
});
