# libqc Multi-Chain Patterns

Key files: `src/chain.ts`, `src/publicClients.ts`, `src/addresses.ts`, `src/state.ts`

## Canonical Identity

Use CAIP types as source of truth:

- `ChainId` (CAIP-2)
- `AccountId` (CAIP-10)
- `AssetType` (CAIP-19)

Do not store raw numeric IDs as standalone identity in domain logic.

## Dispatch Pattern

Current approach uses type guards:

- `isEvmChain(chainId)`
- `isBitcoinChain(chainId)`

This works for 2 chain families. As chains are added, migrate to the resolver pattern:

```typescript
// Target: Record-based dispatch using Record<ChainNamespace, Resolver>
const balanceResolvers = {
  eip155: getEvmBalance,
  bip122: getBitcoinBalance,
} satisfies Record<ChainNamespace, BalanceResolver>
```

Chain-family dispatch must be explicit and exhaustive for supported families. Use `satisfies Record<ChainNamespace, ...>` to enforce compile-time completeness - TypeScript will error if a supported namespace is missing an entry.

## EVM vs Bitcoin Rules

EVM:

- address format = `0x...`
- uses viem/public client registry
- AA/user-operation capable paths

Bitcoin:

- network-aware address format (`bc1`/`tb1`)
- uses Esplora API path
- non-AA execution model

## Chain Specifications

`ChainSpecification` is the canonical chain config input:

- CAIP chain id
- RPC URLs
- native currency metadata
- testnet flag

New chain support must update chain specification provisioning and any chain-kind assumptions.

## Persisted Address Union

Persisted addresses are discriminated by `chainType`:

- `EvmPersistedAddress`
- `BitcoinPersistedAddress`

When editing persistence/migrations, preserve discriminant correctness and backward compatibility handling.
