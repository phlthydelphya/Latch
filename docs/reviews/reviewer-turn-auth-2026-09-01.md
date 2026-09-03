# Adversarial Review — `turn-auth` POST /turn/credentials

**Artifact:** `services/turn-auth/main.go` | **Date:** 2026-09-01 | **Reviewer:** @reviewer
**Authority:** `docs/M0-P0.md` §8/§9, `architecture-brief.md` §8-9, `ADR-005`, `gates/architecture-exit-checklist.md` row 8, `infra/compose.yaml`

## Verdict: **GO WITH WAIVER** (3 HIGH waivers)
E2EE honesty through TURN relay holds — no facade. But three HIGH-risk gaps must close before `p0-gate-verify`.

---

## Challenge 1 — TURN cost honesty: P0 honest, P1 path missing (HIGH)
Single coturn for ≤50 rooms/20p (~15 concurrent relays at 30% TURN rate) is **honest** per ADR-005 §Rationale. But P1 100-1000 webinar scaling claim is a gap: `network_mode: host` in Compose ≠ K8s `DaemonSet` (`hostNetwork: true`). No K8s coturn manifest, no HPA rule, no capacity model ties 1→8 nodes. ROADMAP §8 documents "4-8 nodes for 1000p" but scaling trigger (`turn_allocations_active` >70%) and node-sizing math are absent.

> **Mitigation:** File `charts/coturn/` DaemonSet manifest + HPA rule + per-node capacity table before P1 gate.

## Challenge 2 — SFrame + SFU + TURN interplay: honest relay, but Wireshark filter is wrong (LOW)
TURN is RFC 5766 relay — coturn never terminates DTLS/SRTP, never sees SFrame keys. Architecture-brief §1/§4.5 correctly state "media via TURN remains SFrame ciphertext opaque." **Honest E2EE holds via relay.** However: Wireshark filter `rtp && sframe` will **not** show raw RTP through TURN — packets are encapsulated in TURN Data messages. Must be `turn && sframe` or inspect TURN Data channel.

> **Mitigation:** Update `media-p0-proof.md` §4.4 + QA harness to use `turn && sframe`.

## Challenge 3 — Security: unauthenticated POST + 24h TTL vs 5m JWT (HIGH)
`POST /turn/credentials` is **fully anonymous** — no JWT, no Authorization header, no room membership check. `TURN_TTL=86400` (24h) while meet-signal JWT is 300s. Leaked credential grants 24h TURN access. No rate-limit, `participantHash` empty falls back to random (forgery). **24h TTL too long for unauthenticated endpoint.** Default should be 3600s (1h) with explicit refresh.

> **Mitigation:** (a) Require `Authorization: Bearer <jwt>` validated against JWKS (`aud=roomId`) **OR** bind turn-auth to compose internal network (remove `ports:8082:8080`); (b) reduce default `TURN_TTL` to 3600s; (c) reject empty `participantHash` with 400.

## Challenge 4 — Availability: single-coturn PoF, RTO untestable, dual-secret missing (HIGH)
Compose has **no `restart:` policy on coturn**, no coturn self healthcheck, no LB draining. Architecture-brief §7 RTO <20s relies on K8s HPA 1→2 — **untestable in Compose**. Dual-secret 48h rotation (ADR-005 §Decision) not implemented: `main.go` reads `TURN_SECRET` once at boot; no `OLD_TURN_SECRET` env; coturn `--static-auth-secret` accepts one secret.

> **Mitigation:** Add `restart: unless-stopped` + coturn healthcheck; file `OLD_TURN_SECRET` dual-secret code path + migration script before W4.

## Challenge 5 — Verifiability: forced-relay CI automation gap (MEDIUM)
`candidateType=relay` proof requires `iceTransportPolicy: relay` + `iptables -p udp --dport 3478 -j DROP`. Not automatable in standard CI without privileged containers. Playwright cannot set `iceTransportPolicy` via `browserContext().grantPermissions`. Wireshark `rtp && sframe` through TURN is filter mismatch (see Challenge 2). **Verification chain is semi-manual and not CI-gatable as-is.**

> **Mitigation:** Document privileged Docker-in-Docker test container with iptables, automate `candidateType=relay` via `pc.getStats()` in Playwright.

---

## Waiver Summary

| # | Challenge | Rating | Waiver condition |
|---|-----------|--------|-----------------|
| 1 | TURN cost P1 path + `network_mode:host` ≠ K8s DaemonSet | HIGH | K8s manifest + capacity model filed |
| 3 | Unauthenticated POST + 24h TTL | HIGH | Auth gate OR internal-only + TTL≤1h |
| 4 | Single-coturn HA + dual-secret missing | HIGH | `restart:` policy + dual-secret code |
| 2 | Wireshark filter mismatch through TURN | LOW | Fix filter to `turn && sframe` |
| 5 | Forced-relay CI not automatable | MED | Privileged test container documented |

## Sign-off

**Honest E2EE through TURN relay:** ✅ — coturn is blind RFC 5766 relay, SFrame ciphertext opaque, no facade. Genuine.

**GO WITH WAIVER** — 3 HIGH waivers must close before `p0-gate-verify`. If waivers 3 and 4 cannot close in 48h, invoke **Pivot Option A** (mesh-E2EE ≤5p + non-E2EE SFU for >5, explicit consent banner). Option B (E2EE to 1:1 only) and Option C (replace LiveKit with mediasoup) remain on table per `M0-P0.md` §8.

@reviewer ________ Date 2026-09-01
