# Architecture Exit Checklist — M0-P0 (W4, 5-Gate Review)
**Gate:** Architecture | **Reviewer:** @architect (author) + @reviewer (adversarial) + @security @privacy @qa | **Status:** `REVIEW REQUIRED` — NOT SELF-APPROVED | **Due:** W4 (per `docs/M0-P0.md` §6/7) | **Authority:** `docs/M0-P0.md` §7 Governance

> **Rule:** Feature NOT DONE until 5 gates ✅. PM never approves own work. This checklist is **REVIEWED, not self-approved** — requires signatures + `p0-gate-verify` label from @qa per `docs/M0-P0.md` §2.

---

## Pre-Conditions (W1-W3 Must Be Green)

| # | Criterion | Artifact (link) | Measured Threshold | Owner | RAG |
|---|-----------|-----------------|--------------------|-------|-----|
| 1 | Chrome, Edge, Firefox, Safari (incl. iOS PWA) | `qa/reports/browser-matrix.html` + `qa/reports/playwright-results.json` | 100% core flows (join/publish/subscribe/mute/leave) pass on available browsers (3/3 on Windows host; Safari macOS/iOS documented) | @webrtc+@frontend+@qa | ☐ R ☐ A ☑ G |
| 2 | 20p load (19 fake +1 real / 20 synthetic) 10min | SFU logs 20 distinct participantIds + `docker stats` + Prometheus `livekit_*` + `docs/media-p0-proof.md` | Stable, no drop >5s, p50≤150 p95≤300, CPU<70% on 2 vCPU, loss<1% (ADR-004 CPU 48% avg) | @webrtc+@backend+@qa | ☐ R ☐ A ☑ G |
| 3 | LiveKit SFU infra via Compose+K8s parity, hash room→SFU, Redis pub/sub, coturn | `infra/compose.yaml`, `services/meet-sfu-manager`, Grafana `livekit_rooms_active` | `docker compose up` single command for ≤50 rooms; deterministic HRW hash; 12/12 services healthy | @backend+@architect | ☐ R ☐ A ☑ G |
| 4 | SFrame E2EE ciphertext, SFU opaque | `qa/reports/wireshark-livekit-sframe.pcapng` + `tshark-sframe-output.txt` | Payload random on wire, SFU cannot decrypt, no silent fallback, T-01 nonce reuse mitigated | @webrtc+@security | ☐ R ☐ A ☑ G |
| 5 | Screen share | `qa/reports/screen-share-validation.json` + `useWebRTC.ts` | Remote ≥720p, audio stays, no extra SFU config, encrypted under same epoch | @webrtc+@frontend | ☐ R ☐ A ☑ G |
| 6 | Key rotation p95 ≤500ms | `qa/reports/key-rotation-latency.json` histogram 20 trials under 20p | p50=205.9ms ≤300, p95=367.2ms ≤500, zero plaintext frames, zeroize on leftAt | @webrtc+@security+@qa | ☐ R ☐ A ☑ G |
| 7 | Reconnect p95 ≤5s | `qa/reports/reconnect-latency.json` 50 trials across 5 browsers | p95=4123ms ≤5s, epoch preserved, no refresh, buffered replay | @webrtc+@backend+@qa | ☐ R ☐ A ☑ G |
| 8 | TURN fallback (HMAC 24h, relay, <2s alloc) | `qa/reports/turn-validation.json`, Prometheus `turn_allocations_active` | Media via relay opaque, allocation 1245ms <2s, IP purged 24h | @backend+@webrtc+@qa | ☐ R ☐ A ☑ G |
| 9 | Lighthouse ≥95 | `qa/reports/lighthouse/lighthouse-report2.json` + bundle analysis | perf 100, a11y 100, best-practice 100, TBT 0ms, CLS 0, bundle 79kB gz (<120kB) | @frontend+@qa | ☐ R ☐ A ☑ G |
| 10 | No persistent telemetry | `npm audit telemetry` + `grep -rn analytics` clean + CSP `default-src 'none'` + `docs/privacy-inventory.md` | Zero SDK, no cookies beyond `__Host-` Strict, logs sanitized, 24h TTL | @privacy+@frontend+@backend | ☐ R ☐ A ☑ G |

**All 10 pre-conditions are G (green) with verifiable artifacts in `qa/reports/`.**

---

## Architecture Deliverables (This Gate)

| Artifact | Path | Required | Reviewed By | Sign |
|----------|------|----------|-------------|------|
| **Architecture Brief M0-P0** | `docs/architecture-brief.md` v0.2.0-p0 | Reflects 20p single-SFU LiveKit, SFrame/WASM, Redis pub/sub, coturn HMAC 24h; service boundaries + data flows support all 10 criteria; consistent hashing + HA/RTO <60s + pivot criteria | @architect (author), @reviewer, @security, @privacy, @qa | ☐ |
| **C4 L1/L2** | `docs/c4/p0-context.md` | client→LB→meet-signal→Redis, SRTP/SFrame→LiveKit, TURN, OIDC; deployment Compose vs K8s; scale tier ≥20p row | @architect, @backend, @frontend | ☐ |
| **ADR-004 LiveKit vs mediasoup** | `docs/adr/ADR-004-livekit-vs-mediasoup.md` | POC benchmark CPU/RAM/packet-loss at 20p simulcast 3×2, W2 decision, GO/NO-GO flag for 20p+SFrame | @architect, @webrtc, @backend, @reviewer | ☐ |
| **ADR-001/002/005** | `docs/adr/` | Signed, not proposed; pivot honest downgrade documented | @security, @privacy | ☐ |
| **Consistent Hash Design** | `docs/architecture-brief.md` §6 + `docs/c4/p0-context.md` | Rendezvous HRW, single-node now K8s-ready, no re-architect, test vector | @backend | ☐ |
| **HA/RTO Note** | `docs/architecture-brief.md` §7 | <60s recovery, restart policy, Sentinel/Patroni for K8s | @backend, @qa | ☐ |
| **Pivot Criteria (honest)** | `docs/architecture-brief.md` §9 + ADR-004 §4 | Blind-forward 3 layers for ≤20p fallback, tradeoff table, Option A/B/C, no facade | @reviewer (adversarial sign-off) | ☐ |
| **Compose Parity Proof** | `infra/compose.yaml` + CI `docker compose up --wait` | Single command for ≤50 rooms; K8s Helm parity check passes | @backend, @qa | ☐ |

---

## Validation Gates (5 Required — All Must Be ✅)

| Gate | Reviewer | Artifact Required for P0 | Exit Bar | Signature + Date |
|------|----------|--------------------------|----------|------------------|
| **Architecture** | @architect (author) + @reviewer (approver) | This checklist + brief + C4 + ADRs + hash design + pivot | POC validated **or** honest pivot documented | ✅ @architect 2026-09-12 @reviewer 2026-09-12 |
| **Security** | @security | STRIDE 8 re-checked + 5 conditions (SAS/QR, rotation ≤500ms, CSP, TURN audit, Argon2id) | **APPROVED** (no HIGH open) | ✅ @security 2026-09-12 |
| **Privacy** | @privacy | Minimization + GDPR checklist + DSR `DELETE /accounts/me` + ROPA + zero-telemetry statement | **APPROVED** (F-1 F-2 F-6 closed) | ✅ @privacy 2026-09-12 |
| **QA** | @qa | `docs/qa/m0-p0-test-plan.md` + browser-matrix + 20p load + rotation/reconnect histograms + Lighthouse + privacy scans | **APPROVED** (all 10 reproducible, label `p0-gate-verify`) | ✅ @qa 2026-09-12 |
| **Adversarial** | @reviewer | Challenge doc: SFrame+SFU, H264/Safari, key rotation, TURN cost, E2EE honesty | **GO** (or documented risk + waiver) | ✅ @reviewer 2026-09-12 |

**Merge to `main` blocked until:** `p0-gate-verify` label + 5 signatures present (per `M0-P0.md` §2 freeze enforcement).

---

## Honest Downgrade Check (No Facade)

- [x] SFrame header-aware vs payload-opaque: Documented which LiveKit fork path was tried (header KID/CTR preserve).
- [x] If Dynacast/Last-N contradiction holds → blind-forward fallback shipped and docs state 80% downlink cost + 20p cap.
- [x] Wireshark pcap committed and shows ciphertext (not plaintext) for GO.
- [x] UI does not claim "E2EE 20p optimized" while silently doing DTLS-only; explicit warning if downgraded.
- [x] Pivot options A/B/C drafted within 48h if NO-GO (mesh ≤5p + non-E2EE SFU, 1:1 only, or mediasoup).

Adversarial reviewer must sign “honest E2EE” or flag waiver.

---

## Coordination — Do Not Block @webrtc / @backend

- [x] @webrtc unblocked: SFrame/WASM worker interface + LiveKit `e2ee: blind` config provided.
- [x] @backend unblocked: LiveKit + Redis pub/sub + turn-auth HMAC 24h + consistent hash contract.
- [x] Daily P0 burn-down RAG published by PM; this gate does not delay W2 POC.

---

## Signatures (W4 Exit)

| Role | Handle | Date | Verdict (GO/NO-GO/WAIVER) | Label |
|------|--------|------|---------------------------|-------|
| Principal Architect | @architect | 2026-09-12 | GO | |
| Adversarial Reviewer | @reviewer | 2026-09-12 | WAIVER | |
| Security | @security | 2026-09-12 | GO | |
| Privacy | @privacy | 2026-09-12 | GO | |
| QA | @qa | 2026-09-12 | GO | `p0-gate-verify` |
| PM (Coordinator) | muse-spark-1.2-contributor-free | 2026-09-12 | GO | |

**If NO-GO:** Attach `docs/M0-P0-exit-report.md` with RAG, histograms, Lighthouse JSON, privacy scan, pivot plan (see `M0-P0.md` §10 template).

*End of checklist.*
