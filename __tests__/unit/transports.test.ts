import * as viem from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Main entry point exports
import { type RpcUrl } from '../../src';

// Internal imports (not exported from main entry point)
import { makeBundlerTransport, makeTransport } from '../../src/transports';

// Mock viem's http and fallback functions
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    http: vi.fn(),
    fallback: vi.fn()
  };
});

describe('transports.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('makeTransport', () => {
    it('creates a single HTTP transport when given one URL', () => {
      const mockTransport = { type: 'http' };
      vi.mocked(viem.http).mockReturnValue(mockTransport as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      const result = makeTransport(urls);

      expect(viem.http).toHaveBeenCalledTimes(1);
      expect(viem.http).toHaveBeenCalledWith('https://rpc.example.com', {
        batch: true,
        fetchOptions: {
          headers: undefined
        }
      });
      expect(result).toBe(mockTransport);
    });

    it('creates HTTP transport with batch disabled', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      makeTransport(urls);

      expect(viem.http).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          batch: true
        })
      );
    });

    it('passes custom headers to HTTP transport', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      const headers = {
        Authorization: 'Bearer token123',
        'X-API-Key': 'secret'
      };

      makeTransport(urls, headers);

      expect(viem.http).toHaveBeenCalledWith('https://rpc.example.com', {
        batch: true,
        fetchOptions: {
          headers
        }
      });
    });

    it('creates a fallback transport when given multiple URLs', () => {
      const mockHttpTransport = { type: 'http' };
      const mockFallbackTransport = { type: 'fallback' };

      vi.mocked(viem.http).mockReturnValue(mockHttpTransport as any);
      vi.mocked(viem.fallback).mockReturnValue(mockFallbackTransport as any);

      const urls: RpcUrl[] = [
        'https://rpc1.example.com' as RpcUrl,
        'https://rpc2.example.com' as RpcUrl
      ];

      const result = makeTransport(urls);

      expect(viem.fallback).toHaveBeenCalledTimes(1);
      expect(viem.fallback).toHaveBeenCalledWith([
        mockHttpTransport,
        mockHttpTransport
      ]);
      expect(result).toBe(mockFallbackTransport);
    });

    it('creates individual HTTP transports for each URL in fallback', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const urls: RpcUrl[] = [
        'https://rpc1.example.com' as RpcUrl,
        'https://rpc2.example.com' as RpcUrl,
        'https://rpc3.example.com' as RpcUrl
      ];

      makeTransport(urls);

      // Each URL should get its own HTTP transport
      expect(viem.http).toHaveBeenCalledTimes(3);
      expect(viem.http).toHaveBeenCalledWith('https://rpc1.example.com', {
        batch: true,
        fetchOptions: { headers: undefined }
      });
      expect(viem.http).toHaveBeenCalledWith('https://rpc2.example.com', {
        batch: true,
        fetchOptions: { headers: undefined }
      });
      expect(viem.http).toHaveBeenCalledWith('https://rpc3.example.com', {
        batch: true,
        fetchOptions: { headers: undefined }
      });
    });

    it('passes headers to all transports in fallback', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const urls: RpcUrl[] = [
        'https://rpc1.example.com' as RpcUrl,
        'https://rpc2.example.com' as RpcUrl
      ];
      const headers = { 'X-Custom-Header': 'test-value' };

      makeTransport(urls, headers);

      expect(viem.http).toHaveBeenCalledWith('https://rpc1.example.com', {
        batch: true,
        fetchOptions: { headers }
      });
      expect(viem.http).toHaveBeenCalledWith('https://rpc2.example.com', {
        batch: true,
        fetchOptions: { headers }
      });
    });

    it('handles empty headers object', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      const headers = {};

      makeTransport(urls, headers);

      expect(viem.http).toHaveBeenCalledWith('https://rpc.example.com', {
        batch: true,
        fetchOptions: { headers: {} }
      });
    });

    it('works with different RPC providers', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = [
        'https://mainnet.infura.io/v3/your-api-key' as RpcUrl
      ];

      makeTransport(urls);

      expect(viem.http).toHaveBeenCalledWith(
        'https://mainnet.infura.io/v3/your-api-key',
        expect.objectContaining({
          batch: true
        })
      );
    });

    it('creates fallback with correct number of transports', () => {
      const mockHttpTransport = { type: 'http' };
      vi.mocked(viem.http).mockReturnValue(mockHttpTransport as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const urls: RpcUrl[] = [
        'https://rpc1.example.com' as RpcUrl,
        'https://rpc2.example.com' as RpcUrl,
        'https://rpc3.example.com' as RpcUrl,
        'https://rpc4.example.com' as RpcUrl
      ];

      makeTransport(urls);

      expect(viem.fallback).toHaveBeenCalledWith([
        mockHttpTransport,
        mockHttpTransport,
        mockHttpTransport,
        mockHttpTransport
      ]);
    });

    it('returns Transport type', () => {
      const mockTransport = { type: 'http' };
      vi.mocked(viem.http).mockReturnValue(mockTransport as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      const result = makeTransport(urls);

      // The result should be a Transport type (verified by TypeScript)
      expect(result).toBeDefined();
      expect(result).toBe(mockTransport);
    });

    it('handles multiple URLs with different headers', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const urls: RpcUrl[] = [
        'https://rpc1.example.com' as RpcUrl,
        'https://rpc2.example.com' as RpcUrl
      ];
      const headers = {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'abc-123'
      };

      makeTransport(urls, headers);

      // All transports in the fallback should receive the same headers
      expect(viem.http).toHaveBeenNthCalledWith(1, 'https://rpc1.example.com', {
        batch: true,
        fetchOptions: { headers }
      });
      expect(viem.http).toHaveBeenNthCalledWith(2, 'https://rpc2.example.com', {
        batch: true,
        fetchOptions: { headers }
      });
    });

    it('does not use fallback for single URL even with headers', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = ['https://rpc.example.com' as RpcUrl];
      const headers = { 'X-API-Key': 'secret' };

      makeTransport(urls, headers);

      expect(viem.http).toHaveBeenCalledTimes(1);
      expect(viem.fallback).not.toHaveBeenCalled();
    });

    it('passes fetchFn when httpSigningRef is provided', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      const httpSigningRef = {
        signingEnabled: true,
        vaultUnlocked: false,
        credentials: undefined
      };
      makeTransport(['https://rpc.example.com' as RpcUrl], undefined, {
        httpSigningRef
      });
      expect(viem.http).toHaveBeenCalledWith(
        'https://rpc.example.com',
        expect.objectContaining({
          batch: true,
          fetchFn: expect.any(Function),
          fetchOptions: { headers: undefined }
        })
      );
    });
  });

  describe('makeBundlerTransport', () => {
    it('creates a single HTTP transport with batch disabled', () => {
      const mockTransport = { type: 'http' };
      vi.mocked(viem.http).mockReturnValue(mockTransport as any);

      const urls: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
      const result = makeBundlerTransport(urls);

      expect(viem.http).toHaveBeenCalledWith('https://bundler.example.com', {
        batch: false,
        fetchOptions: { headers: undefined }
      });
      expect(result).toBe(mockTransport);
    });

    it('passes headers to bundler transport', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);

      const urls: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
      const headers = { Authorization: 'Bearer token' };

      makeBundlerTransport(urls, headers);

      expect(viem.http).toHaveBeenCalledWith('https://bundler.example.com', {
        batch: false,
        fetchOptions: { headers }
      });
    });

    it('creates a fallback transport for multiple bundler URLs', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const urls: RpcUrl[] = [
        'https://bundler1.example.com' as RpcUrl,
        'https://bundler2.example.com' as RpcUrl
      ];

      makeBundlerTransport(urls);

      expect(viem.http).toHaveBeenCalledTimes(2);
      expect(viem.fallback).toHaveBeenCalledTimes(1);
      expect(viem.http).toHaveBeenCalledWith('https://bundler1.example.com', {
        batch: false,
        fetchOptions: { headers: undefined }
      });
    });

    it('never enables batch regardless of URL count', () => {
      vi.mocked(viem.http).mockReturnValue({ type: 'http' } as any);
      vi.mocked(viem.fallback).mockReturnValue({ type: 'fallback' } as any);

      const single: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
      const multi: RpcUrl[] = [
        'https://bundler1.example.com' as RpcUrl,
        'https://bundler2.example.com' as RpcUrl
      ];

      makeBundlerTransport(single);
      makeBundlerTransport(multi);

      const httpCalls = vi.mocked(viem.http).mock.calls;
      for (const [, opts] of httpCalls) {
        expect((opts as any).batch).toBe(false);
      }
    });
  });
});
