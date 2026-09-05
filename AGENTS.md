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
docs/               # authority: M0-P0.md, architecture-brief.md, ROADMAP.md (frozen), media-p0-proof.md, c4/p0-context.md, adr/, design/, gates/, reviews/
poc/meet-webrtc-core/ # PWA frontend: React 18 + Vite + Zustand + LiveKit Client SDK + SFrame E2EE
services/           # 3 Go 1.22 services (single main.go each, no internal packages)
  meet-signal/      #   POST /token, WSS /signal (JWT auth, in-memory hub, gorilla/websocket)
  meet-sfu-manager/ #   GET /internal/sfu/assign (HRW xxhash, Redis cache, health poll 5s)
  turn-auth/        #   POST /turn/credentials (HMAC-SHA256, coturn ephemeral creds, TTL 24h)
infra/              # docker compose up: compose.yaml, Caddyfile, livekit.yaml, prometheus.yml, grafana/
.opencode/agents/   # 8 subagents: architect, backend, frontend, webrtc, security, privacy, qa, reviewer (+ deprecated media alias)
.opencode/          # task-backend.md, task-webrtc.md, task-qa.md (PM task definitions)
qa/                 # QA reports and gate plans
BACKEND_ROADMAP.md  # Go services design spec — 8 milestones, for reference
```

## Commands — Verified from Config

All paths relative to repo root. **Node `>=20.0.0`** required for POC. **Go 1.22** required for services.

### POC Frontend (`poc/meet-webrtc-core/`)
```bash
npm --prefix poc/meet-webrtc-core run dev          # vite 5.2 dev server (host 127.0.0.1:5173, COOP/COEP headers)
npm --prefix poc/meet-webrtc-core run build        # tsc -p tsconfig.app.json && vite build
npm --prefix poc/meet-webrtc-core test             # vitest run (jsdom, globals, tests/ directory)
npm --prefix poc/meet-webrtc-core run test:browser # playwright test (skips if browsers not installed)
npm --prefix poc/meet-webrtc-core run lint         # eslint src --ext ts,tsx
npm --prefix poc/meet-webrtc-core run wasm:build   # wasm-pack build wasm/sframe --target web
npm --prefix poc/meet-webrtc-core run load         # tsx scripts/load-test.ts
npm --prefix poc/meet-webrtc-core run adversarial  # tsx scripts/run-adversarial-test.ts
npm --prefix poc/meet-webrtc-core run lighthouse   # lighthouse CI report
npm --prefix poc/meet-webrtc-core run sframe-proof # tsx scripts/websocket-sframe-proof-runner.ts
```

### Go Services (`services/`)
Each service is a single `main.go` with no internal packages. Built via multi-stage Dockerfiles (golang:1.22-alpine → alpine:3.20, CGO_ENABLED=0, static binaries).

```bash
# Build individual services locally (not in Docker):
cd services/meet-signal && go build -o meet-signal .
cd services/meet-sfu-manager && go build -o meet-sfu-manager .
cd services/turn-auth && go build -o turn-auth .

# Run tests (only meet-sfu-manager has tests):
cd services/meet-sfu-manager && go test -v ./...

# Docker build individual services:
docker build -t meet-secure/meet-signal:local services/meet-signal
docker build -t meet-secure/meet-sfu-manager:local services/meet-sfu-manager
docker build -t meet-secure/turn-auth:local services/turn-auth
```

### Infra (`infra/compose.yaml` — P0: ≤50 rooms / 20p room, 4 vCPU/8GB)
```bash
docker compose -f infra/compose.yaml up --build --wait
# Verify all health endpoints:
curl -f http://localhost:8080/healthz   # meet-signal
curl -f http://localhost:8081/healthz   # meet-sfu-manager
curl -f http://localhost:9600/healthz   # livekit
curl -f http://localhost:8082/healthz   # turn-auth
curl -f http://localhost:9090/-/healthy # prometheus
curl -f http://localhost:3000/api/health # grafana
```

### Service Map & Ports
| Service | Port | Endpoints |
|---------|------|-----------|
| meet-signal | 8080 | `/healthz`, `/token` (POST), `/signal` (WSS upgrade) |
| meet-signal | 9091 | `/metrics` (Prometheus stub) |
| meet-sfu-manager | 8081 | `/healthz`, `/internal/sfu/assign?roomId=` (GET) |
| turn-auth | 8082 (host) → 8080 (container) | `/healthz`, `/metrics`, `/turn/credentials` (POST) |
| livekit | 7880 (UDP/TCP), 7881 (UDP), 9600 | `/healthz` |
| coturn | 3478 (UDP/TCP), 5349 (TLS), 443 (TCP/TLS) | host networking |
| prometheus | 9090 | `/-/healthy` |
| grafana | 3000 | `/api/health` |
| postgres | 5432 | |
| redis | 6379 | |

## Architecture Quirks (Not Obvious from Filenames)
- **Stack locked for P0:** PWA React 18 + Vite + Workbox (GenerateSW) + Zustand, LiveKit Go SFU 1.25 `LIVEKIT_E2EE_MODE=blind`, SFrame via Encoded Transform primary + `wasm-sframe` 150KB Worker fallback (`OffscreenCanvas` + `VideoFrame` recycle, Safari 17 required), coturn 4.6 HMAC `TURN_SECRET` TTL 86400, Redis 7 pub/sub `signal:{roomId}` + presence `presence:{roomId}:{hash}` TTL 24h heartbeat 5s, Postgres 16 hash-only, MinIO, Keycloak 24.
- **Go services pattern:** Each service is a single `main.go` with all logic in one file (no `internal/`, `pkg/`, or `cmd/` subdirectories). No shared library between services — each has its own `go.mod`. Duplicated `getEnv`/`getEnvInt` helpers across services. All services listen on `PORT` env (default varies by service) and shut down gracefully on SIGTERM/SIGINT with 10s timeout.
- **meet-signal is in-memory hub (no Redis yet):** The hub uses an in-memory `map[string]map[*client]struct{}` for room membership. The `REDIS_URL` env is accepted but not wired into the hub — it's passed through compose for future use. JWT verification is HMAC-SHA256 with shared secret, not JWKS. No token refresh endpoint. No OIDC integration yet.
- **turn-auth has no external Go dependencies:** Unlike the other two services, `turn-auth/go.mod` has zero `require` entries — it uses only the standard library (`crypto/hmac`, `crypto/sha256`, `crypto/rand`). The Redis audit key is a TODO stub (commented out).
- **meet-sfu-manager tests live in `main_test.go`:** Tests are in the same package (`package main`) and test the HRW hashing algorithm directly using `xxhash.Sum64String`. The test vector `abc123 → sfu-1` (not `sfu-2` as the design doc originally said; the code comment acknowledges the discrepancy).
- **Routing:** `roomId→SFU` is rendezvous HRW (not ring) — `h=xxhash(roomId|nodeID|salt)/weight`, single-node degenerates to one entry `SFU_NODES=livekit:7880`. Assignment cached Redis `sfu:assign:{roomId}` TTL 5m; re-hash on health fail (`/healthz` 5s). See `docs/architecture-brief.md` §6 and `docs/design/consistent-hashing-roomId-to-SFU.md`.
- **SFrame+SFrame contradiction — honest fallback:** If header-aware Dynacast/Last-N fails (SFU cannot read payload), ship **blind-forward 3 layers** for ≤20p (Last-N=9, ~10-12 Mbps down, 80% overhead) with UI shield text “E2EE · 3-layer relay”. No silent downgrade to DTLS — explicit ⚠️ warning if SFrame unavailable. Pivot on NO-GO within 48h: mesh ≤5p + non-E2EE SFU. Read `architecture-brief.md` §8-9 before touching SFU forwarding.
- **Signaling:** `WSS /signal?v=1&room=:id&token=:jwt` JWT 5m `aud=roomId` + nonce, frames `{type: offer|answer|ice|join|leave|mute|speaking|commit|welcome}`. Stateless — no sticky sessions. meet-signal currently accepts token via query param `?token=` or `Authorization: Bearer` header.
- **Coturn host networking:** `network_mode: host` in Compose (K8s DaemonSet in prod) — not behind Caddy. TURN ports `3478 UDP/TCP + 443 TCP/TLS`, media stays SFrame ciphertext.
- **Privacy invariants:** No analytics/Sentry without PII scrub, `__Host-` cookies `SameSite=Strict` only, VAPID not FCM, logs JSON sanitized (no SDP/PII/IP beyond 24h hash), bundle <120kB gz, WASM async + integrity hash, CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`.
- **Vite dev server quirks:** Dev server sets `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers (required for `SharedArrayBuffer` in WASM). Dev proxy routes `/signal`, `/token`, `/api` to the signal service, and `/sfu`, `/rtc`, `/turn` to their respective backends. These proxies are dev-only; production uses Caddy.

## Go Service Implementation Details

### meet-signal (`services/meet-signal/main.go`)
- **Dependencies:** `golang-jwt/jwt/v5`, `google/uuid`, `gorilla/websocket`
- **POST /token:** Accepts `{roomId, name}`, returns `{token, participantId, roomId}`. JWT HS256, TTL from `JWT_TTL_SECONDS` (default 3600s). `JWT_SECRET` must be ≥32 bytes.
- **WSS /signal:** Validates JWT, enforces `room` param matches token `aud`. In-memory hub with join/leave/relay. `client` wraps `gorilla/websocket.Conn` with a mutex for writes.
- **SignalMessage types:** `join`, `leave`, plus arbitrary relay of any `type` from client frames. `participantId` is enforced server-side (client can't spoof).
- **No persistence:** No Redis/Postgres wired in yet despite env vars in compose.

### meet-sfu-manager (`services/meet-sfu-manager/main.go`)
- **Dependencies:** `cespare/xxhash/v2`, `redis/go-redis/v9`
- **GET /internal/sfu/assign?roomId=:** HRW hash across `SFU_NODES` (comma-separated). Checks Redis cache `sfu:assign:{roomId}` first. On cache miss, computes HRW and caches result for 300s. On health fail, invalidates cached assignments for the unhealthy node.
- **Health poll:** Background goroutine every 5s hits `http://{host}:9600/healthz` for each SFU node. Port is always rewritten to 9600 (LiveKit health port) regardless of the address port in `SFU_NODES`.
- **SFU_NODES parsing:** If an entry has no hyphen, it gets an auto-generated ID `sfu-{index}`. Address is kept as-is (e.g., `livekit:7880`).

### turn-auth (`services/turn-auth/main.go`)
- **Dependencies:** None (stdlib only)
- **POST /turn/credentials:** Accepts `{roomId, participantHash}` (participantHash optional). Returns `{username, credential, ttl, urls}`. Username format: `{expiry}:{userHash}`. Credential: `base64(HMAC-SHA256(TURN_SECRET, username))`. TTL from `TURN_TTL` env (default 86400).
- **Strict JSON:** `DisallowUnknownFields()` on decoder, `Content-Type: application/json` enforcement, 1KB body limit.
- **Sanitized logging:** Only logs first 8 chars of userHash prefix, never logs TURN_SECRET or raw credential.
- **Redis audit TODO:** Redis audit key insertion is a code comment stub — not yet implemented.

## Testing & Validation — What QA Expects
- **Unit:** `vitest run` (happy path); browser E2E: `playwright test` (skips until browsers installed). Provide histograms not just pass: `qa/reports/key-rotation-latency.json` (p95 ≤500ms, 20 trials), `qa/reports/reconnect-latency.json` (p95 ≤5s, 10 trials/browser), `qa/reports/browser-matrix.html`, `qa/reports/lighthouse/*.json` (≥95 on 4×CPU Slow 4G).
- **Load harness:** `poc/meet-webrtc-core/scripts/load-test.ts` + `tests/test-vectors.ts` (20p vectors, HRW test `abc123 → sfu-1` per code, SFrame ciphertext vectors). Synthetic load via `livekit load tester` equiv.
- **TURN proof:** force `iceTransportPolicy: relay` + `iptables -p udp --dport 3478 -j DROP`, verify `candidateType=relay` in `chrome://webrtc-internals` + `turn_allocations_active` in Prometheus. Wireshark `rtp && sframe` must show no plaintext NALs.
- **Perf budgets:** Lighthouse CI gate ≥95 perf/accessibility/best-practices, TBT <200ms CLS 0, simulcast 3×2 (180p 300k/360p 800k/720p 1.8M) + Opus, VP9 SVC preferred H264 baseline fallback.

## Operational Gotchas
- `infra/compose.yaml` env defaults: `PG_PASSWORD=p0-dev-pass`, `TURN_SECRET=p0-turn-secret-0123456789abcdef0123456789`, `LIVEKIT_API_KEY=dev` — not prod. `livekit.yaml` + `Caddyfile` are local TLS `internal` self-signed; prod uses Ingress-Nginx + cert-manager (see `docs/c4/p0-context.md`).
- WASM build needs `wasm-pack` installed locally; without it SFrame falls back to DTLS-only warning.
- `pnpm meet-load` in compose comments vs `npm` in poc — both run same `tsx` harness; prefer `npm --prefix poc/meet-webrtc-core` for consistency.
- All Redis/PG rows TTL 24h (rooms 24h post-end, recordings 30d if added) — GC hourly; no media in PG.
- **Go services: turn-auth has no `go.sum`** — it has zero dependencies (stdlib only), so its Dockerfile only copies `go.mod`. meet-signal and meet-sfu-manager both have `go.sum` files. Don't add external deps to turn-auth without updating its Dockerfile to include `go.sum`.
- **Vite dev COOP/COEP headers:** Required for `SharedArrayBuffer` (needed by WASM workers). If shared memory doesn't work in dev, check these headers are present.
- **Playwright tests skip if browsers not installed:** `npx playwright install` required before `test:browser`.
