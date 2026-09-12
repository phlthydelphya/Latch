# SEC-02B — Identity Binding (Execution Plan)

Date: 2026-09-12
Program: SEC-CRIT-02 (OPEN / CRITICAL; release BLOCKED)
Parent authority: [SEC-CRIT-02 — Executable Remediation Program](SEC-CRIT-02-remediation-program.md) §3
Scope boundary: `services/meet-signal` only. No frontend work. No SEC-02C design detail.

## SECTION 1 — SEC-02B OVERVIEW

**Mission (from program §3):** Authenticate ownership of participant identity independently of the publicly exposed host attestation.

**Problem being fixed.** The confirmed exploit chain has three links, all in `services/meet-signal/main.go`:

1. `handleTransferHost` disclosed the target's ES256 host credential room-wide (old `main.go:925–942`) and to the outgoing host's HTTP response (old `main.go:947–952`).
2. `handleToken` accepted any still-valid host token as proof of host status without verifying that the caller owned the token's `sub` (old `main.go:630–650`).
3. `assignRole` then replaced `HostID` with a freshly generated anonymous participant ID (old `main.go:129–157`).

SEC-02A has neutralized all three by disabling resume and transfer and by removing the boolean override from `assignRole`. SEC-02B replaces the broken model with a **private session capability** that proves caller identity, and makes the ES256 host token a bound **operation proof** rather than an identity proof.

**What SEC-02B delivers:**

- A volatile private session store keyed by a hash of a 256-bit capability.
- Identity established at bootstrap (`/room/create`, `/token`) and proven on resume/transfer via the private session, never via request body, display name, or host-token `sub` alone.
- Credential-purpose separation: legacy HS256, LiveKit HS256, and ES256 host tokens are no longer interchangeable.
- Target-only private delivery of the new host credential on transfer.
- Host status always derived from current server authority, never from a stale role claim.

**What SEC-02B does NOT deliver (deferred):**

- `authorityGeneration` counter, one-use resume handles, and atomic compare-and-swap transitions — SEC-02C.
- Independent adversarial verification and release restoration — SEC-02D.
- Activation. Unsafe transfer and resume remain disabled until SEC-02B/C and SEC-02D acceptance pass.

## SECTION 2 — IDENTITY MODEL

### 2.1 Identity primitive

Participant identity is the server-minted `participantID` (`p-<uuid[:8]>`), already the `sub` of every access token and host token. It is minted only by the server at bootstrap and is never accepted from the client.

### 2.2 Identity proof (the private session)

A fresh, unguessable **session capability** of at least 256 random bits (`crypto/rand`, 32 bytes), delivered **only** in the direct bootstrap response that establishes the owning participant:

- `/room/create` response → host's session capability.
- `/token` guest response → guest's session capability.
- `/token` resume response → rotated replacement capability (old one revoked).

The server stores only a SHA-256 hash of the capability, never the raw value. The capability is a bearer identity proof for the scoped privileged endpoints and must never appear in room-wide frames, logs, or the outgoing host's transfer response.

### 2.3 Identity binding rule

Caller identity is derived exclusively from the server-validated private session. The request body, display name, arbitrary `participantId`, and the host token's `sub` are all untrusted for identity purposes.

For privileged operations the following must all hold and match:

| Check | Source |
|---|---|
| Session capability valid, unexpired, correct purpose | `sessionStore` |
| Session `participantID` == access-token `sub` | access token (identity credential) |
| Session `roomInstanceID` == current room instance | `RoomAuthority.RoomInstanceID` |
| Host-operation proof `sub` == session `participantID` == current `HostID` | ES256 host token |
| Host-operation proof room/audience == request room | ES256 host token |

Host status is derived from `RoomAuthority.HostID`; a stale `role: "host"` claim never grants authority.

### 2.4 Identity lifecycle

- **Establish:** server mints `participantID` + capability at bootstrap.
- **Prove:** client presents capability (plus access token) on resume/transfer.
- **Rotate:** resume returns a fresh capability and revokes the presented one.
- **Expire:** capability carries an expiry; expired capabilities fail closed.
- **Scope:** capability is bound to one `roomInstanceID`; a recreated room under the same `roomId` has a new instance ID and rejects old capabilities.

## SECTION 3 — TOKEN MODEL

Three credential families, each with a single purpose. `validateJWT` (current `main.go:847–876`) is split so no family can substitute for another.

| Credential | Purpose | Signing | Validated by | Used for |
|---|---|---|---|---|
| Access token (legacy) | Identity + signaling | HS256 `JWT_SECRET` | `validateAccessToken` | `/token` resume identity, `WSS /signal` |
| Access token (LiveKit) | Identity + signaling | HS256 `LIVEKIT_API_SECRET` | `validateAccessToken` | `/token` resume identity, `WSS /signal` |
| Host token (ES256) | **Operation proof only** | ES256 `hostPrivateKey` | `validateHostToken` | resume/transfer host-operation proof |
| Session capability | **Identity proof** | opaque 256-bit random | `sessionStore.authenticate` | resume/transfer identity |

Rules:

1. A host token alone authenticates nothing. It is accepted only alongside a valid private session whose `participantID` equals the host token's `sub`.
2. Legacy and LiveKit access tokens are interchangeable for identity/signaling (existing behavior preserved) but are never accepted as host-operation proof.
3. ES256 host tokens are never accepted as identity/signaling credentials.
4. Purpose, issuer, algorithm, audience/room, and expiry are validated exactly for each signed credential. Wrong-purpose credentials fail closed before any state mutation or issuance.

## SECTION 4 — API CHANGES

All changes are additive behind the still-disabled routes. SEC-02A's blanket rejection remains in force until activation.

### 4.1 `POST /room/create`

Response gains:

```json
{
  "roomInstanceId": "<unguessable instance id>",
  "sessionToken":   "<256-bit capability, base64url>",
  "...existing fields..."
}
```

Server: `createRoom` generates `RoomInstanceID`; `sessionStore` issues a host-purpose session for the creator; capability returned only here.

### 4.2 `POST /token` — guest path (no credentials)

Unchanged behavior: mint fresh `participantID`, issue participant access token. Response gains `sessionToken` (participant-purpose capability). `role` stays `"participant"`; `HostID` is never written.

### 4.3 `POST /token` — resume path (credentials present)

Request carries:
- `Authorization: Bearer <accessToken>` (identity credential)
- `X-Session-Capability: <capability>` (identity proof)

Server:
1. Validate access token → `participantID`, `roomID`.
2. Authenticate capability → session record; require `participantID` match, `roomInstanceID` match, unexpired.
3. If `participantID == RoomAuthority.HostID` **and** a valid ES256 host-operation proof is presented (`X-Host-Proof: Bearer <hostToken>` with `sub == participantID`, `room == roomID`, `role == host`): issue `role="host"`, mint fresh host token, rotate the session capability.
4. Otherwise: issue `role="participant"` for the same `participantID` (identity preserved), no host token, no authority mutation.

Failure of any privileged check fails closed; a failed resume never downgrades to a fresh anonymous guest identity.

### 4.4 `POST /room/transfer-host` (re-enabled only after SEC-02B/C/D)

Request carries:
- `Authorization: Bearer <accessToken>` (requester identity)
- `X-Session-Capability: <capability>` (requester identity proof)
- `X-Host-Proof: Bearer <hostToken>` (host-operation proof)
- body `{roomId, targetParticipantId}`

Server:
1. Authenticate requester session → `participantID`; require `== HostID`, matching room instance.
2. Validate host-operation proof: `sub == HostID`, `room == roomID`, `role == host`.
3. Verify target has an active session in the same room instance (target is a real authenticated participant).
4. `transferHost` commits; mint new host token for target.
5. Deliver the new host token **only** to the target's authenticated WSS channel (hub lookup by `participantID`) or a private retrieval flow bound to the target's session. Never broadcast, never include in the requester's HTTP response.

Response to requester: status + public metadata only (`hostId`, `hostKey`, `timestamp`). No `newHostToken`.

### 4.5 Error codes

| Condition | Status | Body |
|---|---|---|
| Missing/invalid session on privileged path | 401 | `private_session_required` |
| Session expired / wrong room instance | 401 | `private_session_invalid` |
| Session subject mismatch with access token | 403 | `identity_mismatch` |
| Host-operation proof missing/invalid | 403 | `host_proof_required` |
| Requester not current host | 403 | `unauthorized: requester is not host` |
| Target has no authenticated session in room | 403 | `transfer_target_unauthenticated` |
| Unsupported/legacy client (no session) | 400 | `upgrade_required` |

## SECTION 5 — DATA MODEL CHANGES

Volatile, in-memory only. No persistence, no attendee ledger, no raw credential storage.

### 5.1 `RoomAuthority` (extend)

```go
type RoomAuthority struct {
    RoomID         string    `json:"roomId"`
    RoomInstanceID string    `json:"roomInstanceId"` // NEW: unguessable incarnation id
    HostID         string    `json:"hostId"`
    CreatedAt      time.Time `json:"createdAt"`
    HostUpdatedAt  time.Time `json:"hostUpdatedAt"`
    GraceExpiry    time.Time `json:"graceExpiry,omitempty"`
    Locked         bool      `json:"locked"`
}
```

`createRoom` generates `RoomInstanceID` (32 random bytes, hex). `RoomInstanceID` is the identity-scoping primitive; the `authorityGeneration` counter is SEC-02C.

### 5.2 `sessionStore` (new)

```go
type sessionStore struct {
    mu       sync.RWMutex
    sessions map[string]sessionRecord // key = hex(sha256(capability))
}

type sessionRecord struct {
    ParticipantID  string
    RoomInstanceID string
    Purpose        string // "host" | "participant"
    SessionVersion uint64
    ExpiresAt      time.Time
}
```

Operations: `issue(participantID, roomInstanceID, purpose, ttl) (capability string)`, `authenticate(capability) (sessionRecord, bool)`, `rotate(capability) (newCapability string, ok bool)`, `revoke(capability)`. Raw capabilities are never stored or logged.

### 5.3 Hub delivery helper (new)

`h.clientByParticipant(roomID, participantID) (*client, bool)` — returns the WSS connection whose `participantID` matches, for target-only credential delivery. Existing `h.peers` (broadcast) is not used for private credentials.

## SECTION 6 — REGRESSION TESTS

New file `services/meet-signal/sec02b_identity_binding_test.go` alongside `sec02a_containment_test.go` and `main_test.go`. Reuse the SEC-02A fixture helpers (`sec02aConfigure`, `sec02aRoom`, `sec02aHostToken`, `sec02aAccessToken`, `sec02aAssertUnchanged`, `sec02aAssertNoCredentials`) and extend with session fixtures. Both legacy and LiveKit issuance configurations. `go test ./...` and `go test -race ./...`.

Map to program §6 rows:

| Test | Row | Assertion |
|---|---|---|
| B's host attestation alone → `/token` resume | R02 | 401/403, no replacement identity, no host token, no `HostID` change |
| B's host attestation alone → `/room/transfer-host` | R03 | denied before mutation/mint |
| X's session + B's host attestation; body claims B | R04 | denied; copying `sub`/body ID cannot impersonate |
| Valid credential for wrong room/audience/instance | R05 | denied before mutation |
| Expired session/handle; missing subject; wrong role/purpose/issuer/algorithm; bad signature | R06 | denied through every credential path |
| Legit host resume with session + host proof | R11 | same `participantID`, `role="host"`, fresh host token, rotated session |
| Legit A→B transfer, three peers (A, B, observer X) | R01/R11 | B alone receives private credential; X and A's HTTP response receive none |
| Ordinary guest issuance | R11 | participant-only, `HostID` untouched, session issued |
| Session rotation: old capability rejected after resume | R06 | revoked capability fails closed |
| Recreated room under same `roomId` | R05 | old instance capability rejected |
| Signing/delivery failure | R12 | no false success; no broadcast fallback; prior authority intact |
| Full suite + race detector | R15 | pass, no real secrets in evidence |

Concurrency note: SEC-02B tests assert single-winner behavior only where it is already guaranteed by the session store lock; full generation/atomicity races are SEC-02C's matrix (R08–R10).

## SECTION 7 — ACCEPTANCE CRITERIA

SEC-02B is complete when all of the following hold (from program §3 + §8):

1. B's public attestation alone cannot resume or transfer; X's private session plus B's attestation also fails. Copying `sub` or a body ID does not change the result.
2. A legitimate host resumes under the same participant ID; a legitimate A→B transfer privately delivers credentials to B alone; guests remain participants.
3. Exact credential-purpose validation rejects every legacy host/access-token alternative as a substitute for new private-session authentication.
4. Bootstrap and delivery are demonstrated with backend integration fixtures; unsupported protocol paths remain disabled rather than silently falling back.
5. `docs/design/SEC-02-session-identity-contract.md` written; architecture decision recorded via the ADR process and referenced from `architecture-brief.md` §11.
6. All Section 6 tests pass in both issuance configurations; race detector passes; no real credentials in evidence.
7. SEC-02A restrictions remain active; privileged features are not enabled by this ticket.

## SECTION 8 — DEPENDENCIES

| Dependency | Type | Status |
|---|---|---|
| SEC-02A containment deployed/verified | Hard prerequisite | Assumed in place |
| `@architect` contract approval (`docs/design/SEC-02-session-identity-contract.md` + ADR) | Gate | Required before implementation |
| `@security` design review of session/credential-purpose split | Gate | Required before implementation |
| `@backend` implementation | Owner | This ticket |
| `@qa` regression evidence | Gate | Required for acceptance |
| SEC-02C authority-generation hardening | Successor | Blocks activation, not design |
| SEC-02D independent verification | Successor | Blocks activation |

**Bootstrap dependency (from program §3):** `handleCreateRoom` must be able to issue the new private session; a credential cannot be created by accepting an old host token as proof. The smallest supporting changes are `RoomAuthority.RoomInstanceID`, the `sessionStore`, the credential-purpose split in validation, and the hub delivery helper — all in `main.go`. If a new client input is required, it is documented as a separate integration dependency and the affected features stay disabled until compatibility is proven.

## SECTION 9 — SEC-02C HANDOFF

SEC-02B leaves the following primitives in place for SEC-02C to consume, without designing them here:

- `RoomInstanceID` on `RoomAuthority` — SEC-02C adds the monotonic `authorityGeneration` within it.
- `sessionStore` with `SessionVersion` — SEC-02C binds privileged credentials to `(roomInstanceID, participantID, authorityGeneration, purpose, expiry, sessionVersion)` and adds one-use resume-handle consumption.
- Credential-purpose split (`validateAccessToken` / `validateHostToken` / session) — SEC-02C adds generation-bound host-operation proofs and rejects every pre-cutover credential.
- Target-only private delivery helper — SEC-02C adds documented atomic behavior for signing/delivery failure after commit.

SEC-02C entry condition: SEC-02B identity and delivery contract settled; SEC-02A still the deployed restriction.

## SECTION 10 — FINAL DISPOSITION

| Field | Decision |
|---|---|
| Ticket | **SEC-02B — Identity Binding** |
| Owner | @backend (implementation); @architect (contract); @security (review) |
| Estimated complexity | **Medium** — one file (`main.go`), one new test file, one design doc, one ADR |
| Risks | Compatibility break for legacy clients (explicit `upgrade_required`, no silent fallback); session capability disclosure if logged (sanitize); in-memory session loss on restart fails closed (fresh bootstrap); scope creep into SEC-02C generation/atomicity |
| Ready for implementation | **Yes**, contingent on @architect contract approval and @security design review |
| Stop condition | Contract + implementation meet identity tests on the candidate; privileged features remain disabled until SEC-02C/D |

**Incident status:** SEC-CRIT-02 remains OPEN / CRITICAL; release remains BLOCKED. This plan authorizes design and implementation only; it does not enable transfer/resume, close the incident, or restore release eligibility.
