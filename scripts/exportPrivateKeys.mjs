#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * libqc emergency private-key exporter
 *
 * Standalone, offline recovery script. Given a libqc 24-word mnemonic, it
 * reproduces libqc's BIP-85 derivation and prints, per address index:
 *  - the Bitcoin address, private key, and WIF
 *  - the EVM Kernel V3.3 smart-account address (the address shown in libqc
 *    and the address that actually holds funds)
 *  - the EVM owner EOA address and private key (the AA owner key)
 *
 * Why?
 * ---------------
 * libqc derives keys via BIP-85 with a custom application namespace
 * (LIBQC_APP_NO_BASE = 4860, EVM = 4861, BTC = 4862, see
 * src/cryptography.ts). No third-party wallet implements that derivation,
 * so a libqc mnemonic cannot be typed directly into MetaMask / Sparrow /
 * Ledger and produce the same addresses.
 *
 * Recovery semantics differ between chains:
 *
 *   Bitcoin: libqc uses plain p2wpkh. The WIF emitted here can be imported
 *   directly into Sparrow / Bluewallet / Ledger as a non-HD account, and
 *   funds are immediately spendable.
 *
 *   EVM: libqc accounts are ERC-4337 smart contract accounts (ZeroDev
 *   Kernel V3.3). The displayed wallet address is a CREATE2 smart-account
 *   address derived from (factory, ECDSA validator, owner EOA, index).
 *   The private key emitted here is the AA OWNER key — importing it into
 *   MetaMask only grants access to the owner EOA, which is empty. To move
 *   funds out of the smart account, sign a UserOperation with the owner
 *   key and submit it to any ERC-4337 bundler.
 *
 * Auditability
 * ------------
 * - Pure ESM, single file, no transpile step.
 * - Imports only from libqc's existing deps (@scure/bip39, @scure/bip32,
 *   @scure/base, @noble/hashes, @noble/secp256k1, viem, bitcoinjs-lib,
 *   @zerodev/ecdsa-validator, @zerodev/sdk). No new dependency is introduced.
 * - The BIP-85 algorithm here is line-for-line the same as
 *   src/cryptography.ts deriveBip85Entropy.
 * - The Kernel smart-account derivation matches src/zeroDev/accounts.ts
 *   generateAddressV1 (same kernel version, entry point, and factoryIndex).
 *   Compare both before trusting the output.
 *
 * Safety
 * ------
 * - The mnemonic is NEVER accepted via argv (argv is visible to other
 *   processes via `ps`). Read it from a file or stdin only.
 * - Run this on an offline / air-gapped machine if at all possible.
 * - Shred the mnemonic file after use (`shred -u mnemonic.txt` on Linux,
 *   `rm -P mnemonic.txt` on macOS).
 * - The output of this script IS the private key. Anyone who sees it can
 *   spend the funds (BTC directly; EVM via a bundler with the owner key).
 *
 * Usage
 * -----
 *   node scripts/exportPrivateKeys.mjs --mnemonic-file <path> [options]
 *   cat mnemonic.txt | node scripts/exportPrivateKeys.mjs [options]
 *
 * Options
 *   --mnemonic-file <path>   Read mnemonic from file. Otherwise read stdin.
 *   --start <n>              First index to derive (default 0).
 *   --count <n>              Number of indices to derive (default 20).
 *   --indices <a,b,c>        Explicit index list, overrides --start/--count.
 *   --testnet                Emit Bitcoin testnet addresses (tb1q...).
 *   --json                   Machine-readable JSON output instead of table.
 *   --help                   Show this help.
 */

import { readFileSync } from 'node:fs';
import { argv, exit, stdin } from 'node:process';

import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from '@noble/secp256k1';
import { privateKeyToAddress } from 'viem/accounts';
import * as bitcoin from 'bitcoinjs-lib';
import { getKernelAddressFromECDSA } from '@zerodev/ecdsa-validator';
import { constants } from '@zerodev/sdk';
import { KERNEL_V3_3, getEntryPoint } from '@zerodev/sdk/constants';

// --- BIP-85 constants — must match src/cryptography.ts -----------------

const BIP85_PURPOSE = 83696968;
const BIP85_HMAC_KEY = 'bip-entropy-from-k';
const LIBQC_APP_NO_BASE = 4860;
const LIBQC_SECP256K1_APP_NO = LIBQC_APP_NO_BASE + 1; // 4861 — EVM
const LIBQC_BITCOIN_APP_NO = LIBQC_APP_NO_BASE + 2; // 4862 — Bitcoin
const SECP256K1_ENTROPY_LENGTH = 32;

// --- Kernel constants — must match src/zeroDev/accounts.ts -------------

const DEFAULT_KERNEL_VERSION = KERNEL_V3_3;
const DEFAULT_ENTRY_POINT = getEntryPoint('0.7');

// --- CLI parsing --------------------------------------------------------

function parseArgs(args) {
  const opts = {
    mnemonicFile: null,
    start: 0,
    count: 20,
    indices: null,
    testnet: false,
    json: false,
    help: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      const v = args[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${a}`);
      }
      return v;
    };
    switch (a) {
      case '--mnemonic-file':
        opts.mnemonicFile = next();
        break;
      case '--start':
        opts.start = Number.parseInt(next(), 10);
        break;
      case '--count':
        opts.count = Number.parseInt(next(), 10);
        break;
      case '--indices':
        opts.indices = next()
          .split(',')
          .map(s => Number.parseInt(s.trim(), 10));
        break;
      case '--testnet':
        opts.testnet = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--mnemonic':
        throw new Error(
          'Refusing to read mnemonic from argv (visible via `ps`). ' +
            'Use --mnemonic-file or pipe via stdin.'
        );
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (opts.indices === null) {
    if (
      !Number.isInteger(opts.start) ||
      opts.start < 0 ||
      !Number.isInteger(opts.count) ||
      opts.count <= 0
    ) {
      throw new Error('--start must be >= 0 and --count must be >= 1');
    }
  } else if (opts.indices.some(n => !Number.isInteger(n) || n < 0)) {
    throw new Error(
      '--indices must be a comma-separated list of non-negative integers'
    );
  }
  return opts;
}

function printHelpAndExit() {
  // The leading docblock is the canonical help text. Keep stdout for keys.
  console.error(
    [
      'libqc emergency private-key exporter',
      '',
      'Usage:',
      '  node scripts/exportPrivateKeys.mjs --mnemonic-file <path> [options]',
      '  cat mnemonic.txt | node scripts/exportPrivateKeys.mjs [options]',
      '',
      'Options:',
      '  --mnemonic-file <path>   Read mnemonic from file. Otherwise read stdin.',
      '  --start <n>              First index to derive (default 0).',
      '  --count <n>              Number of indices to derive (default 20).',
      '  --indices <a,b,c>        Explicit index list (overrides start/count).',
      '  --testnet                Emit Bitcoin testnet addresses (tb1q...).',
      '  --json                   Machine-readable JSON output.',
      '  --help                   Show this help.',
      '',
      'WARNING: the output IS the private key. Run offline. Shred the mnemonic',
      'file when done.'
    ].join('\n')
  );
  exit(0);
}

// --- Mnemonic input -----------------------------------------------------

async function readMnemonic(opts) {
  if (opts.mnemonicFile) {
    return readFileSync(opts.mnemonicFile, 'utf8');
  }
  // Read all of stdin.
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    throw new Error(
      'No mnemonic provided. Pass --mnemonic-file <path> or pipe via stdin.'
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeMnemonic(raw) {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const wordCount = normalized.split(' ').filter(Boolean).length;
  if (wordCount !== 24) {
    throw new Error(
      `libqc only supports 24-word mnemonics (got ${wordCount} words).`
    );
  }
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error(
      'Invalid mnemonic: BIP-39 checksum failed or contains words outside the English wordlist.'
    );
  }
  return normalized;
}

// --- BIP-85 derivation — mirrors src/cryptography.ts -------------------

function deriveBip85Entropy(root, addressIndex, entropyLength, appNo) {
  if (
    !Number.isInteger(entropyLength) ||
    entropyLength < 1 ||
    entropyLength > 64
  ) {
    throw new Error(`Entropy length must be 1..64, got ${entropyLength}`);
  }
  const path = `m/${BIP85_PURPOSE}'/${appNo}'/${addressIndex}'`;
  const node = root.derive(path);
  const privKey = node.privateKey;
  if (!privKey) {
    throw new Error(`No private key at ${path}`);
  }
  const full = hmac(sha512, utf8ToBytes(BIP85_HMAC_KEY), privKey);
  privKey.fill(0);
  node.wipePrivateData();
  return full.slice(0, entropyLength);
}

function deriveBip85FromSeed(seed, addressIndex, appNo) {
  const root = HDKey.fromMasterSeed(seed);
  try {
    return deriveBip85Entropy(
      root,
      addressIndex,
      SECP256K1_ENTROPY_LENGTH,
      appNo
    );
  } finally {
    root.wipePrivateData();
  }
}

// --- Per-chain address + key formatting --------------------------------

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

// Derive both the EVM owner EOA (controlled directly by the private key) and
// the Kernel V3.3 smart-account address that libqc actually uses on-chain.
// The smart-account address is a pure CREATE2 computation:
//   keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
// where salt = keccak256(abi.encode(initializeCalldata, factoryIndex)).
// `initCodeHash` is read from the ZeroDev SDK's KernelVersionToAddressesMap
// so this stays pinned to the same kernel version libqc creates accounts at.
async function deriveEvm(seed, index) {
  const priv = deriveBip85FromSeed(seed, index, LIBQC_SECP256K1_APP_NO);
  try {
    const hex = `0x${bytesToHex(priv)}`;
    const ownerAddress = privateKeyToAddress(hex);

    const versionData =
      constants.KernelVersionToAddressesMap[DEFAULT_KERNEL_VERSION];
    if (!versionData?.initCodeHash) {
      throw new Error(
        `initCodeHash not available for kernel version ${DEFAULT_KERNEL_VERSION}. ` +
          'Cannot derive EVM smart-account address offline.'
      );
    }

    const smartAccountAddress = await getKernelAddressFromECDSA({
      entryPoint: DEFAULT_ENTRY_POINT,
      kernelVersion: DEFAULT_KERNEL_VERSION,
      eoaAddress: ownerAddress,
      index: BigInt(index),
      initCodeHash: versionData.initCodeHash
    });

    return { privateKeyHex: hex, smartAccountAddress, ownerAddress };
  } finally {
    priv.fill(0);
  }
}

// WIF (Wallet Import Format) encoding for compressed mainnet/testnet keys.
// Mainnet prefix: 0x80; testnet prefix: 0xEF; compressed flag suffix: 0x01.
// Final form: base58check(prefix || privKey || 0x01).
function privKeyToWIF(privKey, testnet) {
  const prefix = testnet ? 0xef : 0x80;
  const payload = new Uint8Array(1 + privKey.length + 1);
  payload[0] = prefix;
  payload.set(privKey, 1);
  payload[payload.length - 1] = 0x01;
  // @scure/base.base58check returns a codec; .encode wants the raw bytes
  // (it appends the sha256(sha256(payload))[:4] checksum internally).
  return base58check(sha256).encode(payload);
}

function deriveBtc(seed, index, testnet) {
  const priv = deriveBip85FromSeed(seed, index, LIBQC_BITCOIN_APP_NO);
  try {
    const network = testnet
      ? bitcoin.networks.testnet
      : bitcoin.networks.bitcoin;
    const pubkey = getPublicKey(priv, true); // compressed
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(pubkey),
      network
    });
    if (!payment.address) {
      throw new Error(`Failed to derive Bitcoin address at index ${index}`);
    }
    return {
      privateKeyHex: `0x${bytesToHex(priv)}`,
      wif: privKeyToWIF(priv, testnet),
      address: payment.address
    };
  } finally {
    priv.fill(0);
  }
}

// --- Output formatting --------------------------------------------------

function printTable(rows, testnet) {
  console.log('');
  console.log(
    '========================================================================='
  );
  console.log('  libqc PRIVATE KEY EXPORT  —  HANDLE WITH CARE');
  console.log(
    '========================================================================='
  );
  console.log(
    '  Anyone with these keys can spend the funds. Do not share, screenshot,'
  );
  console.log('  paste into a chat, or store unencrypted.');
  console.log(`  Bitcoin network: ${testnet ? 'TESTNET' : 'MAINNET'}`);
  console.log('');
  console.log(
    '  BTC: import the WIF into Sparrow / Bluewallet / Ledger as a non-HD'
  );
  console.log('       account. Funds are immediately spendable.');
  console.log(
    '  EVM: the smart-account address is the address shown in libqc and the'
  );
  console.log(
    '       address that holds funds. Importing the EVM private key into'
  );
  console.log(
    '       MetaMask gives access only to the empty owner EOA. To move funds'
  );
  console.log(
    '       out, sign a UserOperation with the owner key and submit to any'
  );
  console.log('       ERC-4337 bundler.');
  console.log(
    '-------------------------------------------------------------------------'
  );
  for (const row of rows) {
    console.log(`Index ${row.index}`);
    console.log(`  EVM smart account : ${row.evm.smartAccountAddress}`);
    console.log(`  EVM owner EOA     : ${row.evm.ownerAddress}`);
    console.log(`  EVM private key   : ${row.evm.privateKeyHex}`);
    console.log(`  BTC address       : ${row.btc.address}`);
    console.log(`  BTC private key   : ${row.btc.privateKeyHex}`);
    console.log(`  BTC WIF           : ${row.btc.wif}`);
    console.log('');
  }
  console.log(
    '========================================================================='
  );
}

// --- Main ---------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.error('Run with --help for usage.');
    exit(2);
  }
  if (opts.help) {
    printHelpAndExit();
  }

  const raw = await readMnemonic(opts);
  const mnemonic = normalizeMnemonic(raw);
  const seed = mnemonicToSeedSync(mnemonic);

  try {
    const indices =
      opts.indices ??
      Array.from({ length: opts.count }, (_, i) => opts.start + i);

    // Sequential await: derivations are pure CPU + a synchronous CREATE2
    // computation, but `getKernelAddressFromECDSA` is async — keep the loop
    // simple and deterministic rather than racing through Promise.all.
    const rows = [];
    for (const index of indices) {
      rows.push({
        index,
        evm: await deriveEvm(seed, index),
        btc: deriveBtc(seed, index, opts.testnet)
      });
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          { network: opts.testnet ? 'testnet' : 'mainnet', accounts: rows },
          null,
          2
        )
      );
    } else {
      printTable(rows, opts.testnet);
    }
  } finally {
    seed.fill(0);
  }
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  exit(1);
});
