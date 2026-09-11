# Log Artifacts — Manifest

Structured JSON logs from automated test runs (load, adversarial, vitest, etc.). Write-once, append-only per run.

## Manifest

| File | Test ID | Date | Git SHA | Runner | Schema | Lines |
|------|---------|------|---------|--------|--------|-------|
| *none yet* | — | — | — | — | — | — |

## Planned Artifacts

| Test ID | Scenario | Target File | Runner |
|---------|----------|-------------|--------|
| MP-02 | Key rotation load | `MP-02-<date>-<sha>-load.json` | `npm run load` |
| MP-06 | 20p endurance soak | `MP-06-<date>-<sha>-endurance.json` | `npm run load` |
| — | Adversarial suite | `adversarial-<date>-<sha>.json` | `npm run adversarial` |
| — | Vitest full suite | `vitest-<date>-<sha>.json` | `npm test` |

## Log Schema (Common Envelope)

```json
{
  "testId": "MP-02",
  "runId": "20260911-1534631-load-01",
  "timestamp": "2026-09-11T14:32:00.000Z",
  "gitSha": "1534631",
  "environment": {
    "node": "20.18.0",
    "os": "linux",
    "browser": "headless-chromium",
    "participants": 20
  },
  "events": [
    { "t": 1200, "type": "keyRotation", "participantId": "p-abc123", "latencyMs": 187, "success": true },
    { "t": 2400, "type": "reconnect", "participantId": "p-def456", "latencyMs": 3200, "success": true }
  ],
  "summary": {
    "totalEvents": 200,
    "successRate": 1.0,
    "p50LatencyMs": 187,
    "p95LatencyMs": 312
  }
}
```

## Verification

```bash
# Extract key rotation latencies
jq '[.events[] | select(.type=="keyRotation") | .latencyMs]' MP-02-*.json | jq 'sort | .[length*95/100|floor]'
# Must be ≤ 500

# Extract reconnect latencies
jq '[.events[] | select(.type=="reconnect") | .latencyMs]' adversarial-*.json | jq 'sort | .[length*95/100|floor]'
# Must be ≤ 5000
```

## Cross-Reference

- Aggregated reports: `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json`
- Sprint plan: `docs/reports/media-proof-sprint.md`