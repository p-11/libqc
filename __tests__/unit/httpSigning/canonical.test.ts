import { describe, expect, it } from 'vitest';
import {
  buildCanonicalSigningMessage,
  sha256Hex
} from '../../../src/httpSigning/canonical';

describe('httpSigning canonical', () => {
  it('buildCanonicalSigningMessage is stable for fixed inputs', () => {
    const msg = buildCanonicalSigningMessage({
      keyId: 'kid-1',
      method: 'POST',
      pathnameWithSearch: '/v1/rpc?x=1',
      bodySha256Hex: 'a'.repeat(64),
      expUnixString: '1234567890',
      nonce: 'n-1'
    });
    expect(new TextDecoder().decode(msg)).toBe(
      [
        'libqc-signed-http-v1',
        'kid-1',
        'POST',
        '/v1/rpc?x=1',
        'a'.repeat(64),
        '1234567890',
        'n-1'
      ].join('\n')
    );
  });

  it('sha256Hex matches known empty-body digest', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
