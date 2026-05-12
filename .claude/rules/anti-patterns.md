# Anti-Patterns

## Core

1. Never use `switch/case` for domain branching. Use `match()` or `Record<Key, Value>`.
2. Never use broad `try/catch` for flow control. Use `attempt()` when fallback behavior is required.
3. Never use `as` type assertions unless a validated boundary makes it unavoidable.
4. Never use `?.` or `??` on non-optional types. Trust types and use `ensurePresent()` at runtime boundaries.
5. Never leave hardcoded magic values in domain logic. Use named constants.
6. Never add `useMemo`/`useCallback` by default. React Compiler is the default optimization path in React consumers.

## libqc Specific

7. Never introduce ambiguous SDK errors; include expected vs found context.
8. Never add concurrent duplicate fetches when in-flight coalescing exists or should be added.
9. Never bypass encrypted state boundaries (`getLibQCState` / `setLibQCState`).
10. Never leak ZeroDev internals outside `src/zeroDev/**`.
11. Never log mnemonic, password, private key bytes, derived key material, or raw encrypted state payloads.
12. Never reimplement logic that an existing SDK primitive already provides. Use the established function and trust its invariants, rather than inlining a private copy that diverges over time.
