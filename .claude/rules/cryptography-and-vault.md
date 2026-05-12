# libqc Cryptography + Vault Rules

Key files: `src/cryptography.ts`, `src/libqc.ts`, `src/state.ts`

## Encryption Model

- Vault data stored encrypted at rest
- AES-GCM flow with random IV per encryption
- scrypt-derived key from password + salt
- encrypted payload persisted via storage adapter

## Vault Lifecycle Invariants

Expected lifecycle operations:

- `hasPassword`
- `setPassword`
- `unlock`
- `lock`

Operations requiring decrypted state must fail fast when locked.

## Key Material Handling

- Never log mnemonic, password, private keys, derived key bytes
- Keep best-effort memory zeroing where currently implemented
- Treat cryptography changes as security-critical

## Password + Mnemonic

- Password policy enforcement must remain explicit and deterministic
- Mnemonic validation must keep strict constraints (current 24-word policy)

## Security Review Trigger

Any edit to `src/cryptography.ts` should be flagged for explicit security review in PR notes.
