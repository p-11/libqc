import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { describe, expect, it, vi } from 'vitest';
import { createSignedHttpFetchFn } from '../../../src/httpSigning/signedFetch';
import type { HttpSigningTransportRef } from '../../../src/httpSigning/transportRef';
import {
  HEADER_KEY_ID,
  HEADER_SIGNATURE,
  HEADER_SIGNED_EXPIRES,
  HEADER_SIGNED_NONCE
} from '../../../src/httpSigning/constants';

describe('createSignedHttpFetchFn', () => {
  it('forwards unchanged when signingEnabled is false', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    const ref: HttpSigningTransportRef = {
      signingEnabled: false,
      vaultUnlocked: true,
      credentials: undefined
    };
    const fetchFn = createSignedHttpFetchFn(inner, ref);
    await fetchFn('https://example.com/path?q=1', {
      method: 'POST',
      body: '{"jsonrpc":"2.0"}'
    });
    expect(inner).toHaveBeenCalledTimes(1);
    const firstCall = inner.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall;
    expect(String(url)).toBe('https://example.com/path?q=1');
    expect(init?.headers).toBeUndefined();
  });

  it('throws when vault is locked and signing is enabled', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    const ref: HttpSigningTransportRef = {
      signingEnabled: true,
      vaultUnlocked: false,
      credentials: undefined
    };
    const fetchFn = createSignedHttpFetchFn(inner, ref);
    await expect(
      fetchFn('https://example.com/rpc', { method: 'POST', body: '{}' })
    ).rejects.toThrow(/vault is locked/u);
    expect(inner).not.toHaveBeenCalled();
  });

  it('adds signing headers when unlocked with credentials', async () => {
    const keys = ml_dsa65.keygen();
    const secretCopy = new Uint8Array(keys.secretKey);
    keys.secretKey.fill(0);
    keys.publicKey.fill(0);

    const inner = vi.fn().mockResolvedValue(new Response('ok'));
    const ref: HttpSigningTransportRef = {
      signingEnabled: true,
      vaultUnlocked: true,
      credentials: {
        keyId: 'reg-key-99',
        mlDsa65SecretKey: secretCopy
      }
    };

    const fetchFn = createSignedHttpFetchFn(inner, ref);
    await fetchFn('https://proxy.example/rpc', {
      method: 'POST',
      body: '{"a":1}'
    });

    expect(inner).toHaveBeenCalledTimes(1);
    const signedCall = inner.mock.calls[0];
    expect(signedCall).toBeDefined();
    const init = signedCall[1];
    expect(init).toBeDefined();
    const headers = new Headers(init.headers);
    expect(headers.get(HEADER_KEY_ID)).toBe('reg-key-99');
    expect(headers.get(HEADER_SIGNATURE)).toBeTruthy();
    expect(headers.get(HEADER_SIGNED_EXPIRES)).toMatch(/^\d+$/u);
    expect(headers.get(HEADER_SIGNED_NONCE)).toMatch(/^libqc-/u);

    ref.credentials?.mlDsa65SecretKey.fill(0);
  });

  it('throws when unlocked but credentials are missing', async () => {
    const inner = vi.fn();
    const ref: HttpSigningTransportRef = {
      signingEnabled: true,
      vaultUnlocked: true,
      credentials: undefined
    };
    const fetchFn = createSignedHttpFetchFn(inner, ref);
    await expect(
      fetchFn('https://example.com/rpc', { method: 'POST', body: '{}' })
    ).rejects.toThrow(/credentials are not loaded/u);
    expect(inner).not.toHaveBeenCalled();
  });
});
