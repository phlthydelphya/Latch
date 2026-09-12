# ADR-009 — Authority Generation Hardening (Atomic Tenure-Scoped Authority)

**Status:** `ACCEPTED` | **Date:** 2026-09-12 | **Author:** @architect + @security | **Implementer:** @backend
**Milestone:** SEC-02C (child of SEC-CRIT-02)
**Refs:** [SEC-CRIT-02 remediation program](../plans/SEC-CRIT-02-remediation-program.md) §4, [SEC-02 session identity contract](../design/SEC-02-session-identity-contract.md), [ADR-008](ADR-008-session-identity-binding.md)

## Context

Even with private identity binding (ADR-008), authority that is identified only by reusable `roomId`/`participantId` can be replayed across host tenures. A credential issued in one tenure, or a resume attempt racing a transfer, could revive stale authority unless transitions are atomic and credentials are bound to a generation.

## Decision

Identify a host tenure by `(roomInstanceId, authorityGeneration, hostId)` and make every authority transition atomic and generation-advancing.

1. **Room instance + generation.** Each room incarnation receives an unguessable `roomInstanceId`. `RoomAuthority.AuthorityGeneration` starts at 1 and increments on transfer, succession/grace expiry, revocation, or authority reset. Resume preserves the tenure and does not advance generation.
2. **Generation-bound credentials.** ES256 host tokens carry `rinst` and `gen`. Every privileged verifier requires host-token instance/generation to equal the current authority's, in addition to subject/role/room and session identity match. Tokens without `gen`/`rinst` (all pre-SEC-02C tokens) fail.
3. **Atomic compare-and-swap transfer.** Transfer requests act on an expected generation; `authorityManager.transferHost` re-reads generation under `am.mu` and commits only on a match. Concurrent transfers on the same generation have one winner; the loser receives a conflict and mints nothing.
4. **One-use resume handle.** Host resume requires a generation/session-bound handle consumed atomically; duplicate or stale consumption fails. Resume rotates the session and returns a replacement handle privately. A racing resume cannot clear the new host's grace or revive stale authority.
5. **Failure semantics.** Credential minting occurs after a successful commit. A signing failure before commit leaves prior authority intact. Delivery failure after commit never broadcasts as a fallback and never reports false success.
6. **Volatile state.** Restart empties authority/session/handle maps and regenerates the ES256 key; old host tokens fail signature. Pre-cutover and attacker-issued host credentials cannot authenticate privileged routes regardless of TTL or current `HostID`.

## Consequences

- A→B→A cannot revive A's first-tenure credential because generation is monotonic.
- Room recreation under the same `roomId` produces a new instance and generation 1; old-instance credentials are rejected.
- `assignRole` remains read-only and can never elect or replace a host.
- The mandatory pre-cutover revocation decision is satisfied structurally: no pre-cutover host credential passes the new verification.

## Gates

Independent Architecture, Security, Privacy, QA, and Adversarial decisions are required against the tested revision. Race-detector evidence must be produced on a supported (cgo-enabled) runner.
