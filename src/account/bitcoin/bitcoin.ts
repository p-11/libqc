import { AccountId } from 'caip';
import type { AccountClientInterface, AccountStatus } from '../client';
import {
  networks as bitcoinNetworks,
  type Network as BitcoinNetwork
} from 'bitcoinjs-lib';
import { getEntityByChainId, getNativeAsset } from '../../assets';
import { BITCOIN_TESTNET_REF } from '../../chain';

const MEMPOOL_SPACE_MAINNET_TX_URL = 'https://mempool.space/tx';
const MEMPOOL_SPACE_TESTNET_TX_URL = 'https://mempool.space/testnet/tx';
import {
  AssetEntityNotFoundError,
  InvalidAssetMetadataError,
  NoWithdrawableAssetsError,
  VaultCorruptedError
} from '../../errors';
import type { VaultEncryptionKeyWithMetadata } from '../../cryptography';
import {
  type BitcoinPersistedAddress,
  getLibQCState,
  zeroLibQCState
} from '../../state';
import { LibQCStorage } from '../../storage';
import type { BitcoinTransactionActivity } from '../../activities';
import type { PersistedAccount } from '../../state';
import {
  type Activity,
  ActivityType,
  type Asset,
  type BalanceBigInt,
  type BalanceResult,
  type BitcoinAddress,
  type BitcoinTransactionId,
  type GetActivityFilters,
  type WithdrawalRecord
} from '../../types';
import {
  applyReconciliation,
  recordWithdrawal,
  type WithdrawalReconciliation
} from '../../withdrawals';
import {
  type BitcoinOutputScript,
  buildSweepTransaction,
  estimateSweepTransaction,
  validateBitcoinDestinationAddress
} from './emptyVault';
import { ChainSpecification } from '../../publicClients';
import type { BitcoinChainApi, BitcoinUtxo } from './api';
import type { EmptyVaultResult, TransactionHex } from '../../types';

/**
 * Bitcoin account client implementing AccountClientInterface
 *
 * Uses Blockstream Esplora API for balance and transaction history.
 * Fetches data directly via fetch—no separate client abstraction.
 *
 * Instances are created via `LibQC.getAccount()` or `LibQC.createAccount()` for Bitcoin chains.
 *
 * @example
 * ```typescript
 * const account = await vault.getAccount(accountId);
 * const balance = await account.getBalance(asset);
 * ```
 */
export class BitcoinAccountClient implements AccountClientInterface {
  /**
   * Creates a new BitcoinAccountClient instance
   *
   * @param account - Persisted account data
   * @param storage - Storage implementation for persisting state
   * @param encryptionKey - Key for decrypting vault state
   * @param api - Bitcoin chain API for balance and transaction data
   * @param chainSpec - Chain specification for native asset lookup
   *
   * @internal
   */
  public constructor(
    private account: PersistedAccount,
    private storage: LibQCStorage,
    private encryptionKey: VaultEncryptionKeyWithMetadata,
    private api: BitcoinChainApi,
    private chainSpec: ChainSpecification
  ) {}

  /**
   * Public getter for the ID of the account
   *
   * @returns The account ID
   */
  public getId(): AccountId {
    return this.account.id;
  }

  /**
   * Gets the BTC balance for the account
   *
   * Only native BTC is supported; non-native assets throw AssetEntityNotFoundError.
   *
   * This fetches from Blockstream Esplora API: https://github.com/Blockstream/esplora/blob/master/API.md#get-addressaddress
   *
   * @param asset - Asset to fetch balance for (must be native BTC)
   * @returns Balance result with balance, decimals, and symbol.
   *   Decimals come from the asset entity definition (there is no
   *   on-chain decimals query for Bitcoin, unlike EVM ERC-20s).
   */
  public async getBalance(asset: Asset): Promise<BalanceResult> {
    const nativeAsset = getNativeAsset(this.chainSpec);
    const nativeCurrency = this.chainSpec.nativeCurrency;
    if (asset.id !== nativeAsset.id) {
      throw new AssetEntityNotFoundError(asset.id, this.account.chainId);
    }

    const entity = getEntityByChainId(asset, this.account.chainId);
    if (!entity) {
      // The asset is the native asset but has no entity for this
      // specific chain — indicates a misconfigured assets.json.
      throw new AssetEntityNotFoundError(asset.id, this.account.chainId);
    }
    if (entity.decimals !== nativeCurrency.decimals) {
      throw new InvalidAssetMetadataError(
        `Asset ${asset.id} on chain ${this.account.chainId.toString()} declares entity decimals (${entity.decimals}) that do not match Bitcoin native decimals (${nativeCurrency.decimals})`
      );
    }
    if (entity.symbol.toLowerCase() !== nativeCurrency.symbol.toLowerCase()) {
      throw new InvalidAssetMetadataError(
        `Asset ${asset.id} on chain ${this.account.chainId.toString()} declares entity symbol (${entity.symbol}) that does not match Bitcoin native symbol (${nativeCurrency.symbol})`
      );
    }

    const address = this.account.address as string;
    const { funded, spent } = await this.api.getBalance(address);
    const balanceSats = funded - spent;
    const balance = (balanceSats > 0n ? balanceSats : 0n) as BalanceBigInt;

    return {
      balance,
      decimals: entity.decimals,
      symbol: entity.symbol
    };
  }

  /**
   * Gets the balances for multiple assets
   *
   * @param assets - Assets to fetch balances for
   * @returns Balance results
   */
  public async getBalances(assets: Asset[]): Promise<BalanceResult[]> {
    return Promise.all(assets.map(asset => this.getBalance(asset)));
  }

  /**
   * Fetches transactions from the Bitcoin chain API and maps to BitcoinTransactionActivity[]
   */
  private async fetchActivities(): Promise<BitcoinTransactionActivity[]> {
    const activities = await this.api.getActivities(this.account.address);
    const network = this.getBitcoinNetwork();
    const explorerBase =
      network === bitcoinNetworks.testnet
        ? MEMPOOL_SPACE_TESTNET_TX_URL
        : MEMPOOL_SPACE_MAINNET_TX_URL;
    return activities.map(a => ({
      ...a,
      data: { ...a.data, explorerUrl: `${explorerBase}/${a.data.txid}` }
    }));
  }

  /**
   * Get activity (transaction history) for the account
   *
   * @param filters - Optional filters (types supported)
   * @returns Array of Bitcoin transaction activities
   */
  public async getActivities(
    filters?: GetActivityFilters
  ): Promise<Activity[]> {
    let activities = await this.fetchActivities();

    if (filters?.types) {
      activities = activities.filter(activity =>
        filters.types!.includes(activity.type)
      );
    }

    return activities;
  }

  /**
   * Lists assets available for the account (native BTC only)
   *
   * @returns Assets that have an entity on this Bitcoin chain
   */
  public async listAssets(): Promise<Asset[]> {
    const state = await getLibQCState(this.storage, this.encryptionKey);
    try {
      const allAssets = state.assets ?? [];
      const nativeAssetId = getNativeAsset(this.chainSpec).id;

      return allAssets.filter(
        asset =>
          asset.id === nativeAssetId ||
          asset.entities.some(
            entity =>
              entity.assetType.chainId.toString() ===
              this.account.chainId.toString()
          )
      );
    } finally {
      zeroLibQCState(state);
    }
  }

  /**
   * Returns whether the account's public key is exposed.
   *
   * A P2WPKH public key becomes visible the moment a spending transaction is
   * broadcast — not just when it confirms. This method checks both confirmed
   * on-chain transactions and pending mempool transactions so that the
   * vulnerability warning is shown as soon as the user sends, before confirmation.
   *
   * @returns true if the account has any confirmed or pending outgoing transaction
   */
  public async isPubKeyExposed(): Promise<boolean> {
    const address = this.account.address as BitcoinAddress;

    const [activities, mempoolTxs] = await Promise.all([
      this.getActivities({ types: [ActivityType.BitcoinTransaction] }),
      this.api.getMempoolTxs(address)
    ]);

    const hasConfirmedSpend = activities.some(activity =>
      activity.data.from.includes(address)
    );

    const hasMempoolSpend = mempoolTxs.some(tx =>
      tx.fromAddresses.includes(address)
    );

    return hasConfirmedSpend || hasMempoolSpend;
  }

  /**
   * Gets the safety status of the account
   *
   * @returns The safety status of the account
   */
  public async getStatus(): Promise<AccountStatus> {
    const isExposed = await this.isPubKeyExposed();
    return isExposed ? 'vulnerable' : 'safe';
  }

  /**
   * Sweeps all native BTC from this account to a destination address
   *
   * Bitcoin accounts only support their native BTC balance, so empty-vault is
   * a single sweep transaction with no change output.
   *
   * @param destinationAddress The destination Bitcoin address
   * @returns Summary of the completed empty-vault flow
   * @throws {InvalidDestinationAddressError} If the destination address is invalid
   * @throws {NoWithdrawableAssetsError} If no spendable BTC remains after fees
   */
  public async emptyVault(
    destinationAddress: string
  ): Promise<EmptyVaultResult> {
    const {
      accountId,
      network,
      persistedAddress,
      to,
      outputScript,
      utxos,
      feeRate
    } = await this.getSweepContext(destinationAddress);

    try {
      const txHex: TransactionHex = buildSweepTransaction({
        accountId: accountId.toString(),
        fromAddress: persistedAddress.address,
        outputScript,
        utxos,
        feeRateSatsPerVByte: feeRate,
        privateKey: persistedAddress.secp256k1PrivateKey,
        network
      });
      const txid: BitcoinTransactionId =
        await this.api.broadcastTransaction(txHex);

      const explorerUrl =
        network === bitcoinNetworks.testnet
          ? `${MEMPOOL_SPACE_TESTNET_TX_URL}/${txid}`
          : `${MEMPOOL_SPACE_MAINNET_TX_URL}/${txid}`;

      const txRefs = [
        {
          chain: 'bitcoin' as const,
          data: { txid, explorerUrl }
        }
      ];

      // Best-effort persistence: the on-chain transfer has already been
      // submitted at this point, so lifecycle persistence must not convert
      // a successful sweep into a failed API response.
      try {
        await recordWithdrawal(this.storage, this.encryptionKey, {
          accountId,
          destinationAddress: to,
          destinationChain: accountId.chainId.toString(),
          txRefs,
          initialStatus: 'pending'
        });
      } catch {
        // Lifecycle record persistence failure is non-fatal for emptyVault.
      }

      return {
        accountId: accountId.toString(),
        destinationAddress: to,
        destinationChain: accountId.chainId.toString(),
        transferredAssetCount: 1,
        transferredNativeAsset: true,
        status: 'pending',
        txIdentifiers: txRefs
      };
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Reconciles a withdrawal record against on-chain state (ENG-1791).
   *
   * Only operates on non-terminal records (pending/sent). Reads tx confirmation
   * status from the chain API and the source address balance. Returns the
   * record unchanged when no transition is warranted; the caller is responsible
   * for persisting transitions.
   *
   * @internal Used by `LibQC.refreshWithdrawalLifecycle`.
   */
  public async reconcileWithdrawalRecord(
    record: WithdrawalRecord
  ): Promise<WithdrawalRecord> {
    if (record.status === 'withdrawn' || record.status === 'failed') {
      return record;
    }

    const txids: BitcoinTransactionId[] = record.txRefs
      .filter(
        (
          ref
        ): ref is {
          chain: 'bitcoin';
          data: { txid: BitcoinTransactionId; explorerUrl: string | null };
        } => ref.chain === 'bitcoin'
      )
      .map(ref => ref.data.txid);

    const statuses = await Promise.all(
      txids.map(txid => this.api.getTxStatus(txid))
    );
    const confirmed =
      txids.length > 0 && statuses.every(status => status.confirmed);

    let sourceBalanceZero = false;
    if (confirmed) {
      const balance = await this.api.getBalance(this.account.address);
      // Mirrors the defensive guard in `getBalance` (line 135): treat any
      // non-positive net (`funded <= spent`) as zero withdrawable balance,
      // not strict equality. Esplora's `chain_stats` should not return
      // `spent > funded`, but the existing code already defends against it.
      sourceBalanceZero = balance.funded - balance.spent <= 0n;
    }

    const reconciliation: WithdrawalReconciliation = {
      confirmed,
      sourceBalanceZero
    };
    return applyReconciliation(record, reconciliation);
  }

  /**
   * Estimates the fee for sweeping all BTC from this account to a destination address
   *
   * @param destinationAddress The destination Bitcoin address
   * @returns Estimated fee in satoshis
   * @throws {InvalidDestinationAddressError} If the destination address is invalid
   * @throws {NoWithdrawableAssetsError} If no spendable BTC remains after fees
   */
  public async estimateEmptyVaultFee(
    destinationAddress: string
  ): Promise<bigint> {
    const { accountId, persistedAddress, outputScript, utxos, feeRate } =
      await this.getSweepContext(destinationAddress);

    try {
      return estimateSweepTransaction({
        accountId: accountId.toString(),
        outputScript,
        utxos,
        feeRateSatsPerVByte: feeRate
      }).fee;
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Gets the persisted Bitcoin address from the account
   *
   * @returns The persisted Bitcoin address
   */
  private async getPersistedAddressFromAccount(): Promise<BitcoinPersistedAddress> {
    const state = await getLibQCState(this.storage, this.encryptionKey);
    try {
      const persistedAddress = state.addresses.find(
        address => address.address === this.account.address
      );

      if (!persistedAddress) {
        throw new VaultCorruptedError(
          `address ${this.account.address} not found in persisted state`
        );
      }

      if (persistedAddress.chainType !== 'bitcoin') {
        throw new VaultCorruptedError(
          `expected Bitcoin address for account ${this.account.id.toString()}, got chainType '${persistedAddress.chainType}'`
        );
      }

      const clone = {
        ...persistedAddress,
        secp256k1PrivateKey: new Uint8Array(
          persistedAddress.secp256k1PrivateKey
        )
      };
      return clone as BitcoinPersistedAddress;
    } finally {
      zeroLibQCState(state);
    }
  }

  private getBitcoinNetwork(): BitcoinNetwork {
    return this.account.chainId.reference === BITCOIN_TESTNET_REF
      ? bitcoinNetworks.testnet
      : bitcoinNetworks.bitcoin;
  }

  /**
   * Validates the destination address and fetches the data needed to build or
   * estimate a sweep transaction: persisted private key, UTXOs, and fee rate.
   *
   * @throws {InvalidDestinationAddressError} If the destination address is invalid
   * @throws {NoWithdrawableAssetsError} If the account has no spendable balance
   */
  private async getSweepContext(destinationAddress: string): Promise<{
    accountId: AccountId;
    network: BitcoinNetwork;
    persistedAddress: BitcoinPersistedAddress;
    to: BitcoinAddress;
    outputScript: BitcoinOutputScript;
    utxos: BitcoinUtxo[];
    feeRate: number;
  }> {
    const accountId = this.getId();
    const network = this.getBitcoinNetwork();
    const { address: to, outputScript } = validateBitcoinDestinationAddress(
      destinationAddress,
      network
    );
    const nativeAsset = getNativeAsset(this.chainSpec);
    const balance = await this.getBalance(nativeAsset);

    if (balance.balance <= 0n) {
      throw new NoWithdrawableAssetsError(accountId.toString());
    }

    let persistedAddress: BitcoinPersistedAddress | undefined;
    let transferPersistedAddressOwnershipToCaller = false;

    try {
      persistedAddress = await this.getPersistedAddressFromAccount();
      const [rawUtxos, feeRate] = await Promise.all([
        this.api.getUtxos(persistedAddress.address),
        this.api.getFeeRateSatsPerVByte()
      ]);
      const utxos = rawUtxos.filter(utxo => utxo.value > 0n);

      if (utxos.length === 0) {
        throw new NoWithdrawableAssetsError(accountId.toString());
      }

      transferPersistedAddressOwnershipToCaller = true;
      return {
        accountId,
        network,
        persistedAddress,
        to,
        outputScript,
        utxos,
        feeRate
      };
    } finally {
      if (persistedAddress && !transferPersistedAddressOwnershipToCaller) {
        persistedAddress.secp256k1PrivateKey.fill(0);
      }
    }
  }
}
