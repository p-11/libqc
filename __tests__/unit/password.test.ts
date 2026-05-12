import { beforeEach, describe, expect, test } from 'vitest';

// Main entry point exports
import {
  CsprngUnavailableError,
  ExistingPasswordMismatchError,
  ExistingPasswordRequiredError,
  IncorrectPasswordError,
  InvalidPasswordFormatError,
  LibQC,
  NoPasswordSetError,
  Password,
  validatePassword,
  VaultLockedError
} from '../../src';

// Internal imports (not exported from main entry point)
import {
  captureGeneratedMnemonic,
  MockStorage,
  createBareTestLibQC,
  getTestPassword,
  withCryptoOverride
} from '../testUtils';
import type {
  ScryptCostParameter,
  ScryptBlockSize,
  ScryptParallelism,
  ScryptParams
} from '../../src/cryptography';

describe('LibQC password management', () => {
  let storage: MockStorage;
  let vault: LibQC;

  beforeEach(() => {
    storage = new MockStorage(new Map());
    vault = createBareTestLibQC(storage);
  });

  describe('setPassword', () => {
    test('sets password successfully when no password exists', async () => {
      await vault.setPassword(getTestPassword());

      // Verify password was set by checking it
      const isValid = await vault.checkPassword(getTestPassword());
      expect(isValid).toBe(true);
    });

    test('sets password that meets all requirements', async () => {
      const password = Password.from(
        new TextEncoder().encode('Comply1ng-Pass!')
      );
      await vault.setPassword(password);

      const isValid = await vault.checkPassword(password);
      expect(isValid).toBe(true);
    });

    test('sets password with special characters', async () => {
      const password = Password.from(new TextEncoder().encode('P@ssw0rd!#$%'));
      await vault.setPassword(password);

      const isValid = await vault.checkPassword(password);
      expect(isValid).toBe(true);
    });

    test('sets password with spaces', async () => {
      const password = Password.from(
        new TextEncoder().encode('My Password 123!')
      );
      await vault.setPassword(password);

      const isValid = await vault.checkPassword(password);
      expect(isValid).toBe(true);
    });

    test('throws error when password is too short', async () => {
      const shortPassword = Password.from(new TextEncoder().encode('1234567'));

      await expect(vault.setPassword(shortPassword)).rejects.toThrow(
        InvalidPasswordFormatError
      );
    });

    test('throws error when password is empty', async () => {
      const emptyPassword = Password.from(new TextEncoder().encode(''));

      await expect(vault.setPassword(emptyPassword)).rejects.toThrow(
        InvalidPasswordFormatError
      );
    });

    test('requires existing password when changing password', async () => {
      const oldPassword = Password.from(
        new TextEncoder().encode('OldPassword123!')
      );
      const newPassword = Password.from(
        new TextEncoder().encode('NewPassword456!')
      );

      // Set initial password
      await vault.setPassword(oldPassword);

      // Try to change without providing existing password
      await expect(vault.setPassword(newPassword)).rejects.toThrow(
        ExistingPasswordRequiredError
      );
    });

    test('successfully changes password with correct existing password', async () => {
      const oldPassword = Password.from(
        new TextEncoder().encode('OldPassword123!')
      );
      const newPassword = Password.from(
        new TextEncoder().encode('NewPassword456!')
      );

      // Set initial password
      await vault.setPassword(oldPassword);

      // Change password with correct existing password
      await vault.setPassword(newPassword, oldPassword);

      // Verify new password works
      const isValidNew = await vault.checkPassword(newPassword);
      expect(isValidNew).toBe(true);

      // Verify old password no longer works
      const isValidOld = await vault.checkPassword(oldPassword);
      expect(isValidOld).toBe(false);
    });

    test('throws error when changing password with wrong existing password', async () => {
      const oldPassword = Password.from(
        new TextEncoder().encode('OldPassword123!')
      );
      const wrongPassword = Password.from(
        new TextEncoder().encode('WrongPassword1!')
      );
      const newPassword = Password.from(
        new TextEncoder().encode('NewPassword456!')
      );

      // Set initial password
      await vault.setPassword(oldPassword);

      // Try to change with wrong existing password
      await expect(
        vault.setPassword(newPassword, wrongPassword)
      ).rejects.toThrow(ExistingPasswordMismatchError);

      // Verify old password still works
      const isValid = await vault.checkPassword(oldPassword);
      expect(isValid).toBe(true);
    });

    test('validates new password format even when changing password', async () => {
      const oldPassword = Password.from(
        new TextEncoder().encode('OldPassword123!')
      );
      const tooShortPassword = Password.from(
        new TextEncoder().encode('1234567')
      );

      // Set initial password
      await vault.setPassword(oldPassword);

      // Try to change to invalid password
      await expect(
        vault.setPassword(tooShortPassword, oldPassword)
      ).rejects.toThrow(InvalidPasswordFormatError);

      // Verify old password still works
      const isValid = await vault.checkPassword(oldPassword);
      expect(isValid).toBe(true);
    });

    test('handles multiple password changes', async () => {
      const password1 = Password.from(new TextEncoder().encode('Password111!'));
      const password2 = Password.from(new TextEncoder().encode('Password222!'));
      const password3 = Password.from(new TextEncoder().encode('Password333!'));

      // Set initial password
      await vault.setPassword(password1);

      // Change to password2
      await vault.setPassword(password2, password1);

      // Change to password3
      await vault.setPassword(password3, password2);

      // Verify only the latest password works
      expect(await vault.checkPassword(password3)).toBe(true);
      expect(await vault.checkPassword(password2)).toBe(false);
      expect(await vault.checkPassword(password1)).toBe(false);
    });

    test('auto-unlocks vault after first setPassword', async () => {
      await vault.setPassword(getTestPassword());
      expect(vault.isUnlocked()).toBe(true);
    });

    test('fails when crypto.getRandomValues is unavailable', async () => {
      await withCryptoOverride(undefined, async () => {
        await expect(vault.setPassword(getTestPassword())).rejects.toThrow(
          CsprngUnavailableError
        );
      });
    });
  });

  describe('checkPassword', () => {
    test('returns true for correct password', async () => {
      await vault.setPassword(getTestPassword());

      const result = await vault.checkPassword(getTestPassword());
      expect(result).toBe(true);
    });

    test('returns false for incorrect password', async () => {
      await vault.setPassword(getTestPassword());

      const result = await vault.checkPassword(
        Password.from(new TextEncoder().encode('Definitely-Wrong1!'))
      );
      expect(result).toBe(false);
    });

    test('is case-sensitive', async () => {
      const password = Password.from(
        new TextEncoder().encode('MyPassword123!')
      );
      const wrongCasePassword = Password.from(
        new TextEncoder().encode('mypassword123!')
      );

      await vault.setPassword(password);

      const result = await vault.checkPassword(wrongCasePassword);
      expect(result).toBe(false);
    });

    test('throws error when no password has been set', async () => {
      await expect(vault.checkPassword(getTestPassword())).rejects.toThrow(
        NoPasswordSetError
      );
    });

    test('detects whitespace differences', async () => {
      await vault.setPassword(getTestPassword());

      const result = await vault.checkPassword(
        Password.from(
          new TextEncoder().encode(
            new TextDecoder().decode(getTestPassword()) + ' '
          )
        )
      );
      expect(result).toBe(false);
    });

    test('handles special characters correctly', async () => {
      const password = Password.from(
        new TextEncoder().encode('P@ssw0rd!#$%^&*()')
      );
      await vault.setPassword(password);

      const result = await vault.checkPassword(password);
      expect(result).toBe(true);
    });

    test('rejects unicode characters (ASCII-only policy)', async () => {
      const password = Password.from(new TextEncoder().encode('Pässwörd123🔒'));
      await expect(vault.setPassword(password)).rejects.toThrow(
        InvalidPasswordFormatError
      );
    });

    test('works after password change', async () => {
      const oldPassword = Password.from(
        new TextEncoder().encode('OldPassword123!')
      );
      const newPassword = Password.from(
        new TextEncoder().encode('NewPassword456!')
      );

      await vault.setPassword(oldPassword);
      await vault.setPassword(newPassword, oldPassword);

      expect(await vault.checkPassword(newPassword)).toBe(true);
      expect(await vault.checkPassword(oldPassword)).toBe(false);
    });
  });

  describe('password persistence', () => {
    test('password persists across LibQC instances with same storage', async () => {
      // Set password in first instance
      const vault1 = createBareTestLibQC(storage);
      await vault1.setPassword(getTestPassword());

      // Create new instance with same storage
      const vault2 = createBareTestLibQC(storage);

      // Verify password is accessible in new instance
      const result = await vault2.checkPassword(getTestPassword());
      expect(result).toBe(true);
    });

    test('password is isolated between different storage instances', async () => {
      const password1 = Password.from(new TextEncoder().encode('Password111!'));
      const password2 = Password.from(new TextEncoder().encode('Password222!'));

      const storage1 = new MockStorage(new Map());
      const storage2 = new MockStorage(new Map());

      const vault1 = createBareTestLibQC(storage1);
      const vault2 = createBareTestLibQC(storage2);

      // Set different passwords in different instances
      await vault1.setPassword(password1);
      await vault2.setPassword(password2);

      // Verify each instance has its own password
      expect(await vault1.checkPassword(password1)).toBe(true);
      expect(await vault1.checkPassword(password2)).toBe(false);

      expect(await vault2.checkPassword(password2)).toBe(true);
      expect(await vault2.checkPassword(password1)).toBe(false);
    });
  });

  describe('lock/unlock lifecycle', () => {
    test('unlock succeeds with correct password', async () => {
      await vault.setPassword(getTestPassword());
      vault.lock();
      expect(vault.isUnlocked()).toBe(false);

      await vault.unlock(getTestPassword());
      expect(vault.isUnlocked()).toBe(true);
    });

    test('unlock fails with wrong password', async () => {
      await vault.setPassword(getTestPassword());
      vault.lock();

      await expect(
        vault.unlock(
          Password.from(new TextEncoder().encode('Wrong-Password-123!'))
        )
      ).rejects.toThrow(IncorrectPasswordError);

      expect(vault.isUnlocked()).toBe(false);
    });

    test('unlock throws when no vault exists', async () => {
      await expect(vault.unlock(getTestPassword())).rejects.toThrow(
        NoPasswordSetError
      );
    });

    test('operations require unlock', async () => {
      await vault.setPassword(getTestPassword());
      vault.lock();

      await expect(captureGeneratedMnemonic(vault)).rejects.toThrow(
        VaultLockedError
      );
      await expect(vault.listAccounts()).rejects.toThrow(VaultLockedError);
      await expect(vault.listAssets()).rejects.toThrow(VaultLockedError);
    });

    test('hasPassword does not require unlock', async () => {
      expect(await vault.hasPassword()).toBe(false);

      await vault.setPassword(getTestPassword());
      vault.lock();

      expect(await vault.hasPassword()).toBe(true);
    });

    test('lock clears encryption key so operations fail', async () => {
      await vault.setPassword(getTestPassword());
      expect(vault.isUnlocked()).toBe(true);

      // Generate some data so we have something to read
      await captureGeneratedMnemonic(vault);

      vault.lock();
      expect(vault.isUnlocked()).toBe(false);

      // Verify the key is gone — operations requiring decryption fail
      await expect(vault.listAccounts()).rejects.toThrow(VaultLockedError);
      await expect(vault.listAssets()).rejects.toThrow(VaultLockedError);
    });

    test('unlock uses stored vault scrypt params, not instance defaults', async () => {
      const sharedStorage = new MockStorage(new Map());

      // Create vault with one set of scrypt params
      const paramsA: ScryptParams = {
        N: 1024 as ScryptCostParameter,
        r: 8 as ScryptBlockSize,
        p: 1 as ScryptParallelism
      };
      const vaultA = createBareTestLibQC(sharedStorage, paramsA);
      await vaultA.setPassword(getTestPassword());
      await captureGeneratedMnemonic(vaultA);
      vaultA.lock();

      // Create a new instance against the same storage but with different scrypt params.
      // If unlock used instance params instead of stored params, this would fail.
      const paramsB: ScryptParams = {
        N: 2048 as ScryptCostParameter,
        r: 8 as ScryptBlockSize,
        p: 1 as ScryptParallelism
      };
      const vaultB = createBareTestLibQC(sharedStorage, paramsB);
      await vaultB.unlock(getTestPassword());
      expect(vaultB.isUnlocked()).toBe(true);

      // Verify data is accessible
      await expect(captureGeneratedMnemonic(vaultB)).rejects.toThrow(
        'Seed or entropy already exists in storage'
      );
    });

    test('password change works when vault was created with different scrypt params', async () => {
      const sharedStorage = new MockStorage(new Map());

      const paramsA: ScryptParams = {
        N: 1024 as ScryptCostParameter,
        r: 8 as ScryptBlockSize,
        p: 1 as ScryptParallelism
      };
      const vaultA = createBareTestLibQC(sharedStorage, paramsA);
      await vaultA.setPassword(getTestPassword());
      await captureGeneratedMnemonic(vaultA);
      vaultA.lock();

      // Change password from a new instance with different scrypt params
      const newPassword = Password.from(
        new TextEncoder().encode('New-Password-456!')
      );
      const paramsB: ScryptParams = {
        N: 2048 as ScryptCostParameter,
        r: 8 as ScryptBlockSize,
        p: 1 as ScryptParallelism
      };
      const vaultB = createBareTestLibQC(sharedStorage, paramsB);
      await vaultB.unlock(getTestPassword());
      await vaultB.setPassword(newPassword, getTestPassword());

      // Verify the new password works (new vault uses paramsB)
      vaultB.lock();
      await vaultB.unlock(newPassword);
      expect(vaultB.isUnlocked()).toBe(true);

      // Verify data survived the password change
      await expect(captureGeneratedMnemonic(vaultB)).rejects.toThrow(
        'Seed or entropy already exists in storage'
      );
    });
  });
});

describe('validatePassword', () => {
  test('returns valid: true with all requirements met for a fully compliant password', () => {
    const result = validatePassword(new TextEncoder().encode('ValidPass123!'));
    expect(result.valid).toBe(true);
    expect(result.requirements.minLength).toBe(true);
    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.digit).toBe(true);
    expect(result.requirements.specialChar).toBe(true);
  });

  test('returns minLength: false for a password under 8 characters that otherwise qualifies', () => {
    const result = validatePassword(new TextEncoder().encode('Va1!abc')); // 7 chars
    expect(result.valid).toBe(false);
    expect(result.requirements.minLength).toBe(false);
    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.digit).toBe(true);
    expect(result.requirements.specialChar).toBe(true);
  });

  test('returns uppercase: false when no uppercase letter is present', () => {
    const result = validatePassword(new TextEncoder().encode('validpass123!'));
    expect(result.valid).toBe(false);
    expect(result.requirements.uppercase).toBe(false);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.digit).toBe(true);
    expect(result.requirements.specialChar).toBe(true);
  });

  test('returns lowercase: false when no lowercase letter is present', () => {
    const result = validatePassword(new TextEncoder().encode('VALIDPASS123!'));
    expect(result.valid).toBe(false);
    expect(result.requirements.lowercase).toBe(false);
    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.digit).toBe(true);
    expect(result.requirements.specialChar).toBe(true);
  });

  test('returns digit: false when no digit is present', () => {
    const result = validatePassword(new TextEncoder().encode('ValidPassword!'));
    expect(result.valid).toBe(false);
    expect(result.requirements.digit).toBe(false);
    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.specialChar).toBe(true);
  });

  test('returns specialChar: false when no non-alphanumeric character is present', () => {
    const result = validatePassword(new TextEncoder().encode('ValidPass1234'));
    expect(result.valid).toBe(false);
    expect(result.requirements.specialChar).toBe(false);
    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.digit).toBe(true);
  });

  test('never throws — returns a result object for an empty string', () => {
    expect(() => validatePassword(new TextEncoder().encode(''))).not.toThrow();
    const result = validatePassword(new TextEncoder().encode(''));
    expect(result.valid).toBe(false);
  });
});
