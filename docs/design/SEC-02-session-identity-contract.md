# SEC-02 — Session Identity & Authority Contract

Date: 2026-09-12
Status: **IMPLEMENTED** (SEC-02A/B/C); activation wired and verified under SEC-02D
Authority: [SEC-CRIT-02 remediation program](../plans/SEC-CRIT-02-remediation-program.md) §3–§4
ADRs: [ADR-008](../adr/ADR-008-session-identity-binding.md), [ADR-009](../adr/ADR-009-authority-generation-hardening.md)
Scope: `services/meet-signal` only. Volatile, in-memory state; no persistence, no attendee ledger.

## 1. Problem

The confirmed exploit chain (SEC-CRIT-02) had three links:

1. `handleTransferHost` disclosed the target's ES256 host credential room-wide and in the outgoing host's HTTP response.
2. `handleToken` accepted any still-valid host token as proof of host status without verifying that the caller owned the token subject.
3. `assignRole` replaced `HostID` with a newly generated participant identity, and the server minted a fresh host credential for the attacker.

A correctly signed credential proves its issuer and claims. Possession of a publicly distributed host attestation does not identify the presenting participant. SEC-02 separates **identity** from **authority proof**.

## 2. Credential families

| Credential | Purpose | Signing | Validated by | Used for |
|---|---|---|---|---|
| Access token (legacy) | Identity + signaling | HS256 `JWT_SECRET` | `validateAccessToken` | resume identity, `WSS /signal` |
| Access token (LiveKit) | Identity + signaling | HS256 `LIVEKIT_API_SECRET` | `validateAccessToken` | resume identity, `WSS /signal` |
| Host token (ES256) | **Operation proof only** | ES256 `hostPrivateKey` | `validateHostToken` | resume/transfer host-operation proof |
| Session capability | **Identity proof** | opaque 256-bit random | `sessionStore.authenticate` | resume/transfer identity |
| Resume handle | **One-use resume proof** | opaque 256-bit random | `resumeHandleStore.consume` | host resume, bound to instance + generation |

Rules:

1. A host token alone authenticates nothing. It is accepted only alongside a valid private session whose `participantID` equals the host token subject.
2. Legacy and LiveKit access tokens are interchangeable for identity/signaling but are never accepted as host-operation proof.
3. ES256 host tokens are never accepted as identity or signaling credentials.
4. Purpose, issuer, algorithm, audience/room, instance, and generation are validated exactly for each signed credential. Wrong-purpose credentials fail closed before any state mutation or issuance.

## 3. Identity model

- **Identity primitive:** server-minted `participantID` (`p-<uuid[:8]>`), the subject of every access and host token. Never accepted from the client.
- **Identity proof:** a 256-bit session capability (`crypto/rand`, 32 bytes, base64url), delivered only in the direct bootstrap response establishing the owning participant. The server stores only its SHA-256 hash.
- **Binding rule:** caller identity is derived exclusively from the server-validated private session. Request body, display name, arbitrary `participantId`, and host-token subject are untrusted for identity.

For privileged operations all must hold:

| Check | Source |
|---|---|
| Session capability valid, unexpired, correct purpose | `sessionStore` |
| Session `participantID` == access-token `sub` | access token |
| Session `roomInstanceID` == current room instance | `RoomAuthority.RoomInstanceID` |
| Host proof `sub` == session `participantID` == current `HostID` | ES256 host token |
| Host proof room == request room, role == `host` | ES256 host token |
| Host proof `rinst`/`gen` == current room instance/generation | `RoomAuthority` |

## 4. Authority model

A host tenure is identified by `(roomInstanceId, authorityGeneration, hostId)`.

| Event | Generation | HostID |
|---|---|---|
| `createRoom` | 1 | creator |
| `transferHost` | ++ | target |
| succession / grace expiry | ++ | successor or `""` |
| revocation / authority reset | ++ | `""` |
| host resume | unchanged | unchanged (same tenure) |

Generation advance is the primary revocation mechanism: every prior host token and resume handle becomes stale by construction. `assignRole` is read-only for role eligibility and never mutates `HostID`, generation, or grace; guest `/token` issuance cannot elect or replace the host.

## 5. Endpoint contract

### `POST /room/create`
Returns the host bootstrap contract: `token`/`livekitToken`, `hostToken`, `hostKey`, `sessionToken`, `resumeHandle`, `roomInstanceId`, `role: "host"`.

### `POST /token` — guest path (no privileged headers)
Mint a fresh `participantID`; issue a participant access token and participant-purpose `sessionToken`. `role` stays `"participant"`; `HostID` is never written.

### `POST /token` — resume path
Triggered by the **presence** of any privileged header (`Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`), even when empty or malformed. A failed attempt fails closed and never downgrades to guest issuance.

Request carries:
- `Authorization: Bearer <accessToken>` (identity credential)
- `X-Session-Capability: <capability>` (identity proof)
- `X-Host-Proof: Bearer <hostToken>` (host-operation proof, required only to resume as host)
- `X-Resume-Handle: <handle>` (one-use, generation-bound resume proof)

Server: validate access token → authenticate capability (require participant + instance match) → if `participantID == HostID` validate and consume the host proof and one-use handle → rotate the session capability. On success returns the preserved identity; for a current-generation host, a fresh host token and replacement resume handle. Non-host resumes preserve identity as participant with no authority mutation.

### `POST /room/transfer-host`
Request carries the requester's access token, session capability, and host proof, plus body `{roomId, targetParticipantId}`.

Server: require all three headers → require the target to have a **live authenticated signaling connection** (private delivery channel) or refuse before mutation → authenticate requester + current-generation host proof → verify target holds an active session in the same room instance → commit compare-and-swap transfer on `expectedGeneration` → mint the target host token and issue a fresh target resume handle → deliver privately to the target's WebSocket connection. The requester receives public metadata only (`hostId`, `hostKey`, `generation`, `delivered`, `timestamp`); the target credential is never broadcast or returned to the requester.

## 6. Error contract

| Condition | Status | Body |
|---|---|---|
| Missing/invalid session on privileged path | 401 | `private_session_required` |
| Session expired / rotated / wrong room instance | 401 | `private_session_invalid` |
| Consumed/stale resume handle | 401 | `resume_handle_invalid` |
| Session subject mismatch or wrong room instance | 403 | `identity_mismatch` |
| Host proof missing/invalid | 403 | `host_proof_required` |
| Requester not current host | 403 | `identity_mismatch` |
| Target has no authenticated session | 403 | `transfer_target_unauthenticated` |
| Target has no live delivery connection | 503 | `transfer_target_unavailable` |
| Concurrent stale-generation transfer | 409 | `generation_conflict` |
| Delivery failure after commit | 502 | `credential_delivery_failed` |

## 7. Failure & atomicity semantics

- Authority mutation and all rechecks happen in one critical section (`am.mu`); the transfer compare-and-swap re-reads generation under the lock.
- Credential minting happens after a successful commit. A signing failure before commit leaves prior authority intact.
- Delivery failure after commit never broadcasts as a fallback and never reports false success; the transition remains bound to the committed target and generation.
- Volatile state only: a process restart regenerates the ES256 signing key and empties authority/session/handle maps. Old host tokens fail signature; empty rooms fail closed. Legacy/LiveKit access tokens remain valid from unchanged secrets but grant no privileged authority.

## 8. Traceability

| Requirement | Implementation |
|---|---|
| Private caller identity | `sessionStore` (`main.go`) |
| One-use resume handle | `resumeHandleStore.consume` |
| Generation-bound tokens | `HostClaims.rinst` / `HostClaims.gen`, `mintHostToken` |
| Atomic transfer | `authorityManager.transferHost` (CAS) |
| Target-only delivery | `hub.deliverHostCredential` |
| Activation wiring | `handleTokenResume`, `handleTransferHost` |
| Tests | `sec02a_containment_test.go`, `sec02b_identity_binding_test.go`, `sec02c_authority_generation_test.go`, `sec02d_activation_test.go` |
