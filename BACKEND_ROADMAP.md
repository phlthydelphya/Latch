# Meet Secure Core - Backend Roadmap

## 1. Service Breakdown

| Service | Responsibility | Tech |
|---------|---------------|------|
| **meet-signal** | Stateless WSS signaling (SDP/ICE/presence), Redis pub/sub fanout | Go + Gorilla WS, Redis Streams |
| **meet-id** | OIDC (Keycloak) integration, JWT minting (5m access + refresh), KMS envelope encryption for keys | Go, Keycloak adapter, Vault/KMS |
| **meet-sfu-manager** | LiveKit room orchestration, SFU assignment via consistent hashing, participant routing | Go, LiveKit SDK, Rendezvous hashing |
| **meet-storage** | Encrypted blob storage (recordings, artifacts), S3/MinIO with client-side encryption, presigned URLs | Go, MinIO SDK, AEAD (XChaCha20-Poly1305) |
| **turn-auth** | coturn HMAC credential generation, TTL-bound ephemeral credentials | Go, SHA-256 HMAC, 24h TTL |

---

## 2. API Design

### REST (Room Lifecycle)
```
POST   /api/v1/rooms           # Create room (returns room_id, JWT)
GET    /api/v1/rooms/:id       # Room metadata (no media)
DELETE /api/v1/rooms/:id       # Host delete
POST   /api/v1/rooms/:id/join  # Validate + issue participant JWT
GET    /api/v1/rooms/:id/token # Refresh participant JWT
```

### WSS (Real-time Signaling)
```
WSS /signal?v=1&room=:id&token=:jwt
Frames: {type: "offer|answer|ice|candidate|join|leave|mute|speaking", payload: {}}
```
- Stateless horizontal scaling via Redis pub/sub (room-scoped channels)
- Presence via Redis SET with TTL heartbeat (5s)
- JWT validated on upgrade; 5m access, 24h refresh rotation

---

## 3. Scaling Strategy

| Layer | Approach |
|-------|----------|
| **Signal** | Horizontal pods behind LB; Redis Streams for fanout; sticky sessions not required |
| **SFU** | Consistent hashing (ring) on `room_id` → LiveKit node; rebalance on node churn |
| **HPA** | Signal: CPU>70% + WS connections/pod >5k; SFU: participant count; Storage: queue depth |
| **Turn** | Stateless; scale horizontally; HMAC verification at coturn via shared secret |

---

## 4. Persistence Model (Postgres)

```sql
-- Ephemeral, hash-only
rooms (id, host_id, created_at, expires_at, config_hash, status)
participants (room_id, user_id, joined_at, left_at, role, perm_hash)
recordings (id, room_id, storage_key, encryption_key_id, expires_at) -- metadata only
```
- **No media in PG** — only hashes/references
- TTL: rooms 24h post-end, recordings 30d (configurable), GC job hourly
- Row-level security on `host_id`/`user_id`

---

## 5. DevOps

| Env | Stack |
|-----|-------|
| **Self-host** | Docker Compose: Postgres, Redis, MinIO, Keycloak, coturn, 5 Go services, Prometheus+Grafana, Loki |
| **Cloud (K8s)** | Helm charts per service; ArgoCD; cert-manager; external-secrets (Vault); PodDisruptionBudgets |
| **Observability** | Structured JSON logs (no PII, no SDP); Prometheus metrics (RED + custom: `rooms_active`, `sfu_load`); Loki for logs; Tempo for traces (sampled 10%) |
| **Privacy** | Log sanitizer middleware; metrics cardinality capped; no recording content in logs |

---

## 6. Milestones & Dependencies

| Milestone | Target | Dependencies |
|-----------|--------|--------------|
| **M1: Core Infra** | W2 | Postgres, Redis, MinIO, Keycloak up; Docker Compose baseline |
| **M2: meet-id + Auth** | W3 | Keycloak realm/client; Vault/KMS sealed; JWT issuance/refresh |
| **M3: meet-signal (WSS)** | W4 | Redis Streams pub/sub; WSS upgrade + JWT validation; presence |
| **M4: meet-sfu-manager** | W5 | LiveKit cluster; consistent hashing ring; room→SFU mapping API |
| **M5: meet-storage + TURN** | W6 | MinIO bucket policies; client-side encryption lib; coturn HMAC secret |
| **M6: Integration & HPA** | W7 | End-to-end flow; load tests (10k concurrent); HPA rules tuned |
| **M7: K8s + Observability** | W8 | Helm charts; Prometheus/Grafana/Loki/Tempo; privacy audit |
| **M8: Hardening** | W9 | Pen-test; chaos engineering; disaster recovery drills; docs |

**Critical Path**: M1 → M2 → M3 → M4 (M5 parallel after M2) → M6 → M7 → M8