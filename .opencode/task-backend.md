# Task: M0-P0 LiveKit Blind Mode Validation & SFU Health

## Delegation
- **Primary:** @backend
- **Dependencies:** @webrtc (for load test coordination)
- **Reviews required:** @security (TURN audit), @qa (health endpoint verification)

## Context
LiveKit 1.25 running in compose with `LIVEKIT_E2EE_ENABLED=true` and `LIVEKIT_E2EE_MODE=blind` via environment variables. All 11 services healthy.

## Mission
Validate LiveKit configuration and SFU manager health for blind-forward mode.

## Required Actions

### 1. Verify LiveKit E2EE Blind Mode Active
```bash
docker logs meet-secure-p0-livekit-1 2>&1 | grep -i "e2ee\|blind"
```

### 2. Verify Simulcast Configuration
Confirm LiveKit accepts simulcast 3 layers:
- 180p @ 300kbps
- 360p @ 800kbps
- 720p @ 1.8Mbps
- VP9 SVC preferred, H264 baseline fallback
- Opus audio

```bash
curl -s http://localhost:9600/healthz
curl -s http://localhost:9600/metrics | grep -i simulcast
```

### 3. Verify SFU Manager HRW Assignment
```bash
curl -s http://localhost:8081/assign?roomId=test-room-abc123
# Should return: livekit:7880 (single node degenerate case)
docker exec meet-secure-p0-redis-1 redis-cli GET sfu:assign:test-room-abc123
```

### 4. Verify Last-N=9 Forwarding
```bash
curl -s http://localhost:9600/metrics | grep -i "last_n\|subscriber\|forward"
```

### 5. Health Endpoints All Green
```bash
curl -f http://localhost:8080/healthz   # meet-signal
curl -f http://localhost:8081/healthz   # meet-sfu-manager
curl -f http://localhost:9600/healthz   # livekit
curl -f http://localhost:8082/healthz   # turn-auth
```

### 6. Prometheus Metrics Collection
```bash
curl -s http://localhost:9090/api/v1/query?query=up | jq
curl -s http://localhost:9090/api/v1/query?query=livekit_rooms_active | jq
curl -s http://localhost:9090/api/v1/query?query=turn_allocations_active | jq
```

## Deliverables
1. Confirmation LiveKit blind mode active (logs)
2. Simulcast 3x2 + Opus confirmed
3. HRW assignment working (single node -> livekit:7880)
4. Last-N=9 forwarding verified
5. All health endpoints green
6. Prometheus metrics flowing for rooms, TURN allocations

## Gate Handoff
After completion, the PM will route deliverables to:
- @security for TURN audit and blind-mode verification
- @qa for health endpoint validation
- @architect for Compose parity sign-off