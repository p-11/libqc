import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  buildCanonicalSigningMessage,
  sha256Hex,
  type CanonicalSigningMessageParams
} from './canonical';
import {
  HEADER_KEY_ID,
  HEADER_SIGNATURE,
  HEADER_SIGNED_EXPIRES,
  HEADER_SIGNED_NONCE
} from './constants';
import { encodeBase64Url } from './base64url';
import type { HttpSigningTransportRef } from './transportRef';

async function bodyBytesFromInit(init?: RequestInit): Promise<Uint8Array> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return new Uint8Array(0);
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Uint8Array) {
    return new Uint8Array(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
  }
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}

function resolveHref(input: RequestInfo | URL): string {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  throw new Error('resolveHref: unsupported fetch URL input');
}

function pathnameWithSearchFromHref(href: string): string {
  const parsed = new URL(href);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Returns a `fetch` implementation that adds ML-DSA-65 signing headers when
 * {@link HttpSigningTransportRef.signingEnabled} and `vaultUnlocked` are true
 * and credentials are present.
 *
 * @param innerFetch - Underlying fetch (typically `globalThis.fetch`)
 * @param ref - Mutable signing state owned by `LibQC`
 */
export function createSignedHttpFetchFn(
  innerFetch: typeof fetch,
  ref: HttpSigningTransportRef
): typeof fetch {
  return async (input, init) => {
    if (!ref.signingEnabled) {
      return innerFetch(input, init);
    }
    if (!ref.vaultUnlocked) {
      throw new Error(
        'Signed HTTP is enabled but the vault is locked. Unlock the vault before sending requests.'
      );
    }

    const creds = ref.credentials;
    if (creds === undefined) {
      throw new Error(
        'Signed HTTP is enabled but ML-DSA credentials are not loaded. ' +
          'Ensure the vault is unlocked and registration completed.'
      );
    }

    const href = resolveHref(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const bodyBytes = await bodyBytesFromInit(init);
    const bodySha = sha256Hex(bodyBytes);
    const pathnameWithSearch = pathnameWithSearchFromHref(href);
    const exp = Math.floor(Date.now() / 1000) + 300;
    const nonce = `libqc-${globalThis.crypto.randomUUID()}`;

    const canonicalParams: CanonicalSigningMessageParams = {
      keyId: creds.keyId,
      method,
      pathnameWithSearch,
      bodySha256Hex: bodySha,
      expUnixString: String(exp),
      nonce
    };
    const canonical = buildCanonicalSigningMessage(canonicalParams);
    const signature = ml_dsa65.sign(canonical, creds.mlDsa65SecretKey);

    const headers = new Headers(init?.headers ?? undefined);
    headers.set(HEADER_KEY_ID, creds.keyId);
    headers.set(HEADER_SIGNATURE, encodeBase64Url(signature));
    headers.set(HEADER_SIGNED_EXPIRES, String(exp));
    headers.set(HEADER_SIGNED_NONCE, nonce);

    const nextInit: RequestInit = {
      ...init,
      headers
    };

    return innerFetch(input, nextInit);
  };
}
