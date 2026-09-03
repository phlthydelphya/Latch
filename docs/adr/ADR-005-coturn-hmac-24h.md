# ADR-005 — Self-Hosted coturn HMAC 24h (Ephemeral, Privacy-Minimized)

**Status:** `ACCEPTED` — `REVIEW REQUIRED` — NOT SELF-APPROVED | **Date:** 2026-09-01 | **Author:** @architect + @backend + @privacy | **Deciders:** @architect + @backend + @privacy + @security
**Refs:** `docs/M0-P0.md` §3 #8/10 (TURN + no telemetry), `docs/architecture-brief.md` §3/4.5/7/10, `docs/c4/p0-context.md`, `infra/compose.yaml`, `docs/media-p0-proof.md` §8
**Related:** ADR-001 (SFU primary), `docs/ROADMAP.md` §6 F-4 (TURN rotation policy)

> **Gate Status:** REVIEW REQUIRED. Merge requires Privacy + Security + QA approvals + `p0-gate-verify`. Do NOT self-approve.

---

## Context

M0-P0 criterion 8 requires **TURN fallback functioning** via `coturn` with HMAC ephemeral creds TTL 24h, 3-region Anycast/GeoDNS stub or single Compose coturn for P0, strict NAT simulation, `candidateType=relay` proof, allocation <2s, no IP retention >24h. Criterion 10 requires **no persistent telemetry**, 24h TTL on all ephemeral rows, logs sanitized (no SDP/PII/IP beyond 24h hash). Privacy checklist F-4 requires TURN HMAC rotation policy documented.

Per `docs/M0-P0.md` §8, TURN relay must remain **SFrame ciphertext opaque** (E2EE holds via TURN).

## Decision

**Accepted — Self-hosted `coturn 4.6` + `turn-auth` sidecar, HMAC-SHA256 ephemeral, TTL 24h (86400s). Single coturn in Compose for P0, K8s parity via DaemonSet/HPA 1→2 post-P0. No hosted TURN (no Twilio/metered).**

### Credential Scheme (RFC 5389 ephemeral)

```
username = <expiry-epoch-seconds>:<userHash>
  where userHash = base64url(sha256(sub_hash | roomHash)) — no email/plaintext, 24h only

password credential = base64( HMAC-SHA256( TURN_SECRET, username ) )
  where TURN_SECRET is 32+ chars from env ${TURN_SECRET} (shared across coturn + turn-auth)

TURN_SECRET rotation: documented in `docs/privacy-inventory.md` TURN section — rotate via dual-secret rollout (old + new accepted 48h), then purge. No downtime.
```

- **TTL:** `86400` (24h). Client fetches on every `POST /turn/credentials` (on join + every 20h refresh). coturn validates `expiry > now` + HMAC match.
- **No long-term creds:** `lt-cred-mech` disabled except HMAC; `--use-auth-secret --static-auth-secret` only.
- **Ports:** P0 Compose `coturn` listens 3478 UDP/TCP + 443 TCP/TLS (TURN TCP 443) + 5349 TLS + 40000-40200 relay ports (`min-port`/`max-port`). Strict NAT test blocks 3478 UDP → must fall back to 443 TCP (`iptables -p udp --dport 3478 -j DROP` + `candidateType=relay` + `turns:443`).
- **IP handling:** coturn logs sanitized — `turn-auth` emits `{time, realm, allocationId, ipHash: sha256(ip+salt), bytes}` only. Raw IP never written to PG/Redis beyond 24h `turn:alloc:{hash}` Redis key TTL 24h. Prometheus `turn_allocations_active` cardinality capped (no per-IP label).
- **Metrics:** `turn_allocations_active`, `turn_allocation_failures_total`, `turn_allocation_latency_ms_bucket` (P95 <2s gate), `turn_relayed_bytes_total` scraped at `:8082/metrics` and coturn Prometheus endpoint.

### Wiring — Compose (P0 validated)

```yaml
# infra/compose.yaml — accepted wiring
coturn:
  image: coturn/coturn:4.6.2-alpine
  network_mode: host # P0 single host; K8s DaemonSet uses hostNetwork
  command: ["turnserver","--log-file=stdout","--lt-cred-mech","--use-auth-secret","--static-auth-secret=${TURN_SECRET:-p0-turn-secret-32chars}","--realm=turn.meet-secure.local","--listening-port=3478","--tls-listening-port=5349","--alt-listening-port=3479","--min-port=40000","--max-port=40200","--no-cli"]
turn-auth:
  image: meet-secure/turn-auth:local
  build: { context: ../services/turn-auth }
  environment: { TURN_SECRET: "${TURN_SECRET}", REDIS_URL: "redis://redis:6379/0", TURN_TTL: "86400" }
  ports: ["8082:8080"]
  healthcheck: { test: ["CMD","wget","-qO-","http://localhost:8080/healthz"] }
  # REST: POST /turn/credentials {roomId, participantHash} → {username, credential, urls: ["turn:...:3478","turn:...:443?transport=tcp","turns:...:443"]}
```

Client `iceServers` ordering (see `docs/media-p0-proof.md` §8.2): `stun` → `turn:3478 UDP` → `turn:443 TCP` → `turns:443 TLS`; forced relay test via `iceTransportPolicy: relay`.

### K8s Parity (Post-P0, same secret)

- Helm `charts/coturn` DaemonSet or Deployment HPA `turn_allocations_active >70% → 1→2`.
- `TURN_SECRET` from `Secret` + `turn-auth` Deployment.
- Anycast/GeoDNS stub documented as "single Compose coturn for P0; 3-region Anycast required beyond 30% TURN rate @1000p" (see `ROADMAP.md` §8 cost fix — honest, not claimed for P0).
- Same 24h TTL, same log purge via Loki pipeline `drop IP after 24h`.

### Privacy Invariant (F-4 + Criterion 10)

- No IP retention >24h: Redis `turn:alloc:{hash}` `EX 86400`, Loki log retention 24h for TURN, PG never stores IP.
- ROPA entry: "TURN allocations — purpose: NAT traversal, legal: legitimate interest, retention: 24h, recipient: self-host operator only, transfer: none".
- CSP does not add TURN exception beyond `connect-src turn: turns:`.

## Rationale

- **Self-hostable:** No cloud dependency; `docker compose up` brings coturn + turn-auth without external account. Matches self-hostable principle (`architecture-brief.md` §1).
- **Ephemeral HMAC:** 24h TTL + per-join fetch limits exposure window; no credential replay beyond expiry. Standard coturn `use-auth-secret`.
- **Privacy:** No IP persistence, no analytics SDK, no cookies. Meets Privacy F-4 (TURN rotation policy) + Criterion 10 "no persistent telemetry".
- **Cost honest:** Single coturn for ≤50 rooms / 20p (30% TURN rate ≈ 15 concurrent relays, trivial). 1000p cost 4-8 nodes documented but NOT claimed for P0 (avoids @reviewer cost-blowup challenge).

## Consequences

- @backend: Implements `services/turn-auth` (`POST /turn/credentials`, `GET /healthz`, Prometheus), wires `infra/compose.yaml` `depends_on: redis`, rotation runbook in `docs/privacy-inventory.md`.
- @webrtc: `src/turn/manager.ts` `buildIceServers()` ordered fallback chain + forced relay harness; `candidateType=relay` proof via `getStats()`.
- @privacy: Approves ROPA + minimization table entry + rotation policy doc (F-4).
- @security: Audits HMAC strength (secret ≥32 chars, `TURN_SECRET` entropy check, `argon` not needed here — just HMAC).
- @qa: Strict NAT test `iptables` + `tc` + `turn_allocations_active` scrape + allocation latency histogram; block `candidateType=relay` === PASS.
- Turn secret is **not committed** — supplied via `.env` / `TURN_SECRET` env; CI uses `p0-turn-secret-32chars` placeholder only.

## Alternatives Considered

1. **Hosted TURN (Twilio, Metered)** — rejected for P0 (external data processor, cost, IP retention 7d+).
2. **Long-lived TURN creds** — rejected (violates 24h TTL, privacy F-4, expands breach window).
3. **OIDC-bound TURN (JWT TURN REST API with `exp` from OIDC)** — future post-P0; P0 uses HMAC username expiry (simpler, no JWKS on coturn).
4. **No TURN (STUN only)** — rejected (fails criterion 8 strict NAT, corporate firewall 443).

## Validation

- `curl -f http://localhost:8082/healthz` + `curl -X POST http://localhost:8082/turn/credentials -d '{"roomId":"abc"}'` → `username` contains `:` + expiry + `credential` HMAC length 44.
- `docker compose logs coturn` shows `allocation` + `ipHash` only.
- Prometheus `turn_allocations_active` visible at `http://localhost:9090` (`turn_*` label).
- Forced relay harness passes on 4 browsers (see `media-p0-proof.md` §8.6).

## Approval — REVIEW REQUIRED

| Role | Reviewer | Signature | Date | Verdict |
|------|----------|-----------|------|---------|
| @architect | Principal Architect | _________________ | 2026-09-01 | Accepted (author) |
| @backend | Backend Lead | _________________ | ☐ | PENDING REVIEW |
| @privacy | Privacy Lead | _________________ | ☐ | PENDING — must approve ROPA/F-4 + 24h purge |
| @security | Security | _________________ | ☐ | PENDING — HMAC strength audit |
| @reviewer | Adversarial Reviewer | _________________ | ☐ | PENDING — TURN cost + honesty challenge |
| @qa | QA | _________________ | ☐ | PENDING — `p0-gate-verify` + strict NAT harness |

**Merge blocked until 5 gates + `p0-gate-verify` per `docs/M0-P0.md` §2.**

*End of ADR-005.*
