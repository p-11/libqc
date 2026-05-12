# Claude/Codex Rule Index

These rules are mandatory for both Claude and Codex workflows in this repository.

## Loading Order

1. `AGENTS.md` (Codex-facing repo contract)
2. `CLAUDE.md` (project Claude contract)
3. `.claude/rules/*.md` (repo-specific architecture/security/testing constraints)
4. Global baseline from `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md`

When rules overlap, follow the stricter rule.

## Rule Files

- `anti-patterns.md` - cross-cutting forbidden implementation patterns
- `cryptography-and-vault.md` - vault lifecycle, crypto, sensitive data boundaries
- `multi-chain-patterns.md` - chain dispatch and extensibility patterns
- `p11-account-abstraction.md` - account abstraction contracts and constraints
- `sdk-architecture.md` - facade, state boundary, storage contracts
- `sdk-exports.md` - public API barrel and compatibility expectations
- `sdk-testing.md` - unit/integration/property testing requirements
- `zerodev-module.md` - ZeroDev isolation and module boundaries
