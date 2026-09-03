# Prometheus Metrics Notes — M0-P0 Media Layer

**Version:** 0.1.0 | **Date:** 2026-08-31 | **Owner:** @webrtc + @backend

---

## 1. Metrics Naming Convention

All metrics follow Prometheus best practices:

```
<subsystem>_<metric_name>_<unit>
```

| Subsystem | Description |
|-----------|-------------|
| `livekit_` | LiveKit SFU metrics (from LiveKit Prometheus exporter) |
| `sfu_` | Custom SFU metrics (via meet-sfu-manager) |
| `webrtc_` | Client-side WebRTC metrics (collected by meet-webrtc-core MetricsCollector) |
| `turn_` | coturn metrics (via coturn Prometheus exporter) |
| `signaling_` | meet-signal WSS metrics |
| `privacy_` | Privacy compliance metrics |

---

## 2. LiveKit SFU Metrics (Criterion 2, 3)

Exported by LiveKit on `:7880/metrics`

| Metric | Type | Description | P0 Threshold |
|--------|------|-------------|--------------|
| `livekit_rooms_active` | Gauge | Active rooms | ≤50 (Compose) |
| `livekit_participants_active` | Gauge | Participants per room | 20 (P0 target) |
| `livekit_node_cpu_percent` | Gauge | SFU CPU usage % | <70% on 1 vCPU |
| `livekit_node_memory_bytes` | Gauge | SFU memory usage | <2GB |
| `livekit_packet_loss_percent` | Gauge | Aggregate packet loss | <1% |
| `livekit_p50_latency_ms` | Histogram | End-to-end latency p50 | ≤150ms |
| `livekit_p95_latency_ms` | Histogram | End-to-end latency p95 | ≤300ms |
| `livekit_bytes_sent_total` | Counter | Total bytes sent by SFU | — |
| `livekit_bytes_received_total` | Counter | Total bytes received by SFU | — |
| `livekit_simulcast_layers_forwarded` | Gauge | Layers forwarded per track | 3 (blind-forward) or 1 (header-aware) |

---

## 3. Client WebRTC Metrics (Criterion 1, 4, 5, 6, 7)

Collected by `MetricsCollector` in `meet-webrtc-core`, exposed via `/metrics` endpoint on client (dev) or pushed to backend.

### 3.1 Connection & ICE

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `webrtc_connection_state` | Gauge | 0=new, 1=connecting, 2=connected, 3=disconnected, 4=failed | `participant_id`, `room_id` |
| `webrtc_ice_connection_state` | Gauge | 0=new, 1=checking, 2=connected, 3=completed, 4=failed, 5=disconnected, 6=closed | `participant_id`, `room_id` |
| `webrtc_ice_restart_total` | Counter | ICE restart count | `participant_id`, `room_id`, `trigger` |
| `webrtc_ice_candidate_type` | Gauge | 0=host, 1=srflx, 2=prflx, 3=relay | `participant_id`, `room_id`, `local/remote` |

### 3.2 Media Quality

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `webrtc_bytes_sent_total` | Counter | Bytes sent (SRTP) | `participant_id`, `room_id`, `kind` (audio/video) |
| `webrtc_bytes_received_total` | Counter | Bytes received | `participant_id`, `room_id`, `kind` |
| `webrtc_packets_sent_total` | Counter | Packets sent | `participant_id`, `room_id`, `kind` |
| `webrtc_packets_received_total` | Counter | Packets received | `participant_id`, `room_id`, `kind` |
| `webrtc_packets_lost_total` | Counter | Packets lost | `participant_id`, `room_id`, `kind` |
| `webrtc_current_jitter_ms` | Gauge | Current jitter (ms) | `participant_id`, `room_id`, `kind` |
| `webrtc_current_rtt_ms` | Gauge | Current RTT (ms) | `participant_id`, `room_id` |
| `webrtc_current_bitrate_bps` | Gauge | Current target bitrate | `participant_id`, `room_id`, `kind` |
| `webrtc_frames_encoded_total` | Counter | Frames encoded | `participant_id`, `room_id`, `rid` |
| `webrtc_frames_decoded_total` | Counter | Frames decoded | `participant_id`, `room_id`, `rid` |
| `webrtc_frames_dropped_total` | Counter | Frames dropped | `participant_id`, `room_id`, `rid` |

### 3.3 SFrame E2EE Metrics (Criterion 4, 6)

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `webrtc_sframe_encrypt_latency_ms` | Histogram | Encryption latency per frame | `participant_id`, `room_id`, `implementation` (encoded_transform/wasm) |
| `webrtc_sframe_decrypt_latency_ms` | Histogram | Decryption latency per frame | `participant_id`, `room_id`, `implementation` |
| `webrtc_sframe_key_rotation_latency_ms` | Histogram | Full key rotation latency | `room_id`, `trigger` (join/leave/periodic) |
| `webrtc_sframe_key_rotation_total` | Counter | Key rotations completed | `room_id`, `trigger`, `result` (success/failed) |
| `webrtc_sframe_keys_zeroized_total` | Counter | Keys zeroized on leave | `participant_id`, `room_id` |
| `webrtc_sframe_epoch_current` | Gauge | Current epoch number | `room_id` |
| `webrtc_sframe_cipher_suite` | Gauge | 1=AES-GCM, 2=AES-CTR | `room_id` |

### 3.4 Screen Share Metrics (Criterion 5)

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `webrtc_screen_share_start_total` | Counter | Screen share started | `browser`, `platform`, `result` (success/denied/error) |
| `webrtc_screen_share_stop_total` | Counter | Screen share stopped | `browser`, `reason` (user/permission/error) |
| `webrtc_screen_share_duration_seconds` | Histogram | Screen share session duration | `browser`, `platform` |
| `webrtc_screen_share_resolution` | Gauge | Screen share resolution | `browser`, `width`, `height` |

### 3.5 Reconnect Metrics (Criterion 7)

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `webrtc_reconnect_latency_ms` | Histogram | Disconnect → first decrypted frame | `browser`, `platform`, `trigger` (wss_kill/ice_failure/sfu_crash) |
| `webrtc_reconnect_total` | Counter | Reconnect attempts | `browser`, `result` (success/failed) |
| `webrtc_reconnect_epoch_preserved` | Gauge | 1 if epoch preserved, 0 if rekeyed | `room_id` |
| `webrtc_reconnect_buffered_messages_replayed` | Counter | Buffered commits replayed | `room_id` |

---

## 4. TURN/coturn Metrics (Criterion 8)

Exported by coturn Prometheus exporter (port 3478/metrics or sidecar)

| Metric | Type | Description |
|--------|------|-------------|
| `turn_allocations_active` | Gauge | Current active TURN allocations |
| `turn_allocations_total` | Counter | Total allocations created |
| `turn_allocation_failures_total` | Counter | Failed allocations |
| `turn_allocation_latency_ms` | Histogram | Time to allocate relay |
| `turn_relayed_bytes_total` | Counter | Bytes relayed (ciphertext) |
| `turn_relayed_packets_total` | Counter | Packets relayed |
| `turn_candidate_type` | Gauge | 3=relay (confirm TURN path) |
| `turn_protocol` | Gauge | 1=UDP, 2=TCP, 3=TLS |
| `turn_tcp_pressure` | Gauge | TCP connection pressure (0-1) |

---

## 5. Signaling Metrics (Criterion 3, 7)

Exported by `meet-signal` on `:8080/metrics`

| Metric | Type | Description |
|--------|------|-------------|
| `signaling_ws_connections_active` | Gauge | Active WebSocket connections |
| `signaling_ws_connections_total` | Counter | Total WS connections |
| `signaling_ws_messages_total` | Counter | Messages by type (offer/answer/ice/join/leave/commit/welcome) |
| `signaling_jwt_validation_failures_total` | Counter | JWT validation failures |
| `signaling_redis_pubsub_latency_ms` | Histogram | Redis pub/sub fanout latency |
| `signaling_room_participants` | Gauge | Participants per room |

---

## 6. Privacy Compliance Metrics (Criterion 10)

| Metric | Type | Description |
|--------|------|-------------|
| `privacy_telemetry_scan_pass` | Gauge | 1 if `grep -r analytics` clean |
| `privacy_cookie_compliance` | Gauge | 1 if only `__Host-*` cookies with `SameSite=Strict` |
| `privacy_csp_compliance` | Gauge | 1 if CSP blocks 3rd-party |
| `privacy_log_sanitization_pass` | Gauge | 1 if no SDP/PII/IP in logs |
| `privacy_data_ttl_compliance` | Gauge | 1 if Redis/PG/MinIO TTL ≤24h/30d |
| `privacy_vapid_not_fcm` | Gauge | 1 if VAPID used, not FCM |

---

## 7. Histogram Bucket Definitions

### 7.1 Latency Histograms (Key Rotation, Reconnect, SFrame)

```prometheus
# Key rotation: target p95 ≤500ms
webrtc_sframe_key_rotation_latency_ms_bucket{le="50"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="100"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="150"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="200"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="250"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="300"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="400"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="500"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="750"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="1000"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="1500"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="2000"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="3000"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="5000"}
webrtc_sframe_key_rotation_latency_ms_bucket{le="+Inf"}

# Reconnect: target p95 ≤5000ms
webrtc_reconnect_latency_ms_bucket{le="500"}
webrtc_reconnect_latency_ms_bucket{le="1000"}
webrtc_reconnect_latency_ms_bucket{le="1500"}
webrtc_reconnect_latency_ms_bucket{le="2000"}
webrtc_reconnect_latency_ms_bucket{le="2500"}
webrtc_reconnect_latency_ms_bucket{le="3000"}
webrtc_reconnect_latency_ms_bucket{le="4000"}
webrtc_reconnect_latency_ms_bucket{le="5000"}
webrtc_reconnect_latency_ms_bucket{le="7500"}
webrtc_reconnect_latency_ms_bucket{le="10000"}
webrtc_reconnect_latency_ms_bucket{le="+Inf"}

# SFrame encrypt/decrypt: target p99 ≤10ms
webrtc_sframe_encrypt_latency_ms_bucket{le="1"}
webrtc_sframe_encrypt_latency_ms_bucket{le="2"}
webrtc_sframe_encrypt_latency_ms_bucket{le="5"}
webrtc_sframe_encrypt_latency_ms_bucket{le="10"}
webrtc_sframe_encrypt_latency_ms_bucket{le="15"}
webrtc_sframe_encrypt_latency_ms_bucket{le="20"}
webrtc_sframe_encrypt_latency_ms_bucket{le="50"}
webrtc_sframe_encrypt_latency_ms_bucket{le="+Inf"}
```

### 7.2 Network Histograms

```prometheus
# RTT
webrtc_current_rtt_ms_bucket{le="25"}
webrtc_current_rtt_ms_bucket{le="50"}
webrtc_current_rtt_ms_bucket{le="100"}
webrtc_current_rtt_ms_bucket{le="200"}
webrtc_current_rtt_ms_bucket{le="500"}
webrtc_current_rtt_ms_bucket{le="+Inf"}

# Jitter
webrtc_current_jitter_ms_bucket{le="5"}
webrtc_current_jitter_ms_bucket{le="10"}
webrtc_current_jitter_ms_bucket{le="20"}
webrtc_current_jitter_ms_bucket{le="50"}
webrtc_current_jitter_ms_bucket{le="100"}
webrtc_current_jitter_ms_bucket{le="+Inf"}
```

---

## 8. Alerting Rules (P0 Critical)

```yaml
groups:
- name: meet-p0-media-alerts
  interval: 30s
  rules:
  # Criterion 2: Load
  - alert: SFUHighCPU
    expr: livekit_node_cpu_percent > 70
    for: 2m
    labels:
      severity: critical
      criterion: "2"
    annotations:
      summary: "SFU CPU >70% (P0 threshold)"
      
  - alert: SFUHighPacketLoss
    expr: livekit_packet_loss_percent > 1
    for: 1m
    labels:
      severity: critical
      criterion: "2"
    annotations:
      summary: "SFU packet loss >1% (P0 threshold)"

  # Criterion 4: SFrame
  - alert: SFrameKeyRotationSlow
    expr: histogram_quantile(0.95, rate(webrtc_sframe_key_rotation_latency_ms_bucket[5m])) > 500
    for: 5m
    labels:
      severity: critical
      criterion: "6"
    annotations:
      summary: "Key rotation p95 >500ms"

  # Criterion 7: Reconnect
  - alert: ReconnectSlow
    expr: histogram_quantile(0.95, rate(webrtc_reconnect_latency_ms_bucket[5m])) > 5000
    for: 5m
    labels:
      severity: critical
      criterion: "7"
    annotations:
      summary: "Reconnect p95 >5s"

  # Criterion 8: TURN
  - alert: TURNAllocationFailure
    expr: rate(turn_allocation_failures_total[5m]) > 0.1
    for: 1m
    labels:
      severity: warning
      criterion: "8"
    annotations:
      summary: "TURN allocation failure rate >10%"

  - alert: TURNAllocationLatencyHigh
    expr: histogram_quantile(0.95, rate(turn_allocation_latency_ms_bucket[5m])) > 2000
    for: 2m
    labels:
      severity: warning
      criterion: "8"
    annotations:
      summary: "TURN allocation p95 >2s"

  # Criterion 10: Privacy
  - alert: PrivacyTelemetryDetected
    expr: privacy_telemetry_scan_pass == 0
    for: 1m
    labels:
      severity: critical
      criterion: "10"
    annotations:
      summary: "Telemetry detected in privacy scan"
```

---

## 9. Grafana Dashboard JSON (Minimal P0)

```json
{
  "dashboard": {
    "title": "Meet P0 - Media Layer",
    "tags": ["p0", "media", "webrtc"],
    "timezone": "utc",
    "panels": [
      {
        "title": "SFU Health",
        "type": "stat",
        "targets": [
          { "expr": "livekit_rooms_active", "legendFormat": "Active Rooms" },
          { "expr": "livekit_participants_active", "legendFormat": "Participants" },
          { "expr": "livekit_node_cpu_percent", "legendFormat": "CPU %" },
          { "expr": "livekit_node_memory_bytes / 1024 / 1024", "legendFormat": "Memory MB" }
        ]
      },
      {
        "title": "E2EE Key Rotation Latency (p50/p95/p99)",
        "type": "timeseries",
        "targets": [
          { "expr": "histogram_quantile(0.50, rate(webrtc_sframe_key_rotation_latency_ms_bucket[5m]))", "legendFormat": "p50" },
          { "expr": "histogram_quantile(0.95, rate(webrtc_sframe_key_rotation_latency_ms_bucket[5m]))", "legendFormat": "p95" },
          { "expr": "histogram_quantile(0.99, rate(webrtc_sframe_key_rotation_latency_ms_bucket[5m]))", "legendFormat": "p99" }
        ]
      },
      {
        "title": "Reconnect Latency (p50/p95/p99)",
        "type": "timeseries",
        "targets": [
          { "expr": "histogram_quantile(0.50, rate(webrtc_reconnect_latency_ms_bucket[5m]))", "legendFormat": "p50" },
          { "expr": "histogram_quantile(0.95, rate(webrtc_reconnect_latency_ms_bucket[5m]))", "legendFormat": "p95" },
          { "expr": "histogram_quantile(0.99, rate(webrtc_reconnect_latency_ms_bucket[5m]))", "legendFormat": "p99" }
        ]
      },
      {
        "title": "TURN Allocations & Relay Confirmation",
        "type": "stat",
        "targets": [
          { "expr": "turn_allocations_active", "legendFormat": "Active Allocations" },
          { "expr": "turn_candidate_type{type=\"relay\"}", "legendFormat": "Relay Confirmed" }
        ]
      },
      {
        "title": "Media Quality (per participant)",
        "type": "table",
        "targets": [
          { "expr": "webrtc_current_jitter_ms", "legendFormat": "{{participant_id}} jitter" },
          { "expr": "webrtc_current_rtt_ms", "legendFormat": "{{participant_id}} rtt" },
          { "expr": "webrtc_packets_lost_total", "legendFormat": "{{participant_id}} lost" }
        ]
      },
      {
        "title": "Privacy Compliance",
        "type": "stat",
        "targets": [
          { "expr": "privacy_telemetry_scan_pass", "legendFormat": "No Telemetry" },
          { "expr": "privacy_csp_compliance", "legendFormat": "CSP Compliant" },
          { "expr": "privacy_cookie_compliance", "legendFormat": "Cookies Compliant" }
        ]
      }
    ]
  }
}
```

---

## 10. Metrics Collection Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        P0 Metrics Flow                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐       │
│  │ meet-web     │     │ meet-signal  │     │ LiveKit SFU  │       │
│  │ (PWA)        │     │ (WSS)        │     │ (Go)         │       │
│  │              │     │              │     │              │       │
│  │ MetricsCol-  │     │ Prometheus   │     │ Prometheus   │       │
│  │ lector       │     │ /metrics     │     │ /metrics     │       │
│  │ (client)     │     │              │     │              │       │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘       │
│         │                    │                    │                │
│         │ webrtc_*           │ signaling_*        │ livekit_*      │
│         ▼                    ▼                    ▼                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Prometheus Server                         │  │
│  │  (scrape_interval: 15s, scrape_timeout: 10s)                │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
│                               │                                    │
│                               ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Grafana Dashboards                        │  │
│  │  + AlertManager (P0 critical alerts)                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. Client-Side Metrics Export (Development)

For local development, `MetricsCollector` exposes Prometheus format via:

```typescript
// In browser console or debug panel
const metrics = webrtcManager.getMetrics();
const prometheusOutput = metricsCollector.getPrometheusMetrics();
// Paste into local Prometheus or view in browser
```

Production: Client pushes metrics via `beacon` API on `beforeunload` or periodic batch to `meet-signal` `/metrics` endpoint (anonymized, no PII).

---

## 12. Cardinality Control

| Metric | Max Cardinality | Control |
|--------|----------------|---------|
| `webrtc_*` | 1000 (20 rooms × 20 participants × 2 kinds × few labels) | Drop `participant_id` in production, keep `room_id` hash |
| `livekit_*` | 50 rooms × 20 participants | Native LiveKit limits |
| `turn_*` | 5000 allocations | coturn exporter limits |
| `signaling_*` | 50 rooms | Room-scoped only |

**No high-cardinality labels:** No `user_id`, `ip`, `user_agent`, `fingerprint` in metrics.

---

*End of Prometheus Stats Notes*