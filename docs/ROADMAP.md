# Meet Secure Core — Privacy-First PWA Conferencing Platform
## Complete Roadmap v0.1 — Proton Meet × Zoom Depth × Google Meet Simplicity

**Product Manager / Program Manager:** muse-spark-1.2-contributor-free (Coordinator)  
**Date:** 2026-08-31 — **Amended 2026-08-31 by PM: M0-P0 ACTIVE**  
**Status:** 🚨 **FROZEN — M0-P0 in progress (see `docs/M0-P0.md`). No Zoom feature set until P0 passes.** Draft prior plan preserved below for reference.

> **🚨 FREEZE NOTICE — M0-P0 ACTIVE:** Per 2026-08-31 priority, feature development is **FROZEN**. `docs/M0-P0.md` is now the single source of truth. Success = 10 criteria (cross-browser, 20p, LiveKit, SFrame, screen share, rotation ≤500ms, reconnect ≤5s, TURN, Lighthouse >95, no telemetry). Hard constraint: **Do not build any Zoom-style feature set until M0-P0 passes.** See `docs/M0-P0.md` §2 for frozen scope.
>
> **Delegation Model:** PM does not implement. All work delegated to @architect, @frontend, @backend, @webrtc, @security, @privacy, @qa, @reviewer. Feature completion requires ALL five gates.

---

## 1. Vision & Product Principles

**Tagline:** *Meet that can't spy — even on itself.*

| Principle | Proton Meet Inspiration | Zoom Depth | Google Meet Simplicity |
|-----------|-------------------------|------------|------------------------|
| **Privacy-first** | E2EE by default, no tracking, minimal metadata (TTL 24h), self-hostable, client-side keys (X25519 + MLS/SFrame) | — | — |
| **Feature depth (progressive disclosure)** | — | Breakouts, polls, reactions, whiteboard, captions, virtual bg, noise suppression | hidden until needed |
| **Simplicity** | — | — | 1-click join (capability link `.../r/{id}#k=`), pre-join preview, no account required, 3-tiles-by-default |

**Non-negotiables:**
- W3C-only, no native app required (PWA installable, offline shell)
- No analytics SDK, no cookies, no UA sniffing. VAPID push (not FCM). Zero telemetry by default.
- Self-hostable single `docker compose up` → <50 rooms. Cloud = same binaries on K8s.
- ADRs for every contested decision.

**Target users:** Privacy-sensitive orgs (legal, health, journalism), EU SMEs needing GDPR, crypto-native teams, self-hosters.

---

## 2. Architecture Overview (Delegated to @architect — Pending Final Approval)

**Brief persisted:** `docs/architecture-brief.md`

**Stack:**
- **PWA Frontend:** React 18 + TS + Vite 5, Workbox (GenerateSW), Zustand + React Query, CSS Modules, WASM `wasm-sframe` worker
- **Media:** SFU-first (LiveKit preferred over mediasoup, POC needed ADR-004), P2P only for 1:1 with SFU fallback, SFrame RFC9605 via Insertable Streams / Encoded Transform, simulcast/SVC (3 spatial × 2 temporal), Dynacast / Last-N=9
- **Signaling:** Stateless `meet-signal` over WSS TLS1.3 + JSON/msgpack, JWT `5m` + nonce + aud=roomId, Redis Pub/Sub for horizontal scale. Stores `{roomId, participantHash, joinedAt}` TTL 24h only.
- **TURN/STUN:** Self-hosted `coturn` cluster Anycast `turns:3478/443`, HMAC ephemeral creds TTL 24h, IP purged 24h, opaque ciphertext relay.
- **Identity:** OIDC (Keycloak/Ory) + passphrase-derived X25519 (libsodium, IndexedDB-only, non-extractable CryptoKey), MLS/SFrame group keys via DataChannel HPKE, anonymous capability URLs with 30m single-use nonce.
- **State:** Postgres (account hash + pubkeys), Redis (ephemeral), S3/MinIO (client-encrypted blobs only). No media persistence default.
- **Composition:** Isolated `meet-composer` MCU only for opt-in encrypted recording (client envelope key).

```
Client A/B [PWA + SFrame/WASM] --WSS SDP/ICE--> LB --> meet-signal --> Redis
                           --SRTP/SFrame--> LB --> meet-sfu (LiveKit) 
                           --STUN/TURN--> coturn
                           --OIDC--> meet-id --> PG
                                 -.encrypted.-> S3
```

**Scale tiers:**

| Tier | Topology | Nodes | Notes |
|------|----------|-------|-------|
| 1:1 | P2P (SFU fallback) | 0 SFU | Zero cost, full E2EE |
| ≤20 | 1 SFU | 1× 1 vCPU/2GB per 50p | Hash roomId→SFU |
| 20-100 | Cascaded SFU mesh | 3-5/region | simulcast/Dynacast, Last-N |
| 1000 webinar | Fanout SFU (recvonly) + edge | 8-10/region | 2.5 Mbps/viewer, HLS fallback if not E2EE |

**ADRs Required:**
ADR-001 SFU primary ✓, ADR-002 SFrame+MLS (→ security), ADR-003 WSS vs WebTransport, ADR-004 LiveKit vs mediasoup (POC), ADR-005 coturn ephemeral ✓, ADR-006 OIDC+anon, ADR-007 no default recording ✓, ADR-008 Redis/PG/S3 split ✓, ADR-009 PWA Workbox ✓

---

## 3. Feature Prioritization

### 3.1 Framework: MoSCoW × RICE

Scored on Reach, Impact (privacy/simplicity), Confidence, Effort. Privacy blockers are P0 regardless of RICE.

### 3.2 Feature Matrix

| Feature | Inspiration | MoSCoW | RICE | Milestone |
|---------|-------------|--------|------|-----------|
| **1-click join, pre-join preview, mic/cam/leave** | Meet simplicity | Must | High | M0 — POC |
| **P2P 1:1 E2EE (SFrame)** | Proton | Must | High | M0 |
| **SFU group 20p, grid/spotlight, chat E2EE** | Zoom core | Must | High | M1 |
| **TURN HMAC + WSS JWT 5m** | Privacy | Must | High | M0 |
| **E2EE key verification (SAS/QR)** | Proton | Must | High | M0 — Security F-1 blocker |
| **Key rotation on join/leave (≤500ms)** | Security | Must | High | M0 |
| **CSP isolate IndexedDB keys** | Security | Must | High | M0 |
| **Self-host single compose, zero telemetry default** | Proton | Must | Med | M0 |
| **DSR/erasure endpoint + ROPA + data inventory page** | Privacy | Must | Med | M0 — Privacy F-1/F-2 blocker |
| **Recording consent flow (opt-in, per-participant DataChannel notice)** | GDPR | Must | Med | Blocks Recording |
| **TURN HMAC key rotation policy docs** | Privacy F-4 | Must | Med | M0 |
| **Simulcast/SVC, Dynacast, Last-N=9, bandwidth adapt (transport-cc)** | Zoom quality | Should | High | M1 |
| **Virtual bg (MediaPipe WASM), noise suppression (RNNoise)** | Zoom depth | Should | Med | M2 |
| **Breakout rooms, polling, reactions, hand raise** | Zoom depth | Should | Med | M2 |
| **Live captions (on-device Web Speech)** | Zoom/Meet | Should | Med | M2 |
| **Whiteboard (E2EE DataChannel)** | Zoom depth | Could | Med | M3 |
| **Webinar 100p → 1000 fanout** | Zoom scale | Could | Low | M3 |
| **Client-encrypted recording (envelope, user TTL)** | Zoom | Could | Med | M2+ (gated by consent) |
| **Anonymous guest links (capability, IP-hash bind)** | Simplicity | Could* | Med | M2* — *Risk: reviewer says defer to Phase 2; keep behind flag |
| **P2P↔SFU seamless handoff** | Perf | Could* | Low | M3* — *Reviewer: cut for v1; SFU ≥3 directly |
| **WebTransport (QUIC) signaling** | Future | Won't (now) | Low | ADR-003 future |

**PM Decision on Simplicity vs Depth Tension (per @reviewer challenge):**
Ship *Meet-simple default* with progressive disclosure. Host badge → hold to reveal advanced. Do not ship all Zoom features at once. For v1: Must = meeting works privately, simply. Should = quality + 2-3 delight features. Could = gated behind `?labs=1` flag.

---

## 4. Milestone Plan (26 weeks) — **SUPERSEDED BY M0-P0 — FROZEN**

> **2026-08-31 PM Amendment:** The 26-week plan below is **FROZEN** and not authoritative until `docs/M0-P0.md` passes GO/NO-GO. Retained for continuity only. Current authority: **M0-P0 4-week validation sprint**. All references to M1/M2/M3 below map to *post-GO* phases and require explicit PM unblock + 5 gates.

### 4.0 M0-P0 — Current Active Milestone (Weeks 0-4) — Make-or-Break Media Architecture

**See `docs/M0-P0.md` — 10 success criteria, 4-week timebox, 5 gates, GO/NO-GO pivot. Hard freeze on Zoom depth.**

| Sprint | P0 Focus | Owner | Artifact / Gate |
|--------|----------|-------|-----------------|
| W1 | Scaffold + Safari POC | @architect+@backend+@frontend+@webrtc | Compose (PG/Redis/coturn/LiveKit), `/join/:id`, Safari+H264+WASM proof |
| W2 | SFrame 20p + Key Rotation POC | @webrtc+@backend+@security | Ciphertext forwarding (Wireshark), 20p load stable, rotation ≤500ms, ADR-004 |
| W3 | Resilience + Screen share + TURN + Perf | @webrtc+@frontend+@backend+@qa | ICE restart <5s, TURN relay, screen share 4 browsers, Lighthouse >95 |
| W4 | Gates + Exit Report | All 5 gates → PM | 10 criteria green + 5 approvals + `M0-P0-exit-report.md` → GO/NO-GO |

**Pre-unblock note:** M1 “Core Group 20p Alpha”, M2 “Depth”, M3 “Webinar GA” below are **NOT STARTED** until M0-P0 GO.

---

## 4.1 Legacy Milestone Plan (FROZEN — For Reference Only)

### Phase 0: Foundation & Gates (Weeks 0-4) — “Can we do E2EE + SFU without lying?”

**Goal:** Prove the hardest assumption or pivot.

| Sprint | Outputs | Owner | Gate |
|--------|---------|-------|------|
| W0 | Repo scaffolding: Vite+TS+Workbox, `meet-signal` WSS skeleton, coturn local, PG/Redis compose, `docs/architecture-brief.md` | @backend + @architect | ADR-001/005 |
| W1-2 | Frontend shell: `/join/:id`, lobby, media picker, Zustand stores, shield UI placeholder | @frontend | — |
| W2-3 | **POC — Safari + H264 + LiveKit + 20p + SFrame** — synthetic load, WASM fallback, Dynacast/Last-N vs E2EE (see §8 reviewer response) | @webrtc + @frontend | **GO/NO-GO DECISION** |
| W3-4 | Security conditions: SAS/QR verify, sync rotation ≤500ms, CSP `wasm-unsafe-eval`, TURN audit log, Argon2id docs | @security + @backend | Security APPROVED |
| W3-4 | Privacy blockers: DSR endpoint, ROPA, data inventory, TURN rotation policy, zero-telemetry statement | @privacy + @backend | Privacy APPROVED |

**Exit criteria:** POC passes (SFrame ciphertext forwards *and* layer selection remains usable). If not, pivot to mesh-E2EE (≤5p) + SFU relay as non-E2EE option — honest downgrade, not facade. Zero telemetry, DSR, CSP merged. All 5 gates reviewed.

### Phase 1: Core Group (Weeks 5-10) — M1 SFU 20p

- SFU LiveKit deployment, consistent hashing, Redis pub/sub
- Simulcast 3×2, Dynacast/Last-N (with SFrame-aware routing — POC validated mode), transport-cc.
- E2EE via MLS sender-key ratchet (simpler than full MLS — see §8)
- Shield verified state, lobby + host controls (admit/mute/lock)
- **QA:** cross-browser E2E (Playwright) chrome/firefox, ICE failure → TURN fallback, 20p load (CPU <30%, p50 <150ms, p95 <300ms), privacy scan clean
- **Deliverable:** Alpha — 20p private meeting, self-hostable, installable PWA

### Phase 2: Depth (Weeks 11-18) — M2 100p + delight

- Cascaded SFU mesh, WebRTC perf budgets (Lighthouse ≥95, bundle <120kB gz, WASM integrity hash)
- Virtual bg, RNNoise, breakout rooms, reactions/polls, live captions (on-device)
- Encrypted recording (only after consent flow shipped — gated)
- Anonymous links behind flag (if MLS simplified)
- **QA:** 100p load (SFU mem <200MB, jitter <30ms), background-tab suspension, permission denial, key rotation under load
- **Deliverable:** Beta — public beta for EU SMEs, self-host image v0.5

### Phase 3: Scale (Weeks 19-26) — M3 1000 webinar

- Fanout SFU tier (recvonly edge), HLS fallback for non-E2EE webinar, geo-affinity
- Whiteboard (E2EE DataChannel), polling history (encrypted blob)
- TURN capacity plan (see §8 cost fix — 4-8 nodes per 1000 with 30% TURN rate)
- WCAG 2.2 AA audit (axe-core CI gate), battery <5%/hr idle, memory <150MB @1080p
- **QA:** 1000p mixed audio/video, Safari green, P50 ≤150ms P95 ≤300ms, packet loss <0.5%, startup <5s
- **Deliverable:** GA v1.0 — self-host + cloud, DPA available, pentest completed, signed PWA auto-update

### Gantt Summary

```
W0-4  [Foundation + POC GO/NO-GO]
W5-10       [M1 Core 20p Alpha]
W11-18            [M2 Depth 100p Beta]
W19-26                  [M3 Webinar GA]
Gates: A S P Q R at each phase exit ──► feature NOT DONE until 5 gates pass
```

---

## 5. Cross-Cutting Workstreams (Delegated)

| Workstream | Lead | Key Deliverables | Milestone |
|------------|------|------------------|-----------|
| **Frontend/PWA** | @frontend | Workbox shell, progressive disclosure UX, shield indicator, SAS verify, accessibility, Perf budgets | M0-M3 |
| **Backend/SFU** | @backend | meet-signal/id/sfu/storage, WSS+JWT, Redis hash ring, LiveKit orchestration, compose+K8s | M0-M3 |
| **Media/WebRTC** | @webrtc | `docs/media-layer-roadmap.md`, SFrame/WASM, simulcast, ICE restart, TURN Anycast, cascade | M0-M3 |
| **Security** | @security | STRIDE 8 threats, JWT/TURN hardening, CSP, supply chain SBOM, pentest scope | Gates M0,M1,M3 |
| **Privacy** | @privacy | Minimization table, GDPR/ePrivacy/CCPA checklist, consent flow, self-host vs cloud DPA | Gates M0,M1 |
| **QA** | @qa | Vitest/Jest, Playwright E2E, synthetic media, tc netem, Grafana perf, privacy scans, release criteria | Each M |
| **Adversarial** | @reviewer | Challenges SFrame+SFU, H264/Safari, 1000p client decrypt, MLS centralization, TURN cost | Continuously |

---

## 6. Security Review Summary (Delegated to @security — CONDITIONAL APPROVAL)

**Status:** 🟡 PENDING — Approved with Conditions (5 mandatory for Sprint 0)

1. **SFrame key verification UX (SAS/QR)** — High — blocks E2EE verified badge
2. **Sync key rotation on leave ≤500ms** — High — zeroize on leave
3. **CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`** — High
4. **TURN credential audit logging** — Medium
5. **Argon2id params for X25519 derivation** — Medium

Plus 8 STRIDE mitigations (signal spoofing JWT bind, SFU hardening no-shell, TURN HMAC limits, XSS IndexedDB isolate, supply chain lockfile+Socket.dev, capability URL nonce+expiry, IndexedDB logout purge). WASM hash verify at load, audit log `{roomId,time,event,hash}` TTL 7d. Must re-review before M0 exit.

## 7. Privacy Review Summary (Delegated to @privacy — CONDITIONAL APPROVAL)

**Posture:** Strong — matches/exceeds Proton minimalism. No analytics, VAPID not FCM, 24h purge, hash-only PG, encrypted blobs.

**Blockers (must in Sprint 0):**
- F-1 DSR/erasure endpoint (GDPR Art.17/CCPA)
- F-2 ROPA + data inventory page (Art.30)
- F-3 Recording consent flow (opt-in banner + per-participant DataChannel notice + audit client-side) — HIGH
- F-4 TURN HMAC rotation policy documented
- F-5 Data portability export (Art.20) — Sprint 1 ok
- F-6 Zero-telemetry explicit statement — doc only

Consent UX: JIT notice “No media recorded. E2EE.” Ephemeral room hashes via `k#` fragment.

## 8. Reviewer Challenge & PM Response (Delegated to @reviewer — CONDITIONS)

**Reviewer Verdict:** Proceed only with conditions — 5 risks.

| # | Challenge | PM Response & Mitigation (Roadmap Update) |
|---|-----------|-------------------------------------------|
| ① | SFrame + SFU forwarding contradictory (can't inspect layers for Dynacast/Last-N while E2EE) | **POC GO/NO-GO in W2-3** is gating. Mitigation: Adopt SFrame header-aware but payload-opaque routing — SFU reads only KID/frame-metadata (not content) to select SSRC/layer; if incompatible with LiveKit Dynacast, fallback to SFU-blind forwarding (ship *all* layers for small groups, cap 20p) and document tradeoff. No privacy facade. |
| ② | H264 E2EE unreliable across browsers | Prioritize **VP9 SVC** first (better SVC + E2EE), H264 baseline as fallback. WASM SFrame 150KB budget accounted, latency +15ms measured in POC. |
| ③ | Safari Insertable Streams gap worse, WASM GPU compositing drops | POC matrix explicitly includes Safari 17 WebKit + iOS PWA. If flagged, require WASM polyfill + `OffscreenCanvas` + `VideoFrame` recycle; degrade to DTLS-only with ⚠️ warning if SFrame unavailable — no silent downgrade. |
| ④ | 1000p E2EE client decrypt not planned | Scope E2EE webinar to **100p E2EE**; 1000p webinar is **non-E2EE** fanout with HLS CDN + explicit consent — honest tiers. Client WASM contention tested under load in M3, cap E2EE at proven limit (not 800 claim). |
| ⑤ | MLS central KMS backdoor (trusted authority) | Replace full MLS with **per-room sender-key ratchet** (simpler, fewer rounds, auditable, no central KMS). Central KMS removed; rotation via DataChannel broadcast + epoch. |

**Cost Fix:** TURN sized separately — 30% TURN rate @1.8 Mbps → 1.8 Tbps for 1000p → 4-8 coturn nodes (8 vCPU/32GB) + Anycast. Self-host single-node claim clarified: “single compose for ≤50 p2p/SFU-small; K8s required beyond.”

**Simplicity Fix:** Cut for v1 — anonymous guests + P2P handoff + client recording behind `labs` flag. Core v1 is SFU ≥3 directly, no handoff magic.

---

## 9. Governance — 5 Gates Required Before Feature Completion

Per program rules: **Never approve own work. Require architecture, security, privacy, QA, reviewer challenge before feature completion.**

| Gate | Reviewer | Artifact | M0 Exit | M1 Exit | GA Exit |
|------|----------|----------|---------|---------|---------|
| Architecture | @architect | `docs/architecture-brief.md` + ADRs | ✓ POC validated | ✓ cascade design | ✓ webinar fanout |
| Security | @security | STRIDE + CSP + pentest | ✓ 5 conditions | ✓ re-review | ✓ pentest sign-off |
| Privacy | @privacy | Minimization + GDPR checklist + DSR | ✓ F1-F4 | ✓ F5 | ✓ DPA + audit report |
| QA | @qa | Test matrix + perf budgets + privacy scans | ✓ 2 participants | ✓ 20/100p | ✓ 1000p, Safari |
| Adversarial | @reviewer | Challenge doc + GO/NO-GO | ✓ POC decision | ✓ TURN sizing | ✓ final risk sign-off |

**No milestone marked Done until all 5 gates ✅.** Delegation-only: PM coordinates, does not implement.

---

## 10. Risks & Dependencies

| Risk | Owner | Mitigation |
|------|-------|------------|
| Safari E2EE gap | @webrtc | POC oldest-Safari, WASM fallback, degrade gracefully |
| LiveKit vs mediasoup uncertainty | @architect | ADR-004 POC week 2, decision by M0 exit |
| TURN cost blowup | @backend/@reviewer | HPA + rate limits + priority queue, cost dashboard |
| Feature creep (Zoom vs Meet) | PM | Progressive disclosure + labs flag, RICE veto |
| Battery/mobile | @frontend/@webrtc | Adaptive encoding, requestVideoFrameCallback, suspend hidden tracks |
| Supply chain | @security | Lockfile, Socket.dev, SBOM, signed CI artifacts |

---

## 11. Next Actions (Immediate)

1. **PM** Schedules POC sprint (W2-3) — @webrtc + @frontend + @architect
2. **@backend** Implements DSR `DELETE /accounts/me` + `GET /data-inventory` (Privacy F-1/F-2)
3. **@security** Lands CSP + SAS verify component
4. **@qa** Sets up Playwright matrix + `tc netem` CI + Grafana
5. **All** Review this roadmap — 5 gate approvals needed to exit M0

---

*Roadmap incorporates: architect brief, security conditional approval (5), privacy conditional approval (F1-F6), webrtc media plan M0-M3, frontend PWA plan M1-M6, backend 8 milestones, QA test strategy (20/100/1000), reviewer adversarial 5-risk challenge with mitigations.*
