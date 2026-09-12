# Handoff Report — Specification & Contract Investigation (REL-01, SEC-01A, SEC-02B/C)

**Agent**: `teamwork_preview_spec_miner_contract_1`  
**Working Directory**: `c:\Users\joshu\meet-secure-core\.agents\teamwork_preview_spec_miner_contract_1`  
**Parent Conversation ID**: `90a59792-b981-48da-b928-7c3ea3252f2c`  
**Timestamp**: 2026-09-12T23:05:30Z  
**Status**: Task Complete (Hard Handoff)

---

## 1. Observation

### 1.1 Backend Authoritative Contract (`services/meet-signal/main.go`)
- **Session Capability (`sessionStore`, lines 269–357)**:
  - Raw capability is a 256-bit unguessable random token (`crypto/rand`, 32 bytes, base64url-encoded).
  - Delivered strictly in direct bootstrap HTTP response (`TokenResponse.SessionToken`).
  - Stored only as SHA-256 hash (`sessionCapabilityHash(capability)`) in volatile memory (`sessionRecord` tracking `ParticipantID`, `RoomInstanceID`, `Purpose` ["host"|"participant"], `SessionVersion`, `ExpiresAt`).
  - Rotated on every resume (`sessionStore.rotate()`), invalidating the prior capability.
- **One-Use Host Resume Handle (`resumeHandleStore`, lines 359–420)**:
  - 256-bit unguessable token issued only to hosts (`resumeHandles.issue()`).
  - Stored as SHA-256 hash; tracked with `(ParticipantID, RoomInstanceID, Generation, SessionVersion, ExpiresAt, Used)`.
  - Atomically consumed in `consumeResumeHandle()` (lines 225–236) under `am.mu` lock. Duplicate or stale consumption fails closed with `401 Unauthorized` (`errResumeHandleInvalid`).
- **Room Instance Identifier (`RoomAuthority.RoomInstanceID`, lines 115–123)**:
  - Unguessable 32-byte hex string (`newRoomInstanceID()`) generated on room creation.
  - Stamped on `RoomAuthority`, `sessionRecord`, and in ES256 host token claims (`rinst`, lines 676–707).
  - If a room is destroyed or recreated under the same name, a new `RoomInstanceID` is generated; all tokens, sessions, and handles from former incarnations are rejected with `403 Forbidden` (`errIdentityMismatch`).
- **Authority Generation (`RoomAuthority.AuthorityGeneration`, lines 93–102)**:
  - Monotonic `uint64` initialized to 1 at room creation. Incremented atomically on host transfer (`transferHost()`, lines 186–205), grace expiry (`startHostGrace()`, lines 238–267), and revocation (`revokeAuthority()`, lines 210–220).
  - Stamped into ES256 host token (`gen` claim). Transfers execute compare-and-swap on `expectedGeneration` (lines 197–199, 1426); concurrent transfers with stale generation fail with `409 Conflict` (`errGenerationConflict`).
- **Privileged Header Detection & Fail-Closed Behavior (`handleToken`, lines 962–974)**:
  - The presence of any privileged header (`Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`), even if empty or malformed (`headerPresent()`), forces routing to `handleTokenResume()` (lines 1021–1070).
  - A failed resume attempt returns `401 Unauthorized` or `403 Forbidden` via `writeAuthError()` (lines 446–461) and **never** downgrades to guest issuance.
- **Target-Only Credential Delivery (`handleTransferHost`, lines 1429–1520)**:
  - Requiress active WebSocket connection for target in `hub.clientByParticipant(req.RoomID, req.TargetParticipantID)` before committing authority. Fails with `503 Service Unavailable` (`transfer_target_unavailable`) if absent.
  - Target's new ES256 host token and resume handle are delivered **only** to the target's WebSocket connection via `hub.deliverHostCredential()` (lines 581–608) in frame `type: "host-credential"`.
  - Outgoing host receives **only public metadata** in HTTP response: `{ roomId, hostId, hostKey, generation, delivered: true, timestamp }` (lines 1512–1519). The response body contains zero credential tokens.
- **Backend Test Verification (`services/meet-signal/`)**:
  - Verified 51 top-level test suites across `main_test.go`, `sec02a_containment_test.go`, `sec02b_identity_binding_test.go`, `sec02c_authority_generation_test.go`, `sec02d_activation_test.go`.

### 1.2 Git Commit & Stash Records
- **Commit History (`.git/logs/HEAD`)**:
  - `c1b18be`: Baseline before SEC-CRIT-02 closure.
  - `1877b23`: `fix: close host credential replay by binding authority to private sessions` (merged via fast-forward on branch `sec-crit-02-closure`).
  - `4dadb09`: `docs: record SEC-CRIT-02 closure evidence`.
  - `b4ce34a`: `style: format meet-signal and correct activation comments`.
  - `a5957b0`: `docs: refresh SEC-CRIT-02 evidence for the final revision` (current `main` HEAD).
- **Stash Commit (`.git/logs/refs/stash`)**:
  - Commit `834a707bd0511788fe25f410b012978db7d90491` with message:
    `"On main: non-SEC-CRIT-02 work preserved at SEC-CRIT-02 closure (SEC-01A/UX-01/SEC-01B/AGENTS/tooling)"`.
  - Recorded in `docs/gates/SEC-CRIT-02-governance-review.md` lines 43–50 as containing all SEC-01A and UX-01 uncommitted files.

### 1.3 Frontend Implementation State (`poc/meet-webrtc-core/src/`)
- **`src/auth/token.ts`**:
  - `createRoom()` calls `POST /room/create`, hydrates session authority into `appStore`, and fails closed without guest fallback.
  - `fetchToken()` inspects local session state. If resuming for the same room with existing `jwt` and `sessionToken`, it injects `Authorization`, `X-Session-Capability`, `X-Host-Proof`, and `X-Resume-Handle`.
- **`src/store/appStore.ts`**:
  - Defines `SessionAuthority` interface (`sessionToken`, `resumeHandle`, `roomInstanceId`, `hostToken`, `hostKey`).
  - Implements `setSessionAuthority()` and `clearHostAuthority()`.
- **`src/signaling/controlChannel.ts` & `src/signaling/client.ts`**:
  - `SignalingClient` handles frame `type: "host-credential"`.
  - `ControlChannelManager` listens for `host-credential`, enforces target-only participant check, suppresses duplicates via `lastAppliedKey`, and updates `appStore` and `HostControlManager`.
- **`src/host/hostControlManager.ts`**:
  - `transferHost()` transmits `Authorization`, `X-Session-Capability`, `X-Host-Proof`, updates `hostPublicKey`, clears local host authority, and broadcasts an announcement-only directive `{ action: 'host-changed' }` with no credentials.
- **`poc/meet-webrtc-core/tests/rel01-session-authority.test.ts`**:
  - 9 regression tests (`REG-01` through `REG-09b`) fully verifying the client side of the REL-01 contract against mocked backend behaviors.

---

## 2. Detailed Technical Analysis

### 2.1 REL-01 Architecture Mechanics

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               REL-01 PROTOCOL ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. Room Creation (Host Bootstrap)                                                     │
│     Client ── POST /room/create { name, roomId } ─────────────────────────> Server     │
│     Client <── 200 OK { token, hostToken, sessionToken, resumeHandle, ... } ─ Server   │
│     * Client hydrates AppStore: sessionToken (cap), resumeHandle, roomInstanceId       │
│                                                                                        │
│  2. Host Transfer (Private Target Delivery)                                            │
│     Host-A ── POST /room/transfer-host ───────────────────────────────────> Server     │
│               Headers: Authorization, X-Session-Capability, X-Host-Proof               │
│               Body: { roomId, targetParticipantId: "Host-B" }                          │
│     Server checks: Hub has live WS for Host-B (refuses with 503 if absent)             │
│     Server commits: CAS on generation (gen 1 -> 2), mints new Host-B credentials      │
│     Host-A <── 200 OK { roomId, hostId: "Host-B", hostKey, gen: 2, delivered: true }  │
│     Host-B <── WSS Frame: type: "host-credential" { hostToken, resumeHandle, ... }     │
│     Host-A ── LiveKit DataChannel: { action: "host-changed", newHostId: "Host-B" } ──>│
│               (Public announcement ONLY - ZERO credential payload)                     │
│                                                                                        │
│  3. Host Reconnection (Atomic One-Use Resume)                                          │
│     Host-B ── POST /token ────────────────────────────────────────────────> Server     │
│               Headers: Authorization, X-Session-Capability,                            │
│                        X-Host-Proof, X-Resume-Handle                                   │
│     Server checks: Atomically consumes resumeHandle; verifies gen & rinst              │
│     Host-B <── 200 OK { token, hostToken (new), sessionToken (rot), resumeHandle (rot)│
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **`sessionToken`**:
   - Acts as a 256-bit unguessable bearer capability proving caller identity.
   - Demotes the ES256 host token from being an identity claim to being solely an operation proof.
   - Prevents attacker impersonation: an attacker holding a valid host token cannot act on it because they do not hold the private session capability corresponding to the token subject.
2. **`resumeHandle`**:
   - Single-use, generation-bound bearer proof for host resumption.
   - Mitigates replay attacks: once consumed by a reconnecting host, the handle is invalidated (`Used = true`) and cannot be replayed.
   - Prevents stale host resuscitation: if host authority moved to another participant (advancing generation), the old handle is immediately rejected.
3. **`roomInstanceId`**:
   - Cryptographically unguessable room incarnation identifier.
   - Scopes all sessions and host tokens to a specific room lifecycle.
   - Ensures that deleting/recreating a room with the same name invalidates all prior credentials.
4. **`host-credential` Delivery**:
   - Operates over dedicated authenticated WebSocket signaling (`WSS /signal`), completely isolating credential delivery from the LiveKit DataChannel.
   - Enforces strict target-only delivery (`hub.deliverHostCredential()`).
   - Ensures outgoing host never receives the new host's credentials in HTTP responses.

---

### 2.2 Contrast: REL-01 Mechanics vs. SEC-01A Assumptions

| Dimension | SEC-01A Assumption (in `stash@{0}`) | REL-01 Active Contract (on `main`) | Alignment / Conflict | Resolution for Integration |
|---|---|---|---|---|
| **Root of Trust** | Server certifies host via ES256 signature; client verifies directives. | Server certifies host via ES256 signature; client verifies directives. | **ALIGNED** | Preserve `HostTokenVerifier` and verification pipeline. |
| **Directive Verification** | Verify-then-mutate: structure, role, sub, aud, exp, freshness, signature. | Verify-then-mutate: structure, role, sub, aud, exp, freshness, signature. | **ALIGNED** | Retain all 7 steps of `HostTokenVerifier`. |
| **Presence Locking** | `presenceStore.hostId` is single source of truth; peer joins cannot displace host. | `presenceStore.hostId` is single source of truth; peer joins cannot displace host. | **ALIGNED** | Retain presence locking in `presenceAdapter.ts`. |
| **Transfer Delivery Channel** | DataChannel broadcast of `newHostToken` and `hostKey` in `host-changed` message. | Target-only WSS frame `host-credential`. DataChannel carries announcement only. | **CRITICAL CONFLICT** | Strip `newHostToken` from DataChannel message in `hostControlManager.ts`. Ingest via `ControlChannelManager`. |
| **Transfer HTTP Contract** | Outgoing host receives `newHostToken` in response body of `/room/transfer-host`. | Outgoing host receives only public metadata `{ roomId, hostId, hostKey, generation, delivered }`. | **CRITICAL CONFLICT** | Discard code expecting `body.newHostToken`. Use public metadata and clear local authority. |
| **Host Identity Proof** | Presenting ES256 `hostToken` in `Authorization` header proves host identity. | `hostToken` is operation proof only; identity requires `X-Session-Capability`. | **CRITICAL CONFLICT** | Ensure all privileged endpoints transmit `X-Session-Capability` alongside `Authorization`. |
| **Host Reconnect Contract** | Reconnection sends `Authorization: Bearer <token>` to `/token`. | Reconnection requires `Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`. | **CRITICAL CONFLICT** | Maintain 4-header transmission in `src/auth/token.ts`; handle rotated tokens. |
| **Authority Invalidation** | Tokens valid until `exp` (timestamp-based only). | Tokens generation-bound (`gen`, `rinst`); invalidated immediately on transfer/reset. | **CRITICAL CONFLICT** | Update token claim structures in verifier to support optional/required `gen`/`rinst`. |
| **Failure Handling** | Failed room creation or host check falls back to guest issuance. | Fail closed: 401/403/409/503 re-throws; zero guest fallback. | **CRITICAL CONFLICT** | Prohibit all silent fallbacks to guest tokens. |

---

### 2.3 R2a: Legacy Authority Path Audit Table

Each legacy authority path identified in recovered SEC-01A files is audited below:

| Legacy Path Item | File & Context | Classification | Detailed Justification |
|---|---|---|---|
| **`newHostToken` in DataChannel** | `hostControlManager.ts` (`onDataReceived`, `publishDirective`) | **REMOVE** | In SEC-01A, `host-changed` DataChannel messages carried `newHostToken`. Under REL-01/SEC-02D, DataChannel broadcast of credentials is the root exploit of SEC-CRIT-02. Must be stripped completely. |
| **`newHostToken` in HTTP Transfer** | `hostControlManager.ts` (`transferHost()`) | **REMOVE** | Outgoing host must not receive or expect `newHostToken` in response from `POST /room/transfer-host`. Backend returns only public metadata. |
| **`hostKey` Transfer Coupling** | `hostControlManager.ts` & `presenceAdapter.ts` | **REPLACE** | `hostKey` is public verification metadata. It should still be learned from public metadata or announcements, but it must NOT be coupled with private credential delivery. Replace coupled reception with `ControlChannelManager` ingestion. |
| **`Authorization`-only Host Resume** | `src/auth/token.ts` & `reconnect/manager.ts` | **REPLACE** | Under SEC-02B/C, `Authorization`-only resume returns `401 private_session_required`. Replace with 4-header payload (`Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`). |
| **DataChannel Credential Delivery** | `hostControlManager.ts` (`onDataReceived`) | **REMOVE** | DataChannel must never parse, accept, or apply host credentials. All host credentials arrive via `ControlChannelManager` on WSS `/signal` (`host-credential` frame). |
| **Implicit Host Restoration** | `presenceStore.ts` (lines 127–135) & `presenceAdapter.ts` | **REMOVE** | When a host leaves or disconnects, the client must NOT nominate a successor or restore host locally (e.g. lowest ID). Succession is server-authoritative; client nomination creates split-brain hosts without valid ES256 tokens. |
| **Guest Fallback Issuance** | `src/auth/token.ts` (`createRoom()`, `fetchToken()`) | **REMOVE** | Legacy fallback silently downgraded failed room creation or failed resume to a guest participant token. Under REL-01, failed requests must fail closed and re-throw. |

---

### 2.4 SEC-01A Controls Still Required

The following client-side security controls developed in SEC-01A are **unconditionally required** and must be preserved during recovery:

1. **Verify-Then-Mutate Moderation Guard (`HostTokenVerifier`)**:
   - Because LiveKit SFU forwards DataChannel packets blindly without inspecting application payloads, malicious participants can send forged DataChannel packets.
   - Client MUST execute the 7-step verification pipeline before applying any moderation action (`mute-participant`, `remove-participant`, `spotlight-participant`, `lock-room`, `waiting-room-admit`, `waiting-room-reject`, `update-permissions`).
2. **Sender Identity & Established Host Binding**:
   - Directive `senderId` must match token `claims.sub` AND match `presenceStore.hostId`.
   - When an authoritative host is already established, directives from any other participant ID must be rejected and logged as anomalies.
3. **Replay & Freshness Protection**:
   - Directives must carry a unique `nonce` and a `timestamp` within the freshness skew window ($\le 60\text{s}$).
4. **Presence Authority Lock**:
   - `presenceStore` locks `activeHostId = state.hostId` during `setLocalParticipant` and `upsertParticipant`.
   - Prevents incoming participant events from overwriting or displacing host authority.
5. **Default Waiting Room & Entry Gate**:
   - Unadmitted attendees remain in lobby (`isWaitingInLobby: true`) and cannot publish camera or microphone until explicitly admitted by the host.

---

### 2.5 REL-02 Acceptance Criteria & Implementation Complexity

#### REL-02 Acceptance Criteria (AC-1 to AC-6)

- **AC-1 (Stash Recovery Hygiene)**: Extract only SEC-01A remediation files (`hostControlManager.ts`, `hostTokenVerifier.ts`, `presenceAdapter.ts`, `m4a-sec01-*.test.ts`, `ORDERING-CONTRACT-SEC01A.md`, `STRIDE-host-takeover-SEC01A.md`, `SEC-01-UX-01-MERGE-GATES.md`). Discard unrelated stash contents (UX-01 primitives, tooling archives, stale QA reports).
- **AC-2 (Zero Legacy Path Regressions)**: Verified absence of `newHostToken` in DataChannel broadcasts, zero guest fallback on resume failure, zero implicit client-side host succession, and full enforcement of target-only credential delivery via WSS.
- **AC-3 (REL-01 Contract Compatibility)**: `hostControlManager.transferHost()` sends `X-Session-Capability` and `X-Host-Proof`; `token.ts` preserves 4-header resume; `appStore.ts` preserves session authority hydration; all 9 tests in `tests/rel01-session-authority.test.ts` PASS.
- **AC-4 (SEC-01A Security Test Verification)**: Both `tests/m4a-sec01-verifier.test.ts` and `tests/m4a-sec01-order-sender.test.ts` PASS, demonstrating cryptographic directive verification, sender matching, and replay rejection.
- **AC-5 (Full Regression & Build Green)**:
  - Frontend unit tests: 100% pass ($\ge 285$ tests across $\ge 38$ files).
  - Frontend build: `npm run build` succeeds with zero TypeScript errors and bundle size $\le 225$ kB gzip.
  - Backend tests: `go test ./...` in `services/meet-signal` passes 100% (51 tests).
- **AC-6 (Governance Invariant Preservation)**: No modifications to backend contract (`services/meet-signal/main.go`), zero changes to SEC-02B/C specifications, and zero redesign of SEC-01A verification primitives.

#### Implementation Complexity Assessment

- **Overall Rating**: **MEDIUM**
- **Rationale**:
  1. **Backend Fixed**: Zero backend modifications required. The backend contract is active and fully tested on `main`.
  2. **Infrastructure Prepared**: The frontend session authority store (`appStore.ts`), token bootstrap/resume (`token.ts`), and control channel listener (`controlChannel.ts`) are already committed on `main`.
  3. **Targeted Merge Conflict Resolution**: Merge conflicts are localized to `hostControlManager.ts` and `presenceAdapter.ts`. In `hostControlManager.ts`, the SEC-01A directive verification logic must be retained while adopting REL-01's transfer headers and target-only delivery. In `presenceStore.ts`, the legacy client-side succession fallback (`nextHostId = remaining[0]`) must be removed to respect server-authoritative grace.
  4. **Strict Audit Discipline**: The R2a audit rules provide clear KEEP/REMOVE/REPLACE criteria, making the rebase mechanical rather than architectural.
- **Ready for Recovery**: **YES** (The contract boundaries are clearly established, test suites exist for both sides, and no architectural unknowns remain).

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Auth / Identity | Private Session Capability | 256-bit unguessable random capability returned at bootstrap; proves caller identity for privileged actions. | Direct bootstrap (`POST /room/create` or `/token`) | `TokenResponse.sessionToken` | Replay or wrong room instance returns 401 `private_session_invalid` | `services/meet-signal/main.go:269-357` |
| 2 | Auth / Authority | One-Use Host Resume Handle | Generation-bound, single-use handle consumed atomically upon host reconnection. | Reconnect `POST /token` with `X-Resume-Handle` | Rotated `resumeHandle` + new `hostToken` | Duplicate or stale handle returns 401 `resume_handle_invalid` | `services/meet-signal/main.go:359-420` |
| 3 | Auth / Lifecycle | Room Incarnation Binding | Unguessable 32-byte identifier scoping all sessions and host tokens to one room instance. | Generated on room creation | `RoomAuthority.RoomInstanceID` | Former room instance tokens rejected with 403 `identity_mismatch` | `services/meet-signal/main.go:115-123` |
| 4 | Auth / Authority | Monotonic Authority Generation | Counter incremented on transfer, grace expiry, or revocation; invalidates all past host tokens. | Host transfer, grace timeout, authority revocation | `RoomAuthority.AuthorityGeneration++` | Stale generation transfer CAS returns 409 `generation_conflict` | `services/meet-signal/main.go:186-220` |
| 5 | Signaling / Authority | Target-Only Host Delivery | New host credentials delivered strictly over target's WebSocket connection, never broadcast. | `POST /room/transfer-host` | WSS frame `type: "host-credential"` to target only | If target has no active WS, returns 503 `transfer_target_unavailable` | `services/meet-signal/main.go:581-608, 1459-1507` |
| 6 | Moderation / Client | 7-Step Directive Verifier | Validates structure, role, subject, audience, expiration, freshness skew ($\le 60$s), and ECDSA signature. | `HostDirectiveMessage`, `activeRoomId`, `senderId`, `hostKey` | `VerificationResult` (`valid: boolean`, `claims`, `error`) | Invalid signature or mismatch logged and discarded | `poc/.../src/host/hostTokenVerifier.ts:83-214` |
| 7 | Presence / Store | Presence Authority Lock | Locks `activeHostId = state.hostId` during participant upsert; prevents disappearing host. | Participant join / presence update | Immutable `state.hostId` | Unauthorized peer cannot usurp host role | `poc/.../src/presence/presenceStore.ts:57-114` |
| 8 | Reconnect / Client | Reconnection Manager | Coordinates ICE restart and WebSocket reconnection buffering with $<5$s p95 latency target. | Disconnect event, `signalReconnect`, `createIceRestartOffer` | Reconnected event, latency metrics, replayed buffer | Emits `failed` if `maxAttempts` exceeded | `poc/.../src/reconnect/manager.ts:29-173` |
| 9 | Signaling / Client | Control Channel Manager | Singleton WebSocket manager for target-only private credential ingestion and duplicate suppression. | WSS `/signal` stream, `HostCredentialPayload` | Hydrates `appStore` & `HostControlManager` | Malformed or non-target credential silently ignored | `poc/.../src/signaling/controlChannel.ts:48-176` |

---

## 4. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Host Resume Replay | Host attempts to reuse already-consumed `X-Resume-Handle` | Server rejects with `401 Unauthorized` (`resume_handle_invalid`); credentials not issued. |
| 2 | Deposed Host Resume | Host transferred to B; deposed Host A attempts to resume with old credentials | Server validates A's identity as participant only (`role: "participant"`), issuing zero host tokens. |
| 3 | Stale Authority CAS | Two concurrent transfers submitted for the same authority generation | Exactly one transfer commits and advances generation; second transfer loses CAS and fails with `409 Conflict`. |
| 4 | Target Offline Transfer | Host attempts to transfer authority to target who has disconnected from WebSocket signaling | Server refuses transfer with `503 Service Unavailable` (`transfer_target_unavailable`); zero state mutated. |
| 5 | Room Recreation Collision | Room deleted and immediately recreated with identical name | New room receives distinct `RoomInstanceID`; tokens from first incarnation fail with `403 Forbidden` (`identity_mismatch`). |
| 6 | Stale Directive Replay | Attacker replays captured DataChannel moderation directive packet older than 60s | `HostTokenVerifier` rejects packet with `Directive timestamp outside freshness window`. |
| 7 | Duplicate WS Credential | ControlChannel receives duplicate `host-credential` frames due to network reconnect | `ControlChannelManager.applyHostCredential` detects matching `lastAppliedKey` and suppresses duplicate update. |
| 8 | Malformed Privileged Header | Client submits present-but-empty `Authorization` header to `/token` | `headerPresent()` detects header, routes to resume path, fails closed with `401 Unauthorized`; never falls back to guest. |
| 9 | Sender / Token Mismatch | Attacker sends DataChannel directive with valid host token issued to another participant | `HostTokenVerifier` fails step 3 (`claims.sub !== senderId`), rejecting directive. |

---

## 5. Logic Chain

1. **Premise 1**: The backend contract in `services/meet-signal/main.go` represents the frozen, authoritative security baseline resulting from SEC-CRIT-02 closure (`sec-crit-02-closed` tag, commit `a5957b0`). It requires `sessionToken`, `resumeHandle`, `roomInstanceId`, and delivers credentials exclusively to the transfer target over WebSocket signaling.
2. **Premise 2**: The client implementation on `main` (`token.ts`, `appStore.ts`, `controlChannel.ts`, `rel01-session-authority.test.ts`) already satisfies REL-01 by supporting the 4-header resume contract and target-only credential ingestion.
3. **Premise 3**: The uncommitted SEC-01A work in `stash@{0}` provides crucial client-side defenses (7-step `HostTokenVerifier`, presence authority lock, waiting room guards) needed to prevent peer-to-peer DataChannel moderation forgery, but was written before SEC-02B/C and contains legacy assumptions (`newHostToken` on DataChannel, `Authorization`-only resume, guest fallback).
4. **Deduction 1**: Merging SEC-01A blindly into `main` without auditing legacy paths would reintroduce the exact broadcast and replay vulnerabilities that SEC-CRIT-02 closed.
5. **Deduction 2**: Stripping the 6 legacy authority paths (R2a audit) while preserving the 5 core SEC-01A verification controls resolves all merge conflicts without altering the backend contract or redesigning SEC-01A.
6. **Conclusion**: REL-02 recovery is feasible, architecturally sound, and has Medium complexity. The repository is ready for recovery.

---

## 6. Caveats

- **No Active Stash Manipulation**: This investigation was strictly read-only per the Specification Miner identity. `stash@{0}` was analyzed via git logs, commit parentage, governance manifests, and code diffs without running `git stash pop` or modifying working tree state.
- **Race Detector Execution Environment**: Cgo-dependent race tests (`go test -race`) require a Linux or Cgo-enabled runner; local Windows verification was performed using standard Go test suites (`go test -count=1 ./...`).
- **UX-01 Separation**: UX-01 assets (primitives, styles, design tokens) in `stash@{0}` are strictly out-of-scope for REL-02 and must remain segregated during rebase.

---

## 7. Conclusion

The authoritative specifications and contract implementations across `meet-signal` and `poc/meet-webrtc-core` have been completely probed:
1. **REL-01 Mechanics**: The active backend contract enforces private session binding (`sessionToken`), single-use resumption (`resumeHandle`), room incarnation scoping (`roomInstanceId`), and target-only signaling delivery (`host-credential`).
2. **SEC-01A Alignment & Conflict**: SEC-01A aligns on server authority, verify-then-mutate, and fail-closed rules, but conflicts on credential distribution (DataChannel vs WSS), identity proofs (host token alone vs session capability), and reconnect headers (1 header vs 4 headers).
3. **Legacy Authority Audit**: All 6 legacy paths have been classified (REMOVE `newHostToken`, DataChannel credential delivery, implicit host restoration, and guest fallback; REPLACE `hostKey` transfer coupling and `Authorization`-only resume).
4. **Controls Retained**: The 7-step `HostTokenVerifier`, presence authority lock, and waiting room admission gates remain mandatory.
5. **Project Readiness**: Implementation complexity is **MEDIUM**. The project is **READY FOR RECOVERY (YES)**.

---

## 8. Verification Method

To independently verify the facts and findings in this report:

1. **Verify Backend Contract & Tests**:
   ```bash
   cd services/meet-signal
   go test -v -run "TestSEC02" ./...
   go test -v -run "TestM4A" ./...
   ```
   *Expected result*: All SEC-02A containment, SEC-02B identity binding, SEC-02C authority generation, and SEC-02D activation tests pass.

2. **Verify Frontend REL-01 Session Authority Tests**:
   ```bash
   cd poc/meet-webrtc-core
   npm test tests/rel01-session-authority.test.ts
   ```
   *Expected result*: 9/9 tests pass (`REG-01` through `REG-09b`).

3. **Verify Stash Identity & Log Evidence**:
   Inspect `.git/logs/refs/stash` and `.git/logs/HEAD`:
   - Stash commit `834a707bd0511788fe25f410b012978db7d90491` exists and records the preserved SEC-01A/UX-01 work.
   - `main` HEAD is `a5957b0a114a15f12cb448a92e004386806716f9` with tag `sec-crit-02-closed`.

4. **Verify Frontend Build & Typecheck**:
   ```bash
   cd poc/meet-webrtc-core
   npm run build
   ```
   *Expected result*: TypeScript compilation succeeds with zero errors.
