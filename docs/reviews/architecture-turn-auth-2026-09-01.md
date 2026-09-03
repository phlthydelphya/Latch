# Architecture Review — turn-auth (M0-P0)

**Artifact:** `services/turn-auth/main.go` `POST /turn/credentials` | **Date:** 2026-09-01 | **Reviewer:** @architect | **Status:** `REVIEW REQUIRED`
**Authority:** `M0-P0.md` §3 #8+§7, `architecture-brief.md` §3/4.5/6/10, `ADR-005`, `gates/architecture-exit-checklist.md` row 8, `infra/compose.yaml`, `c4/p0-context.md`

## Verdict: CHANGES_REQUESTED (fixable W3, not re-architect)

Aligned with P0. Wiring/scheme/boundary correct. 3 gaps block APPROVED: unauthenticated issuance, incomplete metrics, TODO audit. No freeze violation, no silent downgrade, no over-claim.

## 1. Boundaries & Wiring — PASS

| Check | Spec | Result |
|---|---|---|
| §3 boundary | turn-auth = HMAC 24h only, no media | ✅ `main.go` HMAC-only, no SRTP/PG |
| §4.5 TURN flow | `POST /turn/credentials → expiry:hash → HMAC → 3 urls` | ✅ implements `iceServers` stun→3478 UDP→443 TCP→turns 443 |
| §6 hash | `roomId→SFU` HRW unaffected | ✅ no `sfu:assign` writes |
| §10 row 8 | relay opaque, <2s, IP 24h purge, metrics | ⚠️ opaque ok, metrics/TODO gap (I2/I3) |
| ADR-005 yaml | coturn `turnserver --lt-cred-mech --use-auth-secret --static-auth-secret=${TURN_SECRET} --realm=turn.meet-secure.local --listening-port=3478 --tls-listening-port=5349 --min-port=40000 --max-port=40200` + turn-auth `TURN_SECRET/REDIS_URL/TURN_TTL=86400 ports 8082:8080 /healthz` + `network_mode:host` | ✅ `compose.yaml` 41-53 exact match |

## 2. Credential Scheme — PASS (notes)

- `username=<expiry>:<userHash>`, `userHash=base64urlRaw(sha256(participantHash|roomId))` — matches ADR-005. Random 32B fallback when hash empty is undocumented; should 400 instead.
- `credential=base64Std(HMAC-SHA256(TURN_SECRET, username))` 44 chars — correct.
- `TTL=86400` via `TURN_TTL` env — correct.
- `urls` 3×: `turn:...:3478`, `turn:...:443?transport=tcp`, `turns:...:443?transport=tcp` — third adds `?transport=tcp` vs ADR `turns:443`; tolerate but align.
- Secret `len>=32` fail-fast at boot, HMAC-only, no long-term creds — correct.

## 3. Single-Node Claim — PASS (honest)

P0: single coturn host for ≤50 rooms/20p on 4vCPU/8GB. K8s parity `DaemonSet/HPA 1→2` post-P0. ADR-005 states “single Compose coturn for P0; 3-region Anycast required beyond 30% TURN @1000p” — not claimed for P0. 20p×30% ≈6 relays, `40000-40200` ports trivial. No facade.

## 4. Freeze — PASS

No breakouts/polls/reactions/whiteboard/virtual bg/captions/recording/composer/webinar/HLS/anon `k#`/P2P↔SFU/WebTransport. Only `POST /turn/credentials` supporting allowed `landing→/r/:id#k=→preview→grid Last-N=9→mute/cam/leave+screen share+shield`.

## 5. Integration — meet-signal + LiveKit (SFrame opaque)

`meet-signal` `TURN_AUTH_URL=http://turn-auth:8080` (`compose.yaml:79`) correct. Currently turn-auth accepts anonymous POST — should be gated by JWT or internal-only (I1). **SFrame opaque:** coturn RFC5766 relays `Allocate/ChannelBind` bytes without DTLS/SRTP termination; SFrame RFC9605 ciphertext stays opaque E2E. Verified via `candidateType=relay` (forced `iceTransportPolicy:relay` + `iptables -p udp --dport 3478 -j DROP`) + Wireshark `rtp && sframe` KID/CTR+ciphertext, SFU blind-forward.

## 6. Issues (5 max) — adversarial

**I1 HIGH — Unauthenticated farming, 24h replay window.** Anonymous `POST /turn/credentials` mints 24h creds. Fix: require `Authorization: Bearer <jwt>` (JWKS `aud=roomId`) or make service internal-only (remove `ports:8082:8080` external, use compose network). Dual-secret 48h rotation overlap per ADR not implemented.

**I2 MED — Metrics incomplete for gate row 8 / HPA.** Only `turn_allocations_total`. ADR requires `turn_allocations_active` gauge, `turn_allocation_failures_total`, `turn_allocation_latency_ms_bucket` (P95<2s). `allocationsTotal++` races — use `atomic` or prom client.

**I3 MED — Redis audit TODO, privacy gap.** Requires `SET turn:alloc:{hash} EX 86400` + `ipHash=sha256(ip+salt)` purged 24h. Code logs `userHash[:8]` + `// TODO` Redis stub. Complete or document stub + Loki 24h purge.

**I4 LOW — Content-Type + random fallback.** Strict `== "application/json"` rejects `charset=UTF-8` without space; use prefix. Empty `participantHash` should 400, not random, to keep deterministic invariant.

**I5 LOW — `turns` URL drift.** ADR `turns:443` vs code `turns:443?transport=tcp`; harmless but align.

## 7. Traceability — 10 Criteria

| # | Criterion | Artifact |
|---|-----------|----------|
|1|4-browser matrix|PASS supports NAT|
|2|20p×10min CPU<70%|PASS 30% TURN budgeted|
|3|LiveKit+Compose+Helm HRW|PASS independent|
|4|SFrame opaque|PASS relay opaque|
|5|Screen share|PASS relay opaque|
|6|Key rotation ≤500ms|N/A|
|7|Reconnect ≤5s|PASS re-gather <2s|
|8|**TURN HMAC 24h relay <2s**|**CHANGES_REQUESTED I1-I3**|
|9|Lighthouse ≥95|PASS|
|10|No telemetry 24h purge|PASS if I3 fixed|

## 8. Exit Checklist Row 8

> Row 8: *TURN fallback (HMAC 24h, relay, <2s) | `candidateType=relay`, `turn_allocations_active` | Media via relay opaque, alloc<2s, IP purged 24h | @backend+@webrtc+@qa*

- [x] `candidateType=relay` proof path documented
- [ ] `turn_allocations_active` — missing (I2) — blocks `p0-gate-verify`
- [x] SFrame opaque — correct
- [ ] IP purged 24h — TODO (I3)

Gate RED until I1-I3 closed, then @security/@privacy/@qa sign.

---
**Fix:** I1 auth/internal, I2 metrics, I3 Redis audit → re-review <30 lines → APPROVED.

@architect ________ Date ____
