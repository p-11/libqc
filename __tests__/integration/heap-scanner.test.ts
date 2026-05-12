import { describe, it, expect } from 'vitest';
import { countSequenceInHeapStream } from './heap-scanner';

/**
 * Heap Scanner Validation Test (libqc)
 *
 * This test ensures that our memory scanner is functional in the Node.js environment.
 */
describe('Heap Scanner Verification', () => {
  it('scanner should correctly identify an intentional global leak in Node.js', async () => {
    const id = Math.random().toString(36).substring(7);
    const secret = 'LEAK_DETECT_TEST_' + id;
    const sequence = Array.from(secret).map(c => c.charCodeAt(0));

    // 1. Inject into global scope
    (global as any).EXPECTED_LEAK = secret;

    // 2. Verify it's found
    const count = await countSequenceInHeapStream(sequence);
    expect(count).toBeGreaterThan(0);

    // Cleanup
    delete (global as any).EXPECTED_LEAK;
  });

  it('scanner should correctly identify an intentional Uint8Array leak in Node.js', async () => {
    const secret = 'BYTE_LEAK_TEST_123';
    const bytes = new TextEncoder().encode(secret);

    // 1. Inject as a string
    (global as any).EXPECTED_BYTE_LEAK = secret;

    // 2. Verify it's found using the Uint8Array
    const count = await countSequenceInHeapStream(bytes);
    expect(count).toBeGreaterThan(0);

    // Cleanup
    delete (global as any).EXPECTED_BYTE_LEAK;
  });

  it('scanner should correctly confirm absence after cleanup', async () => {
    // Helper to avoid keeping the secret string in the local stack of the test function
    const leakAndGetSequence = () => {
      const id = Math.random().toString(36).substring(7);
      const secret = 'LEAK_ABSENCE_TEST_' + id;
      (global as any).TEMP_LEAK = secret;
      return Array.from(secret).map(c => c.charCodeAt(0));
    };

    const sequence = leakAndGetSequence();

    // 1. Verify it's there first
    const countBefore = await countSequenceInHeapStream(sequence);
    expect(countBefore).toBeGreaterThan(0);

    // 2. Clear reference
    (global as any).TEMP_LEAK = null;
    delete (global as any).TEMP_LEAK;

    // 3. Scanner should now find nothing
    const countAfter = await countSequenceInHeapStream(sequence);

    expect(countAfter).toBe(0);
  });
});
