# Backend HRW Stability Verification — GO-LATCH-STAGED

**Date:** 2026-08-25 | **Agent:** @backend | **Mission:** Verify HRW input includes node ID; prove renaming `sfu-1 → latch-sfu-1` breaks rendezvous hashing

---

## Binary Answer

**YES** — Changing `sfu-1` → `latch-sfu-1` **remaps rooms**. The HRW input string is `roomId|nodeID|salt` (xxhash64), so the node ID is a direct input to the hash. Changing the node ID changes the hash output, which changes the score, which changes the winning node for every room.

---

## Proof — Exact Code Location

**File:** `services/meet-sfu-manager/main.go`  
**Line:** 292  
```go
h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)
```

The input to `xxhash.Sum64String` is the concatenation:
- `roomID` (e.g., `"abc123"`)
- `"|"` (literal pipe separator)
- `n.ID` (the **node ID string**, e.g., `"sfu-1"` or `"latch-sfu-1"`)
- `"|"` (literal pipe separator)
- `salt` (from `SFU_HASH_SALT`, default `"p0-salt-2026"`)

**Changing `n.ID` from `"sfu-1"` to `"latch-sfu-1"` changes the xxhash64 output**, which changes `score = h / divisor`, which changes the argmax selection. Every room re-evaluates.

---

## Correct Phase 1 Mapping (Branding Tranche — NO HRW CHANGE)

| Layer | Value | Source |
|-------|-------|--------|
| **Service label (Compose/K8s)** | `latch-sfu-manager` | `infra/compose.yaml:94` service name |
| **HRW node ID (stable)** | `sfu-1` | `services/meet-sfu-manager/main.go:170` auto-generates `sfu-{index}` when no hyphen in address |
| **Salt** | `p0-salt-2026` | `infra/compose.yaml:100` `SFU_HASH_SALT="${SFU_HASH_SALT:-p0-salt-2026}"` |
| **Composed SFU_NODES** | `livekit:7880` (single entry) | `infra/compose.yaml:99` |

**Current P0 reality:** `SFU_NODES=livekit:7880` (single entry) → `parseSFUNodes` (main.go:168-171) auto-generates ID `"sfu-0"` because the address contains no hyphen. All rooms map to `sfu-0` (degenerate case, test `TestSingleNodeDegenerate` main_test.go:59-95).

**Post-P0 multi-SFU:** When `SFU_NODES` expands to `sfu-0:7880,sfu-1:7880,sfu-2:7880`, the HRW IDs **must remain `sfu-0`, `sfu-1`, `sfu-2`** to preserve room assignment stability.

---

## Test Vector Evidence

**File:** `services/meet-sfu-manager/main_test.go`  
**Lines:** 10-55 (`TestRendezvousHRW`)  
```go
salt := "p0-salt-2026"
nodes := []{{ID: "sfu-0", ...}, {ID: "sfu-1", ...}, {ID: "sfu-2", ...}}
roomID := "abc123"
// xxhash(abc123|sfu-1|p0-salt-2026) produces highest score → sfu-1
```

**Design Doc Vector** (confirms namespace dependence):  
**File:** `docs/design/consistent-hashing-roomId-to-SFU.md`  
**Lines:** 112-119
```
salt = "p0-salt-2026"
nodes = [sfu-0, sfu-1, sfu-2]
roomId=abc123 → sfu-1          // sfu-* namespace
Namespace note: nodes=[livekit-0,livekit-1,livekit-2] same salt + abc123 → livekit-2
// Both vectors correct for their ID prefix; formula unchanged h=xxhash(roomId|nodeID|salt)/(1+load*10)
```

The design doc explicitly acknowledges: **different node ID prefix → different mapping, same formula**. This proves node ID is a semantic input, not cosmetic.

---

## Architecture Brief Confirmation

**File:** `docs/architecture-brief.md`  
**Lines:** 127, 147
```go
// Line 127: h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)
// Line 147: Test vector (salt=p0-salt-2026, code truth D-037): roomId=abc123, nodes=[sfu-0,sfu-1,sfu-2] salt=p0-salt-2026 → sfu-1
```

---

## Guardrail Statement

> **HRW vector update to `latch-sfu-*` must NOT be in branding tranche.**  
> Any rename of HRW node IDs (`sfu-0/1/2` → `latch-sfu-0/1/2`) is a **breaking change** requiring:
> 1. Scheduled migration window (not a branding PR)
> 2. Cache invalidation strategy for `sfu:assign:{roomId}` Redis keys (TTL 5m, but active rooms would remap on next cache miss)
> 3. Explicit ADR documenting the migration procedure
> 4. Rollback plan (revert node IDs, flush Redis)

**Phase 1 (Branding)** keeps:
- Service label: `latch-sfu-manager` (Compose service name, DNS, logs)
- HRW node IDs: `sfu-0`, `sfu-1`, `sfu-2` (stable, salted, tested)
- Salt: `p0-salt-2026` (unchanged)

---

## CODE AUTHORIZATION: BLOCKED

**No implementation. No rename. No HRW ID change.**  
This verification memo is the deliverable. Any PR attempting `sfu-* → latch-sfu-*` in HRW context will be rejected at architecture gate.

---

## Citations Summary

| Claim | File | Line(s) |
|-------|------|---------|
| HRW input = `roomID|nodeID|salt` | `services/meet-sfu-manager/main.go` | 292 |
| Auto-generates `sfu-{index}` ID | `services/meet-sfu-manager/main.go` | 168-171 |
| Test vector `abc123 → sfu-1` | `services/meet-sfu-manager/main_test.go` | 10-55 (assertion line 52) |
| Compose `SFU_NODES=livekit:7880` | `infra/compose.yaml` | 99 |
| Compose `SFU_HASH_SALT=p0-salt-2026` | `infra/compose.yaml` | 100 |
| Design doc formula + namespace note | `docs/design/consistent-hashing-roomId-to-SFU.md` | 45, 112-119 |
| Architecture brief formula + vector | `docs/architecture-brief.md` | 127, 147 |

---

*End of verification memo. No code changes authorized.*