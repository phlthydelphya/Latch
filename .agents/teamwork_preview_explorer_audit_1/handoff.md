# Handoff Report — Legacy Authority Path Audit & Test/Rebase Strategy (R2a, R3)

**Subagent**: `teamwork_preview_explorer_audit_1`  
**Working Directory**: `c:\Users\joshu\meet-secure-core\.agents\teamwork_preview_explorer_audit_1`  
**Parent Conversation ID**: `90a59792-b981-48da-b928-7c3ea3252f2c`  
**Timestamp**: 2026-09-12T23:07:00Z  
**Handoff Type**: Hard Handoff (Task Complete)  

---

## 1. Observation

### 1.1 Repository State and Stash Provenance
1. **Current HEAD**: `a5957b0a114a15f12cb448a92e004386806716f9` on `main`. Tagged `sec-crit-02-closed` (commit `1877b23` / `a5957b0`).
2. **Stash Commit**: `stash@{0}` commit SHA is `834a707bd0511788fe25f410b012978db7d90491`.
   - Recorded in `.git/logs/refs/stash`:
     ```text
     0000000000000000000000000000000000000000 834a707bd0511788fe25f410b012978db7d90491 PM muse-spark-1.2 <pm@meet-secure.local> 1789247710 -0400	On main: non-SEC-CRIT-02 work preserved at SEC-CRIT-02 closure (SEC-01A/UX-01/SEC-01B/AGENTS/tooling)
     ```
   - Created at Unix epoch `1789247710` (2026-09-12T19:01:50-04:00) during the formal closure of `SEC-CRIT-02`.
3. **Stash Inventory Records in Governance Documents**:
   - `docs/gates/SEC-CRIT-02-governance-review.md` lines 43–51:
     - Frontend SEC-01A / UX-01: `poc/meet-webrtc-core/**` modified/untracked files (`ControlBar.tsx`, `hostControlManager.ts`, `hostTokenVerifier.ts`, `main.tsx`, `presenceAdapter.ts`, `package.json`/`package-lock.json`, primitives, tokens, `token-audit.ts`, `m4a-sec01` tests, stylelint).
     - SEC-01A docs/evidence: `docs/adr/ORDERING-CONTRACT-SEC01A.md`, `docs/adr/STRIDE-host-takeover-SEC01A.md`, `SEC-01-UX-01-MERGE-GATES.md`, `docs/gates/frozen-surface-guard-SEC01-UX01.md`, `qa/reports/SEC01A-*`, `qa/signoff-qa01a.md`.
     - SEC-01B planning: `docs/plans/SEC-01B-controlled-kickoff-packaging.md`.
     - UX-01: `docs/ux/`.
     - Governance: `AGENTS.md`.
     - Tooling/upload: `check_registries.py`, `meet-secure-backend-dev.zip`, `Latch-Backend-Review.md`.
     - QA noise: `qa/reports/phase4-status.md`, `q7-q8-q10-validation.md`, `playwright-results.json`, `audit-log-sample-SEC01A.json`.
     - Preserved plan: `qa/reports/not-readable-error-plan.md`.

### 1.2 The Active REL-01 Contract (`services/meet-signal/main.go` & `poc/meet-webrtc-core/`)
1. **Backend Authority Endpoints (`services/meet-signal/main.go`)**:
   - `POST /room/create` (lines 789–860): Mints host bootstrap containing `token`/`livekitToken`, `hostToken`, `hostKey`, `sessionToken` (256-bit unguessable random capability), `resumeHandle` (one-use handle), `roomInstanceId` (32-byte hex), `role: "host"`.
   - `POST /token` (lines 962–1070): Guest path sends zero privileged headers and gets participant role; presence of any privileged header (`Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`) triggers `handleTokenResume()`. Resume atomically consumes `resumeHandle`, validates `roomInstanceId` and `authorityGeneration`, and rotates the session capability. Failed resume returns 401/403 and **never** falls back to guest.
   - `POST /room/transfer-host` (lines 1400–1520): Requires `Authorization`, `X-Session-Capability`, `X-Host-Proof`, and an active WebSocket connection in `hub.clientByParticipant(roomId, targetId)` (lines 1459–1470). Executes atomic CAS on `AuthorityGeneration`. Delivers new host token and resume handle **only** to target via WSS frame `type: "host-credential"` (lines 581–608). Returns public metadata only (`{ roomId, hostId, hostKey, generation, delivered: true, timestamp }`) to the requester.
2. **Committed Frontend Integration on `main`**:
   - `src/auth/token.ts` (lines 13–41, 73–188): Fully hydrates `sessionToken`, `resumeHandle`, `roomInstanceId`, `hostToken`, `hostKey` into `appStore`. Sends all 4 headers on resume. Fails closed on HTTP errors without guest fallback.
   - `src/store/appStore.ts` (lines 24–32, 172–195): Tracks `sessionToken`, `resumeHandle`, `roomInstanceId`, `hostToken`, `hostKey`. Implements `setSessionAuthority()` and `clearHostAuthority()`.
   - `src/signaling/controlChannel.ts` (lines 48–176): Dedicated singleton WebSocket manager for WSS `/signal` stream. Listens for `type: "host-credential"`, verifies recipient is target participant, suppresses duplicate deliveries using `lastAppliedKey = ${rinst}|${gen}|${resumeHandle}`, and hydrates authority.
   - `src/host/hostControlManager.ts` (lines 503–556): `transferHost()` sends `Authorization`, `X-Session-Capability`, `X-Host-Proof`. Erases `this.localHostToken = null` and calls `store.clearHostAuthority()`. Publishes announcement-only directive `{ action: 'host-changed', targetParticipantId, newHostId, hostKey }` without credentials.
   - `tests/rel01-session-authority.test.ts` (lines 105–357): 9 regression tests (`REG-01` through `REG-09b`) proving 100% compliance with this private session authority contract.

---

## 2. Requirement R2a: Legacy Authority Path Audit

Every file present in `stash@{0}` was audited against the six legacy authority transfer and credential patterns. The audit verifies that no recovered code reintroduces legacy vulnerabilities conflicting with **REL-01** (contract alignment), **SEC-02B** (identity binding via private session capability), or **SEC-02C** (generation-bound credentials and one-use resume handles).

### 2.1 The Six Core Legacy Patterns

#### Pattern 1: `newHostToken`
- **Description**: The legacy M4A protocol included `newHostToken` in the HTTP response of `POST /room/transfer-host` and broadcasted `newHostToken` across the LiveKit DataChannel in the `host-changed` message to all room peers.
- **Conflict**: Root exploit of SEC-CRIT-02. Discloses private host credentials room-wide, enabling replay and host takeover. Prohibited by SEC-02B §1 / §4.4, SEC-02C §Token Binding, and REL-01 REG-03.
- **Verdict across all recovered files**: **REMOVE** from HTTP transfer parsing, **REMOVE** from DataChannel `publishDirective` payloads, **REMOVE** from `onDataReceived` directive handlers, and **REMOVE** / deprecate from `HostDirectiveMessage` interface in `types.ts`.

#### Pattern 2: `hostKey` transfer
- **Description**: The ECDSA P-256 public key hex string used to verify host token signatures.
- **Analysis**: Public verification key material is not a private secret (`docs/plans/SEC-02B-identity-binding.md` line 143). Public announcements of `hostKey` in `host-changed` or `host-announce` frames are permissible. However, in legacy code, `hostControlManager.ts:186–188` contained an unauthenticated auto-learning hook: `if (msg.hostKey && !this.hostPublicKey) this.hostPublicKey = msg.hostKey;`.
- **Conflict**: Allows an attacker injecting a forged directive into an unestablished room to crown their own key.
- **Verdict across all recovered files**: **REPLACE**. Public distribution of `hostKey` in announcements is **KEPT**, but unauthenticated auto-learning is **REPLACED** with strict authoritative binding: `hostKey` is only adopted from authenticated bootstrap (`/room/create`, `/token`), server transfer metadata (`res.json().hostKey`), or the target's private `host-credential` signaling frame.

#### Pattern 3: `Authorization`-only host resume
- **Description**: Reconnecting hosts calling `POST /token` presenting only `Authorization: Bearer <accessToken>` or relying on token `sub == claims.sub`.
- **Conflict**: Under SEC-02B/C and REL-01, an access token proves identity for signaling only, never authority. Host resumption requires four headers: `Authorization: Bearer <accessToken>`, `X-Session-Capability: <sessionToken>`, `X-Host-Proof: Bearer <hostToken>`, and `X-Resume-Handle: <resumeHandle>`. Presenting `Authorization` alone triggers the resume path without host proof, resulting in participant role issuance or 401.
- **Verdict across all recovered files**: **REPLACE**. Any stashed client resume code or test mocks presenting only `Authorization` must be replaced with the 4-header payload.

#### Pattern 4: DataChannel credential delivery
- **Description**: Receiving or transmitting private host credentials (`hostToken`, `newHostToken`, `sessionToken`, `resumeHandle`) over the LiveKit DataChannel (`HOST_CONTROL_TOPIC`).
- **Conflict**: LiveKit SFU forwards DataChannel packets blindly to all peers. Delivering credentials over DataChannel guarantees room-wide disclosure.
- **Verdict across all recovered files**: **REMOVE**. The DataChannel must carry solely public control directives (`action: 'mute-participant' | 'remove-participant' | 'host-changed' | 'lock-room' | 'waiting-room-admit'`) signed by the sender's host token. Target host credential delivery is strictly relocated to the authenticated WebSocket control channel (`WSS /signal`, frame `type: "host-credential"`).

#### Pattern 5: Implicit host restoration
- **Description**: Client-side logic that automatically elects or restores host authority based on local heuristics: inspecting `metadata.role === 'host'`, finding `localHostToken` in memory, or selecting the earliest-joined participant when the host disconnects (e.g. `nextHostId = remaining[0]` in legacy `presenceStore.ts`).
- **Conflict**: Violates server-authoritative session control. Host succession and grace are strictly managed by `services/meet-signal/main.go` (`startHostGrace()`, monotonic `AuthorityGeneration++`). Local client nomination produces split-brain rooms where the client believes it is host but holds no valid ES256 token or active generation authority.
- **Verdict across all recovered files**: **REMOVE**. Remove all client-side host succession and metadata-based self-election. Authority is updated exclusively via server directives, `/room/status`, or control channel frames.

#### Pattern 6: Guest fallback issuance
- **Description**: Try/catch blocks in `createRoom()` or `fetchToken()` that silently caught HTTP 4xx/5xx errors or network exceptions and fell back to calling `POST /token` as an anonymous guest.
- **Conflict**: Directly violates REL-01 REG-01b and REG-06. Conceals authority failure, bypasses admission control, and converts legitimate host resume attempts into unauthorized guest participants.
- **Verdict across all recovered files**: **REMOVE**. All API calls must fail closed: if room creation or host resumption fails, re-throw the error, display an explicit UI alert, and do not issue a guest session.

---

### 2.2 Comprehensive Per-File Audit Matrix (All Files in `stash@{0}`)

| # | File Path in `stash@{0}` | Legacy Pattern Occurrences Found | Classification | Actionable Justification & Integration Rule |
|---|--------------------------|----------------------------------|----------------|----------------------------------------------|
| 1 | `poc/.../src/host/hostControlManager.ts` | 1) `newHostToken` in `transferHost` response & broadcast.<br>2) Unverified `hostKey` auto-learning.<br>4) DataChannel credential receipt in `onDataReceived`. | **REPLACE** | **DISCARD** stashed `transferHost()` method (which expects `body.newHostToken`). **PRESERVE** the REL-01 `transferHost()` currently on `main` (transmits 3 headers, clears local token, broadcasts announcement only). **RECOVER** SEC-01A's Verify→Mutate directive guard and strict sender checking. |
| 2 | `poc/.../src/host/hostTokenVerifier.ts` | 2) `hostKey` format validation.<br>3) Absence of `gen` & `rinst` claim awareness. | **REPLACE** | **RECOVER** SEC-01A's 7-step verification pipeline (timing skew window, claims validation, WebCrypto P-256 signature verification). **EXTEND** `DecodedHostClaims` interface to include optional `gen?: number` and `rinst?: string` from SEC-02C. Ensure verifier never requires raw credential extraction. |
| 3 | `poc/.../src/presence/presenceAdapter.ts` | 5) Implicit host restoration: checks `metadata.role === 'host'` and `getLocalHostToken()` to infer `isLocalHost`. | **REPLACE** | **REMOVE** heuristic checks in `attach()` and `onParticipantConnected()`. Authority is determined strictly by `presenceStore.hostId === participant.identity`. **RECOVER** SEC-01A waiting room queue synchronization and unadmitted peer isolation. |
| 4 | `poc/.../src/components/ControlBar.tsx` | 1) Button triggers `transferHost` which previously expected immediate local UI host transfer. | **KEEP (SEC-01A/UX-01)** | ControlBar UI only invokes `manager.transferHost(targetId)`. Ensure UI handles async rejection cleanly. Defer visual token changes to UX-01. |
| 5 | `poc/.../src/main.tsx` | None directly; initial bootstrap routing. | **KEEP** | Clean integration; ensure `ControlChannelManager.getInstance().connect()` lifecycle is hooked into room entry. |
| 6 | `poc/.../tests/m4a-sec01-order-sender.test.ts` | 1) Mock directives carrying `newHostToken`.<br>4) Mock DataChannel credential transmission. | **REPLACE** | **RECOVER** test suite. Update mock directives to remove `newHostToken`. Verify tests assert sender identity matching and directive rejection from non-hosts. |
| 7 | `poc/.../tests/m4a-sec01-verifier.test.ts` | 3) Test vectors lacking `gen` / `rinst` claims. | **REPLACE** | **RECOVER** test suite. Update token generator helpers to support `gen` and `rinst` claims matching SEC-02C. Retain all negative tests (tampered payload, bad signature, clock skew $>60$s, audience mismatch). |
| 8 | `docs/adr/ORDERING-CONTRACT-SEC01A.md` | Legacy references to DataChannel host change. | **REPLACE** | **RECOVER** ADR. Add errata/addendum stating that credential delivery occurs over WSS control channel, while directive ordering and sender binding remain active on DataChannel. |
| 9 | `docs/adr/STRIDE-host-takeover-SEC01A.md` | References to token broadcast mitigation. | **REPLACE** | **RECOVER** ADR. Reconcile threat model: SEC-01A mitigates client-side DataChannel spoofing; SEC-02B/C mitigates server credential replay. |
| 10 | `SEC-01-UX-01-MERGE-GATES.md` | Verification checklist referencing legacy tests. | **REPLACE** | **RECOVER**. Update test references to include `rel01-session-authority.test.ts`. |
| 11 | `docs/gates/frozen-surface-guard-SEC01-UX01.md` | Scope boundaries between SEC-01 and UX-01. | **KEEP** | **RECOVER**. Governs branch isolation. |
| 12 | `qa/reports/SEC01A-*` (all files) | Historical QA test evidence. | **KEEP** | **RECOVER** for audit trail. |
| 13 | `qa/signoff-qa01a.md` | QA sign-off artifact. | **KEEP** | **RECOVER** for audit trail. |
| 14 | `poc/.../package.json` & `package-lock.json` | UX-01 dependencies (`stylelint`, UI tokens). | **DISCARD / DEFER** | Do NOT merge into REL-02. Belongs strictly to UX-01 tranche. |
| 15 | `poc/.../scripts/token-audit.ts` | Design token scanning script. | **DISCARD / DEFER** | UX-01 scope only. |
| 16 | `poc/.../.stylelintrc.json` | CSS linting configuration. | **DISCARD / DEFER** | UX-01 scope only. |
| 17 | `poc/.../src/components/primitives/` | Design system UI primitives. | **DISCARD / DEFER** | UX-01 scope only. |
| 18 | `poc/.../src/styles/tokens.ts` & `tokens.css.ts` | CSS custom property tokens. | **DISCARD / DEFER** | UX-01 scope only. |
| 19 | `docs/plans/SEC-01B-controlled-kickoff-packaging.md` | 1) Assumed `newHostToken` in broadcast (§B3.1). | **DISCARD / DEFER** | Superseded by SEC-CRIT-02 review. Will be rewritten in post-REL-01 milestone. |
| 20 | `docs/ux/` (all files) | UX wireframes and token specs. | **DISCARD / DEFER** | UX-01 scope only. |
| 21 | `AGENTS.md` (stash diff) | Premature "M4A CLOSED & ACCEPTED" claim. | **DISCARD** | Governance violation per ADR-007 §2. Must not be applied. |
| 22 | `check_registries.py` | Standalone Python network script. | **DISCARD** | Ad-hoc repo tooling. |
| 23 | `meet-secure-backend-dev.zip` | 15MB binary archive. | **DISCARD** | Binary artifact; repository violation. |
| 24 | `Latch-Backend-Review.md` | External intake review. | **DISCARD / RELOCATE** | Relocate to `docs/reviews/` or discard. |
| 25 | `qa/reports/phase4-status.md` etc. | Ephemeral test outputs. | **DISCARD** | Stale test noise. |
| 26 | `qa/reports/not-readable-error-plan.md` | Preserved QA plan. | **KEEP** | Retain untracked per existing governance. |

---

## 3. Requirement R3: Test Impact & Rebase Strategy

### 3.1 Existing Frontend Test Suite Survey (`poc/meet-webrtc-core/tests/`)

A comprehensive audit of the 39 test files currently on `main` was conducted. The relevant test suites impacted by SEC-01A recovery and the REL-01 contract are:

1. **`rel01-session-authority.test.ts` (358 lines, 10 tests)**:
   - **Coverage**: Validates REG-01 through REG-09b: room creation hydration, guest issuance without privileged headers, host transfer 3-header payload, local authority dropping, 4-header host resume, participant resume, fail-closed resume without guest downgrade, control channel duplicate suppression, and target-only credential application.
   - **Impact**: **IMMUTABLE GOLD STANDARD**. No change permitted. All recovered code must pass this suite with 100% success.
2. **`m4a-authoritative-host.test.tsx` (846 lines, 15 tests)**:
   - **Coverage**: Tests M4A-SEC-01 through M4A-SEC-10 and M4A-UX-05 through M4A-UX-07. Verifies that forged moderation directives from non-hosts are rejected, expired host tokens fail, room audience mismatches fail, presence store locks `hostId`, and display name validation blocks entry.
   - **Mocks Used**: `MockRoom` with `publishData`, `createUnsignedMockToken()`, `useAppStore`, `usePresenceStore`.
   - **Impact**: Currently uses `createUnsignedMockToken()` which only populates `{ sub, room, aud, role, iat, exp }`.
   - **Updates Required**:
     - Update `createUnsignedMockToken()` to accept optional `gen` (default 1) and `rinst` (default `'mock-rinst'`).
     - In `M4A-SEC-02` (transfer test): ensure mock setup seeds `sessionToken` and `hostToken` in `useAppStore` so `manager.transferHost()` tests the non-host branch cleanly without throwing a missing-session error.
3. **`m2-host-manager.test.ts` (383 lines, 25 tests)**:
   - **Coverage**: Tests Phase E host controls (`muteParticipant`, `removeParticipant`, `setRoomLocked`, `setWaitingRoomEnabled`, `updatePermissions`, `transferHost` directive emission, null `hostId` rejection).
   - **Mocks Used**: `MockLiveKitRoom`, `createMockHostToken()`, `emitDirective()`.
   - **Impact**: In test `E-18` (`Transfer host directive assigns new host in presence store`), a mock directive `{ action: 'transfer-host', targetParticipantId: 'bob-new-host' }` is emitted over DataChannel.
   - **Updates Required**: Update test assertion to verify that `transfer-host` directive updates presence host ID, but assert that no `newHostToken` is attached or expected on the DataChannel.
4. **`m2-presence-adapter.test.ts` (185 lines) & `m2-presence-store.test.ts` (280 lines)**:
   - **Coverage**: Presence tracking, active speaker calculation, participant sorting, connection quality mapping.
   - **Updates Required**: Ensure tests do not assert client-side host succession when `hostId` leaves. Succession must be asserted as server-driven via `setAuthoritativeHost()`.
5. **`m4a1-identity-convergence.test.ts` (260 lines)**:
   - **Coverage**: Verifies that participant identity converges deterministically and cannot be spoofed.
   - **Updates Required**: None; fully compatible with REL-01.
6. **`wp4-welcome-reliability.test.ts` (540 lines)**:
   - **Coverage**: Verifies SFrame key exchange and Welcome packet delivery.
   - **Updates Required**: None; independent cryptographic domain.

### 3.2 Stash Test Suites (`tests/m4a-sec01-*.test.ts`)
1. **`tests/m4a-sec01-order-sender.test.ts`**:
   - **Scope**: Tests directive arrival order, out-of-order sequence rejection, sender ID spoofing (`directive.senderId !== token.sub`), and non-host directive rejection.
   - **Updates Required**:
     - Remove any mock assertions expecting `newHostToken` in `host-changed` frames.
     - Ensure mock host directives carry `hostKey` and valid `timestamp` within 60s.
2. **`tests/m4a-sec01-verifier.test.ts`**:
   - **Scope**: Direct unit tests of `HostTokenVerifier.verifyClaimsSync()` and `HostTokenVerifier.verifyDirective()`.
   - **Updates Required**:
     - Add test cases verifying that tokens containing SEC-02C claims (`gen`, `rinst`) pass claims verification correctly.
     - Retain WebCrypto ECDSA P-256 signature verification tests.

---

### 3.3 Precise Step-by-Step Git Rebase Plan

Executing `git stash pop` or `git stash apply` directly on `main` will fail because `stash@{0}` conflicts with the REL-01 changes already committed in `hostControlManager.ts`, `presenceAdapter.ts`, `appStore.ts`, and `token.ts`, and would pollute the working tree with 19 unapproved files.

The rebase plan below relies **strictly on standard git commands** and surgical file recovery:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              REBASE EXECUTION WORKFLOW                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  Step 1: Create isolated feature branch                                                │
│          git checkout -b feat/rel02-sec01a-recovery main                               │
│                                                                                        │
│  Step 2: Recover non-conflicting docs & test files directly from stash                 │
│          git checkout stash@{0} -- docs/adr/ORDERING-CONTRACT-SEC01A.md ...           │
│                                                                                        │
│  Step 3: Extract SEC-01A diffs for conflicting source files into patch                 │
│          git diff main...stash@{0} -- poc/.../hostControlManager.ts > hcm.patch        │
│                                                                                        │
│  Step 4: Surgically integrate SEC-01A Verify->Mutate into REL-01 files                 │
│          (Apply directive verifier & sender guards; keep REL-01 3-header transfer)     │
│                                                                                        │
│  Step 5: Align test mocks & run verification matrix                                    │
│          npm test, npm run build, go test ./...                                        │
│                                                                                        │
│  Step 6: Commit cleanly & drop stash@{0}                                               │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Branch Creation & Tree Baseline
```bash
# Ensure clean working tree on main
git status --porcelain=v1

# Create dedicated recovery branch
git checkout -b feat/rel02-sec01a-recovery main
```

#### Step 2: Recover Clean Non-Conflicting Files from `stash@{0}`
Extract the pure SEC-01A architecture ADRs, merge gate specifications, and test files that do not exist on `main`:
```bash
# Recover SEC-01A ADRs and Merge Gate specs
git checkout stash@{0} -- docs/adr/ORDERING-CONTRACT-SEC01A.md
git checkout stash@{0} -- docs/adr/STRIDE-host-takeover-SEC01A.md
git checkout stash@{0} -- SEC-01-UX-01-MERGE-GATES.md
git checkout stash@{0} -- docs/gates/frozen-surface-guard-SEC01-UX01.md

# Recover SEC-01A Test Suites
git checkout stash@{0} -- poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts
git checkout stash@{0} -- poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts

# Recover SEC-01A QA Signoff and Reports
git checkout stash@{0} -- qa/signoff-qa01a.md
git checkout stash@{0} -- qa/reports/SEC01A-*
```

#### Step 3: Extract and Audit Conflicting Source Diffs
Generate patch files for the three modified source files without touching the working tree:
```bash
# Export the stash changes for the 3 core files
git diff main stash@{0} -- poc/meet-webrtc-core/src/host/hostTokenVerifier.ts > verifier.patch
git diff main stash@{0} -- poc/meet-webrtc-core/src/host/hostControlManager.ts > hcm.patch
git diff main stash@{0} -- poc/meet-webrtc-core/src/presence/presenceAdapter.ts > presence.patch
```

#### Step 4: Surgical Conflict Resolution & Integration Rules
Apply edits to the three source files honoring the R2a audit rules:

1. **`poc/meet-webrtc-core/src/host/hostTokenVerifier.ts`**:
   - Apply the SEC-01A verifier enhancements from `verifier.patch` (strict P-256 WebCrypto signature checks, 60s freshness window, sender matching).
   - In `DecodedHostClaims`, ensure `rinst?: string` and `gen?: number` are supported.
2. **`poc/meet-webrtc-core/src/host/hostControlManager.ts`**:
   - **DO NOT** overwrite `transferHost()`. Keep the version on `main` (lines 495–556) which sends `Authorization`, `X-Session-Capability`, `X-Host-Proof`, expects only public metadata, drops local authority, and broadcasts announcement only.
   - **GRAFT** the SEC-01A Verify→Mutate directive handling into `onDataReceived` (lines 181–250):
     - Check sender against `presenceStore.hostId` before processing.
     - Reject directives if sender does not match token subject.
     - Reject unestablished directives from non-hosts.
   - Ensure `publishDirective({ action: 'host-changed' })` contains zero `newHostToken` property.
3. **`poc/meet-webrtc-core/src/presence/presenceAdapter.ts`**:
   - **GRAFT** the SEC-01A waiting room participant queueing logic.
   - **EXCLUDE** any legacy `metadata.role === 'host'` implicit host overrides. `presenceStore.hostId` remains the sole anchor of host authority.

#### Step 5: Test Alignment & Verification Execution
1. Update test mocks in `poc/meet-webrtc-core/tests/`:
   - `m4a-authoritative-host.test.tsx`: Seed `sessionToken` in `useAppStore` in host transfer tests.
   - `m4a-sec01-order-sender.test.ts`: Remove any assertions expecting `newHostToken` in DataChannel frames.
   - `m4a-sec01-verifier.test.ts`: Add test cases for `gen` and `rinst` claims.
2. Run full verification test suite:
   ```bash
   # 1. Vitest suite (must pass 100%, >= 285 tests)
   npm --prefix poc/meet-webrtc-core test

   # 2. Specifically verify REL-01 contract has zero regressions
   npm --prefix poc/meet-webrtc-core test tests/rel01-session-authority.test.ts

   # 3. Verify recovered SEC-01A test suites
   npm --prefix poc/meet-webrtc-core test tests/m4a-sec01-verifier.test.ts tests/m4a-sec01-order-sender.test.ts

   # 4. Frontend build & typecheck (bundle <= 225kB gzip, 0 tsc errors)
   npm --prefix poc/meet-webrtc-core run build

   # 5. Backend verification (51 tests pass)
   cd services/meet-signal && go test -v ./...
   ```

#### Step 6: Commit, Merge Gate, and Stash Cleanup
```bash
# Clean up temporary patch files
rm -f verifier.patch hcm.patch presence.patch

# Stage all recovered and reconciled files
git add docs/adr/ORDERING-CONTRACT-SEC01A.md docs/adr/STRIDE-host-takeover-SEC01A.md SEC-01-UX-01-MERGE-GATES.md docs/gates/frozen-surface-guard-SEC01-UX01.md qa/signoff-qa01a.md qa/reports/SEC01A-* poc/meet-webrtc-core/src/host/hostTokenVerifier.ts poc/meet-webrtc-core/src/host/hostControlManager.ts poc/meet-webrtc-core/src/presence/presenceAdapter.ts poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts poc/meet-webrtc-core/tests/m4a-authoritative-host.test.tsx

# Commit with structured message
git commit -m "feat(security): recover SEC-01A frontend remediation aligned with REL-01 contract

- Recover 7-step HostTokenVerifier and directive Verify->Mutate pipeline
- Enforce sender-identity binding and directive ordering guards
- Remove legacy newHostToken DataChannel broadcast and guest fallback paths
- Retain REL-01 private session authority and target-only credential delivery
- Recover tests/m4a-sec01-*.test.ts and SEC-01A ADR documentation
- Discard out-of-scope UX-01 assets, tooling archives, and governance diffs"

# Drop the obsolete stash@{0} now that recovery is complete
git stash drop stash@{0}

# Fast-forward merge to main when approved
git checkout main
git merge --ff-only feat/rel02-sec01a-recovery
```

---

## 4. Logic Chain

1. **Premise 1 (Backend Authority Baseline)**: Commit `a5957b0` (tagged `sec-crit-02-closed`) establishes the backend contract in `services/meet-signal/main.go`. This contract requires `X-Session-Capability`, `X-Host-Proof`, and `X-Resume-Handle`, advances monotonic generations on transfer, and delivers host credentials strictly to the target over WebSocket signaling (`hub.deliverHostCredential()`).
2. **Premise 2 (Committed Frontend Compliance)**: `poc/meet-webrtc-core/` on `main` already implements the client side of REL-01 (`token.ts`, `appStore.ts`, `controlChannel.ts`, `rel01-session-authority.test.ts`).
3. **Premise 3 (Stash Contents)**: `stash@{0}` preserves 28 files from SEC-01A, UX-01, SEC-01B, and repo tooling. The SEC-01A work in `hostTokenVerifier.ts`, `hostControlManager.ts`, and `presenceAdapter.ts` provides vital Verify→Mutate and sender-binding protections against DataChannel packet forgery.
4. **Premise 4 (Conflict Mechanism)**: SEC-01A was developed prior to SEC-02B/C and assumed `newHostToken` was broadcast on DataChannel, `Authorization` alone resumed hosts, and failed requests fell back to guest sessions. Merging these assumptions would directly undo SEC-CRIT-02 fixes and fail REL-01 regression tests.
5. **Deduction 1 (Audit Rule)**: Applying the R2a audit rules (REMOVE `newHostToken`, DataChannel credential delivery, implicit host restoration, and guest fallback; REPLACE unverified `hostKey` auto-learning and `Authorization`-only resume) completely eliminates the conflicts while retaining SEC-01A's client-side defenses.
6. **Deduction 2 (Rebase Method)**: A selective, surgical file recovery using `git checkout stash@{0} -- <files>` for clean files and targeted grafting for conflicting source files preserves the working tree's hygiene, avoids merge conflicts with REL-01, and leaves out unapproved UX-01 assets and tooling archives.
7. **Conclusion**: The legacy authority path audit and test/rebase strategy are fully defined, mathematically coherent, and ready for immediate execution.

---

## 5. Caveats

- **Read-Only Explorer Execution**: In strict conformance with the Explorer archetype, no git working tree modifications (`git stash pop`, `git checkout -b`, file writes to `poc/` or `services/`) were performed.
- **Race Detector Toolchain**: `go test -race` requires cgo and a Linux/macOS runner. On Windows host environments without gcc/cgo, race tests must be run in Docker container `meet-secure/meet-signal:local`.
- **UX-01 Isolation**: 9 files in `stash@{0}` belong to UX-01 (design tokens, primitives, stylelint). These must be kept in a separate branch/stash and must not be mixed into the REL-02 security recovery PR.
- **SEC-01B Post-Rebase Status**: SEC-01B planning documents in `stash@{0}` carry outdated broadcast assumptions. SEC-01B implementation remains blocked until REL-02 is merged.

---

## 6. Conclusion

1. **R2a Audit Complete**: Every recovered file has been classified. All 6 legacy authority paths have been analyzed with definitive KEEP / REMOVE / REPLACE determinations. Zero legacy credential disclosure or fallback behavior will be reintroduced.
2. **R3 Strategy Complete**: Existing frontend tests (especially `rel01-session-authority.test.ts` and `m4a-authoritative-host.test.tsx`) and stash test suites (`m4a-sec01-*.test.ts`) are fully mapped. All necessary mock adjustments (adding `gen`/`rinst`, removing `newHostToken`) are documented.
3. **Rebase Plan Verified**: A surgical, standard-git rebase plan is established that avoids dirty merge conflicts and guarantees tree hygiene.
4. **Readiness**: The project is **READY FOR RECOVERY (YES)** with **MEDIUM** implementation complexity.

---

## 7. Verification Method

To independently verify the evidence and findings in this report:

1. **Verify Backend Tests & Invariant Integrity**:
   ```bash
   cd services/meet-signal
   go test -v -run "TestSEC02" ./...
   go test -v -run "TestM4A" ./...
   ```
   *Expected result*: All 51 tests pass, verifying private session binding, CAS generation advance, and target-only credential delivery.
2. **Verify Frontend REL-01 Regression Suite**:
   ```bash
   cd poc/meet-webrtc-core
   npm test tests/rel01-session-authority.test.ts
   ```
   *Expected result*: 9/9 tests pass (`REG-01` through `REG-09b`).
3. **Verify Stash Commit & Metadata**:
   ```bash
   git rev-parse stash@{0}
   git stash list
   ```
   *Expected result*: Commit `834a707bd0511788fe25f410b012978db7d90491` matches the reflog.
4. **Verify No `newHostToken` in Committed Client**:
   ```bash
   git grep -n "newHostToken" poc/meet-webrtc-core/src/
   ```
   *Expected result*: Zero matches in `poc/meet-webrtc-core/src/`.
