# Codex Instructions - libqc

This file is the Codex-facing entrypoint for repository-local instructions.

## Load Order

1. `AGENTS.md`
2. `CLAUDE.md`
3. `.claude/rules/README.md`
4. `.claude/rules/*.md`
5. Global P11 root instructions from `P11/.codex/AGENTS.md`
6. Global machine baseline (`~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`)

When instructions overlap, follow the stricter rule.

## Critical Boundaries

- Public API boundary: `src/index.ts`
- Encryption boundary: `src/state.ts` and `src/cryptography.ts`
- ZeroDev internals stay in `src/zeroDev/**`
- Never log mnemonic/password/private key bytes/raw encrypted vault payloads

## Verification

After code changes run:

```bash
pnpm check
```
