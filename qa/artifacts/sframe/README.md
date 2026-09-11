# SFrame Artifacts — Manifest

SFrame (RFC 9605) cryptographic test vectors, encrypt/decrypt round-trip results, and key rotation latency data. All JSON — schema-validated, write-once.

## Manifest

| File | Test ID | Date | Git SHA | Operator | Environment | Schema | Status |
|------|---------|------|---------|----------|-------------|--------|--------|
| *none yet* | — | — | — | — | — | — | — |

## Planned Artifacts (per `docs/reports/media-proof-sprint.md`)

| Test ID | Scenario | Target File | Schema |
|---------|----------|-------------|--------|
| MP-01 | Encrypt/decrypt round-trip (1:1) | `MP-01-<date>-<sha>-roundtrip.json` | `sframe-roundtrip-v1.json` |
| MP-01 | Known-answer test vectors (RFC 9605 App B) | `ciphertext-vectors.json` | `sframe-kat-v1.json` |
| MP-02 | Key rotation under load (20p) | `key-rotation-latency.json` (also in `qa/reports/`) | `latency-histogram-v1.json` |

## Schema Definitions

### `sframe-roundtrip-v1.json`
```json
{
  "testId": "MP-01",
  "timestamp": "2026-09-11T...Z",
  "gitSha": "1534631",
  "participants": 2,
  "frames": [
    {
      "frameId": 1,
      "plaintextBytes": 1248,
      "ciphertextBytes": 1312,
      "keyId": 0,
      "counter": 0,
      "encryptMs": 0.42,
      "decryptMs": 0.38,
      "verified": true
    }
  ],
  "summary": { "totalFrames": 1000, "avgEncryptMs": 0.41, "avgDecryptMs": 0.37, "failures": 0 }
}
```

### `latency-histogram-v1.json` (used by `key-rotation-latency.json`, `reconnect-latency.json`)
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
  "samples": [187, 192, ..., 501]
}
```

## Verification

```bash
# Validate round-trip JSON against schema
npx ajv validate -s schemas/sframe-roundtrip-v1.json -d MP-01-*.json

# Verify key rotation p95 ≤ 500 ms
jq '.p95' key-rotation-latency.json  # Must be ≤ 500
```

## Cross-Reference

- Aggregated histogram reports: `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json`
- Sprint plan: `docs/reports/media-proof-sprint.md`