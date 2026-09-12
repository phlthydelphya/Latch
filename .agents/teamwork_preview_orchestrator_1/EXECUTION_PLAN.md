# Execution Plan: SEC-01A Stash Recovery, Rebase, and Integration with REL-01

**Milestone Target**: REL-02 / M4A Remediation Recovery  
**Authority Baseline**: `services/meet-signal/main.go` (commit `a5957b0`, tag `sec-crit-02-closed` on `main`)  
**Stash Reference**: `stash@{0}` (`834a707bd0511788fe25f410b012978db7d90491`: *"On main: non-SEC-CRIT-02 work preserved at SEC-CRIT-02 closure (SEC-01A/UX-01/SEC-01B/AGENTS/tooling)"*)  
**Governance Standard**: `AGENTS.md`, ADR-006, ADR-007, ADR-008, ADR-009  

---

## Section 1: Stash Inventory

`stash@{0}` contains 28 distinct files and paths spanning 7 functional categories, preserved at the closure of SEC-CRIT-02 to isolate uncommitted workstreams from the server-authoritative closure commit:

| # | File Path | Category | Type / Size | Status in Stash | Description |
|---|---|---|---|---|---|
| 1 | `poc/meet-webrtc-core/src/host/hostControlManager.ts` | Frontend Core | Modified (~650 lines) | Tracked | SEC-01A Verify→Mutate directive guard, ordering checks, and transport-bound sender identity. |
| 2 | `poc/meet-webrtc-core/src/host/hostTokenVerifier.ts` | Frontend Core | Modified (~220 lines) | Tracked | 7-step claims verification pipeline and WebCrypto ECDSA P-256 signature verification. |
| 3 | `poc/meet-webrtc-core/src/presence/presenceAdapter.ts` | Frontend Core | Modified (~450 lines) | Tracked | Server-authoritative host binding; removes client-metadata role spoofing; manages waiting room queue. |
| 4 | `poc/meet-webrtc-core/src/components/ControlBar.tsx` | Frontend UI | Modified (~340 lines) | Tracked | Host moderation action triggers and leave dialog handling (mixed with UX-01 token edits). |
| 5 | `poc/meet-webrtc-core/src/main.tsx` | Frontend App | Modified (~30 lines) | Tracked | Test export hooks and design system root imports (mixed with UX-01 token imports). |
| 6 | `poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts` | Tests & Verification | New (~240 lines) | Untracked | SEC-01A tests for directive ordering, monotonic sequence, and transport-sender validation. |
| 7 | `poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts` | Tests & Verification | New (~280 lines) | Untracked | Comprehensive test matrix for `HostTokenVerifier` V1–V5 pipeline and WebCrypto verification. |
| 8 | `qa/reports/SEC01A-*` (multiple evidence files) | QA Evidence | New (~400 lines) | Untracked | Test execution logs, tamper-test records, and execution outputs for SEC-01A gate review. |
| 9 | `qa/signoff-qa01a.md` | QA Evidence | New (~60 lines) | Untracked | Formal QA signoff document for SEC-01A. |
| 10 | `docs/adr/ORDERING-CONTRACT-SEC01A.md` | Governance & Architecture | New (~150 lines) | Untracked | Architecture specification for moderation directive ordering, monotonic counters, and 60s window. |
| 11 | `docs/adr/STRIDE-host-takeover-SEC01A.md` | Threat Modeling | New (~180 lines) | Untracked | STRIDE threat model analyzing host takeover vectors and frontend validation guards. |
| 12 | `SEC-01-UX-01-MERGE-GATES.md` (root) | Governance & Architecture | New (~95 lines) | Untracked | Gate specification establishing boundary separation between SEC-01A security fix and UX-01 redesign. |
| 13 | `docs/gates/frozen-surface-guard-SEC01-UX01.md` | Governance & Architecture | New (~110 lines) | Untracked | Surface freeze checklist ensuring UX files are segregated from security work. |
| 14 | `poc/meet-webrtc-core/src/components/primitives/` | UX-01 Design System | New (~8 files / 500 lines) | Untracked | Incomplete UI design system primitives (Button, Input, Modal, etc.). |
| 15 | `poc/meet-webrtc-core/src/styles/tokens.ts` | UX-01 Design System | New (~120 lines) | Untracked | Incomplete TypeScript design tokens for UX-01. |
| 16 | `poc/meet-webrtc-core/src/styles/tokens.css.ts` | UX-01 Design System | New (~140 lines) | Untracked | Incomplete CSS variables / vanilla-extract style tokens. |
| 17 | `poc/meet-webrtc-core/scripts/token-audit.ts` | Tooling & Scripts | New (~90 lines) | Untracked | Build/lint script for auditing token usage across components. |
| 18 | `poc/meet-webrtc-core/.stylelintrc.json` | Tooling & Scripts | New (~40 lines) | Untracked | Stylelint configuration file for CSS/token linting. |
| 19 | `poc/meet-webrtc-core/package.json` | Dependency Manifest | Modified (~75 lines) | Tracked | Modified to add stylelint and design token tooling dependencies. |
| 20 | `poc/meet-webrtc-core/package-lock.json` | Dependency Lockfile | Modified (~12,000 lines) | Tracked | Lockfile reflecting added stylelint and design token dependencies. |
| 21 | `docs/ux/UX-F1-*.md` (multiple files) | UX-01 Specifications | New (~350 lines) | Untracked | Specifications for UX-01 features (layout, typography, controls). |
| 22 | `docs/ux/interaction-spec.md` | UX-01 Specifications | New (~220 lines) | Untracked | Interaction specifications for UI states and focus management. |
| 23 | `docs/plans/SEC-01B-controlled-kickoff-packaging.md` | Planning | New (~180 lines) | Untracked | Early planning doc for SEC-01B (contains obsolete token distribution assumptions). |
| 24 | `AGENTS.md` | Governance Metadata | Modified (~215 lines) | Tracked | Contained premature "M4A CLOSED & ACCEPTED" edit violating ADR-007 §2. |
| 25 | `check_registries.py` | Repo Root Tooling | New (~65 lines) | Untracked | Ad-hoc Python script for checking package registries. |
| 26 | `meet-secure-backend-dev.zip` | Repo Root Archive | New (Binary, ~5 MB) | Untracked | Binary archive of dev backend; violates repository cleanliness rules. |
| 27 | `Latch-Backend-Review.md` | Repo Root Intake | New (~110 lines) | Untracked | Unreviewed external intake notes placed at root. |
| 28 | `qa/reports/audit-log-sample-SEC01A.json` (+ noise) | Ephemeral QA Noise | New (~150 lines) | Untracked | Ephemeral JSON logs and transient test runner artifacts (`playwright-results.json`). |

---

## Section 2: Files to Recover

Only files strictly required for the **SEC-01A Frontend Moderation Remediation** that satisfy REL-02 without conflicting with REL-01 or modifying the authoritative backend contract shall be recovered:

1. **`poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts`** (Recover Entire File):
   - Direct verification for M4A-SEC-01: transport sender identity validation, rejection of directives where payload `senderId` mismatches transport sender, and monotonic directive sequence enforcement.
2. **`poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts`** (Recover Entire File):
   - Direct verification for `HostTokenVerifier`: V1–V5 claims validation, audience matching, expiration rejection, clock skew window ($\le 60\text{s}$), and WebCrypto ECDSA P-256 signature verification.
3. **`docs/adr/ORDERING-CONTRACT-SEC01A.md`** (Recover Entire File):
   - Authoritative architecture decision record for directive sequencing and replay window limits on the LiveKit DataChannel.
4. **`docs/adr/STRIDE-host-takeover-SEC01A.md`** (Recover Entire File):
   - Authoritative STRIDE threat model detailing host takeover attack surfaces and frontend verification defenses.
5. **`SEC-01-UX-01-MERGE-GATES.md`** (Recover Entire File):
   - Merge gate specification enforcing the boundary between the SEC-01A security remediation and UX-01 UI redesign.
6. **`docs/gates/frozen-surface-guard-SEC01-UX01.md`** (Recover Entire File):
   - Surface freeze guard verifying that UX-01 components remain isolated during security remediation.
7. **`qa/reports/SEC01A-*` & `qa/signoff-qa01a.md`** (Recover All Files):
   - Formal test logs, execution evidence, and QA sign-off artifact required for the REL-02 milestone audit trail.
8. **Selective Code Blocks in `poc/meet-webrtc-core/src/host/hostControlManager.ts`**:
   - **Transport Sender Identity Binding**: In `onDataReceived`, enforce `const senderId = participant?.identity;` and drop any directive missing transport-verified sender identity.
   - **Unsigned Directive Rejection**: Disallow unsigned moderation directives (`mute-participant`, `remove-participant`, `lock-room`, `set-waiting-room`) in production mode; all directives must carry a verifiable `hostToken`.
   - **Monotonic Directive Ordering**: Retain sequence validation to prevent replayed directives within the 60s freshness window.
   - *(Note: Keep HEAD's `transferHost()` method with 3-header private session dispatch; do NOT overwrite with stash).*
9. **Selective Code Blocks in `poc/meet-webrtc-core/src/host/hostTokenVerifier.ts`**:
   - 7-step claims pipeline (structure, role, sub, aud, exp, freshness $\le 60\text{s}$, ECDSA P-256 WebCrypto signature).
   - Support optional `gen` (authority generation) and `rinst` (room instance ID) claims in `DecodedHostClaims`.
10. **Selective Code Blocks in `poc/meet-webrtc-core/src/presence/presenceAdapter.ts`**:
    - Purge client-side metadata role inspection (`participant.metadata.role === 'host'`) in `attach()` and `onParticipantConnected()`. Authority is anchored exclusively in `presenceStore.hostId`.
    - Recover waiting room queue synchronization and unadmitted peer isolation logic.

---

## Section 3: Files to Discard

The following 18 files/paths in `stash@{0}` must be **DISCARDED** from the SEC-01A recovery to protect repository hygiene, prevent dependency bloat, and uphold governance invariants:

| # | File Path / Pattern | Action | Strict Justification |
|---|---|---|---|
| 1 | `docs/ux/` (all files: `UX-F1-*.md`, `interaction-spec.md`) | DISCARD (DEFER) | Incomplete UX-01 design specs. Bundling unreviewed UI redesign specs into a security recovery violates single-concern governance and frozen-surface guards. Preserved in git stash object for REL-10. |
| 2 | `poc/meet-webrtc-core/src/components/primitives/` | DISCARD (DEFER) | UX-01 UI component library. Unused by current application; introduces untested surface area and bundle size increase. |
| 3 | `poc/meet-webrtc-core/src/styles/tokens.ts` | DISCARD (DEFER) | UX-01 design tokens. Out-of-scope for security recovery. |
| 4 | `poc/meet-webrtc-core/src/styles/tokens.css.ts` | DISCARD (DEFER) | UX-01 CSS variables. Out-of-scope for security recovery. |
| 5 | `poc/meet-webrtc-core/scripts/token-audit.ts` | DISCARD (DEFER) | UX-01 linting script. Not required for core WebRTC, signaling, or host control. |
| 6 | `poc/meet-webrtc-core/.stylelintrc.json` | DISCARD | Stylelint configuration file for UX-01; introduces unnecessary lint dependencies. |
| 7 | `poc/meet-webrtc-core/package.json` | DISCARD STASH DIFF | Stash added `@stylelint/*` and UI packages. Current HEAD `package.json` is clean, pinned, and audited. Retain HEAD. |
| 8 | `poc/meet-webrtc-core/package-lock.json` | DISCARD STASH DIFF | Retain HEAD version to prevent dependency drift or lockfile conflicts. |
| 9 | `docs/plans/SEC-01B-controlled-kickoff-packaging.md` | DISCARD (DEFER) | Obsolete planning document. Assumed legacy broadcast token distribution (§B3.1), which was superseded by SEC-CRIT-02 / ADR-008. |
| 10 | `AGENTS.md` | DISCARD STASH DIFF | Stash contained an unauthorized edit marking M4A as "CLOSED & ACCEPTED". This violates ADR-007 §2 governance. Retain HEAD. |
| 11 | `check_registries.py` | DISCARD | Ad-hoc Python script placed at repo root; violates repo layout and hygiene standards. |
| 12 | `meet-secure-backend-dev.zip` | DISCARD | 5MB binary archive at repo root. Violates strict Git hygiene rules forbidding binary zip archives. |
| 13 | `Latch-Backend-Review.md` | DISCARD | Uncurated external review document placed at repo root; intake artifacts must not sit at repo root. |
| 14 | `qa/reports/phase4-status.md` | DISCARD | Ephemeral, pre-existing transient QA tracking notes. |
| 15 | `qa/reports/q7-q8-q10-validation.md` | DISCARD | Transient scratch test evidence. |
| 16 | `qa/reports/playwright-results.json` | DISCARD | Transient test execution artifact; should be gitignored. |
| 17 | `qa/reports/audit-log-sample-SEC01A.json` | DISCARD | Transient JSON log sample; superseded by formal markdown report. |
| 18 | `poc/meet-webrtc-core/src/components/ControlBar.tsx` (stash version) | DISCARD STASH OVERWRITE | HEAD `ControlBar.tsx` is already fully wired with M4A leave confirmation and host checks. Discard stash version to prevent UX-01 token changes from leaking into UI. |
| 19 | `poc/meet-webrtc-core/src/main.tsx` (stash version) | DISCARD STASH OVERWRITE | HEAD `main.tsx` is clean (26 lines). Discard stash version to prevent UX-01 token/style imports from leaking into entry point. |

---

## Section 4: Conflict Analysis

Directly applying `stash@{0}` via `git stash pop` or `git stash apply` on top of current `main` (`a5957b0`) causes severe content conflicts, security regressions, and architectural incompatibility with REL-01:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CONFLICT ANALYSIS MATRIX                                 │
├────────────────────────────┬─────────────────────────────┬─────────────────────────────┤
│ Domain                     │ SEC-01A Stash Assumption    │ REL-01 Active Contract      │
├────────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Credential Distribution    │ Broadcast over DataChannel  │ Target-only via WSS Frame   │
│ Transfer HTTP Response     │ Returns body.newHostToken   │ Returns public metadata only│
│ Host Identity Proof        │ Authorization: Bearer <jwt> │ X-Session-Capability (256b) │
│ Host Resume Contract       │ 1 Header (Authorization)    │ 4 Headers (Atomic consume)  │
│ Scope of Invalidation      │ Timestamp expiration (exp)  │ Generation (gen) & Room (rinst) │
│ Failure Semantics          │ Fallback to guest issuance  │ Fail closed (401/403/503)   │
└────────────────────────────┴─────────────────────────────┴─────────────────────────────┘
```

### Detailed Interaction Analysis:

1. **`sessionToken` vs. ES256 Host Token**:
   - *Conflict*: In SEC-01A, possessing an ES256 host token was treated as complete proof of host identity. Under REL-01 (SEC-02B), an ES256 host token is solely an operation authorization; caller identity requires presenting the unguessable 256-bit `sessionToken` in the `X-Session-Capability` header.
   - *Resolution*: Stashed client code must never assume host token possession suffices to invoke backend authority endpoints. All privileged calls (`transferHost`, resume) must transmit `X-Session-Capability`.
2. **`resumeHandle` vs. Timestamp Expiry**:
   - *Conflict*: SEC-01A assumed a reconnecting host could resume simply by presenting its unexpired host token in `Authorization`. Under REL-01 (SEC-02C), host resumption requires atomically consuming a single-use `resumeHandle` (`X-Resume-Handle`). Replays or stale handles return 401 `resume_handle_invalid`.
   - *Resolution*: Retain `src/auth/token.ts` on HEAD which manages `resumeHandle` storage in `appStore` and injects `X-Resume-Handle` during reconnection.
3. **`roomInstanceId` Scoping**:
   - *Conflict*: SEC-01A scoped tokens only by `aud: roomId`. If a room was closed and immediately recreated under the same name, former host tokens could be replayed. Under REL-01, tokens and sessions are cryptographically bound to an unguessable 32-byte `roomInstanceId` (`rinst`). Old incarnation tokens fail with 403 `identity_mismatch`.
   - *Resolution*: `HostTokenVerifier` must accept `rinst` claims, and client session hydration must track `roomInstanceId`.
4. **`host-credential` Delivery Channel**:
   - *Conflict*: SEC-01A expected `POST /room/transfer-host` to return `newHostToken` in the HTTP response and broadcasted it over the DataChannel in `host-changed`. Under REL-01 (SEC-02D), the backend returns only public metadata to the caller and delivers the target's credentials exclusively to the target participant's WebSocket connection (`type: "host-credential"`).
   - *Resolution*: Discard stashed `transferHost()` method in `hostControlManager.ts`. Retain HEAD's implementation which drops local authority, consumes public metadata, and publishes an announcement-only directive without credentials. Ingestion is handled by `ControlChannelManager` on HEAD.

---

## Section 5: SEC-01A Controls Still Required

Despite the backend contract evolution, the client-side security controls introduced by SEC-01A are **unconditionally required** and must be preserved during recovery:

1. **Verify-Then-Mutate Moderation Pipeline (`HostTokenVerifier`)**:
   - Because the LiveKit SFU forwards DataChannel packets blindly without inspecting application payloads, any participant can craft and inject arbitrary DataChannel packets.
   - The client MUST verify incoming moderation directives (`mute-participant`, `remove-participant`, `lock-room`, `set-waiting-room`, `spotlight-participant`, `update-permissions`) through the 7-step verification pipeline before updating local state or invoking SDK actions:
     1. Structure & field presence validation.
     2. Role check (`claims.role === 'host'`).
     3. Subject identity matching against transport sender (`claims.sub === senderId`).
     4. Room audience matching (`claims.aud === activeRoomId`).
     5. Token expiration check (`now < claims.exp`).
     6. Timing freshness check ($|now - directive.timestamp| \le 60\text{s}$).
     7. Cryptographic ECDSA P-256 WebCrypto signature validation using `hostKey`.
2. **Transport Sender Identity Enforcement**:
   - Directives MUST bind to `participant.identity` established at the WebRTC transport layer.
   - Any directive where `msg.senderId !== participant.identity` or where `participant.identity` is absent MUST be dropped and logged as a spoofing anomaly.
3. **Established Host Authorization Guard**:
   - When an authoritative host is established (`presenceStore.hostId !== null`), directives sent by any other participant ID MUST be rejected, regardless of payload contents.
4. **Directive Replay & Sequence Protection**:
   - Directives must carry a unique `nonce` and monotonic sequence number to prevent replay attacks within the 60s freshness skew window.
5. **Presence Authority Lock**:
   - `presenceStore` locks `activeHostId = state.hostId` during `setLocalParticipant` and `upsertParticipant`. Incoming peer join events cannot displace or clear the authoritative host.
6. **Default Waiting Room Gate**:
   - Guests land in a lobby (`isWaitingInLobby: true`) and cannot publish media tracks until explicitly admitted via an authenticated host directive.

---

## Section 6: Legacy Authority Path Audit

Every recovered SEC-01A file has been audited against the six legacy authority patterns. No recovered code may reintroduce legacy credential-transfer behavior conflicting with REL-01, SEC-02B, or SEC-02C:

| Legacy Path Pattern | File & Context | Classification | Detailed Justification & Integration Rule |
|---|---|---|---|
| **1. `newHostToken` in HTTP Response** | `hostControlManager.ts` (`transferHost()`) | **REMOVE** | In legacy M4A, `POST /room/transfer-host` returned `newHostToken` in response body. In REL-01, backend returns only public metadata (`{ roomId, hostId, hostKey, generation, delivered }`). Stash code expecting `body.newHostToken` must be removed. |
| **2. `newHostToken` in DataChannel** | `hostControlManager.ts` (`publishDirective`, `onDataReceived`) | **REMOVE** | Broadcasting host credentials room-wide over DataChannel was the root vulnerability of SEC-CRIT-02. Must be stripped from directive payloads and interfaces. DataChannel carries announcement only (`action: 'host-changed'`). |
| **3. `hostKey` Transfer Coupling** | `hostControlManager.ts` & `presenceAdapter.ts` | **REPLACE** | Public `hostKey` distribution in announcements is permissible, but unauthenticated auto-learning (`if (msg.hostKey && !this.hostPublicKey) this.hostPublicKey = msg.hostKey`) is **REPLACED** with authoritative binding: `hostKey` is only adopted from bootstrap responses, server transfer metadata, or the target's private `host-credential` frame. |
| **4. `Authorization`-only Host Resume** | `src/auth/token.ts` & `reconnect/manager.ts` | **REPLACE** | Presenting only `Authorization` to `/token` triggers resume path without host proof, resulting in 401 or participant downgrade under SEC-02B/C. **REPLACE** with 4-header payload (`Authorization`, `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle`). |
| **5. DataChannel Credential Delivery** | `hostControlManager.ts` (`onDataReceived`) | **REMOVE** | DataChannel must never accept or apply host credentials. All private credentials arrive via `ControlChannelManager` on WSS `/signal` (`type: "host-credential"` frame). |
| **6. Implicit Host Restoration** | `presenceStore.ts` & `presenceAdapter.ts` | **REMOVE** | Client heuristics nominating earliest-joined participant on host disconnect (`nextHostId = remaining[0]`) or inferring host from `metadata.role === 'host'` must be removed. Authority is strictly server-managed via `startHostGrace()` and monotonic generation increments. |
| **7. Guest Fallback Issuance** | `src/auth/token.ts` (`createRoom()`, `fetchToken()`) | **REMOVE** | Silent try/catch downgrades to anonymous guest tokens upon room creation or resume failure bypass admission control and violate REL-01 REG-01b/06. All failed calls must fail closed and re-throw. |

---

## Section 7: Test Updates Required

To validate the recovered SEC-01A controls alongside the active REL-01 contract, the following test updates and mock adjustments must be implemented:

### 1. Recovered SEC-01A Test Suites (`poc/meet-webrtc-core/tests/`)
- **`tests/m4a-sec01-order-sender.test.ts`**:
  - Update mock directive payloads to remove `newHostToken`.
  - Ensure mock directives include valid timestamps within the 60s freshness window and unique nonces.
  - Verify test assertions validate transport-sender identity matching (`senderId === participant.identity`).
- **`tests/m4a-sec01-verifier.test.ts`**:
  - Update token generation helpers to include optional SEC-02C claims (`gen: 1`, `rinst: 'mock-instance-id'`).
  - Retain full negative test matrix: malformed signature, bad key, expired token, clock skew $>60$s, audience mismatch.

### 2. Existing Frontend Test Suites
- **`tests/rel01-session-authority.test.ts`** (10 tests, REG-01 through REG-09b):
  - **IMMUTABLE GOLD STANDARD**: Must remain untouched and pass 100%. Validates session capability hydration, 3-header transfer, 4-header resume, fail-closed resume, duplicate suppression, and target-only credential delivery.
- **`tests/m4a-authoritative-host.test.tsx`** (15 tests):
  - Update `createUnsignedMockToken()` to include `gen: 1` and `rinst: 'mock-rinst'`.
  - In M4A-SEC-02 host transfer test: seed `sessionToken` and `hostToken` in `useAppStore` so `manager.transferHost()` tests the non-host branch cleanly without throwing a missing-session error.
- **`tests/m2-host-manager.test.ts`** (25 tests):
  - In test `E-18` (`Transfer host directive assigns new host in presence store`): update assertion to verify `transfer-host` directive updates presence host ID, and assert that zero `newHostToken` is attached or expected on the DataChannel.
- **`tests/m2-presence-store.test.ts` & `m2-presence-adapter.test.ts`**:
  - Verify tests do not assert client-side host succession when host disconnects. Succession must be asserted as server-driven via `setAuthoritativeHost()`.

### 3. Backend Verification Suites (`services/meet-signal/`)
- Run full Go test suite (`go test -v ./...`): 51 tests across `main_test.go`, `sec02a_containment_test.go`, `sec02b_identity_binding_test.go`, `sec02c_authority_generation_test.go`, and `sec02d_activation_test.go` must pass 100%.

---

## Section 8: Rebase Plan

Because `stash@{0}` conflicts with committed REL-01 changes and contains 18 unapproved files, `git stash pop` or `git stash apply` must **NEVER** be run. The recovery shall follow this surgical, step-by-step rebase plan using standard git commands:

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
│  Step 3: Extract SEC-01A diffs for conflicting source files into patch files           │
│          git diff main...stash@{0} -- poc/.../hostControlManager.ts > hcm.patch        │
│                                                                                        │
│  Step 4: Surgically integrate SEC-01A Verify->Mutate into REL-01 files                 │
│          (Apply directive verifier & sender guards; retain REL-01 3-header transfer)   │
│                                                                                        │
│  Step 5: Align test mocks & execute full verification matrix                           │
│          npm test, npm run build, go test ./...                                        │
│                                                                                        │
│  Step 6: Commit cleanly, drop stash@{0}, and merge to main                             │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Git Commands:

#### Step 1: Establish Clean Baseline (Stage 1: REL-01 Client Commit)

> ⚠️ **CRITICAL REBASE WARNING**: DO NOT run `git reset --hard` or `git clean -fd`! The active working tree on `main` contains the drafted, verified frontend REL-01 implementation (`token.ts`, `appStore.ts`, `controlChannel.ts`, `rel01-session-authority.test.ts`, etc.). Discarding the working tree would destroy the client-side session authority contract.

First, commit the verified REL-01 client implementation to establish the clean baseline:

```bash
# Verify working tree status (shows modified/untracked REL-01 files)
git status --porcelain=v1

# Stage all verified REL-01 client contract files
git add poc/meet-webrtc-core/src/auth/token.ts \
        poc/meet-webrtc-core/src/store/appStore.ts \
        poc/meet-webrtc-core/src/signaling/controlChannel.ts \
        poc/meet-webrtc-core/src/signaling/client.ts \
        poc/meet-webrtc-core/src/hooks/useWebRTC.ts \
        poc/meet-webrtc-core/src/types.ts \
        poc/meet-webrtc-core/src/host/types.ts \
        poc/meet-webrtc-core/tests/rel01-session-authority.test.ts \
        docs/gates/RELEASE-READINESS-REVIEW-2026-09-12.md

# Commit REL-01 baseline
git commit -m "feat(rel01): implement client private session authority contract

- Hydrate sessionToken, resumeHandle, and roomInstanceId into appStore
- Inject 4-header credentials on host resumption in fetchToken
- Connect ControlChannelManager for target-only host-credential ingestion
- Add comprehensive REG-01 through REG-09b session authority test suite"

# Verify working tree is now clean (excluding .agents metadata and ORIGINAL_REQUEST.md)
git status --porcelain=v1

# Create dedicated recovery branch for SEC-01A recovery
git checkout -b feat/rel02-sec01a-recovery main
```

#### Step 2: Recover Clean Non-Conflicting Files from `stash@{0}`
```bash
# Recover SEC-01A ADRs and Merge Gate specifications
git checkout stash@{0} -- docs/adr/ORDERING-CONTRACT-SEC01A.md
git checkout stash@{0} -- docs/adr/STRIDE-host-takeover-SEC01A.md
git checkout stash@{0} -- SEC-01-UX-01-MERGE-GATES.md
git checkout stash@{0} -- docs/gates/frozen-surface-guard-SEC01-UX01.md

# Recover SEC-01A Test Suites
git checkout stash@{0} -- poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts
git checkout stash@{0} -- poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts

# Recover SEC-01A QA Signoff and Reports (quoted pathspec for PowerShell safety)
git checkout stash@{0} -- qa/signoff-qa01a.md
git checkout stash@{0} -- 'qa/reports/SEC01A-*'
```

#### Step 3: Extract and Audit Conflicting Source Diffs from Stash Parent
```bash
# Export the clean stash changes against stash parent stash@{0}^1 (avoids post-stash commit noise)
git diff stash@{0}^1 stash@{0} -- poc/meet-webrtc-core/src/host/hostTokenVerifier.ts > verifier.patch
git diff stash@{0}^1 stash@{0} -- poc/meet-webrtc-core/src/host/hostControlManager.ts > hcm.patch
git diff stash@{0}^1 stash@{0} -- poc/meet-webrtc-core/src/presence/presenceAdapter.ts > presence.patch
```

#### Step 4: Surgical Conflict Resolution & Integration Rules
1. **`poc/meet-webrtc-core/src/host/hostTokenVerifier.ts`**:
   - Apply SEC-01A verifier enhancements (strict P-256 WebCrypto signature checks, 60s freshness window, sender matching).
   - In `DecodedHostClaims`, ensure `rinst?: string` and `gen?: number` are supported.
2. **`poc/meet-webrtc-core/src/host/hostControlManager.ts`**:
   - **DO NOT** overwrite `transferHost()`. Retain HEAD's version (lines 495–556) which sends `Authorization`, `X-Session-Capability`, `X-Host-Proof`, expects only public metadata, drops local authority, and broadcasts announcement only.
   - **GRAFT** SEC-01A Verify→Mutate directive handling into `onDataReceived` (lines 181–250):
     - Enforce `senderId = participant?.identity`.
     - Reject directives where `senderId !== token.sub`.
     - Reject directives from non-hosts when host is established.
     - Reject unsigned moderation directives in production.
   - Verify `publishDirective({ action: 'host-changed' })` contains zero `newHostToken`.
3. **`poc/meet-webrtc-core/src/presence/presenceAdapter.ts`**:
   - **GRAFT** SEC-01A waiting room participant queueing logic.
   - **REMOVE** all `metadata.role === 'host'` implicit host overrides. `presenceStore.hostId` remains the sole anchor of host authority.

#### Step 5: Test Alignment & Verification Matrix
1. Update mocks in `tests/m4a-authoritative-host.test.tsx`, `tests/m4a-sec01-order-sender.test.ts`, and `tests/m4a-sec01-verifier.test.ts` per Section 7.
2. Run test suites:
   ```bash
   # 1. Full frontend test suite (must pass 100%, >= 285 tests)
   npm --prefix poc/meet-webrtc-core test

   # 2. Specifically verify REL-01 contract has zero regressions
   npm --prefix poc/meet-webrtc-core test tests/rel01-session-authority.test.ts

   # 3. Verify recovered SEC-01A test suites
   npm --prefix poc/meet-webrtc-core test tests/m4a-sec01-verifier.test.ts tests/m4a-sec01-order-sender.test.ts

   # 4. Frontend build & bundle audit (bundle <= 225kB gzip, 0 tsc errors)
   npm --prefix poc/meet-webrtc-core run build

   # 5. Backend verification (51 tests pass)
   cd services/meet-signal && go test -v ./...
   ```

#### Step 6: Commit, Stash Cleanup, and Fast-Forward Merge
```bash
# Remove temporary patch files
rm -f verifier.patch hcm.patch presence.patch

# Stage all recovered and reconciled files (quoted pathspec for PowerShell safety)
git add docs/adr/ORDERING-CONTRACT-SEC01A.md \
        docs/adr/STRIDE-host-takeover-SEC01A.md \
        SEC-01-UX-01-MERGE-GATES.md \
        docs/gates/frozen-surface-guard-SEC01-UX01.md \
        qa/signoff-qa01a.md \
        'qa/reports/SEC01A-*' \
        poc/meet-webrtc-core/src/host/hostTokenVerifier.ts \
        poc/meet-webrtc-core/src/host/hostControlManager.ts \
        poc/meet-webrtc-core/src/presence/presenceAdapter.ts \
        poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts \
        poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts \
        poc/meet-webrtc-core/tests/m4a-authoritative-host.test.tsx

# Commit with structured governance message
git commit -m "feat(security): recover SEC-01A frontend remediation integrated with REL-01

- Recover 7-step HostTokenVerifier and Verify->Mutate directive pipeline
- Enforce transport-sender identity binding and directive sequence ordering
- Remove legacy newHostToken broadcast and silent guest fallback paths
- Preserve REL-01 private session authority and target-only credential delivery
- Recover tests/m4a-sec01-*.test.ts and SEC-01A ADR specifications
- Discard out-of-scope UX-01 assets, root archives, and governance diffs"

# Drop obsolete stash@{0}
git stash drop stash@{0}

# Fast-forward merge to main upon approval
git checkout main
git merge --ff-only feat/rel02-sec01a-recovery
```

---

## Section 9: REL-02 Acceptance Criteria & Implementation Complexity

### REL-02 Acceptance Criteria (AC-1 to AC-6)

- **AC-1 (Stash Recovery Hygiene)**: Exactly the 10 authorized SEC-01A files/blocks are recovered. All 18 out-of-scope UX-01 files, root binary archives (`meet-secure-backend-dev.zip`), scratch scripts (`check_registries.py`), and governance diffs (`AGENTS.md`) are discarded.
- **AC-2 (Zero Legacy Path Regressions)**: Verified absence of `newHostToken` in DataChannel broadcasts, zero guest fallback on resume/creation failure, zero implicit client-side host succession, and full enforcement of target-only credential delivery via WSS `/signal`.
- **AC-3 (REL-01 Contract Compatibility)**: `hostControlManager.transferHost()` sends `X-Session-Capability` and `X-Host-Proof`; `token.ts` preserves 4-header resume; `appStore.ts` preserves session authority hydration; all 10 tests in `tests/rel01-session-authority.test.ts` PASS with 100% success.
- **AC-4 (SEC-01A Security Test Verification)**: Both `tests/m4a-sec01-verifier.test.ts` and `tests/m4a-sec01-order-sender.test.ts` PASS, demonstrating cryptographic directive verification, transport-sender matching, and replay rejection.
- **AC-5 (Full Regression & Build Green)**:
  - Frontend unit tests: 100% pass ($\ge 285$ tests across $\ge 38$ files).
  - Frontend build: `npm run build` succeeds with zero TypeScript errors and bundle size $\le 225$ kB gzip.
  - Backend tests: `go test ./...` in `services/meet-signal` passes 100% (51 tests).
- **AC-6 (Governance Invariant Preservation)**: Zero modifications to backend contract (`services/meet-signal/main.go`), zero changes to SEC-02B/C specifications, and zero redesign of SEC-01A verification primitives.

### Implementation Complexity Assessment

- **Overall Complexity**: **MEDIUM**
- **Complexity Rationale**:
  1. **Backend Fixed**: Zero backend modifications are required. The backend contract is active, authoritative, and fully tested on `main`.
  2. **Infrastructure Prepared**: The frontend session authority store (`appStore.ts`), token bootstrap/resume (`token.ts`), and control channel listener (`controlChannel.ts`) are drafted and passing tests in the active working tree on `main`, committed cleanly as Stage 1 of the rebase procedure.
  3. **Targeted Merge Conflict Resolution**: Merge conflicts are localized to `hostControlManager.ts` and `presenceAdapter.ts`. In `hostControlManager.ts`, the SEC-01A directive verification logic must be retained while adopting REL-01's transfer headers and target-only delivery. In `presenceStore.ts`, the legacy client-side succession fallback (`nextHostId = remaining[0]`) must be removed to respect server-authoritative grace.
  4. **Strict Audit Discipline**: The R2a audit rules provide clear KEEP/REMOVE/REPLACE criteria, making the rebase mechanical rather than architectural.

---

## Section 10: Ready For Recovery

# **YES**

The contract boundaries between the active REL-01 backend authority and the SEC-01A frontend client defenses are completely established. All legacy authority transfer vulnerabilities have been identified and classified for removal. Full test suites exist for both sides, and standard-git execution steps guarantee repository hygiene without risking regressions or merge conflicts.
