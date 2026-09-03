# M0-P0 Benchmark Challenge — 20-Participant 27-Stream SFrame Decrypt
**Document ID:** reviewer/benchmark-challenge-27-stream-decrypt
**Version:** 1.0.0 | **Date:** 2026-09-01 | **Owner:** @reviewer (Adversarial Reviewer)
**Status:** `CHALLENGE FILED — Requires @webrtc + @qa response + @reviewer adjudication`
**Authority:** docs/M0-P0.md §8 NO-GO triggers, §9 risks; docs/architecture-brief.md §8-9; docs/media-p0-proof.md §3.2; docs/gates/architecture-exit-checklist.md §5

## 0. Executive Summary
Under shipped blind-forward strategy (architecture-brief §8-9), every subscriber must decrypt **27 concurrent SFrame streams** — 9 peers × 3 simulcast layers (Last-N=9) — sustained 10 min. No published benchmark measures per-frame decrypt latency, dropped frames, or worker CPU at this scale. Until benchmark passes on 4 browsers, "E2EE 20p" is assertion, not measurement.

## 1. The Contradiction — Why 27 Streams
| Decision | Source | Value |
|----------|--------|-------|
| Simulcast per publisher | test-vectors.ts simulcastLayers | **3** (180p/360p/720p) |
| Last-N cap | test-vectors.ts sfu.lastN | **9** |
| Downlink per subscriber | 9×3 | **27 streams** |

20p → each publishes 3 → SFU blind-forwards all 3 (SFrame opaque) → Last-N=9 → 27 decrypts per client. Full-grid worst: 19×3=57. SFU cannot select layer (header-aware fails → blind-forward), client must decrypt all 27 to select best layer.

Not claimed: 57 required, WASM only, render all 27. Claimed: decrypting 27 is hard real-time workload that must be measured.

## 2. Benchmark Spec
| Param | Value |
|-------|-------|
| Participants | 20 (19 synthetic +1 real) |
| Duration | 10 min stable |
| Codec pref | VP9 SVC |
| Fallback | H264 baseline |
| Simulcast | 180p@300k / 360p@800k / 720p@1.8M + Opus 32k |
| E2EE | SFrame blind-forward all 3 |
| Subscription | Last-N=9 → 27 streams |
| WASM budget | 15ms per frame |
| Browsers | Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4 macOS+iOS PWA |

Per-frame math: 27 streams × 30fps = 810 decrypts/sec. WASM 15ms×27=405ms worker work/sec — exceeds single core if serialized → frame drop risk.

## 3. Metrics Per Browser (histogram p50/p95/p99 + peak, 10 min)
### 3.1 CPU
- Main thread % (<70% sustained), Worker % (<70% per worker), Combined (<70%×cores), spike >80% (<5s cumulative). Report navigator.hardwareConcurrency.

### 3.2 Memory
- JS heap <500 MB, WASM linear <150 MB, VideoFrame/OffscreenCanvas <200 MB (27×5-8MB), Total <500 MB, GC pause <50ms. Critical: 27 decoded surfaces = 135-216 MB.

### 3.3 Frame-level
- Dropped frames % <1% aggregate, <2% per stream, Decode p95 <30ms, SFrame decrypt p95 <15ms per frame, End-to-end p50≤150 p95≤300, TBT <200ms, Jank <5/min (frames >16.6ms).

### 3.4 Battery/Thermal
- Discharge rate (if available), Thermal throttle events → **any throttle = FAIL**, Adaptive layer drop count (document).

## 4. Pass/Fail
### 4.1 Hard Pass (all)
1. SFU CPU <70% 2. Packet loss <1% 3. e2e p50≤150 4. e2e p95≤300 5. Dropped <1% 6. Decrypt p95<15ms 7. Memory <500MB 8. Key rotation p95≤500ms 9. Reconnect p95≤5s 10. Wireshark ciphertext.

### 4.2 Per-browser: each browser must pass independently. Safari weakest (no VP9 HW, OffscreenCanvas GPU contention, partial ET).

### 4.3 Fail conditions (any triggers FAIL for browser)
CPU>70% >10s, Memory>500MB, Dropped>1% any stream, Decrypt p95>15ms, e2e p95>300ms >5% frames, thermal throttle, WASM crash, Safari silent DTLS fallback (must be explicit ⚠️).

### 4.4 Aggregate: All 4 browsers must pass 10 min. One FAIL = benchmark FAIL.

## 5. Test Procedure
### 5.1 Setup
```
docker compose -f infra/compose.yaml up --build --wait
curl -f http://localhost:8080/healthz && curl -f http://localhost:8081/healthz && curl -f http://localhost:9600/healthz
npm --prefix poc/meet-webrtc-core run load
join 1 real measurement client (Last-N=9)
```
### 5.2 Instrumentation
```
performance.mark sframe-encrypt → decrypt → measure decrypt-latency
performance.mark decode-start → decode-end → measure decode-latency
performance.mark e2e-start → e2e-render → measure e2e-latency
getStats() every 1s: framesDecoded/framesDropped, decodeLatency, packetsLost
PerformanceObserver: measure, layout-shift, LCP, paint
```
### 5.3 Browser collection
Chrome/Edge/Firefox: performance.now() in transform + getStats + performance.memory + getBattery. Safari: performance.now() in WASM worker + OffscreenCanvas + getStats + limited memory. If Safari cannot measure decrypt latency → INCONCLUSIVE, retry with worker timestamp injection.

### 5.4 Stress variants
1. Worst case all 20×720p 30fps 3 layers Last-N=9
2. WASM-only (encodedTransform false)
3. Key rotation at t=5min under load
4. WSS kill + reconnect at t=5min
5. TURNS relay forced at t=5min

### 5.5 Artifacts
- qa/reports/decrypt-latency-{chrome,edge,firefox,safari}.json
- qa/reports/dropped-frames-{browser}.json
- qa/reports/memory-{browser}.json
- qa/reports/cpu-{browser}.json
- qa/reports/27-stream-decrypt-benchmark.json
- qa/reports/browser-matrix.html (add decrypt rows)

## 6. Honest Downgrade Trigger
Any 2+ browsers FAIL → NO-GO Option A: Mesh-E2EE ≤5p + non-E2EE SFU >5 (explicit banner). Safari-only FAIL → document, fix, if not fixable 48h → NO-GO. WASM FAIL (>1 browser no ET) → NO-GO. Memory>500MB or thermal throttle or silent DTLS fallback → NO-GO.
Options: A mesh ≤5p + non-E2EE SFU (preferred), B 1:1 only, C mediasoup header-router. Timeline: 48h pivot proposal from @architect+@webrtc+@reviewer, 1 week stakeholder decision.

## 7. Cost of Not Challenging
Silently drops 12/27 streams → user sees 15 tiles active 4 frozen under "E2EE · 3-layer relay" with no warning — violates Honest E2EE (arch-brief §1) and is worse than documented downgrade. Reputational risk if press stress-tests. Without measurement cannot choose ET vs WASM, verify Last-N enforcement, guarantee memory/thermal.

## 8. Traceability
Stream math: test-vectors maxDownlinkLayers; Blind-forward: arch-brief §8-9; WASM 15ms: arch-brief §8; CPU/p95: M0-P0 #2; NO-GO: M0-P0 §8; Options: arch-brief §9; Risks: risk-register; Gates: exit-checklist §5.

## 9. Requested Actions
| # | Action | Owner | Deadline | Artifact |
|---|--------|-------|----------|----------|
| 1 | Instrument decrypt latency in sframe/ | @webrtc | W2 | decrypt-latency-*.json |
| 2 | Dropped-frame per track | @webrtc | W2 | dropped-frames-*.json |
| 3 | Memory profiling | @frontend | W2 | memory-*.json |
| 4 | Run 20p×10min 4 browsers | @qa | W2-W3 | 27-stream-decrypt-benchmark.json |
| 5 | Adjudicate | @reviewer | W3 | sign-off |
| 6 | If FAIL 48h pivot | @architect+@webrtc+@reviewer | W3+48h | docs/M0-P0-pivot-*.md |

## 10. Sign-off
Challenge open until @webrtc+@qa produce artifacts and @reviewer adjudicates, or waiver documented. If not resolved W3 EOD escalate to PM for GO/NO-GO.
*Adversarial challenge, not spec — demands measurement. If 27-stream decrypt passes, challenge closed with data. If fails, honest NO-GO pivot before shipping.*
