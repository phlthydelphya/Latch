# M1 Observability & Alerting Baseline Audit

**Milestone:** M1 Production Hardening  
**Initiative:** 4.1 Observability & Alerting Baseline (Moved Ahead of Certification)  
**Date:** 2026-09-05  
**Owner:** @backend + @architect  
**Status:** `ACTIVE — INSTRUMENTED & VERIFIED`  

---

## 1. Executive Summary

In accordance with M1 Condition 2, full RED metrics instrumentation, Prometheus alerting rules, and Grafana dashboard provisioning have been deployed **ahead of** LiveKit 1.25.1 server certification.

This ensures:
1. Every service (`meet-signal`, `meet-sfu-manager`, `turn-auth`, `livekit`, `coturn`) emits privacy-preserving RED metrics.
2. A quantifiable baseline of LiveKit v1.13.6 SFU performance (CPU, memory, packet delivery, room routing) is established *prior* to upgrading.
3. High-criticality failure conditions (SFU crash, signaling drop, TURN failure, routing collapse) trigger automated alerts within ≤30 seconds.
4. Metric streams strictly enforce zero-telemetry invariants: no PII, user identifiers, raw IP addresses, or unhashed room IDs.

---

## 2. Service RED Metrics Instrumentation Catalog

| Service | Port / Path | Metric Name | Type | Description |
|---|---|---|---|---|
| **`meet-signal`** | `:9091/metrics` | `meet_signal_rooms_active` | Gauge | Active signaling rooms in memory hub |
| | | `meet_signal_connections_active` | Gauge | Active client WebSocket connections |
| | | `meet_signal_messages_total` | Counter | Total signaling frames relayed to peers |
| | | `meet_signal_tokens_issued_total` | Counter | Total access tokens minted |
| | | `meet_signal_errors_total` | Counter | Total signaling errors (auth, protocol, decode) |
| **`meet-sfu-manager`**| `:8081/metrics` | `meet_sfu_assignments_total` | Counter | Total SFU assignment requests processed |
| | | `meet_sfu_cache_hits_total` | Counter | Assignments resolved from Redis cache |
| | | `meet_sfu_cache_misses_total` | Counter | Assignments computed via HRW hash |
| | | `meet_sfu_nodes_healthy` | Gauge | Number of currently healthy SFU nodes |
| | | `meet_sfu_nodes_total` | Gauge | Total configured SFU nodes in cluster |
| **`turn-auth`** | `:8080/metrics` | `turn_allocations_total` | Counter | Total ephemeral HMAC credentials issued |
| | | `turn_auth_failures_total` | Counter | Total failed credential requests (bad JSON/method) |
| **`livekit-sfu`** | `:9600/metrics` | `livekit_rooms_active` | Gauge | Active rooms hosted on SFU node |
| | | `livekit_participants_active` | Gauge | Active participants subscribed/publishing |
| | | `livekit_node_cpu_load` | Gauge | LiveKit SFU node CPU load fraction (0.00–1.00) |
| | | `livekit_packet_loss_total` | Counter | Total WebRTC packet loss events recorded |

---

## 3. Prometheus Alerting Rules Catalog (`infra/alert-rules.yml`)

| Alert Name | Severity | Condition / Threshold | Duration | SLA Response |
|---|---|---|---|---|
| `LiveKitSFUDown` | `critical` | `up{job="livekit-sfu"} == 0` | 30s | Auto-failover / container restart ≤1m |
| `LiveKitSFUHighCPULoad` | `warning` | `livekit_node_cpu_load > 0.70` | 1m | Inspect Dynacast / shed room load |
| `LiveKitHighPacketLoss` | `warning` | `rate(livekit_packet_loss_total[1m]) > 0.01` | 1m | Inspect network interface / relay fallback |
| `MeetSignalDown` | `critical` | `up{job="meet-signal"} == 0` | 30s | Restart signaling container ≤1m |
| `MeetSignalHighErrorRate`| `warning` | `rate(meet_signal_errors_total[1m]) > 5` | 1m | Triage auth token failures / clock skew |
| `TurnAuthDown` | `critical` | `up{job="turn-auth"} == 0` | 30s | Restart turn-auth container ≤1m |
| `TurnAuthHighFailures` | `warning` | `rate(turn_auth_failures_total[1m]) > 5` | 1m | Inspect client request compliance |
| `SFUManagerDown` | `critical` | `up{job="meet-sfu-manager"} == 0` | 30s | Restart SFU manager container ≤1m |
| `SFUManagerNoHealthyNodes` | `critical` | `meet_sfu_nodes_healthy == 0` | 15s | Urgent SFU node recovery |

---

## 4. Privacy Invariant Verification

- [x] **Label Sanitization:** `infra/prometheus.yml` applies `metric_relabel_configs` with `action: labeldrop` on regex `participant_id|room_id|user_id`.
- [x] **No Persistent Logging:** Services output structured logs containing only anonymized hash prefixes (`userHash[:8]`, `participantID[:8]`). Raw IP addresses and full JWT secrets are never logged.
- [x] **24h TTL:** All ephemeral Redis cache keys and Postgres state entries respect 24-hour expiration limits.

---

## 5. Grafana Operations Dashboard

- **UID:** `m1-operations`
- **Provisioned via:** `infra/grafana/dashboards/dashboards.yml`
- **Dashboard File:** `infra/grafana/dashboards/m1-operations.json`
- **Sections:**
  1. *System Overview & SLA Health:* Active rooms, active participants, SFU CPU load, healthy SFU nodes.
  2. *Throughput & Traffic Rates (RED):* Signaling messages/sec, tokens issued/sec, TURN allocations/sec, SFU assignments/sec.
  3. *Error Rates & Anomalies:* Signaling errors/sec, TURN auth failures/sec, SFU cache hit ratio.
