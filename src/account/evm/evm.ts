import { AccountId } from 'caip';
import { isAddress, PublicClient } from 'viem';
import type { AccountClientInterface, AccountStatus } from '../client';
import { type AccountConfig, getAccountConfig } from './config';
import { getAuthorizedAccount } from './authorized';
import { getReadOnlyAccount } from './readOnly';
import { calcNativeGasCost } from './emptyVault';
import type {
  EmptyVaultResult,
  EvmTxIdentifier,
  WithdrawalTxIdentifier
} from '../../types';
import { ActivityType, getActivities } from '../../activities';
import {
  getEntityByChainId,
  getNativeAsset,
  isErc20Token,
  isNativeAsset
} from '../../assets';
import { BundlerConfig } from '../../bundler';
import type { VaultEncryptionKeyWithMetadata } from '../../cryptography';
import {
  AssetEntityNotFoundError,
  InsufficientNativeBalanceForGasError,
  InvalidDestinationAddressError,
  InvalidAssetMetadataError,
  NonErc20TokenBalanceError,
  NoWithdrawableAssetsError,
  OnChainDecimalsMismatchError,
  UnsupportedAssetTypeError
} from '../../errors';
import {
  getErc20TokenBalanceByChain,
  getNativeBalance
} from '../../publicReads';
import {
  getLibQCState,
  zeroLibQCState,
  isEvmPersistedAddress,
  type EvmPersistedAddress,
  PersistedAccount
} from '../../state';
import { LibQCStorage } from '../../storage';
import {
  sendTransfer as performTransfer,
  getTransferGasCostEstimate
} from '../../transfers';
import {
  Activity,
  EvmAddress,
  Asset,
  BalanceResult,
  GasCostEstimate,
  GetActivityFilters,
  TransactionValue,
  type WithdrawalRecord
} from '../../types';
import {
  applyReconciliation,
  recordWithdrawal,
  type WithdrawalReconciliation
} from '../../withdrawals';

/**
 * EVM account client implementing AccountClientInterface
 *
 * Provides EVM-specific operations: getConfig, getTransferGasCostEstimate,
 * plus all AccountClientInterface methods (getBalance, getActivities, etc.)
 *
 * Instances are created via `LibQC.getAccount()` or `LibQC.createAccount()` for EVM chains.
 *
 * @example
 * ```typescript
 * const account = await vault.getAccount(accountId);
 *
 * // Check balance
 * const balance = await account.getBalance(asset);
 * ```
 */
export class EvmAccountClient implements AccountClientInterface {
  /**
   * Creates a new AccountClient instance
   *
   * Note: This constructor is internal and should not be called directly.
   * Use `LibQC.getAccount()` or `LibQC.createAccount()` instead.
   *
   * @param account - Persisted account data
   * @param storage - Storage implementation for persisting state
   * @param encryptionKey - Key for decrypting vault state
   * @param publicClient - Viem public client for blockchain reads
   * @param bundlerConfig - Configuration for the ERC-4337 bundler
   *
   * @internal
   */
  public constructor(
    private account: PersistedAccount,
    private storage: LibQCStorage,
    private encryptionKey: VaultEncryptionKeyWithMetadata,
    private publicClient: PublicClient,
    private bundlerConfig: BundlerConfig
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
   * Gets the token balance for the account
   *
   * For ERC-20 tokens the on-chain `decimals()` value is read from the
   * contract and compared against the entity decimals in assets.json.
   * If they disagree an {@link OnChainDecimalsMismatchError} is thrown
   * so that misconfigured asset metadata is surfaced immediately
   * rather than silently producing wrong balances.
   *
   * @param asset An asset (token or native) to fetch the balance for
   * @returns Balance result with balance, decimals, and symbol
   * @throws {AssetEntityNotFoundError} If the asset has no entity on this chain
   * @throws {NonErc20TokenBalanceError} If the asset is not an ERC-20 token
   * @throws {OnChainDecimalsMismatchError} If on-chain decimals differ from entity config
   */
  public async getBalance(asset: Asset): Promise<BalanceResult> {
    const accountId = this.account.id;
    const nativeAsset = getNativeAsset(this.publicClient.chain!);

    // If the asset is the native asset, then get the native balance.
    // We still verify that viem's chain decimals match the entity
    // definition so a misconfigured assets.json is caught immediately,
    // consistent with the ERC-20 check below.
    if (asset.id === nativeAsset.id) {
      const entity = getEntityByChainId(asset, this.account.chainId);
      if (!entity) {
        throw new AssetEntityNotFoundError(asset.id, this.account.chainId);
      }
      const result = await getNativeBalance(this.publicClient, accountId);
      if (result.decimals !== entity.decimals) {
        throw new OnChainDecimalsMismatchError(
          asset.id,
          this.account.chainId,
          entity.decimals,
          result.decimals
        );
      }
      if (result.symbol.toLowerCase() !== entity.symbol.toLowerCase()) {
        throw new InvalidAssetMetadataError(
          `On-chain symbol (${result.symbol}) for asset ${asset.id} on chain ${this.account.chainId.toString()} does not match entity symbol (${entity.symbol})`
        );
      }
      return result;
    }

    // Get the CAIP-19 entity for the asset on the chain
    const entity = getEntityByChainId(asset, this.account.chainId);

    // If there is no CAIP-19 entity for the asset on the chain, then the asset is not supported
    if (!entity) {
      throw new AssetEntityNotFoundError(asset.id, this.account.chainId);
    }

    // P11TODO: We don't allow non-ERC-20 tokens for now, though we should in the future
    if (!isErc20Token(asset, this.account.chainId)) {
      throw new NonErc20TokenBalanceError(asset.id, this.account.chainId);
    }

    const result = await getErc20TokenBalanceByChain(
      this.publicClient,
      accountId,
      entity.assetType.assetName.reference as EvmAddress
    );

    if (result.decimals !== entity.decimals) {
      throw new OnChainDecimalsMismatchError(
        asset.id,
        this.account.chainId,
        entity.decimals,
        result.decimals
      );
    }
    if (result.symbol.toLowerCase() !== entity.symbol.toLowerCase()) {
      throw new InvalidAssetMetadataError(
        `On-chain symbol (${result.symbol}) for asset ${asset.id} on chain ${this.account.chainId.toString()} does not match entity symbol (${entity.symbol})`
      );
    }

    return result;
  }

  /**
   * Gets the balances of an array of assets for the account
   *
   * Omitting the assets fetches the native token balances
   *
   * @param assets An optional array of assets (tokens or native) to fetch the balances for
   * @returns The balance results of the assets for the account
   */
  public async getBalances(assets: Asset[]): Promise<BalanceResult[]> {
    return Promise.all(assets.map(asset => this.getBalance(asset)));
  }

  /**
   * Gets the config for the account
   *
   * @returns The config for the account
   */
  public async getConfig(): Promise<AccountConfig> {
    const persistedAddress = await this.getPersistedAddressFromAccount();
    try {
      const res = await getAccountConfig(
        this.account.id,
        this.publicClient,
        persistedAddress.version
      );
      return res;
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Get activity for an account
   *
   * @param filters Optional activity filters
   * @returns Activity for the account
   */
  public async getActivities(
    filters?: GetActivityFilters
  ): Promise<Activity[]> {
    const assets = await this.listAssets();

    // Use the accounts assets by default
    const tokens = assets
      .filter(asset => isErc20Token(asset, this.account.chainId))
      .map(
        asset =>
          getEntityByChainId(asset, this.account.chainId)?.assetType.assetName
            .reference as EvmAddress | undefined
      )
      .filter(token => !!token);

    const rawActivities = await getActivities(
      this.account.id,
      this.publicClient,
      this.bundlerConfig,
      {
        tokens: tokens.length > 0 ? tokens : undefined,
        ...filters
      }
    );

    const explorerBase =
      this.publicClient.chain?.blockExplorers?.default.url ?? null;
    return rawActivities.map(activity => {
      const explorerUrl =
        explorerBase && activity.data.txHash
          ? `${explorerBase}/tx/${activity.data.txHash}`
          : null;
      if (activity.type === ActivityType.Erc20Transaction) {
        return { ...activity, data: { ...activity.data, explorerUrl } };
      }
      return { ...activity, data: { ...activity.data, explorerUrl } };
    });
  }

  /**
   * Get the estimated gas cost for a transfer
   *
   * Omitting the asset assumes the transfer will use the chain's native token
   *
   * @param amount The amount of the transfer
   * @param to The destination address or domain name
   * @param asset An optional asset (ERC-20 token or native)
   * @returns A gas cost estimate
   * @throws AssetEntityNotFoundError if the asset is not supported on the chain
   */
  public async getTransferGasCostEstimate(
    amount: TransactionValue,
    to: EvmAddress,
    asset?: Asset
  ): Promise<GasCostEstimate> {
    const persistedAddress = await this.getPersistedAddressFromAccount();
    try {
      const config = await this.getConfig();

      const readOnlyAccount = await getReadOnlyAccount(
        this.publicClient,
        this.getId(),
        persistedAddress,
        config.validatorConfig
      );
      const transferAsset = asset ?? getNativeAsset(this.publicClient.chain!);

      return getTransferGasCostEstimate({
        readOnlyAccount,
        amount,
        to,
        token: this.extractTokenAddress(transferAsset),
        publicClient: this.publicClient,
        bundlerConfig: this.bundlerConfig
      });
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Sends a transfer from this account
   *
   * Handles both native token transfers and ERC-20 token transfers.
   * Omitting the asset sends the chain's native token.
   *
   * @param amount The amount to transfer
   * @param to The destination address
   * @param asset An optional asset (ERC-20 token); omit for native token
   * @returns A transaction activity representing the transfer
   */
  private async sendTransfer(
    amount: TransactionValue,
    to: EvmAddress,
    asset?: Asset,
    gasLimits?: GasCostEstimate
  ): Promise<{ txIdentifier: EvmTxIdentifier }> {
    const persistedAddress = await this.getPersistedAddressFromAccount();
    try {
      const config = await this.getConfig();
      const authorizedAccount = await getAuthorizedAccount(
        this.publicClient,
        this.getId(),
        persistedAddress,
        config.validatorConfig,
        this.storage
      );
      const transferAsset = asset ?? getNativeAsset(this.publicClient.chain!);
      const token = this.extractTokenAddress(transferAsset);
      const result = await performTransfer({
        authorizedAccount,
        amount,
        to,
        token,
        publicClient: this.publicClient,
        bundlerConfig: this.bundlerConfig,
        gasLimits
      });
      const blockExplorers = this.publicClient.chain!.blockExplorers;
      const explorerBase = blockExplorers?.default.url ?? null;
      const explorerUrl = explorerBase
        ? `${explorerBase}/tx/${result.txHash}`
        : null;
      return {
        txIdentifier: {
          txHash: result.txHash,
          userOpHash: result.userOpHash,
          explorerUrl
        }
      };
    } finally {
      persistedAddress.secp256k1PrivateKey.fill(0);
    }
  }

  /**
   * Withdraws all supported assets from this account to a destination address
   *
   * Sends ERC-20 balances first, then the native asset last (after re-checking
   * the live balance to account for gas consumed by ERC-20 transfers).
   *
   * @param destinationAddress The destination address to receive all assets
   * @returns Summary of the completed empty-vault flow
   * @throws {InvalidDestinationAddressError} If the destination address is invalid
   * @throws {NoWithdrawableAssetsError} If no supported assets have a positive balance
   * @throws {InsufficientNativeBalanceForGasError} If the native balance exists but is entirely consumed by gas and no ERC-20s were transferred
   */
  public async emptyVault(
    destinationAddress: string
  ): Promise<EmptyVaultResult> {
    const accountId = this.getId();
    const chainId = accountId.chainId;

    if (!isAddress(destinationAddress)) {
      throw new InvalidDestinationAddressError(destinationAddress);
    }

    const to = destinationAddress;
    const assets = await this.listAssets();
    const balances = await this.getBalances(assets);

    const hasWithdrawableBalance = assets.some(
      (asset, index) =>
        (isErc20Token(asset, chainId) || isNativeAsset(asset, chainId)) &&
        balances[index].balance > 0n
    );

    if (!hasWithdrawableBalance) {
      throw new NoWithdrawableAssetsError(accountId.toString());
    }

    const assetBalances = assets.map((asset, i) => ({
      asset,
      balance: balances[i]
    }));

    // ERC-20: transfer each token sequentially to avoid userop nonce conflicts
    const txIdentifiers: WithdrawalTxIdentifier[] = [];
    let transferredErc20Count = 0;
    for (const { asset, balance } of assetBalances) {
      if (isErc20Token(asset, chainId) && balance.balance > 0n) {
        const { txIdentifier } = await this.sendTransfer(
          balance.balance as bigint as TransactionValue,
          to,
          asset
        );
        txIdentifiers.push({ chain: 'evm', data: txIdentifier });
        transferredErc20Count += 1;
      }
    }

    // Native: re-fetch balance after ERC-20 gas consumption, then send remainder minus gas
    let transferredNativeAsset = false;
    const nativeAsset = assets.find(a => isNativeAsset(a, chainId));
    if (nativeAsset) {
      const [liveBalance] = await this.getBalances([nativeAsset]);
      if (liveBalance.balance > 0n) {
        // Estimate with 1 wei, not the full balance. The bundler simulates the
        // UserOperation as-is, so passing the full balance would make the
        // execution revert (gas is also paid from the same balance, leaving
        // insufficient funds to complete the transfer). Gas cost for a native
        // transfer is independent of the amount, so 1 wei gives the same estimate.
        const estimate = await this.getTransferGasCostEstimate(
          1n as TransactionValue,
          to
        );
        const gasReserve = calcNativeGasCost(estimate);
        const amountToSend = liveBalance.balance - gasReserve;

        if (amountToSend > 0n) {
          const { txIdentifier } = await this.sendTransfer(
            amountToSend as TransactionValue,
            to,
            undefined,
            estimate
          );
          txIdentifiers.push({ chain: 'evm', data: txIdentifier });
          transferredNativeAsset = true;
        } else if (transferredErc20Count === 0) {
          // Native balance exists but is entirely consumed by gas, and no
          // ERC-20s were transferred — nothing was actually moved.
          throw new InsufficientNativeBalanceForGasError(accountId.toString());
        }
      }
    }

    // Guard against the race where the initial snapshot showed positive balance
    // but all live balances dropped to zero before any transfer was submitted.
    if (txIdentifiers.length === 0) {
      throw new NoWithdrawableAssetsError(accountId.toString());
    }

    const transferredAssetCount =
      transferredErc20Count + (transferredNativeAsset ? 1 : 0);

    // Best-effort persistence: transfers were already submitted/confirmed by
    // this point, so lifecycle persistence must not convert successful
    // on-chain sends into a failed emptyVault response.
    try {
      await recordWithdrawal(this.storage, this.encryptionKey, {
        accountId,
        destinationAddress: to,
        destinationChain: chainId.toString(),
        txRefs: txIdentifiers,
        initialStatus: 'sent'
      });
    } catch {
      // Lifecycle record persistence failure is non-fatal for emptyVault.
    }

    return {
      accountId: accountId.toString(),
      destinationAddress: to,
      destinationChain: chainId.toString(),
      transferredAssetCount,
      transferredNativeAsset,
      status: 'sent',
      txIdentifiers
    };
  }

  /**
   * Reconciles a withdrawal record against on-chain state (ENG-1791).
   *
   * EVM `emptyVault` waits for userop receipts and persists records with
   * status='sent', so reconciliation only needs to verify that the source
   * account holds no remaining withdrawable balance to advance to 'withdrawn'.
   *
   * @internal Used by `LibQC.refreshWithdrawalLifecycle`.
   */
  public async reconcileWithdrawalRecord(
    record: WithdrawalRecord
  ): Promise<WithdrawalRecord> {
    if (record.status === 'withdrawn' || record.status === 'failed') {
      return record;
    }

    const assets = await this.listAssets();
    const balances = await this.getBalances(assets);
    // Mirrors the BTC defensive guard (bitcoin.ts) and the existing pattern in
    // BitcoinAccountClient.getBalance: any non-positive balance counts as zero.
    // EVM balances are unsigned at the ABI level, so this is symmetry rather
    // than a present hazard — but keeps the two reconcile paths consistent.
    const sourceBalanceZero = balances.every(b => b.balance <= 0n);

    const reconciliation: WithdrawalReconciliation = {
      confirmed: true,
      sourceBalanceZero
    };
    return applyReconciliation(record, reconciliation);
  }

  /**
   * Lists all assets that have been added, filtered by the account's chain
   *
   * Only returns assets that have at least one entity on the account's chain
   *
   * @returns An array of added assets that are available on the account's chain
   */
  public async listAssets(): Promise<Asset[]> {
    const state = await getLibQCState(this.storage, this.encryptionKey);
    try {
      const allAssets = state.assets ?? [];

      // Filter assets to only those that have entities for the account's chain
      return allAssets.filter(asset =>
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
   * Checks if the public key is exposed
   *
   * If the account is not deployed, the public key is not exposed
   *
   * @returns Whether the public key is exposed
   */
  public async isPubKeyExposed(): Promise<boolean> {
    const code = await this.publicClient.getCode({
      address: this.account.address as EvmAddress
    });
    return !!code && code !== '0x' && code !== '0x0';
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
   * Gets the persisted EVM address from the account
   *
   * @returns The persisted EVM address
   */
  private async getPersistedAddressFromAccount(): Promise<EvmPersistedAddress> {
    const state = await getLibQCState(this.storage, this.encryptionKey);
    try {
      const persistedAddress = state.addresses.find(
        address => address.address === this.account.address
      );
      if (!persistedAddress) {
        throw new Error(`Address ${this.account.address} not found in state`);
      }
      if (!isEvmPersistedAddress(persistedAddress)) {
        throw new Error(
          `Expected EVM address for account ${this.account.id.toString()}`
        );
      }
      const clone = {
        ...persistedAddress,
        secp256k1PrivateKey: new Uint8Array(
          persistedAddress.secp256k1PrivateKey
        )
      };
      return clone as EvmPersistedAddress;
    } finally {
      zeroLibQCState(state);
    }
  }

  /**
   * Extracts the token address from an asset
   *
   * If the asset is native on this chain, returns undefined.
   * If the asset is an ERC-20 token, returns the token contract address.
   *
   * @param asset The asset to extract the token address from
   * @returns The token address or undefined for native assets
   * @throws AssetEntityNotFoundError if the asset is not supported on the chain
   * @throws UnsupportedAssetTypeError if the asset type is not supported (not native or ERC-20)
   */
  private extractTokenAddress(asset: Asset): EvmAddress | undefined {
    const nativeAsset = getNativeAsset(this.publicClient.chain!);

    // If the asset is the native asset for this chain, return undefined (no token address needed)
    if (asset.id === nativeAsset.id) {
      return undefined;
    }

    // Get the CAIP-19 entity for the asset on the chain
    const entity = getEntityByChainId(asset, this.account.chainId);

    // If there is no CAIP-19 entity for the asset on the chain, throw an error
    if (!entity) {
      throw new AssetEntityNotFoundError(asset.id, this.account.chainId);
    }

    // For ERC-20 tokens, return the contract address
    if (isErc20Token(asset, this.account.chainId)) {
      return entity.assetType.assetName.reference as EvmAddress;
    }

    // If we reach here, the asset is neither the native asset nor an ERC-20 token
    // This includes assets with other namespaces (erc721, erc1155, etc.) or misconfigurations
    throw new UnsupportedAssetTypeError(asset.id, this.account.chainId);
  }
}

/** @deprecated Use EvmAccountClient. Default export for backward compatibility. */
export default EvmAccountClient;
