/**
 * SDK-owned withdrawal lifecycle persistence + reconciliation helpers (ENG-1791).
 *
 * Records are persisted in the `withdrawals` state segment and are append-only
 * with id-keyed updates. This module is the single boundary that owns the
 * read/append/replace contract for `WithdrawalRecord`s — call sites in account
 * clients and the LibQC facade go through these helpers rather than mutating
 * the segment directly.
 */
import type { AccountId } from 'caip';
import type { VaultEncryptionKeyWithMetadata } from './cryptography';
import { WithdrawalRecordNotFoundError } from './errors';
import { getStateSegment, setStateSegment } from './state';
import { AsyncMutex, type LibQCStorage } from './storage';
import type {
  Address,
  WithdrawalLifecycleStatus,
  WithdrawalRecord,
  WithdrawalTxIdentifier
} from './types';

/**
 * Ms-epoch clock used to stamp lifecycle transitions. Wrapped so tests can
 * replace it via module mocks if deterministic timestamps are required.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Generates a UUID v4 for a new withdrawal record.
 *
 * Uses the Web Crypto `randomUUID` available in modern Node and browser runtimes.
 */
export function createWithdrawalId(): string {
  return crypto.randomUUID();
}

const withdrawalsWriteLocks = new WeakMap<LibQCStorage, AsyncMutex>();

function getWithdrawalsWriteLock(storage: LibQCStorage): AsyncMutex {
  const existingLock = withdrawalsWriteLocks.get(storage);
  if (existingLock) {
    return existingLock;
  }
  const nextLock = new AsyncMutex();
  withdrawalsWriteLocks.set(storage, nextLock);
  return nextLock;
}

function runWithWithdrawalsWriteLock<T>(
  storage: LibQCStorage,
  fn: () => Promise<T>
): Promise<T> {
  return getWithdrawalsWriteLock(storage).run(fn);
}

/**
 * Parameters for creating a new withdrawal record at submission time.
 *
 * `initialStatus` differs by chain: BTC starts at 'pending' (broadcast but
 * not confirmed); EVM starts at 'sent' (userop receipt already returned).
 */
export interface NewWithdrawalRecordInput {
  accountId: AccountId;
  destinationAddress: Address;
  destinationChain: string;
  txRefs: WithdrawalTxIdentifier[];
  initialStatus: Extract<WithdrawalLifecycleStatus, 'pending' | 'sent'>;
}

/**
 * Builds and persists a new withdrawal record for an `emptyVault` call.
 */
export async function recordWithdrawal(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  input: NewWithdrawalRecordInput
): Promise<WithdrawalRecord> {
  const initiatedAt = nowMs();
  const record: WithdrawalRecord = {
    id: createWithdrawalId(),
    accountId: input.accountId.toString(),
    destinationAddress: input.destinationAddress,
    destinationChain: input.destinationChain,
    status: input.initialStatus,
    txRefs: input.txRefs,
    initiatedAt,
    sentAt: input.initialStatus === 'sent' ? initiatedAt : null,
    completedAt: null,
    failedAt: null
  };

  await runWithWithdrawalsWriteLock(storage, async () => {
    const existing =
      (await getStateSegment(storage, encryptionKey, 'withdrawals')) ?? [];
    await setStateSegment(storage, encryptionKey, 'withdrawals', [
      ...existing,
      record
    ]);
  });

  return record;
}

/**
 * Reads withdrawals from the encrypted state, optionally filtered by account.
 *
 * Records are returned newest-first by `initiatedAt`.
 */
export async function listWithdrawalRecords(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  accountId?: AccountId
): Promise<WithdrawalRecord[]> {
  const all =
    (await getStateSegment(storage, encryptionKey, 'withdrawals')) ?? [];
  const filtered = accountId
    ? all.filter(r => r.accountId === accountId.toString())
    : all;
  return [...filtered].sort((a, b) => b.initiatedAt - a.initiatedAt);
}

/**
 * Replaces a single record by id. Throws if the id is not found, since
 * reconciliation is expected to operate on records it just read.
 */
export async function replaceWithdrawalRecord(
  storage: LibQCStorage,
  encryptionKey: VaultEncryptionKeyWithMetadata,
  updated: WithdrawalRecord
): Promise<void> {
  await runWithWithdrawalsWriteLock(storage, async () => {
    const existing =
      (await getStateSegment(storage, encryptionKey, 'withdrawals')) ?? [];
    const index = existing.findIndex(r => r.id === updated.id);
    if (index === -1) {
      throw new WithdrawalRecordNotFoundError(updated.id);
    }
    const next = [...existing];
    next[index] = updated;
    await setStateSegment(storage, encryptionKey, 'withdrawals', next);
  });
}

/**
 * Reconciliation observation for a withdrawal record (ENG-1791).
 *
 * The `confirmed` flag is true when every submitted tx has reached the chain's
 * canonical confirmation criterion (≥1 confirmation on Bitcoin, receipt
 * status='success' on EVM). The `sourceBalanceZero` flag is true when no
 * withdrawable balance remains on the source account. Callers persist
 * transitions via {@link applyReconciliation}.
 */
export interface WithdrawalReconciliation {
  confirmed: boolean;
  sourceBalanceZero: boolean;
  /** Set when reconciliation observed an explicit non-throw failure. */
  failed?: boolean;
}

/**
 * Applies a reconciliation observation to a record and returns the next
 * record value (or the original record if no transition is warranted).
 *
 * Lifecycle transitions are deterministic:
 * - failed (any → failed) is terminal and short-circuits other transitions
 * - pending → sent when confirmed
 * - sent   → withdrawn when source balance is zero (post-confirmation)
 */
export function applyReconciliation(
  record: WithdrawalRecord,
  reconciliation: WithdrawalReconciliation
): WithdrawalRecord {
  if (record.status === 'withdrawn' || record.status === 'failed') {
    return record;
  }

  if (reconciliation.failed === true) {
    return {
      ...record,
      status: 'failed',
      failedAt: nowMs()
    };
  }

  let next: WithdrawalRecord = record;
  if (next.status === 'pending' && reconciliation.confirmed) {
    next = { ...next, status: 'sent', sentAt: nowMs() };
  }

  if (next.status === 'sent' && reconciliation.sourceBalanceZero) {
    next = { ...next, status: 'withdrawn', completedAt: nowMs() };
  }

  return next;
}
