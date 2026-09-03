# ADR-001 — SFU Primary, P2P 1:1 Fallback, MCU Only for Composition

**Status:** `ACCEPTED` — `REVIEW REQUIRED` — NOT SELF-APPROVED | **Date:** 2026-09-01 | **Author:** @architect (Principal Architect) | **Deciders:** @architect + @webrtc + @backend + @reviewer (adversarial)
**Refs:** `docs/M0-P0.md` §2/4 (Freeze), `docs/architecture-brief.md` §3/6/9, `docs/c4/p0-context.md`, `docs/media-layer-roadmap.md` §1/3, `docs/ROADMAP.md` §4
**Supersedes:** Prior roadmap M1/M2 P2P↔SFU handoff and MCU recording assumptions — FROZEN per `M0-P0.md` §2

> **Gate Status:** This ADR is **REVIEW REQUIRED**. Merge requires 5 gate approvals + `p0-gate-verify` from @qa per `docs/M0-P0.md` §2. Do NOT self-approve.

---

## Context

M0-P0 must prove **single-SFU 20p + SFrame E2EE** via `docker compose up` before any Zoom depth. Prior roadmap proposed:

- P2P for 1:1 with seamless SFU handoff at 3rd participant
- SFU cascaded mesh (3-5 nodes) for 20-100p
- MCU `meet-composer` for recording/transcription (decode + mix)
- Webinar fanout 1000p

Per `M0-P0.md` §2/4, all of the above beyond **single SFU for ≤20p** are **FROZEN** until P0 GO. P2P↔SFU handoff, WebTransport, anonymous guest links, webinar fanout, HLS remain behind `?labs=1` if at all.

Question for ADR-001: **What is the primary forwarding topology for P0, and what is explicitly frozen?**

## Decision

**Accepted — SFU primary for P0, with constraints:**

1. **P0 primary: Single LiveKit Go SFU 1.25** (see ADR-004) — handles all P0 rooms (0-20p). No P2P handoff magic. Even 1:1 and 2p go via SFU in P0 (simplest E2EE proof). P2P preferred → SFU fallback is **FROZEN** for P0 (may be re-enabled post-GO for 1:1 cost optimization, but not before).
2. **P2P mesh ≤5p** exists only as **honest downgrade pivot Option A** (see `architecture-brief.md` §9 + ADR-002) — not as P0 primary. If P0 NO-GO, 48h pivot proposal may re-activate mesh-E2EE capped 5p + non-E2EE SFU for >5 with explicit consent. Until then, do not implement.
3. **MCU `meet-composer` (decode/mix/transcode) is FROZEN.** No recording, no PSTN, no virtual-bg server path. Only **client-encrypted blobs** (`MinIO` presigned, envelope key client-held) if needed. Server never decrypts media.
4. **SFU cascaded mesh (20-100p) and webinar fanout (1000p) are FROZEN** until P0 GO + cascade proof (see `architecture-brief.md` scale tier table).

**Consequences for P0 containers:**

| Service | P0 Reality | Frozen |
|---------|-----------|--------|
| `meet-signal` | stateless WSS + Redis pub/sub `signal:{roomId}`, presence TTL 24h | — |
| `livekit` | single node `livekit:1.25` `cpus: '2.0'` `LIVEKIT_E2EE_MODE=blind` | cascaded mesh, webinar fanout |
| `coturn` | single `coturn:4.6` + `turn-auth` HMAC 24h | 3-region Anycast (stub for P0) |
| `meet-sfu-manager` | HRW `roomId→SFU` single entry `SFU_NODES=livekit:7880` | multi-region geo-affinity |
| `meet-composer` | **NOT DEPLOYED** in `infra/compose.yaml` | all MCU work |

## Rationale

- **Proof before depth:** M0-P0 §8 GO definition requires "payload-opaque routing proven OR documented fallback" for 20p. Proving SFU + SFrame at 20p is strictly harder than P2P 1:1 — hence SFU primary proves the architecture.
- **No magic handoff:** P2P↔SFU seamless handoff was flagged by @reviewer as v1 cut (see `ROADMAP.md` §8) — adds 10s timeout + double ICE, distracts from SFrame 500ms rotation proof.
- **Privacy:** SFU never decrypts (opaque forward). MCU would need plaintext — violates E2EE promise, so FROZEN until opt-in client-envelope recording is gated by consent (Privacy F-3).
- **Ops:** Single SFU in Compose (`docker compose up`) validates ≤50 rooms deterministically via HRW (see `docs/design/consistent-hashing-roomId-to-SFU.md`); K8s parity is same binary, no re-architect.

## Consequences

- @backend: LiveKit single-SFU wiring in `infra/compose.yaml` + Helm parity, HRW manager, no MCU.
- @webrtc: `meet-webrtc-core` always via SFU, simulcast 3×2, SFrame/WASM, no `p2pPreferred` flag in P0.
- @frontend: No P2P switch UI; shield shows SFU path always.
- @qa: 20p load via LiveKit only (19 fake + 1 real), no P2P test matrix for P0.
- Post-GO: P2P 1:1 optimization may resume only after P0 exit report + 5 gates + PM waiver per §2Freeze.

## Alternatives Considered

1. **P2P primary for 1:1 then SFU at 3p** — rejected for P0 timebox (adds handoff test surface, defers SFrame-at-scale proof).
2. **Mesh-E2EE for all ≤20p** — rejected (client CPU/battery fanout 19×, Safari iOS WebRTC limits).
3. **MCU mix for recording first** — rejected (breaks E2EE honesty, blocked by Privacy F-3 consent).

## Validation

- `infra/compose.yaml` contains no `meet-composer` service.
- `docs/c4/p0-context.md` L2 shows PWA → LB → LiveKit (SRTP/SFrame opaque), no P2P arrow.
- `docs/M0-P0-exit-report.md` must show SFU-only topology unless pivot triggers.

## Approval — REVIEW REQUIRED

| Role | Reviewer | Signature | Date | Verdict |
|------|----------|-----------|------|---------|
| @architect | Principal Architect | _________________ | 2026-09-01 | Accepted (author, not approver) |
| @webrtc | Media Lead | _________________ | ☐ | PENDING REVIEW |
| @backend | Backend Lead | _________________ | ☐ | PENDING REVIEW |
| @reviewer | Adversarial Reviewer | _________________ | ☐ | PENDING — must sign “SFU-primary not premature scale” or waiver |
| @security | Security | _________________ | ☐ | PENDING |
| @qa | QA | _________________ | ☐ | PENDING — `p0-gate-verify` required |

**Merge blocked until 5 gates + `p0-gate-verify` label per `docs/M0-P0.md` §2.**

*End of ADR-001.*
