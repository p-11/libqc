import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WebStorage } from '../../../src';

describe('WebStorage', () => {
  let mockStorage: Storage;
  let webStorage: WebStorage;

  beforeEach(() => {
    // Create a mock implementation of Storage
    const store: Record<string, string> = {};
    mockStorage = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach(key => delete store[key]);
      }),
      key: vi.fn((index: number) => {
        const keys = Object.keys(store);
        return keys[index] || null;
      }),
      get length() {
        return Object.keys(store).length;
      }
    };

    // Mock localStorage globally
    global.localStorage = mockStorage;
    global.sessionStorage = mockStorage;

    webStorage = new WebStorage();
  });

  describe('constructor', () => {
    test('uses localStorage by default', () => {
      const storage = new WebStorage();
      expect(storage).toBeDefined();
    });

    test('uses sessionStorage when specified', () => {
      const storage = new WebStorage();
      expect(storage).toBeDefined();
    });

    test('uses custom prefix when specified', async () => {
      const storage = new WebStorage('custom_');
      await storage.put('test', 'value');
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'custom_test',
        '"value"'
      );
    });

    test('uses default prefix "vault_" when not specified', async () => {
      const storage = new WebStorage();
      await storage.put('test', 'value');
      expect(mockStorage.setItem).toHaveBeenCalledWith('vault_test', '"value"');
    });
  });

  describe('put', () => {
    test('stores string values', async () => {
      await webStorage.put('key1', 'value1');
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'vault_key1',
        '"value1"'
      );
    });

    test('stores number values', async () => {
      await webStorage.put('key2', 42);
      expect(mockStorage.setItem).toHaveBeenCalledWith('vault_key2', '42');
    });

    test('stores object values', async () => {
      const obj = { name: 'test', count: 5 };
      await webStorage.put('key3', obj);
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'vault_key3',
        JSON.stringify(obj)
      );
    });

    test('stores array values', async () => {
      const arr = [1, 2, 3, 'four'];
      await webStorage.put('key4', arr);
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'vault_key4',
        JSON.stringify(arr)
      );
    });

    test('stores boolean values', async () => {
      await webStorage.put('key5', true);
      expect(mockStorage.setItem).toHaveBeenCalledWith('vault_key5', 'true');
    });

    test('stores null values', async () => {
      await webStorage.put('key6', null);
      expect(mockStorage.setItem).toHaveBeenCalledWith('vault_key6', 'null');
    });

    test('throws error when storage fails', async () => {
      vi.mocked(mockStorage.setItem).mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      await expect(webStorage.put('key', 'value')).rejects.toThrow(
        'Failed to store value for key "key"'
      );
    });
  });

  describe('get', () => {
    test('retrieves stored string values', async () => {
      await webStorage.put('key1', 'value1');
      const result = await webStorage.get<string>('key1');
      expect(result).toBe('value1');
    });

    test('retrieves stored number values', async () => {
      await webStorage.put('key2', 42);
      const result = await webStorage.get<number>('key2');
      expect(result).toBe(42);
    });

    test('retrieves stored object values', async () => {
      const obj = { name: 'test', count: 5 };
      await webStorage.put('key3', obj);
      const result = await webStorage.get<typeof obj>('key3');
      expect(result).toEqual(obj);
    });

    test('retrieves stored array values', async () => {
      const arr = [1, 2, 3, 'four'];
      await webStorage.put('key4', arr);
      const result = await webStorage.get<typeof arr>('key4');
      expect(result).toEqual(arr);
    });

    test('retrieves stored boolean values', async () => {
      await webStorage.put('key5', false);
      const result = await webStorage.get<boolean>('key5');
      expect(result).toBe(false);
    });

    test('returns null for non-existent keys', async () => {
      const result = await webStorage.get<string>('nonexistent');
      expect(result).toBeNull();
    });

    test('throws error on parsing errors', async () => {
      vi.mocked(mockStorage.getItem).mockReturnValue('invalid json {');
      await expect(webStorage.get<string>('key')).rejects.toThrow();
    });

    test('handles complex nested objects', async () => {
      const complex = {
        user: { name: 'Alice', age: 30 },
        items: [
          { id: 1, name: 'Item1' },
          { id: 2, name: 'Item2' }
        ],
        metadata: { created: '2024-01-01', tags: ['a', 'b', 'c'] }
      };
      await webStorage.put('complex', complex);
      const result = await webStorage.get<typeof complex>('complex');
      expect(result).toEqual(complex);
    });
  });

  describe('delete', () => {
    test('deletes existing keys', async () => {
      await webStorage.put('key1', 'value1');
      await webStorage.delete('key1');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('vault_key1');
      const result = await webStorage.get('key1');
      expect(result).toBeNull();
    });

    test('does not throw when deleting non-existent keys', async () => {
      await expect(webStorage.delete('nonexistent')).resolves.not.toThrow();
    });

    test('throws error when storage operation fails', async () => {
      vi.mocked(mockStorage.removeItem).mockImplementation(() => {
        throw new Error('Storage error');
      });

      await expect(webStorage.delete('key')).rejects.toThrow(
        'Failed to delete key "key"'
      );
    });
  });

  describe('has', () => {
    test('returns true for existing keys', async () => {
      await webStorage.put('key1', 'value1');
      const result = await webStorage.has('key1');
      expect(result).toBe(true);
    });

    test('returns false for non-existent keys', async () => {
      const result = await webStorage.has('nonexistent');
      expect(result).toBe(false);
    });

    test('returns true even for null values', async () => {
      await webStorage.put('nullKey', null);
      const result = await webStorage.has('nullKey');
      expect(result).toBe(true);
    });

    test('returns false on storage errors', async () => {
      vi.mocked(mockStorage.getItem).mockImplementation(() => {
        throw new Error('Storage error');
      });

      await expect(webStorage.has('key')).rejects.toThrow();
    });
  });

  describe('clear', () => {
    test('clears all keys with the prefix', async () => {
      await webStorage.put('key1', 'value1');
      await webStorage.put('key2', 'value2');
      await webStorage.put('key3', 'value3');

      await webStorage.clear();

      expect(await webStorage.has('key1')).toBe(false);
      expect(await webStorage.has('key2')).toBe(false);
      expect(await webStorage.has('key3')).toBe(false);
    });

    test('only clears keys with matching prefix', async () => {
      const storage1 = new WebStorage('app1_');
      const storage2 = new WebStorage('app2_');

      await storage1.put('key', 'value1');
      await storage2.put('key', 'value2');

      await storage1.clear();

      expect(await storage1.has('key')).toBe(false);
      expect(await storage2.has('key')).toBe(true);
    });

    test('handles empty storage', async () => {
      await expect(webStorage.clear()).resolves.not.toThrow();
    });

    test('throws error when storage operation fails', async () => {
      await webStorage.put('key1', 'value1');
      vi.mocked(mockStorage.removeItem).mockImplementation(() => {
        throw new Error('Storage error');
      });

      await expect(webStorage.clear()).rejects.toThrow(
        'Failed to clear storage'
      );
    });
  });

  describe('CAIP type serialization', () => {
    test('AssetType and ChainId lose their prototypes after JSON round-trip', async () => {
      const { AssetType, ChainId } = await import('caip');

      const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const assetId = new AssetType({
        chainId,
        assetName: {
          namespace: 'erc20',
          reference: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
        }
      });

      // Before serialization - toString() works
      expect(assetId.toString()).toBe(
        'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );
      expect(chainId.toString()).toBe('eip155:1');

      // Store and retrieve
      await webStorage.put('testAsset', { id: assetId, chainId });
      const retrieved = await webStorage.get<{
        id: Record<string, unknown>;
        chainId: Record<string, unknown>;
      }>('testAsset');

      // After deserialization - toString() returns '[object Object]'
      expect(retrieved).not.toBeNull();
      expect((retrieved!.id as { toString: () => string }).toString()).toBe(
        '[object Object]'
      ); // Bug demonstrated!
      expect(
        (retrieved!.chainId as { toString: () => string }).toString()
      ).toBe('[object Object]'); // Bug demonstrated!

      // The objects become plain objects, losing their prototype methods
      expect(retrieved!.id instanceof AssetType).toBe(false);
      expect(retrieved!.chainId instanceof ChainId).toBe(false);
    });
  });

  describe('integration tests', () => {
    test('can store and retrieve multiple values', async () => {
      await webStorage.put('str', 'hello');
      await webStorage.put('num', 123);
      await webStorage.put('obj', { a: 1, b: 2 });
      await webStorage.put('arr', [1, 2, 3]);

      expect(await webStorage.get<string>('str')).toBe('hello');
      expect(await webStorage.get<number>('num')).toBe(123);
      expect(await webStorage.get<{ a: number; b: number }>('obj')).toEqual({
        a: 1,
        b: 2
      });
      expect(await webStorage.get<number[]>('arr')).toEqual([1, 2, 3]);
    });

    test('can update existing values', async () => {
      await webStorage.put('key', 'initial');
      expect(await webStorage.get<string>('key')).toBe('initial');

      await webStorage.put('key', 'updated');
      expect(await webStorage.get<string>('key')).toBe('updated');
    });

    test('sequential operations work correctly', async () => {
      await webStorage.put('key', 'value');
      expect(await webStorage.has('key')).toBe(true);
      expect(await webStorage.get<string>('key')).toBe('value');
      await webStorage.delete('key');
      expect(await webStorage.has('key')).toBe(false);
      expect(await webStorage.get<string>('key')).toBeNull();
    });

    test('handles multiple storage instances with different prefixes', async () => {
      const storage1 = new WebStorage('user1_');
      const storage2 = new WebStorage('user2_');

      await storage1.put('data', 'user1 data');
      await storage2.put('data', 'user2 data');

      expect(await storage1.get<string>('data')).toBe('user1 data');
      expect(await storage2.get<string>('data')).toBe('user2 data');
    });
  });
});
