# P11 Account Abstraction Guardrails

## Security Invariants (MUST)

- signatures must be bound to `chainId` + `EntryPoint` domain
- privileged validation entrypoints must verify trusted caller boundaries
- one-time account initialization behavior must be enforced
- temporary/transient auth state must be cleaned after operation completion
- upgrade paths must include storage layout compatibility checks

## Validation Semantics (MUST)

- maintain correct ERC-4337 validation failure semantics
- reject or fail fast on malformed validation data
- enforce validity-window handling (avoid near-expiry operations)
- enforce gas-bound policies for verification/pre-verification stages

## Validator + Session-Key Policy (MUST)

- use least-privilege policy composition for delegated/session validators
- enforce call/value/timestamp/rate-limit restrictions
- isolate nonce lanes for admin/recovery versus normal execution
- do not allow silent validator drift by version

## PQC Posture

ETHDILITHIUM is an experimental reference and not an audited production primitive.

For PQ validator pathways:

- gate behind explicit rollout mode flags
- enforce hard verification-gas ceilings
- pin algorithm/version parameters explicitly
- require staged rollout + compatibility tests

## Threat Model Coverage

Maintain fail-closed behavior for:

- caller spoofing
- replay across chain/entry point/version
- delegated-key gas draining
- paymaster griefing and depletion
- validator upgrade/storage-collision regressions
- malformed signature/parser bombs

## Test + Release Gates (MUST)

AA/security-relevant changes require:

1. deterministic validator path tests
2. malformed-signature/property/fuzz tests
3. cross-bundler simulation checks where applicable
4. economic exposure checks for gas/paymaster-sensitive flows
5. incident playbook updates (rotation/revoke/migrate)
