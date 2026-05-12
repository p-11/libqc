import { LibQCStorage } from './index';

const LIBQC_STORAGE_PREFIX = 'vault_';

/**
 * Web storage implementation of LibQCStorage using localStorage
 *
 * Stores and retrieves serialized values. Encryption is handled at the
 * state layer (see state.ts) rather than at the storage level.
 */
export class WebStorage implements LibQCStorage {
  private storage: Storage;

  constructor(private prefix: string = LIBQC_STORAGE_PREFIX) {
    this.storage = localStorage;
  }

  /**
   * Get a value from storage based on a key
   *
   * @param key The key of the stored value
   * @returns The value in storage
   */
  async get<V>(key: string): Promise<V | null> {
    try {
      const item = this.storage.getItem(this.getKey(key));
      if (item === null) {
        return null;
      }
      return await Promise.resolve(JSON.parse(item) as V);
    } catch (error) {
      throw new Error(
        `Error getting key "${key}" from storage: ${String(error)}`
      );
    }
  }

  /**
   * Puts a new value into storage
   *
   * @param key The key to store the value against
   */
  async put<V>(key: string, value: V): Promise<void> {
    try {
      const serialized = JSON.stringify(value);

      await new Promise(resolve => {
        this.storage.setItem(this.getKey(key), serialized);
        resolve(void 0);
      });
    } catch (error) {
      throw new Error(
        `Failed to store value for key "${key}": ${String(error)}`
      );
    }
  }

  /**
   * Delete a value from storage
   *
   * @param key The key of the stored value
   */
  async delete(key: string): Promise<void> {
    try {
      await new Promise(resolve => {
        this.storage.removeItem(this.getKey(key));
        resolve(void 0);
      });
    } catch (error) {
      throw new Error(`Failed to delete key "${key}": ${String(error)}`);
    }
  }

  /**
   * Checks if storage has a stored value
   *
   * @param key The key of the stored value
   * @returns True if there is a value stored at the key and false otherwise
   */
  async has(key: string): Promise<boolean> {
    try {
      return await Promise.resolve(
        this.storage.getItem(this.getKey(key)) !== null
      );
    } catch (error) {
      throw new Error(`Failed to check key "${key}": ${String(error)}`);
    }
  }

  /**
   * Clears all stored data
   *
   */
  async clear(): Promise<void> {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      await Promise.all(
        keysToRemove.map(
          key =>
            new Promise(resolve => {
              this.storage.removeItem(key);
              resolve(void 0);
            })
        )
      );
    } catch (error) {
      throw new Error(`Failed to clear storage: ${String(error)}`);
    }
  }

  /**
   * Builds a storage key with a prefix
   *
   * @param key The key to prefix
   * @returns A storage key
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
