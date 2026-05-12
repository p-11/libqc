import type { BitcoinTransactionActivity } from '../../activities';
import type {
  BitcoinAddress,
  BitcoinTransactionId,
  TransactionHex
} from '../../types';

/**
 * Balance data returned from a Bitcoin chain API
 */
export interface BitcoinBalanceData {
  /** Total funded amount in satoshis */
  funded: bigint;
  /** Total spent amount in satoshis */
  spent: bigint;
}

/**
 * Spendable Bitcoin UTXO returned from a chain API
 */
export interface BitcoinUtxo {
  /** Transaction id containing the output */
  txid: BitcoinTransactionId;
  /** Output index within the transaction */
  vout: number;
  /** Output value in satoshis */
  value: bigint;
}

/**
 * Mempool transaction sender data — enough for key-exposure checks without the
 * full confirmed-activity schema (which requires a confirmed block height).
 */
export interface BitcoinMempoolTx {
  txid: BitcoinTransactionId;
  fromAddresses: BitcoinAddress[];
}

/**
 * Confirmation status for a Bitcoin transaction (ENG-1791).
 *
 * Used by the SDK-owned withdrawal lifecycle to deterministically advance
 * a record from 'pending' → 'sent' once the broadcast tx confirms on-chain.
 */
export interface BitcoinTxStatus {
  /** True once the tx has at least one block confirmation */
  confirmed: boolean;
}

/**
 * Interface for Bitcoin chain APIs
 *
 * Abstracts the source of balance, transaction, and sweep data, allowing
 * different implementations (e.g. Esplora, Electrum) to be used interchangeably.
 */
export interface BitcoinChainApi {
  /**
   * Fetches balance data for an address
   *
   * @param address - Bitcoin address to query
   * @returns Funded and spent amounts in satoshis
   */
  getBalance(address: string): Promise<BitcoinBalanceData>;

  /**
   * Fetches transaction activities for an address
   *
   * @param address - Bitcoin address to query
   * @returns Sorted array of transaction activities (most recent first)
   */
  getActivities(address: string): Promise<BitcoinTransactionActivity[]>;

  /**
   * Fetches the current fee rate in satoshis per virtual byte
   *
   * @returns Recommended fee rate (sat/vB), floored at 1
   */
  getFeeRateSatsPerVByte(): Promise<number>;

  /**
   * Fetches spendable UTXOs for an address
   *
   * @param address - Bitcoin address to query
   * @returns Array of unspent outputs available for spending
   */
  getUtxos(address: string): Promise<BitcoinUtxo[]>;

  /**
   * Fetches unconfirmed (mempool) transactions for an address
   *
   * Used to detect key exposure from pending outgoing transactions that have not
   * yet been confirmed on-chain. The public key is visible in mempool spends just
   * as it is in confirmed ones.
   *
   * @param address - Bitcoin address to query
   * @returns Array of mempool transactions with their sender addresses
   */
  getMempoolTxs(address: string): Promise<BitcoinMempoolTx[]>;

  /**
   * Broadcasts a signed raw transaction and returns its txid
   *
   * @param txHex - Raw transaction hex
   * @returns The transaction ID of the broadcast transaction
   */
  broadcastTransaction(txHex: TransactionHex): Promise<BitcoinTransactionId>;

  /**
   * Fetches confirmation status for a transaction (ENG-1791).
   *
   * Returns `{ confirmed: false }` for unknown or mempool-only txs and
   * `{ confirmed: true }` once the tx is included in a block.
   *
   * @param txid - Bitcoin transaction id to query
   */
  getTxStatus(txid: BitcoinTransactionId): Promise<BitcoinTxStatus>;
}
