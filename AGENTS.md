# AGENTS.md - libqc

`@project-eleven/libqc` - TypeScript SDK for quantum-safe wallet operations across Bitcoin + EVM chains.

Core responsibilities: vault/password lifecycle, mnemonic/key derivation, multi-chain account discovery, token/balance/activity reads, account abstraction flows via ZeroDev.

## Instruction Sources

These instructions are shared across Claude and Codex:

- `AGENTS.md` - Codex-facing repository contract
- `CLAUDE.md` - project-level Claude contract
- `.claude/rules/README.md` - rule index and loading order
- `.claude/rules/*.md` - detailed SDK architecture/security/testing rules
- Global baseline at `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md`

## Cross-Repo Context

This SDK is consumed by `quantum-vault` (Chrome extension) via `file:../libqc`. The extension imports only from `src/index.ts` (public API boundary). SDK export removals or renames require checking extension imports first. When modifying exports, validate extension compile afterward.

## Boundaries

- **Public API surface**: `src/index.ts` - the only intended import path for consumers
- **AA provider isolation**: `src/zeroDev/**` - ZeroDev internals stay here
- **Encryption boundary**: `src/state.ts` + `src/cryptography.ts` - never bypass
- **Chain dispatch**: `src/chain.ts` - EVM vs Bitcoin guards

## Security-First Areas

Treat as high-risk (extra review depth required):

- `src/cryptography.ts` - AES-GCM encryption, scrypt key derivation
- `src/state.ts` - encrypted state persistence
- `src/zeroDev/**` - AA provider isolation

Never log: mnemonic, password, private keys, derived key bytes, raw encrypted vault data.

## Architecture

### Facade (`LibQC`)

`src/libqc.ts` is the external facade. Keep client-facing behavior here. Do not leak provider internals into caller signatures.

### State Persistence

`getLibQCState` / `setLibQCState` are the canonical boundary. After JSON parsing, CAIP prototypes must be reconstructed (`AssetType`, `ChainId`, `AccountId`).

### Vault Lifecycle

Expected flow: `hasPassword()` -> `setPassword(...)` or `unlock(...)` -> operations -> `lock()`.

Operations requiring decrypted state must fail fast when locked.

## Multi-Chain Dispatch

Current: type guards (`isEvmChain`, `isBitcoinChain`). Target: resolver pattern with `Record<ChainNamespace, Resolver>` + `satisfies` for compile-time exhaustiveness.

Use CAIP types as canonical identity (`ChainId`, `AccountId`, `AssetType`). Never store raw numeric chain IDs.

## ZeroDev Module

Isolation boundary at `src/zeroDev/`. Current validator model: `ValidatorType` + `ValidatorConfig`.

Rules:
- Unknown validator address -> throw
- Switching validators -> explicit operation path + explicit failures
- Read-only vs authorized account handling must remain distinct
- `AddressVersion.V1` maps to SECP256k1. Future PQ versions extend version-to-validator mapping explicitly.

## Cryptography

- AES-GCM + scrypt-derived key from password + salt
- Random IV per encryption
- Never log mnemonic, password, private keys, derived key bytes
- Any edit to `src/cryptography.ts` -> flag for security review in PR

## Testing

Structure: `__tests__/unit`, `__tests__/integration`, `__tests__/property`.

Shared factories in `__tests__/testUtils.ts`. Property tests for crypto encode/decode round-trips.

Mandatory coverage for: vault encryption/decryption, chain dispatch, validator/account config, transfers + balances.

## Commands

```bash
pnpm check          # typecheck + lint + prettier + test (FULL)
pnpm typecheck      # tsc --noEmit
pnpm lint:check     # typecheck + eslint
pnpm lint:fix       # eslint autofix
pnpm prettier:check
pnpm prettier:fix
pnpm test           # vitest (excludes property)
pnpm test:unit
pnpm test:property
pnpm test:all
pnpm test:coverage
pnpm build          # compile to dist/
pnpm dev            # watch mode
```

## Git

Conventional commits: `type(scope): description`. No `Co-Authored-By`. Package manager: `pnpm` only (never yarn or npm).

## Workflow

1. Discover architecture boundary touched
2. Implement scoped changes
3. Run `pnpm check`
4. Self-audit against `.claude/rules/anti-patterns.md`
5. Verify cross-repo compatibility if SDK exports changed
6. Conventional commit (no Co-Authored-By)
