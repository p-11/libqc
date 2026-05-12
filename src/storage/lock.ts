/**
 * Promise-based mutex for serializing async storage operations.
 *
 * Operations are queued and executed in FIFO order. The lock is released
 * automatically whether the operation succeeds or throws.
 *
 * Limitations:
 * - In-process only. This lock does not coordinate across browser tabs,
 *   web workers, or extension background scripts that share the same
 *   localStorage origin. Cross-context isolation requires the Web Locks API
 *   or equivalent, which is not in scope here.
 * - Not reentrant. Calling run() from within a run() callback on the same
 *   AsyncMutex instance will deadlock: the inner call appends to the chain
 *   that the outer call is already holding. Always acquire the lock at the
 *   outermost call site and do not re-enter it from private helpers.
 */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Runs fn exclusively under the lock.
   *
   * All concurrent callers are serialized in FIFO order. The lock is released
   * even if fn throws or rejects, so subsequent waiters always proceed.
   *
   * @param fn - Async function to run under the lock
   * @returns A promise that settles with the same value or error as fn()
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => fn());
    // Swallow errors on the chain so subsequent waiters are not blocked
    // by a rejection from the previous operation.
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
