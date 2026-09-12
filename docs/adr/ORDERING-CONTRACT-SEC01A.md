# ORDERING-CONTRACT-SEC01A — Verified Ordering Invariant & Merge-Restart Contract

- **DECISION:** ORDERING-CONTRACT-SEC01A
- **STATUS:** APPROVED — FORMAL CLOSURE ARTIFACT (no logic changes)
- **CODE AUTHORIZATION:** NONE — artifact creation only; Do NOT modify code
- **Author:** @architect (Principal Architect)
- **Date:** 2026-09-12
- **Refs:** `docs/M4A-authoritative-session-control.md` §1-4, `docs/architecture-brief.md` §3/11, `docs/adr/ADR-007-latch-staged-rename.md` §2, `docs/gates/frozen-surface-guard-SEC01-UX01.md` §3, `docs/gates/architecture-exit-checklist.md`, `poc/meet-webrtc-core/src/host/hostTokenVerifier.ts`, `poc/meet-webrtc-core/src/host/hostControlManager.ts`, `poc/meet-webrtc-core/src/presence/presenceStore.ts`, `poc/meet-webrtc-core/src/presence/presenceAdapter.ts:292-304`
- **Branch:** `fix/sec01-*` (see §3 Sequence)
- **Gates:** `tsc/suite/greps/adversarial` (see §3)

> **Authority note:** This document is the formal ordering-contract closure artifact for SEC-01A. It creates no code logic and performs no code renames. It freezes the verified ordering invariant, key-provenance rule, SENDER rule, and the commit→push→review→merge→restart sequence that governs the SEC-01A fix. All implementation must occur on `fix/sec01-*` and pass the gates enumerated herein. Co-tag prohibition per ADR-007 §2 applies.

---

## 1. Ordering Invariant (Binding)

### 1.1 Core invariant

> **No `setAuthoritativeHost` before `verifyDirective` completes.**

Formally:

- `HostControlManager` (and any future caller) **MUST NOT** invoke `usePresenceStore.getState().setAuthoritativeHost(...)` until `HostTokenVerifier.verifyDirective(...)` (or its synchronous fallback `verifyClaimsSync` where WebCrypto is unavailable) has returned `{ valid: true }` for the inbound directive envelope.
- The invariant is enforced as **ORDER**: spy assertion `verifyDirective` → `setAuthoritativeHost` in that order; any call to `setAuthoritativeHost` that precedes or bypasses `verifyDirective` is a violation.
- PresenceAdapter bypass at `poc/meet-webrtc-core/src/presence/presenceAdapter.ts:292-304` (unverified `setAuthoritativeHost(newHostId)` on `HOST_CONTROL_TOPIC` `host-changed`) is the canonical violation. After fix, `grep -rn "setAuthoritativeHost" poc/meet-webrtc-core/src/presence/` must return **only** via `presenceStore.ts` definition; the adapter must delegate or ignore `HOST_CONTROL_TOPIC` and let `HostControlManager` be the sole verifier.

Machine checks:

```bash
# ORDER check — no bypass in adapter
grep -n "setAuthoritativeHost" poc/meet-webrtc-core/src/presence/presenceAdapter.ts && echo "FAIL: bypass" && exit 1 || echo "PASS: no bypass"

# Single-owner check — only presenceStore.ts (definition) and hostControlManager.ts (sole caller) may reference setAuthoritativeHost
grep -rn "setAuthoritativeHost" poc/meet-webrtc-core/src --include="*.ts" --include="*.tsx" | grep -v "presenceStore.ts" | grep -v "hostControlManager.ts" && echo "FAIL: rogue writer" && exit 1 || echo "PASS: single owner"
```

Test vectors: `poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts` — `ORDER: No setAuthoritativeHost before verifyDirective` (V1-V5 + ORDER + SENDER, 7 vectors). `poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts` — ORDER spy and SENDER spoof suites.

### 1.2 SENDER rule (authoritative identity)

> **`participant?.identity` authoritative, `msg.senderId` ignored.**

- The sender identity supplied to verification **MUST** be derived from the LiveKit `Participant` object (`participant?.identity`) as supplied by the `DataReceived` / `RoomEvent` callback. The `msg.senderId` field inside the deserialized payload is **untrusted** and **MUST be ignored** for authorization.
- `HostTokenVerifier.verifyClaimsSync(msg, activeRoomId, senderId)` enforces `claims.sub === senderId` where `senderId` is the `participant?.identity` value, not `msg.senderId`. A mismatch (`msg.senderId` spoofed to `host-alice` while `participant.identity === attacker-eve`) → `valid: false` (`Subject mismatch`).
- `HostControlManager.onDataReceived` resolves `senderId = participant?.identity ?? msg.senderId` only as a fallback for test harness; production path treats `participant?.identity` as authoritative. Tests assert SENDER: spoofed `msg.senderId` ignored, forged host-announce/host-changed rejected.

Verification steps (7-step pipeline, per `hostTokenVerifier.ts` + `M4A-authoritative-session-control.md` §3.3):

1. Token structure: valid JWT `header.payload.signature` (3 parts)
2. Role claim: `claims.role === 'host'`
3. Subject matching: `claims.sub === senderId` (where `senderId` is `participant?.identity` authoritative)
4. Audience matching: `claims.aud === activeRoomId` or `claims.room === activeRoomId` (trimmed, lower-cased)
5. Expiration: `now < claims.exp`
6. Timestamp freshness: `|now - directive.timestamp| <= 10_000ms` (code truth: `hostTokenVerifier.ts:145` enforces 10s; spec says 5s but code is truth per AGENTS.md gotcha — do not tighten without ADR)
7. Cryptographic signature: ECDSA P-256 via WebCrypto `crypto.subtle.verify` with server-provided `hostKey` (when `hostPublicKeyHex` available)

Failed verification → logged as authorization anomaly and dropped; no `setAuthoritativeHost` executed.

---

## 2. Key-Provenance Rule (Binding)

> **Key provenance: server responses only; DataChannel `hostKey` untrusted.**

- The ES256 host public key (`hostKey` hex, P-256 SPKI) that anchors `verifyDirective` WebCrypto verification **MUST** originate from **server responses only**:
  - `POST /room/create` response (`{ hostToken, hostKey }`)
  - `POST /room/transfer-host` response / broadcast (`host-changed` system message with `newHostToken` + `hostKey` via signal hub `participantId: "system"`)
  - `GET /room/authority?roomId=` or `GET /room/status` where server returns current `hostKey`
- Any `hostKey` arriving via LiveKit DataChannel (`HOST_CONTROL_TOPIC` payload `hostKey` field) is **untrusted** and **MUST NOT** be used to import a verification key or overwrite the server-provisioned key. DataChannel `hostKey` overwrite is a V3 vector (`Key-overwrite rejected`) and must be dropped.
- `HostControlManager` stores the server-provisioned `hostKey` in memory only (no disk persistence per M4A invariant: zero disk persistence of attendee logs or room membership). On `host-changed`, the new `hostKey` is accepted only when delivered via server-broadcast system message (`participantId: "system"` through `meet-signal` WSS hub), not via peer DataChannel.

Machine check:

```bash
# Key-provenance: no DataChannel hostKey import
grep -rn "hostKey" poc/meet-webrtc-core/src/host/ | grep -i "DataChannel\|payload\.hostKey\|data\.hostKey" && echo "FAIL: untrusted hostKey path" && exit 1 || echo "PASS: key-provenance clean"
```

Related invariants: `docs/architecture-brief.md` §4.3 (key rotation), `ADR-002` (SFrame), `docs/M4A-authoritative-session-control.md` §2.1 (hostKey distribution).

---

## 3. Commit→Push→Review→Merge→Restart Sequence (Binding)

The SEC-01A fix **MUST** follow this exact sequence. No step may be skipped or reordered.

```
commit → push → review → merge → restart → rotation → audit-zero
```

### 3.1 Branch

- Branch name: `fix/sec01-*` (e.g., `fix/sec01-ordering-contract`, `fix/sec01-presence-adapter-delegation`).
- The delivering branch for SEC-01A is `fix/sec01-*`; `feat/m4a-authoritative-session-control` remains the M4A baseline per ADR-007 §2 (dirty = not closed). SEC-01A does not close M4A; it is a prerequisite blocker.

### 3.2 Allowlist — 3 paths

Only the following paths are allowlisted for SEC-01A diff (frozen-surface guard `docs/gates/frozen-surface-guard-SEC01-UX01.md` §2 Table F):

1. `poc/meet-webrtc-core/src/presence/presenceAdapter.ts` — remove/guard unverified `setAuthoritativeHost` on `HOST_CONTROL_TOPIC` (lines 292-304), delegate to `HostControlManager` or ignore
2. `poc/meet-webrtc-core/src/host/hostTokenVerifier.ts` — freshness comment/code-truth alignment only (keep 10s; no 5s tightening without ADR)
3. `poc/meet-webrtc-core/src/host/hostControlManager.ts` — ensure sole verification gate (no new `setAuthoritativeHost` writers)

Any diff touching other frozen paths (Table F: `src/auth/token.ts`, `src/utils/roomUrl.ts`, `src/utils/qr.ts`, `src/sframe/**`, `src/keys/**`, `src/signaling/client.ts`, `services/meet-signal/main.go`, `services/meet-sfu-manager/main.go`, `services/turn-auth/main.go`, `infra/*`, `docs/M4A-*`, `docs/adr/ADR-006*`, `docs/adr/ADR-007*`) is **out of allowlist** → FAIL and requires separate ADR.

Machine check:

```bash
# allowlist 3 paths — SEC-01A diff must be subset of allowlist
git diff --name-only HEAD | grep -vE 'src/presence/presenceAdapter\.ts|src/host/hostTokenVerifier\.ts|src/host/hostControlManager\.ts' | grep -E 'src/host/|src/presence/|src/auth/token|src/utils/roomUrl|src/utils/qr|src/sframe|src/keys|src/signaling|services/|infra/' && echo "FAIL: allowlist violation" && exit 1 || echo "PASS: allowlist clean"
```

### 3.3 Reviewers

- Required reviewers: `security+architect+backend` (all three must approve).
  - `@security` — 7-vector verification (V1-V5 + ORDER + SENDER), STRIDE re-check, freshness 10s code-truth sign-off
  - `@architect` — ordering invariant, single-owner proof, HA/RTO non-regression, pivot honesty
  - `@backend` — `meet-signal` authority invariant untouched (no `authorityManager` / `RoomAuthority` change in this tranche)

Optional but non-blocking: `@privacy`, `@qa`, `@reviewer` (adversarial) may comment; they do not substitute for the three required.

### 3.4 Gates — `tsc/suite/greps/adversarial`

All four gates must be PASS before merge:

| Gate | Command | PASS Threshold |
|------|---------|---------------|
| **tsc** | `cd poc/meet-webrtc-core && node node_modules/typescript/bin/tsc -p tsconfig.app.json` | 0 errors |
| **suite** | `npm --prefix poc/meet-webrtc-core test` (vitest, jsdom) | ≥215 tests, 0 M0-M3B regressions; `m4a-sec01-verifier.test.ts` 7/7 V1-V5/ORDER/SENDER PASS; `m4a-sec01-order-sender.test.ts` PASS |
| **greps** | `grep -n "setAuthoritativeHost" poc/meet-webrtc-core/src/presence/presenceAdapter.ts` → 0; `grep -rn "setAuthoritativeHost" poc/meet-webrtc-core/src --exclude="presenceStore.ts" --exclude="hostControlManager.ts"` → 0; `grep -rn "hostKey" poc/meet-webrtc-core/src/host/` no DataChannel import | All three greps PASS (see §1.1 + §2) |
| **adversarial** | `npm --prefix poc/meet-webrtc-core run adversarial` (`tsx scripts/run-adversarial-test.ts`) + manual DataChannel harness: publish `JSON.stringify({action:'host-changed', newHostId:attackerId})` on `HOST_CONTROL_TOPIC` from non-host | Rejected (no `setAuthoritativeHost`, logged anomaly, `presenceStore.hostId` unchanged) |

### 3.5 Merge

- **Squash-merge to `main`** only after `security+architect+backend` approvals and all four gates green.
- Squash commit message must reference this contract: `SEC-01A: ordering invariant (no setAuthoritativeHost before verifyDirective) — see docs/adr/ORDERING-CONTRACT-SEC01A.md`.
- No co-tag on squash commit (see §4).

### 3.6 Restart, Rotation, Audit-Zero

After squash-merge to `main`:

1. **Restart** — rolling restart of `meet-signal` and `meet-sfu-manager` (Compose: `docker compose -f infra/compose.yaml up -d --build`; K8s: `kubectl rollout restart deployment/meet-signal meet-sfu-manager`). Verify health: `curl -f http://localhost:8080/healthz` and `:8081/healthz`.
2. **Rotation** — force key rotation: trigger `epoch_secret` ratchet via synthetic `leave`/`join` or admin `POST /room/create` in staging; measure `qa/reports/key-rotation-latency.json` p95 ≤500ms (20 trials). Verify `sender_key = HKDF(epoch_secret, "sframe", sender_id)` and Wireshark ciphertext continuity.
3. **Audit-zero** — audit log must show **zero** unverified `setAuthoritativeHost` invocations post-restart:
   ```bash
   # audit-zero: no authorization anomalies for host-changed without verification
   grep -c "authorization anomaly" logs/meet-signal.json | awk '{if($1==0) print "PASS: audit-zero"; else print "FAIL: anomalies="$1}'
   # plus grep checks from §1.1 still PASS on main
   ```

---

## 4. ADR-007 §2 No-Co-Tag Note (Binding)

Per `docs/adr/ADR-007-latch-staged-rename.md` §2 (M4A / M4A.1 Status Correction):

> **M4A implementation has passed technical review but has not completed repository closure, merge, and acceptance tagging.**
> `m4a-accepted` and `m4a.1-accepted` must NOT be created at same commit unless same revision genuinely accepted. Each milestone acceptance tag must correspond to a distinct, verified closed revision. Co-tagging two milestones on one commit without dual-milestone acceptance evidence is prohibited. Dirty working tree proves not closed.

Application to SEC-01A:

- The squash-merge commit for SEC-01A **MUST NOT** be co-tagged `m4a-accepted` + `m4a.1-accepted` (or `m4a-accepted` + `sec01a-accepted`) on one commit. SEC-01A is a blocker fix, not a milestone acceptance. Milestone tags remain per ADR-007 §2 distinct-revision rule and require `git tag --list` verification with clean `git status --porcelain=v1`.
- `docs/M4A-exit-report.md` carries an Errata banner and is technical-review evidence only — never cite it as proof of closure. ADR-007 §2 is the authoritative closure record.
- The `m4a-accepted` tag does NOT exist at the date of this contract (verified via `git tag --list` 2026-09-12) — matches ADR-007 §2 inventory.

---

## 5. Sign-Off

| Role | Handle | Date | Verdict | Signature |
|------|--------|------|---------|-----------|
| Principal Architect | @architect | 2026-09-12 | CONTRACT ISSUED — PENDING SIGNATURE | **PENDING SIGNATURE** |
| Security | @security |  | PENDING | **PENDING SIGNATURE** |
| Backend | @backend |  | PENDING | **PENDING SIGNATURE** |
| QA | @qa |  | PENDING | **PENDING SIGNATURE** |
| Reviewer (Adversarial) | @reviewer |  | PENDING | **PENDING SIGNATURE** |
| PM | muse-spark-1.2-contributor-free |  | PENDING consolidation | **PENDING SIGNATURE** |

> **PENDING SIGNATURE** — This contract is issued as a formal closure artifact. No code changes are authorized by this document alone. Implementation on `fix/sec01-*` requires Security+Architect+Backend approvals and `tsc/suite/greps/adversarial` gates per §3.4 before squash-merge to main, followed by restart, rotation, and audit-zero per §3.6.

---

## 6. Deliverable Index

- Ordering invariant: §1.1 — no setAuthoritativeHost before verifyDirective completes; participant?.identity authoritative, msg.senderId ignored — with machine greps and test vector refs
- Key provenance: §2 — server responses only; DataChannel hostKey untrusted — with V3 mitigation and grep
- Sequence: §3 — branch fix/sec01-*, allowlist 3 paths, reviewers security+architect+backend, gates tsc/suite/greps/adversarial, squash-merge main, restart rotation, audit-zero
- ADR-007 §2 no-co-tag note: §4
- Sign-off: §5 — PENDING SIGNATURE

*End of ORDERING-CONTRACT-SEC01A — Formal closure artifact, no logic changes.*

