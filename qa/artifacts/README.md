# QA Artifacts — Root Index

This directory contains **raw, write-once evidence artifacts** produced by test runs, load harnesses, and manual verification. Each subdirectory has its own `README.md` manifest listing every file with chain-of-custody metadata.

## Structure

```
qa/artifacts/
├── pcaps/          # Packet captures (pcapng) — Wireshark/tshark raw output
├── sframe/         # SFrame cryptographic test vectors + round-trip JSON
├── playwright/     # Playwright traces (.zip), screenshots (.png), test reports
├── logs/           # Structured JSON logs from load/adversarial/test runs
└── README.md       # This file
```

## Manifest Convention

Every artifact file **must** follow:

```
<TEST-ID>-<YYYYMMDD>-<GIT-SHORT-SHA>[-corr<N>].<ext>
```

Examples:
- `MP-03-20260911-1534631.pcapng`
- `MP-01-20260911-1534631-roundtrip.json`
- `MP-05-20260911-1534631-chrome.trace.zip`

Each subdirectory `README.md` contains a table:

| File | Test ID | Date | Git SHA | Operator | Environment | Verification Command | Expected Result |
|------|---------|------|---------|----------|-------------|---------------------|-----------------|

## Cross-References

- **Sprint plan:** `docs/reports/media-proof-sprint.md`
- **Report index (aggregated metrics):** `qa/reports/README.md`
- **Validation checklists:** `qa/validation/README.md`
- **Investigation logs:** `docs/investigations/`

## Integrity Rules

1. **Never edit** an existing artifact file. Corrections → new file with `-corr1`, `-corr2` suffix.
2. **Never delete** artifacts. Archive with `-archived` suffix if superseded.
3. **Manifest first** — update the subdirectory `README.md` **before** committing new artifacts.
4. **No PII** — captures sanitized (no IPs beyond /24, no SDP, no user identifiers).

## Current State (2026-09-11)

| Subdirectory | Files | Status |
|--------------|-------|--------|
| `pcaps/` | 0 | Awaiting MP-03, MP-04 captures |
| `sframe/` | 0 | Awaiting MP-01 vectors |
| `playwright/` | 0 | Awaiting MP-05, MP-07 traces |
| `logs/` | 0 | Awaiting load/adversarial runs |

> **Note:** Historical `qa/reports/wireshark-livekit-sframe.pcapng` (24 KB) and `.bak` remain in `qa/reports/` per preservation rule. New captures go to `qa/artifacts/pcaps/`.