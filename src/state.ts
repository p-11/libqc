import { AccountId, AssetType, ChainId } from 'caip';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { Address, BitcoinAddress, EvmAddress } from './types';
import { AddressVersion, CURRENT_DEFAULT_ADDRESS_VERSION } from './config';
import { decode, encode } from 'cbor-x';
import {
  decryptData,
  encryptData,
  type EncryptedVault,
  type VaultEncryptionKeyWithMetadata,
  type Secp256k1PrivateKeyBytes
} from './cryptography';
import { VaultCorruptedError } from './errors';
import { LibQCStorage } from './storage';
import { isBitcoinChain } from './chain';
import {
  AddressIndex,
  Asset,
  Entropy,
  Seed,
  type WithdrawalRecord,
  type WithdrawalTxIdentifier
} from './types';

/**
 * Storage keys for each independently-encrypted state segment.
 */
export const STATE_SEGMENT_KEYS = {
  entropy: 'state.entropy',
  seed: 'state.seed',
  addresses: 'state.addresses',
  assets: 'state.assets',
  withdrawals: 'state.withdrawals',
  httpSigning: 'state.httpSigning'
} as const;

export type StateSegmentName = keyof typeof STATE_SEGMENT_KEYS;

/**
 * Returns the default empty LibQC state.
 */
export const getDefaultLibQCState = (): LibQCState => ({
  addresses: []
});

/**
 * Persisted account derivation info.
 */
export interface PersistedAddress {
  chainType: 'evm' | 'bitcoin';
  address: EvmAddress | BitcoinAddress;
  index: AddressIndex;
  /** Binary private key (Uint8Array) */
  secp256k1PrivateKey: Secp256k1PrivateKeyBytes;
  /** Owner EOA address (only for EVM) */
  secp256k1PublicKeyHash?: EvmAddress;
  accounts: PersistedAccount[];
  chainData?: Array<{
    chainId: string | ChainId;
    address: string;
    secp256r1PublicKey?: Uint8Array;
  }>;
  version: AddressVersion;
}

/** EVM persisted address for backward compatibility */
export type EvmPersistedAddress = PersistedAddress & {
  chainType: 'evm';
  address: EvmAddress;
  secp256k1PublicKeyHash: EvmAddress;
};

/** Bitcoin persisted address for backward compatibility */
export type BitcoinPersistedAddress = PersistedAddress & {
  chainType: 'bitcoin';
  address: BitcoinAddress;
};

export type PersistedAccount = {
  id: AccountId;
  address: Address;
  chainId: ChainId;
};

/**
 * Encrypted vault segment: ML-DSA-65 credentials for signed JSON-RPC HTTP.
 */
export interface PersistedHttpSigningCredentials {
  readonly keyId: string;
  /** ML-DSA-65 secret key (raw). */
  mlDsa65SecretKey: Uint8Array;
}

export type LibQCState = {
  entropy?: Entropy;
  seed?: Seed;
  addresses: PersistedAddress[];
  assets?: Asset[];
  httpSigning?: PersistedHttpSigningCredentials;
  withdrawals?: WithdrawalRecord[];
};

/**
 * Physically zeroes out all sensitive data in a LibQCState object or any object
 * following the wallet state structure (including raw intermediate objects).
 *
 * This includes the mnemonic, all secp256k1 private keys, and any sensitive
 * public key material. Use this in finally blocks to ensure sensitive data
 * does not linger in memory.
 *
 * @param state - The state object or raw data to zero out
 */
export function zeroLibQCState(state: unknown): void {
  if (!state || typeof state !== 'object') return;
  const s = state as Record<string, unknown>;

  const entropy = s.entropy;
  if (entropy instanceof Uint8Array) {
    entropy.fill(0);
  }

  const seed = s.seed;
  if (seed instanceof Uint8Array) {
    seed.fill(0);
  }

  const addresses = s.addresses;
  if (Array.isArray(addresses)) {
    for (const address of addresses) {
      if (address && typeof address === 'object') {
        const addr = address as Record<string, unknown>;
        const privKey = addr.secp256k1PrivateKey;
        if (privKey instanceof Uint8Array) {
          privKey.fill(0);
        }

        const chainData = addr.chainData;
        if (Array.isArray(chainData)) {
          for (const cdEntry of chainData) {
            if (cdEntry && typeof cdEntry === 'object') {
              const cd = cdEntry as Record<string, unknown>;
              const pubKey = cd.secp256r1PublicKey;
              if (pubKey instanceof Uint8Array) {
                pubKey.fill(0);
              }
            }
          }
        }
      }
    }
  }

  const httpSigning = s.httpSigning;
  if (httpSigning && typeof httpSigning === 'object') {
    const hs = httpSigning as Record<string, unknown>;
    const sk = hs.mlDsa65SecretKey;
    if (sk instanceof Uint8Array) {
      sk.fill(0);
    }
  }
}

/**
 * Type guard for EvmPersistedAddress.
 */
export function isEvmPersistedAddress(
  addr: PersistedAddress
): addr is EvmPersistedAddress {
  return addr.chainType === 'evm';
}

interface RawAddress {
  chainType?: 'evm' | 'bitcoin';
  address: string;
  index: AddressIndex | string;
  chainId?: string | ChainId;
  secp256k1PrivateKey: Uint8Array | Record<number, number>;
  secp256k1PublicKeyHash?: string;
  accounts?: Array<{
    id: string | AccountId;
    chainId: string | ChainId;
    address: string;
  }>;
  chainData?: Array<{
    chainId: string | ChainId;
    address: string;
    secp256r1PublicKey?: Uint8Array | Record<number, number>;
  }>;
  version?: AddressVersion;
}

interface RawAssetEntity {
  assetType: string | AssetType;
  [key: string]: unknown;
}

function reconstructAssetType(obj: unknown): AssetType {
  if (obj instanceof AssetType) {
    return obj;
  }

  return new AssetType(obj as ConstructorParameters<typeof AssetType>[0]);
}

function reconstructChainId(obj: unknown): ChainId {
  if (obj instanceof ChainId) {
    return obj;
  }

  return new ChainId(obj as ConstructorParameters<typeof ChainId>[0]);
}

function reconstructAccountId(obj: unknown): AccountId {
  if (obj instanceof AccountId) {
    return obj;
  }

  return new AccountId(obj as ConstructorParameters<typeof AccountId>[0]);
}

function toUint8Array(value: Uint8Array | Record<number, number>): Uint8Array {
  return value instanceof Uint8Array
    ? new Uint8Array(value)
    : new Uint8Array(Object.values(value));
}

function reconstructEntropy(value: unknown): LibQCState['entropy'] {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Entropy.from(value as Uint8Array | Record<number, number>);
}

function reconstructSeed(value: unknown): LibQCState['seed'] {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Seed.from(value as Uint8Array | Record<number, number>);
}

/**
 * Reconstructs a PersistedAddress[] from raw deserialized data,
 * restoring CAIP instance types and handling the bitcoin/evm union.
 *
 * @param rawAddresses - Raw deserialized address objects from storage
 * @returns Reconstructed PersistedAddress array with CAIP instances restored
 */
function reconstructAddresses(rawAddresses: unknown[]): PersistedAddress[] {
  return rawAddresses.map((address): PersistedAddress => {
    const addr = address as RawAddress;
    const cid =
      addr.chainId instanceof ChainId
        ? addr.chainId
        : new ChainId(addr.chainId ? String(addr.chainId) : 'eip155:1');
    const chainType =
      addr.chainType ?? (isBitcoinChain(cid) ? ('bitcoin' as const) : 'evm');

    const persistedAddress: PersistedAddress = {
      chainType,
      address: addr.address as EvmAddress | BitcoinAddress,
      index: addr.index as AddressIndex,
      secp256k1PrivateKey: toUint8Array(
        addr.secp256k1PrivateKey
      ) as Secp256k1PrivateKeyBytes,
      accounts:
        addr.accounts?.map(
          (account): PersistedAccount => ({
            id: reconstructAccountId(account.id),
            chainId: reconstructChainId(account.chainId),
            address: account.address as EvmAddress | BitcoinAddress
          })
        ) ?? [],
      chainData:
        addr.chainData?.map(chainData => ({
          chainId: reconstructChainId(chainData.chainId),
          address: chainData.address,
          secp256r1PublicKey: chainData.secp256r1PublicKey
            ? toUint8Array(chainData.secp256r1PublicKey)
            : undefined
        })) ?? [],
      version: addr.version ?? CURRENT_DEFAULT_ADDRESS_VERSION
    };

    if (chainType === 'bitcoin') {
      return {
        ...persistedAddress,
        chainType: 'bitcoin',
        address: persistedAddress.address as BitcoinAddress
      };
    }

    return {
      ...persistedAddress,
      chainType: 'evm',
      address: persistedAddress.address as EvmAddress,
      secp256k1PublicKeyHash: addr.secp256k1PublicKeyHash as EvmAddress
    };
  });
}

/**
 * Reconstructs an Asset[] from raw deserialized data, restoring AssetType instances.
 *
 * @param rawAssets - Raw deserialized asset objects from storage
 * @returns Reconstructed Asset array with AssetType instances restored
 */
function reconstructAssets(rawAssets: unknown[]): Asset[] {
  return rawAssets.map(asset => {
    const a = asset as { entities: unknown[]; [key: string]: unknown };
    return {
      ...a,
      entities: a.entities.map(entity => {
        const e = entity as RawAssetEntity;
        return { ...e, assetType: reconstructAssetType(e.assetType) };
      })
    } as Asset;
  });
}

function reconstructHttpSigning(value: unknown): LibQCState['httpSigning'] {
  if (value === undefined || value === null) {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (typeof o.keyId === 'string' && o.mlDsa65SecretKey instanceof Uint8Array) {
    const mlDsa65SecretKey = new Uint8Array(o.mlDsa65SecretKey);
    if (mlDsa65SecretKey.length !== ml_dsa65.lengths.secretKey) {
      throw new VaultCorruptedError(
        'httpSigning segment: mlDsa65SecretKey has invalid length'
      );
    }
    return { keyId: o.keyId, mlDsa65SecretKey };
  }
  throw new VaultCorruptedError('httpSigning segment: invalid shape');
}

const WITHDRAWAL_LIFECYCLE_STATUSES = new Set<string>([
  'pending',
  'sent',
  'withdrawn',
  'failed'
]);

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isBitcoinWithdrawalTxRef(
  entry: unknown
): entry is Extract<WithdrawalTxIdentifier, { chain: 'bitcoin' }> {
  if (!entry || typeof entry !== 'object') return false;
  const ref = entry as Record<string, unknown>;
  if (ref.chain !== 'bitcoin') return false;
  if (!ref.data || typeof ref.data !== 'object') return false;
  const data = ref.data as Record<string, unknown>;
  return (
    typeof data.txid === 'string' &&
    (data.explorerUrl === null || typeof data.explorerUrl === 'string')
  );
}

function isEvmWithdrawalTxRef(
  entry: unknown
): entry is Extract<WithdrawalTxIdentifier, { chain: 'evm' }> {
  if (!entry || typeof entry !== 'object') return false;
  const ref = entry as Record<string, unknown>;
  if (ref.chain !== 'evm') return false;
  if (!ref.data || typeof ref.data !== 'object') return false;
  const data = ref.data as Record<string, unknown>;
  return (
    typeof data.txHash === 'string' &&
    typeof data.userOpHash === 'string' &&
    (data.explorerUrl === null || typeof data.explorerUrl === 'string')
  );
}

function isWithdrawalTxRef(entry: unknown): entry is WithdrawalTxIdentifier {
  return isBitcoinWithdrawalTxRef(entry) || isEvmWithdrawalTxRef(entry);
}

function isWithdrawalRecord(entry: unknown): entry is WithdrawalRecord {
  if (!entry || typeof entry !== 'object') return false;
  const r = entry as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.accountId === 'string' &&
    typeof r.destinationAddress === 'string' &&
    typeof r.destinationChain === 'string' &&
    typeof r.status === 'string' &&
    WITHDRAWAL_LIFECYCLE_STATUSES.has(r.status) &&
    Array.isArray(r.txRefs) &&
    r.txRefs.every(isWithdrawalTxRef) &&
    typeof r.initiatedAt === 'number' &&
    isNullableTimestamp(r.sentAt) &&
    isNullableTimestamp(r.completedAt) &&
    isNullableTimestamp(r.failedAt)
  );
}

function reconstructWithdrawals(rawWithdrawals: unknown[]): WithdrawalRecord[] {
  return rawWithdrawals.map((entry, index) => {
    if (!isWithdrawalRecord(entry)) {
      throw new VaultCorruptedError(
        `withdrawals segment contains invalid record at index ${index}`
      );
    }
    return entry;
  });
}

const segmentReconstructors = {
  entropy: (value: unknown): LibQCState['entropy'] => reconstructEntropy(value),
  seed: (value: unknown): LibQCState['seed'] => reconstructSeed(value),
  addresses: (value: unknown): LibQCState['addresses'] =>
    reconstructAddresses(Array.isArray(value) ? value : []),
  assets: (value: unknown): LibQCState['assets'] =>
    Array.isArray(value) ? reconstructAssets(value) : undefined,
  httpSigning: (value: unknown): LibQCState['httpSigning'] =>
    value === undefined ? undefined : reconstructHttpSigning(value),
  withdrawals: (value: unknown): LibQCState['withdrawals'] =>
    Array.isArray(value) ? reconstructWithdrawals(value) : undefined
} satisfies { [K in StateSegmentName]: (value: unknown) => LibQCState[K] };

/**
 * Staging keys used during two-phase key rotation.
 * Written before the main segment keys are overwritten.
 */
export const ROTATION_STAGING_KEYS = {
  entropy: 'state.entropy.next',
  seed: 'state.seed.next',
  addresses: 'state.addresses.next',
  assets: 'state.assets.next',
  withdrawals: 'state.withdrawals.next',
  httpSigning: 'state.httpSigning.next'
} as const;

/**
 * Presence of this key signals that staging writes are complete and the
 * rotation should be committed (or re-committed on resume after a crash).
 */
export const ROTATION_MARKER_KEY = 'state.rotation.pending';

function decodeSegmentEnvelope(plaintextBytes: Uint8Array): { v?: unknown } {
  try {
    return decode(plaintextBytes) as { v?: unknown };
  } catch {
    throw new VaultCorruptedError('state segment payload is not valid CBOR');
  }
}

/**
 * Reads a single encrypted state segment. Only decrypts the requested segment.
 * Unrelated segments remain encrypted in storage.
 *
 * @param storage - The storage implementation to retrieve state from
 * @param encryptionKey - The AES-256-GCM key with metadata
 * @param segment - The segment to read
 * @returns The decrypted segment value, or the segment default if absent
 */
export async function getStateSegment<K extends StateSegmentName>(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  segment: K
): Promise<LibQCState[K]> {
  const vault = await storage.get<EncryptedVault>(STATE_SEGMENT_KEYS[segment]);
  if (!vault) {
    return segmentReconstructors[segment](undefined) as LibQCState[K];
  }

  const plaintextBytes = await decryptData(encryptionKey, vault);

  try {
    const parsed = decodeSegmentEnvelope(plaintextBytes);
    return segmentReconstructors[segment](parsed.v) as LibQCState[K];
  } finally {
    plaintextBytes.fill(0);
  }
}

/**
 * Writes a single encrypted state segment. Only re-encrypts the affected segment.
 * Unrelated segments remain untouched in storage.
 *
 * @param storage - The storage implementation to save state to
 * @param encryptionKey - The AES-256-GCM key with metadata
 * @param segment - The segment to write
 * @param value - The value to store for this segment
 */
export async function setStateSegment<K extends StateSegmentName>(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  segment: K,
  value: LibQCState[K]
): Promise<void> {
  // Security check: Seed and entropy are immutable once set.
  // They can only be changed by calling clearState() first.
  if (segment === 'seed' || segment === 'entropy') {
    if (await storage.has(STATE_SEGMENT_KEYS[segment])) {
      throw new Error(
        `Security Violation: ${segment} is immutable and already exists in storage. Clear state first.`
      );
    }
  }

  const plaintextBytes = encode({ v: value });
  const encryptedVault = await encryptData(encryptionKey, plaintextBytes);
  await storage.put<EncryptedVault>(
    STATE_SEGMENT_KEYS[segment],
    encryptedVault
  );
}

/**
 * Encrypts a single segment value with the given key, returning the vault blob.
 * Unlike `setStateSegment`, this does not write to storage.
 */
async function encryptSegment<K extends StateSegmentName>(
  encryptionKey: VaultEncryptionKeyWithMetadata,
  value: LibQCState[K]
): Promise<EncryptedVault> {
  const plaintextBytes = encode({ v: value });
  return encryptData(encryptionKey, plaintextBytes);
}

/**
 * Copies all staging blobs to their main segment keys, then deletes the
 * rotation marker followed by all staging keys.
 *
 * @param storage - The storage implementation
 * @throws {VaultCorruptedError} If a staging blob is unexpectedly absent
 */
async function commitRotation(storage: LibQCStorage): Promise<void> {
  const segments = Object.keys(STATE_SEGMENT_KEYS) as StateSegmentName[];

  for (const segment of segments) {
    const staged = await storage.get<EncryptedVault>(
      ROTATION_STAGING_KEYS[segment]
    );
    if (!staged) {
      // Backward-compatibility carveout: interrupted rotations from SDKs that
      // predate introducing a segment legitimately have no staging blob for
      // that segment. Any missing staging blob for core segments is still
      // corruption and must fail closed.
      if (segment === 'withdrawals' || segment === 'httpSigning') {
        const segmentMainExists = await storage.has(
          STATE_SEGMENT_KEYS[segment]
        );
        if (!segmentMainExists) {
          continue;
        }
      }
      throw new VaultCorruptedError(
        `rotation staging blob missing for segment "${segment}"; expected it to be present when rotation marker exists`
      );
    }

    await storage.put<EncryptedVault>(STATE_SEGMENT_KEYS[segment], staged);
  }

  await storage.delete(ROTATION_MARKER_KEY);
  await Promise.all(
    Object.values(ROTATION_STAGING_KEYS).map(key => storage.delete(key))
  );
}

/**
 * Re-encrypts all segments with a new key using a two-phase commit.
 *
 * @param storage - The storage implementation
 * @param oldKey - The current AES-256-GCM key
 * @param newKey - The new AES-256-GCM key to rotate to
 */
export async function rotateEncryptionKey(
  storage: LibQCStorage,
  oldKey: VaultEncryptionKeyWithMetadata,
  newKey: VaultEncryptionKeyWithMetadata
): Promise<void> {
  const [entropy, seed, addresses, assets, withdrawals, httpSigning] =
    await Promise.all([
      getStateSegment(storage, oldKey, 'entropy'),
      getStateSegment(storage, oldKey, 'seed'),
      getStateSegment(storage, oldKey, 'addresses'),
      getStateSegment(storage, oldKey, 'assets'),
      getStateSegment(storage, oldKey, 'withdrawals'),
      getStateSegment(storage, oldKey, 'httpSigning')
    ]);

  try {
    const [
      encryptedEntropy,
      encryptedSeed,
      encryptedAddresses,
      encryptedAssets,
      encryptedWithdrawals,
      encryptedHttpSigning
    ] = await Promise.all([
      encryptSegment(newKey, entropy),
      encryptSegment(newKey, seed),
      encryptSegment(newKey, addresses),
      encryptSegment(newKey, assets),
      encryptSegment(newKey, withdrawals),
      encryptSegment(newKey, httpSigning)
    ]);

    await Promise.all([
      storage.put<EncryptedVault>(
        ROTATION_STAGING_KEYS.entropy,
        encryptedEntropy
      ),
      storage.put<EncryptedVault>(ROTATION_STAGING_KEYS.seed, encryptedSeed),
      storage.put<EncryptedVault>(
        ROTATION_STAGING_KEYS.addresses,
        encryptedAddresses
      ),
      storage.put<EncryptedVault>(
        ROTATION_STAGING_KEYS.assets,
        encryptedAssets
      ),
      storage.put<EncryptedVault>(
        ROTATION_STAGING_KEYS.withdrawals,
        encryptedWithdrawals
      ),
      storage.put<EncryptedVault>(
        ROTATION_STAGING_KEYS.httpSigning,
        encryptedHttpSigning
      )
    ]);
    await storage.put(ROTATION_MARKER_KEY, true);

    await commitRotation(storage);
  } finally {
    if (entropy) {
      entropy.fill(0);
    }
    if (seed) {
      seed.fill(0);
    }
    zeroLibQCState({ addresses, assets, httpSigning });
  }
}

/**
 * Checks for an interrupted key rotation and completes it if found.
 *
 * @param storage - The storage implementation to check
 */
export async function resumeRotationIfInterrupted(
  storage: LibQCStorage
): Promise<void> {
  if (await storage.has(ROTATION_MARKER_KEY)) {
    await commitRotation(storage);
  }
}

/**
 * Returns true if the core segment keys are present in storage.
 *
 * The 'withdrawals' segment (ENG-1791) is intentionally excluded from this
 * check: it is created lazily on the first emptyVault call, so vaults that
 * predate the lifecycle feature must continue to be detected as encrypted.
 *
 * @param storage - The storage implementation to check
 * @returns True if all core segment keys are present
 */
export async function hasEncryptedVault(
  storage: LibQCStorage
): Promise<boolean> {
  const [hasEntropy, hasSeed, hasAddresses, hasAssets] = await Promise.all([
    storage.has(STATE_SEGMENT_KEYS.entropy),
    storage.has(STATE_SEGMENT_KEYS.seed),
    storage.has(STATE_SEGMENT_KEYS.addresses),
    storage.has(STATE_SEGMENT_KEYS.assets)
  ]);

  return hasEntropy && hasSeed && hasAddresses && hasAssets;
}

/**
 * Assembles full LibQC state from all encrypted segment keys.
 *
 * @param storage - The storage implementation to retrieve state from
 * @param encryptionKey - The AES-256-GCM key with metadata
 * @returns The full decrypted LibQC state
 */
export async function getLibQCState(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata
): Promise<LibQCState> {
  const [entropy, seed, addresses, assets, withdrawals, httpSigning] =
    await Promise.all([
      getStateSegment(storage, encryptionKey, 'entropy'),
      getStateSegment(storage, encryptionKey, 'seed'),
      getStateSegment(storage, encryptionKey, 'addresses'),
      getStateSegment(storage, encryptionKey, 'assets'),
      getStateSegment(storage, encryptionKey, 'withdrawals'),
      getStateSegment(storage, encryptionKey, 'httpSigning')
    ]);

  return { entropy, seed, addresses, assets, withdrawals, httpSigning };
}

/**
 * Persists the complete LibQC state by writing all segments.
 *
 * @param storage - The storage implementation to save state to
 * @param state - The complete LibQC state to persist
 * @param encryptionKey - The AES-256-GCM key with metadata to encrypt the vault
 */
export async function setLibQCState(
  storage: LibQCStorage,
  state: LibQCState,
  encryptionKey: VaultEncryptionKeyWithMetadata
): Promise<void> {
  await Promise.all([
    setStateSegment(storage, encryptionKey, 'entropy', state.entropy),
    setStateSegment(storage, encryptionKey, 'seed', state.seed),
    setStateSegment(storage, encryptionKey, 'addresses', state.addresses),
    setStateSegment(storage, encryptionKey, 'assets', state.assets),
    setStateSegment(storage, encryptionKey, 'withdrawals', state.withdrawals),
    setStateSegment(storage, encryptionKey, 'httpSigning', state.httpSigning)
  ]);
}
