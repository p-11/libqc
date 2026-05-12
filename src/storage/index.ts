export { AsyncMutex } from './lock';

/**
 * Storage interface for persisting LibQC wallet state
 */
export interface LibQCStorage {
  /**
   * Retrieves a value from storage
   *
   * @param key - The storage key
   * @returns The stored value or null if not found
   */
  get<V>(key: string): Promise<V | null>;

  /**
   * Stores a value in storage
   *
   * @param key - The storage key
   * @param value - The value to store
   */
  put<V>(key: string, value: V): Promise<void>;

  /**
   * Deletes a value from storage
   *
   * @param key - The storage key to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Checks if a key exists in storage
   *
   * @param key - The storage key to check
   * @returns True if the key exists, false otherwise
   */
  has(key: string): Promise<boolean>;

  /**
   * Clears all stored data
   *
   * Optional method that removes all data from storage.
   * Useful for wallet reset or logout operations.
   */
  clear?(): Promise<void>;
}
