# SEC-02C — Authority Generation Hardening (Execution Plan)

Date: 2026-09-12
Program: SEC-CRIT-02 (OPEN / CRITICAL; release BLOCKED)
Parent authority: [SEC-CRIT-02 — Executable Remediation Program](SEC-CRIT-02-remediation-program.md) §4
Prerequisite: [SEC-02B — Identity Binding](SEC-02B-identity-binding.md)
Scope boundary: `services/meet-signal` only. No frontend. No activation.

## Authority Model

A host tenure is identified by the triple:

```
(roomInstanceId, authorityGeneration, hostId)
```

The participant identity, room instance, and private session are supplied by SEC-02B. SEC-02C adds the **authority generation**: a monotonically increasing integer within a room instance that changes every time authority moves or is revoked. Host authority is never identified by reusable `roomId` or `participantId` alone.

| Concept | Owner | Established in |
|---|---|---|
| `roomInstanceId` | SEC-02B | `RoomAuthority.RoomInstanceID` |
| `participantId` (identity) | SEC-02B | session record `ParticipantID` |
| `sessionVersion` | SEC-02B | session record `SessionVersion` |
| **`authorityGeneration`** | **SEC-02C** | `RoomAuthority.AuthorityGeneration` (new) |
| **one-use resume handle** | **SEC-02C** | new handle store bound to `(instance, generation, participant, session)` |

## Generation Model

**Q1 / Q2 — new state and storage:**

Add to `RoomAuthority`:

```go
AuthorityGeneration uint64 `json:"authorityGeneration"`
```

Initial value `1` at room creation (`createRoom`). The `assignRole` unhosted-room branch also starts at `1` (it never elects a host; the value simply keeps a valid baseline). Stored in volatile memory only, alongside the existing `RoomAuthority` map — no persistence, no durable ledger.

Generation transitions:

| Event | Generation | HostID |
|---|---|---|
| `createRoom` | `1` | `creatorID` |
| `transferHost` | `++` | `target` |
| succession / grace expiry | `++` | successor or `""` |
| revocation / authority reset | `++` | `""` (or fresh bootstrap) |
| **host resume** | **unchanged** | unchanged (same tenure) |

Resume preserves the same tenure; it re-issues fresh credentials bound to the current generation rather than advancing it.

## Token Binding (Q3)

**Q3 — how tokens bind to generation:**

Extend the ES256 host token claims:

```go
type HostClaims struct {
    ParticipantID  string `json:"sub"`
    RoomID         string `json:"room"`
    Role           string `json:"role"`
    RoomInstanceID string `json:"rinst"` // NEW
    Generation     uint64 `json:"gen"`   // NEW
    jwt.RegisteredClaims
}
```

Change `mintHostToken` signature:

```go
func mintHostToken(participantID, roomID, roomInstanceID string, generation uint64, ttl time.Duration) (string, error)
```

`validateHostToken` returns `ParticipantID`, `RoomID`, `Role`, `RoomInstanceID`, and `Generation`. Every privileged verifier requires:

```
token.RoomInstanceID == authority.RoomInstanceID
token.Generation     == authority.AuthorityGeneration
token.Role           == "host"
token.ParticipantID  == authenticated session identity == authority.HostID
token.RoomID         == request room
```

A host token lacking `gen`/`rinst` (all pre-SEC-02C tokens) fails these checks because `Generation != current`.

## Revocation Model (Q4, Q8)

**Q4 — how stale credentials are invalidated; Q8 — revocation model:**

Generation advance is the primary revocation mechanism. On any authority transition the generation increments, making every prior host token and resume handle stale by construction. The following are conjunctively enforced:

1. **Prior-generation host tokens** are rejected by the `token.Generation == current` check. A→B→A cannot revive A's first-tenure token because the generation is now `3`, never `1`.
2. **Pre-cutover credentials** (ES256 host tokens minted before SEC-02C, carrying no `gen`/`rinst`) are rejected identically.
3. **Legacy HS256 and LiveKit access tokens** are never accepted on privileged endpoints (SEC-02B purpose split); they cannot bootstrap host authority.
4. **Consumed resume handles** are marked used atomically and rejected.
5. **Room recreation** under the same `roomId` produces a new `roomInstanceId` and generation `1`; all old-instance credentials fail the `rinst` check.
6. **Volatile state**: process restart empties the authority map and regenerates the ES256 signing key (`initHostSigning`), so old host tokens fail signature; empty rooms fail closed. (Legacy/LiveKit access tokens remain valid from unchanged secrets, but they grant no privileged authority.)

The program's mandatory cutover decision (revoke/invalidate all pre-cutover host credentials and attacker-issued successors) is satisfied structurally: no pre-cutover host credential can pass the new verification, independent of TTL or current `HostID`.

## Transition Rules (Q5)

**Q5 — A→B→A replay prevention:**

- A mints host token bound to generation `1`, plus resume handle H1 bound to generation `1`.
- `transferHost(A→B, expectedGen=1)` commits only if current generation is still `1`; advances to `2`, sets `HostID=B`. A's gen-1 token and H1 are now stale.
- `transferHost(B→A, expectedGen=2)` commits only if current generation is still `2`; advances to `3`, sets `HostID=A`. B's gen-2 token is stale.
- A's original gen-1 token is never accepted because the current generation is `3` and monotonically increasing.

Resume does not advance generation, so a reconnecting current host receives a new token bound to the same generation, but its one-use handle is consumed, preventing replay.

**Every mutation is an explicit authoritative transition, not a `role` lookup or boolean that can elect/replace the host.** `assignRole` remains read-only for role eligibility and never mutates `HostID`, generation, or grace. Guest `/token` issuance cannot elect or replace the host.

## Concurrency Rules (Q6, Q7)

**Q6 — concurrent transfer requests:**

- The transfer request carries an `expectedGeneration` (derived from the requester's current host token or authority query).
- `transferHost` performs a compare-and-swap under `am.mu`: re-read `AuthorityGeneration`; if `!= expectedGeneration`, return a conflict/denial error and mint nothing.
- Two concurrent transfers on the same `expectedGeneration`: exactly one commits (generation `++`); the loser sees a mismatch and fails with no credential issuance.

**Q7 — transfer vs resume race:**

- Resume consumes a one-use handle and re-reads current generation/`HostID` inside the same critical section as its mutation. If a transfer committed first (generation and/or `HostID` changed), the handle and host proof are bound to the old generation/identity and the resume is denied; a racing old resume cannot clear the new host's grace or revive stale authority.
- Transfer re-reads generation under the lock; if a resume/other transition advanced generation first, the transfer fails with a conflict.
- Grace/succession timeout re-reads current `HostID` and generation inside the lock; superseded work cannot overwrite the winner or mint a credential for an obsolete generation.

**Atomicity (minting vs mutation):**

- The authority mutation and all rechecks happen in one critical section (`am.mu`).
- Credential minting happens **after** a successful commit, outside the lock. A signing failure before commit leaves prior authority intact. A minting/delivery failure after commit never broadcasts as a fallback and never reports a completed usable handoff; recovery is private retrieval/retry bound to the committed target and generation.

## Regression Matrix (Q9)

New file `sec02c_authority_generation_test.go`. Run `go test ./...` and `go test -race ./...` (with cgo). Both legacy and LiveKit issuance configs. Map to program §6:

| Row | Scenario | Required result |
|---|---|---|
| R05 | Valid credential for another room/incarnation of same room ID | denied before mutation (`rinst` + `gen` mismatch) |
| R06 | Missing `gen`/`rinst`; wrong role/purpose/issuer/algorithm; bad signature; expired | denied through every credential path |
| R07 | A→B→A; earlier tenure token reuse | earlier gen token remains invalid even after subject becomes host again |
| R08 | Concurrent A→B and A→C same `expectedGeneration` | exactly one commits, gen advances once; loser conflict, no credential |
| R09 | Concurrent resume with same one-use handle | exactly one consumption; same participant ID preserved; loser cannot clear grace or mint authority |
| R10 | Transfer races reconnect/grace/succession | serialized valid result; old work cannot overwrite/revive superseded authority |
| R11 | Legit transfer + same-identity resume; ordinary guest | authorized paths pass, guest stays participant, no `/token` election |
| R12 | Signing failure; disconnected target; delivery failure post-commit | no leak/broadcast; no false success; documented private recovery |
| R13 | Still-valid pre-cutover ES256/HS256/LiveKit credentials after cutover | none authenticates privileged routes or exchanges into current host session |
| R14 | Recreated room under same `roomId`; rollback to contained artifact | old instance/credentials rejected; restrictions enforced |
| R15 | Full suite + race detector + credential/log hygiene | pass; no real secrets; no persistent attendee history |

Additional generation-specific assertions: `mintHostToken` embeds correct `gen`/`rinst`; `validateHostToken` reports generation; `authorityGeneration` never decreases; consumed handle never re-authenticates; recreation resets generation to `1` under a new instance.

## Acceptance Criteria (Q10)

SEC-02C is complete when all hold (program §4 + §8):

1. Old generations, consumed resume handles, old room instances, and pre-cutover credentials fail at both privileged endpoints without mutation or privileged issuance.
2. A→B→A, room recreation, transfer-vs-resume, duplicate transfer, duplicate resume, and grace/succession races all have defined, asserted outcomes.
3. Legitimate transfer and current-generation same-identity resume pass; no new identity is elected by `/token`.
4. Signing failure leaves old authority intact; delivery failure follows the documented authenticated recovery path without broad credential disclosure.
5. All Section-6 rows pass on the exact built candidate in both issuance configurations; race checks pass without skips; no real credentials in evidence.
6. SEC-02A restrictions remain active; privileged features remain disabled until SEC-02D.

## Implementation Complexity

**Medium-High.** Concentrated in `services/meet-signal/main.go` (authorityManager + host-token claims + session/handle store) plus one new test file. Touches the SEC-02B primitives (`resumeIdentity`, `transferHostIdentity`, `mintHostToken`, `validateHostToken`) and the authorityManager mutation methods (`transferHost`, `startHostGrace`). No new external dependencies.

## Risks

- **Scope creep into activation**: generation/handle machinery must stay unwired; the SEC-02A gates remain. Wire only for SEC-02D.
- **Minting-after-commit failure**: a committed transfer whose credential mint fails can strand authority; the private-retrieval recovery must be implemented and tested, not assumed.
- **Handle vs session confusion**: the one-use resume handle must not be mistaken for the reusable session capability; mixing them reintroduces replay.
- **Claim drift**: adding `gen`/`rinst` to `HostClaims` must not widen `validateHostToken` into accepting access tokens (keep ES256-only).
- **Race correctness**: the CAS must re-read generation inside the same lock; a check-then-act outside the lock reintroduces the race.
- **Test-helper churn**: `sec02aHostToken`/`sec02aAccessToken` and `mintHostToken` call sites must be updated to the new signature.

## Ready For Implementation

**Yes**, contingent on: SEC-02B contract settled and reviewed; `docs/design/SEC-02-session-identity-contract.md` updated with the generation/handle model; @architect approval and @security design review of the revocation/atomicity rules. SEC-02A remains the deployed restriction until SEC-02D passes.

**Incident status:** SEC-CRIT-02 remains OPEN / CRITICAL; release remains BLOCKED. This plan authorizes design and implementation only; it does not enable transfer/resume, close the incident, or restore release eligibility.