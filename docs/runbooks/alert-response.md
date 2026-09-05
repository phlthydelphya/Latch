# SRE Runbook: Prometheus Alert Response & Remediation

**Milestone:** M1 Production Hardening  
**Authority:** `docs/M1-production-hardening.md` §4.1  
**Target SLAs:** P0 (Critical) triage ≤4h / fix ≤24h; P1 (High) triage ≤24h / fix ≤72h  
**Privacy Invariant:** Zero PII, raw room IDs, or raw IP addresses allowed in diagnostic logs.

---

## Alert Catalog & Response Procedures

### 1. `LiveKitSFUDown`
- **Severity:** `critical`
- **Expression:** `up{job="livekit-sfu"} == 0` for 30s
- **Impact:** Live media relay unavailable; active participants experience disconnection.
- **Triage Steps:**
  1. Check SFU container status: `docker compose -f infra/compose.yaml ps livekit`
  2. Inspect container logs for OOM or fatal panic: `docker compose -f infra/compose.yaml logs --tail=100 livekit`
  3. Verify port bindings: `curl -f http://localhost:9600/healthz`
- **Remediation:**
  - Restart container: `docker compose -f infra/compose.yaml restart livekit`
  - Verify clients execute automatic ICE restart within ≤5.0s.

---

### 2. `LiveKitSFUHighCPULoad`
- **Severity:** `warning`
- **Expression:** `livekit_node_cpu_load > 0.70` for 1m
- **Impact:** Potential media packet loss or key rotation latency degradation.
- **Triage Steps:**
  1. Inspect active rooms and participant counts in Grafana `m1-operations` dashboard.
  2. Query Prometheus: `livekit_participants_active` and `rate(livekit_packet_loss_total[1m])`
- **Remediation:**
  - If load exceeds 70% during standard 20p meeting, inspect whether Dynacast / simulcast layers are misconfigured.
  - Scale SFU node capacity or assign new rooms to secondary SFU nodes via `meet-sfu-manager`.

---

### 3. `LiveKitHighPacketLoss`
- **Severity:** `warning`
- **Expression:** `rate(livekit_packet_loss_total[1m]) > 0.01` for 1m
- **Impact:** Audio stutter, video artifacting, or frozen frames.
- **Triage Steps:**
  1. Identify whether packet loss is localized to TURN relay or direct UDP.
  2. Review client jitter buffer and RTT stats in Grafana.
- **Remediation:**
  - Verify network interface bandwidth limits on the host.
  - Force relay fallback if UDP egress is being throttled by ISP / NAT firewall.

---

### 4. `MeetSignalDown`
- **Severity:** `critical`
- **Expression:** `up{job="meet-signal"} == 0` for 30s
- **Impact:** New participants cannot generate JWTs or establish WebSocket signaling channels.
- **Triage Steps:**
  1. Check signaling service health: `curl -f http://localhost:8080/healthz`
  2. Check metrics endpoint: `curl -f http://localhost:9091/metrics`
  3. Inspect logs: `docker compose -f infra/compose.yaml logs --tail=100 meet-signal`
- **Remediation:**
  - Restart service: `docker compose -f infra/compose.yaml restart meet-signal`
  - Ensure JWT secrets and port 8080/9091 bindings are healthy.

---

### 5. `MeetSignalHighErrorRate`
- **Severity:** `warning`
- **Expression:** `rate(meet_signal_errors_total[1m]) > 5` for 1m
- **Impact:** Participants failing token generation or WebSocket authentication.
- **Triage Steps:**
  1. Check rate of `meet_signal_tokens_issued_total` vs `meet_signal_errors_total`.
  2. Inspect logs for expired JWT tokens, room mismatches, or malformed JSON payloads.
- **Remediation:**
  - If error surge is caused by token expiry, verify client clock sync and token TTL configuration.

---

### 6. `TurnAuthDown`
- **Severity:** `critical`
- **Expression:** `up{job="turn-auth"} == 0` for 30s
- **Impact:** Participants behind symmetric NAT or corporate firewalls cannot acquire relay credentials.
- **Triage Steps:**
  1. Check endpoint: `curl -f http://localhost:8082/healthz`
  2. Inspect logs: `docker compose -f infra/compose.yaml logs --tail=100 turn-auth`
- **Remediation:**
  - Restart service: `docker compose -f infra/compose.yaml restart turn-auth`

---

### 7. `TurnAuthHighFailures`
- **Severity:** `warning`
- **Expression:** `rate(turn_auth_failures_total[1m]) > 5` for 1m
- **Impact:** Repeated bad credential requests or potential DoS probing.
- **Triage Steps:**
  1. Check metric `turn_auth_failures_total`.
  2. Review logs (sanitized: only userHash prefixes).
- **Remediation:**
  - Check request body compliance (1KB limit, Content-Type enforcement).

---

### 8. `SFUManagerDown` & `SFUManagerNoHealthyNodes`
- **Severity:** `critical`
- **Expression:** `up{job="meet-sfu-manager"} == 0` for 30s OR `meet_sfu_nodes_healthy == 0` for 15s
- **Impact:** Room routing cannot be computed; new rooms cannot join SFUs.
- **Triage Steps:**
  1. Check health: `curl -f http://localhost:8081/healthz`
  2. Check metrics: `curl -f http://localhost:8081/metrics`
  3. Inspect Redis connectivity: `redis-cli ping`
- **Remediation:**
  - If Redis is down, restart Redis: `docker compose -f infra/compose.yaml restart redis`
  - Restart SFU manager: `docker compose -f infra/compose.yaml restart meet-sfu-manager`
