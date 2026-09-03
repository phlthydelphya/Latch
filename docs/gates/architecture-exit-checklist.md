# Architecture Exit Checklist — M0-P0 (W4, 5-Gate Review)
**Gate:** Architecture | **Reviewer:** @architect (author) + @reviewer (adversarial) + @security @privacy @qa | **Status:** `REVIEW REQUIRED` — NOT SELF-APPROVED | **Due:** W4 (per `docs/M0-P0.md` §6/7) | **Authority:** `docs/M0-P0.md` §7 Governance

> **Rule:** Feature NOT DONE until 5 gates ✅. PM never approves own work. This checklist is **REVIEWED, not self-approved** — requires signatures + `p0-gate-verify` label from @qa per `docs/M0-P0.md` §2.

---

## Pre-Conditions (W1-W3 Must Be Green)

| # | Criterion | Artifact (link) | Measured Threshold | Owner | RAG |
|---|-----------|-----------------|--------------------|-------|-----|
| 1 | Chrome, Edge, Firefox, Safari (incl. iOS PWA) | `qa/reports/browser-matrix.html` + video captures | 100% core flows (join/publish/subscribe/mute/leave/ICE restart) on 4 browsers, explicit ⚠️ if SFrame unavailable | @webrtc+@frontend+@qa | ☐ R ☐ A ☐ G |
| 2 | 20p load (19 fake +1 real / 20 synthetic) 10min | SFU logs 20 distinct participantIds + `docker stats` + Prometheus `livekit_*` | Stable, no drop >5s, p50≤150 p95≤300, CPU<70% on 2 vCPU, loss<1% | @webrtc+@backend+@qa | ☐ R ☐ A ☐ G |
| 3 | LiveKit SFU infra via Compose+K8s parity, hash room→SFU, Redis pub/sub, coturn | `infra/compose.yaml`, `charts/livekit`, `docs/c4/p0-context.md`, Grafana `livekit_rooms_active` | `docker compose up` single command for ≤50 rooms; deterministic hash; metrics visible | @backend+@architect | ☐ R ☐ A ☐ G |
| 4 | SFrame E2EE ciphertext, SFU opaque | `qa/reports/wireshark-livekit-sframe.pcapng` + shield verified | Payload random on wire, SFU cannot decrypt, no silent fallback | @webrtc+@security | ☐ R ☐ A ☐ G |
| 5 | Screen share | Manual 4-browser test + `getDisplayMedia` perms | Remote ≥720p, audio stays, no extra SFU config | @webrtc+@frontend | ☐ R ☐ A ☐ G |
| 6 | Key rotation p95 ≤500ms | `qa/reports/key-rotation-latency.json` histogram 20 trials under 20p | p50≤300 p95≤500, zero plaintext frames, zeroize on leftAt | @webrtc+@security+@qa | ☐ R ☐ A ☐ G |
| 7 | Reconnect p95 ≤5s | 10 trials/browser WSS kill + `tc` drop + `ice-restart` trace | p95≤5s, epoch preserved, no refresh, buffered replay | @webrtc+@backend+@qa | ☐ R ☐ A ☐ G |
| 8 | TURN fallback (HMAC 24h, relay, <2s alloc) | `chrome://webrtc-internals` stats `candidateType=relay`, Prometheus `turn_allocations_active` | Media via relay opaque, allocation <2s, IP purged 24h | @backend+@webrtc+@qa | ☐ R ☐ A ☐ G |
| 9 | Lighthouse ≥95 | `qa/reports/lighthouse/*.json` + bundle analysis | perf ≥95, a11y≥95, best-practice≥95, TBT<200ms CLS 0, bundle<120kB gz + WASM 150KB async + integrity | @frontend+@qa | ☐ R ☐ A ☐ G |
| 10 | No persistent telemetry | `npm audit telemetry` + `grep -r analytics` clean + CSP `default-src 'none'` + `docs/privacy-inventory.md` | Zero SDK, no cookies beyond `__Host-` Strict, logs sanitized, 24h TTL | @privacy+@frontend+@backend | ☐ R ☐ A ☐ G |

**If any row is R (red) or A (amber) → P0 fails → freeze continues, NO Zoom features.**

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
| **Architecture** | @architect (author) + @reviewer (approver) | This checklist + brief + C4 + ADRs + hash design + pivot | POC validated **or** honest pivot documented | ☐ @architect ____ @reviewer ____ |
| **Security** | @security | STRIDE 8 re-checked + 5 conditions (SAS/QR, rotation ≤500ms, CSP, TURN audit, Argon2id) | **APPROVED** (no HIGH open) | ☐ @security ____ |
| **Privacy** | @privacy | Minimization + GDPR checklist + DSR `DELETE /accounts/me` + ROPA + zero-telemetry statement | **APPROVED** (F1-F4 closed, F6 merged) | ☐ @privacy ____ |
| **QA** | @qa | `docs/qa/m0-p0-test-plan.md` + browser-matrix + 20p load + rotation/reconnect histograms + Lighthouse + privacy scans | **APPROVED** (all 10 reproducible, label `p0-gate-verify`) | ☐ @qa ____ |
| **Adversarial** | @reviewer | Challenge doc: SFrame+SFU, H264/Safari, key rotation, TURN cost, E2EE honesty | **GO** (or documented risk + waiver) | ☐ @reviewer ____ |

**Merge to `main` blocked until:** `p0-gate-verify` label + 5 signatures present (per `M0-P0.md` §2 freeze enforcement).

---

## Honest Downgrade Check (No Facade)

- [ ] SFrame header-aware vs payload-opaque: Documented which LiveKit fork path was tried (header KID/CTR preserve).
- [ ] If Dynacast/Last-N contradiction holds → blind-forward fallback shipped and docs state 80% downlink cost + 20p cap.
- [ ] Wireshark pcap committed and shows ciphertext (not plaintext) for GO.
- [ ] UI does not claim “E2EE 20p optimized” while silently doing DTLS-only; explicit warning if downgraded.
- [ ] Pivot options A/B/C drafted within 48h if NO-GO (mesh ≤5p + non-E2EE SFU, 1:1 only, or mediasoup).

Adversarial reviewer must sign “honest E2EE” or flag waiver.

---

## Coordination — Do Not Block @webrtc / @backend

- [ ] @webrtc unblocked: SFrame/WASM worker interface + LiveKit `e2ee: blind` config provided.
- [ ] @backend unblocked: LiveKit + Redis pub/sub + turn-auth HMAC 24h + consistent hash contract.
- [ ] Daily P0 burn-down RAG published by PM; this gate does not delay W2 POC.

---

## Signatures (W4 Exit)

| Role | Handle | Date | Verdict (GO/NO-GO/WAIVER) | Label |
|------|--------|------|---------------------------|-------|
| Principal Architect | @architect |  |  |  |
| Adversarial Reviewer | @reviewer |  |  |  |
| Security | @security |  |  |  |
| Privacy | @privacy |  |  |  |
| QA | @qa |  | `p0-gate-verify` |  |
| PM (Coordinator) | muse-spark-1.2-contributor-free |  | GO/NO-GO vote (per `M0-P0.md` §8) |  |

**If NO-GO:** Attach `docs/M0-P0-exit-report.md` with RAG, histograms, Lighthouse JSON, privacy scan, pivot plan (see `M0-P0.md` §10 template).

*End of checklist.*
