# libqc ZeroDev Module Rules

Key path: `src/zeroDev/`

## Isolation Boundary

ZeroDev integration must remain isolated to `src/zeroDev/*` plus narrow adapter calls from EVM account modules.

Do not spread provider-specific imports across unrelated modules.

The isolation works in both directions:
- Do not let ZeroDev internals leak outward into the broader SDK
- Do not push non-protocol concerns inward into `src/zeroDev/*`

ZeroDev functions return raw protocol data (hashes, decoded call data, block numbers). UI-layer enrichment — explorer URLs, display metadata, formatting — belongs in the account client layer, not here.

## Core Files

- `accounts.ts`
- `transfers.ts`
- `accountConfig.ts`
- `activities.ts`

## Validator System

Current validator model is based on `ValidatorType` and `ValidatorConfig` mapping.

- unknown validator address => throw
- switching validators => explicit operation path + explicit failures
- read-only vs authorized account handling must remain distinct

## Account Types

- Authorized account: signing-capable
- Read-only account: stub/non-signing behavior

Read-only stubs must fail clearly if signing methods are called.

## Address Versioning

`AddressVersion.V1` currently maps to SECP256k1 behavior.

Future post-quantum versions must extend explicit version-to-validator mapping; never overload V1 behavior.
