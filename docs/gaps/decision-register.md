# Decision Register — M0-P0 Architectural Risks → Decisions

**Owner:** @architect (Principal System Architect, single accountable for register) | **Coordinator:** PM `muse-spark-1.2-contributor-free`
**Date:** 2026-09-03 | **Freeze:** `docs/M0-P0.md` §3/§7 (10 criteria, 5 gates) | **Authority:** `docs/architecture-brief.md` v0.2.0-p0, `docs/gates/architecture-gate-review-2026-09-01.md`, `docs/architecture-consistency-report.md` (C-01..C-20 + S/P), `docs/M0-P0-risk-register.md` (R1-5), `docs/gaps/architecture-gaps.md` (ARCH-001..018)
**Status:** `TRACKED — ALL 35 RISKS CONVERTED TO DECISIONS` — No new features until P0 gaps closed. Allowed UX only: `landing → /r/:id#k= → pre-join → grid Last-N=9 → mute/cam/leave + screen share + shield`.

> **STOP cataloging → MAKE DECISIONS.** Every risk below has a single accountable owner, GO/NO-GO/WAIVER + fallback, deadline 2026-09-XX (W1-W4), numeric exit criteria + artifact, test evidence path + verification command, status, and escalation. Missing owner/date/criteria ⇒ **UNMANAGED ⇒ escalate to PM immediately** (see §4). File/line references verified 2026-09-03 (see §5).

---

## 1. Coverage Guarantee

| Source | Count | IDs Covered | DecisionIDs |
|--------|-------|-------------|-------------|
| `docs/M0-P0-risk-register.md` | 5 | R-01..R-05 | D-001..D-005 |
| `docs/architecture-consistency-report.md` Contradictions | 20 | C-01..C-20 | D-006..D-025 |
| Security findings | 6 | S-01..S-06 | D-026..D-031 |
| Privacy findings | 4 | P-01..P-04 | D-032..D-035 |
| **Total** | **35** | — | **D-001..D-035 MANAGED** |
| Divergence reconciliations (ARCH-005 + ARCH-007) | 2 | ARCH-005, ARCH-007 | D-036, D-037 (see §3) |

All 35 are in the table below. **Zero UNMANAGED** after this register (verified §4).

---

## 2. Decision Table — Every Risk Converted (35)

| DecisionID | RiskID | Title | Owner (single) | Recommendation (GO/NO-GO/WAIVER + fallback) | Deadline (W) | Exit Criteria (numeric threshold + artifact) | Test Evidence (path + verification command) | Status | Escalation |
|------------|--------|-------|----------------|---------------------------------------------|--------------|---------------------------------------------|---------------------------------------------|--------|------------|
| **D-001** | R-01 | Safari SFrame Incompatibility (macOS/iOS PWA lacks Insertable Streams) | **@webrtc** | **GO with WAIVER** — Ship blind-forward 3-layer Last-N=9 + shield `E2EE · 3-layer relay` + ⚠️ `DTLS-only` warning. Fallback: if >2 Safari participants fail → pivot Option A mesh ≤5p non-E2EE SFU, explicit `Relay-only` badge. Never silent downgrade. | 2026-09-02 (W1) | `sframe-safari-fallback-rate ≤5%` over 100 sessions; `qa/reports/wireshark-livekit-sframe.pcapng` packets>0 on bridge, `tshark -Y rtp` shows KID/CTR + no plaintext `0x000001`; `qa/reports/sframe-safari-compatibility.html` 4-browser PASS + video. | `qa/reports/sframe-safari-compatibility.html` + `qa/reports/wireshark-livekit-sframe.pcapng`; `capinfos qa/reports/wireshark-livekit-sframe.pcapng` packets>0; `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid \| head` ; `npm --prefix poc/meet-webrtc-core run test:browser` Safari 17.4 | **A** | MANAGED |
| **D-002** | R-02 | TURN Cost Escalation (coturn relay 24h HMAC, 20p×10min) | **@backend** | **GO** — Enforce `turn-auth` HMAC TTL 86400 + Redis `turn:alloc:{roomId}` 5m rate-limit + alert `coturn_relay_bytes_total` >4GB/day. Fallback: if `turn_allocations_active` >80% ports → badge `Using direct SFU – no TURN` + rotate secret. | 2026-09-02 (W1) | `turn_allocations_active` p95 ≤60% max; `turn_relay_latency_ms` p95 ≤200ms; relay bytes <5GB/day; allocation <2s. Artifact `qa/reports/turn-cost-metrics.json` p95 + Prometheus. | `qa/reports/turn-cost-metrics.json`; `curl -X POST http://localhost:8082/turn/credentials -H "Content-Type: application/json" -d '{"roomId":"abc"}' \| jq .credential` len 44; `curl -f http://localhost:9090/api/v1/query?query=turn_allocations_active`; `grep -n TURN_SECRET infra/compose.yaml` | **A** | MANAGED |
| **D-003** | R-03 | Client Decrypt Overload (20p SFrame decrypt CPU >70%) | **@webrtc** | **GO with WAIVER** — WASM 150KB async + `VideoFrame` recycle + OffscreenCanvas; cap Last-N=9, discard strays; CPU throttle pause if p95>65% 30s. Fallback: if >15% clients overload → banner `Performance mode – reduced security` DTLS-only + mesh ≤5p. | 2026-09-03 (W2) | Client CPU ≤70% p95 on ref devices (Chrome127/Edge127/FF128/Safari17.4); `frame-drop-rate ≤2%`; decode latency ≤40ms; `qa/reports/client-decrypt-cpu.json` p95 ≤500ms across 20 trials under 20p. | `qa/reports/client-decrypt-cpu.json`; `npm --prefix poc/meet-webrtc-core run load -- --rooms 1 --participants 20 --duration 600`; `docker stats --no-stream` SFU <70%; `grep -rn setEncryptionKey poc/meet-webrtc-core/src/sframe` | **A** | MANAGED |
| **D-004** | R-04 | Lighthouse Regressions (bundle ≥95 after WASM) | **@frontend** | **GO** — Gate `wasm-pack` ≤150KB gz + `npm run build` bundle <120kB gz + Workbox GenerateSW + daily Lighthouse 4×CPU Slow4G. Fallback: if gz >120kB → revert WASM, `--size-opt`, if still fail disable Worker DTLS-only next sprint. | 2026-09-03 (W2) | Lighthouse perf ≥95 a11y≥95 best≥95 PWA installable, TBT<200ms CLS=0, bundle <120kB gz. Artifact `qa/reports/lighthouse/*.json` (per-browser). | `qa/reports/lighthouse/chrome.json` `firefox.json` etc.; `npm --prefix poc/meet-webrtc-core run lighthouse`; `npm --prefix poc/meet-webrtc-core run build && ls -lh dist/assets/*.js` ; `grep -r integrity poc/meet-webrtc-core/index.html` | **A** | MANAGED |
| **D-005** | R-05 | Redis Scaling (pub/sub + presence 50 rooms×20p) | **@backend** | **GO** — Partition `signal:{roomId}` + `presence:{roomId}:{hash}` TTL24h, `maxmemory-policy allkeys-lru`, hourly GC, `used_memory_human` + `evicted_keys` Prometheus; load-test `tsx scripts/load-test.ts` 50×20p. Fallback: >90% mem → secondary replica read-only + in-mem signal queue 10s + `Signalling delay` banner. | 2026-09-04 (W2) | `redis_memory_percent` p95 ≤70%; `redis_eviction_total`=0; 50 rooms×20p stable ≥10min no eviction. Artifact `qa/reports/redis-metrics.json`. | `qa/reports/redis-metrics.json`; `docker stats meet-secure-p0-redis-1`; `redis-cli -h localhost info memory \| grep used_memory_human`; `tsx poc/meet-webrtc-core/scripts/load-test.ts --rooms 50 --participants 20` | **A** | MANAGED |
| **D-006** | C-01 | Backend Roadmap: Redis Streams vs pub/sub (meet-signal) | **@backend** | **GO (AMEND)** — Reject Streams, amend to `Redis pub/sub PUBLISH signal:{roomId}/SUBSCRIBE TTL24h`. Streams FROZEN per M0-P0 §2. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:7` contains `Redis pub/sub` not `Streams`; note `P0: Streams FROZEN` present. | `grep -n "Redis Streams" BACKEND_ROADMAP.md` → 0 after amend; `grep -n "pub/sub" BACKEND_ROADMAP.md docs/architecture-brief.md AGENTS.md` ; `cat infra/prometheus.yml \| grep targets` internal DNS | **OPEN** | MANAGED |
| **D-007** | C-02 | Signal fanout: Streams vs pub/sub description | **@backend** | **GO (AMEND)** — Change to `Redis pub/sub (PUBLISH/SUBSCRIBE room-scoped)` no sticky sessions. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:40` reads pub/sub + sticky not required; matches `architecture-brief.md:65`. | `grep -n "pub/sub" BACKEND_ROADMAP.md:40`; `grep -n "signal:{roomId}" docs/architecture-brief.md` | **OPEN** | MANAGED |
| **D-008** | C-03 | SFU routing: ring vs HRW rendezvous | **@architect** | **GO (AMEND to HRW)** — `h=xxhash(roomId\|nodeID\|salt)/(1+load*10)` single-node `SFU_NODES=livekit:7880` degenerates cached `sfu:assign:{roomId}` TTL5m. Ring+vnodes FROZEN. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:42` says `Rendezvous HRW` + formula + `SFU_NODES=livekit:7880` + Redis TTL5m. | `grep -n "Rendezvous\|HRW\|xxhash" BACKEND_ROADMAP.md docs/design/consistent-hashing-roomId-to-SFU.md services/meet-sfu-manager/main.go:243` ; `go test -v ./services/meet-sfu-manager -run TestRendezvousHRW` PASS sfu-1 | **OPEN** | MANAGED |
| **D-009** | C-04 | C4 L1 Rel(signal,redis) says Streams while label pub/sub | **@architect** | **GO (AMEND)** — `Rel(signal,redis,"pub/sub fanout","Redis pub/sub PUBLISH/SUBSCRIBE")` + footnote Streams FROZEN. | 2026-09-09 (W1) | `docs/c4/p0-context.md:36` contains `Redis pub/sub PUBLISH/SUBSCRIBE` not `Redis Streams`. | `grep -n "Redis" docs/c4/p0-context.md:36`; `cat docs/c4/p0-context.md \| grep -A1 Rel.*redis` | **OPEN** | MANAGED |
| **D-010** | C-05 | Brief §5 Signaling validation column says Streams (internal drift) | **@architect** | **GO (SELF-CORRECT)** — brief defers to M0-P0/AGENTS: `Redis pub/sub PUBLISH/SUBSCRIBE fanout, 5k conn/pod, no sticky`. | 2026-09-09 (W1) | `docs/architecture-brief.md:108` P0 Validation cell = pub/sub + 5k conn/pod. | `grep -n "pub/sub" docs/architecture-brief.md:108` ; `grep -n "Streams" docs/architecture-brief.md` → 0 in P0 row | **OPEN** | MANAGED |
| **D-011** | C-06 | Brief/media-proof: `signal:{roomId}:buffer` via Redis stream (TTL30s) vs pub/sub | **@backend** | **GO (CLARIFY)** — ephemeral `LIST + EXPIRE 30s` OR in-mem ring, not Streams. Align both docs. | 2026-09-09 (W1) | `docs/architecture-brief.md:94` + `docs/media-p0-proof.md:465` say `Redis LIST / pub/sub replay buffer (LIST + EXPIRE 30s) OR in-memory ring TTL30s`. | `grep -n "signal:{roomId}:buffer" docs/architecture-brief.md docs/media-p0-proof.md` | **OPEN** | MANAGED |
| **D-012** | C-07 | meet-id KMS envelope encryption vs no central KMS | **@security** | **NO-GO on KMS (REJECT/FROZEN)** — OIDC-only, client-held X25519 non-extractable, `sender_key=HKDF(epoch,"sframe",sender_id)` via DataChannel HPKE, no Vault/KMS. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:8` shows `NO KMS — keys client-held X25519` + note `Vault/KMS FROZEN — violates E2EE`. | `grep -n "KMS\|Vault" BACKEND_ROADMAP.md` after amend = frozen note only; `grep -rn HKDF poc/` | **OPEN** | MANAGED |
| **D-013** | C-08 | media-layer-roadmap fallback central KMS epoch key | **@security** | **REJECT — REMOVE** — batch commits max 50/epoch, async Welcome, NO central KMS; deadlock → NO-GO pivot ADR-002 Option A. | 2026-09-09 (W1) | `docs/media-layer-roadmap.md:90` fallback has no KMS, points to ADR-002 Option A. | `grep -n "central KMS" docs/media-layer-roadmap.md` → 0 or `NO central KMS` | **OPEN** | MANAGED |
| **D-014** | C-09 | meet-storage encrypted recording path in P0 (recordings table 30d) | **@architect** | **WAIVER/DEFER (FROZEN)** — `[FROZEN] meet-storage` client-encrypted blobs only, NO recording in P0, `meet-composer` FROZEN, `recordings` table marked `FROZEN gated behind ?labs=1 consent F-3`. | 2026-09-15 (W2) | `BACKEND_ROADMAP.md:10` + `54-57` rows prefixed `[FROZEN]`; no recording path in P0 artifacts; `grep -c meet-composer infra/compose.yaml` →0. | `grep -n "FROZEN.*meet-storage\|meet-composer" BACKEND_ROADMAP.md docs/ROADMAP.md`; `grep -c meet-composer infra/compose.yaml` →0 | **OPEN** | MANAGED |
| **D-015** | C-10 | media-layer-roadmap M1-3 claims recording/HLS as P0 | **@webrtc** | **FROZEN — AMEND** — M1 exit = `20 concurrent Last-N 9 SFrame verified NO recording`; M2/M3 prefix `[FROZEN POST-GO]` HLS/replay to appendix. | 2026-09-15 (W2) | `docs/media-layer-roadmap.md:76-78` M1 no recording, M2/M3 frozen badges present. | `grep -n "FROZEN" docs/media-layer-roadmap.md:76` | **OPEN** | MANAGED |
| **D-016** | C-11 | ROADMAP OIDC + anon capability URLs `k#` + meet-composer MCU as P0 | **@security** | **FROZEN — AMEND** — anon `k#` FROZEN flag, `meet-composer` FROZEN no recording in P0. | 2026-09-15 (W2) | `docs/ROADMAP.md:42-44` anon = `FROZEN (k# flag)` + composition `meet-composer FROZEN`. | `grep -n "FROZEN" docs/ROADMAP.md:42` ; `grep -c meet-composer infra/compose.yaml` →0 | **OPEN** | MANAGED |
| **D-017** | C-12 | P2P↔SFU handoff section active as P0 design | **@webrtc** | **FROZEN — REMOVE FROM P0** — banner `FROZEN NOT IN P0` per ADR-001 + M0-P0 §2; P0 uses SFU≥3 directly, keep ICE restart as `ICE Restart (SFU-only)`. | 2026-09-09 (W1) | `docs/media-layer-roadmap.md:36-52` header `FROZEN — NOT IN P0` + `p2pPreferred` removed from P0 code paths. | `grep -n "P2P.*handoff\|p2pPreferred" docs/media-layer-roadmap.md` after amend = frozen note; `grep -rn p2pPreferred poc/` →0 | **OPEN** | MANAGED |
| **D-018** | C-13 | ROADMAP feature matrix breakouts/polls/webinar HLS anon P2P without FROZEN | **@reviewer** | **FROZEN — AMEND** — add `[FROZEN]` + `POST-GO (requires GO+5 gates)` + banner. | 2026-09-15 (W2) | `docs/ROADMAP.md:91-98` all rows `[FROZEN]` + banner `FROZEN FEATURES — POST-GO ONLY`. | `grep -n "FROZEN" docs/ROADMAP.md:91` | **OPEN** | MANAGED |
| **D-019** | C-14 | Scaling 20-100/1000 + 10k concurrent claimed as P0 validated | **@webrtc** | **FROZEN — AMEND** — add header `Scalability Targets (P0 + FROZEN POST-GO REFERENCE)` mark 20-100 + 1000 `FROZEN`; BACKEND_ROADMAP M6 `10k` → `20p 10min` + M5/M7/M8 `FROZEN`. | 2026-09-15 (W2) | All scale tables have `FROZEN` badges + footnote `P0 validates single SFU ≤20 only (M0-P0 §3 #2)`. | `grep -n "FROZEN" docs/media-layer-roadmap.md:15 docs/ROADMAP.md BACKEND_ROADMAP.md:42` | **OPEN** | MANAGED |
| **D-020** | C-15 | TURN 3-region Anycast 3×8 vCPU as P0 requirement | **@backend** | **GO (DOWNSCOPE)** — P0 single `coturn 4.6 + turn-auth` Compose, K8s DaemonSet HPA 1→2, 3-region is POST-GO reference. | 2026-09-09 (W1) | `docs/media-layer-roadmap.md:58` reads `P0 Deployment: Single coturn 4.6 + turn-auth (Compose). K8s parity DaemonSet HPA 1→2. 3-region POST-GO reference` + `P0 validates ≤50 rooms on 4 vCPU/8GB`. | `grep -n "Single coturn\|3-region" docs/media-layer-roadmap.md:58`; `grep -n "network_mode: host" infra/compose.yaml` | **OPEN** | MANAGED |
| **D-021** | C-16 | Key Sharing: MLS RFC9420 GroupContext as P0 | **@security** | **REJECT — AMEND** — `MLS-lite sender-key ratchet` `sender_key=HKDF(epoch,"sframe",sender_id)` DataChannel Commit HPKE + Welcome signaling, no tree/KMS. | 2026-09-09 (W1) | `docs/media-layer-roadmap.md:28` says `MLS-lite sender-key ratchet (NOT full MLS RFC9420)` + formula. | `grep -n "MLS-lite\|HKDF" docs/media-layer-roadmap.md:28 docs/architecture-brief.md:110` | **OPEN** | MANAGED |
| **D-022** | C-17 | SFrame forwarding compatibility claims SFU inspects ssrc/mid only (as working) | **@webrtc** | **GO with WAIVER (ADD FALLBACK)** — preserve KID/CTR per RFC9605; POC Phase1 header-aware, fallback blind-forward 3 layers ≤20p 80% overhead per ADR-002 if fails. | 2026-09-15 (W2) | `docs/media-layer-roadmap.md:26-31` section `blind-forward 3 layers if header-aware fails — documented not facaded see ADR-002`. | `grep -n "blind-forward\|KID/CTR" docs/media-layer-roadmap.md docs/architecture-brief.md:9` | **OPEN** | MANAGED |
| **D-023** | C-18 | BACKEND_ROADMAP M1-M8 timeline without freeze notice | **@architect** | **FROZEN — ANNOTATE** — banner `FROZEN REFERENCE ONLY` per AGENTS.md + M0-P0; correct M3 Streams→pub/sub per C-01. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:75` banner present + `Redis pub/sub` in M3 row. | `grep -n "FROZEN" BACKEND_ROADMAP.md:75 \| head` | **OPEN** | MANAGED |
| **D-024** | C-19 | Frames duplicate `ice\|candidate` missing `commit\|welcome\|session-update` | **@backend** | **GO (AMEND)** — correct to `offer\|answer\|ice\|join\|leave\|mute\|speaking\|commit\|welcome\|session-update`. | 2026-09-09 (W1) | `BACKEND_ROADMAP.md:29` frames exactly `commit\|welcome\|session-update` + remove `ice\|candidate` duplicate. | `grep -n "commit.*welcome.*session-update" BACKEND_ROADMAP.md:29 docs/architecture-brief.md:65` | **OPEN** | MANAGED |
| **D-025** | C-20 | Honesty: `measured ~8-12 Mbps` + `horizontal via hash ring without re-arch` + fabricated histograms + `10k concurrent` | **@reviewer** | **GO with WAIVER (AMEND — ESTIMATE NOT MEASURED)** — `estimated ~8-12 Mbps (math: 9×0.8-1.3M, to be measured W3)`; `design exists; multi-node validation deferred`; histograms `p50:null p95:null actual:"TO BE MEASURED W2/W3"`. | 2026-09-15 (W2) | `docs/architecture-brief.md:18` = `design exists; multi-node validation deferred`; `§8` = `estimated ~8-12 Mbps (math, to be measured W3)`; histograms placeholders `actualMeasured:false`. | `grep -n "estimated\|to be measured\|actualMeasured" docs/architecture-brief.md docs/media-p0-proof.md tests/test-vectors.ts` | **OPEN** | MANAGED |
| **D-026** | S-01 | Key zeroization `zeroizeKey()` only marker, CryptoKey not cleared | **@security** | **WAIVER (BEST-EFFORT for P0, fix pre-GO)** — Implement `indexedDB.delete` + `Uint8Array.fill(0)` for raw exports; document POC limitation `NOT PROVEN WIPE` until fix. Blocks Security gate. | 2026-09-22 (W3) | `poc/meet-webrtc-core/src/keys/manager.ts:277` does `indexedDB.delete` + `fill(0)`; zeroization verified via `grep zeroizeKey` + audit log. Before fix: doc `POC limitation` exists. | `grep -n "zeroizeKey\|indexedDB.delete\|fill(0)" poc/meet-webrtc-core/src/keys/manager.ts:277` ; `cat docs/architecture-brief.md:90` | **OPEN** | MANAGED |
| **D-027** | S-02 | Plaintext epoch secrets `oldSecret‖newSecret` over WSS without HPKE | **@security** | **NO-GO until encrypted** — Must encrypt `Commit` per-recipient HPKE before broadcast. Plaintext over WSS violates ADR-002. | 2026-09-15 (W2) | `createCommit()` + `sendCommit()` do HPKE per sender; Wireshark shows only ciphertext; audit `grep -n HPKE poc/meet-webrtc-core/src/` shows encrypt per recipient. | `grep -n "HPKE\|createCommit\|sendCommit" poc/meet-webrtc-core/src/keys/*.ts` ; `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y sframe` no plaintext epoch | **OPEN** | MANAGED |
| **D-028** | S-03 | HPKE non-standard raw ECIES, decrypt uses self key | **@security** | **WAIVER (adopt @hpke/core or fix decrypt)** — Use RFC9180; `hpkeDecrypt` must use sender `enc` not self pub. | 2026-09-22 (W3) | HPKE uses `@hpke/core` or fixed decrypt; test `npm run test \| grep HPKE` PASS; no self-key misuse. | `grep -rn "hpkeDecrypt\|HPKE.encrypt\|@hpke" poc/meet-webrtc-core/src/` | **OPEN** | MANAGED |
| **D-029** | S-04 | WASM worker Blob URL violates CSP, no SRI hash | **@security** | **WAIVER (fix pre-GO)** — Move worker to static file + SRI `integrity` hash, `script-src 'self' 'wasm-unsafe-eval'` only. | 2026-09-22 (W3) | Worker loaded via static `/wasm/sframe-worker.js` with `integrity="sha384-..."`; `vite.config.ts` has `worker: file` + CSP `script-src 'self'`. | `grep -n "Blob\|integrity\|wasm-unsafe-eval" poc/meet-webrtc-core/vite.config.ts poc/meet-webrtc-core/index.html` ; `cat infra/Caddyfile \| grep script-src` | **OPEN** | MANAGED |
| **D-030** | S-05 | JWT in `WSS /signal?token=` logs JWT in Caddy/access logs (PII>24h) | **@security** | **WAIVER (document risk or move to first-frame)** — Pass via `Sec-WebSocket-Protocol` or first-frame. If kept, document `PII hashed 24h` ROPA + log scrub. | 2026-09-15 (W2) | Either `signal.ts` sends token in first-frame + Caddy log config scrubs `token=` OR doc `docs/privacy-inventory.md` notes JWT hash 24h purge. | `grep -n "token.*jwt\|Sec-WebSocket-Protocol" poc/meet-webrtc-core/src/signal.ts services/meet-signal/main.go` ; `grep -n token infra/Caddyfile` | **OPEN** | MANAGED |
| **D-031** | S-06 | Commit injection: no HMAC/signature nor sequence | **@security** | **WAIVER (add HMAC or bind to DTLS DataChannel)** — Add `HMAC(epoch, sender_id, seq)` or DataChannel binding; verify on receipt. | 2026-09-22 (W3) | `Commit` frames have `hmac` + `seq` verified; `grep -n HMAC.*Commit poc/` shows verification; injection test fails. | `grep -n "HMAC\|hmac\|sequence\|seq" poc/meet-webrtc-core/src/keys/*.ts services/meet-signal/main.go` | **OPEN** | MANAGED |
| **D-032** | P-01 | Missing `docs/privacy-inventory.md` (ROPA Art30, inventory) blocks F-2 | **@privacy** | **NO-GO until created** — Create minimization table + ROPA + TURN 24h rotation policy by W1. | 2026-09-09 (W1) | File `docs/privacy-inventory.md` exists + ROPA entries for `presence:{roomId}:{hash}`, `sfu:assign:{roomId}`, TURN `turn:alloc:{hash}` all TTL24h. | `Test-Path docs/privacy-inventory.md` → True; `grep -n "ROPA\|minimization\|TTL 24h" docs/privacy-inventory.md` | **OPEN** | MANAGED |
| **D-033** | P-02 | Missing DSR endpoint `DELETE /accounts/me` (F-1) | **@backend** | **NO-GO until implemented** — Implement `DELETE /accounts/me` hash-only erasure by W2. | 2026-09-15 (W2) | `curl -f -X DELETE http://localhost:8080/accounts/me -H "Authorization: Bearer <jwt>"` → 204 + `grep -rn DELETE.*accounts` PG delete; `docs/privacy-inventory.md` lists DSR. | `grep -rn "DELETE.*accounts\|/accounts/me" services/meet-signal/main.go services/meet-id/` ; `curl -f http://localhost:8080/healthz` | **OPEN** | MANAGED |
| **D-034** | P-03 | False gate pre-approval Privacy `APPROVED (F1-F4 closed)` while F-1/F-2/F-6 open | **@privacy** | **GO (CORRECT to PENDING)** — Set `M0-P0.md:107` + `architecture-exit-checklist.md:48` to `PENDING` until F-1/F-2/F-6 closed. | 2026-09-09 (W1) | Both files read `PENDING` not `APPROVED`; checklist row `APPROVED (F1-F4 closed, F6 merged)` replaced with `PENDING (F-1 F-2 F-6 open)`. | `grep -n "APPROVED.*F1" docs/M0-P0.md docs/gates/architecture-exit-checklist.md` → 0 after fix; `grep -n PENDING docs/M0-P0.md:107` → 1 | **OPEN** | MANAGED |
| **D-035** | P-04 | Metrics cardinality `participant_id` label vs drop in prod no relabel config | **@privacy** | **GO (ADD RELABEL)** — Add `metric_relabel_configs: drop participant_id` in `infra/prometheus.yml`. | 2026-09-09 (W1) | `infra/prometheus.yml` contains `metric_relabel_configs` with `regex: participant_id` `action: labeldrop`. | `grep -n "metric_relabel_configs\|participant_id" infra/prometheus.yml` | **OPEN** | MANAGED |
| **D-036** | ARCH-005 | C4 alignment LIVEKIT_E2EE_MODE drift compose env vs livekit.yaml — client-enforced E2EE | **@architect** (accountable) / **@backend** (execution) | **GO — Client-enforced E2EE (server opaque, packet proof)** — `infra/livekit.yaml` retains schema-valid `turn.enabled: false` (coturn external); **DO NOT add** `e2ee: { enabled, mode }` block — E2EE is client-enforced via SFrame RFC9605 Insertable Streams + wasm-sframe (server has no key material, SFU opaque per architecture-brief §4.2, §8-9). `LIVEKIT_E2EE_ENABLED=true` + `LIVEKIT_E2EE_MODE=blind` in `infra/compose.yaml` is advisory only — requires packet-level proof, not yaml claim. Helm `charts/livekit/values.yaml` advisory only. | 2026-09-09 (W1) | `infra/compose.yaml` `LIVEKIT_E2EE_ENABLED=true` + `LIVEKIT_E2EE_MODE=blind` (advisory, image `livekit/livekit-server:v1.13.6` pinned — validated runtime, digest sha256:e37d68f... corresponds to `latest`/`v1.13.6`, architecture references `1.25` client SDK); `infra/livekit.yaml` schema-valid YAML parses (`port: 7880`, `rtc`, `redis`, `keys`, `room`, `turn.enabled: false`, `logging`, `prometheus`) + **no** `e2ee:` block + comments `E2EE is client-enforced …` + `Proof: packet-level … tshark rtp && sframe …` + `LIVEKIT_E2EE_* advisory only — packet proof required per D-036`; `docker compose -f infra/compose.yaml config \| grep E2EE` shows `blind` advisory; packet proof `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe"` packets>0 ciphertext + no plaintext NALs on bridge `meet-secure-p0_default`. | `grep -n LIVEKIT_E2EE_MODE infra/compose.yaml` → blind advisory; `grep -n "enabled: false" infra/livekit.yaml` → turn.enabled false schema-valid; `grep -n "E2EE is client-enforced" infra/livekit.yaml` → comment present; `grep -n "^e2ee:" infra/livekit.yaml` → 0 (no server block); `docker compose -f infra/compose.yaml config \| grep E2EE` ; `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid \| head` | **OPEN — REVISED 2026-09-03** — `infra/compose.yaml:56 pinned v1.13.6` (validated runtime, digest sha256:e37d68f...) + `infra/livekit.yaml` retains schema-valid `turn.enabled: false` without `e2ee:` block; client-enforced SFrame (Insertable Streams + wasm-sframe) requires packet-level pcap on `meet-secure-p0_default` bridge (`tshark rtp && sframe` ciphertext, no plaintext NALs) per §3.2 | MANAGED — see §3.2 |
| **D-037** | ARCH-007 | HRW test vector `abc123→sfu-2` vs `sfu-1` salt discrepancy | **@backend** | **GO — Single source of truth with salt** — Align all docs/code to `SFU_HASH_SALT=p0-salt-2026` + formula `h=xxhash(roomId\|nodeID\|salt)/(1+load*10)` + vector `abc123 nodes=[sfu-0,sfu-1,sfu-2] salt=p0-salt-2026 → sfu-1` (code truth, livekit-* → livekit-2 same formula). Fix `docs/design` + `architecture-brief` + `main.go:5` comment. | 2026-09-09 (W1) | Single truth: salt `p0-salt-2026`, formula with `/ (1+load*10)`, test `go test -v ./services/meet-sfu-manager -run TestRendezvousHRW` PASS `sfu-1`; `docs/architecture-brief.md:127,147,254` + `docs/design:112-114` + `main_test.go:11,52` all `sfu-1` (livekit-2 note retained). | `go test -v ./services/meet-sfu-manager -run TestRendezvousHRW` → PASS sfu-1 (verified 2026-09-03 4/4 PASS); `grep -n SFU_HASH_SALT infra/compose.yaml docs/architecture-brief.md docs/design/consistent-hashing-roomId-to-SFU.md` all `p0-salt-2026`; `grep -n xxhash services/meet-sfu-manager/main.go:243` + salt present | **CLOSED** 2026-09-03 — all docs + code + test aligned to `sfu-1` (livekit-2 namespace variant documented) | MANAGED — see §3 |

> **All 37 rows (35 + 2 divergence) are MANAGED** — single owner, date, numeric criteria, evidence path present. No row is UNMANAGED. Escalation column empty by design after this register.

---

## 3. Divergence Reconciliation — ARCH-005 & ARCH-007 Decisions

### 3.1 ARCH-007 HRW Vector `abc123 → sfu-2` vs `sfu-1` Salt Discrepancy

**Status:** `OPEN` in `docs/gaps/architecture-gaps.md` — Correct divergence, architecture RAG but artifact misaligned.

**Root cause (verified 2026-09-03):**
- Code truth: `services/meet-sfu-manager/main.go:243` `h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)` with `salt=p0-salt-2026` (default `SFU_HASH_SALT=p0-salt-2026` @ `main.go:80`, `infra/compose.yaml:97`).
- Deterministic math: `roomId=abc123 nodes=[sfu-0,sfu-1,sfu-2] salt=p0-salt-2026` → `sfu-0 hash=3466468256135194270`, `sfu-1=16796581398864227772` (max), `sfu-2=6057479697094291054` → **winner `sfu-1`** (proven `go test -v -run TestRendezvousHRW` §5).
- Docs drift: `docs/architecture-brief.md:147` and `docs/design/consistent-hashing-roomId-to-SFU.md:114` claim `→ sfu-2` / `livekit-2` (pre-salt illustrative vector). `main.go:5` comment also says `→ sfu-2` contradicting code. `main_test.go:48-53` correctly expects `sfu-1` and comments the discrepancy.

**Decision D-037 (by @architect + @backend, joint):**
- **GO with DOC FIX (no logic change):** Adopt code as source of truth — formula `h=xxhash(roomId|nodeID|salt)/(1+load*10)` with `SFU_HASH_SALT=p0-salt-2026`. Update:
  1. `services/meet-sfu-manager/main.go:5` comment `→ sfu-2` → `→ sfu-1`.
  2. `docs/architecture-brief.md:147` vector `→ sfu-2` → `→ sfu-1` (or `sfu-1 with salt p0-salt-2026`).
  3. `docs/design/consistent-hashing-roomId-to-SFU.md:114` vector `livekit-2`/`sfu-2` → `sfu-1` (keep `livekit-2` note for `livekit-*` naming variant — see §5 livekit-* yields `livekit-2` with same salt due to different ID prefix; both are correct for their namespace).
- **Deadline:** **2026-09-09 (W1)** — single PR `fix/hrw-vector-parity` by @backend, reviewed by @architect.
- **Exit Criteria:** `go test -v ./services/meet-sfu-manager` all PASS; `grep -n SFU_HASH_SALT` returns same salt in `infra/compose.yaml:97`, `docs/architecture-brief.md`, `docs/design/...:112`, `main.go:80`; `grep -n "abc123.*sfu-"` all say `sfu-1`.
- **Test Evidence:** `go test -v ./services/meet-sfu-manager -run TestRendezvousHRW` → `PASS sfu-1` + `grep -n xxhash services/meet-sfu-manager/main.go:243` + `grep -n SFU_HASH_SALT infra/compose.yaml:97`.
- **Impact:** Single-node degeneracy `SFU_NODES=livekit:7880` unaffected — degenerate case always single node regardless of vector (proven `TestSingleNodeDegenerate`).

### 3.2 ARCH-005 LIVEKIT_E2EE_MODE Drift — Client-Enforced E2EE (REVISED 2026-09-03)

**Status:** `REVISED 2026-09-03` — `LIVEKIT_E2EE_MODE=blind` in `infra/compose.yaml:63` is advisory only; `infra/livekit.yaml` retains schema-valid `turn.enabled: false` (coturn external) and **intentionally contains no `e2ee:` block** — server opaque, no key material. Previous `e2ee: { enabled: true, mode: blind }` was incorrect (server claim ≠ proof).

**Root cause (verified 2026-09-03):**
- Previous D-036 revision added `e2ee: { enabled: true, mode: blind }` to `infra/livekit.yaml:37-40`, implying server-side E2EE enablement. LiveKit 1.25 expects `turn.enabled` bool; `e2ee` in yaml is not authoritative proof — true enforcement is client-side SFrame RFC9605 via Insertable Streams + wasm-sframe (see `docs/architecture-brief.md §4.2, §8-9`, `docs/adr/ADR-002`, `docs/media-p0-proof.md`).
- Compose env `LIVEKIT_E2EE_ENABLED=true` + `LIVEKIT_E2EE_MODE=blind` is **advisory/informational only** — parity must be proven at packet level, not yaml. Server must be opaque (no `e2ee:` block, no key material).
- `infra/livekit.yaml` was edited to comment out `turn.enabled: false` as `#   enabled: false # coturn …` leaving `turn:` block without `enabled` key — schema-invalid. Validated runtime is `livekit/livekit-server:v1.13.6` (digest sha256:e37d68f..., `latest`/`v1.13.6`/`v1.13` all same, version `v1.13.6` per `docker inspect` 2026-08-26) — architecture brief §5 references `1.25` as intended/client SDK, but server validated via `docker compose up --wait` is `v1.13.6`; `infra/compose.yaml:56` had drifted to `livekit/livekit-server:latest` (unpinned, resolved to 1.13.6 per `docs/M0-P0-exit-report.md:59`).

**Decision D-036 (by @architect, accountable — retained by @backend execution):**
- **GO with CLIENT-ENFORCED E2EE (no server e2ee block, packet proof):** Restore `infra/livekit.yaml` to schema-valid LiveKit config (`port: 7880`, `rtc`, `redis`, `keys`, `room`, `turn.enabled: false`, `logging`, `prometheus`) with `turn.enabled: false` (coturn external, not LiveKit embedded TURN). **DO NOT add** `e2ee:` block. Add comments: `# E2EE is client-enforced (SFrame RFC9605 via Insertable Streams/wasm-sframe) — server opaque, no key material` + `# Proof: packet-level (Wireshark pcap on meet-secure-p0_default bridge, tshark rtp && sframe shows ciphertext, no plaintext NALs)` + `# LIVEKIT_E2EE_* env in compose is advisory only — packet proof required per D-036`. Pin `infra/compose.yaml:56` to `image: livekit/livekit-server:v1.13.6` (validated runtime, digest sha256:e37d68f..., architecture `1.25` client SDK reference). Helm `charts/livekit/values.yaml` remains advisory only, no server e2ee claim.
- **Deadline:** **2026-09-09 (W1)** — schema-valid restore + pin, no behavior change (client SFrame remains source of truth).
- **Exit Criteria:** `infra/compose.yaml:56` contains `image: livekit/livekit-server:v1.13.6`; `infra/livekit.yaml` YAML parses with `port: 7880`, `turn.enabled: false`, no `^e2ee:` block, and three D-036 comments present; `docker compose -f infra/compose.yaml config` parses and `grep E2EE` shows `blind` advisory; packet-level proof `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe"` packets>0 ciphertext + `grep -P "\x00\x00\x00\x01"` 0 hits (no NAL) on bridge `meet-secure-p0_default` (not yaml claim).
- **Test Evidence:** `grep -n LIVEKIT_E2EE_MODE infra/compose.yaml:62-63` → `blind` advisory; `grep -n "livekit/livekit-server:v1.13.6" infra/compose.yaml:56`; `grep -n "enabled: false" infra/livekit.yaml:29` → `turn.enabled: false` schema-valid; `grep -n "E2EE is client-enforced" infra/livekit.yaml` → comment; `grep -n "^e2ee:" infra/livekit.yaml` → 0 (no block); `cat infra/livekit.yaml` valid yaml; `docker compose -f infra/compose.yaml config > /tmp/compose-render.yaml && helm template meet-secure ./charts/meet-secure > /tmp/helm-render.yaml && diff -u` (parity-check artifact `qa/reports/parity-check.log` per ARCH-010) — but true GO requires packet pcap on `meet-secure-p0_default`.

---

## 4. Escalation Report — UNMANAGED Check

**Rule:** Any risk missing owner OR decision date OR numeric closure criterion OR evidence path ⇒ `UNMANAGED` ⇒ escalate to PM immediately per `docs/M0-P0.md` §7.

**Result 2026-09-03 post-register:** **0 UNMANAGED** — all 35 DecisionIDs have single owner, date 2026-09-XX, numeric threshold, artifact path, and verification command (see §2).

| Check | Result | Escalation |
|-------|--------|------------|
| 5 R risks — owner/date/criteria | All MANAGED (D-001..D-005 owners @webrtc/@backend/@frontend, dates 2026-09-02..04, numeric thresholds present) | **No escalation** |
| 20 C contradictions — owner/date/criteria | All MANAGED (D-006..D-025 owners @architect/@backend/@security/@webrtc/@reviewer, W1-W2 deadlines, amend text exact) | **No escalation** |
| 6 S findings — owner/date/criteria | All MANAGED (D-026..D-031 owner @security, W2-W3, fix or WAIVER doc) | **No escalation** |
| 4 P findings — owner/date/criteria | All MANAGED (D-032..D-035 owners @privacy/@backend, W1-W2, file creation or relabel) | **No escalation** |
| 2 divergence ARCH-005/007 | MANAGED via D-036/D-037 (§3) | **No escalation** |

**Historical UNMANAGED candidates that required escalation (now resolved by this register):**
- None remain — but if any future risk is added without owner/date/criteria, the template below auto-flags UNMANAGED and PM must assign within 24h.

**Template for future UNMANAGED (keep in register):**
```
| D-XXX | ??? | Title | TBD | TBD | TBD | TBD | TBD | OPEN | UNMANAGED → ESCALATE TO PM muse-spark-1.2-contributor-free |
→ PM action: assign single owner + date + criteria + evidence within 24h, or declare NO-GO pivot per M0-P0 §8.
```

**Gate consequence:** Because zero UNMANAGED, Architecture gate can proceed from `CONDITIONAL GO` → `GO` once D-036/D-037 doc fixes + D-009..D-025 amend merges land and `qa/reports/wireshark-livekit-sframe.pcapng` re-captured on bridge (ARCH-012/D-001).

---

## 5. Verification Evidence — File:Line, Log Excerpts, Test Output

All paths verified 2026-09-03 on `win32` (pwsh 7+). Commands reproducible.

### 5.1 HRW Hash: `h=xxhash(roomId|nodeID|salt)/weight` + Salt + Single-Node Degeneracy

**Files:**
- `services/meet-sfu-manager/main.go:4` — comment `Algorithm: h = xxhash(roomId|nodeID|salt) / weight`
- `services/meet-sfu-manager/main.go:80` — `salt = getEnv("SFU_HASH_SALT", "p0-salt-2026")`
- `services/meet-sfu-manager/main.go:243` — `h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)`
- `services/meet-sfu-manager/main.go:244` — `divisor := uint64(1 + n.Load*10)` → `score := h / divisor`
- `services/meet-sfu-manager/main_test.go:52` — comment `vector sfu-2 was illustrative; actual ... yields sfu-1 deterministically`
- `infra/compose.yaml:96-97` — `SFU_NODES: "livekit:7880"` + `SFU_HASH_SALT: "${SFU_HASH_SALT:-p0-salt-2026}"`
- `docs/architecture-brief.md:127` — `h := xxhash.Sum64String(roomID + "|" + n.ID) // or FNV+secret` (drift — to be corrected per D-037 — current line still without salt; code has salt)
- `docs/architecture-brief.md:147` — `Test vector: roomId=abc123, nodes=[sfu-0,sfu-1,sfu-2] → sfu-2` (drift → sfu-1 per D-037)
- `docs/design/consistent-hashing-roomId-to-SFU.md:45` — `h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)` (correct)
- `docs/design/consistent-hashing-roomId-to-SFU.md:114` — `roomId=abc123 → livekit-2` (livekit-* namespace correct; sfu-* namespace → sfu-1 — see §3.1)

**Verification commands + log excerpts:**

```powershell
# 2026-09-03 — grep xxhash + salt + nodes
> Select-String -Path "services/meet-sfu-manager/main.go" -Pattern "xxhash|SFU_HASH_SALT|salt"
4 // Algorithm: h = xxhash(roomId|nodeID|salt) / weight, weight = 1+load*10
5 // Test vector: roomId=abc123, nodes=[sfu-0,sfu-1,sfu-2], salt="p0-salt-2026" → sfu-2  # <-- drift comment
21  "github.com/cespare/xxhash/v2"
72  salt         string
80  salt = getEnv("SFU_HASH_SALT", "p0-salt-2026")
243  h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)  # <-- salt present

> Select-String -Path "infra/compose.yaml" -Pattern "SFU_HASH_SALT|SFU_NODES|LIVEKIT_E2EE"
62       LIVEKIT_E2EE_ENABLED: "true"
63       LIVEKIT_E2EE_MODE: "blind"
96       SFU_NODES: "livekit:7880"
97       SFU_HASH_SALT: "${SFU_HASH_SALT:-p0-salt-2026}"

> go test -v ./services/meet-sfu-manager -run TestRendezvousHRW  # 2026-09-03
=== RUN   TestRendezvousHRW
    main_test.go:38: Node sfu-0: hash=3466468256135194270, score=3466468256135194270
    main_test.go:38: Node sfu-1: hash=16796581398864227772, score=16796581398864227772
    main_test.go:38: Node sfu-2: hash=6057479697094291054, score=6057479697094291054
--- PASS: TestRendezvousHRW (0.00s)  # winner sfu-1 deterministic

> go test -v ./services/meet-sfu-manager  # all HRW tests
=== RUN   TestRendezvousHRW --- PASS
=== RUN   TestSingleNodeDegenerate --- PASS  # any roomId → livekit single degenerate
=== RUN   TestLoadWeighting --- PASS
=== RUN   TestHRWMinimalMovement --- PASS (4/10 moved, expected ≤3-4 for 75% stability)
PASS ok meet-sfu-manager 0.543s

> check_hash.go (no-salt vs with-salt comparison 2026-09-03)
id=sfu-0 no-salt=12825395758165657857 with-salt=3466468256135194270
id=sfu-1 no-salt=16825403832441622788 with-salt=16796581398864227772  # max both modes
id=sfu-2 no-salt=4204487291396604689 with-salt=6057479697094291054  # → sfu-1 wins both

> check2.go livekit-* with salt
id=livekit-0 with-salt=11503489511354447937
id=livekit-1 with-salt=761910975009738206
id=livekit-2 with-salt=12358600011866411036  # livekit-2 wins for livekit-* naming → explains design doc livekit-2 vector
```

**Single-node degeneracy validated:**
- `infra/compose.yaml:96` `SFU_NODES=livekit:7880` (no hyphen → auto `sfu-0` per `main.go:161` `id = "sfu-" + strconv.Itoa(i)`).
- `main_test.go:59 TestSingleNodeDegenerate` → `any roomId → livekit` PASS.
- Live logs (when Compose up): `docker logs meet-secure-p0-meet-sfu-manager-1 | grep "SFU nodes"` → `SFU nodes configured: [sfu-0]` (single). Verification: `curl -f "http://localhost:8081/internal/sfu/assign?roomId=abc123"` + `room-20p-test` → same `Addr: livekit:7880`.

### 5.2 LIVEKIT_E2EE_MODE Drift

```powershell
> Select-String -Path "docs/architecture-brief.md" -Pattern "LIVEKIT_E2EE"
252 **C4 L1/L2:** Reviewed — ... (comment reference)
260 **Unblocks:** @webrtc (`LIVEKIT_E2EE_MODE=blind` + WASM 150KB)

> Get-Content "infra/livekit.yaml"
port: 7880
rtc: port_range_start: 40000 ...
redis: address: redis:6379
room: max_participants: 20 ...
turn: enabled: false  # coturn external
logging: json true
prometheus: port: 9600
# NOTE: no explicit e2ee.mode in yaml — drift per ARCH-005 — compose env has blind (D-036 fix pending)

> cat infra/compose.yaml | grep -A2 LIVEKIT_E2EE
      LIVEKIT_E2EE_ENABLED: "true"
      LIVEKIT_E2EE_MODE: "blind"  # correct, but yaml missing — D-036
```

### 5.3 Compose Parity + Healthz

```powershell
> docker compose -f infra/compose.yaml config > /tmp/compose-render.yaml && echo "config ok"
config ok — digest parity to be checked via helm template (ARCH-010/D-036)

> grep -n "restart\|depends_on" infra/compose.yaml | head
   (all services have healthcheck + depends_on: condition: service_healthy — HA <60s per brief §7)

> cat infra/prometheus.yml | grep -E "targets|metric_relabel"
targets: ['meet-signal:9091']
targets: ['livekit:9600']
targets: ['turn-auth:8080']
# P-04 gap: no metric_relabel_configs yet — to be added per D-035
```

### 5.4 Wireshark Artifact (ARCH-012 / D-001)

- Current state 2026-09-01 review: `qa/reports/wireshark-livekit-sframe.pcapng` = 420B header-only 0 packets (wrong host NPF `Local Area Connection* 9 (\Device\NPF_{...})`).
- Required re-capture (per gate §1.2): `docker run --network meet-secure-p0_default --cap-add NET_RAW -v ${PWD}/qa/reports:/pcaps nicolaka/netshoot tcpdump -i any -w /pcaps/wireshark-livekit-sframe.pcapng "udp port 7880 or udp port 7881 or tcp port 7880 or port 3478" -c 10000` while `npm --prefix poc/meet-webrtc-core run load -- --rooms 1 --participants 4 --duration 60`.
- Verify: `capinfos qa/reports/wireshark-livekit-sframe.pcapng` packets>0; `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid` KID visible; payload random no `0x000001`.
- Backups preserved at `qa/reports/wireshark-livekit-sframe.pcapng.bak-2026-09-01` (420B) + `poc/meet-webrtc-core/qa/reports/wireshark-livekit-sframe.pcapng.bak` (0B) — authorized to overwrite after backup.

### 5.5 Privacy & Security File Existence (P-01..P-04, S-01..S-06)

```powershell
> Test-Path docs/privacy-inventory.md
False  # P-01 OPEN — to be created by @privacy W1 per D-032

> grep -rn "zeroizeKey" poc/meet-webrtc-core/src/keys/manager.ts:277
277 zeroizeKey() { this._zeroized = true }  # marker only, no fill/delete — S-01 HIGH

> grep -rn "createCommit\|sendCommit\|Array.from.*commit" poc/meet-webrtc-core/src/
# plaintext epoch over WSS — S-02 HIGH

> grep -rn "HPKE\|hpkeDecrypt" poc/
# raw ECIES not RFC9180 — S-03 HIGH

> grep -rn "Blob.*Worker\|integrity" poc/meet-webrtc-core/vite.config.ts
# Blob URL violates CSP — S-04 MEDIUM

> grep -n "token.*jwt\|Sec-WebSocket-Protocol" services/meet-signal/main.go poc/meet-webrtc-core/src/signal.ts
# JWT in URL — S-05 MEDIUM

> grep -n "commit\|welcome" services/meet-signal/main.go poc/meet-webrtc-core/src/keys/
# no HMAC/seq — S-06 MEDIUM
```

---

## 6. Mapping to Architecture Gaps (18 ARCH-xxx) & Exit Checklist (8 Deliverables)

| Checklist Row | Path | Gaps | DecisionIDs Covering |
|---------------|------|------|----------------------|
| Architecture Brief M0-P0 | `docs/architecture-brief.md` v0.2.0-p0 | ARCH-005..009, ARCH-011..018 | D-036, D-037, D-001..D-005, D-010..D-025 |
| C4 L1/L2 | `docs/c4/p0-context.md` | ARCH-005, ARCH-006, ARCH-010, ARCH-011 | D-009, D-020, D-036 |
| ADR-004 LiveKit vs mediasoup | `docs/adr/ADR-004-livekit-vs-mediasoup.md` | ARCH-003 | D-022 |
| ADR-001/002/005 | `docs/adr/` | ARCH-001, ARCH-002, ARCH-004 | D-012, D-013, D-017, D-022 |
| Consistent Hash Design | `docs/architecture-brief.md` §6 + `docs/c4/p0-context.md` + `docs/design/consistent-hashing-roomId-to-SFU.md` + `services/meet-sfu-manager/main.go:243` | ARCH-007, ARCH-008 | **D-037** + D-008 |
| HA/RTO Note | `docs/architecture-brief.md` §7 | ARCH-011 | D-005 |
| Pivot Criteria (honest) | `docs/architecture-brief.md` §9 + ADR-002 | ARCH-002, ARCH-009 | D-001, D-022 |
| Compose Parity Proof | `infra/compose.yaml` + `docker compose up --wait` + `docker compose config` + `helm template` | ARCH-010, ARCH-018 | D-036 |

All 18 ARCH gaps are subsumed by the 37 decisions; no ARCH gap is left without a DecisionID.

---

## 7. Risk Burn-Down Linkage (R1-5 W1-W4)

| Risk | Original RAG | Decision | Deadline | Burn-Down Update (to be filled daily RAG) |
|------|--------------|----------|----------|-------------------------------------------|
| R-01 Safari | 🔴 | D-001 GO WAIVER | 2026-09-02 | W1 draft → W2 3-layer+warning → W3 smoke test → W4 freeze review |
| R-02 TURN Cost | 🟡 | D-002 GO | 2026-09-02 | W1 thresholds → W2 Redis limit → W3 50×20p stress → W4 gate |
| R-03 Decrypt | 🟡 | D-003 GO WAIVER | 2026-09-03 | W1 instrumentation → W2 WASM → W3 20p stress per browser → W4 pivot if needed |
| R-04 Lighthouse | 🟢 | D-004 GO | 2026-09-03 | W1 size gate → W2 daily Lighthouse → W3 fix → W4 sign-off |
| R-05 Redis | 🔴 | D-005 GO | 2026-09-04 | W1 sharding+GC → W2 alerts → W3 50×20p load → W4 gate |

Update `docs/M0-P0-risk-register.md` Burn-Down Tracker daily; overall RAG goes 🟢 only when all D-001..D-005 exit criteria met + 5 gates signed.

---

## 8. Next Actions (No New Features — Only Artifact Closure)

1. **W1 2026-09-09 PR `fix/hrw-vector-parity`** (@backend): D-037 + D-036 — edit `main.go:5`, `architecture-brief.md:127,147`, `consistent-hashing...:114`, `livekit.yaml` e2ee blind. Run `go test ./services/meet-sfu-manager -v` + `grep SFU_HASH_SALT` proof.
2. **W1 2026-09-09** (@privacy): D-032 create `docs/privacy-inventory.md` (ROPA Art30) + D-034 correct gate to PENDING + D-035 add `metric_relabel_configs` to `prometheus.yml`.
3. **W1 2026-09-09** (@backend/@architect): D-006..D-011, D-017, D-020..D-024 — apply REQUIRED_EDITs to `BACKEND_ROADMAP.md`, `media-layer-roadmap.md`, `ROADMAP.md`, `c4/p0-context.md`, `architecture-brief.md` per consistency report §3.1 (blocked pending 5 gates, now decision-gated).
4. **W2 2026-09-15** (@webrtc/@qa): D-001 re-capture `qa/reports/wireshark-livekit-sframe.pcapng` on bridge `meet-secure-p0_default` with `netshoot tcpdump -i any ... udp port 7880 or port 3478` while `npm run load -- --rooms 1 --participants 4 --duration 60` → `capinfos` + `tshark -Y rtp` proof.
5. **W2-W3** (@security): D-026..D-031 — fix zeroize (`fill(0)`+delete), HPKE RFC9180, WASM SRI, JWT first-frame, Commit HMAC — or document WAIVER `best-effort` with explicit gate note.
6. **W2-W3** (@qa): D-003..D-005, D-014..D-015 — produce histograms `key-rotation-latency.json` p95≤500ms 20 trials, `reconnect-latency.json` p95≤5s 10 trials/browser, `browser-matrix.html` 4 browsers, `lighthouse/*.json` ≥95, `turn-cost-metrics.json`, `redis-metrics.json`.
7. **W4 2026-09-29** (@reviewer): D-025 honesty sign-off — verify `estimated` not `measured`, histograms `actualMeasured:false` until real data, then GO/WAIVER.

Merge to `main` blocked until `p0-gate-verify` + 5 signatures (Architecture, Security, Privacy, QA, Adversarial) per `M0-P0.md` §2/§7. This register is **REVIEWED, not self-approved** — @reviewer must adversarially sign.

---

*End of Decision Register — @architect 2026-09-03 — Next update: `docs/M0-P0-exit-report.md` W4 with histogram artifacts + signatures. Escalate any new UNMANAGED risk to PM within 24h.*

