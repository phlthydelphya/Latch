# M0-P0 Scoreboard

**Authority:** `docs/M0-P0.md` §3 (10 criteria) + §7 (5 gates) | **Owner:** PM (muse-spark-1.2-contributor-free) | **Date:** 2026-09-01 | **Status:** `ACTIVE — EVIDENCE DEFICIT` — 0/10 proven

> Single source of truth for GO/NO-GO. No feature work until all Verification + Gates are green. Check a box only when artifact exists and is reproducibly linked.

## Governance

- [ ] Git initialized (`git init` + initial commit)
- [ ] Remote repository created (`gh repo create --push`)
- [ ] Main branch protected (requires `p0-gate-verify` + 5 approvals)
- [ ] `p0-gate-verify` label exists

## Infrastructure

- [ ] `docker compose -f infra/compose.yaml up --build --wait` passes
- [ ] `meet-signal` healthy (`curl -f http://localhost:8080/healthz`)
- [ ] `meet-sfu-manager` healthy (`curl -f http://localhost:8081/healthz`)
- [ ] `turn-auth` healthy (`curl -f http://localhost:8082/healthz`)
- [ ] `livekit` healthy (`curl -f http://localhost:9600/healthz`)
- [ ] `prometheus` healthy (`curl -f http://localhost:9090/-/healthy`)
- [ ] `grafana` healthy (`curl -f http://localhost:3000/api/health`)

## Verification (9 missing — dominate GO/NO-GO)

- [ ] Browser matrix report → `qa/reports/browser-matrix.html` + video captures (Criterion 1 — Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4 macOS+iOS PWA, 100% core flows, explicit ⚠️ if SFrame unavailable)
- [ ] Wireshark SFrame capture → `qa/reports/wireshark-livekit-sframe.pcapng` (Criterion 4 — `rtp && sframe`, KID/CTR visible, payload random, 16B AES-GCM tag, SFU opaque)
- [ ] 20p benchmark → `qa/reports/sfu-benchmark/*.json` (Criterion 2 — 20p ×10min stable, no drop >5s, p50≤150 p95≤300, CPU<70% on 2 vCPU, loss<1%, 20 distinct participantIds)
- [ ] Rotation histogram → `qa/reports/key-rotation-latency.json` (Criterion 6 — 20 trials under 20p load, p50≤300 p95≤500, zero plaintext frames, zeroize on leftAt)
- [ ] Reconnect histogram → `qa/reports/reconnect-latency.json` (Criterion 7 — 10 trials/browser, WSS kill 3s + ICE restart, p95≤5s, epoch preserved)
- [ ] TURN relay proof → `candidateType=relay` in `chrome://webrtc-internals` + Prometheus `turn_allocations_active` <2s (Criterion 8 — `iceTransportPolicy: relay` + `iptables --dport 3478 -j DROP`, media stays SFrame ciphertext, IP purged 24h)
- [ ] Lighthouse report → `qa/reports/lighthouse/*.json` (Criterion 9 — perf≥95 a11y≥95 best-practice≥95, bundle <120kB gz + WASM 150KB async + integrity hash, TBT<200 CLS 0 on 4×CPU Slow 4G)
- [ ] Privacy scan → `grep -r analytics` clean + CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'` + `docs/privacy-inventory.md` checked (Criterion 10 — zero persistent telemetry, `__Host- SameSite=Strict`, VAPID not FCM, 24h TTL)
- [ ] M0-P0 test plan → `docs/qa/m0-p0-test-plan.md` (QA gate doc)

## Gates (5 required — no self-approval)

- [ ] Architecture — @architect + @reviewer (requires `architecture-brief.md` + `c4/p0-context.md` + ADR-004 + hash design + pivot criteria + all Verification above)
- [ ] Security — @security (STRIDE 8 + 5 conditions: SAS/QR, rotation ≤500, CSP, TURN audit, Argon2id + Wireshark proof)
- [ ] Privacy — @privacy (minimization + GDPR + DSR `DELETE /accounts/me` + ROPA + zero-telemetry statement)
- [ ] QA — @qa (`p0-gate-verify` label only when all 10 criteria reproducible)
- [ ] Adversarial — @reviewer (SFrame+SFU contradiction + TURN cost + Safari gaps + honest E2EE signed GO or waiver)

## Status

**Criteria Proven:** 0/10 — Criterion #3 downgraded to **AMBER** (Compose exists but never validated, Helm missing, services are stubs)

**Overall:** 🔴 **NO-GO** (freeze continues — no Zoom depth)

**Next GO/NO-GO vote:** W4 per `M0-P0.md` §8 — requires all Verification green + 5 gates signed.

---

### Critical Path (do in order, nothing else)

```
Git → Backend WSS (meet-signal/meet-sfu-manager/turn-auth) → docker compose up --build --wait → 2-browser encrypted call → Wireshark pcap → 20p benchmark → Security review → GO/NO-GO
```

### Stand-up — 4 Questions Only

1. Did `git init` happen?
2. Did `docker compose up --build --wait` pass (all healthz green)?
3. Did two browsers exchange encrypted media (SFrame ON)?
4. Is there a Wireshark capture proving ciphertext-only forwarding (SFU opaque)?

If any answer is **No**, end discussion and produce evidence.

---
*PM note: This file is the only new doc until evidence exists. No new roadmaps, ADRs, or milestones.*
