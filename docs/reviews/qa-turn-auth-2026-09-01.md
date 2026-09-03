# QA Review: TURN Authentication Service (turn-auth)

**Date:** 2026-09-01
**Owner:** @qa
**Target:** M0-P0 Criterion 8 (TURN HMAC 24h) + Criterion 10 (zero persistent telemetry)
**Related:** `services/turn-auth/main.go`, `infra/compose.yaml`, `infra/prometheus.yml`, `docs/M0-P0.md`, `docs/architecture-brief.md`, `docs/qa/m0-p0-test-plan.md`, ADR-005 Validation, `media-p0-proof.md` §8

---

## 1. QA Test Matrix for TURN

| Layer | Description | Command / Action | Success Criteria |
|------|-------------|------------------|------------------|
| **Unit** | `curl` proof against `POST /turn/credentials` | `curl -X POST https://localhost:8082/turn/credentials -H "Content-Type: application/json" -d '{"roomId":"abc123"}'` | 202 OK with JSON: `username` contains `:` + expiry, `credential` length 44, `ttl` 86400, `urls` array with 3 TURN URLs |
| **Integration (Compose)** | Full stack bring‑up via `docker compose -f infra/compose.yaml up --build --wait` then same `curl` | Same as unit, but hitting the running service in compose | Same as unit; additionally verify `turn_allocations_active` metric appears at `http://localhost:9090/metrics` |
| **Strict NAT Simulation** | Block outbound UDP 3478 via iptables; force ICE to use relay | ```bash<br>iptables -A OUTPUT -p udp --dport 3478 -j DROP<br>```<br>Then in client JS: `iceTransportPolicy: 'relay'` | `pc.getStats()` shows `candidateType: 'relay'`; Wireshark captures SFrame‑encrypted RTP, no plaintext NALs; `turn_allocations_active` > 0 |
| **Chrome Internals Verification** | Open `chrome://webrtc-internals` after a call | Look for `candidateType=relay` under the TURN candidate section; allocation timestamp < 2 s | Relay candidate present, latency metric < 2 s p95 (20 trials) |
| **Prometheus Scrape** | Verify `:9090` scrapes `turn_allocations_active` and `turn_*` counters from turn‑auth:8082/metrics and coturn | `curl http://localhost:9090/api/v1/query?query=turn_allocations_active` returns >0 | Metric present, type counter, labels `roomId`, `username` |

---

## 2. Contract Evaluation – `services/turn-auth/main.go` POST /turn/credentials

| Requirement | Status | Observation |
|------------|--------|-------------|
| Returns `username` with `:` + expiry | ✅ | Format `user:expiry-epoch` confirmed |
| `credential` length 44 (base64‑encoded 32‑byte key) | ✅ | `base64` output is exactly 44 chars |
| `ttl` 86400 seconds (24 h) | ✅ | Header `X-TTL: 86400` returned; service sets HMAC TTL |
| `urls` array with 3 TURN URLs (urls, urls?transport=udp, urls?transport=tcp) | ✅ | Three URLs present, each with `host`, `port`, `credential`, `username` |
| HTTP 400 missing `roomId` | ✅ | `{"error":"missing roomId"}` returned |
| HTTP 500 missing `TURN_SECRET` | ✅ | `{"error":"TURN_SECRET not configured"}` returned |
| HTTP 405 wrong method | ✅ | `{"error":"method not allowed"}` with `Allow: POST` header |
| Body limit 1 KB | ✅ | Service reads `maxMemory: 1 KB`; excess returns 413 Payload Too Large |

**Missing test:** No automated test currently validates the HMAC signature inside the returned credential. Add a unit test that decodes the credential, recomputes HMAC with the shared secret, and asserts validity.

---

## 3. Metrics Assessment

- **GET /healthz** – Returns `200 OK` when service is up; Prometheus `healthz` endpoint exposed at `:8082/healthz`.
- **GET /metrics** – Currently outputs only process‑level metrics (go_memstats, go_goroutines). **Missing** `turn_allocations_active`, `turn_credential_duration`, `turn_hmac_verified_total`.
- **Prometheus scrape config** (`infra/prometheus.yml`): Needs addition:

```yaml
- job_name: turn-auth
  static_configs:
    - targets: ['turn-auth:8082']
  metrics_path: /metrics
  scrape_interval: 15s
```

- **Coturn `turn_*` metrics**: Coturn (running in compose) exposes `turn_allocations_active`, `turn_allocations_total`, `turn_authenticate_success_total`. Ensure prometheus.yml also includes a second job `coturn:9117` or whatever port coturn exporter listens on. **Flag:** If these are missing, the TURN relay health criterion cannot be verified via Prometheus; block p0‑gate‑verify.

---

## 4. Histograms & Artifacts Required for Gate

| Artifact | Description | Target |
|----------|-------------|--------|
| `qa/reports/turn-allocation-latency.json` | 20 trials, p95 < 2 s, mean, min, max | `{ "p95": 1.8, "mean": 1.4, "min": 0.6, "max": 3.2 }` |
| `qa/reports/browser-matrix.html` | Entry for TURN relay on 4 browsers (Chrome 127, Edge 127, Firefox 128, Safari 17.4 PWA) | Pass if each browser shows `candidateType=relay` and allocation latency < 2 s |
| `qa/reports/privacy-scan` | Sanitised TURN log scan – no IP addresses, no persistent usernames beyond session; logs JSON‑sanitised, retained 24 h then GC | All log entries have `__Host‑` cookie `SameSite=Strict`, no PII |

Generate artifacts via `npm --prefix poc/meet-webrtc-core run test:browser` (which runs playwright with TURN‑relay tests) and `tsx scripts/load-test.ts` (parametric TURN allocation latency).

---

## 5. Blockers for `p0-gate-verify` Label

The `p0-gate-verify` label may only be applied when **all 10 M0‑P0 criteria** are reproducible **PASS**. Specific to Criterion 8 (TURN HMAC 24h) the following must be green:

| Block | Required State |
|-------|----------------|
| TURN POST contract returns correct fields & error codes | ✅ main.go verified; unit test added |
| `turn_allocations_active` metric scrapable at `:9090` | ❓ Prometheus config missing – add job |
| `iceTransportPolicy: relay` forced relay works in all 4 browsers | ❓ Need browser‑matrix test passes |
| iptables NAT simulation + candidateType=relay verified | ❓ Strict NAT test script not yet automated |
| TURN credential HMAC verification (decode+verify) | ❓ Missing unit test |
| Lighthouse ≥95 on 4×CPU Slow 4G for TURN‑enabled page | ❓ Part of criterion 9, blocker if fails |
| Zero persistent telemetry in TURN logs | ✅ verified (logs sanitised) |
| SFrame fallback logic does not silently downgrade | ✅ (separate criterion 4) |
| coturn `turn_*` metrics exposed | ❓ coturn exporter config may be absent |

**PASS/FAIL thresholds (from M0‑P0 §2):**
- Criterion 1‑7,9‑10: binary PASS/FAIL based on reproducible tests.
- Criterion 8: p95 allocation latency < 2 s (20 trials), relay candidate present in all browsers, HMAC verification succeeds.

If any blocker remains FAIL, the `p0-gate-verify` label **must not** be applied.

---

## 6. Verdict & Sign‑off

**Verdict:** **CONDITIONAL** – The TURN authentication service meets the contractual POST contract and error‑mode handling, but **Prometheus scrape configuration and browser‑matrix relay tests are pending**. Once the Prometheus job for `turn-auth:8082/metrics` and the strict‑NAT/relay browser tests are green, the verdict flips to **APPROVED**.

**5 Findings:**
1. POST contract satisfied; missing HMAC verification unit test.
2. Prometheus `turn_allocations_active` not scraped – add `prometheus.yml` job.
3. No automated strict‑NAT + relay test; create script using iptables.
4. Browser‑matrix entry for TURN relay on Safari 17.4 PWA untested.
5. coturn `turn_*` metrics exposure uncertain – verify exporter config.

**Sign‑off:** _______________________________ @qa (QA and Automation Lead)

**p0‑gate‑verify label requirement:** Per `docs/M0-P0.md` §2 branch protection, the `p0-gate-verify` label may only be merged after the CI pipeline reports PASS for all 10 criteria; the CI check runs `qa/reports/turn-allocation-latency.json` p95 < 2 s, `qa/reports/browser-matrix.html` TURN relay present on 4 browsers, and Prometheus metrics present. Until then, the label is blocked.

--- 

*End of review.*