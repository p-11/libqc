import { ChainId } from 'caip';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Main entry point exports
import {
  Password,
  type Symbol,
  IncorrectPasswordError,
  NoPasswordSetError,
  VaultLockedError
} from '../../src';

// Internal imports (not exported from main entry point)
import {
  MockStorage,
  createBareTestLibQC,
  createTestLibQC,
  getTestPassword,
  mockGenerateAddressFromMnemonic
} from '../testUtils';

describe('Vault Lifecycle Integration', () => {
  beforeEach(() => {
    mockGenerateAddressFromMnemonic();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('password-first onboarding flow', () => {
    test('setPassword -> generateMnemonic -> createAccount', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      expect(vault.isUnlocked()).toBe(true);
      expect(await vault.hasPassword()).toBe(true);

      // Step 2: Generate mnemonic
      await vault.generateMnemonic(mnemonic => {
        expect(mnemonic).toBeDefined();
        expect(new TextDecoder().decode(mnemonic).split(' ')).toHaveLength(24);
      });

      // Step 3: Create account
      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      const account = await vault.createAccount(chainId);
      expect(account).toBeDefined();
      expect(account.getId()).toBeDefined();

      // Verify data is persisted encrypted
      const raw = await storage.get<Record<string, unknown>>('state.entropy');
      expect(raw).toHaveProperty('data');
      expect(raw).toHaveProperty('iv');
      expect(raw).toHaveProperty('scryptSalt');
      const rawString = JSON.stringify(raw);
      expect(rawString).not.toContain('mnemonic');
    });
  });

  describe('returning user flow', () => {
    test('unlock -> operations -> lock -> unlock', async () => {
      const storage = new MockStorage(new Map());

      // Initial setup
      const { vault: vault1 } = await createTestLibQC(storage);
      await vault1.generateMnemonic(() => true);
      await vault1.addToken('USDC' as Symbol);

      // Simulate app close (discard vault1)
      // New session
      const vault2 = createBareTestLibQC(storage);
      expect(vault2.isUnlocked()).toBe(false);
      expect(await vault2.hasPassword()).toBe(true);

      // Operations fail while locked
      await expect(vault2.listAssets()).rejects.toThrow(VaultLockedError);

      // Unlock
      await vault2.unlock(getTestPassword());
      expect(vault2.isUnlocked()).toBe(true);

      // Operations succeed
      const assets = await vault2.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe('USDC');

      // Lock
      vault2.lock();
      expect(vault2.isUnlocked()).toBe(false);
      await expect(vault2.listAssets()).rejects.toThrow(VaultLockedError);

      // Re-unlock
      await vault2.unlock(getTestPassword());
      const assetsAgain = await vault2.listAssets();
      expect(assetsAgain).toHaveLength(1);
    });
  });

  describe('password change flow', () => {
    test('data survives password change', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      await vault.generateMnemonic(() => true);
      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);
      await vault.addToken('USDC' as Symbol);

      const oldPassword = getTestPassword();
      const newPassword = Password.from(
        new TextEncoder().encode('Brand-New-Password456!')
      );
      try {
        await vault.setPassword(newPassword, oldPassword);

        // Old password no longer works
        expect(await vault.checkPassword(oldPassword)).toBe(false);
        expect(await vault.checkPassword(newPassword)).toBe(true);

        // Data is still accessible
        const accounts = await vault.listAccounts();
        expect(accounts).toHaveLength(1);

        const assets = await vault.listAssets();
        expect(assets).toHaveLength(2); // ETH native + USDC

        // Lock and re-unlock with new password
        vault.lock();
        await vault.unlock(newPassword);

        const assetsAfterReUnlock = await vault.listAssets();
        expect(assetsAfterReUnlock).toHaveLength(2);
      } finally {
        oldPassword.fill(0);
        newPassword.fill(0);
      }
    });
  });

  describe('incorrect password handling', () => {
    test('wrong password on unlock throws IncorrectPasswordError', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      vault.lock();

      const wrongPassword = Password.from(
        new TextEncoder().encode('totally-wrong-pw')
      );
      try {
        await expect(vault.unlock(wrongPassword)).rejects.toThrow(
          IncorrectPasswordError
        );

        expect(vault.isUnlocked()).toBe(false);
      } finally {
        wrongPassword.fill(0);
      }
    });

    test('unlock on empty storage throws NoPasswordSetError', async () => {
      const storage = new MockStorage(new Map());
      const vault = createBareTestLibQC(storage);

      await expect(vault.unlock(getTestPassword())).rejects.toThrow(
        NoPasswordSetError
      );
    });

    test('checkPassword returns false for wrong password without changing state', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const wrongPassword = Password.from(
        new TextEncoder().encode('wrong-password-x')
      );
      try {
        const result = await vault.checkPassword(wrongPassword);
        expect(result).toBe(false);

        // Vault should still be unlocked
        expect(vault.isUnlocked()).toBe(true);
      } finally {
        wrongPassword.fill(0);
      }
    });
  });

  describe('lock lifecycle', () => {
    test('lock prevents all operations', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);
      await vault.addToken('USDC' as Symbol);

      vault.lock();
      expect(vault.isUnlocked()).toBe(false);

      await expect(vault.listAssets()).rejects.toThrow(VaultLockedError);
      await expect(vault.listAccounts()).rejects.toThrow(VaultLockedError);
      await expect(vault.generateMnemonic(() => true)).rejects.toThrow(
        VaultLockedError
      );
    });

    test('unlock restores access after lock', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);
      await vault.addToken('USDC' as Symbol);

      vault.lock();
      await vault.unlock(getTestPassword());

      const assets = await vault.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe('USDC');
    });

    test('hasPassword and checkPassword work while locked', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      vault.lock();

      expect(await vault.hasPassword()).toBe(true);
      expect(await vault.checkPassword(getTestPassword())).toBe(true);
    });
  });

  describe('clearState lifecycle', () => {
    test('clearState destroys vault and allows fresh setup', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      await vault.clearState();

      expect(vault.isUnlocked()).toBe(false);
      expect(await vault.hasPassword()).toBe(false);

      // Fresh setup
      const newPassword = Password.from(
        new TextEncoder().encode('Fresh-Password-789!')
      );
      try {
        await vault.setPassword(newPassword);
        expect(vault.isUnlocked()).toBe(true);

        await vault.generateMnemonic(mnemonic => {
          expect(mnemonic).toBeDefined();
        });
      } finally {
        newPassword.fill(0);
      }
    });
  });
});
