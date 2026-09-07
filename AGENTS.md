# AGENTS.md — meet-secure-core

## Milestone Portfolio & Current State (READ FIRST)
`docs/ROADMAP.md` is frozen (M0–M3 era). Per-milestone specs + exit reports in `docs/` are the authority. Portfolio status (verified via `git tag --list` 2026-09-06):

| Milestone | Status | Evidence |
|---|---|---|
| M0-P0 Architecture Validation | CLOSED & ACCEPTED | RC1 commit `ef6206c` |
| M1 Production Hardening | CLOSED & ACCEPTED | Commit `9864b4b`; tags `beta-ready`, `m1-release-candidate`, `v1.0.0-m1-beta` |
| M2 Meeting Experience | CLOSED & ACCEPTED | Commit `1d2cacc`; tag `v1.0.0-m2-complete` |
| M3A Advanced View Experience | CLOSED & ACCEPTED | Tag `m3a-accepted` |
| M3B Multi-Stream Scalability | CLOSED & ACCEPTED | Commit `b1f824a`; tag `m3b-accepted` |
| **M4A Authoritative Session Control** | **PASSED TECHNICAL REVIEW — NOT CLOSED** | Branch `feat/m4a-authoritative-session-control` dirty; `m4a-accepted` tag does NOT exist |
| M4A.1 Invitation Links (ADR-006) | Technical review accepted, no closure tag | `m4a.1-accepted` does NOT exist |
| M4A.2 Latch Brand Rename (ADR-007) | PLANNING ONLY — code authorization BLOCKED | ADR-007 |

- **Product display name:** Latch — repo/service namespaces stay `meet-*` until the separately approved rename tranche (ADR-007, planning only, code authorization BLOCKED).
- **Active spec:** `docs/M4A-authoritative-session-control.md` (server-authoritative host control — see "M4A Architecture" below).
- **Current objective (PM charter 2026-09-06):** close M4A, then M4A.1 (commit → merge → distinct acceptance tags, no co-tagging per ADR-007 §2), then **M5A — Reliability, Recovery, and Session Resilience**. M4B (collaboration maturity) and M4A.2 (Latch namespace/brand tranche) are deferred. Roadmap principle: Reliability > Trust > Usability > Features.

### Governance Rules (from `docs/adr/ADR-007-latch-staged-rename.md` — binding)
- The ONLY valid M4A status phrasing until closure: *"passed technical review but has not completed repository closure, merge, and acceptance tagging."* Never write "CLOSED & FULLY ACCEPTED" while the delivering branch is dirty/unmerged.
- `docs/M4A-exit-report.md` carries an Errata banner and is **technical-review evidence only** — never cite it as proof of closure. ADR-007 §2 is the authoritative closure record.
- Before claiming any milestone closed, re-verify with fresh `git log --oneline -5`, `git tag --list`, `git status --porcelain=v1`. A dirty delivering branch proves not-closed.
- `m4a-accepted` and `m4a.1-accepted` must NOT be co-tagged on one commit unless dual-milestone acceptance is genuinely verified.
- Do not cite future-dated Git evidence as verified fact.

### Permanent Product Exclusions ("Will Not Build")
Strict product invariants, NOT temporary roadmap items. Any PR attempting to introduce them will be rejected:
- ✗ AI summaries / notes
- ✗ AI transcripts / speech-to-text
- ✗ AI assistants / bots
- ✗ Attention / gaze tracking
- ✗ Usage / engagement analytics
- ✗ Behavioral telemetry
- ✗ Cloud recording / server-side archiving
- ✗ Cloud transcription
- ✗ Server-side media transcoding / processing

## Delegation & Governance — PM Owns, Never Implements
- `opencode.jsonc`: `default_agent: "pm"` (` .opencode/agents/pm.md`). PM coordinates roadmap/milestones/prioritization, delegates all implementation to `@architect @frontend @backend @webrtc @security @privacy @qa @reviewer`.
- **Never approve own work.** Every feature/milestone exit requires 5 gates: Architecture (`@architect`), Security (`@security`), Privacy (`@privacy`), QA (`@qa`), Adversarial (`@reviewer`). M0-P0 gate checklist: `docs/gates/architecture-exit-checklist.md`.
- Decision log: ADRs in `docs/adr/` (ADR-001 SFU-primary, ADR-002 SFrame pivot, ADR-004 LiveKit-vs-mediasoup, ADR-005 coturn HMAC 24h, ADR-006 invitation bearer credential, ADR-007 Latch staged rename). Update `docs/architecture-brief.md` §11 for new choices.

## Repo Map
```
docs/               # authority: milestone specs + exit reports (M0-P0 … M4A), architecture-brief.md,
                    # ROADMAP.md (frozen), adr/, design/, gates/, reviews/, c4/, plans/, gaps/
poc/meet-webrtc-core/ # PWA frontend: React 18 + Vite + Zustand + LiveKit Client SDK + SFrame E2EE
  src/host/         #   M4A host control: hostControlManager, hostControlStore, hostTokenVerifier
  src/presence/     #   presence store/adapter (hostId = single source of truth)
  src/utils/        #   roomUrl.ts (invitation URLs + #k= fragment), qr.ts, identity, mutex, diagnostics
  src/layout|collaboration|devices|sframe|keys|signaling|livekit|reconnect|screen|turn|webrtc/
services/           # 3 Go 1.22 services (single main.go each, no internal packages)
  meet-signal/      #   POST /token, POST /room/create, POST /room/transfer-host, GET /room/authority,
                    #   GET /room/status, DELETE /accounts/me, WSS /signal, :9091 /metrics
  meet-sfu-manager/ #   GET /internal/sfu/assign (HRW xxhash, Redis cache, health poll 5s)
  turn-auth/        #   POST /turn/credentials (HMAC-SHA256, coturn ephemeral creds, TTL 24h)
infra/              # docker compose up: compose.yaml, Caddyfile, livekit.yaml, prometheus.yml,
                    # alert-rules.yml, grafana/
.opencode/agents/   # 8 subagents: architect, backend, frontend, webrtc, security, privacy, qa,
                    # reviewer (+ deprecated media alias)
.opencode/          # task-backend.md, task-webrtc.md, task-qa.md (PM task definitions)
qa/                 # QA reports and gate plans (histogram JSON under qa/reports/)
BACKEND_ROADMAP.md  # Go services design spec — 8 milestones, for reference
```
Root-level `README.md`, `W2_*.md`, `*_PROOF_SPRINT*.md`, `QA_Audit_Report.md` are historical sprint artifacts, not current authority — trust `docs/` over all of them.

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
npm --prefix poc/meet-webrtc-core run lighthouse   # lighthouse report against preview :4173
npm --prefix poc/meet-webrtc-core run lighthouse:ci # lhci autorun
npm --prefix poc/meet-webrtc-core run bundle:analyze # vite-bundle-analyzer on dist
npm --prefix poc/meet-webrtc-core run sframe-proof # tsx scripts/websocket-sframe-proof-runner.ts
```

### Go Services (`services/`)
Each service is a single `main.go` with no internal packages. Built via multi-stage Dockerfiles (golang:1.22-alpine → alpine:3.20, CGO_ENABLED=0, static binaries).

```bash
# Build individual services locally (not in Docker):
cd services/meet-signal && go build -o meet-signal .
cd services/meet-sfu-manager && go build -o meet-sfu-manager .
cd services/turn-auth && go build -o turn-auth .

# Run tests (both meet-signal and meet-sfu-manager have main_test.go):
cd services/meet-signal && go test -v ./...
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
| meet-signal | 8080 | `/healthz`, `/token` (POST), `/room/create` (POST), `/room/transfer-host` (POST), `/room/authority` (GET `?roomId=`), `/room/status` (GET `?roomId=` or `/room/:id/status`), `/accounts/me` (DELETE, DSR), `/signal` (WSS upgrade) |
| meet-signal | 9091 | `/metrics` (rooms/connections/messages/tokens/errors gauges+counters) |
| meet-sfu-manager | 8081 | `/healthz`, `/internal/sfu/assign?roomId=` (GET) |
| turn-auth | 8082 (host) → 8080 (container) | `/healthz`, `/metrics`, `/turn/credentials` (POST) |
| livekit | 7880 (UDP/TCP), 7881 (UDP), 9600 | `/healthz` |
| coturn | 3478 (UDP/TCP), 5349 (TLS), 443 (TCP/TLS) | host networking |
| prometheus | 9090 | `/-/healthy` |
| grafana | 3000 | `/api/health` |
| postgres | 5432 | |
| redis | 6379 | |

## Architecture Quirks (Not Obvious from Filenames)
- **Stack locked for P0:** PWA React 18 + Vite + Workbox (GenerateSW) + Zustand, LiveKit SFU pinned `v1.13.6` with `LIVEKIT_E2EE_MODE=blind`, SFrame via Encoded Transform primary + `wasm-sframe` 150KB Worker fallback (`OffscreenCanvas` + `VideoFrame` recycle, Safari 17 required), coturn 4.6 HMAC `TURN_SECRET` TTL 86400, Redis 7 pub/sub `signal:{roomId}` + presence `presence:{roomId}:{hash}` TTL 24h heartbeat 5s, Postgres 16 hash-only, MinIO, Keycloak 24.
- **Go services pattern:** Each service is a single `main.go` with all logic in one file (no `internal/`, `pkg/`, or `cmd/` subdirectories). No shared library between services — each has its own `go.mod`. Duplicated `getEnv`/`getEnvInt` helpers across services. All services listen on `PORT` env (default varies by service) and shut down gracefully on SIGTERM/SIGINT with 10s timeout.
- **meet-signal is in-memory hub (no Redis yet):** Hub uses in-memory `map[string]map[*client]struct{}` for room membership. M4A room authority (`authorityManager` / `RoomAuthority`) is also strictly in-memory (volatile) — zero disk persistence of attendee logs or room membership is an M4A invariant. `REDIS_URL` env accepted but not wired. Access-token JWTs are HS256 (shared secret); host tokens are **ES256** (server ECDSA P-256 keypair generated at startup; public key shared as `hostKey` hex). No token refresh endpoint. No OIDC yet.
- **Dual-path token issuance:** If `LIVEKIT_API_SECRET` is set, meet-signal mints LiveKit JWTs (`video` grant + role encoded in `metadata` string); if unset, it falls back to legacy mesh JWTs (`JWT_SECRET` only). Both paths are tested in `main_test.go`.
- **turn-auth has no external Go dependencies:** `go.mod` has zero `require` entries — stdlib only (`crypto/hmac`, `crypto/sha256`, `crypto/rand`). Redis audit key is a TODO stub (commented out).
- **Routing:** `roomId→SFU` is rendezvous HRW (not ring) — `h=xxhash(roomId|nodeID|salt)/weight`, single-node degenerates to one entry `SFU_NODES=livekit:7880`. Assignment cached Redis `sfu:assign:{roomId}` TTL 5m; re-hash on health fail (`/healthz` 5s). Test vector `abc123 → sfu-1` (not `sfu-2` as the design doc originally said; the code comment acknowledges the discrepancy). See `docs/architecture-brief.md` §6 and `docs/design/consistent-hashing-roomId-to-SFU.md`.
- **Latch rename — HRW stability invariant (ADR-007):** The planned rename to `latch-*` is **planning only, code authorization BLOCKED**. Phase 1 may rename compose labels (e.g., `latch-sfu-manager`) but HRW node IDs **must stay `sfu-*`** and hash salt **must stay `p0-salt-2026`** — changing either re-hashes every room to a different SFU node. Metric names (`meet_signal_*` etc.) stay unchanged during brand-only rename (no indefinite dual-emit). JWT issuer migration has a dual-issuer window (`meet-signal` + `latch-signal`) before legacy retirement. Never bundle infra renames (Keycloak realm, PG db name, TURN realm, compose project, Docker network) with user-visible branding.
- **SFrame+SFrame contradiction — honest fallback:** If header-aware Dynacast/Last-N fails (SFU cannot read payload), ship **blind-forward 3 layers** for ≤20p (Last-N=9, ~10-12 Mbps down, 80% overhead) with UI shield text “E2EE · 3-layer relay”. No silent downgrade to DTLS — explicit ⚠️ warning if SFrame unavailable. Pivot on NO-GO within 48h: mesh ≤5p + non-E2EE SFU. Read `architecture-brief.md` §8-9 before touching SFU forwarding.
- **Signaling:** `WSS /signal?v=1&room=:id&token=:jwt` JWT 5m `aud=roomId` + nonce, frames `{type: offer|answer|ice|join|leave|mute|speaking|commit|welcome}`. Stateless — no sticky sessions. Token via query param `?token=` or `Authorization: Bearer` header. Server-broadcast system messages use `participantId: "system"` (e.g. `host-changed`).
- **Coturn host networking:** `network_mode: host` in Compose (K8s DaemonSet in prod) — not behind Caddy. TURN ports `3478 UDP/TCP + 443 TCP/TLS`, media stays SFrame ciphertext.
- **Privacy invariants:** No analytics/Sentry without PII scrub, `__Host-` cookies `SameSite=Strict` only, VAPID not FCM, logs JSON sanitized (no SDP/PII/IP beyond 24h hash), bundle <120kB gz target (vite `chunkSizeWarningLimit: 120`; M4A reviewer gate ceiling ≤225kB gzip), WASM async + integrity hash, CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`.
- **Vite dev server quirks:** Dev server sets `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers (required for `SharedArrayBuffer` in WASM). Dev proxy routes `/signal`, `/token`, `/room`, `/api` to meet-signal, and `/sfu`, `/rtc`, `/turn` to their respective backends. Override targets via `VITE_HOST`, `VITE_SIGNAL_TARGET`, `VITE_SFU_TARGET`, `VITE_TURN_TARGET` (test-harness stability on Win32). Preview server binds 127.0.0.1:4173 (IPv4 only). These proxies are dev-only; production uses Caddy.
- **PWA routing scope:** `navigateFallbackAllowlist` is `/^\/r\//` — meeting URLs live under `/r/:roomId`; the "New Meeting" shortcut is `/r/new`.

## M4A Architecture — Server-Authoritative Session Control (Active)
Trust model changed in M4A from client-assertive ("I am the host") to server-authoritative ("meet-signal certifies this participant is Host"). **Invariant: no moderation action may be executed based solely on client assertions.**

- **Host identity:** Only `POST /room/create` establishes a host — `authorityManager.createRoom()` sets `RoomAuthority.HostID` server-side and mints an ES256 host token (`mintHostToken`, claims `sub/room/role/aud/iss/iat/exp`). Client creator claims (`isCreator: true`) are ignored; `POST /token` guests always get `role: "participant"`. `GET /room/status` returns `{exists, joinable, locked}` (200 with `exists:false` for unknown rooms — used by pre-join checks).
- **Host transfer:** `POST /room/transfer-host` with `Authorization: Bearer <jwt>` + body `{roomId, targetParticipantId}`. Verifies requester is current HostID, mints a new host token for the target, broadcasts `host-changed` system message (with `newHostToken` + `hostKey`) to all signal-hub peers.
- **Host grace/succession:** On host disconnect, `startHostGrace()` reserves authority for 30s; a host reconnecting within the window seamlessly resumes; expiry triggers deterministic succession (earliest-joined participant) or room purge (TTL=0).
- **Single source of truth (frontend):** `presenceStore.hostId` is authoritative for host state. `isHost = hostId !== null && hostId === localParticipantId`. `upsertParticipant`/`setLocalParticipant` lock `activeHostId = state.hostId` so incoming peer joins can never displace the host (fixes the old "disappearing host" regression). Server updates flow via `setAuthoritativeHost()`.
- **Directive verification:** `src/host/hostTokenVerifier.ts` — 7-step pipeline (structure, role=host, sub===senderId, aud===roomId, exp, freshness, ECDSA P-256 WebCrypto signature). **Gotcha:** the spec says 5s freshness window and the file header says 10s, but code enforces **60s** (`deltaMs > 60_000`) — code is current truth; check before "tightening" in tests.
- **Protected actions (require signed directive):** `mute-participant`, `remove-participant`, `spotlight-participant`, `lock-room`, `waiting-room-admit`/`reject` (plus `transfer-host`, `waiting-room-knock`). Directives carry `{action, targetParticipantId, senderId, hostToken, timestamp, nonce}`; failed verification → logged as authorization anomaly and dropped.
- **Waiting room ON by default:** `hostControlStore.isWaitingRoomEnabled: true` at init. Guests land in a lobby (`isWaitingInLobby`), knock, and are admitted/rejected explicitly by the host.
- **Display names:** mandatory, `1 ≤ len(trimmed) ≤ 64`, enforced client-side (PreJoin/Landing disable Join with "Display name is required.") and server-side (400).
- **Leave governance:** `LeaveConfirmationModal` — participants confirm exit; host with others present chooses Transfer & Leave / Leave (30s grace + succession); solitary host leaves immediately, room state purged.
- **Invitations (M4A.1, ADR-006):** `src/utils/roomUrl.ts` builds `https://<domain>/r/<roomId>#k=<key>` — the 256-bit SFrame epoch key seed lives in the URL **fragment**, which is never sent to servers (RFC 3986 §3.5). Possession of the full URL == decryption capability; admission is still gated by waiting room + signaling auth. `ROOM_ID_REGEX = /^[a-z0-9-]{6,64}$/i`. Strictly no UTM/tracking params. QR codes via `src/utils/qr.ts`; invite UI in `InviteModal`.
- **Client room-creation fallback:** `src/auth/token.ts` `createRoom()` POSTs `/room/create` and **silently falls back to `/token`** if the endpoint fails (older backend). Watch for this when debugging "guest joined a host-less room".

## Go Service Implementation Details

### meet-signal (`services/meet-signal/main.go`)
- **Dependencies:** `golang-jwt/jwt/v5`, `google/uuid`, `gorilla/websocket`
- **POST /room/create:** Body `{name, roomId?}` (name required, trimmed, ≤64 chars; roomId auto-generated `room-<uuid[:12]>` if empty; 409 on room exists). Registers `RoomAuthority`, assigns `role: "host"`, mints ES256 host token, returns LiveKit or legacy token + `hostToken` + `hostKey` hex.
- **POST /token:** Guest path — `{roomId, name}` → `role: "participant"`; never mints a host token. Server-assigned `participantId` (`p-<uuid[:8]>`) can't be spoofed.
- **WSS /signal:** Validates JWT, enforces `room` param matches token `aud`. In-memory hub with join/leave/relay. `client` wraps `gorilla/websocket.Conn` with a mutex for writes.
- **Authority endpoints:** `POST /room/transfer-host` (Bearer auth, host-only, 403 otherwise), `GET /room/authority?roomId=` (404 if unknown), `GET /room/status` (never 404 — returns `exists:false`), `DELETE /accounts/me` (DSR stub per D-033; stateless today).
- **Metrics (:9091):** `meet_signal_info`, `meet_signal_rooms_active`, `meet_signal_connections_active`, `meet_signal_messages_total`, `meet_signal_tokens_issued_total`, `meet_signal_errors_total`.
- **Tests (`main_test.go`, 10):** LiveKit + legacy claims structure, token TTLs, video grant fields, JWT/LiveKit secret validation, M4A authority role assignment, creator-claim forgery rejection, host transfer, ES256 host token minting, room status endpoint.
- **No persistence:** No Redis/Postgres wired in yet despite env vars in compose.

### meet-sfu-manager (`services/meet-sfu-manager/main.go`)
- **Dependencies:** `cespare/xxhash/v2`, `redis/go-redis/v9`
- **GET /internal/sfu/assign?roomId=:** HRW hash across `SFU_NODES` (comma-separated). Checks Redis cache `sfu:assign:{roomId}` first. On cache miss, computes HRW and caches result for 300s. On health fail, invalidates cached assignments for the unhealthy node.
- **Health poll:** Background goroutine every 5s hits `http://{host}:9600/healthz` for each SFU node. Port is always rewritten to 9600 (LiveKit health port) regardless of the address port in `SFU_NODES`.
- **SFU_NODES parsing:** If an entry has no hyphen, it gets an auto-generated ID `sfu-{index}`. Address is kept as-is (e.g., `livekit:7880`).
- **Tests (`main_test.go`, 4):** rendezvous HRW (vector `abc123 → sfu-1`), single-node degenerate, load weighting, minimal movement.

### turn-auth (`services/turn-auth/main.go`)
- **Dependencies:** None (stdlib only)
- **POST /turn/credentials:** Accepts `{roomId, participantHash}` (participantHash optional). Returns `{username, credential, ttl, urls}`. Username format: `{expiry}:{userHash}`. Credential: `base64(HMAC-SHA256(TURN_SECRET, username))`. TTL from `TURN_TTL` env (default 86400).
- **Strict JSON:** `DisallowUnknownFields()` on decoder, `Content-Type: application/json` enforcement, 1KB body limit.
- **Sanitized logging:** Only logs first 8 chars of userHash prefix, never logs TURN_SECRET or raw credential.
- **Redis audit TODO:** Redis audit key insertion is a code comment stub — not yet implemented.

## Testing & Validation — What QA Expects
- **Unit (frontend):** `vitest run` — jsdom, `globals: true`, setup `tests/setup.ts`, includes `tests/**/*.test.{ts,tsx}`. Config lives in **`vitest.config.ts`** (separate from vite.config.ts). Coverage → `qa/reports/coverage`. ~207 tests across ~30 files at M4A exit; M4A QA gate requires ≥215 tests with zero M0–M3B regressions.
- **Test naming convention:** `m{milestone}-{domain}-*.test.ts(x)` (e.g. `m2-host-store`, `m3b-subscription-manager`, `m4a-authoritative-host`). Follow it for new milestones. Spec test IDs (e.g. `M4A-SEC-09`, `M4A-UX-06`) map to acceptance matrices — cite them in test names/comments.
- **Browser E2E:** `playwright test` (`tests/e2e/*.spec.ts`, `playwright.config.ts` with webServer) — skips until `npx playwright install` is run.
- **Load harness:** `poc/meet-webrtc-core/scripts/load-test.ts` + `tests/test-vectors.ts` (20p vectors, HRW test `abc123 → sfu-1` per code, SFrame ciphertext vectors). Synthetic load via `livekit load tester` equiv.
- **QA artifacts:** histograms not just pass: `qa/reports/key-rotation-latency.json` (p95 ≤500ms, 20 trials), `qa/reports/reconnect-latency.json` (p95 ≤5s, 10 trials/browser), `qa/reports/browser-matrix.html`, `qa/reports/lighthouse/*.json`.
- **TURN proof:** force `iceTransportPolicy: relay` + `iptables -p udp --dport 3478 -j DROP`, verify `candidateType=relay` in `chrome://webrtc-internals` + `turn_allocations_active` in Prometheus. Wireshark `rtp && sframe` must show no plaintext NALs.
- **Perf budgets:** Lighthouse CI gate ≥95 perf/accessibility/best-practices, TBT <200ms CLS 0, simulcast 3×2 (180p 300k/360p 800k/720p 1.8M) + Opus, VP9 SVC preferred H264 baseline fallback. Production build ≤225kB gzip main bundle (M4A reviewer gate).

## Operational Gotchas
- `infra/compose.yaml` env defaults: `PG_PASSWORD=p0-dev-pass`, `TURN_SECRET=p0-turn-secret-0123456789abcdef0123456789`, `LIVEKIT_API_KEY=dev` — not prod. `livekit.yaml` + `Caddyfile` are local TLS `internal` self-signed; prod uses Ingress-Nginx + cert-manager (see `docs/c4/p0-context.md`).
- `JWT_SECRET` must be ≥32 bytes or meet-signal exits at startup. `LIVEKIT_API_SECRET` optional (dual-path); if set must be ≥32 chars.
- WASM build needs `wasm-pack` installed locally; without it SFrame falls back to DTLS-only warning.
- `pnpm meet-load` in compose comments vs `npm` in poc — both run same `tsx` harness; prefer `npm --prefix poc/meet-webrtc-core` for consistency.
- All Redis/PG rows TTL 24h (rooms 24h post-end) — GC hourly; no media in PG.
- **Go services: turn-auth has no `go.sum`** — it has zero dependencies (stdlib only), so its Dockerfile only copies `go.mod`. meet-signal and meet-sfu-manager both have `go.sum` files. Don't add external deps to turn-auth without updating its Dockerfile to include `go.sum`.
- **Vite dev COOP/COEP headers:** Required for `SharedArrayBuffer` (needed by WASM workers). If shared memory doesn't work in dev, check these headers are present.
- **Playwright tests skip if browsers not installed:** `npx playwright install` required before `test:browser`.
- The working tree carries uncommitted M4A/M4A.1 deliverables (host token verifier, invitations, leave modal, meet-signal authority endpoints, new tests). Do not assume HEAD == shipped M4A; check `git status` before bisecting behavior.
- `qa/reports/not-readable-error-plan.md` is intentionally untracked — preserve it.
