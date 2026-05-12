/**
 * Type organization rule:
 *
 * - Types should be colocated with the code that owns or primarily uses them.
 *
 * - This file is only for standalone or shared types that are reused
 *   across multiple files or features and don't belong to one module.
 */
// The goal is to remove `viem` from client depdencies, as such we re-export the types needed here.
import { AssetType } from 'caip';
import { Address as ViemAddress, Hex } from 'viem';
import { ActivityType } from './activities';

// Generic branding utility
export type Brand<T, B> = T & { readonly __brand: B };

// Strongly-typed aliases
export type BalanceBigInt = Brand<bigint, 'BalanceBigInt'>;
export type TotalSupplyBigInt = Brand<bigint, 'TotalSupplyBigInt'>;
export type Decimals = Brand<number, 'Decimals'>;
export type Symbol = Brand<string, 'Symbol'>;
export type IconUrl = Brand<string, 'IconUrl'>;
export type ChainName = Brand<string, 'ChainName'>;
export type ChainNetwork = Brand<string, 'ChainNetwork'>;
export type RpcUrl = Brand<string, 'RpcUrl'>;
export type Testnet = Brand<boolean, 'isTestnet'>;
export type AddressIndex = Brand<number, 'AddressIndex'>;
/** EVM address (0x-prefixed hex, 20 bytes) - compatible with viem */
export type EvmAddress = ViemAddress;

/** Bitcoin address (Bech32, legacy, etc.) */
export type BitcoinAddress = Brand<string, 'BitcoinAddress'>;
export type BitcoinTransactionId = Brand<string, 'BitcoinTransactionId'>;
export type TransactionHex = Brand<string, 'TransactionHex'>;

/** Union for chain-agnostic address handling */
export type Address = EvmAddress | BitcoinAddress;

export type ValidatorAddress = Brand<EvmAddress, 'ValidatorAddress'>;
export type BlockNumber = Brand<bigint, 'BlockNumber'>;
export type TransactionValue = Brand<bigint, 'TransactionValue'>;
export type GasCostEstimate = {
  /** The gas limit for the actual execution of the transaction */
  callGasLimit: CallGasLimit;
  /** The gas required for pre-verification steps */
  preVerificationGas: PreVerificationGas;
  /** The gas limit allocated for the verification process */
  verificationGasLimit: VerificationGasLimit;
  /** Optional paymaster verification gas for EntryPoint user ops */
  paymasterVerificationGasLimit?: PaymasterVerificationGasLimit;
  /** Optional paymaster post-op gas for EntryPoint user ops */
  paymasterPostOpGasLimit?: PaymasterPostOpGasLimit;
  /** Live maxFeePerGas from the bundler used during estimation (wei/gas) */
  maxFeePerGas: bigint;
  /** Live maxPriorityFeePerGas from the bundler used during estimation (wei/gas) */
  maxPriorityFeePerGas: bigint;
};
export type CallGasLimit = Brand<bigint, 'CallGasLimit'>;
export type PreVerificationGas = Brand<bigint, 'PreVerificationGas'>;
export type VerificationGasLimit = Brand<bigint, 'VerificationGasLimit'>;
export type PaymasterVerificationGasLimit = Brand<
  bigint,
  'PaymasterVerificationGasLimit'
>;
export type PaymasterPostOpGasLimit = Brand<bigint, 'PaymasterPostOpGasLimit'>;

/**
 * Branded byte buffer for password secret material.
 *
 * Ownership contract:
 * - `Password.from(...)` creates a fresh copy.
 * - The returned buffer is caller-owned.
 * - The caller must wipe it with `fill(0)` as soon as it is no longer needed.
 *
 * `Password` is a plain `Uint8Array` brand, so cleanup is explicit and manual.
 */
declare const PasswordBrand: unique symbol;
export type Password = Uint8Array & { readonly [PasswordBrand]?: never };

/**
 * Password helpers.
 */
export const Password = {
  /**
   * Returns a fresh caller-owned password buffer.
   *
   * @param value - Source bytes to copy
   * @returns New password buffer (caller must wipe via `fill(0)` when done)
   */
  from: (value: Uint8Array): Password => {
    return new Uint8Array(value) as Password;
  }
};

export type ForceNewAddress = Brand<boolean, 'ForceNewAddress'>;

// Mnemonics
/**
 * Branded byte buffer for mnemonic secret material.
 *
 * Ownership contract:
 * - `Mnemonic.from(...)` creates a fresh copy.
 * - The returned buffer is caller-owned.
 * - The caller must wipe it with `fill(0)` as soon as it is no longer needed.
 *
 * `Mnemonic` is a plain `Uint8Array` brand, so cleanup is explicit and manual.
 */
declare const MnemonicBrand: unique symbol;
export type Mnemonic = Uint8Array & { readonly [MnemonicBrand]?: never };

/**
 * Mnemonic helpers.
 */
export const Mnemonic = {
  /**
   * Returns a fresh caller-owned mnemonic buffer.
   *
   * Accepts either a `Uint8Array` or a serialized numeric-object representation.
   *
   * @param value - Source bytes/object to copy
   * @returns New mnemonic buffer (caller must wipe via `fill(0)` when done)
   */
  from: (value: Uint8Array | Record<number, number>): Mnemonic => {
    if (!(value instanceof Uint8Array) && typeof value === 'object') {
      return new Uint8Array(Object.values(value)) as Mnemonic;
    }
    return new Uint8Array(value) as Mnemonic;
  }
};

export type MnemonicWord = Brand<string, 'MnemonicWord'>;
export const MnemonicWord = {
  from: (value: string): MnemonicWord => value as MnemonicWord
};

export type MnemonicIndex = Brand<number, 'MnemonicIndex'>;
export const MnemonicIndex = {
  from: (value: number): MnemonicIndex => value as MnemonicIndex
};

export type IsValidMnemonic = Brand<boolean, 'IsValidMnemonic'>;
export type IsValidPassword = Brand<boolean, 'IsValidPassword'>;

/**
 * Branded byte buffer for mnemonic entropy (16-32 bytes).
 */
declare const EntropyBrand: unique symbol;
export type Entropy = Uint8Array & { readonly [EntropyBrand]?: never };
export const Entropy = {
  from: (value: Uint8Array | Record<number, number>): Entropy => {
    if (!(value instanceof Uint8Array) && typeof value === 'object') {
      return new Uint8Array(Object.values(value)) as Entropy;
    }
    return new Uint8Array(value) as Entropy;
  }
};

/**
 * Branded byte buffer for BIP-39 seed (64 bytes).
 */
declare const SeedBrand: unique symbol;
export type Seed = Uint8Array & { readonly [SeedBrand]?: never };
export const Seed = {
  from: (value: Uint8Array | Record<number, number>): Seed => {
    if (!(value instanceof Uint8Array) && typeof value === 'object') {
      return new Uint8Array(Object.values(value)) as Seed;
    }
    return new Uint8Array(value) as Seed;
  }
};

// User Operations
export type UserOperationValue = Brand<bigint, 'UserOperationValue'>;
export type UserOperationData = Brand<Hex, 'UserOperationData'>;
export type UserOperationCall = {
  to: EvmAddress;
  value: UserOperationValue;
  data: UserOperationData;
};

// Base composable types for token/asset metadata
export interface TokenMetadata {
  symbol: Symbol;
  decimals: Decimals;
}

export interface TokenInfo extends TokenMetadata {
  name: AssetName;
}

export interface BalanceResult extends TokenMetadata {
  balance: BalanceBigInt;
}

export type MnemonicGuess = {
  word: MnemonicWord;
  index: MnemonicIndex;
};

export type GetActivityFilters = {
  /** ERC-20 token addresses to filter by (EVM-specific) */
  tokens?: EvmAddress[];
  types?: ActivityType[];
};

export type AssetId = Brand<string, 'AssetId'>;
export type AssetName = Brand<string, 'AssetName'>;

export interface Asset extends TokenInfo {
  id: AssetId;
  iconUrl: IconUrl;
  entities: AssetEntity[];
}

export interface AssetEntity extends TokenInfo {
  assetType: AssetType;
}

export interface TokenDetails extends TokenInfo {
  totalSupply: TotalSupplyBigInt;
}

/**
 * Lifecycle status of a transfer operation (ENG-1708).
 *
 * - 'pending': submitted to the bundler/mempool, not yet confirmed on-chain
 * - 'sent': confirmed on-chain (terminal success)
 * - 'failed': rejected or failed to confirm (terminal failure)
 */
export type TransferStatus = 'pending' | 'sent' | 'failed';

/**
 * On-chain transaction identifier for a completed EVM transfer (ENG-170).
 *
 * explorerUrl is null when the chain has no configured block explorer.
 */
export type EvmTxIdentifier = {
  /** Actual on-chain transaction hash */
  txHash: `0x${string}`;
  /** ERC-4337 user operation hash */
  userOpHash: `0x${string}`;
  /** Block explorer URL for this transaction, or null if unavailable */
  explorerUrl: string | null;
};

/**
 * On-chain transaction identifier for a completed Bitcoin transfer (ENG-170).
 *
 * explorerUrl is null for unknown or custom networks with no configured explorer.
 */
export type BitcoinTxIdentifier = {
  /** Bitcoin transaction ID */
  txid: BitcoinTransactionId;
  /** Block explorer URL for this transaction, or null if unavailable */
  explorerUrl: string | null;
};

/**
 * Chain-discriminated transaction identifier for a completed withdrawal (ENG-170).
 */
export type WithdrawalTxIdentifier =
  | { chain: 'evm'; data: EvmTxIdentifier }
  | { chain: 'bitcoin'; data: BitcoinTxIdentifier };

/**
 * Lifecycle status of a vault withdrawal, owned and persisted by the SDK
 * (ENG-1791). Distinct from `TransferStatus`, which describes a single
 * transfer submission.
 *
 * - 'pending': submitted on-chain, not yet confirmed (BTC starts here)
 * - 'sent': confirmed on-chain (EVM starts here; BTC reaches it after confirmation)
 * - 'withdrawn': terminal success — confirmed AND source balance fully swept
 * - 'failed': terminal failure observed during reconciliation (e.g. reverted tx)
 *
 * Transitions are deterministic: pending → sent → withdrawn. The 'failed' state
 * is only set during reconciliation when an explicit non-throw failure is observed.
 */
export type WithdrawalLifecycleStatus =
  | 'pending'
  | 'sent'
  | 'withdrawn'
  | 'failed';

/**
 * SDK-owned withdrawal lifecycle record persisted in encrypted state (ENG-1791).
 *
 * One record is appended per `emptyVault` call. Records are append-only and
 * keyed by a generated UUID; multiple records may exist per account if the
 * user re-deposits and sweeps again.
 *
 * Lifecycle is advanced by `LibQC.refreshWithdrawalLifecycle()`, which
 * reconciles tx confirmation and source-balance state with the chain.
 */
export type WithdrawalRecord = {
  /** Stable per-record identifier (UUID v4) */
  id: string;
  /** CAIP-10 account ID of the swept account */
  accountId: string;
  /** Destination that received the swept funds */
  destinationAddress: Address;
  /** CAIP-2 chain ID of the account being swept */
  destinationChain: string;
  /** Current lifecycle status (deterministic transitions) */
  status: WithdrawalLifecycleStatus;
  /** Per-transaction identifiers for each submitted on-chain transaction */
  txRefs: WithdrawalTxIdentifier[];
  /** ms-epoch when emptyVault was first invoked and a record was persisted */
  initiatedAt: number;
  /** ms-epoch when the chain confirmed all submitted transactions */
  sentAt: number | null;
  /** ms-epoch when the source balance reached zero post-confirmation */
  completedAt: number | null;
  /** ms-epoch when reconciliation observed an explicit failure */
  failedAt: number | null;
};

/**
 * Result returned by any account client's emptyVault method.
 *
 * Shared across EVM and Bitcoin account clients.
 * EVM may produce multiple txIdentifiers (one per ERC-20 + one for native).
 * Bitcoin always produces exactly one txIdentifier.
 */
export type EmptyVaultResult = {
  /** CAIP-10 account ID of the swept account */
  accountId: string;
  /** Address that received the swept funds */
  destinationAddress: Address;
  /** CAIP-2 chain ID of the account being swept (ENG-1708) */
  destinationChain: string;
  /** Number of assets transferred */
  transferredAssetCount: number;
  /** Whether the native asset was transferred */
  transferredNativeAsset: boolean;
  /** Lifecycle status of the withdrawal (ENG-1708) */
  status: TransferStatus;
  /**
   * Per-transaction identifiers for each submitted on-chain transaction (ENG-170).
   * Nullability rule: empty only when no transactions were submitted, which
   * should not occur in practice (emptyVault throws before returning in that case).
   */
  txIdentifiers: WithdrawalTxIdentifier[];
};

export type { PersistedAccount } from './state';

export type { AccountConfig } from './account';

export {
  ActivityType,
  type Activity,
  type BitcoinActivity,
  type EvmActivity
} from './activities';
