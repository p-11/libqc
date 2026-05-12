import { describe, expect, it } from 'vitest';
import { Mnemonic } from '../../src/types';
import {
  MockStorage,
  getTestPassword,
  TEST_MNEMONIC_PHRASE,
  createBareTestLibQC
} from '../testUtils';

describe('Memory Security (Zeroing)', () => {
  it('should zero out the mnemonic buffer after importWallet', async () => {
    const storage = new MockStorage(new Map());
    const vault = createBareTestLibQC(storage);

    // Create a buffer that we OWN and pass to the vault
    const mnemonicStr = TEST_MNEMONIC_PHRASE;
    const mnemonicBytes = new TextEncoder().encode(mnemonicStr);
    const mnemonic = Mnemonic.from(mnemonicBytes);

    // Verify it's not zeroed yet
    expect(mnemonic[0]).not.toBe(0);

    await vault.importWallet(mnemonic, getTestPassword());

    // VERIFY: The vault must have zeroed our input buffer
    for (let i = 0; i < mnemonic.length; i++) {
      expect(mnemonic[i]).toBe(0);
    }
  });

  it('should zero out the mnemonic buffer after generateMnemonic callback', async () => {
    const storage = new MockStorage(new Map());
    const vault = createBareTestLibQC(storage);
    await vault.setPassword(getTestPassword());

    let capturedMnemonic: Mnemonic | undefined;

    await vault.generateMnemonic(async mnemonic => {
      capturedMnemonic = mnemonic;
      expect(mnemonic[0]).not.toBe(0);
      return true;
    });

    // VERIFY: The buffer passed to the callback must be zeroed after callback returns
    expect(capturedMnemonic).toBeDefined();
    if (capturedMnemonic) {
      for (let i = 0; i < capturedMnemonic.length; i++) {
        expect(capturedMnemonic[i]).toBe(0);
      }
    }
  });

  it('should zero out internal entropy and seed buffers in cryptography (mock check)', async () => {
    // This is harder to test without mocks, but we can verify that
    // the state object is zeroed by zeroLibQCState
    const { zeroLibQCState } = await import('../../src/state');

    const entropy = new Uint8Array(32).fill(1);
    const seed = new Uint8Array(64).fill(2);
    const state = {
      entropy,
      seed,
      addresses: []
    };

    zeroLibQCState(state);

    expect(entropy.every(b => b === 0)).toBe(true);
    expect(seed.every(b => b === 0)).toBe(true);
  });
});
