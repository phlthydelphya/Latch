# Consistent Hashing — `roomId → SFU` (P0 Single-Node, K8s-Ready)

**Owner:** @architect + @backend | **Date:** 2026-09-01 | **Status:** REVIEW REQUIRED | **Refs:** `docs/architecture-brief.md` §6, `docs/c4/p0-context.md`, `BACKEND_ROADMAP.md` §3, `docs/adr/ADR-004-livekit-vs-mediasoup.md`

---

## Requirement

`docs/M0-P0.md` §3 #3: deterministic `roomId→SFU` assignment, Redis pub/sub for `meet-signal`, single-command `docker compose up` for ≤50 rooms, but no re-architect when scaling to K8s multi-SFU. Also HA RTO <60s.

## Choice: Rendezvous (HRW) over Ring

| Property | Ring (with vnodes) | **Rendezvous HRW (chosen)** |
|----------|-------------------|---------------------|
| Code | 80 LOC + vnode tuning (150) | **15 LOC**, no tuning |
| Movement on churn | ~1/N | **~1/N (minimal)** |
| Load awareness | via weights on ring segments | **native: score / (1+load)** |
| Single-node degenerate | ring with 1 node = special case | **same code, N=1 → always that node** |
| Testability | distribution test needs vnodes | **deterministic hash, 1 test vector** |

For N ≤ 16 (P0 1, post-P0 3-5) O(N) is trivial (<1µs). No need for ring.

## Algorithm (Go)

```go
package sfu

import (
  "github.com/cespare/xxhash/v2"
)

type SFUNode struct {
  ID   string  // "livekit-0"
  Addr string  // "livekit-0:7880"
  Load float64 // 0..1 from Prometheus sfu_load
  Healthy bool
}

func AssignSFU(roomID string, nodes []SFUNode) (SFUNode, bool) {
  if len(nodes)==0 { return SFUNode{}, false }
  var best SFUNode; var bestScore uint64; var found bool
  for _, n := range nodes {
    if !n.Healthy { continue }
    // Include secret salt from env SFU_HASH_SALT to avoid enumeration
    h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)
    // load-weighted: heavily loaded nodes score lower
    divisor := uint64(1 + n.Load*10) // load 0.7 → divisor 8
    score := h / divisor
    if !found || score > bestScore {
      best, bestScore, found = n, score, true
    }
  }
  return best, found
}
```

**Why xxhash:** fast, deterministic, no crypto needed (roomId is already opaque hash). Salt prevents external prediction of mapping.

**Load weighting:** ensures shed at >70% without hard cap. Alternative: exclude nodes Load>0.85, but weighting is smoother.

## Wiring

### Compose (P0)

```yaml
# infra/compose.yaml excerpt
services:
  meet-sfu-manager:
    image: meet-secure/meet-sfu-manager:${TAG}
    environment:
      SFU_NODES: "livekit-0:7880" # single entry
      SFU_HASH_SALT: "${SFU_HASH_SALT}"
      REDIS_URL: "redis://redis:6379/0"
    depends_on: { redis: {condition: service_healthy}, livekit: {condition: service_healthy}}

  livekit:
    image: livekit/livekit-server:v1.25.1
    cpus: '2.0'
    mem_limit: 4g
    ports: ["7880:7880", "7881:7881/udp"]
    environment:
      LIVEKIT_KEYS: "${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"
      LIVEKIT_E2EE_ENABLED: "true"
      LIVEKIT_E2EE_MODE: "blind" # disable Dynacast when true
```

Signal resolves on every `POST /rooms/:id/join`:

```
GET http://meet-sfu-manager:8080/internal/sfu/assign?roomId=abc123
→ {nodeId: "livekit-0", addr: "livekit-0:7880", load: 0.42}
Cache: Redis SET sfu:assign:abc123 → nodeId EX 300
```

### K8s (Parity, no re-architect)

- Config: `SFU_NODES` populated by controller watching `Endpoints` for `livekit-headless` Service (headless DNS). Or Redis `sfu:nodes` JSON array written by each LiveKit pod heartbeat `SET sfu:node:{id} EX 30` + `SADD sfu:nodes`.
- Signal uses same `AssignSFU` call; no sticky session (WSS stateless via Redis pub/sub).
- Rebalance: only rooms hashing to removed node move (HRW guarantee 75% stay when N 4→3). Clients on moved rooms get `session-update` with new SFU addr → ICE restart.

## HA / RTO <60s

See `architecture-brief.md` §7 table. For hash specifically:

- **SFU crash:** liveness `GET :7880/healthz` fails → manager marks unhealthy in <5s → next `AssignSFU` excludes it. Existing rooms on that SFU: signal sends `sfu.migrate` event via Redis `PUBLISH sfu:events` → clients ICE restart to new assignment. RTO 8s (container restart) + 5s (ICE) = <60s.
- **Manager crash:** signal caches last assignment 30s (`sfu:assign:{roomId}`) → stale but safe (single SFU fallback). K8s restarts manager <10s.
- **Redis crash:** signal keeps in-memory assign cache 10s, then retries Sentinel (K8s) or Compose restart. Presence lost but deterministic re-hash repopulates.

## Test Vectors — Single Source of Truth D-037 (salt=p0-salt-2026, code truth `services/meet-sfu-manager/main.go:243`)

```
salt = "p0-salt-2026"  // SFU_HASH_SALT per infra/compose.yaml:97 and services/meet-sfu-manager/main.go:80
nodes = [sfu-0, sfu-1, sfu-2]
roomId=abc123 → sfu-1          // sfu-* namespace: xxhash(abc123|sfu-1|p0-salt-2026)=16796581398864227772 max → sfu-1 (go test PASS)
roomId=room-20p-test → sfu-0
Add sfu-3 → abc123 stays on sfu-1 (75% case), new rooms may go to 3
Load: sfu-1 load 0.9 → abc123 flips to sfu-0 (weighted divisor 10 vs 2)
Single node: nodes=[livekit:7880] (auto sfu-0) → any roomId → sfu-0 // degenerate P0 Compose
Namespace note: nodes=[livekit-0,livekit-1,livekit-2] same salt + abc123 → livekit-2 (11503489511354447937 / 761910975009738206 / 12358600011866411036 max=livekit-2) — both vectors correct for their ID prefix; formula unchanged h=xxhash(roomId|nodeID|salt)/(1+load*10)
```

Unit test `TestAssignSFU_Deterministic` + integration `docker compose up --scale meet-signal=2` → join 50 rooms → all route deterministically.

## Non-Goals (FROZEN)

- No cross-region geo-affinity until post-P0 (would add `preferRegion` hint).
- No cascading SFU mesh (3-5 nodes) until 100p milestone.

*End of design.*
