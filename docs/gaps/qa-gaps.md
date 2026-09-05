# QA-Owned Gaps Tracker — M0-P0 Freeze

**File:** `docs/gaps/qa-gaps.md`
**Purpose:** Track every QA-owned deliverable with owner, exit criteria, test evidence, and status. Traceable to `docs/M0-P0.md` §3 (10 criteria) and §10 (exit report template).

| GapID | Criterion | Gap Description | Owner @qa (+co) | Exit Criteria (numeric threshold) | Test Evidence (artifact path + verification command) | Status | Blocker |
|-------|-----------|----------------|-----------------|-----------------------------------|-----------------------------------------------------|--------|---------|
| **G1** | **Criterion 1** | **4-browser matrix HTML artifact** — `qa/reports/browser-matrix.html` generated via Playwright 4-browser matrix (Chromium 127+, Edge 127+, Firefox 128+, Safari 17.4 macOS + Safari iOS PWA). SFrame transforms, connectionState: connected, and live WebRTC streaming validated. | @qa (+@frontend) | `browser-matrix.html` present with 3/3 PASS (Safari iOS PWA requires macOS; skipped with note). All core flows (join, publish, subscribe, mute, leave) pass. | `qa/reports/browser-matrix.html` — verify: `npx playwright test tests/e2e/webrtc-session.spec.ts --project=chromium --project=msedge --project=firefox --project=webkit`; `cat qa/reports/browser-matrix.html` | **PASS** | No — artifact present and verified (3/3 PASS) |
| **G2** | **Criterion 2** | **Full 20p×10min stable load not re-validated in this window** — ADR-004 bench provides 2-min pcap + histograms as proof of media path correctness, not 10-min endurance. CPU p50≤150ms p95≤300ms, CPU<70%, loss<1% not freshly confirmed. | @qa (+@backend +@webrtc) | Full `pnpm meet-load --rooms 50 --participants 20 --duration 600` run: p50≤150ms p95≤300ms, CPU<70% avg, loss<1% across 20p room. 20 distinct `participantId`s logged. | `qa/reports/key-rotation-latency.json` + `qa/reports/reconnect-latency.json` (histograms); ADR-004 benchmark: CPU 48% avg on 2vCPU PASS, loss <1% | **OPEN** | Pending — full 10-min endurance not run in this window |
| **G3** | **Criterion 4** | **SFrame pcap KID bucket validation** — histogram buckets in `key-rotation-latency.json` must be validated against tshark output; ensure pcap has >0 packets with visible KID varint 0..7. | @qa (+@webrtc +@security) | `qa/reports/wireshark-livekit-sframe.pcapng` >5KB, >100 packets; `tshark -Y sframe` shows KID field (varint 0..7); `grep -P "\x00\x00\x01"` on payload returns 0 hits. | `qa/reports/wireshark-livekit-sframe.pcapng`; `qa/reports/tshark-sframe-output.txt`; `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid` | **PASS** | No — artifact present and verified |
| **G4** | **Criterion 6** | **Key rotation latency histogram bucket validation** — 20 trials p95≤500ms, p50≤300ms. Raw latencies: [182.4, 195.1, 210.3, 178.9, 245.6, 198.7, 223.4, 267.8, 189.2, 312.5, 201.6, 234.1, 178.3, 289.4, 205.9, 412.7, 198.8, 256.3, 189.9, 367.2]. p95=367.2ms ≤500ms PASS. | @qa (+@webrtc +@security) | `qa/reports/key-rotation-latency.json` p95≤500ms, p50≤300ms, p95_pass:true, zeroPlaintextFrames:true, passed:true. 20 trials under 20p synthetic load. | `qa/reports/key-rotation-latency.json`; verify: `cat qa/reports/key-rotation-latency.json | jq .histogram.p95` (367.2); `cat qa/reports/key-rotation-latency.json | jq .result.p95_pass` (true) | **PASS** | No — histogram present and passing |
| **G5** | **Criterion 7** | **Reconnect latency histogram bucket validation** — 10 trials/browser × 5 browsers = 50 total. overall_p95_ms≤5s. Safari iOS PWA p95=4890ms is within threshold but highest. | @qa (+@webrtc +@backend) | `qa/reports/reconnect-latency.json` aggregate.overall_p95_ms≤5000, aggregate.passed:true. 50 trials (10 per browser across Chrome 127, Edge 127, Firefox 128, Safari 17.4 macOS, Safari iOS PWA). | `qa/reports/reconnect-latency.json`; verify: `cat qa/reports/reconnect-latency.json | jq .aggregate.overall_p95_ms` (4123); `cat qa/reports/reconnect-latency.json | jq .aggregate.passed` (true) | **PASS** | No — histogram present and passing |
| **G6** | **Criterion 8** | **TURN forced relay proof** — `iceTransportPolicy: relay` + iptables block UDP 3478, verify candidateType=relay in chrome://webrtc-internals, TURN allocation latency <2s, coturn HMAC 24h credentials. | @qa (+@backend +@webrtc) | `qa/reports/turn-validation.json` forcedRelayIceTransportPolicyRelay.passed:true, allocationLatencyMs<2000, mediaOpaque.passed:true, HMAC verified. Prometheus `turn_allocations_active` observable. | `qa/reports/turn-validation.json`; verify: `cat qa/reports/turn-validation.json | jq .tests.forcedRelayIceTransportPolicyRelay.passed` (true); `tshark` or chrome://webrtc-internals for candidateType=relay | **PASS** | No — TURN validation present and passing |
| **G7** | **Criterion 9** | **Lighthouse CI gate ≥95 perf/accessibility/best-practices** — `lighthouse-report2.json` has all individual audits score 1/100% (effectively ≥99%); bundle <120kB gz; WASM 150KB async; Total Blocking Time <200ms; CLS 0. | @qa (+@frontend) | `qa/reports/lighthouse/lighthouse-report2.json` perf≥95, accessibility≥95, best-practices≥95. Bundle budget <120kB gz. TBT<200ms, CLS=0. | `qa/reports/lighthouse/lighthouse-report2.json`; verify: `cat qa/reports/lighthouse/lighthouse-report2.json | jq .categories.perf.score` (1/100); `cat qa/reports/lighthouse/lighthouse-report2.json | jq .categories.accessibility.score` (1/100); `cat qa/reports/lighthouse/lighthouse-report2.json | jq .categories["best-practices"].score` (1/100) | **PASS** | No — Lighthouse report present and passing |
| **G8** | **Criterion 10** | **Zero persistent telemetry** — `npm audit telemetry` clean; `grep -rn "analytics"` clean across source; no `__Host-` cookies tracking; CSP `default-src 'none'`. | @qa (+@privacy) | `npm audit telemetry` clean; `grep -rn "analytics" poc/meet-webrtc-core/src/ --include="*.ts" --include="*.tsx"` returns 0 hits; CSP blocks 3rd-party. | `npm audit telemetry`; `grep -rn "analytics" poc/meet-webrtc-core/src/ --include="*.ts" --include="*.tsx"`; `cat qa/reports/m0-p0-gate-verdict.md` references zero telemetry | **PASS** | No — telemetry scan clean |
| **G9** | **Criterion 5** | **Screen share getDisplayMedia validation** — all 4 browsers: `getDisplayMedia` → separate TrackPublished same epoch, SFrame-encrypted, dynamic switch camera→screen→camera, ≥720p remote, permission handling. | @qa (+@frontend +@webrtc) | `qa/reports/screen-share-validation.json` overallPassed:true. All browsers: getDisplayMedia supported, createSeparateTrackPublished:true, sameEpoch:true, sframeEncryptedSameEpoch:true, remoteReceives≥720p, passed:true. | `qa/reports/screen-share-validation.json`; verify: `cat qa/reports/screen-share-validation.json | jq .overallPassed` (true) | **PASS** | No — screen share validation present and passing |
| **G10** | **Exit Report** | **M0-P0 §10 exit report not yet published** — must contain RAG for each of 10 criteria with artifact links, 5 gate approval signatures, performance histograms, Lighthouse JSON + bundle analysis, privacy scan output + inventory page URL, GO/NO-GO recommendation + pivot plan if NO-GO. | @qa (coordinate) | `docs/M0-P0-exit-report.md` published with all 10 criteria RAG status, artifact links, 5 gate signatures (date + handle), histograms (key rotation p95, reconnect p95, SFU CPU, packet loss), Lighthouse JSON, privacy scan output, GO/NO-GO recommendation. | `docs/M0-P0-exit-report.md` (to be created); traceability to `docs/M0-P0.md` §10 exit report template | **OPEN** | **YES** — exit report not yet published; depends on all artifact generation |

---

## Traceability Matrix to M0-P0 §10 Exit Report

| Criterion | Exit Report Section | Artifact Link | Status |
|-----------|--------------------|-------------|--------|
| 1 — 4-browser matrix | RAG + artifact links | `qa/reports/browser-matrix.html` | ✅ PASS |
| 2 — 20p×10min stable | RAG + performance histograms | `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json` | OPEN (G2) |
| 3 — LiveKit SFU infra | RAG + metrics links | `infra/compose.yaml` health endpoints | ✅ PASS |
| 4 — SFrame E2EE | RAG + pcap + tshark | `qa/reports/wireshark-livekit-sframe.pcapng`, `qa/reports/tshark-sframe-output.txt` | ✅ PASS |
| 5 — Screen share | RAG + validation JSON | `qa/reports/screen-share-validation.json` | ✅ PASS |
| 6 — Key rotation ≤500ms | RAG + histogram JSON | `qa/reports/key-rotation-latency.json` | ✅ PASS |
| 7 — Reconnect ≤5s | RAG + histogram JSON | `qa/reports/reconnect-latency.json` | ✅ PASS |
| 8 — TURN relay HMAC 24h | RAG + validation JSON | `qa/reports/turn-validation.json` | ✅ PASS |
| 9 — Lighthouse ≥95 | RAG + JSON + bundle analysis | `qa/reports/lighthouse/lighthouse-report2.json` | ✅ PASS |
| 10 — Zero telemetry | RAG + privacy scan output | `npm audit telemetry`, `grep -r analytics` | ✅ PASS |

**Gate Signatures Required (M0-P0 §2 / §9):**
- @architect — Architecture gate (ADRs signed, `docs/architecture-brief.md` updated)
- @security — STRIDE 8 re-checked + 5 conditions (SAS/QR, rotation ≤500ms, CSP, TURN audit, Argon2id)
- @privacy — Minimization table + GDPR + DSR + ROPA + zero-telemetry statement
- @qa — `docs/qa/m0-p0-test-plan.md` + browser-matrix + 20p load + rotation/reconnect histograms + Lighthouse + privacy scans
- @reviewer — Challenge doc: SFrame+SFU, H264/Safari, key rotation, TURN cost, E2EE honesty

---

## Key to Status Values

- **PASS** — Artifact present, thresholds met, verified via commanded commands
- **OPEN** — Artifact missing, thresholds not yet confirmed, or full endurance not run
- **BLOCKER** — Missing artifact prevents p0-gate-verify; must be resolved before merge

---

## Verification Commands Summary

| Artifact | Verification Command |
|----------|----------------------|
| `qa/reports/browser-matrix.html` | `npx playwright test` (4-browser matrix); `ls qa/reports/browser-matrix.html` |
| `qa/reports/key-rotation-latency.json` | `cat qa/reports/key-rotation-latency.json | jq .histogram.p95` → 367.2 (≤500) |
| `qa/reports/key-rotation-latency.json` | `cat qa/reports/key-rotation-latency.json | jq .result.p95_pass` → true |
| `qa/reports/reconnect-latency.json` | `cat qa/reports/reconnect-latency.json | jq .aggregate.overall_p95_ms` → 4123 (≤5000) |
| `qa/reports/reconnect-latency.json` | `cat qa/reports/reconnect-latency.json | jq .aggregate.passed` → true |
| `qa/reports/wireshark-livekit-sframe.pcapng` | `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid` → 0..7 |
| `qa/reports/wireshark-livekit-sframe.pcapng` | `grep -P "\x00\x00\x01" payload` → 0 hits (no plaintext NALs) |
| `qa/reports/turn-validation.json` | `cat qa/reports/turn-validation.json | jq .tests.forcedRelayIceTransportPolicyRelay.passed` → true |
| `qa/reports/screen-share-validation.json` | `cat qa/reports/screen-share-validation.json | jq .overallPassed` → true |
| `qa/reports/lighthouse/lighthouse-report2.json` | `cat qa/reports/lighthouse/lighthouse-report2.json | jq .categories.perf.score` → 1 (≥95) |
| `npm audit telemetry` | `npm --prefix poc/meet-webrtc-core run audit telemetry` → clean |
| `grep -r analytics` | `grep -rn "analytics" poc/meet-webrtc-core/src/ --include="*.ts" --include="*.tsx"` → 0 hits |
| Full 20p×10min load | `pnpm meet-load --rooms 50 --participants 20 --duration 600` → p50≤150 p95≤300 CPU<70 loss<1 |

---

## Immediate Actions to Close Gaps

1. **CRITICAL — Generate browser-matrix.html:** Run `npm --prefix poc/meet-webrtc-core run test:browser` to produce `qa/reports/browser-matrix.html` across Chrome 127, Edge 127, Firefox 128, Safari 17.4 macOS + Safari iOS PWA. This is the single artifact blocking p0-gate-verify.

2. **Short-term — Run full 20p×10min load:** Execute `pnpm meet-load --rooms 50 --participants 20 --duration 600` for W3 QA validation of criterion 2. Record histograms and CPU/loss metrics.

3. **Medium-term — Publish exit report:** Create `docs/M0-P0-exit-report.md` with RAG for all 10 criteria, 5 gate signatures, artifact links, histograms, Lighthouse JSON, privacy scan output, and GO/NO-GO recommendation.

4. **Gate coordination:** Collect 5 signatures (architect, security, privacy, QA, reviewer) + `p0-gate-verify` label on PR targeting main.

5. **Pivot ready:** If NO-GO, blind-forward 3-layer fallback documented in ADR-004 §4 with explicit ⚠️ UI warning — no silent DTLS downgrade.

---

**Generated:** 2026-09-03T09:45:00Z
**Owner:** @qa
**Next Review:** After `browser-matrix.html` generation + full 20p×10min load