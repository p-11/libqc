# CLAUDE.md - libqc

## What This Repo Is

`@project-eleven/libqc` is Project Eleven's TypeScript SDK for quantum-safe wallet operations across Bitcoin + EVM chains.

Core responsibilities:

- vault/password lifecycle
- mnemonic/key derivation
- multi-chain account discovery + account clients
- token/assets and balance/activity reads
- account abstraction flows via ZeroDev module

## Rule Discovery

All sessions must load and follow both local and global rules.

1. `AGENTS.md`
2. `CLAUDE.md`
3. `.claude/rules/README.md`
4. `.claude/rules/*.md`
5. Global baseline from `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md`

## Package Manager

- Always use `pnpm` (`pnpm@10.20.0`)
- Do not use `yarn` or `npm`

## Commands

### Development

- `pnpm dev` - watch mode TypeScript build
- `pnpm build` - compile to `dist/`
- `pnpm clean` - remove `dist/`

### Quality

- `pnpm check` - `lint:check + prettier:check + test`
- `pnpm lint:check` - typecheck + ESLint
- `pnpm lint:fix` - ESLint autofix
- `pnpm prettier:check`
- `pnpm prettier:fix`
- `pnpm typecheck`

### Testing

- `pnpm test` - standard suite excluding property tests
- `pnpm test:unit`
- `pnpm test:property`
- `pnpm test:all`
- `pnpm test:coverage`

## Source Map

`src/` key files:

- `libqc.ts` - top-level facade class used by clients
- `state.ts` - encrypted state read/write + CAIP reconstruction
- `cryptography.ts` - key derivation + AES-GCM encryption/decryption
- `chain.ts` - chain namespace guards and Bitcoin network helpers
- `publicClients.ts` - EVM read-only client registry from chain specs
- `types.ts` - shared branded and domain types
- `errors.ts` - semantic error classes

Modules:

- `src/account/bitcoin/*` - Bitcoin account client, Esplora integration, empty vault
- `src/account/evm/*` - EVM account client, validator config, authorized/read-only account wrappers
- `src/zeroDev/*` - AA provider integration boundary
- `src/storage/*` - storage interface + web implementation

## Architecture Rules

- `LibQC` is the facade. Keep consumer API focused there.
- Keep ZeroDev/provider details in `src/zeroDev/`.
- Preserve chain split: Bitcoin path vs EVM path.
- Use CAIP classes (`ChainId`, `AccountId`, `AssetType`) as canonical identifiers.
- Never bypass `getLibQCState` / `setLibQCState` encryption boundary for persisted state.

## Multi-Chain Model

- EVM and Bitcoin share higher-level interfaces but differ in execution plumbing.
- EVM read clients are registry-based (`createEvmReadOnlyChainClients`).
- Bitcoin uses API-backed data paths (Esplora).
- New chain support must include dispatch + tests, not only type additions.

## Vault Lifecycle

Expected flow:

1. `hasPassword()`
2. `setPassword(...)` (first-time) OR `unlock(...)` (returning)
3. wallet operations
4. `lock()` when ending authenticated session

Security-sensitive edits in `cryptography.ts` or encryption/state boundaries require extra scrutiny.

## Testing Layout

- `__tests__/unit`
- `__tests__/integration`
- `__tests__/property`
- shared test factories in `__tests__/testUtils.ts`

Treat `P11TODO` markers as debt/test opportunity points.

## Public API Surface

- `src/index.ts` is the public export surface
- default export for `LibQC` kept for compatibility
- check downstream extension usage before removing exports

## Compact Instructions

Keep during compact:

- chain(s) touched
- AA/validator assumptions
- cryptography/state boundary changes
- modified exports in `src/index.ts`
- tests run and unresolved failures
