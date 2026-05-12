import { AccountId } from 'caip';
import { erc20Abi, getAddress, PublicClient } from 'viem';
import {
  EvmAddress,
  AssetName,
  BalanceBigInt,
  BalanceResult,
  Decimals,
  Symbol,
  TokenDetails,
  TokenMetadata,
  TotalSupplyBigInt
} from './types';

/**
 * Get the native currency balance for an account.
 * @param client - PublicClient for the chain
 * @param accountId - Account ID (CAIP-10 format) containing chain and address
 * @returns Balance result with balance, decimals, and symbol from the chain's native currency
 */
export async function getNativeBalance(
  client: PublicClient,
  accountId: AccountId
): Promise<BalanceResult> {
  const chain = client.chain;
  if (!chain) {
    throw new Error('Chain information not available from PublicClient');
  }

  // normalize + validate address; throws on invalid
  const validatedAddress = getAddress(accountId.address);
  const balance = await client.getBalance({ address: validatedAddress });

  return {
    balance: balance as BalanceBigInt,
    decimals: chain.nativeCurrency.decimals as Decimals,
    symbol: chain.nativeCurrency.symbol as Symbol
  };
}

// Token metadata (decimals + symbol) is immutable after contract deployment.
// The cache stores the in-flight Promise, not the resolved value. Because the
// Promise is stored before the first `await`, concurrent callers that arrive in
// the same event-loop tick find the existing Promise and share its two RPC calls
// instead of each firing their own three. On rejection the entry is evicted so
// future callers can retry. WeakMap keys on the client so the cache is GC-safe.
const tokenMetadataCache = new WeakMap<
  object,
  Map<string, Promise<TokenMetadata>>
>();

function getTokenMetadataPromise(
  client: PublicClient,
  tokenAddress: string
): Promise<TokenMetadata> | undefined {
  return tokenMetadataCache.get(client)?.get(tokenAddress);
}

function setTokenMetadataPromise(
  client: PublicClient,
  tokenAddress: string,
  promise: Promise<TokenMetadata>
): void {
  let clientCache = tokenMetadataCache.get(client);
  if (!clientCache) {
    clientCache = new Map<string, Promise<TokenMetadata>>();
    tokenMetadataCache.set(client, clientCache);
  }
  clientCache.set(tokenAddress, promise);
}

function evictTokenMetadataPromise(
  client: PublicClient,
  tokenAddress: string
): void {
  tokenMetadataCache.get(client)?.delete(tokenAddress);
}

/**
 * Get an ERC-20 token balance for an account.
 *
 * `decimals` and `symbol` are immutable token properties cached per (client, token)
 * pair. The cache holds the in-flight Promise so concurrent callers that arrive
 * before the first fetch settles share one set of two RPC calls (decimals + symbol)
 * rather than each firing three. Each caller always issues its own `balanceOf` read.
 * Call cost: first pass N accounts → N+2 calls; subsequent passes → N calls.
 *
 * Throws on invalid addresses or failed contract calls.
 * @param client - PublicClient for the chain
 * @param accountId - Account ID (CAIP-10 format) containing chain and address
 * @param token - Token address
 * @returns Token balance result with balance, decimals, and symbol
 */
export async function getErc20TokenBalanceByChain(
  client: PublicClient,
  accountId: AccountId,
  token: EvmAddress
): Promise<BalanceResult> {
  const tokenAddress = getAddress(token);
  const holder = getAddress(accountId.address);

  // Look up (or create) the metadata Promise synchronously — before the first
  // `await` — so concurrent callers in the same event-loop tick find the in-flight
  // Promise and join it instead of starting independent fetches.
  let metadataPromise = getTokenMetadataPromise(client, tokenAddress);
  if (!metadataPromise) {
    metadataPromise = Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'decimals'
      }) as Promise<Decimals>,
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'symbol'
      }) as Promise<Symbol>
    ]).then(([decimals, symbol]) => ({ decimals, symbol }));
    setTokenMetadataPromise(client, tokenAddress, metadataPromise);
    metadataPromise.catch(() =>
      evictTokenMetadataPromise(client, tokenAddress)
    );
  }

  const [balance, { decimals, symbol }] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder]
    }) as Promise<BalanceBigInt>,
    metadataPromise
  ]);

  return { balance, decimals, symbol };
}

/**
 * Reads ERC-20 token details from a contract.
 * Uses four parallel reads via Promise.all.
 * Throws on invalid addresses or failed contract calls.
 *
 * @param client - PublicClient for the chain
 * @param tokenAddress - Token contract address
 * @returns Token details including name, symbol, decimals, and totalSupply
 */
export async function getErc20TokenDetails(
  client: PublicClient,
  tokenAddress: EvmAddress
): Promise<TokenDetails> {
  // normalize + validate address; throws on invalid
  const validatedTokenAddress = getAddress(tokenAddress);

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({
      address: validatedTokenAddress,
      abi: erc20Abi,
      functionName: 'name'
    }),
    client.readContract({
      address: validatedTokenAddress,
      abi: erc20Abi,
      functionName: 'symbol'
    }),
    client.readContract({
      address: validatedTokenAddress,
      abi: erc20Abi,
      functionName: 'decimals'
    }),
    client.readContract({
      address: validatedTokenAddress,
      abi: erc20Abi,
      functionName: 'totalSupply'
    })
  ]);

  return {
    name: name as AssetName,
    symbol: symbol as Symbol,
    decimals: decimals as Decimals,
    totalSupply: totalSupply as TotalSupplyBigInt
  };
}
