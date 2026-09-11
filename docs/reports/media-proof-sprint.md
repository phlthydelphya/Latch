# Media Proof Sprint — Execution Plan & Evidence Index

**Status:** ACTIVE — Sprint execution in progress
**Owner:** @webrtc + @qa
**Started:** 2026-09-11
**Target:** Complete media-path verification for M4A closure → M5A entry

---

## Sprint Objective

Produce auditable, reproducible evidence that the media path meets all M4A/M5A entry criteria:

1. **SFrame E2EE integrity** — No plaintext leakage, ciphertext-only on wire, key rotation ≤500 ms p95
2. **Blind SFU forwarding** — LiveKit never decrypts; `LIVEKIT_E2EE_MODE=blind` enforced
3. **TURN relay fallback** — Forced relay works; `candidateType=relay` verified; no media bypass
4. **Reconnect resilience** — ≤5 s p95 reconnect latency across Chrome/Firefox/Safari
5. **Simulcast + Last-N=9** — 3-layer relay (180p/360p/720p) stable at 20 participants
6. **Cross-browser interop** — Chrome 128+, Firefox 129+, Safari 17.4+ (OffscreenCanvas + VideoFrame recycle)

---

## Test Matrix

| ID | Scenario | Tooling | Evidence Artifact | Status |
|----|----------|---------|-------------------|--------|
| MP-01 | SFrame encrypt/decrypt round-trip (1:1) | `npm run sframe-proof` | `qa/artifacts/sframe/roundtrip-*.json` | 🟡 Running |
| MP-02 | SFrame key rotation under load (20p) | `npm run load` + custom harness | `qa/reports/key-rotation-latency.json` | ✅ Done (p95 312 ms) |
| MP-03 | Blind SFU — Wireshark ciphertext audit | `tshark -Y "rtp && sframe"` | `qa/artifacts/pcaps/sfu-blind-*.pcapng` | 🟡 Running |
| MP-04 | TURN relay forced + allocations | `iceTransportPolicy: relay` + iptables | `qa/reports/turn-validation.json`, `qa/artifacts/pcaps/turn-relay-*.pcapng` | ✅ Done |
| MP-05 | Reconnect storm (10 trials × 3 browsers) | Playwright + network chaos | `qa/reports/reconnect-latency.json` | ✅ Done (p95 4.2 s) |
| MP-06 | 20p simulcast Last-N=9 soak (30 min) | `npm run load` | `qa/reports/m1-endurance-20p.json` | ✅ Done |
| MP-07 | Safari 17.4 OffscreenCanvas + VideoFrame | Manual + Playwright WebKit | `qa/artifacts/playwright/safari-*.json` | 🟡 Pending |
| MP-08 | Firefox ICE/TURN race (see investigation) | Manual + `about:webrtc` | `docs/investigations/firefox-ice-turn.md` | 🔴 Active |

---

## Artifact Locations

All evidence artifacts are organized under `qa/artifacts/` and `qa/reports/`:

```
qa/
├── artifacts/
│   ├── pcaps/           # Raw packet captures (pcapng)
│   │   ├── sfu-blind-*.pcapng       # MP-03: SFU blind-forward verification
│   │   ├── turn-relay-*.pcapng      # MP-04: TURN relay path
│   │   └── README.md                # ← index + chain-of-custody
│   ├── sframe/          # SFrame cryptographic test vectors
│   │   ├── roundtrip-*.json         # MP-01: encrypt/decrypt + key rotation
│   │   ├── ciphertext-vectors.json  # Known-answer tests (RFC 9605 App B)
│   │   └── README.md                # ← schema + verification steps
│   ├── playwright/      # Browser E2E traces + screenshots
│   │   ├── *.trace.zip              # Playwright traces
│   │   ├── *.png                    # Failure screenshots
│   │   └── README.md                # ← test ID mapping
│   └── logs/              # Structured JSON logs from test runs
│       ├── load-*.json              # Load test output
│       ├── adversarial-*.json       # Adversarial runner output
│       └── README.md                # ← log schema
└── reports/
    ├── key-rotation-latency.json    # MP-02 histogram (p50/p95/p99, 20 trials)
    ├── reconnect-latency.json       # MP-05 histogram (p50/p95/p99, 10 trials × browser)
    ├── turn-validation.json         # MP-04: relay candidate + Prometheus counter
    ├── wireshark-validation-report.md # MP-03 narrative + tshark filters
    ├── lighthouse/                  # Lighthouse CI JSON reports
    ├── browser-matrix.html          # Cross-browser test matrix
    ├── m1-endurance-20p.json        # MP-06: 30-min soak metrics
    └── README.md                    # ← index + cross-ref to artifacts
```

---

## Chain of Custody

Every artifact in `qa/artifacts/` must have:

1. **Filename convention:** `<test-id>-<timestamp>-<git-short-sha>.<ext>`
   - Example: `MP-03-20260911-1534631.pcapng`
2. **Accompanying manifest:** `qa/artifacts/<type>/README.md` lists every file with:
   - Test ID, timestamp, git commit, operator, environment
   - Verification command (e.g., `tshark -r file.pcapng -Y "rtp && sframe" | wc -l`)
   - Expected result (e.g., "zero plaintext NAL units")
3. **No manual edits** — artifacts are write-once; corrections get new files with `-corr<N>` suffix

---

## Cross-References

- **Sprint plan (this file):** `docs/reports/media-proof-sprint.md`
- **QA artifact index:** `qa/artifacts/README.md`
- **QA report index:** `qa/reports/README.md`
- **Firefox ICE/TURN investigation:** `docs/investigations/firefox-ice-turn.md`
- **Validation checklists:** `qa/validation/README.md`
- **Architecture brief (media path):** `docs/architecture-brief.md` §8–9
- **M4A spec (E2EE invariants):** `docs/M4A-authoritative-session-control.md` §2, §3.1

---

## MEDIUM Flag Resolutions

| Flag | Original Claim | Resolution |
|------|----------------|------------|
| MEDIUM-01 | "50+ pcap files captured" | Demoted: **Actual count TBD** — only `wireshark-livekit-sframe.pcapng` (24 KB) + `.bak` exist in `qa/reports/`. New captures will follow naming convention above. |
| MEDIUM-02 | "All browser matrix cells green" | Demoted: **Safari 17.4 WebKit cell pending** (MP-07). Firefox cell blocked by MP-08 investigation. |
| MEDIUM-03 | "TURN relay proven at scale" | Demoted: **Proven at 1:1 and 5p only** (MP-04). 20p TURN soak not yet run. |

---

## Next Steps

1. Complete MP-01, MP-03, MP-07, MP-08
2. Run 20p TURN relay soak (new MP-09)
3. Archive all artifacts with manifest entries
4. Update `qa/reports/README.md` and `qa/artifacts/*/README.md` indices
5. Close sprint → feed evidence into M5A entry gate