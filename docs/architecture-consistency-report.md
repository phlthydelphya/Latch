# Architecture Consistency Report — M0-P0 Reconciliation Pass

**Date:** 2026-09-01 | **Owner:** PM (muse-spark-1.2-contributor-free, Coordinator) | **Status:** `REVIEW REQUIRED — NOT SELF-APPROVED`
**Authority Order:** 1) `docs/M0-P0.md` 2) `AGENTS.md` 3) `docs/architecture-brief.md v0.2.0-p0` — all else subordinate
**Trigger:** M0-P0 Freeze per `AGENTS.md` Active Milestone + `docs/M0-P0.md` §2/4
**Scope:** HRW rendezvous vs ring, Redis pub/sub vs Streams, current M0 services vs future services, auth/key-management, recording/storage, scaling 20p vs 100/1000, frozen M1-M8
**Delegation:** Independently delegated to @architect, @webrtc, @backend, @security, @privacy, @qa, @reviewer. This report synthesizes their findings and surfaces disagreements. No production backend services written during this task per instruction.
**Gate Rule:** Documentation may be updated ONLY after 5 gates agree (Architecture, Security, Privacy, QA, Adversarial). This report is pending all 5 signatures — do not apply REQUIRED_EDITs until signed. PM never approves own work.

---

## Executive Summary

All authoritative docs (`M0-P0.md`, `AGENTS.md`, `architecture-brief.md`, `docs/c4/p0-context.md` majority, ADRs 001/002/004/005) are internally consistent on the P0 posture: **single LiveKit SFU 1.25, Rendezvous HRW `roomId→SFU`, Redis pub/sub `signal:{roomId}`, client-held X25519 + MLS-lite ratchet (no central KMS), blind-forward 3 layers for ≤20p (80% overhead, Last-N=9), single coturn HMAC 24h, frozen scope `breakouts/polls/reactions/whiteboard/virtual bg/captions/recording/meet-composer/webinar 100-1000/HLS/anon k#/P2P↔SFU handoff/WebTransport`.**

**20 contradictions** found in subordinate / pre-freeze docs (`BACKEND_ROADMAP.md`, `docs/media-layer-roadmap.md`, `docs/ROADMAP.md`, plus 3 internal drifts within authoritative-affiliated docs). Root cause: pre-freeze roadmap language persisted verbatim after 2026-08-31 freeze without `FROZEN` banners.

- **8 CRITICAL** — blocks GO/NO-GO or violates E2EE/privacy promise if implemented (Streams vs pub/sub, ring vs HRW, central KMS, anon links active, P2P handoff active, fabricated histograms, plaintext epoch secrets, broken HPKE).
- **9 MAJOR** — causes re-architect or mis-scoping if not fixed (recording/storage in P0, 20-100/1000 scaling claimed as validated, 10k load, TURN 3-region as P0, MLS full vs lite).
- **3 MINOR** — docs drift (C4 label, compose build contexts, metric cardinality).

**Honesty verdict (@reviewer + @security joint):** SFrame+SFU blind-forward fallback is *honestly documented* (no facade). Bandwidth `measured` claims, histogram percentiles, and scaling-as-validated language are *dishonest* (estimates presented as measurements) and must be corrected before Adversarial sign-off. CryptoKey zeroization and HPKE implementation have open HIGH security gaps — P0 ships with best-effort marker, not proven wipe.

---

## 1. Reconciliation Table (Authoritative Wins)

Each row: CURRENT_DOC / CURRENT_STATEMENT / AUTHORITATIVE_STATEMENT / DECISION / REQUIRED_EDIT / ADR_REFERENCE. Decisions do **not** silently choose — they cite authority.

| # | CURRENT_DOC | CURRENT_STATEMENT (verbatim + line) | AUTHORITATIVE_STATEMENT (verbatim + source) | Severity | DECISION | REQUIRED_EDIT (exact text to apply AFTER 5 gates) | ADR_REFERENCE | Owner(s) |
|---|-------------|--------------------------------------|---------------------------------------------|----------|----------|--------------------------------------------------|---------------|----------|
| **C-01** | `BACKEND_ROADMAP.md:7` | `\| **meet-signal** \| Stateless WSS ... \| Go + Gorilla WS, Redis Streams \|` | `AGENTS.md:48` — `Redis 7 pub/sub signal:{roomId} + presence presence:{roomId}:{hash} TTL 24h heartbeat 5s` ; `docs/M0-P0.md:43` — `Redis pub/sub for meet-signal` ; `architecture-brief.md:65` — `Redis pub/sub fanout (room-scoped signal:{roomId})` | **CRITICAL** | **REJECT — AMEND to pub/sub** | Replace `Redis Streams` with `Redis pub/sub (PUBLISH signal:{roomId} / SUBSCRIBE, TTL 24h presence)` . Add note: `P0: Streams FROZEN — see M0-P0 §2`. | ADR-008 | @architect @backend |
| **C-02** | `BACKEND_ROADMAP.md:40` | `\| **Signal** \| Horizontal pods behind LB; Redis Streams for fanout; sticky sessions not required \|` | `AGENTS.md:48` pub/sub ; `architecture-brief.md:65` pub/sub ; `docs/c4/p0-context.md:114` — `PUBLISH signal:{roomId} → Redis pub/sub → all signal pods fanout` | **CRITICAL** | **REJECT — AMEND** | Change to: `\| **Signal** \| Horizontal pods behind LB; Redis pub/sub (PUBLISH/SUBSCRIBE room-scoped channels) for fanout; sticky sessions not required \|` | ADR-008 | @backend |
| **C-03** | `BACKEND_ROADMAP.md:42` | `\| **SFU** \| Consistent hashing (ring) on room_id → LiveKit node; rebalance on node churn \|` | `AGENTS.md:50` — `Routing: roomId→SFU is rendezvous HRW (not ring) — h=xxhash(roomId\|nodeID)/weight, single-node degenerates to one entry SFU_NODES=livekit:7880` ; `architecture-brief.md:118` — `Algorithm: Rendezvous (Highest Random Weight) — preferred over ring` ; `docs/design/consistent-hashing-roomId-to-SFU.md:11` — `Choice: Rendezvous (HRW) over Ring` | **CRITICAL** | **REJECT — AMEND to HRW** | Replace with: `\| **SFU** \| Rendezvous HRW (Highest Random Weight) on room_id → LiveKit node (h=xxhash(roomId\|nodeID)/weight); single-node degenerates to one entry SFU_NODES=livekit:7880; cached Redis sfu:assign:{roomId} TTL 5m \|` Add note: `Ring + vnodes FROZEN`. | ADR-001, ADR-004, design doc §6 | @architect |
| **C-04** | `docs/c4/p0-context.md:36` | `Rel(signal, redis, "pub/sub fanout", "Redis Streams")` — tech string says Streams while label says pub/sub | `AGENTS.md:48` — `Redis 7 pub/sub` ; `docs/M0-P0.md:43` — `Redis pub/sub` ; `architecture-brief.md:65` — `Redis pub/sub` | **CRITICAL** | **REJECT — AMEND** | Change line 36 to: `Rel(signal, redis, "pub/sub fanout", "Redis pub/sub PUBLISH/SUBSCRIBE")` . Add footnote: `FROZEN: Redis Streams not in P0`. | ADR-008 | @architect |
| **C-05** | `docs/architecture-brief.md:108` | `\| **Signaling** \| WSS + JSON + Redis pub/sub \| W3C ... \| Redis Streams fanout 5k conn/pod \|` — P0 Validation column says Streams | `AGENTS.md:48` — `Redis 7 pub/sub` (higher authority) ; `docs/M0-P0.md:43` — `Redis pub/sub` | **CRITICAL** (internal drift) | **AMEND (self-correct)** | Change P0 Validation cell to: `Redis pub/sub PUBLISH/SUBSCRIBE fanout, 5k conn/pod, no sticky sessions` — brief defers to M0-P0/AGENTS. | ADR-008 | @architect (self-flagged) |
| **C-06** | `docs/architecture-brief.md:94` + `docs/media-p0-proof.md:465` | `buffered Commit replayed via Redis stream signal:{roomId}:buffer (TTL 30s).` | `AGENTS.md:48` — `Redis 7 pub/sub signal:{roomId} + presence ...` — no Streams; `M0-P0.md` does not define stream buffer; authoritative is pub/sub + ephemeral SET | **MINOR** | **AMEND — CLARIFY** | Change to: `buffered Commit replayed via Redis list / pub/sub replay buffer signal:{roomId}:buffer (LIST + EXPIRE 30s) OR in-memory ring on meet-signal (TTL 30s) — ephemeral, not Streams` . Align both docs. | ADR-008 | @backend @webrtc |
| **C-07** | `BACKEND_ROADMAP.md:8` | `\| **meet-id** \| OIDC ... KMS envelope encryption for keys \| Go, Keycloak adapter, Vault/KMS \|` | `docs/M0-P0.md:137` — `MLS central KMS backdoor → Remove central KMS; per-room sender-key ratchet, DataChannel broadcast + epoch` ; `AGENTS.md:54` — `SFrame keys client-only (IndexedDB non-extractable), SFU/TURN see ciphertext only` ; `architecture-brief.md:110` — `Key Mgmt: MLS-lite sender-key ratchet over DataChannel HPKE, no central KMS` | **CRITICAL** | **REJECT — FROZEN** | Change to: `\| **meet-id** \| OIDC (Keycloak) integration, JWT minting (5m access + 24h refresh), NO KMS — keys client-held X25519 non-extractable, per-room sender_key=HKDF(epoch_secret,"sframe",sender_id) via DataChannel HPKE \| Go, Keycloak adapter \|` Add: `Vault/KMS envelope FROZEN — violates honest E2EE`. | ADR-002, ADR-006 | @security @privacy |
| **C-08** | `docs/media-layer-roadmap.md:90` | `Fallback: central KMS epoch key (audit-logged).` (Risk table, MLS Key Rotation Deadlock) | `docs/M0-P0.md:137` — `Remove central KMS` ; `architecture-brief.md:110` — `no central KMS` | **CRITICAL** | **REJECT — REMOVE** | Replace with: `Fallback: batch commits (max 50/epoch), async Welcome via signaling for >50. NO central KMS (removed per M0-P0 §9 risk 5). If deadlock persists → NO-GO pivot per ADR-002 Option A.` | ADR-002 | @security @webrtc |
| **C-09** | `BACKEND_ROADMAP.md:10` + `54-57` | `\| **meet-storage** \| Encrypted blob storage (recordings, artifacts) ...` and `recordings (id, room_id, storage_key, encryption_key_id, expires_at)` + `TTL: ... recordings 30d` | `docs/M0-P0.md:60` — `Backend meet-storage encrypted recording path (if not needed for P0 E2EE proof).` [Out-of-Scope FROZEN] ; `AGENTS.md:3` — `Do not build: recording (meet-composer)` ; `architecture-brief.md:232` — `ADR-007 No default recording; meet-composer FROZEN` | **MAJOR** | **FREEZE — DEFER** | Prefix row with `**[FROZEN — NOT P0]**` and change to: `\| **[FROZEN] meet-storage** \| Client-encrypted blobs only (presigned MinIO), NO recording path in P0, envelope key client-held if needed \| Go, MinIO SDK \|` Remove `recordings` table row or mark `*[FROZEN — gated behind ?labs=1, requires consent flow Privacy F-3]* TTL 30d frozen`. | ADR-007 | @privacy @architect |
| **C-10** | `docs/media-layer-roadmap.md:76-78` | `M1 SFU 20p ... recording encrypted (client-side)` , `M2 100p ... HLS egress` , `M3 Webinar 1000 ... replay from encrypted blobs` | `docs/M0-P0.md:58` — `recording (MCU meet-composer) ... FROZEN` ; `AGENTS.md:3` — `recording (meet-composer) frozen` | **MAJOR** | **FROZEN — AMEND** | Change M1 exit to: `20 concurrent, Last-N 9 tiles, bandwidth adaptation <2s, SFrame forwarding verified (Wireshark), NO recording (meet-composer FROZEN)` ; M2/M3 prefix with `[FROZEN — POST-GO]` and move HLS/replay to frozen appendix. | ADR-007, ADR-001 | @webrtc @qa |
| **C-11** | `docs/ROADMAP.md:42-44` | `OIDC ... MLS/SFrame group keys via DataChannel HPKE, anonymous capability URLs with 30m single-use nonce.` + `Composition: Isolated meet-composer MCU only for opt-in encrypted recording` | `AGENTS.md:3` — `Do not build: ... anon capability links k#, ... recording (meet-composer)` ; `docs/M0-P0.md:24` — `P2P↔SFU handoff, WebTransport, anon links FROZEN` ; `architecture-brief.md:232` — `ADR-006 ... anon links FROZEN` | **CRITICAL** | **FROZEN — AMEND** | Change to: `OIDC ... MLS-lite sender-key ratchet via DataChannel HPKE (no central KMS), anonymous capability URLs FROZEN (k# flag)` and `Composition: meet-composer MCU FROZEN — NO recording in P0 (client-encrypted blobs only if needed)`. | ADR-006, ADR-007 | @security @privacy |
| **C-12** | `docs/media-layer-roadmap.md:36-52` | Entire `## 3. P2P ↔ SFU Handoff & ICE Restart` — `p2pPreferred: true`, 10s timeout → SFU, handoff triggers, `Redis tracks p2pState` as active P0 design | `docs/M0-P0.md:24` — `P2P↔SFU handoff ... FROZEN — cut for v1` ; `AGENTS.md:3` — `Do not build: P2P↔SFU handoff` ; `ADR-001:24-28` — `P2P↔SFU handoff FROZEN, SFU primary for all` | **CRITICAL** | **FROZEN — REMOVE FROM P0** | Wrap section with: `> **FROZEN — NOT IN P0** Per ADR-001 and M0-P0 §2, P2P↔SFU handoff is cut for v1. Section retained as POST-GO reference behind ?labs=1. P0 uses SFU≥3 directly, no handoff magic.` Remove `p2pPreferred` flag from P0 code paths. Keep ICE restart subsection but move to `ICE Restart (SFU-only)` header. | ADR-001 | @webrtc @reviewer |
| **C-13** | `docs/ROADMAP.md:91-98` | Feature matrix: `Breakout rooms, polling, reactions... M2` , `Webinar 100p → 1000 ... M3` , `Anonymous guest links ... M2*` , `P2P↔SFU ... M3*` without `[FROZEN]` | `AGENTS.md:3` — `Do not build: breakouts, polls, reactions, whiteboard, virtual bg, captions, recording, webinar 100-1000/HLS, anon capability links k#, P2P↔SFU handoff` ; `docs/M0-P0.md:58` — `Any UX beyond: landing → /r/:id ... + screen share + shield is deferred.` | **MAJOR** | **FROZEN — AMEND** | Add `[FROZEN]` prefix to each row and change `Milestone` column to `POST-GO (requires GO + 5 gates)` ; add banner above table: `> **FROZEN FEATURES — POST-GO ONLY**`. | ADR-001 | @reviewer |
| **C-14** | `docs/media-layer-roadmap.md:15-20` + `75-78` + `BACKEND_ROADMAP.md:42` (scaling) | Scale tiers `Large group 20-100 3-5 (cascade)`, `Webinar 1000 8-10 (fan-out)` presented as P0; M6 `load tests (10k concurrent)` | `docs/M0-P0.md:52` — `webinar 100-1000, HLS ... FROZEN` ; `architecture-brief.md:52-54` — `20-100 Cascaded ... (FROZEN until GO)` + `c4/p0-context.md:169` — `20-100 FROZEN` ; `docs/M0-P0.md:60` — `K8s auto-scaling beyond single-SFU ... DEFERRED` | **MAJOR** | **FROZEN — AMEND** | Add header `Scalability Targets (P0 + FROZEN — POST-GO REFERENCE)` and mark rows: `Large group 20-100 — FROZEN` , `Webinar 1000 — FROZEN` + footnote `P0 validates single SFU ≤20 only (M0-P0 §3 #2)`. For `BACKEND_ROADMAP.md` M6: change `10k concurrent` → `20p single-room stable 10min (criterion 2)` and add `**FROZEN**` banner to M5/M7/M8. | ADR-001, ADR-004 | @webrtc @qa @backend |
| **C-15** | `docs/media-layer-roadmap.md:58` | `Deployment — coturn cluster behind Anycast/GeoDNS. 3 regions minimum (US, EU, APAC). Each node: 8 vCPU, 32GB, 10 Gbps NIC. Capacity: ~5000 concurrent relays.` as P0 requirement | `docs/M0-P0.md:43` — `coturn co-located, Prometheus turn_* metrics` ; `AGENTS.md:50` — `single Compose coturn for P0` ; `ADR-005` — `Single coturn in Compose for P0, K8s parity via DaemonSet HPA 1→2 post-P0. 3-region Anycast is stub for P0` | **MAJOR** | **AMEND — DOWNSCOPE** | Change to: `P0 Deployment: Single coturn 4.6 + turn-auth (Compose). K8s parity: DaemonSet/HPA 1→2. 3-region Anycast (3× 8 vCPU) is POST-GO scaling reference for 1000p (30% TURN rate), NOT P0 claim. P0 validates ≤50 rooms on 4 vCPU/8GB.` | ADR-005 | @backend @privacy |
| **C-16** | `docs/media-layer-roadmap.md:28` + `architecture-brief.md: ...` | `Key Sharing — MLS (RFC 9420) over DataChannel. Each participant holds GroupContext + EpochSecret.` | `docs/M0-P0.md:43` — `MLS-lite sender-key ratchet: sender_key = HKDF(epoch_secret, "sframe", sender_id)` ; `architecture-brief.md:110` — `MLS-lite sender-key ratchet over DataChannel HPKE, no central KMS` | **CRITICAL** | **REJECT — AMEND** | Replace with: `Key Sharing — MLS-lite sender-key ratchet (NOT full MLS RFC9420). sender_key = HKDF(epoch_secret, "sframe", sender_id) distributed via DataChannel Commit (HPKE per sender) + Welcome via signaling HPKE. No GroupContext, no central KMS.` | ADR-002 | @security @webrtc |
| **C-17** | `docs/media-layer-roadmap.md:26-31` | `Compatibility with Forwarding — SFrame header (KID, CTR) preserved ... SFU inspects only ssrc/mid for routing.` Presented as working solution | `docs/M0-P0.md:9 Risk 1` — `If LiveKit Dynacast reads need payload, ship blind-forward 3 layers for ≤20p (80% downlink cost accepted for P0 honesty). No facade.` ; `ADR-004:59` — `Contradiction confirmed: LiveKit Dynacast reads payload-dependent layer → disabled; blind-forward all 3 layers.` | **CRITICAL** | **AMEND — ADD FALLBACK** | Replace section with: `SFrame header (KID, CTR) preserved per RFC 9605. SFU header-aware routing is POC attempt (Phase 1). If LiveKit cannot select layer without payload inspection, P0 ships blind-forward 3 layers for ≤20p (80% overhead) — documented, not facaded. See ADR-002.` | ADR-002, ADR-004 | @webrtc @reviewer |
| **C-18** | `BACKEND_ROADMAP.md:75-84` | Milestones `M1: Core Infra W2 ... M8: Hardening W9` + `Critical Path: M1→M8` presented as active timeline without freeze notice | `docs/M0-P0.md:18-26` — `Prior Roadmap Frozen ... M1 Core 20p ... M3 webinar 1000p FROZEN — NOT STARTED` ; `AGENTS.md:3` — `All prior roadmap phases (26-week plan, BACKEND_ROADMAP.md M1-M8) are FROZEN until 10 criteria + 5 gates pass` | **MAJOR** | **FREEZE — ANNOTATE** | Prepend §6 with: `> 🚨 **FROZEN — REFERENCE ONLY** Per AGENTS.md, M1-M8 below are NOT authoritative until M0-P0 GO/NO-GO. Current authority is M0-P0 4-week sprint. Require PM waiver + 5 gates to unblock.` Change `M3: meet-signal (WSS) \| W4 \| Redis Streams ...` to `Redis pub/sub` per C-01. | ADR-001 | @architect |
| **C-19** | `BACKEND_ROADMAP.md:29` | Frames `{type: "offer\|answer\|ice\|candidate\|join\|leave\|mute\|speaking"}` | `architecture-brief.md:65` — frames `{type:offer\|answer\|ice\|join\|leave\|mute\|speaking\|commit\|welcome}` + `session-update` for ICE restart ; `docs/M0-P0.md:43` — `Commit` via DataChannel + `Welcome` via signaling ; `M0-P0.md:47` — ICE restart via `session-update` | **MINOR** | **AMEND** | Change to `{type: "offer\|answer\|ice\|join\|leave\|mute\|speaking\|commit\|welcome\|session-update"}` — align to authoritative; remove redundant `ice\|candidate` duplicate. | — | @backend |
| **C-20** | `docs/prometheus-stats-notes.md` (implicit) + `BACKEND_ROADMAP.md` + `architecture-brief.md:18` | `architecture-brief.md:18` — `Scalability: horizontal via hash ring without re-architecting.` Implies validated horizontal scaling. `BACKEND_ROADMAP.md: M6 10k concurrent` and `media-layer-roadmap.md` bandwidth `measured ~8-12 Mbps` and histograms `p95=400ms` presented as measured | `docs/M0-P0.md:52` — `K8s auto-scaling beyond single-SFU ... DEFERRED` ; `c4/p0-context.md:165` — `Single-node claim validated: ≤50 concurrent rooms ... beyond requires K8s. Honest, not unlimited.` ; Reviewer: bandwidth figures are estimates, not measurements; histogram percentiles mathematically impossible with given raw values | **MAJOR** (honesty) | **AMEND — ESTIMATE NOT MEASURED** | Change `measured ~8-12 Mbps` → `estimated ~8-12 Mbps (math: 9 tiles × 0.8-1.3 Mbps per tier). To be measured W3 with real participants.` Change `horizontal via hash ring without re-architecting.` → `horizontal hash ring design exists; multi-node validation deferred to post-P0.` Replace fabricated histograms with placeholders `{p50:null, p95:null, actual:"TO BE MEASURED W2/W3"}`. Do not claim validation until harness run. | ADR-004 | @reviewer @qa @webrtc |

### Additional Privacy & Security Findings (Informative, Not Doc Edits — But Gating)

These were flagged by @security / @privacy as **code-level** contradictions to the documented invariant; they do not require REQUIRED_EDIT to subordinate docs but block gate sign-off until acknowledged:

| # | Area | Finding | Gate Impact |
|---|------|---------|-------------|
| S-01 | Key zeroization | `poc/meet-webrtc-core/src/keys/manager.ts:277` `zeroizeKey()` sets `_zeroized=true` marker, does not clear `CryptoKey` material or delete IndexedDB entry. Violates `architecture-brief.md:90` "Keys zeroized on leftAt (crypto.subtle zero + IndexedDB delete)". | **Security HIGH** — must document POC limitation / implement `indexedDB.delete` + `Uint8Array.fill(0)` for raw exports before Security gate can sign. |
| S-02 | Plaintext epoch secrets | `createCommit()` builds `oldSecret‖newSecret` plaintext, `sendCommit()` sends `Array.from(commit)` over WSS JSON without HPKE per-recipient encryption. Violates ADR-002 "Commit broadcast via DataChannel HPKE". | **Security HIGH** — must encrypt per-recipient before GO. |
| S-03 | HPKE non-standard | `HPKE.encrypt` is raw ECIES, not RFC 9180; `hpkeDecrypt` uses self public key instead of sender `enc`. | **Security HIGH** — adopt `@hpke/core` or fix decrypt. |
| S-04 | WASM integrity | Worker via `Blob` URL violates `script-src 'self'`; WASM fetched without SRI hash, violating `AGENTS.md` "WASM integrity hash". | **Security MEDIUM** — move worker to static file + SRI. |
| S-05 | JWT in URL | `WSS /signal?token=:jwt` logs JWT in Caddy/access logs, violating "no PII beyond 24h hash". | **Security MEDIUM** — pass via first-frame or `Sec-WebSocket-Protocol`. Document risk if kept. |
| P-01 | Missing `docs/privacy-inventory.md` | Referenced in 6+ docs (M0-P0 §3-10, ADR-005, exit checklist) but file does not exist. Blocks Privacy F-2. | **Privacy MEDIUM** — @privacy to create by W1 per M0-P0 §11. |
| P-02 | Missing DSR endpoint | `DELETE /accounts/me` (F-1) listed as gate blocker but no service implements it. | **Privacy HIGH** — @backend to implement by W2. |
| P-03 | False gate pre-approval | `M0-P0.md:107` + `gates/architecture-exit-checklist.md:48` claim Privacy `APPROVED (F1-F4 closed, F6 merged)` while F-1/F-2/F-6 are open. | **Privacy HIGH** — correct to `PENDING`. |
| P-04 | Metrics cardinality | `prometheus-stats-notes.md` defines `participant_id` label but §12 says drop in prod; no `metric_relabel_configs` enforcement. | **Privacy MEDIUM** — add relabel drop rule. |
| S-06 | Commit injection | `commit`/`welcome` frames have no HMAC/signature nor sequence — injectable with valid JWT. | **Security MEDIUM** — add HMAC or bind to DTLS DataChannel. |

---

## 2. Cross-Agent Disagreement Analysis

PM required independent delegation and disagreement surfacing. The 7 agents independently identified overlapping contradictions but with different severity and framing — disagreements are resolved below by deferring to higher authority.

| Disagreement | Agents | Positions | PM Reconciliation (Authoritative Wins) |
|--------------|--------|-----------|----------------------------------------|
| **Redis Streams vs pub/sub — how critical?** | @architect=CRITICAL, @backend=CRITICAL, @webrtc=CRITICAL, @reviewer=CRITICAL, @qa=minor, @privacy=not flagged, @security=LOW (frozen) | All who flagged agreed CRITICAL; @security downgraded to LOW as "frozen doc not actionable", @qa called it testability gap. | **CRITICAL stands** — Streams vs pub/sub is not wording; it changes failure mode (persistent log vs ephemeral fanout) and contradicts stateless 24h TTL invariant. @security's LOW is overridden — even frozen docs must not describe an architecture that would violate P0 if implemented. Decision: amend to pub/sub per C-01/C-02. |
| **HRW vs Ring — is ring ever acceptable?** | @architect=CRITICAL (HRW chosen), @backend=CRITICAL (stale ref), @reviewer=CRITICAL, @webrtc=not flagged, @privacy=not flagged | Unanimous among flaggers: HRW is authoritative. | **HRW wins** per `AGENTS.md:50` + `architecture-brief.md:118` + `design/consistent-hashing-roomId-to-SFU.md`. Ring is not wrong per se, but P0 chose HRW for 15 LOC vs 80 LOC + vnodes and single-node degenerate simplicity. Ring language must be corrected. |
| **Central KMS — frozen ref vs active backdoor?** | @architect=CRITICAL (privacy violation), @backend=HIGH, @privacy=HIGH (backdoor blueprint), @security=HIGH + code-level, @reviewer=CRITICAL | All flagged HIGH/CRITICAL; @security added code-level plaintext-epoch issue. | **All agree: no central KMS.** `BACKEND_ROADMAP.md` Vault/KMS and `media-layer-roadmap:90` central KMS fallback are direct violations of `M0-P0 §9 risk 5` ("Remove central KMS"). PM decision: strike both, replace with "no central KMS, per-room ratchet". No PM waiver. |
| **Blind-forward bandwidth — measured vs estimated** | @architect=estimated, @reviewer=DISHONEST (fabricated), @webrtc=honest fallback documented, @qa=not flagged | @architect treated as minor drift; @reviewer called it dishonest E2EE claim (fabricated measurement); @webrtc said fallback is correctly documented. | **@reviewer prevails** — "measured ~8-12 Mbps" language in `architecture-brief:174` and `ADR-004:99` is estimate math (9 tiles × 0.8-1.3 Mbps), not a harness measurement. No 20× real-participant downlink measurement exists (19 participants are synthetic). Decision: change to `estimated ~8-12 Mbps, to be measured W3` per C-20. W3 load drill must produce real measurement before gate. |
| **Histogram percentiles — real vs fabricated** | @reviewer=DISHONEST (p95 impossible), @qa=not flagged (called missing artifacts), @webrtc=not flagged | Only @reviewer flagged the math: 20 values sorted → 19th is 678ms → true p95 is 678-1200ms, not 400ms; 10 values → 9th is 7500ms → true p95 is 7500ms, not 3500ms. | **@reviewer prevails** — histograms in `tests/test-vectors.ts` and `media-p0-proof §6.4/7.4` are fabricated placeholders, not measurements. QA called them "missing artifacts" but did not catch the math. Decision: replace with honest placeholders `actualMeasured:false` until W2/W3 harness runs. No gate until real histograms. |
| **Scaling as validated vs frozen** | @architect=MAJOR (annotate frozen), @backend=MAJOR (downgrade single SFU), @webrtc=MAJOR, @reviewer=FACADE (claimed as validated), @qa=informational, @privacy=not flagged | @reviewer strongest: "horizontal via hash ring without re-architecting" is a promise, not measurement; 10k concurrent is different scale than 20p. | **@reviewer prevails** with nuance: PM agrees scaling design may exist but validation is frozen. Decision: change `architecture-brief:18` to "design exists; multi-node validation deferred" and add `P0 Status: FROZEN` column to all scale tables per C-14. No claim of horizontal validation in P0 exit report until N>1 test exists. |
| **Recording/storage — frozen vs deferred** | @architect=FREEZE, @backend=FREEZE, @privacy=MEDIUM (30d TTL violates 24h), @security=LOW, @webrtc=FREEZE | All agree frozen; @privacy added TTL violation (30d vs 24h) and server-side `encryption_key_id` violates client-held invariant. | **FROZEN stands** — `meet-storage`/`meet-composer`/`recordings` table are FROZEN per `M0-P0 §4`. Decision: mark `[FROZEN — NOT P0]` per C-09/C-10, note 30d TTL requires Privacy F-3 consent post-GO. No recording code in P0. |
| **Privacy gate status — approved vs pending** | @privacy=HIGH (false pre-approval), @qa=not flagged, @architect=not flagged | Only @privacy flagged that `M0-P0:107` claims `APPROVED (F1-F4 closed)` while F-1 DSR, F-2 ROPA, F-6 zero-telemetry statement are missing. | **@privacy prevails** — gate status is contradictory. Decision: correct to `PENDING` until `docs/privacy-inventory.md` + `DELETE /accounts/me` + zero-telemetry statement exist. No Privacy gate sign-off until then. |
| **Auth/key-management terminology — MLS vs MLS-lite** | @webrtc=CRITICAL (not full MLS), @security=LOW (frozen), @architect=CRITICAL | @webrtc strongest articulation: P0 is custom HKDF ratchet, not RFC 9420 GroupContext. | **MLS-lite wins** — P0 uses `sender_key = HKDF(epoch_secret, "sframe", sender_id)` via DataChannel HPKE, no tree, no GroupContext. Decision: correct `media-layer-roadmap:28` per C-16. |
| **TURN 3-region vs single** | @webrtc=MAJOR, @backend=MEDIUM, @reviewer=MAJOR, @privacy=LOW | All agree 3-region is post-P0; disagreement is severity. | **Single for P0 wins** per `M0-P0 §3 #8` "3-region Anycast/GeoDNS stub or single Compose coturn for P0" + `ADR-005`. Decision: fix `media-layer-roadmap:58` per C-15. |

**No agent was allowed to self-approve.** All 7 submissions remain `REVIEW REQUIRED`. The disagreements above are resolved by deferring to higher authority (M0-P0 → AGENTS.md → architecture-brief), not by PM fiat.

---

## 3. Required Documentation Edits (Not Yet Applied — Awaiting 5 Gates)

The following edits are **ready to apply** but **blocked** until 5 gates sign this report. Do not write production backend services during reconciliation (per instruction).

### 3.1 Patches Ready (grouped by file)

**`BACKEND_ROADMAP.md`** (8 edits)
- [ ] Add freeze banner at top: `> 🚨 **FROZEN per docs/M0-P0.md §2** — This 8-milestone roadmap is NOT ACTIVE... M1-M8 are post-P0 gated. See M0-P0 §6.` (C-18)
- [ ] `§1 meet-signal: Redis Streams → Redis pub/sub` (C-01)
- [ ] `§1 meet-id: KMS/Vault → OIDC-only; client-held X25519; no central KMS` (C-07)
- [ ] `§1 add [FROZEN] to meet-storage/meet-composer rows or remove` (C-09)
- [ ] `§2 frames: ice|candidate → offer|answer|ice|...|commit|welcome|session-update` (C-19)
- [ ] `§2 presence: add TTL 24h` (backend C-11)
- [ ] `§3 SFU: Consistent hashing (ring) → Rendezvous HRW + load-weighted` (C-03)
- [ ] `§4 remove recordings table or mark FROZEN` (C-09)
- [ ] `§6 M4: LiveKit cluster → single SFU assignment via HRW` ; `M6 10k concurrent → 20p 10min` ; `M5/M7/M8 add FROZEN post-P0` (C-14)

**`docs/media-layer-roadmap.md`** (7 edits)
- [ ] Add freeze banner: `> 🚨 FROZEN PER M0-P0 §2 — P0 validates single SFU ≤20p only. M1-M3 below are post-GO reference.` (C-14)
- [ ] `§1 Scale Tier Table: add FROZEN badges to 20-100 and 1000 rows` (C-14)
- [ ] `§1 Dynacast/Last-N: add note P0 E2EE Dynacast disabled, blind-forward 3 layers, Last-N=9` (webrtc C-02)
- [ ] `§2 Key Sharing: MLS (RFC 9420) → MLS-lite sender-key ratchet (custom)` (C-16)
- [ ] `§2 Forwarding Compatibility: add honest fallback per ADR-002` (C-17)
- [ ] `§3 P2P↔SFU Handoff: add ⚠️ FROZEN header, P0 uses SFU for all` (C-12)
- [ ] `§4 TURN Deployment: 3 regions minimum → single coturn in Compose for P0; 3-region frozen` (C-15)
- [ ] `§5 Milestones: add ⚠️ FROZEN banner, remove recording from M1` (C-10/C-14)
- [ ] `§6 Risk #5 Fallback: remove central KMS fallback` (C-08)
- [ ] (new) `§6 Screen Share: add section per Criterion 5` (webrtc C-07)

**`docs/ROADMAP.md`** (3 edits)
- [ ] `§2/3.2 stack: anon URLs 30m nonce → add FROZEN note` (C-11)
- [ ] `§2 Composition: meet-composer MCU → add FROZEN` (C-11)
- [ ] `§3.2 Feature matrix: add [FROZEN] prefix + POST-GO milestone + banner` (C-13)
- [ ] `Scale tier table: add P0 Status FROZEN column for 20-100/1000` (arch C-10)

**`docs/c4/p0-context.md`** (2 edits)
- [ ] `L36 Rel(... "Redis Streams") → "Redis pub/sub PUBLISH/SUBSCRIBE"` (C-04)
- [ ] `Deployment View: clarify single Compose coturn for P0; Anycast stub not deployed` (backend C-05)

**`docs/architecture-brief.md`** (3 self-corrective edits)
- [ ] `§5 Signaling row: Redis Streams fanout 5k conn/pod → Redis pub/sub PUBLISH/SUBSCRIBE, 5k conn/pod` (C-05)
- [ ] `§4.4 / media-p0-proof:465: Redis stream buffer → Redis LIST / pub/sub replay buffer (LIST + EXPIRE 30s) OR in-memory ring` (C-06)
- [ ] `§1 Scalability: horizontal via hash ring without re-architecting. → horizontal hash ring design exists; multi-node validation deferred to post-P0` (C-20)
- [ ] `§8 measured ~8-12 Mbps → estimated ~8-12 Mbps (math, to be measured W3)` (C-20)
- [ ] `§1 1 vCPU/2GB threshold → 2 vCPU/4GB recommended; 1 vCPU marginal (71% per ADR-004)` (reviewer Finding E)

**`docs/prometheus-stats-notes.md`** (2 edits)
- [ ] `§3/12: clarify participant_id is ephemeral per-session, add metric_relabel_configs drop rule for prod` (privacy F-06)
- [ ] `§6: add comment privacy metrics are CI-set after grep -r analytics, not automated` (privacy F-07)

**`infra/compose.yaml`** (1 clarification)
- [ ] Add top comment: `# P0 Go services (meet-signal/meet-sfu-manager/turn-auth) are spec + build stubs; only poc/meet-webrtc-core is code package until GO.` (arch C-20)
- [ ] Make `GF_SECURITY_ADMIN_PASSWORD` env-overridable `${GF_ADMIN_PASSWORD:-admin}` (security F-10)

**`docs/ROADMAP.md` / `BACKEND_ROADMAP.md` / `media-layer-roadmap.md` — global**
- [ ] All bandwidth claims: `measured → estimated` until W3 real-participant measurement (C-20)
- [ ] All scale tier tables: add `FROZEN` badges + footnote `P0 validates single SFU ≤20 only`
- [ ] All histogram tables: replace fabricated raw values with `actualMeasured:false` placeholders

### 3.2 New Files Required (Post-Gate, Not Yet Created)

| File | Owner | Gate |
|------|-------|------|
| `docs/privacy-inventory.md` (minimization table + ROPA Art.30 + data inventory + TURN rotation policy) | @privacy | Privacy |
| `docs/qa/m0-p0-test-plan.md` (browser matrix, 20p load, rotation/reconnect histograms, Lighthouse, privacy scan) | @qa | QA |
| `qa/reports/browser-matrix.html` | @qa | QA + `p0-gate-verify` |
| `qa/reports/key-rotation-latency.json` (20 trials, real data) | @qa + @webrtc + @security | Security + QA |
| `qa/reports/reconnect-latency.json` (10 trials/browser, real data) | @qa + @webrtc | QA |
| `qa/reports/lighthouse/*.json` | @qa + @frontend | QA |
| `qa/reports/wireshark-livekit-sframe.pcapng` (ciphertext proof) | @webrtc + @security | Security |
| `qa/reports/sfu-benchmark/*.json` | @qa + @backend + @webrtc | QA |

These are **not created during reconciliation** per "do not silently choose" and "no production services" — they are listed as blockers for `p0-gate-verify`.

---

## 4. Gate Sign-off (All 5 Required Before Edits Land)

This report is **not self-approved**. PM (muse-spark-1.2-contributor-free) coordinates but never approves own work. All REQUIRED_EDITs above are **proposed, not applied** until 5 gates sign.

| Gate | Reviewer | Artifact for This Report | Verdict | Signature + Date |
|------|----------|--------------------------|---------|------------------|
| **Architecture** | @architect | This report + reconciliation table §1 — HRW/pub/sub/service freeze correctness | ☐ APPROVED / ☐ CHANGES REQUESTED | @architect __________ 2026-__-__ |
| **Security** | @security | §1 C-07/C-08/C-16/C-17 + Additional S-01..S-06 — no central KMS, MLS-lite, commit encryption, zeroization gap disclosed, WASM integrity, JWT handling | ☐ APPROVED / ☐ CHANGES REQUESTED | @security __________ 2026-__-__ |
| **Privacy** | @privacy | §1 C-07/C-09 + Additional P-01..P-04 — no central KMS, no storage in P0, 24h TTL, IP purge, VAPID not FCM, DSR/ROPA gaps acknowledged, gate status corrected to PENDING | ☐ APPROVED / ☐ CHANGES REQUESTED | @privacy __________ 2026-__-__ |
| **QA** | @qa | §1 C-14/C-20 + artifact index — 20p 10min thresholds, 4-browser matrix 127+/128+/17.4, no 10k/1000p in P0, histograms replaced with honest placeholders, `p0-gate-verify` blocked until artifacts | ☐ APPROVED / ☐ CHANGES REQUESTED — if approved, apply `p0-gate-verify` label | @qa __________ 2026-__-__ |
| **Adversarial** | @reviewer | §1 + §2 disagreement analysis — SFrame+SFU honesty (blind-forward fallback), bandwidth `measured→estimated`, histogram fabrication, scaling facade, no silent downgrade | ☐ GO (honest E2EE) / ☐ GO with waiver (document risk) / ☐ NO-GO | @reviewer __________ 2026-__-__ |

**Merge to `main` blocked until:** `p0-gate-verify` label from @qa + 5 signatures above present. PRs labelled `feature:not-p0` remain auto-rejected per `AGENTS.md`. Branch protection enforces `p0-gate-verify` + 5 approvals.

**If any gate 🔴:** P0 fails → freeze continues → pivot plan (mesh ≤5p / 1:1 only / mediasoup) within 48h per `M0-P0.md §8`. Report remains open until resolved.

---

## 5. Decision Log (For Section 11 Updates)

Once 5 gates sign, PM will update:

- `docs/architecture-brief.md §11` — log this reconciliation pass and ADR references (ADR-001,002,004,005,006,007,008).
- `docs/adr/` — if any gate requests new ADR (e.g., ADR-010 for bandwidth honesty or ADR-011 for zeroization best-effort), create per `@architect` decision.
- `docs/M0-P0-exit-report.md` — will include RAG for all 10 criteria, histograms, Lighthouse JSON, privacy scan, plus this report as appendix.

No production backend services (`services/meet-signal`, `services/meet-sfu-manager`, etc.) are written as part of reconciliation — only this documentation report and subsequent doc patches after gate approval.

---

## 6. How to Review This Report

```bash
# Verify authoritative sources have not drifted
cat docs/M0-P0.md | head -20
cat AGENTS.md | head -30
cat docs/architecture-brief.md | grep -n "pub/sub\|HRW\|KMS\|FROZEN"

# Check subordinate docs still show pre-freeze language (expected before gate)
grep -n "Redis Streams" BACKEND_ROADMAP.md
grep -n "ring" BACKEND_ROADMAP.md
grep -n "Vault/KMS" BACKEND_ROADMAP.md
grep -n "P2P.*handoff\|central KMS" docs/media-layer-roadmap.md

# Validate no prod service was written during reconciliation
ls services/ 2>&1 || echo "No services/ yet — spec-only per AGENTS.md — correct"
docker compose -f infra/compose.yaml config > /dev/null && echo "compose config ok — doc-only changes safe"
```

---

*End of Architecture Consistency Report — M0-P0 Reconciliation Pass — REVIEW REQUIRED — Pending 5-Gate Approval — 2026-09-01 — PM muse-spark-1.2-contributor-free*
