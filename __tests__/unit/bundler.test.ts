import * as viem from 'viem/account-abstraction';
import { mainnet, sepolia } from 'viem/chains';
import { describe, expect, it, vi } from 'vitest';

// Main entry point exports
import { type RpcUrl } from '../../src';

// Internal imports (not exported from main entry point)
import { getBundlerClient } from '../../src/bundler';
import * as transports from '../../src/transports';

// Mock viem's createBundlerClient
vi.mock('viem/account-abstraction', () => ({
  createBundlerClient: vi.fn()
}));

// Spy on makeTransport
vi.mock('../../src/transports', async () => {
  const actual = await vi.importActual<typeof transports>(
    '../../src/transports'
  );
  return {
    ...actual,
    makeTransport: vi.fn(actual.makeTransport)
  };
});

describe('bundler.ts', () => {
  it('calls createBundlerClient with correct chain and transport', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
    const headers = { 'X-Custom-Header': 'test' };
    const result = getBundlerClient({ chain: mainnet, urls, headers });

    expect(viem.createBundlerClient).toHaveBeenCalledTimes(1);
    expect(viem.createBundlerClient).toHaveBeenCalledWith({
      chain: mainnet,
      transport: expect.anything()
    });
    expect(result).toBe(mockBundlerClient);
  });

  it('calls makeTransport with the provided URLs and headers', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = [
      'https://bundler1.example.com' as RpcUrl,
      'https://bundler2.example.com' as RpcUrl
    ];
    const headers = { Authorization: 'Bearer token123' };

    getBundlerClient({ chain: mainnet, urls, headers });

    expect(transports.makeTransport).toHaveBeenCalledWith(urls, headers);
  });

  it('works with different chains', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = ['https://sepolia-bundler.example.com' as RpcUrl];
    const headers = {};
    const result = getBundlerClient({ chain: sepolia, urls, headers });

    expect(viem.createBundlerClient).toHaveBeenCalledWith({
      chain: sepolia,
      transport: expect.anything()
    });
    expect(result).toBe(mockBundlerClient);
  });

  it('works with a single RPC URL', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = ['https://single-bundler.example.com' as RpcUrl];
    const headers = {};
    const result = getBundlerClient({ chain: mainnet, urls, headers });

    expect(transports.makeTransport).toHaveBeenCalledWith(urls, headers);
    expect(result).toBe(mockBundlerClient);
  });

  it('works with multiple RPC URLs for fallback', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = [
      'https://bundler1.example.com' as RpcUrl,
      'https://bundler2.example.com' as RpcUrl,
      'https://bundler3.example.com' as RpcUrl
    ];
    const headers = { 'X-API-Key': 'abc123' };
    const result = getBundlerClient({ chain: mainnet, urls, headers });

    expect(transports.makeTransport).toHaveBeenCalledWith(urls, headers);
    expect(result).toBe(mockBundlerClient);
  });

  it('returns the bundler client created by viem', () => {
    const mockBundlerClient = {
      sendUserOperation: vi.fn(),
      getUserOperationReceipt: vi.fn(),
      estimateUserOperationGas: vi.fn()
    };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
    const headers = {};
    const result = getBundlerClient({ chain: mainnet, urls, headers });

    expect(result).toEqual(mockBundlerClient);
    expect(result.sendUserOperation).toBeDefined();
    expect(result.getUserOperationReceipt).toBeDefined();
    expect(result.estimateUserOperationGas).toBeDefined();
  });

  it('passes custom headers to makeTransport', () => {
    const mockBundlerClient = { mock: 'bundler-client' };
    vi.mocked(viem.createBundlerClient).mockReturnValue(
      mockBundlerClient as any
    );

    const urls: RpcUrl[] = ['https://bundler.example.com' as RpcUrl];
    const headers = {
      'X-Bundler-Key': 'secret-key',
      'Content-Type': 'application/json'
    };

    getBundlerClient({ chain: mainnet, urls, headers });

    expect(transports.makeTransport).toHaveBeenCalledWith(urls, headers);
  });
});
