# AGENTS.md — meet-secure-core

## Active Milestone — M0-P0 Freeze (Authoritative)
`docs/M0-P0.md` is the single source of truth. All prior roadmap phases (26-week plan in `docs/ROADMAP.md`, `BACKEND_ROADMAP.md` M1-M8) are **FROZEN** until 10 criteria + 5 gates pass GO/NO-GO. Do not build: breakouts, polls, reactions, whiteboard, virtual bg, captions, recording (`meet-composer`), webinar 100-1000/HLS, anon capability links `k#`, P2P↔SFU handoff, WebTransport. Allowed UX only: `landing → /r/:id#k= → pre-join preview → grid Last-N=9 → mute/cam/leave + screen share + shield`. PRs labelled `feature:not-p0` are auto-rejected; merge requires `p0-gate-verify` + 5 approvals.

**10 criteria (all mandatory, reproducible):** 1) 4-browser matrix (Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4 macOS+iOS PWA), 2) 20p ×10min stable (p50 ≤150ms p95 ≤300ms, CPU<70%, loss<1%), 3) LiveKit 1.25 single SFU via Compose + K8s Helm parity, 4) SFrame RFC9605 ciphertext (Wireshark proof, SFU opaque), 5) screen share `getDisplayMedia`, 6) key rotation p95 ≤500ms, 7) reconnect p95 ≤5s, 8) TURN relay HMAC 24h, 9) Lighthouse ≥95 bundle <120kB gz + WASM 150KB async, 10) zero persistent telemetry. See `docs/architecture-brief.md` §10 for traceability, `docs/media-p0-proof.md` for measurement.

## Delegation & Governance — PM Owns, Never Implements
- `opencode.jsonc`: `default_agent: "pm"` (` .opencode/agents/pm.md`). PM (muse-spark-1.2-contributor-free) coordinates roadmap/milestones/prioritization, delegates all implementation to `@architect @frontend @backend @webrtc @security @privacy @qa @reviewer`.
- **Never approve own work.** Every feature/milestone exit requires 5 gates: Architecture (`@architect`), Security (`@security`), Privacy (`@privacy`), QA (`@qa`), Adversarial (`@reviewer`). M0-P0 gate checklist: `docs/gates/architecture-exit-checklist.md`.
- Decision log: ADRs in `docs/adr/` (ADR-004 LiveKit vs mediasoup **decided: LiveKit GO**, ADR-001/005 accepted). Update `docs/architecture-brief.md` §11 for new choices.

## Repo Map
```
docs/               # authority: M0-P0.md, architecture-brief.md, ROADMAP.md (frozen), media-p0-proof.md, c4/p0-context.md
poc/meet-webrtc-core/ # ONLY code package — WebRTC+SFrame POC (src/index.ts → createWebRTCManager)
infra/              # single `docker compose up` self-host: compose.yaml, Caddyfile, livekit.yaml, prometheus.yml, grafana/
.opencode/agents/   # 8 subagents: architect, backend, frontend, webrtc, security, privacy, qa, reviewer (+ media alias)
BACKEND_ROADMAP.md  # Go services design (meet-signal/id/sfu-manager/storage/turn-auth) — 8 milestones, for reference
```
No `services/` exists yet — Go services are spec-only in `BACKEND_ROADMAP.md` + `architecture-brief.md` §3. Do not assume backend code exists outside `poc/`.

## Commands — Verified from Config
All paths are relative to repo root. Node `>=20.0.0` required.

**POC (`poc/meet-webrtc-core/package.json`):**
```bash
npm --prefix poc/meet-webrtc-core run dev          # vite 5.2
npm --prefix poc/meet-webrtc-core run build        # tsc && vite build
npm --prefix poc/meet-webrtc-core test             # vitest run
npm --prefix poc/meet-webrtc-core run test:browser # playwright test (4-browser matrix)
npm --prefix poc/meet-webrtc-core run lint         # eslint src --ext ts,tsx
npm --prefix poc/meet-webrtc-core run wasm:build   # wasm-pack build wasm/sframe --target web --out-dir ../dist/wasm
npm --prefix poc/meet-webrtc-core run load         # tsx scripts/load-test.ts (also: npx tsx scripts/load-test.ts)
```

**Infra (`infra/compose.yaml` — P0 single command for ≤50 rooms / 20p room, 4 vCPU/8GB):**
```bash
docker compose -f infra/compose.yaml up --build --wait
curl -f http://localhost:8080/healthz && curl -f http://localhost:8081/healthz && curl -f http://localhost:9600/healthz
curl -f http://localhost:9090/-/healthy && curl -f http://localhost:3000/api/health  # prom + grafana
# load drill (per compose.yaml comment):
npx --prefix poc/meet-webrtc-core tsx scripts/load-test.ts  # or: pnpm meet-load --rooms 50 --participants 20 --duration 600
```

**Health/metrics endpoints:** `meet-signal :8080 /healthz + :9091 /metrics`, `meet-sfu-manager :8081 /healthz`, `livekit :9600 /healthz + :7880`, `turn-auth :8082`, `prometheus :9090`, `grafana :3000`.

## Architecture Quirks (Not Obvious from Filenames)
- **Stack locked for P0:** PWA React 18 + Vite + Workbox (GenerateSW) + Zustand, LiveKit Go SFU 1.25 `LIVEKIT_E2EE_MODE=blind`, SFrame via Encoded Transform primary + `wasm-sframe` 150KB Worker fallback (`OffscreenCanvas` + `VideoFrame` recycle, Safari 17 required), coturn 4.6 HMAC `TURN_SECRET` TTL 86400, Redis 7 pub/sub `signal:{roomId}` + presence `presence:{roomId}:{hash}` TTL 24h heartbeat 5s, Postgres 16 hash-only, MinIO, Keycloak 24.
- **Routing:** `roomId→SFU` is rendezvous HRW (not ring) — `h=xxhash(roomId|nodeID)/weight`, single-node degenerates to one entry `SFU_NODES=livekit:7880`. Assignment cached Redis `sfu:assign:{roomId}` TTL 5m; re-hash on health fail (`/healthz` 5s). See `docs/architecture-brief.md` §6 and `docs/design/consistent-hashing-roomId-to-SFU.md`.
- **SFrame+SFrame contradiction — honest fallback:** If header-aware Dynacast/Last-N fails (SFU cannot read payload), ship **blind-forward 3 layers** for ≤20p (Last-N=9, ~10-12 Mbps down, 80% overhead) with UI shield text “E2EE · 3-layer relay”. No silent downgrade to DTLS — explicit ⚠️ warning if SFrame unavailable. Pivot on NO-GO within 48h: mesh ≤5p + non-E2EE SFU. Read `architecture-brief.md` §8-9 before touching SFU forwarding.
- **Signaling:** `WSS /signal?v=1&room=:id&token=:jwt` JWT 5m `aud=roomId` + nonce, frames `{type: offer|answer|ice|join|leave|mute|speaking|commit|welcome}`. Stateless — no sticky sessions.
- **Coturn host networking:** `network_mode: host` in Compose (K8s DaemonSet in prod) — not behind Caddy. TURN ports `3478 UDP/TCP + 443 TCP/TLS`, media stays SFrame ciphertext.
- **Privacy invariants:** No analytics/Sentry without PII scrub, `__Host-` cookies `SameSite=Strict` only, VAPID not FCM, logs JSON sanitized (no SDP/PII/IP beyond 24h hash), bundle <120kB gz, WASM async + integrity hash, CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`.

## Testing & Validation — What QA Expects
- **Unit:** `vitest run` (happy path); browser E2E: `playwright test` (skips until browsers installed). Provide histograms not just pass: `qa/reports/key-rotation-latency.json` (p95 ≤500ms, 20 trials), `qa/reports/reconnect-latency.json` (p95 ≤5s, 10 trials/browser), `qa/reports/browser-matrix.html`, `qa/reports/lighthouse/*.json` (≥95 on 4×CPU Slow 4G).
- **Load harness:** `poc/meet-webrtc-core/scripts/load-test.ts` + `tests/test-vectors.ts` (20p vectors, HRW test `abc123 → sfu-2`, SFrame ciphertext vectors). Synthetic load via `livekit load tester` equiv.
- **TURN proof:** force `iceTransportPolicy: relay` + `iptables -p udp --dport 3478 -j DROP`, verify `candidateType=relay` in `chrome://webrtc-internals` + `turn_allocations_active` in Prometheus. Wireshark `rtp && sframe` must show no plaintext NALs.
- **Perf budgets:** Lighthouse CI gate ≥95 perf/accessibility/best-practices, TBT <200ms CLS 0, simulcast 3×2 (180p 300k/360p 800k/720p 1.8M) + Opus, VP9 SVC preferred H264 baseline fallback.

## Operational Gotchas
- `infra/compose.yaml` env defaults: `PG_PASSWORD=p0-dev-pass`, `TURN_SECRET=p0-turn-secret-32chars`, `LIVEKIT_API_KEY=dev` — not prod. `livekit.yaml` + `Caddyfile` are local TLS `internal` self-signed; prod uses Ingress-Nginx + cert-manager (see `docs/c4/p0-context.md`).
- WASM build needs `wasm-pack` installed locally; without it SFrame falls back to DTLS-only warning.
- `pnpm meet-load` in compose comments vs `npm` in poc — both run same `tsx` harness; prefer `npm --prefix poc/meet-webrtc-core` for consistency.
- All Redis/PG rows TTL 24h (rooms 24h post-end, recordings 30d if added) — GC hourly; no media in PG.
