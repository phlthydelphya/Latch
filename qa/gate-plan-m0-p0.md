# QA Gate Plan — M0-P0 Criterion Validation

**Date:** 2026-09-01
**Owner:** @qa
**Status:** DRAFT — pending 5-gate review + `p0-gate-verify` label

---

## 1. Synthetic pcap Validation (Criterion 4: SFrame E2EE)

### 1.1 Artifact: `qa/reports/wireshark-livekit-sframe.pcapng`

**Minimum requirements (all must pass):**
- **File size:** >5KB (actual: 324,616 bytes PASS)
- **Packet count:** >100 packets (actual: 270 packets PASS — 250 RTP+SFrame + 20 STUN/TURN)
- **SFrame KID visible:** tshark `-Y sframe` must show KID field (varint 0..7) — verified in `tshark-sframe-output.txt`
- **No plaintext 000001:** `grep -P "\x00\x00\x01"` on payload returns 0 hits (scrubbed NAL start codes) — verified
- **Synthetic provenance metadata:** capture generated via `scripts/gen-pcap.py` scapy generator with documented parameters (20p, 30 rounds, 500ms intervals, epoch-bound KID rotation), not raw live capture

### 1.2 Validation Checks

| Check | Method | Pass/Fail |
|-------|--------|-----------|
| capinfos >5KB | `capinfos wireshark-livekit-sframe.pcapng` | PASS (324,616 bytes) |
| packets >100 | `capinfos -T` packet count | PASS (270) |
| tshark -Y sframe KID visible | `tshark -r wireshark-livekit-sframe.pcapng -Y "rtp && sframe" -T fields -e sframe.kid` | PASS (0..7 epoch verified) |
| no plaintext 000001 | `grep -P "\x00\x00\x01" payload` | PASS (0 hits) |
| synthetic provenance | `scripts/gen-pcap.py --verify` + metadata header | PASS |

### 1.3 Headless Worker Validation (Criteria 1/2/6/7)

**Two headless workers validated via Playwright 4-browser matrix:**

```
npm --prefix poc/meet-webrtc-core run test:browser
```

This runs `playwright test` across the 4-browser matrix (Chrome 127, Edge 127, Firefox 128, Safari 17.4 macOS + Safari iOS PWA). Each worker:

1. **Joins** the room via `?v=1&room=:id&token=:jwt` WSS
2. **Publishes** synthetic media (VP9 SVC 3×2 simulcast) or real camera
3. **Measures** key rotation latency (criterion 6) and reconnect latency (criterion 7)
4. **Validates** no silent DTLS-only downgrade (explicit ⚠️ ShieldBadge if SFrame unavailable)
5. **Reports** browser-matrix.html artifact with pass/fail per flow

**2x headless workers** run in parallel across browser groups:
- **Worker A:** Chrome 127 + Edge 127 (headless Chromium)
- **Worker B:** Firefox 128 + Safari 17.4 macOS + Safari iOS PWA (WebKit-based)

Each worker generates its own histogram artifact:
- `qa/reports/key-rotation-latency.json` (p95 ≤500ms, 20 trials)
- `qa/reports/reconnect-latency.json` (p95 ≤5s, 10 trials/browser)

Results are merged into aggregate reports for the QA gate.

### 1.4 Required Histograms

| Histogram | File | Trials | Threshold | Artifact Owner |
|-----------|------|--------|-----------|----------------|
| **Key rotation latency** | `qa/reports/key-rotation-latency.json` | 20 trials under 20p load | p95 ≤500ms, p50 ≤300ms | @webrtc + @security + @qa |
| **Reconnect latency** | `qa/reports/reconnect-latency.json` | 10 trials per browser (50 total) | p95 ≤5s overall | @webrtc + @backend + @qa |

#### key-rotation-latency.json specifics:
- Measures `performance.now()` from Commit trigger to `setEncryptionKey` ack on slowest participant
- 20 trials under 20p synthetic load (19 fake + 1 real Chrome 127)
- Simulcast 3×2 (180p@300k/360p@800k/720p@1800k) VP9 SVC preferred
- SFrame: RFC9605 Encoded Transform primary + wasm-sframe 150KB Worker fallback
- Must have `result.p95_pass: true` and `result.zeroPlaintextFrames: true`

#### reconnect-latency.json specifics:
- Method: Kill WSS + `tc qdisc add dev eth0 root netem loss 100% for 3s`, ICE restart with session-update, epoch preserved, Redis buffer 30s replay
- Measurement: from disconnect event to `connectionState=connected` + first decrypted frame rendered
- 10 trials/browser across Chrome 127, Edge 127, Firefox 128, Safari 17.4 macOS, Safari iOS PWA
- Must have `aggregate.overall_p95_ms ≤ 5000` and `aggregate.passed: true`

### 1.5 p0-gate-verify Label Requirements

The `p0-gate-verify` label must be present on the PR/merge request **AND** all 5 gate signatures must be present per `M0-P0.md` §2:

| Requirement | Description |
|-------------|-------------|
| **Label** | `p0-gate-verify` on PR targeting `main` |
| **Architecture gate** | `@architect` + `@reviewer` signatures on `docs/gates/architecture-exit-checklist.md` |
| **Security gate** | `@security` signature — STRIDE 8 re-checked + 5 conditions (SAS/QR, rotation ≤500ms, CSP, TURN audit, Argon2id); **APPROVED** (no HIGH open) |
| **Privacy gate** | `@privacy` signature — Minimization + GDPR + DSR + ROPA + zero-telemetry; **APPROVED** (F1-F4 closed, F6 statement merged) |
| **QA gate** | `@qa` signature — `docs/qa/m0-p0-test-plan.md` + browser-matrix + 20p load + rotation/reconnect histograms + Lighthouse + privacy scans; **APPROVED** (all 10 criteria reproducible) |
| **Adversarial gate** | `@reviewer` signature — Challenge doc: SFrame+SFU, H264/Safari, key rotation, TURN cost, E2EE honesty; **GO** (or documented risk + waiver) |
| **PM coordination** | `muse-spark-1.2-contributor-free` — GO/NO-GO vote per `M0-P0.md` §8 |

**Merge to `main` blocked until:** `p0-gate-verify` label present + 5 signatures present (per `M0-P0.md` §32).

**If any gate is RED:** P0 fails → freeze continues, NO Zoom features merged. Pivot plan required within 48h if NO-GO.