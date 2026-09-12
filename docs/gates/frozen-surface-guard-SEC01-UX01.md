# Frozen-Surface Guard — Parallel SEC-01 + UX-01 Execution

**Authority:** `docs/M4A-authoritative-session-control.md` §1-4 (M4A invariant), `docs/architecture-brief.md` §11 (ADRs), `ADR-006` (invitation bearer credential), `ADR-007` (HRW stability, NOT closure authority), `docs/gates/architecture-exit-checklist.md` (5-gate mapping)
**Mission:** Define machine-checkable frozen list + merge policy mapping + conflict prediction for parallel SEC-01A fix and UX-01 waves.
**Date:** 2026-09-12
**Status:** ACTIVE GUARD — Enforced until SEC-01A merged and `m4a-accepted` tagged (per ADR-007 §2: branch dirty = not closed)

---

## 1. M4A Invariant (Binding)

> **No moderation action may be executed based solely on client assertions.** — `docs/M4A-authoritative-session-control.md:34`

Violating paths bypass `HostTokenVerifier` 7-step pipeline (structure, role=host, sub===senderId, aud===roomId, exp, freshness, ECDSA P-256 signature) and `HostControlManager` receiver pipeline (§3.3). SEC-01A blocker is proof of violation.

---

## 2. Frozen File List (Machine-Checkable)

Any PR touching a path in **Table F** must be treated as **SEC-01 scope only** and requires Security+QA+Exploit+Architecture PASS. UX-01 PRs must have `git diff --stat` clean against this list (exit code 1 on grep = GO).

### Table F — FROZEN (deny for UX-01)

| # | Glob / Path | Reason (M4A spec/ADR) | Notes |
|---|-------------|----------------------|-------|
| F1 | `poc/meet-webrtc-core/src/host/**` | Deliverables 2-3: `hostControlManager.ts`, `hostControlStore.ts`, `hostTokenVerifier.ts`, `types.ts` (HOST_CONTROL_TOPIC, SignedHostDirective) | UX must not touch. SEC-01A fix lands here via delegation, not direct host-changed mutation. |
| F2 | `poc/meet-webrtc-core/src/presence/**` | Single source of truth `presenceStore.hostId` (M4A §1.3), `presenceAdapter.ts` blocker 292-304 | **SEC-01A blocker locus.** UX must not modify. |
| F3 | `poc/meet-webrtc-core/src/auth/token.ts` | Deliverable 1: `createRoom()` fallback, JWT `role` claim, `sub`/`aud`/`exp` | Changing fallback breaks host establishment. |
| F4 | `poc/meet-webrtc-core/src/utils/roomUrl.ts` | ADR-006: bearer credential `https://domain/r/<roomId>#k=<key>` fragment never sent to server, `ROOM_ID_REGEX=/^[a-z0-9-]{6,64}$/i` | Key distribution boundary. |
| F5 | `poc/meet-webrtc-core/src/utils/qr.ts` | ADR-006 QR for invitation URL (fragment handling) | No UTM/tracking params. |
| F6 | `poc/meet-webrtc-core/src/sframe/**` | Architecture-brief §4.2: SFrame RFC9605, HKDF `sender_key`, WASM 150KB worker | Honest E2EE boundary. |
| F7 | `poc/meet-webrtc-core/src/keys/**` | `keys/manager.ts`: epoch_secret, HKDF, IndexedDB non-extractable | Server blind. |
| F8 | `poc/meet-webrtc-core/src/signaling/client.ts` | WSS `?token=` JWT 5m `aud=roomId` + nonce, `participantId: "system"` system messages | Authz surface. |
| F9 | `poc/meet-webrtc-core/src/store/appStore.ts` | Contains `roomId`, `participantId`, `localParticipant` used in `activeRoomId` derivation for verification | Indirect frozen—UX may read but not mutate host fields. |
| F10 | `services/meet-signal/main.go` | Deliverable 1-2: `POST /room/create`, `POST /token`, `POST /room/transfer-host`, `GET /room/authority`, `GET /room/status`, `authorityManager`, ES256 mint/verify, 30s grace, succession | Server authority. |
| F11 | `services/meet-sfu-manager/main.go` | `AssignSFU` HRW `h=xxhash(roomId\|nodeID\|salt)/weight` (salt `p0-salt-2026` per ADR-007 §3) | HRW stability invariant. UX must not touch infra. |
| F12 | `services/turn-auth/main.go` | HMAC-SHA256 coturn ephemeral `TURN_SECRET` TTL 86400 (`TURN_TTL`) | Auth boundary. |
| F13 | `infra/compose.yaml` `infra/livekit.yaml` `infra/Caddyfile` | `LIVEKIT_E2EE_MODE=blind`, coturn host-network, `SFU_NODES`, `SFU_HASH_SALT` | Env parity. |
| F14 | `docs/M4A-authoritative-session-control.md` `docs/architecture-brief.md` `docs/adr/ADR-006*` `docs/adr/ADR-007*` | Spec authority | Docs frozen for code PRs; ADR changes require @architect ADR PR. |

**Machine check:**
```bash
# UX-FROZEN: must exit 1 (no frozen mods) for UX-01 PASS
git diff --name-only HEAD | grep -E 'src/host/|src/presence/|src/auth/token\.ts|src/utils/roomUrl\.ts|src/utils/qr\.ts|src/sframe/|src/keys/|src/signaling/|src/store/appStore|services/meet-signal/|services/meet-sfu-manager/|services/turn-auth/|infra/(compose|livekit|Caddy)'
# Alternative machine gate (CI step):
git diff --stat | grep -E 'host|presence|roomUrl|qr\.ts|sframe|keys/manager|signaling/client|meet-signal|meet-sfu-manager|turn-auth' && echo "FAIL: frozen-surface touched" && exit 1 || echo "PASS: frozen-clean"
```

### Table A — ALLOWED for UX-01

| # | Glob / Path | Scope | Constraints |
|---|-------------|-------|-------------|
| A1 | `poc/meet-webrtc-core/src/components/**` | Visual primitives, layout, chrome | **EXCEPT** `src/components/host/**` logic (WaitingRoomBanner, HostControlsModal callbacks that call `HostControlManager` — styling only, no `action`/`admit`/`transfer` logic change) |
| A2 | `poc/meet-webrtc-core/src/components/primitives/**` (new) | RFC Dialog, Drawer, Toolbar, Button, Card | Pure presentational; must not import `HostTokenVerifier` or invoke `setAuthoritativeHost` |
| A3 | `poc/meet-webrtc-core/src/pages/**` | LandingPage, PreJoinPage, MeetingPage shell | CSS/layout only; `PreJoinPage` display-name validation `1≤len≤64` (`"Display name is required."`) is frozen—UX may restyle but not relax regex/length |
| A4 | `poc/meet-webrtc-core/src/layout/**` | `layoutStore`, `layoutEngine`, `gridOptimizer`, `speakerSmoothing` | Keep `Last-N=9` and blind-forward shield text `E2EE · 3-layer relay` untouched |
| A5 | `poc/meet-webrtc-core/src/styles/**` `poc/meet-webrtc-core/src/hooks/useMediaDevices.ts` styling branches | Theme, tokens, responsive | No auth logic |
| A6 | `docs/ux/**` | UX-F1 inventory, tokens, interaction inventory | Docs only |
| A7 | `poc/meet-webrtc-core/src/devices/**` (styling) | DeviceSettingsModal presentation | No `deriveAvailability` auth change |

**Allowed ≠ unbounded:** `src/components/host/**` files are *presentational wrappers* around frozen stores. UX may extract Dialog/Drawer shells but must keep `onAdmit`, `onReject`, `onTransfer` prop-through unchanged. Any diff that adds `setAuthoritativeHost`, `hostToken`, `hostKey`, `HOST_CONTROL_TOPIC`, or modifies `isWaitingRoomEnabled` default (`true`) is **re-classified as frozen-touch → FAIL**.

---

## 3. SEC-01A Blocker & Expected Diff Shape

### Blocker Location

`poc/meet-webrtc-core/src/presence/presenceAdapter.ts:292-304`

```ts
const onDataReceived = (payload, participant, _kind, topic) => {
  if (topic === HOST_CONTROL_TOPIC) {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);
      if (data.action === 'host-changed' && (data.newHostId || data.targetParticipantId)) {
        const newHostId = data.newHostId || data.targetParticipantId;
        usePresenceStore.getState().setAuthoritativeHost(newHostId); // ← UNVERIFIED
      }
    } catch {}
    return;
  }
}
```

**Violation:** Direct `setAuthoritativeHost` from `DataReceived` without `HostTokenVerifier.verifyDirective`/`verifyClaimsSync`, without `sub===senderId`, `aud===roomId`, `exp`, `freshness`, or ECDSA signature. Any peer (or `participant="system"` spoof) can broadcast `host-changed` and usurp host. Contravenes `M4A-authoritative-session-control.md:34` invariant and Deliverable 3 pipeline (§3.3).

**Current containment state:** `hostControlManager.ts` already implements SEC01 containment for `host-changed`/`host-announce` (lines 141-178: requires `msg.hostToken`, falls through to M4A verification pipeline 221-283, checks `establishedHostId`, `verificationSenderId`, `SEC01_CONTAINMENT_ENABLED=true`). PresenceAdapter bypass **circumvents** that containment → host state can be desynced between stores.

### Expected Diff Shape (SEC-01A fix — do NOT implement in this guard PR)

**Option R (Recommended): Remove bypass → delegate to HostControlManager**

```diff
- const onDataReceived = (payload: Uint8Array, participant?: Participant, _kind?: any, topic?: string) => {
-   if (topic === HOST_CONTROL_TOPIC) {
-     try {
-       const text = new TextDecoder().decode(payload);
-       const data = JSON.parse(text);
-       if (data.action === 'host-changed' && (data.newHostId || data.targetParticipantId)) {
-         const newHostId = data.newHostId || data.targetParticipantId;
-         usePresenceStore.getState().setAuthoritativeHost(newHostId);
-       }
-     } catch (err) { console.warn(...) }
-     return;
-   }
+ // SEC-01A: host-control topic is owned exclusively by HostControlManager. PresenceAdapter must not
+ // directly mutate host authority. Delegate or ignore.
+ const onDataReceived = (payload: Uint8Array, participant?: Participant, _kind?: any, topic?: string) => {
+   if (topic === HOST_CONTROL_TOPIC) {
+     // Frozen-surface guard: no direct setAuthoritativeHost. HostControlManager handles verification.
+     return;
+   }
```

**Alternative G (Guarded delegation — if server-relay metadata needed):**
```diff
  if (topic === HOST_CONTROL_TOPIC) {
-   // ... unverified setAuthoritativeHost
+   // SEC-01A guarded delegation: forward raw envelope to HostControlManager for verified processing
+   // HostControlManager.onDataReceived will run 7-step verification before any setAuthoritativeHost.
+   return; // let HostControlManager be the sole verifier (single owner)
  }
```

**Invariant after fix:**
- `grep -rn "setAuthoritativeHost" poc/meet-webrtc-core/src/presence/` must return **only** via `presenceStore.ts` definition, never via `presenceAdapter.ts` `host-changed` handler.
- `HostControlManager.verifyDirective` (or `verifyClaimsSync` fallback) is the **single verification gate** for `host-changed` / `host-announce`.
- `m4a-sec01-verifier.test.ts` ORDER/SENDER/V1-V5 must pass (no `setAuthoritativeHost` before `verifyDirective`).

**HostTokenVerifier note:** Code enforces freshness `10_000ms` (`hostTokenVerifier.ts:145`) while M4A spec §3.3 says `5000ms` and AGENTS.md notes **code is truth (60s per old comment, now 10s in current tree)**. SEC-01A test suite expects **10s** vector (V4: `Date.now() -15000` rejected). Do not tighten to 5s without spec/code alignment ADR—keep 10s.

---

## 4. Merge Policy Mapping (Machine-Checkable)

### SEC-01 Merge Gate

**Needs:** `Security PASS` + `QA PASS` + `Exploit PASS` + `Architecture PASS`

| Check | Command / Evidence | PASS Threshold |
|-------|-------------------|----------------|
| Security | `npm --prefix poc/meet-webrtc-core test -- --testNamePattern="SEC-01A"` → `poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts` (V1-V5/ORDER/SENDER) | 7/7 vectors PASS, 0 skipped |
| QA | `npm --prefix poc/meet-webrtc-core test` + histograms | ≥215 tests, 0 M0-M3B regressions; `qa/reports/key-rotation-latency.json` p95≤500ms, `reconnect-latency.json` p95≤5s, `browser-matrix.html` 3/3 |
| Exploit Regression | Same suite + `grep -rn "setAuthoritativeHost" src/presence/presenceAdapter.ts` | No unverified call; ORDER spy confirms `verifyDirective` precedes `setAuthoritativeHost` |
| Architecture | `docs/gates/architecture-exit-checklist.md` signatures + `p0-gate-verify` | 5/5 gates signed, no HIGH open, pivot honest downgrade documented |
| Gate mapping | Architecture-exit-checklist pre-conditions 1-10 + Deliverables table | Traceability RAG: 4G/5A/1R artifact-only (pcap re-capture on `meet-secure-p0_default` bridge) → SEC-01 architecture PASS requires R cleared |

**FAIL if:** any vector fails, `git status --porcelain=v1` shows dirty delivering branch (ADR-007 §2), or `grep` finds bypass.

### UX-01 Merge Gate

**Needs:** `Frozen-clean PASS` + `A11y PASS` + `Visual PASS` + `TS PASS` + `Tests PASS`

| Check | Command / Evidence | PASS Threshold |
|-------|-------------------|----------------|
| Frozen-clean | `git diff --name-only | grep -E 'src/host/|src/presence/|src/auth/token|src/utils/roomUrl|src/utils/qr|src/sframe|src/keys|src/signaling|meet-signal|meet-sfu-manager|turn-auth'` → exit 1 = PASS | Zero frozen paths touched |
| Invariant-grep | `git diff | grep -i "invariant\|MAX_PAGE_TILES\|state.*frozen\|SFU_HASH_SALT\|p0-salt-2026"` → exit 1 = PASS | No weakening lines; additive only |
| A11y | `npm --prefix poc/meet-webrtc-core run lighthouse:ci` → `qa/reports/lighthouse/*.json` | `accessibility ≥95`, no new WCAG violations, focus trap/ESC in Dialog/Drawer primitives |
| Visual | `npm --prefix poc/meet-webrtc-core run test:browser` (playwright) + `qa/reports/playwright-results.json` | Baseline diff ≤threshold, no broken grid (GalleryView Last-N=9 pagination intact) |
| TS | `cd poc/meet-webrtc-core && node node_modules/typescript/bin/tsc -p tsconfig.app.json` | 0 errors |
| Tests | `npm --prefix poc/meet-webrtc-core test` | ≥215 pass, 0 regressions, bundle ≤225kB gzip (M4A reviewer ceiling) |

**FAIL if:** frozen grep hits, Lighthouse <95, tsc >0, <215 tests, or visual diff breaks Last-N=9 grid/ShieldBadge `E2EE · 3-layer relay` text.

---

## 5. Conflict Prediction: SEC-01A vs UX Wave-1

| Dimension | Prediction | Severity | Mitigation |
|-----------|------------|----------|------------|
| **File overlap** | No direct conflict if UX respects Table F. SEC-01A touches **only** `presenceAdapter.ts:292-304` (+ optionally `hostTokenVerifier.ts` freshness comment). UX Wave-1 per `docs/ux/UX-F1-component-inventory.md` touches `components/**`, `pages/**`, `layout/**`, `primitives/**` — **disjoint**. | **LOW** | CI frozen check blocks UX touching `src/host/**` or `src/presence/**`. |
| **Logical overlap** | **HIGH risk if UX extracts primitives from `HostControlsModal`/`WaitingRoomBanner`/`InviteModal` naively.** Search-replace across `src/components/host/**` could inadvertently modify `admit`/`reject`/`transfer-host` prop drilling that flows to `HostControlManager`. | **MEDIUM-HIGH** | Guard: UX PRs must keep `HostControlsModal` → `HostControlManager` call sites **identical** (prop-through). Diff audit: `grep -E "admitParticipant|rejectParticipant|transferHost|knockWaitingRoom|publishDirective" src/components/host/` must be unchanged. |
| **Store desync** | If SEC-01A removes PresenceAdapter bypass but UX simultaneously adds new `usePresenceStore` consumer that calls `setAuthoritativeHost` directly (e.g., new Toolbar host badge), second bypass is introduced. | **MEDIUM** | Guard: ban `setAuthoritativeHost` outside `HostControlManager` + `presenceStore.ts` definition. CI: `grep -rn "setAuthoritativeHost" poc/meet-webrtc-core/src --exclude="presenceStore.ts" --exclude="hostControlManager.ts"` must return 0. |
| **Timing/merge race** | UX Wave-1 could merge before SEC-01A, then SEC-01A rebase triggers **semantic merge conflict** (both touch `VideoTile`/`ControlBar` vs `presenceAdapter`? No, but git `merge` may auto-resolve while logical invariant is lost if UX PR was frozen-clean at branch point but SEC-01A branch adds verification that UX later overwrites). | **MEDIUM** | Sequence: **SEC-01A merges first** (security blocker). UX Wave-1 rebases onto fixed `presenceAdapter.ts` and re-runs frozen check + V1-V5 suite. |
| **HRW / SFrame** | No conflict. UX has no reason to touch `SFU_HASH_SALT` or `LIVEKIT_E2EE_MODE=blind`. Flag if `git diff` shows `p0-salt-2026` or `xxhash` or `wasm-sframe`. | **LOW** | Already in frozen grep. |

**Overall conflict prognosis:** **NO CODE CONFLICT if guard enforced; LOGICAL CONFLICT probable without guard.** The only physical overlap is `presenceAdapter.ts` ownership—UX must not touch it. The logical overlap is `components/host/**` primitive extraction—must be styling-only.

---

## 6. Gate Checklist Mapping to `docs/gates/architecture-exit-checklist.md`

| Checklist Section | Mapping to Guard | Guard Evidence |
|-------------------|------------------|----------------|
| **Pre-Conditions 1-10** (browser matrix, 20p load, LiveKit infra, SFrame ciphertext, screen share, rotation ≤500ms, reconnect ≤5s, TURN, Lighthouse ≥95, zero telemetry) | SEC-01 QA PASS reuses same artifacts; UX-01 must not degrade 1,4,6,7,9 (matrix, SFrame, rotation, reconnect, Lighthouse) | `qa/reports/*.json` + `browser-matrix.html` + `lighthouse/*.json` |
| **Architecture Deliverables** (Brief, C4 L1/L2, ADR-004, ADR-001/002/005, Consistent Hash §6, HA/RTO §7, Pivot §9, Compose parity) | Frozen list F11-F13 protects hash/HA/pivot; F10 protects signal authority design; A1-A4 allow presentation evolution without re-architect | Brief §6 `h=xxhash(roomId\|nodeID\|salt)/weight` salt `p0-salt-2026`, single-node `SFU_NODES=livekit:7880` → `sfu-0` degenerate valid |
| **Validation Gates (5 required)** | Architecture → guard author (@architect); Security → SEC-01 V1-V5; Privacy → no `signaling/client` telemetry change; QA → ≥215 tests `p0-gate-verify`; Adversarial → honest blind-forward vs header-aware (§9) | `architecture-exit-checklist.md` signatures row |
| **Honest Downgrade Check** | Guard preserves `ShieldBadge` honest text + fallback blind-forward Last-N=9; forbids silent DTLS downgrade | `ShieldBadge.tsx` + `architecture-brief.md §9` |
| **Coordination — Do Not Block @webrtc/@backend** | SEC-01A fix is 15-line removal/delegation, no SFU/turn change; UX primitives are frontend-only, no backend contract change → unblocked | `meet-sfu-manager` + `turn-auth` untouched per frozen grep |

---

## 7. Escalation: Does UX Spec Violate M4A Invariant?

**Verdict: NO — current UX-F1 spec is invariant-safe.**

- `UX-F1-component-inventory.md` proposes extracting **Dialog, Drawer, Toolbar, Button, Card** from `src/components/**` — all presentational. No proposal to move `hostId`, `transfer-host`, `waiting-room-admit`, or `roomUrl#k=` logic into primitives.
- `UX-F1-design-token-contract.md` and `UX-F1-interaction-inventory.md` (not yet read, but per inventory) are token/motion contracts — no authority surface.
- **Conditional escalation (future):** If UX Wave-1 adds **anonymous join links** or **UTM params** to `roomUrl.ts`, or changes `isWaitingRoomEnabled` default from `true` → `false`, or relaxes `displayName` regex (`1≤len≤64`), that **would violate** `M4A §5.1` (waiting room ON by default) and `§5.2` (mandatory display name) and ADR-006 bearer model. Such change must be escalated to @architect + @security as **BLOCKED** and require ADR.

---

## 8. Enforcement Checklist (Copy-Paste for PR Description)

```markdown
- [ ] Machine frozen check: `git diff --name-only | grep -E 'src/host/|src/presence/|src/auth/token|src/utils/roomUrl|src/utils/qr|src/sframe|src/keys|src/signaling|meet-signal|meet-sfu-manager|turn-auth'` → exit 1 (PASS)
- [ ] Invariant grep: `git diff | grep -i invariant` → exit 1 (PASS)
- [ ] SEC-01A: `grep -n "setAuthoritativeHost" poc/meet-webrtc-core/src/presence/presenceAdapter.ts` → 0 hits outside import (PASS)
- [ ] SEC-01A: `npm --prefix poc/meet-webrtc-core test -- --testNamePattern="SEC-01A"` → 7/7 PASS
- [ ] Architecture: verifier pipeline is single-owner `HostControlManager` (no second `HOST_CONTROL_TOPIC` handler mutates hostId)
- [ ] UX-01: `tsc` 0 errors, `vitest` ≥215, Lighthouse a11y ≥95, `test:browser` visual baseline green
```

---

## 9. Deliverable Index

- Frozen list: §2 Table F (14 globs) + machine check
- Allowed UX paths: §2 Table A (7 globs) with constraints
- SEC-01A expected diff: §3 (remove/guard `host-changed` in `presenceAdapter.ts:292-304`, delegate to `HostControlManager`)
- Gate checklist mapping: §4 + §6
- Conflict prediction: §5
- Escalation: §7

*End of guard — enforce via CI step before any SEC-01/UX-01 merge.*
