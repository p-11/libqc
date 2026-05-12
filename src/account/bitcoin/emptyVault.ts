import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as secp from '@noble/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {
  InvalidDestinationAddressError,
  NoWithdrawableAssetsError
} from '../../errors';
import type { Secp256k1PrivateKeyBytes } from '../../cryptography';
import type { BitcoinAddress, Brand, TransactionHex } from '../../types';
import type { BitcoinUtxo } from './api';

// Configure @noble/secp256k1 hashing once at module load — required in
// environments (e.g. browsers) that do not ship a built-in HMAC-SHA256.
secp.hashes.hmacSha256 ??= (key, ...messages) => hmac(sha256, key, ...messages);
secp.hashes.sha256 ??= sha256;

// Minimal ECC adapter satisfying bitcoinjs-lib's TinySecp256k1Interface.
// Required for P2TR (Taproot / bech32m) address support: payments.p2tr()
// internally calls getEccLib() which throws if initEccLib() was never called.
bitcoin.initEccLib({
  isXOnlyPoint(p: Uint8Array): boolean {
    if (p.length !== 32) return false;
    try {
      // Lift 32-byte x-coordinate to a secp256k1 point (assume even y)
      const compressed = new Uint8Array(33);
      compressed[0] = 0x02;
      compressed.set(p, 1);
      secp.Point.fromBytes(compressed);
      return true;
    } catch {
      return false;
    }
  },

  xOnlyPointAddTweak(
    p: Uint8Array,
    tweak: Uint8Array
  ): { parity: 0 | 1; xOnlyPubkey: Uint8Array } | null {
    try {
      // Lift x-only pubkey (assume even y)
      const compressed = new Uint8Array(33);
      compressed[0] = 0x02;
      compressed.set(p, 1);
      const P = secp.Point.fromBytes(compressed);

      // Compute t*G where t is the tweak scalar
      const tG = secp.Point.fromBytes(secp.getPublicKey(tweak, true));

      // Compute Q = P + t*G and extract parity + x-only key
      const qCompressed = P.add(tG).toBytes(true); // [02/03, x(32)]
      const parity: 0 | 1 = qCompressed[0] === 0x02 ? 0 : 1;
      return { parity, xOnlyPubkey: qCompressed.slice(1) };
    } catch {
      return null;
    }
  }
});

export type BitcoinOutputScript = Brand<Uint8Array, 'BitcoinOutputScript'>;

type BuildSweepTransactionParams = {
  accountId: string;
  fromAddress: BitcoinAddress;
  outputScript: BitcoinOutputScript;
  utxos: BitcoinUtxo[];
  feeRateSatsPerVByte: number;
  privateKey: Secp256k1PrivateKeyBytes;
  network: bitcoin.Network;
};

// Segwit vbyte formula: vbytes = (non-witness_bytes × 4 + witness_bytes) / 4
//
// P2WPKH input breakdown:
//   Non-witness: 32 txid + 4 vout + 1 scriptSig len + 0 scriptSig + 4 sequence = 41 bytes
//   Witness:      1 item count + 1 sig len + 72 DER sig + 1 pubkey len + 33 pubkey = 108 bytes
//   Weight: 41 × 4 + 108 = 272 -> 272 / 4 = 68 vbytes
const P2WPKH_INPUT_VBYTES = 68n;

// Transaction overhead breakdown:
//   Non-witness: 4 version + 1 vin count + 1 vout count + 4 locktime = 10 bytes
//   Witness:     1 segwit marker (0x00) + 1 segwit flag (0x01) = 2 bytes
//   Weight: 10 × 4 + 2 = 42 -> ceil(42 / 4) = 11 vbytes
const TRANSACTION_OVERHEAD_VBYTES = 11n;

// Output overhead shared by all output types (all output bytes are non-witness):
//   8 value (little-endian uint64) + 1 script-length varint = 9 bytes -> 9 vbytes
// The script bytes themselves vary per address type and are added separately.
const OUTPUT_OVERHEAD_VBYTES = 9n;

// Bitcoin Core dust limits by output script length (at 3 sat/vByte dust relay rate).
// Outputs below these thresholds are rejected by standard relay nodes.
//
// Derivation: dust_limit = dust_relay_rate × (serialized_output_size + serialized_input_size)
//   P2WPKH (22 B script): 3 × (31 + 68) = 294 sats  (segwit discount applied to input)
//   P2SH   (23 B script): 3 × (32 + 148) = 540 sats  (non-segwit input size used by Core)
//   P2WSH / P2TR (34 B): 3 × (43 + 68) = 330 sats  (segwit discount; same limit for both)
//   P2PKH  (25 B script): 3 × (34 + 148) = 546 sats  (default / fallback for unknowns)
const DUST_LIMITS: ReadonlyMap<number, bigint> = new Map([
  [22, 294n], // P2WPKH
  [23, 540n], // P2SH
  [34, 330n], // P2WSH / P2TR (both produce 34-byte output scripts)
  [25, 546n] // P2PKH
]);
const DUST_LIMIT_FALLBACK = 546n;

/**
 * Validates a Bitcoin destination address for the given network and returns its output script.
 *
 * Supports P2PKH, P2SH, P2WPKH, P2WSH, and P2TR (Taproot / bech32m) address types.
 * The output script is returned so callers can pass it directly to estimateSweepTransaction /
 * buildSweepTransaction without recomputing it.
 *
 * @returns The validated address and its compiled output script
 * @throws {InvalidDestinationAddressError} If the address is not valid for the network
 */
export function validateBitcoinDestinationAddress(
  destinationAddress: string,
  network: bitcoin.Network
): { address: BitcoinAddress; outputScript: BitcoinOutputScript } {
  const outputScript = getDestinationOutputScript(destinationAddress, network);

  return { address: destinationAddress as BitcoinAddress, outputScript };
}

/**
 * Calculates the fee and net send amount for a sweep transaction without broadcasting.
 *
 * @returns `amountToSend` (totalInputValue - fee) and `fee` in satoshis.
 * @throws {NoWithdrawableAssetsError} If the net amount is zero, negative, or below the
 *   dust limit for the destination output type (Bitcoin nodes reject sub-dust outputs)
 */
export function estimateSweepTransaction({
  accountId,
  outputScript,
  utxos,
  feeRateSatsPerVByte
}: Pick<
  BuildSweepTransactionParams,
  'accountId' | 'outputScript' | 'utxos' | 'feeRateSatsPerVByte'
>): {
  amountToSend: bigint;
  fee: bigint;
} {
  const totalInputValue = utxos.reduce((sum, utxo) => sum + utxo.value, 0n);
  const fee = estimateSweepFee(
    utxos.length,
    outputScript.length,
    feeRateSatsPerVByte
  );
  const amountToSend = totalInputValue - fee;
  const dustLimit = DUST_LIMITS.get(outputScript.length) ?? DUST_LIMIT_FALLBACK;

  if (amountToSend < dustLimit) {
    throw new NoWithdrawableAssetsError(accountId);
  }

  return { amountToSend, fee };
}

/**
 * Compiles a validated destination address into the output script bytes used by
 * fee estimation and PSBT output construction.
 */
function getDestinationOutputScript(
  destinationAddress: string,
  network: bitcoin.Network
): BitcoinOutputScript {
  try {
    return bitcoin.address.toOutputScript(
      destinationAddress,
      network
    ) as BitcoinOutputScript;
  } catch {
    throw new InvalidDestinationAddressError(destinationAddress);
  }
}

/**
 * Builds, signs, and serializes a P2WPKH sweep transaction.
 *
 * Spends all provided UTXOs into a single output at `destinationAddress` with no
 * change output. The transaction is signed with `privateKeyHex` using ECDSA.
 *
 * @returns Raw transaction hex ready for broadcast
 * @throws {NoWithdrawableAssetsError} If the fee exceeds total UTXO value
 */
export function buildSweepTransaction({
  accountId,
  fromAddress,
  outputScript,
  utxos,
  feeRateSatsPerVByte,
  privateKey,
  network
}: BuildSweepTransactionParams): TransactionHex {
  const { amountToSend } = estimateSweepTransaction({
    accountId,
    outputScript,
    utxos,
    feeRateSatsPerVByte
  });

  const privateKeyBytes = privateKey;
  const publicKey = secp.getPublicKey(privateKeyBytes, true);
  const witnessScript = bitcoin.payments.p2wpkh({
    address: fromAddress,
    network
  }).output;

  if (!witnessScript) {
    throw new Error(`Failed to derive witness script for ${fromAddress}`);
  }

  const psbt = new bitcoin.Psbt({ network });

  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: witnessScript,
        value: utxo.value
      }
    });
  }

  psbt.addOutput({
    script: Buffer.from(outputScript),
    value: amountToSend
  });

  const signer = {
    publicKey,
    // bitcoinjs-lib passes the pre-computed 32-byte sighash; prehash: false
    // prevents secp v3 from applying an extra SHA-256 over it
    sign: (hash: Uint8Array): Uint8Array => {
      return secp.sign(hash, privateKeyBytes, { lowS: true, prehash: false });
    }
  };

  utxos.forEach((_, index) => {
    psbt.signInput(index, signer);
  });

  psbt.finalizeAllInputs();

  return psbt.extractTransaction().toHex() as TransactionHex;
}

/**
 * Estimates the virtual size fee for a sweep transaction targeting the given output script.
 *
 * Uses the fixed single-output sweep shape: transaction overhead + one output +
 * one P2WPKH input per UTXO being spent.
 */
function estimateSweepFee(
  inputCount: number,
  outputScriptLength: number,
  feeRateSatsPerVByte: number
): bigint {
  const normalizedFeeRate = Math.max(1, Math.ceil(feeRateSatsPerVByte));
  const outputVbytes = OUTPUT_OVERHEAD_VBYTES + BigInt(outputScriptLength);
  const vbytes =
    TRANSACTION_OVERHEAD_VBYTES +
    BigInt(inputCount) * P2WPKH_INPUT_VBYTES +
    outputVbytes;

  return vbytes * BigInt(normalizedFeeRate);
}
