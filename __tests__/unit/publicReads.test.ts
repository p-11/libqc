import { AccountId, ChainId } from 'caip';
import { getAddress, PublicClient } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Main entry point exports
import { IconUrl, type ChainSpecification } from '../../src';

// Internal imports (not exported from main entry point)
import { createEvmReadOnlyChainClients } from '../../src/publicClients';
import {
  getErc20TokenBalanceByChain,
  getErc20TokenDetails,
  getNativeBalance
} from '../../src/publicReads';
import { createTestChains, createTypedChain } from '../testUtils';

type BalanceMap = Record<string, bigint>;

// P11TODO: Consider removing mocks and calling a real RPC client against a testnet
function setupGetBalanceMocks(
  registry: ReturnType<typeof createEvmReadOnlyChainClients>,
  balances: BalanceMap
) {
  // Patch existing clients
  for (const [chainIdString, client] of registry.all()) {
    client.getBalance = vi.fn(() =>
      Promise.resolve(balances[chainIdString] ?? 0n)
    );
  }
}

const ZERO = '0x0000000000000000000000000000000000000000';
const TOKEN = '0x000000000000000000000000000000000000dEaD';

describe('getNativeBalance with client.getBalance mocked', () => {
  let registry: ReturnType<typeof createEvmReadOnlyChainClients>;

  beforeEach(() => {
    const chains = createTestChains();
    registry = createEvmReadOnlyChainClients(chains);
    setupGetBalanceMocks(registry, { 'eip155:1': 1n, 'eip155:8453': 2n });
  });

  it('routes by chainId and returns balance result with native currency info', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const chainId8453 = new ChainId({ namespace: 'eip155', reference: '8453' });
    const accountId1 = new AccountId({ chainId: chainId1, address: ZERO });
    const accountId8453 = new AccountId({
      chainId: chainId8453,
      address: ZERO
    });
    const b1 = await getNativeBalance(
      registry.getByChainId(chainId1),
      accountId1
    );
    const b2 = await getNativeBalance(
      registry.getByChainId(chainId8453),
      accountId8453
    );

    expect(b1.balance).toBe(1n);
    expect(b1.decimals).toBe(18);
    expect(b1.symbol).toBe('ETH');
    expect(b2.balance).toBe(2n);
    expect(b2.decimals).toBe(18);
    expect(b2.symbol).toBe('ETH');

    const c1 = registry.getByChainId(chainId1);
    const c2 = registry.getByChainId(chainId8453);
    expect(c1.getBalance).toHaveBeenCalledTimes(1);
    expect(c2.getBalance).toHaveBeenCalledTimes(1);
  });

  it('validates and normalizes the address before calling getBalance', async () => {
    const lower = '0x52908400098527886e0f7030069857d2e4169ee7';
    const validatedAddress = getAddress(lower);
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({ chainId: chainId1, address: lower });

    await getNativeBalance(registry.getByChainId(chainId1), accountId);

    const c1 = registry.getByChainId(chainId1);
    expect(c1.getBalance).toHaveBeenCalledWith({ address: validatedAddress });
  });

  it('throws on invalid address and never calls client', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({
      chainId: chainId1,
      address: '0xfoo'
    });
    await expect(
      getNativeBalance(registry.getByChainId(chainId1), accountId)
    ).rejects.toThrow();

    const c1 = registry.getByChainId(chainId1);
    expect(c1.getBalance).not.toHaveBeenCalled();
  });

  it('propagates unknown chain errors from registry', () => {
    const unknownChainId = new ChainId({
      namespace: 'eip155',
      reference: '999'
    });
    new AccountId({
      chainId: unknownChainId,
      address: ZERO
    });
    expect(() => registry.getByChainId(unknownChainId)).toThrow(
      'Unknown chainId eip155:999'
    );
  });

  it('propagates client getBalance errors', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({ chainId: chainId1, address: ZERO });
    registry.getByChainId(chainId1).getBalance = vi
      .fn()
      .mockRejectedValueOnce(new Error('RPC down'));

    await expect(
      getNativeBalance(registry.getByChainId(chainId1), accountId)
    ).rejects.toThrow('RPC down');
  });

  it('returns 0n balance for chains without an explicit mocked value', async () => {
    // Recreate with a chain that has no entry in the balances map
    const chains: ChainSpecification[] = [
      createTypedChain({
        chainId: 10,
        name: 'OP',
        network: 'optimism',
        iconUrl: 'https://example.com/op.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://op.example.org']
      })
    ];
    const reg = createEvmReadOnlyChainClients(chains);
    setupGetBalanceMocks(reg, { 'eip155:1': 1n }); // no 10 entry

    const chainId10 = new ChainId({ namespace: 'eip155', reference: '10' });
    const accountId = new AccountId({ chainId: chainId10, address: ZERO });
    const b = await getNativeBalance(reg.getByChainId(chainId10), accountId);
    expect(b.balance).toBe(0n);
    expect(b.decimals).toBe(18);
    expect(b.symbol).toBe('ETH');
  });
});

// P11TODO: Consider removing mocks and calling a real RPC client against a testnet
function mockErc20Reads(
  client: PublicClient,
  values: { balance?: bigint; decimals?: number; symbol?: string } = {}
) {
  type Read = typeof client.readContract;

  const impl: Read = (async args => {
    const fn = args.functionName;
    if (fn === 'balanceOf') {
      const v = values.balance ?? 0n;
      return v as Awaited<ReturnType<Read>>;
    }
    if (fn === 'decimals') {
      const v = values.decimals ?? 18;
      return v as Awaited<ReturnType<Read>>;
    }
    if (fn === 'symbol') {
      const v = values.symbol ?? 'TKN';
      return v as Awaited<ReturnType<Read>>;
    }
    throw new Error(`Unexpected function ${String(fn)}`);
  }) as Read;

  vi.spyOn(client, 'readContract').mockImplementation(impl);
}

describe('getTokenBalanceByChain with client.readContract mocked', () => {
  let registry: ReturnType<typeof createEvmReadOnlyChainClients>;

  beforeEach(() => {
    const chains = createTestChains();

    registry = createEvmReadOnlyChainClients(chains);

    // Default mock values for all tests
    for (const [, client] of registry.all()) {
      mockErc20Reads(client, { balance: 0n, decimals: 18, symbol: 'TKN' });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes by chainId and returns balance object', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const chainId8453 = new ChainId({ namespace: 'eip155', reference: '8453' });
    const accountId1 = new AccountId({ chainId: chainId1, address: ZERO });
    const accountId8453 = new AccountId({
      chainId: chainId8453,
      address: ZERO
    });
    mockErc20Reads(registry.getByChainId(chainId1), {
      balance: 123n,
      decimals: 6,
      symbol: 'USDC'
    });
    mockErc20Reads(registry.getByChainId(chainId8453), {
      balance: 456n,
      decimals: 18,
      symbol: 'ETHx'
    });
    const r1 = await getErc20TokenBalanceByChain(
      registry.getByChainId(chainId1),
      accountId1,
      TOKEN
    );
    const r2 = await getErc20TokenBalanceByChain(
      registry.getByChainId(chainId8453),
      accountId8453,
      TOKEN
    );

    expect(r1).toEqual({ balance: 123n, decimals: 6, symbol: 'USDC' });
    expect(r2).toEqual({ balance: 456n, decimals: 18, symbol: 'ETHx' });

    const c1 = registry.getByChainId(chainId1);
    const c2 = registry.getByChainId(chainId8453);
    expect(c1.readContract).toHaveBeenCalledTimes(3);
    expect(c2.readContract).toHaveBeenCalledTimes(3);
  });

  it('validates and normalizes token and holder addresses before calling', async () => {
    const lowerToken = '0x000000000000000000000000000000000000dead';
    const lowerHolder = '0x52908400098527886e0f7030069857d2e4169ee7';
    const token = getAddress(lowerToken);
    const holder = getAddress(lowerHolder);
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({
      chainId: chainId1,
      address: lowerHolder
    });

    await getErc20TokenBalanceByChain(
      registry.getByChainId(chainId1),
      accountId,
      lowerToken
    );

    const calls = (
      registry.getByChainId(chainId1).readContract as ReturnType<typeof vi.fn>
    ).mock.calls;
    // metadata Promise is created before the first await, so decimals + symbol
    // are dispatched before balanceOf in the outer Promise.all
    expect(calls[0][0]).toMatchObject({
      address: token,
      functionName: 'decimals'
    });
    expect(calls[1][0]).toMatchObject({
      address: token,
      functionName: 'symbol'
    });
    expect(calls[2][0]).toMatchObject({
      address: token,
      functionName: 'balanceOf',
      args: [holder]
    });
  });

  it('throws on invalid holder address and never calls client', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({
      chainId: chainId1,
      address: '0xfoo'
    });
    await expect(
      getErc20TokenBalanceByChain(
        registry.getByChainId(chainId1),
        accountId,
        TOKEN
      )
    ).rejects.toThrow();

    const c1 = registry.getByChainId(chainId1);
    expect(c1.readContract).not.toHaveBeenCalled();
  });

  it('throws on invalid token address and never calls client', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({ chainId: chainId1, address: ZERO });
    await expect(
      getErc20TokenBalanceByChain(
        registry.getByChainId(chainId1),
        accountId,
        '0xbar' as any
      )
    ).rejects.toThrow();

    const c1 = registry.getByChainId(chainId1);
    expect(c1.readContract).not.toHaveBeenCalled();
  });

  it('propagates unknown chain errors from registry', () => {
    const unknownChainId = new ChainId({
      namespace: 'eip155',
      reference: '999'
    });
    new AccountId({
      chainId: unknownChainId,
      address: ZERO
    });
    expect(() => registry.getByChainId(unknownChainId)).toThrow(
      'Unknown chainId eip155:999'
    );
  });

  it('propagates client readContract errors', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId = new AccountId({ chainId: chainId1, address: ZERO });
    const c1 = registry.getByChainId(chainId1);
    (c1.readContract as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('RPC down')
    );

    await expect(
      getErc20TokenBalanceByChain(
        registry.getByChainId(chainId1),
        accountId,
        TOKEN
      )
    ).rejects.toThrow('RPC down');
  });

  it('only fetches decimals and symbol once per (client, token) — subsequent calls only call balanceOf', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId1 = new AccountId({ chainId: chainId1, address: ZERO });
    const accountId2 = new AccountId({
      chainId: chainId1,
      address: '0x000000000000000000000000000000000000dEaD'
    });
    const c1 = registry.getByChainId(chainId1);
    mockErc20Reads(c1, { balance: 100n, decimals: 6, symbol: 'USDC' });

    const r1 = await getErc20TokenBalanceByChain(c1, accountId1, TOKEN);
    // Second account, same client + token → metadata Promise already resolved, only balanceOf fires
    mockErc20Reads(c1, { balance: 200n, decimals: 6, symbol: 'USDC' });
    const r2 = await getErc20TokenBalanceByChain(c1, accountId2, TOKEN);

    expect(r1).toEqual({ balance: 100n, decimals: 6, symbol: 'USDC' });
    expect(r2).toEqual({ balance: 200n, decimals: 6, symbol: 'USDC' });
    // First call: decimals + symbol + balanceOf = 3 reads
    // Second call: balanceOf only = 1 read
    expect(c1.readContract).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent callers — shares one metadata fetch for the same (client, token)', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const accountId1 = new AccountId({ chainId: chainId1, address: ZERO });
    const accountId2 = new AccountId({
      chainId: chainId1,
      address: '0x000000000000000000000000000000000000dEaD'
    });
    const c1 = registry.getByChainId(chainId1);
    mockErc20Reads(c1, { balance: 100n, decimals: 6, symbol: 'USDC' });

    // Both calls start in the same Promise.all — the metadata Promise is stored
    // before the first await so the second caller finds it and joins rather than
    // starting its own decimals+symbol fetch.
    const [r1, r2] = await Promise.all([
      getErc20TokenBalanceByChain(c1, accountId1, TOKEN),
      getErc20TokenBalanceByChain(c1, accountId2, TOKEN)
    ]);

    expect(r1).toEqual({ balance: 100n, decimals: 6, symbol: 'USDC' });
    expect(r2).toEqual({ balance: 100n, decimals: 6, symbol: 'USDC' });
    // 2×balanceOf + 1×decimals + 1×symbol = 4, not 6 (the old 2×3 uncoalesced behavior)
    expect(c1.readContract).toHaveBeenCalledTimes(4);
  });

  it('returns defaults when only balance is provided in mocks', async () => {
    const chains: ChainSpecification[] = [
      createTypedChain({
        chainId: 10,
        name: 'OP',
        network: 'optimism',
        iconUrl: 'https://example.com/op.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://op.example.org']
      })
    ];
    const reg = createEvmReadOnlyChainClients(chains);
    const chainId10 = new ChainId({ namespace: 'eip155', reference: '10' });
    const accountId = new AccountId({ chainId: chainId10, address: ZERO });
    mockErc20Reads(reg.getByChainId(chainId10), { balance: 0n });
    const r = await getErc20TokenBalanceByChain(
      reg.getByChainId(chainId10),
      accountId,
      TOKEN
    );
    expect(r).toEqual({ balance: 0n, decimals: 18, symbol: 'TKN' });
  });
});

function mockErc20TokenDetails(
  client: PublicClient,
  values: {
    name?: string;
    symbol?: string;
    decimals?: number;
    totalSupply?: bigint;
  } = {}
) {
  type Read = typeof client.readContract;

  const impl: Read = (async args => {
    const fn = args.functionName;
    if (fn === 'name') {
      const v = values.name ?? 'Token Name';
      return v as Awaited<ReturnType<Read>>;
    }
    if (fn === 'symbol') {
      const v = values.symbol ?? 'TKN';
      return v as Awaited<ReturnType<Read>>;
    }
    if (fn === 'decimals') {
      const v = values.decimals ?? 18;
      return v as Awaited<ReturnType<Read>>;
    }
    if (fn === 'totalSupply') {
      const v = values.totalSupply ?? 1000000n;
      return v as Awaited<ReturnType<Read>>;
    }
    throw new Error(`Unexpected function ${String(fn)}`);
  }) as Read;

  vi.spyOn(client, 'readContract').mockImplementation(impl);
}

describe('getErc20TokenDetails with client.readContract mocked', () => {
  let registry: ReturnType<typeof createEvmReadOnlyChainClients>;

  beforeEach(() => {
    const chains = createTestChains();

    registry = createEvmReadOnlyChainClients(chains);

    // Default mock values for all tests
    for (const [, client] of registry.all()) {
      mockErc20TokenDetails(client, {
        name: 'Token Name',
        symbol: 'TKN',
        decimals: 18,
        totalSupply: 1000000n
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns token details with all fields', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    mockErc20TokenDetails(registry.getByChainId(chainId1), {
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1000000000000n
    });

    const result = await getErc20TokenDetails(
      registry.getByChainId(chainId1),
      TOKEN
    );

    expect(result).toEqual({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1000000000000n
    });

    const c1 = registry.getByChainId(chainId1);
    expect(c1.readContract).toHaveBeenCalledTimes(4);
  });

  it('routes by chainId and returns correct token details per chain', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const chainId8453 = new ChainId({ namespace: 'eip155', reference: '8453' });

    mockErc20TokenDetails(registry.getByChainId(chainId1), {
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 5000000000n
    });
    mockErc20TokenDetails(registry.getByChainId(chainId8453), {
      name: 'Wrapped Ethereum',
      symbol: 'WETH',
      decimals: 18,
      totalSupply: 123456789n
    });

    const r1 = await getErc20TokenDetails(
      registry.getByChainId(chainId1),
      TOKEN
    );
    const r2 = await getErc20TokenDetails(
      registry.getByChainId(chainId8453),
      TOKEN
    );

    expect(r1).toEqual({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 5000000000n
    });
    expect(r2).toEqual({
      name: 'Wrapped Ethereum',
      symbol: 'WETH',
      decimals: 18,
      totalSupply: 123456789n
    });

    const c1 = registry.getByChainId(chainId1);
    const c2 = registry.getByChainId(chainId8453);
    expect(c1.readContract).toHaveBeenCalledTimes(4);
    expect(c2.readContract).toHaveBeenCalledTimes(4);
  });

  it('validates and normalizes token address before calling', async () => {
    const lowerToken = '0x000000000000000000000000000000000000dead';
    const token = getAddress(lowerToken);
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });

    await getErc20TokenDetails(registry.getByChainId(chainId1), lowerToken);

    const calls = (
      registry.getByChainId(chainId1).readContract as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(calls[0][0]).toMatchObject({
      address: token,
      functionName: 'name'
    });
    expect(calls[1][0]).toMatchObject({
      address: token,
      functionName: 'symbol'
    });
    expect(calls[2][0]).toMatchObject({
      address: token,
      functionName: 'decimals'
    });
    expect(calls[3][0]).toMatchObject({
      address: token,
      functionName: 'totalSupply'
    });
  });

  it('throws on invalid token address and never calls client', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    await expect(
      getErc20TokenDetails(
        registry.getByChainId(chainId1),
        '0xInvalidAddress' as any
      )
    ).rejects.toThrow();

    const c1 = registry.getByChainId(chainId1);
    expect(c1.readContract).not.toHaveBeenCalled();
  });

  it('propagates client readContract errors', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const c1 = registry.getByChainId(chainId1);
    (c1.readContract as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Contract call failed')
    );

    await expect(
      getErc20TokenDetails(registry.getByChainId(chainId1), TOKEN)
    ).rejects.toThrow('Contract call failed');
  });

  it('handles token with zero total supply', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    mockErc20TokenDetails(registry.getByChainId(chainId1), {
      name: 'New Token',
      symbol: 'NEW',
      decimals: 18,
      totalSupply: 0n
    });

    const result = await getErc20TokenDetails(
      registry.getByChainId(chainId1),
      TOKEN
    );

    expect(result.totalSupply).toBe(0n);
    expect(result).toEqual({
      name: 'New Token',
      symbol: 'NEW',
      decimals: 18,
      totalSupply: 0n
    });
  });

  it('handles token with non-standard decimals', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    mockErc20TokenDetails(registry.getByChainId(chainId1), {
      name: 'Special Token',
      symbol: 'SPEC',
      decimals: 2,
      totalSupply: 100n
    });

    const result = await getErc20TokenDetails(
      registry.getByChainId(chainId1),
      TOKEN
    );

    expect(result.decimals).toBe(2);
    expect(result).toEqual({
      name: 'Special Token',
      symbol: 'SPEC',
      decimals: 2,
      totalSupply: 100n
    });
  });

  it('handles very large total supply values', async () => {
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const largeSupply = 999999999999999999999999999999n;
    mockErc20TokenDetails(registry.getByChainId(chainId1), {
      name: 'Mega Token',
      symbol: 'MEGA',
      decimals: 18,
      totalSupply: largeSupply
    });

    const result = await getErc20TokenDetails(
      registry.getByChainId(chainId1),
      TOKEN
    );

    expect(result.totalSupply).toBe(largeSupply);
  });
});
