# libqc Testing Rules

Paths: `__tests__/unit/**`, `__tests__/integration/**`, `__tests__/property/**`

## Structure

- unit tests for deterministic module logic
- integration tests for cross-module behavior and flow composition
- property tests for invariant-heavy crypto paths

## Utilities

Prefer using `__tests__/testUtils.ts` factories and seeded helpers.

## Mocking Guidance

- storage: in-memory `LibQCStorage` maps for isolation
- network: explicit mocks for public clients/APIs unless integration scope requires live endpoints
- crypto/web runtime: mock only where deterministic isolation is required

## Naming

Use source-oriented names (`{module}.test.ts`) and keep test folders aligned with module boundaries.

## Mandatory Coverage Areas For Risky Changes

If a PR touches these areas, ensure targeted tests exist:

1. vault encryption/decryption
2. chain dispatch behavior
3. validator/account config resolution
4. transfer and balance calculations
