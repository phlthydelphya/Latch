# QA Reports — Aggregated Metrics & Gate Evidence

This directory contains **processed, aggregated reports** derived from raw artifacts in `qa/artifacts/`. These are the formal gate evidence files consumed by CI, reviewers, and milestone exit criteria.

## Structure

```
qa/reports/
├── key-rotation-latency.json       # MP-02: p50/p95/p99 histogram (20 trials)
├── reconnect-latency.json          # MP-05: p50/p95/p99 histogram (10 trials × browser)
├── turn-validation.json            # MP-04: TURN relay proof + Prometheus counter
├── wireshark-validation-report.md  # MP-03: Narrative + tshark filters + findings
├── lighthouse/                     # Lighthouse CI JSON reports (per run)
├── browser-matrix.html             # Cross-browser test matrix (static)
├── browser-matrix-playwright.html  # Playwright HTML report
├── m1-endurance-20p.json           # MP-06: 30-min soak metrics
├── m1-endurance-20p.md             # MP-06: Narrative summary
├── *.md                            # Milestone gate verdicts, audit reports
└── README.md                       # This file
```

## Report Index

| File | Test ID | Metric | Gate Threshold | Status |
|------|---------|--------|----------------|--------|
| `key-rotation-latency.json` | MP-02 | Key rotation p95 | ≤ 500 ms | ✅ 312 ms |
| `reconnect-latency.json` | MP-05 | Reconnect p95 | ≤ 5000 ms | ✅ 4.2 s |
| `turn-validation.json` | MP-04 | Relay candidate + allocations | `candidateType=relay` + `turn_allocations_active > 0` | ✅ |
| `wireshark-validation-report.md` | MP-03 | Zero plaintext NALs in SFrame | 0 plaintext | 🟡 Pending capture |
| `lighthouse/*.json` | — | Perf/Accessibility/BP | ≥ 95 each; TBT <200 ms; CLS 0 | ✅ |
| `browser-matrix.html` | MP-05/07 | Cross-browser pass rate | 100% critical paths | 🟡 Safari/WebKit pending |
| `m1-endurance-20p.json` | MP-06 | 20p stability (30 min) | Zero drops, ≤1% jitter | ✅ |

## Cross-Reference to Artifacts

| Report | Source Artifacts | Transformation |
|--------|------------------|----------------|
| `key-rotation-latency.json` | `qa/artifacts/logs/MP-02-*.json`, `qa/artifacts/sframe/*.json` | Histogram aggregation (p50/p95/p99) |
| `reconnect-latency.json` | `qa/artifacts/logs/adversarial-*.json`, `qa/artifacts/playwright/*.trace.zip` | Per-browser p95 extraction |
| `turn-validation.json` | `qa/artifacts/pcaps/MP-04-*.pcapng`, Prometheus scrape | Relay verification + counter |
| `wireshark-validation-report.md` | `qa/artifacts/pcaps/MP-03-*.pcapng` | tshark filter narrative |
| `browser-matrix.html` | `qa/artifacts/playwright/*.json` | Playwright report aggregation |

## Histogram Schema (Shared)

All latency histograms use `latency-histogram-v1.json` schema:

```json
{
  "testId": "MP-02",
  "metric": "keyRotationLatencyMs",
  "trials": 20,
  "p50": 187,
  "p95": 312,
  "p99": 445,
  "max": 501,
  "unit": "ms",
  "samples": [187, 192, ..., 501],
  "browsers": ["chromium"],  // or ["chromium","firefox","webkit"] for reconnect
  "generatedAt": "2026-09-11T...Z",
  "gitSha": "1534631"
}
```

## Preservation Rules

- **Never delete** existing reports (including `.bak` files like `wireshark-livekit-sframe.pcapng.bak-2026-09-01`).
- New report versions append `-v2`, `-v3` suffix; old versions retained.
- Gate verdict markdown files (`m0-p0-gate-verdict*.md`, `m1-*.md`, `qa-audit-report.md`) are immutable once written.

## MEDIUM Flag Status (from sprint plan)

| Flag | Report Impact | Resolution |
|------|---------------|------------|
| MEDIUM-01 | `wireshark-validation-report.md` cites "50+ pcaps" | Only 1 legacy pcap exists. New MP-03 captures will populate `qa/artifacts/pcaps/`. Report will be updated with actual count. |
| MEDIUM-02 | `browser-matrix.html` shows all green | Safari/WebKit column pending (MP-07). Firefox column blocked (MP-08). Matrix reflects actual state. |
| MEDIUM-03 | `turn-validation.json` implies scale proof | Only 1:1 and 5p verified. 20p TURN soak (MP-09) not run. Report scope clarified. |

## Next Updates

1. MP-03 capture → `wireshark-validation-report.md` v2
2. MP-07/MP-08 complete → `browser-matrix.html` v2 + `reconnect-latency.json` v2 (add WebKit/Firefox)
3. MP-09 run → `turn-validation.json` v2 (20p scale)