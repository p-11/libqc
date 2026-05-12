# libqc SDK Architecture

Key files: `src/libqc.ts`, `src/state.ts`, `src/account/client.ts`, `src/storage/*`

## Facade Contract (`LibQC`)

`LibQC` is the external SDK facade. Keep new client-facing behavior discoverable through this class.

Responsibilities include:

- password/vault lifecycle
- mnemonic creation/import validation
- account creation/listing/discovery
- asset and balance aggregation
- transfers/empty vault operations

Avoid leaking underlying provider internals into caller-facing signatures.

## Account Client Model

`AccountClientInterface` defines chain-agnostic behavior for interacting with a single chain account.

Concrete clients:

- `EvmAccountClient`
- `BitcoinAccountClient`

## Layer Responsibilities

Each layer computes only what its scope requires:

- Protocol/data layers (e.g., `src/zeroDev/`, `src/account/bitcoin/esplora.ts`) return raw chain data. They do not compute display-oriented values such as explorer URLs or formatted amounts.
- Account client layers (`EvmAccountClient`, `BitcoinAccountClient`) enrich raw data for presentation: adding explorer links, applying network-specific URL schemes, etc.

Adding presentation logic to a lower layer couples it to UI concerns and makes the code harder to reuse across different display contexts.

## Storage Boundary

`LibQCStorage` is async key/value abstraction (`get`, `put`, `delete`, `has`, optional `clear`).

- Keep storage adapters simple and side-effect free.
- Encryption belongs in state/crypto layers, not storage adapters.

## State Persistence + Reconstruction

`getLibQCState` and `setLibQCState` are the canonical persisted-state boundary.

After JSON parsing, CAIP object prototypes must be reconstructed:

- `AssetType`
- `ChainId`
- `AccountId`

Preserve this reconstruction path when editing state schema.

## Adding A New Chain

Minimum scope:

1. chain identification + dispatch updates
2. account client implementation or extension
3. asset/balance/activity behavior
4. transfer/empty-vault behavior
5. tests (unit + integration where needed)

No partial chain additions.
