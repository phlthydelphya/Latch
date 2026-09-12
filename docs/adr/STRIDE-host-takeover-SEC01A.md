# STRIDE-host-takeover-SEC01A — Formal Closure Artifact

- **DECISION:** STRIDE-host-takeover-SEC01A
- **STATUS:** APPROVED — FORMAL CLOSURE ARTIFACT (no logic changes)
- **CODE AUTHORIZATION:** NONE — artifact creation only; Do NOT modify code
- **Author:** @backend (Backend Lead)
- **Date:** 2026-09-12
- **Refs:** `docs/M4A-authoritative-session-control.md` §1-4 (invariant: "No moderation action may be executed based solely on client assertions"), `docs/architecture-brief.md` §3/11, `docs/adr/ADR-007-latch-staged-rename.md` §2, `docs/adr/ORDERING-CONTRACT-SEC01A.md`, `poc/meet-webrtc-core/src/host/hostTokenVerifier.ts`, `poc/meet-webrtc-core/src/host/hostControlManager.ts`, `poc/meet-webrtc-core/src/presence/presenceAdapter.ts:292-299`, `poc/meet-webrtc-core/src/presence/presenceStore.ts:204-214`
- **Branch:** `fix/sec01-*` (see ORDERING-CONTRACT-SEC01A §3)
- **Gates:** `tsc/suite/greps/adversarial` (see ORDERING-CONTRACT-SEC01A §3.4)

> **Authority note:** This document is the formal STRIDE closure artifact for SEC-01A. It creates no code logic and performs no code renames. It freezes the verified threat model, pre/post fix STRIDE tables, 7-step pipeline mapping, and residual risk register. All implementation occurs on `fix/sec01-*` and passes the gates in ORDERING-CONTRACT-SEC01A §3.4. Co-tag prohibition per ADR-007 §2 applies.

---

## 1. Threat: DataChannel `host-changed`/`host-announce` Pre-Verify Usurp

An unauthenticated peer on the LiveKit DataChannel (`HOST_CONTROL_TOPIC`) can publish a forged `{action: 'host-changed', newHostId: 'attacker'}` or `{action: 'host-announce', newHostId: 'attacker'}` message. Prior to the SEC-01A fix, `PresenceAdapter.onDataReceived` (lines 292-299) accepted these messages without cryptographic verification and invoked `usePresenceStore.getState().setAuthoritativeHost(attackerId)`, mutating the single source of truth (`presenceStore.hostId`) and granting the attacker full host privileges (mute, remove, lock, transfer, waiting-room control) — violating the M4A invariant that **no moderation action may be executed based solely on client assertions**.

The vulnerability surface:
- **Entry point:** LiveKit DataChannel reliable publish on `HOST_CONTROL_TOPIC` (any participant)
- **Bypass:** `PresenceAdapter` directly called `setAuthoritativeHost` without `HostTokenVerifier.verifyDirective`
- **Impact:** Full host authority escalation (EoP), room lock/hijack, participant removal, waiting-room bypass
- **M4A invariant violated:** Server-authoritative host control — client assertions (`msg.senderId`, `msg.newHostId`) were trusted

---

## 2. Pre-Fix STRIDE Assessment (FAIL)

| STRIDE Category | Verdict | One-Line Mechanism |
|-----------------|---------|-------------------|
| **Spoofing** | FAIL | Attacker spoofs `msg.senderId` = legitimate host ID; `PresenceAdapter` trusts `msg.newHostId` |
| **Tampering** | FAIL | Attacker modifies `host-changed` payload en route; no integrity check on DataChannel |
| **Repudiation** | FAIL | No audit trail of who initiated `host-changed`; `setAuthoritativeHost` leaves no signed record |
| **Information Disclosure** | PASS | Host token/key not exposed via this path (separate key-provenance rule) |
| **Denial of Service** | FAIL | Attacker spams `host-changed` to flip host rapidly, causing UI churn and state thrash |
| **Elevation of Privilege** | FAIL | Direct path: forged DataChannel message → `setAuthoritativeHost` → full host capabilities |

### Findings Summary (F-01–F-08)

- **F-01:** `PresenceAdapter` processes `HOST_CONTROL_TOPIC` and calls `setAuthoritativeHost` without verification (presenceAdapter.ts:292-299 pre-fix)
- **F-02:** `msg.senderId` used as identity instead of `participant?.identity` (SENDER rule violation)
- **F-03:** No `hostToken` presence check on `host-changed`/`host-announce` inbound
- **F-04:** No established-host gate — any participant can declare themselves host
- **F-05:** No freshness/replay protection on directive timestamp
- **F-06:** No cryptographic signature verification (ECDSA P-256) on host token
- **F-07:** `hostKey` from DataChannel payload accepted (key-provenance violation)
- **F-08:** No authorization anomaly logging for unverified host mutations

---

## 3. Post-Fix STRIDE Assessment (PASS)

### Containment Layers (Defense in Depth)

1. **`SEC01_CONTAINMENT_ENABLED` feature flag** (hostControlManager.ts:13) — default `true` for rollout; when `false`, legacy behavior preserved for backward compatibility testing
2. **Fall-through to M4A pipeline** (hostControlManager.ts:142-177, 181-203) — `host-changed`/`host-announce` with `SEC01_CONTAINMENT_ENABLED` require `msg.hostToken` and fall through to the full 7-step verification at lines 250-271
3. **Established-host gate** (hostControlManager.ts:224-233) — if `presenceStore.hostId` is set, only that host (or `system` relay) may send directives; all others rejected pre-verification
4. **Sender identity from `participant?.identity`** (hostControlManager.ts:75-88) — `senderId = participant?.identity` authoritative; `msg.senderId` ignored except for `system` relay where it is verified against token `sub`
5. **7-step verification pipeline** (hostTokenVerifier.ts:87-153 sync, 159-213 async) — structure, role, subject, audience, expiration, freshness (10s), ECDSA P-256
6. **Tokenless rejection** (hostControlManager.ts:272-282) — all directives except `waiting-room-knock`/`host-query` require verified `hostToken`; anomaly logged
7. **Authorization anomaly warnings** (hostControlManager.ts:144, 184, 267-269, 278-280) — console.warn with `SEC01:` prefix for audit correlation

### Post-Fix STRIDE Table

| STRIDE Category | Verdict | Mitigation |
|-----------------|---------|------------|
| **Spoofing** | PASS | `participant?.identity` authoritative; token `sub` must match; ECDSA signature binds token to server key |
| **Tampering** | PASS | JWT structure + ECDSA signature on header.payload; any modification invalidates signature |
| **Repudiation** | PASS | Verified directives carry server-signed `hostToken` + `nonce`; anomaly logs create audit trail |
| **Information Disclosure** | PASS | `hostKey` never broadcast to unauthenticated queryers (hostControlManager.ts:216); key provenance server-only |
| **Denial of Service** | PASS | Established-host gate rate-limits to true host; token verification cheap (sync claims) before crypto |
| **Elevation of Privilege** | PASS | No path to `setAuthoritativeHost` without `verifyDirective` returning `{valid: true}` (ORDER invariant) |

---

## 4. 7-Step Pipeline Table (with File:Line References)

| Step | Check | File | Lines | Failure Mode |
|------|-------|------|-------|--------------|
| 1 | Token structure: valid JWT `header.payload.signature` (3 parts) | hostTokenVerifier.ts | 51-81 (`parseHostToken`) | `null` return → `Malformed host token structure` |
| 2 | Role claim: `claims.role === 'host'` | hostTokenVerifier.ts | 103-106 | `Invalid role in token` |
| 3 | Subject matching: `claims.sub === senderId` (senderId = `participant?.identity`) | hostTokenVerifier.ts | 108-114 | `Subject mismatch` |
| 4 | Audience matching: `claims.aud === activeRoomId` or `claims.room === activeRoomId` (trimmed, lower-cased) | hostTokenVerifier.ts | 116-127 | `Room audience mismatch` |
| 5 | Expiration: `now < claims.exp` (Unix seconds) | hostTokenVerifier.ts | 136-140 | `Host token has expired` |
| 6 | Timestamp freshness: `\|now - directive.timestamp\| <= 10,000ms` | hostTokenVerifier.ts | 142-151 | `Directive timestamp outside freshness window` |
| 7 | Cryptographic signature: ECDSA P-256 via WebCrypto `crypto.subtle.verify` with server `hostKey` (SPKI) | hostTokenVerifier.ts | 175-205 | `Cryptographic signature verification failed` |

> **Note:** Step 6 enforces **10s** (code truth at hostTokenVerifier.ts:145); spec says 5s but code is truth per AGENTS.md gotcha — do not tighten without ADR.

---

## 5. Sender-Identity Statement

> **`participant?.identity` authoritative, `msg.senderId` ignored.**

- The sender identity supplied to verification **MUST** be derived from the LiveKit `Participant` object (`participant?.identity`) as supplied by the `DataReceived` / `RoomEvent` callback (hostControlManager.ts:75-77).
- The `msg.senderId` field inside the deserialized payload is **untrusted** and **MUST be ignored** for authorization.
- Exception: server-relayed messages arrive with `participant.identity === 'system'`; for these, `verificationSenderId = msg.senderId` is used **but** it is then verified against the token `sub` claim (step 3) — a spoofed `msg.senderId` fails at subject matching (hostControlManager.ts:82-88).
- `HostTokenVerifier.verifyClaimsSync(msg, activeRoomId, senderId)` enforces `claims.sub === senderId` where `senderId` is the `participant?.identity` value, not `msg.senderId`. A mismatch (`msg.senderId` spoofed to `host-alice` while `participant.identity === attacker-eve`) → `valid: false` (`Subject mismatch`).

---

## 6. Residual Risks

| Risk | Description | Tracking |
|------|-------------|----------|
| **10s replay window** | Freshness check allows 10s skew (hostTokenVerifier.ts:145). Captured valid directive replayable within window. | → SEC-01B: nonce-based replay protection (server-issued, single-use) |
| **404-fallback on transfer-host** | `HostControlManager.transferHost` falls back to DataChannel broadcast if `POST /room/transfer-host` returns 404 (hostControlManager.ts:619-620). Fallback path still requires valid `hostToken` on broadcast, but server authority not consulted. | → SEC-01B: eliminate 404 fallback; require server confirmation |
| **External `setAuthoritativeHost` callers accepted** | `presenceStore.setAuthoritativeHost` is public; `HostControlManager` is sole *verified* caller per ORDER invariant, but other code (tests, future features) could call directly. Grep guard in ORDERING-CONTRACT-SEC01A §1.1 enforces single-owner at build time. | → SEC-01B: runtime guard or module encapsulation |
| **WebCrypto unavailable fallback** | If `crypto.subtle` missing (test mocks, old browsers), `verifyDirective` falls back to claims-only sync check (hostTokenVerifier.ts:171-172). Cryptographic binding lost. | → SEC-01B: require WebCrypto; fail closed in production |

---

## 7. Final Assessment

| Dimension | Status | Evidence |
|-----------|--------|----------|
| **Threat modeled** | COMPLETE | §1 threat narrative + F-01–F-08 |
| **Pre-fix STRIDE** | DOCUMENTED | §2 table (6×FAIL, 1×PASS) |
| **Post-fix STRIDE** | ALL PASS | §3 table (6×PASS) |
| **7-step pipeline verified** | COMPLETE | §4 table with file:line refs |
| **Sender rule enforced** | COMPLETE | §5 statement + hostControlManager.ts:75-88 |
| **Residual risks tracked** | COMPLETE | §6 table with SEC-01B pointers |
| **ORDER invariant** | ENFORCED | ORDERING-CONTRACT-SEC01A §1.1 + greps |
| **Key provenance** | ENFORCED | ORDERING-CONTRACT-SEC01A §2 + grep |
| **Frozen surface** | GUARDED | ORDERING-CONTRACT-SEC01A §3.2 allowlist |

---

## 8. Gate Impact

This STRIDE artifact satisfies the **Security** gate requirement for SEC-01A closure. It is a prerequisite for the `m4a-accepted` tag per ADR-007 §2 (M4A cannot close while SEC-01A blocker remains open). The three required reviewers per ORDERING-CONTRACT-SEC01A §3.3 (`@security`, `@architect`, `@backend`) must sign off on this artifact before the SEC-01A fix branch may be squash-merged.

---

## 9. Sign-Off

| Role | Handle | Date | Verdict | Signature |
|------|--------|------|---------|-----------|
| Backend Lead | @backend | 2026-09-12 | ARTIFACT ISSUED | **PENDING SIGNATURE** |
| Security | @security |  | PENDING | **PENDING SIGNATURE** |
| Architect | @architect |  | PENDING | **PENDING SIGNATURE** |
| QA | @qa |  | PENDING | **PENDING SIGNATURE** |
| Reviewer (Adversarial) | @reviewer |  | PENDING | **PENDING SIGNATURE** |
| PM | muse-spark-1.2-contributor-free |  | PENDING consolidation | **PENDING SIGNATURE** |

> **PENDING SIGNATURE** — This artifact is issued as a formal closure document. No code changes are authorized by this document alone. Implementation on `fix/sec01-*` requires Security+Architect+Backend approvals and `tsc/suite/greps/adversarial` gates per ORDERING-CONTRACT-SEC01A §3.4 before squash-merge to main, followed by restart, rotation, and audit-zero per ORDERING-CONTRACT-SEC01A §3.6.

---

*End of STRIDE-host-takeover-SEC01A — Formal closure artifact, no logic changes.*