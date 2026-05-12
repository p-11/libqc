/**
 * Esplora Bitcoin API implementation
 *
 * This module implements BitcoinChainApi using the Blockstream Esplora REST API.
 * It handles balance lookup and transaction history, mapping Esplora's response
 * format to our internal activity types.
 *
 * **Key behaviours:**
 * - Balance: funded_txo_sum - spent_txo_sum from address endpoint
 * - Activities: Only confirmed txs with non-zero net (incoming/outgoing) are shown
 * - Mempool txs and net-zero (e.g. change) are omitted
 * - 'unknown' used for coinbase inputs and non-address outputs (OP_RETURN, etc.)
 */
import type {
  BitcoinChainApi,
  BitcoinBalanceData,
  BitcoinMempoolTx,
  BitcoinTxStatus,
  BitcoinUtxo
} from './api';
import type { BitcoinTransactionActivity } from '../../activities';
import { ActivityType } from '../../activities';
import {
  type BitcoinAddress,
  type BitcoinTransactionId,
  type BlockNumber,
  type TransactionHex,
  type TransactionValue
} from '../../types';

/**
 * Esplora API prevout (spent output reference)
 *
 * Present on each vin; describes the UTXO being spent. May be absent for coinbase
 * inputs (mining rewards) which have no prior output.
 */
interface EsploraPrevout {
  value: number;
  scriptpubkey_address?: string;
}

/**
 * Esplora API transaction input (vin)
 *
 * References a previous output being spent. prevout is absent for coinbase
 * inputs (block reward to miner).
 */
interface EsploraVin {
  prevout?: EsploraPrevout;
}

/**
 * Esplora API transaction output (vout)
 *
 * scriptpubkey_address may be absent for non-standard outputs (OP_RETURN,
 * provably unspendable, etc.) which cannot receive funds.
 */
interface EsploraVout {
  value: number;
  scriptpubkey_address?: string;
}

/**
 * Esplora API transaction
 *
 * status.block_height is present when confirmed; absent for mempool txs.
 */
interface EsploraTx {
  txid: string;
  status?: { block_height?: number };
  vin: EsploraVin[];
  vout: EsploraVout[];
}

/**
 * Esplora API address endpoint response
 *
 * chain_stats aggregates all UTXOs: funded = total received, spent = total sent.
 * Balance = funded - spent.
 */
interface EsploraAddressResponse {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
}

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
}

function isEsploraUtxoArray(value: unknown): value is EsploraUtxo[] {
  return (
    Array.isArray(value) &&
    value.every(utxo => {
      if (typeof utxo !== 'object' || utxo === null) {
        return false;
      }

      const candidate = utxo as Record<string, unknown>;

      return (
        typeof candidate.txid === 'string' &&
        typeof candidate.vout === 'number' &&
        typeof candidate.value === 'number' &&
        Number.isFinite(candidate.value) &&
        candidate.value >= 0
      );
    })
  );
}

/** Result of calculating received and sent amounts for a transaction */
interface ReceivedAndSent {
  received: bigint;
  sent: bigint;
}

/**
 * Calculates the received and sent amounts for an address in a transaction
 *
 * Received: Sum of all vouts where scriptpubkey_address matches our address
 * (outputs paying us). Includes change outputs back to self.
 *
 * Sent: Sum of all vins where prevout.scriptpubkey_address matches our address
 * (inputs we're spending from our own UTXOs).
 *
 * Net = received - sent. Positive = incoming payment; negative = outgoing.
 *
 * @param tx - Esplora transaction
 * @param address - Our Bitcoin address
 * @returns Object with received and sent amounts in satoshis
 */
function calculateReceivedAndSent(
  tx: EsploraTx,
  address: string
): ReceivedAndSent {
  let received = 0n;
  let sent = 0n;

  const vouts = Array.isArray(tx.vout) ? tx.vout : [];
  for (const vout of vouts) {
    if (vout.scriptpubkey_address === address) {
      received += BigInt(vout.value);
    }
  }

  const vins = Array.isArray(tx.vin) ? tx.vin : [];
  for (const vin of vins) {
    const prevout = vin.prevout;
    if (prevout?.scriptpubkey_address === address) {
      sent += BigInt(prevout.value);
    }
  }

  return { received, sent };
}

/**
 * Collects unique source addresses from transaction inputs (vins)
 *
 * When 'unknown' is used:
 * - Coinbase inputs (vin has no prevout) – mining reward, no prior sender
 * - Malformed API response (prevout missing)
 * - Empty vins array: returns ['unknown'] (e.g. coinbase-only tx)
 *
 * Multi-input case: Multiple vins from different addresses (e.g. UTXO
 * consolidation) produce multiple entries in the from array.
 *
 * @param vins - Transaction inputs
 * @returns Array of unique source addresses, or ['unknown'] if none found
 */
function collectFromAddresses(vins: EsploraVin[]): BitcoinAddress[] {
  const fromAddrs = new Set<BitcoinAddress>();
  for (const vin of vins) {
    const scriptAddr = vin.prevout?.scriptpubkey_address;
    fromAddrs.add((scriptAddr ?? 'unknown') as BitcoinAddress);
  }
  return fromAddrs.size > 0
    ? [...fromAddrs]
    : (['unknown'] as BitcoinAddress[]);
}

/**
 * Maps an Esplora transaction to a BitcoinTransactionActivity, or returns null if skipped
 *
 * - Unconfirmed tx: status.block_height is absent (mempool) – we only show confirmed
 * - Net zero: received === sent (change back to self, internal consolidation)
 *
 * Incoming (net > 0):
 * - to = our address; value = net received
 * - from = unique vin source addresses (senders)
 *
 * Outgoing (net < 0):
 * - to = first vout that isn't our address (recipient), or 'unknown' if all
 *   vouts pay us (e.g. OP_RETURN burn, provably unspendable)
 * - value = |net| (positive amount sent)
 * - from includes our address (we were one of the spenders)
 *
 * @param tx - Esplora transaction
 * @param address - Our Bitcoin address
 * @returns Activity if included, null if skipped
 */
function mapEsploraTxToActivity(
  tx: EsploraTx,
  address: string
): BitcoinTransactionActivity | null {
  const blockHeight = tx.status?.block_height;
  if (blockHeight == null) {
    return null; // omit unconfirmed (mempool) transactions
  }

  const blockNumber = BigInt(blockHeight) as BlockNumber;
  const { received, sent } = calculateReceivedAndSent(tx, address);
  const net = received - sent;

  if (net === 0n) {
    return null;
  }

  const ourAddr = address as BitcoinAddress;
  const vins = Array.isArray(tx.vin) ? tx.vin : [];
  const vouts = Array.isArray(tx.vout) ? tx.vout : [];
  const fromAddresses = collectFromAddresses(vins);

  if (net > 0n) {
    return {
      type: ActivityType.BitcoinTransaction,
      blockNumber,
      data: {
        from: fromAddresses,
        to: ourAddr,
        value: net as TransactionValue,
        txid: tx.txid,
        explorerUrl: null // enriched by BitcoinAccountClient using network-specific URL
      }
    };
  }

  const firstVout = vouts.find(v => v.scriptpubkey_address !== address);
  const toAddr = (firstVout?.scriptpubkey_address ??
    'unknown') as BitcoinAddress;
  return {
    type: ActivityType.BitcoinTransaction,
    blockNumber,
    data: {
      from: fromAddresses,
      to: toAddr,
      value: -net as TransactionValue,
      txid: tx.txid,
      explorerUrl: null
    }
  };
}

/**
 * Bitcoin chain API implementation using the Blockstream Esplora API
 *
 * Uses the Esplora REST API for balance and transaction data.
 * See: https://github.com/Blockstream/esplora/blob/master/API.md
 */
export class EsploraBitcoinApi implements BitcoinChainApi {
  /**
   * Creates an Esplora API client
   *
   * @param baseUrl - Esplora API base URL (e.g. https://blockstream.info/api)
   */
  public constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private readonly baseUrl: string;

  private getUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = this.getUrl(path);
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `Bitcoin API error: ${res.status} ${res.statusText} (${url})`
      );
    }

    return (await res.json()) as T;
  }

  /**
   * {@inheritDoc BitcoinChainApi.getBalance}
   *
   * - API returns 4xx/5xx: throws (rate limit, downtime, invalid address)
   * - Success: returns funded/spent from chain_stats (balance = funded - spent)
   * - Missing chain_stats fields: default to 0
   */
  public async getBalance(address: string): Promise<BitcoinBalanceData> {
    const data = await this.fetchJson<EsploraAddressResponse>(
      `/address/${address}`
    );
    const { funded_txo_sum = 0, spent_txo_sum = 0 } = data.chain_stats;

    return {
      funded: BigInt(funded_txo_sum),
      spent: BigInt(spent_txo_sum)
    };
  }

  /**
   * {@inheritDoc BitcoinChainApi.getActivities}
   *
   * 1. Fetch raw txs from Esplora (throws on API error, returns [] on malformed)
   * 2. Map each tx via mapEsploraTxToActivity (skips unconfirmed, net-zero)
   * 3. Sort by block number descending (newest first)
   *
   * **When activities are omitted:** Unconfirmed (mempool) txs and net-zero txs
   * (e.g. change back to self) are not included.
   */
  public async getActivities(
    address: string
  ): Promise<BitcoinTransactionActivity[]> {
    const rawTxs = await this.fetchJson<EsploraTx[]>(`/address/${address}/txs`);
    const txs = Array.isArray(rawTxs) ? rawTxs : [];
    const activities: BitcoinTransactionActivity[] = [];

    for (const tx of txs) {
      const activity = mapEsploraTxToActivity(tx, address);
      if (activity !== null) {
        activities.push(activity);
      }
    }

    return activities.sort((a, b) =>
      b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0
    );
  }

  /**
   * {@inheritDoc BitcoinChainApi.getUtxos}
   */
  public async getUtxos(address: string): Promise<BitcoinUtxo[]> {
    const utxos = await this.fetchJson<unknown>(`/address/${address}/utxo`);

    if (!isEsploraUtxoArray(utxos)) {
      return [];
    }

    return utxos.map(utxo => ({
      txid: utxo.txid as BitcoinTransactionId,
      vout: utxo.vout,
      value: BigInt(utxo.value)
    }));
  }

  /**
   * {@inheritDoc BitcoinChainApi.getFeeRateSatsPerVByte}
   */
  public async getFeeRateSatsPerVByte(): Promise<number> {
    const feeEstimates =
      await this.fetchJson<Partial<Record<string, number>>>('/fee-estimates');

    // Prefer the 1-block target for urgency; fall back to 2-block, then 6-block
    // (next hour), then a safe floor of 1 sat/vByte if the API returns nothing useful.
    return feeEstimates['1'] ?? feeEstimates['2'] ?? feeEstimates['6'] ?? 1;
  }

  /**
   * {@inheritDoc BitcoinChainApi.getMempoolTxs}
   */
  public async getMempoolTxs(address: string): Promise<BitcoinMempoolTx[]> {
    const rawTxs = await this.fetchJson<EsploraTx[]>(
      `/address/${address}/txs/mempool`
    );
    const txs = Array.isArray(rawTxs) ? rawTxs : [];

    return txs.map(tx => ({
      txid: tx.txid as BitcoinTransactionId,
      fromAddresses: collectFromAddresses(Array.isArray(tx.vin) ? tx.vin : [])
    }));
  }

  /**
   * {@inheritDoc BitcoinChainApi.broadcastTransaction}
   */
  public async broadcastTransaction(
    txHex: TransactionHex
  ): Promise<BitcoinTransactionId> {
    const url = this.getUrl('/tx');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: txHex
    });

    if (!res.ok) {
      throw new Error(
        `Bitcoin API error: ${res.status} ${res.statusText} (${url})`
      );
    }

    return (await res.text()).trim() as BitcoinTransactionId;
  }

  /**
   * {@inheritDoc BitcoinChainApi.getTxStatus}
   *
   * Esplora returns 404 for unknown txs (we report unconfirmed) and a
   * `{ confirmed, block_height? }` payload otherwise.
   */
  public async getTxStatus(
    txid: BitcoinTransactionId
  ): Promise<BitcoinTxStatus> {
    const url = this.getUrl(`/tx/${txid}/status`);
    const res = await fetch(url);

    if (res.status === 404) {
      return { confirmed: false };
    }

    if (!res.ok) {
      throw new Error(
        `Bitcoin API error: ${res.status} ${res.statusText} (${url})`
      );
    }

    const data = (await res.json()) as { confirmed?: boolean };
    return { confirmed: data.confirmed === true };
  }
}
