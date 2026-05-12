# libqc Export Surface Rules

Key file: `src/index.ts`

## Public API Boundary

`src/index.ts` is the intended public API entrypoint.

When adding/removing exports:

- keep runtime exports deliberate
- keep type-only exports explicit where possible
- avoid leaking deep internal module paths as public contract

## Compatibility

`LibQC` default export is deprecated but retained for backward compatibility.

Do not remove compatibility exports without coordinated downstream migration.

## Cross-Repo Check

Before removing or renaming any export, search `quantum-vault` usage and verify compile/runtime impact.

## Re-exports

Re-exports from `caip` and `viem` are part of consumer ergonomics in this SDK; changes require migration notes.
