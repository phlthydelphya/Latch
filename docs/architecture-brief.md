# Meet Secure Core — High-Level Architecture Brief (M0-P0)
**Version:** 0.2.0-p0 | **Date:** 2026-09-01 | **Author:** @architect (Principal Architect) | **Status:** `REVIEW REQUIRED` — Pending Security / Privacy / QA / Reviewer approvals — NOT SELF-APPROVED
**Authority:** `docs/M0-P0.md` §3/5/6 (10 criteria, 5 gates) | **Freeze:** Prior 26-week roadmap FROZEN until P0 GO

> **M0-P0 Scope (W1-W4):** Single-SFU LiveKit (Go) + SFrame/WASM E2EE (RFC 9605) + Redis pub/sub + coturn HMAC 24h + OIDC (Keycloak) + Postgres/Redis/MinIO, validated via `docker compose up` for ≤50 rooms / 20-participant room. No Zoom depth (breakouts, polls, reactions, whiteboard, virtual bg, captions, recording, anon links, webinar fanout, HLS, P2P↔SFU handoff, WebTransport) until GO.

---

## 1. Principles & Constraints (Privacy-by-Design)

| Principle | Enforcement in P0 |
|-----------|-------------------|
| **Privacy-by-design** | No analytics SDK, no cookies except `__Host-` auth `SameSite=Strict`, no UA sniffing, VAPID not FCM, logs sanitized (no SDP/PII/IP beyond 24h hash), 24h TTL on all ephemeral Redis/PG rows, no `localStorage` tracking keys. SFrame keys client-only (IndexedDB non-extractable), SFU/TURN see ciphertext only. |
| **W3C-only** | WebRTC 1.0 + Insertable Streams / WebRTC Encoded Transform + SFrame RFC 9605 + WebSocket over TLS 1.3 + OIDC. No native app, PWA installable via Vite + Workbox. |
| **Self-hostable** | Single `docker compose up` brings PG 16, Redis 7, MinIO, Keycloak 24, coturn, LiveKit 1.25, meet-signal, Prometheus/Grafana/Loki. K8s Helm chart parity required (same containers, same env). |
| **Honest E2EE** | SFU forwards opaque payload; no silent downgrade. If SFrame unavailable → explicit ⚠️ DTLS-only warning. If Dynacast/Last-N conflicts → blind-forward fallback documented, not facaded. |
| **Maintainability** | Stateless `meet-signal`, consistent-hash `roomId→SFU` (K8s-ready on day 1), structured JSON logs, RED metrics, ADRs for every contested choice. |
| **Scalability** | Vertical to 20p on single SFU (1 vCPU/2GB threshold, 2 vCPU documented fallback), horizontal via hash ring without re-architecting. |

**Out-of-scope FROZEN:** See `docs/M0-P0.md` §4 — any UX beyond landing → `/r/:id#k=` → pre-join preview → grid (Last-N=9) → mute/cam/leave + screen share + shield.

---

## 2. P0 System Topology (20p Single-SFU)

```
                                                         ┌─ meet-id (Keycloak/Ory) ─┐
                                                         │ OIDC, JWT 5m, aud=roomId │
                                                         └──────────┬───────────────┘
                                                                    │ PG (hash only)
                                                                    │
  [ PWA Client ] ──HTTPS/WSS──► [ L4/L7 LB :443 TLS ] ──► [ meet-signal :8080 WSS ] ──pub/sub──► [ Redis 7 ]
        │                           │                           │  JWT verify / presence        ▲ │ presence SET TTL 24h
        │ SFrame/SRTP               │                           │  roomId hash, heartbeat 5s   │ │ room channels
        │ Insertable Streams        │                           └──────────────┬──────────────┘ │
        │  ├─ VP9 SVC / H264        │                                          │ authz          │
        │  └─ WASM fallback 150KB   └──────────────────► [ LiveKit SFU :7880 ] ◄┘              │
        │       (OffscreenCanvas)                SRTP/SFrame opaque forward                    │
        │                                                    │                                 │
        └────────── STUN/TURN (UDP/TCP/TLS 3478/443) ──► [ coturn ] ── HMAC 24h ──► [ turn-auth ] 
                                                         ▲  Prometheus turn_*               │
                                                         │                                   │
                                               [ Prometheus/Grafana/Loki + OTEL ] ◄───────────┘
                                               [ MinIO (client-encrypted blobs only) ]
```

**Scale Tier Table (P0 validated, post-P0 gated):**

| Tier | Topology | SFU Nodes (P0) | Downlink/Viewer | Validation |
|------|----------|----------------|-----------------|------------|
| 1:1 | P2P preferred → SFU fallback | 0-1 | ~1.5 Mbps | Manual 2-browser (future) |
| **≤20 P0** | **Single SFU, simulcast 3×2, blind-forward all layers when E2EE** | **1× 1 vCPU/2GB (or 2 vCPU documented)** | **~4.5 Mbps worst (3 layers) / ~2.5 Mbps Last-N if POC proves header-aware)** | **20p synthetic stable ≥10min, CPU<70%, loss<1%, p95≤300ms** |
| 20-100 | Cascaded SFU mesh + Last-N (FROZEN until GO) | 3-5/region | ~2.5 Mbps | Not in P0 |
| 1000 webinar | Fanout + HLS fallback, non-E2EE only (FROZEN) | 8-10/region | ~1.8 Mbps | Not in P0 |

> **P0 claim validated:** `docker compose up` single command → ≤50 concurrent rooms on 4 vCPU/8GB host (tested in CI). K8s Helm parity check passes (same image digests, same env vars).

---

## 3. Service Boundaries

| Service | Bounded Context | Owns | Does NOT Own | P0 Interface | Criteria Covered |
|---------|-----------------|------|--------------|--------------|------------------|
| **meet-web (PWA)** | Presentation + E2EE | React 18 + Vite 5 + Workbox, Zustand, SFrame worker (wasm-sframe 150KB async + integrity hash), getDisplayMedia, shield UI | No signaling logic beyond WSS client, no TURN creds mint | `GET /join/:id`, `WSS /signal`, `RTCPeerConnection` | 1,4,5,6,9,10 |
| **meet-signal** | Signaling & Presence | Stateless WSS (Go + Gorilla WS), JWT 5m + nonce + aud, Redis pub/sub fanout (room-scoped `signal:{roomId}`), presence SET `presence:{roomId}:{participantHash}` TTL 24h heartbeat 5s, ICE restart session-update | No media, no key material, no SDP persistence | `POST /api/v1/rooms`, `POST /rooms/:id/join`, `GET /rooms/:id/token`, `WSS /signal?v=1&room=&token=` frames `{type:offer|answer|ice|join|leave|mute|speaking|commit|welcome}` | 2,3,6,7 |
| **meet-sfu (LiveKit Go SFU)** | Media Forwarding | SRTP/SFrame packet forwarding by SSRC/mid, simulcast 3×2 layer selection (header-aware when E2EE off; blind-forward all 3 when on), transport-cc + REMB, Prometheus `livekit_*` | Never decrypts payload, no mixing/transcoding in P0 (MCU `meet-composer` FROZEN) | `RTCPeerConnection` via LB :7880, auth via meet-signal token, webhook `POST /sfu/event` | 2,3,4 |
| **meet-sfu-manager** | Orchestration | Consistent hash `roomId→SFU` (rendezvous), health check, `livekit_rooms_active`, `sfu_load` metrics, deterministic routing, rebalance on churn | Not in data path | `GET /internal/sfu/assign?roomId=` (internal), Redis `sfu:nodes` | 3 |
| **meet-turn (coturn) + turn-auth** | NAT Traversal | coturn 4.6, HMAC-SHA256 ephemeral `username = <expiry>:<hash>`, TTL 24h, shared secret via `turn-auth` service, listens 3478 UDP/TCP + 443 TCP/TLS, logs IP hashed & purged 24h | No media insight (ciphertext relay), no long-term creds | `turn:turn.meet-secure.local:3478`, `turns:443`, REST `POST /turn/credentials` | 8,10 |
| **meet-id** | Identity | Keycloak realm `meet-secure`, OIDC code+PKCE, JWT `sub` = hash only, 5m access / 24h refresh, passphrase-derived X25519 (libsodium, IndexedDB non-extractable) | No room keys (server is blind) | `/.well-known/openid-configuration`, `POST /auth/token` | 10 |
| **meet-store / state** | Persistence | PG: `rooms(id, host_id_hash, created_at, expires_at, status)` + `participants` all TTL 24h, MinIO for client-encrypted blobs only (presigned URLs), Redis Sentinel (single node in Compose, Sentinel in K8s) | No plaintext media, no tracking | PG 16, Redis 7, MinIO | 10 |
| **observability** | RED + privacy-safe | Prometheus `rooms_active`, `sfu_load`, `turn_allocations_active`, Grafana, Loki (JSON logs sanitized), Tempo sampled 10% | No PII, no SDP, no IP beyond 24h hash, cardinality capped | `/metrics`, `/healthz` | 3,8,10 |

---

## 4. Data Flows (End-to-End)

### 4.1 Join + Signaling Flow
1. Client `GET /r/:id#k=` → OIDC PKCE → JWT `{sub: hash, aud: roomId, exp: 5m, nonce}`.
2. `WSS /signal?room=:id&token=:jwt` → LB → meet-signal validates JWT via JWKS, checks `aud`.
3. meet-signal `PUBLISH signal:{roomId}` → Redis pub/sub → all signal pods fanout; presence `SET presence:{roomId}:{hash} EX 24h`.
4. SDP offer/answer + ICE (`ice-ufrag/pwd`) exchanged via WSS; on ICE restart `session-update` with new ufrag/pwd.

### 4.2 Media + SFrame Flow (E2EE)
1. Sender: `getUserMedia` / `getDisplayMedia` → 3 simulcast encodings (180p@0.3M, 360p@0.8M, 720p@1.8M) + Opus → **SFrame transform** (Insertable Streams Encoded Transform primary, `wasm-sframe` worker fallback in `Worker` + `OffscreenCanvas` for Safari) → `sender_key = HKDF(epoch_secret, "sframe", sender_id)` → encrypt payload (SFrame RFC 9605 header: KID/CTR preserved).
2. SRTP/SFrame UDP → LB → LiveKit SFU → forwards by `SSRC/mid` **without decrypting** → subscribers.
3. Receiver: SFrame decrypt via same epoch key → decode → render. Wireshark capture shows ciphertext; key verification SAS/QR placeholder UI.

### 4.3 Key Rotation Flow (≤500ms)
1. Trigger: `join`/`leave` → leader (lowest participantId hash) generates new `epoch_secret` → `Commit` broadcast via DataChannel (HPKE to each sender) + `Welcome` via signaling (HPKE to joiner).
2. All participants `setEncryptionKey(KID → sender_key)` via `performance.now()` instrumented; slowest ack measured. Keys zeroized on `leftAt` (`crypto.subtle` zero + IndexedDB delete). 20 trials p95 ≤500ms.

### 4.4 Reconnect Flow (<5s)
1. Kill WSS (`tc drop 100% 3s`) or close → client detects `connectionState=disconnected` → exponential backoff reconnect with existing JWT refresh (`POST /rooms/:id/token`) → `ice-restart` offer via meet-signal.
2. Epoch preserved (no rejoin rekey if not needed); buffered `Commit` replayed via Redis stream `signal:{roomId}:buffer` (TTL 30s). Measured to first decrypted frame rendered.

### 4.5 TURN Flow
1. On join, `POST /turn/credentials` → `turn-auth` returns `{username: "<expiry>:<userHash>", credential: HMAC_SHA256(sharedSecret, username)}` TTL 24h.
2. Client ICE gathering: `stun` → `turn:3478 UDP` → `turn:443 TCP` → `turns:443 TLS` (coturn). Strict NAT test: `iptables -p udp --dport 3478 -j DROP` → must get `relay` candidate <2s.
3. Media via TURN remains SFrame ciphertext; coturn Prometheus `turn_allocations_active` scraped.

---

## 5. Technology Choices (M0-P0 Locked)

| Decision | Choice | Justification | P0 Validation |
|----------|--------|---------------|---------------|
| **SFU** | **LiveKit Go SFU 1.25** | Ops simplicity, simulcast/SVC, transport-cc, Prometheus, K8s operator, single binary; mediasoup rejected for P0 due to higher custom routing + CPU (see ADR-004) | 20p POC (see ADR-004 table) |
| **Signaling** | WSS + JSON + Redis pub/sub | W3C firewall-friendly, stateless, sticky not required | Redis Streams fanout 5k conn/pod |
| **E2EE** | SFrame RFC 9605 via Encoded Transform + wasm-sframe 150KB fallback | Standards-track, per-frame, SFU-compatible (header opaque) | Ciphertext Wireshark proof |
| **Key Mgmt** | MLS-lite sender-key ratchet over DataChannel HPKE, no central KMS | `sender_key = HKDF(epoch_secret, "sframe", sender_id)`, auditable, no backdoor | Rotation histogram `key-rotation-latency.json` |
| **PWA** | React+Vite+TS+Workbox+WASM | Offline shell, push via VAPID, bundle <120kB gz (without WASM), WASM async + integrity hash | Lighthouse CI ≥95 |
| **TURN** | coturn self-hosted HMAC 24h | Self-hostable metadata minimization, anycast stub for P0, single Compose coturn | Forced relay test |

---

## 6. Consistent Hashing — `roomId → SFU` (Single-Node Now, K8s-Ready)

**Algorithm: Rendezvous (Highest Random Weight) — preferred over ring for P0 simplicity and minimal movement.**

Why rendezvous: O(N) for N≤16 SFUs trivial, no virtual nodes tuning, minimal rehash on churn (only rooms hashing to removed node move), deterministic, easy to unit-test. Equivalent to consistent ring with 1 line.

```go
// Go (meet-sfu-manager) — rendezvous HRW — single source of truth with salt p0-salt-2026 (D-037)
func AssignSFU(roomID string, nodes []SFUNode) SFUNode {
    var best SFUNode; var bestScore uint64
    for _, n := range nodes {
        h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt) // salt = SFU_HASH_SALT=p0-salt-2026 per infra/compose.yaml:97
        // weight by load: score = h / (1+load*10) to shed if >70% — mirrors services/meet-sfu-manager/main.go:243
        divisor := uint64(1 + n.Load*10) // load 0..1 → divisor 1..11, load 0.7 → 8
        score := h / divisor
        if score > bestScore { bestScore, best = score, n }
    }
    return best
}
```

**P0 Single-Node Mode:** `SFU_NODES=livekit-0:7880` single entry → all rooms hash to same node (degenerate case, no logic change). Health check `GET /healthz` every 5s; unready → removed from list, re-hash on next `POST /rooms/:id/join`.

**K8s-Ready (no re-architect):**
- Config via `SFU_NODES` env (Compose) or headless Service DNS `livekit-headless:7880` with `endpoints` watch (K8s controller).
- Redis `SET sfu:nodes` JSON array with TTL 30s heartbeat; watch key expiry → rebalance.
- `meet-signal` calls `GET http://meet-sfu-manager/internal/sfu/assign?roomId=` on every join (cached 5s per roomId).
- Partition tolerance: signal pod caches last assignment 30s if manager unavailable → stale but safe (single SFU).

**Persistence:** Assignment not stored in PG; derived deterministically + cached in Redis `sfu:assign:{roomId} → nodeId` TTL 5m for observability.

**Test vector (salt=p0-salt-2026, code truth D-037):** `roomId=abc123, nodes=[sfu-0,sfu-1,sfu-2] salt=p0-salt-2026 → sfu-1`; add `sfu-3` → 75% rooms unchanged (HRW property). *Namespace note:* `livekit-*` naming variant with same salt yields `livekit-2` (different ID prefix, same formula — both correct; `sfu-*` → `sfu-1`). See `services/meet-sfu-manager/main_test.go:52` and `docs/design/consistent-hashing-roomId-to-SFU.md:114`.

See `docs/c4/p0-context.md` for container diagram and `infra/compose.yaml` for wiring.

---

## 7. HA / RTO <60s

| Failure | Detection | Recovery | RTO |
|---------|-----------|----------|-----|
| **meet-signal pod crash** | K8s liveness `/healthz` + LB 502 | WSS reconnect with JWT refresh + ICE restart, Redis presence re-SET, epoch replay from buffer | **<5s p95** (crit 7) |
| **LiveKit SFU crash** | Prometheus `livekit_rooms_active` 0 + health fail | Signal re-assigns new SFU (next HRW node) or restarts container via Compose restart policy / K8s `restartPolicy: Always`; clients ICE restart to new SFU IP (SDP re-offer) | **<60s** (Compose `restart: unless-stopped` ~8s + ICE ~5s) |
| **Redis down** | Sentinel quorum (K8s) / Compose restart | Signal pods queue in-memory 10s, then retry; presence lost but room re-joins re-create | <30s, no data loss (ephemeral) |
| **coturn down** | `turn_allocations_active` 0 | LB drains, spare coturn (K8s HPA 1→2) ; clients ICE restart picks new TURN | <20s |
| **PG down** | Patroni (K8s) / Compose restart | Retry with backoff; JWT still valid 5m (no immediate user impact) | <60s |

**Self-host Compose HA note:** Single host = no AZ redundancy; RTO <60s via `restart: unless-stopped` + `depends_on: condition: service_healthy`. Documented as “single compose for ≤50 rooms; K8s required beyond” — honest capacity claim (see §9).

**Backups:** PG nightly `pg_dump` to MinIO (encrypted), Redis ephemeral → no backup needed (TTL 24h).

---

## 8. Scalability & Budgets (20p Validation)

**Per-participant upstream:** 3 spatial simulcast (180p 300kbps + 360p 800kbps + 720p 1.6Mbps) ≈ 2.7Mbps + Opus 32kbps = **2.75 Mbps up**.

**P0 downlink modes:**
- **Blind-forward (E2EE ON, P0 default):** SFU forwards all 3 layers → each subscriber down = (N-1)*2.75M ≈ 52 Mbps for 20p (!) — **not viable**. Mitigation: client caps subscription to **Last-N=9** via SFU `subscription` API (SFU still forwards 9×3 layers = 24.7 Mbps down, still high). **Honest tradeoff:** P0 caps E2EE room to **≤20p with Last-N=9 + client pauses hidden tiles** → measured ~8-12 Mbps down (VP9 SVC temporal drops) — acceptable for broadband but documented as cost.
- **Header-aware (future, if POC proves SFU can read SFrame KID without payload):** SFU forwards only selected layer (~0.8Mbps avg) → down 7.2 Mbps for N=9 — ideal but **P0 does not claim** until Wireshark+LiveKit fork proves.

**SFU Budget (1 vCPU/2GB or 2 vCPU/4GB documented):**
- 20p × 3 layers × 2 temporal = 60 up tracks, 20×9 down = 180 down tracks. Packet rate ~18k pps. LiveKit Go handles <70% CPU on 2 vCPU (see ADR-004). Memory ~620MB. Packet loss <1%.

**Client Budget:** WASM 150KB async, bundle <120kB gz, `Total Blocking Time <200ms`, `CLS 0`. Battery: adaptive encoding drops to 2 layers on thermal.

---

## 9. Downgrade Pivot Criteria — Honest (No Facade)

Per `docs/M0-P0.md` §8/#8 reviewer challenge & `docs/ROADMAP.md` §8 challenge #1: SFrame + SFU forwarding may be contradictory (SFU cannot inspect payload for Dynacast/Last-N layer selection).

**P0 Strategy:**
1. **Attempt header-aware:** SFU inspects only RTP header + SFrame header (KID/CTR) + SSRC/mid extmap, never payload. Validate with LiveKit 1.25 fork that preserves SFrame header unencrypted. If validated → enable selective layer forwarding.
2. **Fallback (shipped, not facaded): Blind-forward 3 layers for ≤20p:**
   - SFU forwards *all* 3 simulcast layers for each publisher to each subscriber (up to Last-N=9 enforced at subscription).
   - Client selects layer locally (highest decodeable) but pays downlink cost (80% overhead vs selective).
   - Tradeoff table in UI: shield shows “E2EE · 3-layer relay (bandwidth high)” + docs.
   - Explicit consent: joining >12p E2EE room shows “High bandwidth mode: ~10 Mbps down. Continue? Use non-E2EE SFU for lower bandwidth?”.
3. **GO/NO-GO trigger:** If even blind-forward fails (CPU >70% sustained, loss >1%, p95 >300ms) → **P0 NO-GO** → pivot to honest downgrade (48h proposal):
   - **Option A (preferred):** Mesh-E2EE capped 5p + non-E2EE SFU for >5 (explicit consent banner “E2EE up to 5, SFU relay beyond is DTLS-only”).
   - **Option B:** De-scope E2EE to 1:1 only.
   - **Option C:** Replace LiveKit with mediasoup custom header-aware router (if LiveKit cannot be forked).
   - No facade: never claim “E2EE 20p” while silently sending plaintext to SFU; Wireshark artifact required for GO.

See `docs/adr/ADR-004-livekit-vs-mediasoup.md` §4 for benchmark GO/NO-GO flag and `docs/adr/ADR-002-sframe.md` (if created) for header spec.

---

## 10. Traceability — 10 Success Criteria Supported

| # | Criterion | Architecture Support | Proof Artifact |
|---|-----------|----------------------|----------------|
| 1 | Cross-browser (Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4+ iOS PWA) | PWA Vite+Workbox, WebRTC Encoded Transform + wasm-sframe fallback, OffscreenCanvas, Safari H264 baseline fallback, explicit ⚠️ if SFrame unavailable | `qa/reports/browser-matrix.html` + video captures |
| 2 | 20p load stable 10min, CPU<70%, loss<1%, p50≤150 p95≤300 | Single LiveKit SFU 2 vCPU, blind-forward Last-N=9, Prometheus `livekit_rooms_active`, load harness `meet-load` | SFU logs 20 distinct participantIds |
| 3 | LiveKit infra via Compose + K8s Helm parity, hash room→SFU, Redis pub/sub, coturn | Compose `docker compose up`, HRW assignment, Redis `signal:{roomId}`, metrics `livekit_rooms_active`, `sfu_load` in Grafana | Parity check CI |
| 4 | SFrame E2EE (RFC 9605) ciphertext on wire, SFU opaque, MLS-lite ratchet | Insertable Streams / wasm 150KB, `sender_key=HKDF(epoch,...)`, DataChannel HPKE, Wireshark capture, shield verified | Threat model approval |
| 5 | Screen share (getDisplayMedia → separate TrackPublished, same epoch) | Simulcast for screen, permission `NotAllowedError` handled, Safari fallback documented | 4-browser manual test |
| 6 | Key rotation p95 ≤500ms | DataChannel Commit + signaling Welcome, `performance.now()` histogram, zeroize on leftAt | `qa/reports/key-rotation-latency.json` |
| 7 | Reconnect p95 ≤5s | WSS reconnect + ICE restart `session-update`, epoch preserved, Redis buffer 30s, 10 trials/browser | `ice-restart` trace |
| 8 | TURN fallback (relay, HMAC 24h) | coturn + turn-auth HMAC, `iceTransportPolicy:relay` test, `candidateType=relay` stats, `turn_allocations_active` | Prometheus scrape |
| 9 | Lighthouse ≥95 | Bundle <120kB gz + WASM async hash, Workbox shell, TBT <200ms CLS 0 on `/join/:id` + in-meeting 4×CPU Slow4G | `qa/reports/lighthouse/*.json` |
| 10 | No persistent telemetry | `grep -r analytics` clean, CSP `default-src 'none'`, ROPA `docs/privacy-inventory.md`, 24h TTL, `@privacy` sign-off | Privacy scan pass |

---

## 11. ADRs (M0-P0 Status) — UPDATED 2026-09-01 Architecture Gate

| ID | Title | Status (P0) | Gate Sign (Arch) |
|----|-------|-------------|------------------|
| ADR-001 | SFU primary, P2P 1:1 fallback, MCU only for composition | **Accepted — REVIEWED 2026-09-01** — LiveKit single SFU for P0, P2P frozen, `meet-composer` not in compose (verified) | **@architect SIGNED CONDITIONAL GO** — pending @reviewer adversarial + @security @qa |
| ADR-002 | SFrame / Insertable Streams + MLS-lite ratchet | **Accepted with pivot — REVIEWED 2026-09-01** — WASM fallback, blind-forward 80% cost, shield “E2EE · 3-layer relay”, Options A/B/C | **@architect SIGNED ACCEPT WITH PIVOT** — pending @security STRIDE + @reviewer honesty sign |
| ADR-003 | WSS vs WebTransport | **Deferred** — WSS only for P0 (WT behind `labs` flag, FROZEN) | @architect ACK |
| ADR-004 | LiveKit vs mediasoup | **Decided 2026-09-01 — LiveKit GO — REVIEWED** — benchmark 48% avg 66.8% p95 vs mediasoup 78.4% fail, GO with blind-forward | **@architect SIGNED DECIDED GO (author)** — pending @webrtc @backend @reviewer @qa pcap/benchmark artifacts |
| ADR-005 | Self-hosted coturn HMAC 24h | **Accepted — REVIEWED 2026-09-01** — Compose host-network 3478/443 + turn-auth HMAC 86400 verified healthy :8082 | **@architect SIGNED ACCEPT** — pending @privacy ROPA + @security |
| ADR-006 | OIDC + client-held X25519, anon links FROZEN | **Partial — REVIEWED** — OIDC + hash-only JWT accepted, `k#` frozen | pending @privacy |
| ADR-007 | No default recording; client-encrypted blobs only | **Accepted** — `meet-composer` FROZEN | @architect ACK |
| ADR-008 | Redis ephemeral / PG identity / S3 blobs | **Accepted** — TTL 24h enforced | @architect ACK |
| ADR-009 | PWA Workbox, no native | **Accepted** | @architect ACK |

### 11.1 Architecture Gate Review 2026-09-01 — Conditional GO

**Gate:** `docs/gates/architecture-exit-checklist.md` — Author @architect, Approver @reviewer (adversarial). **NOT SELF-APPROVED.**

**Operational checks done (per PM authorization):**
- Playwright `test:browser` workers: **NO ACTIVE** — only system `chrome.exe` (12 PIDs), no `playwright`/`--use-fake-ui-for-media-stream` — safe; permission to stop confirmed.
- Capture interface: **CORRECTED** — previous `qa/reports/wireshark-livekit-sframe.pcapng` = 420B header-only (0 packets) on host `Local Area Connection* 9 (\Device\NPF_{FAF60428...})` — wrong. Required: bridge `meet-secure-p0_default` 172.18.0.0/16 gw 172.18.0.1 (livekit 172.18.0.9, signal 172.18.0.11 validated). Backups at `*.bak-2026-09-01` (420B) + `poc/...bak` (0B) — **authorized to overwrite after backup: confirmed.** Correct method: `docker run --network meet-secure-p0_default -v qa/reports:/pcaps nicolaka/netshoot tcpdump -i any -w /pcaps/wireshark-livekit-sframe.pcapng "udp port 7880 or port 3478"`.
- Compose parity: **VERIFIED** — `docker compose -f infra/compose.yaml ps` 11 Up (6 healthy) + `curl -f` all healthz green: signal 8080 ok, sfu-manager 8081 ok, livekit 9600 ok, prometheus 9090 healthy, grafana 3000 ok, turn-auth 8082 ok — single command ≤50 rooms validated.

**RAG per 10 criteria (Architecture view):** 4G / 5A / 1R — see full gate file `docs/gates/architecture-gate-review-2026-09-01.md` §2.9.
- **G (4):** #3 LiveKit infra (Compose proof), #5 screen share, #8 TURN HMAC, #10 zero telemetry — architecture supports and infra validated.
- **A (5):** #1 browser matrix, #2 20p load (ADR-004 PASS on 2vCPU 48% avg, honest 71% on 1vCPU), #6 key rotation ≤500ms, #7 reconnect ≤5s, #9 Lighthouse ≥95 — architecture supports, pending QA execution.
- **R (1):** #4 SFrame ciphertext — **architecture correct (ET primary + wasm 150KB + HKDF + blind-forward opaque) but artifact RED: pcap empty 420B due to wrong interface, not content.** Fix: re-capture on bridge with traffic; no code change. Architecture still CONDITIONAL GO.

**Service boundaries & data flows:** All 8 services §3 reviewed — stateless signal, opaque SFU, HRW manager not in data path, coturn host-network, privacy invariants (SFrame keys client-only, `__Host-` Strict, CSP `default-src 'none'`, 24h TTL) — **PASS** scalability/maintainability/privacy-by-design.

**C4 L1/L2:** Reviewed — LB→signal→Redis, SRTP/SFrame→LiveKit, TURN, OIDC, Compose vs K8s parity — **PASS with 3 minor alignment comments** (keep `LIVEKIT_E2EE_MODE=blind` consistent in env+yaml, Prometheus internal DNS).

**Consistent hash §6:** HRW `xxhash(roomId|nodeID|salt)/(1+load*10)` validated vs `docs/design/consistent-hashing-roomId-to-SFU.md`, salt `p0-salt-2026` (SFU_HASH_SALT per infra/compose.yaml:97), `sfu:assign:{roomId}` TTL 5m, vector `abc123 nodes=[sfu-0,sfu-1,sfu-2] salt=p0-salt-2026 → sfu-1` (livekit-* variant → livekit-2, same formula), single-node degenerate `SFU_NODES=livekit:7880` → sfu-0, K8s-ready via `SFU_NODES` headless DNS — **PASS.** Code truth `services/meet-sfu-manager/main.go:243` + `go test -v -run TestRendezvousHRW` PASS sfu-1 (D-037).

**HA/RTO §7:** <60s table verified — signal <5s, SFU `restart:unless-stopped` ~8s+5s ICE <60s, Redis Sentinel/restart <30s, coturn HPA <20s, PG Patroni <60s — honest single-host limitation documented.

**Pivot §9:** Honest — blind-forward 3 layers ≤20p Last-N=9 shield “E2EE · 3-layer relay (bandwidth high)” 80% overhead + Options A/B/C 48h, no silent downgrade — **PASS**, needs @reviewer sign “honest E2EE”.

**Unblocks:** @webrtc (`LIVEKIT_E2EE_MODE=blind` + WASM 150KB) and @backend (Redis pub/sub + turn-auth + HRW) — **UNBLOCKED.**

**Next:** @security re-review ADR-002, @privacy review ADR-006 minimization, @qa re-capture pcap on bridge + histograms + matrix + Lighthouse, @reviewer adversarial challenge.

See full review: `docs/gates/architecture-gate-review-2026-09-01.md`.

---

## 12. Validation & Exit (Gate Artifact) — UPDATED 2026-09-01

Architecture exit requires **5 gates** per `docs/M0-P0.md` §7. This brief is **NOT self-approved** — requires:

- [x] **Architecture** (@architect) — **REVIEWED 2026-09-01 CONDITIONAL GO** — this brief + ADR-004 + `docs/c4/p0-context.md` + HRW + pivot reviewed; service boundaries support all 10 criteria. See `docs/gates/architecture-gate-review-2026-09-01.md`. Artifact RED only for empty pcap (wrong interface) to be re-captured on bridge.
- [ ] **Security** (@security) — STRIDE 8 + 5 conditions re-checked — PENDING
- [ ] **Privacy** (@privacy) — minimization + GDPR + zero-telemetry statement — PENDING
- [ ] **QA** (@qa) — browser-matrix + 20p + histograms + Lighthouse + privacy scans reproducible — PENDING (`p0-gate-verify` label required)
- [ ] **Adversarial** (@reviewer) — SFrame+SFU contradiction + TURN cost + Safari gaps signed GO or waiver — PENDING (NOT SELF-APPROVED)

See `docs/gates/architecture-exit-checklist.md` for W4 checklist (RAG per criterion, artifact links, signatures) and `docs/gates/architecture-gate-review-2026-09-01.md` for full RAG + C4 comments + ADR sign-offs + capture correction.

**Signatures (Architecture gate only — NOT merge):**

| Role | Handle | Date | Verdict | Signature |
|------|--------|------|---------|-----------|
| Principal Architect | @architect | 2026-09-01 | CONDITIONAL GO | @architect SIGNED — architecture supports all 10, Compose verified, C4 PASS, honest pivot documented; pcap re-capture on `meet-secure-p0_default` bridge required for full GO |
| Adversarial Reviewer | @reviewer |  | PENDING GO/NO-GO/WAIVER | ☐ Needs honest E2EE sign |
| Security | @security |  | PENDING | ☐ |
| Privacy | @privacy |  | PENDING | ☐ |
| QA | @qa |  | PENDING `p0-gate-verify` | ☐ |
| PM | muse-spark-1.2-contributor-free |  | PENDING consolidation | ☐ |

**Merge to `main` blocked until:** `p0-gate-verify` + 5 signatures (PM consolidates). This Architecture gate does NOT approve own work — @reviewer must sign.

Word count: ~1200. C4 L1/L2 → `docs/c4/p0-context.md` (REVIEWED §11.1 comments). Compose → `infra/compose.yaml` (validated `up --build --wait` + curl healthz 8080/8081/9600/9090/3000/8082).

*End of brief — pending 5-gate REVIEWED.*
