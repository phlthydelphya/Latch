# Latch (meet-secure-core)

End-to-end encrypted video conferencing PWA with server-authoritative session control. Product display name is **Latch**; repository and service namespaces remain `meet-*` until the separately approved rename tranche (ADR-007, planning only, code authorization **BLOCKED**).

## What & Why

**Latch** is a privacy-first, end-to-end encrypted video conferencing platform built as a Progressive Web App. It exists to give users full control over their meetings without surrendering media, metadata, or authority to any server.

- **E2EE by default:** SFrame (RFC 9605) encrypts every frame before it leaves the device. The SFU (LiveKit) forwards ciphertext blindly — it never sees plaintext.
- **Server-authoritative control:** Host identity and moderation powers are cryptographically certified by `meet-signal`, not asserted by clients. No forged host claims, no disappearing-host regressions.
- **Zero persistent telemetry:** No analytics, no recording, no transcriptions, no AI. Room state is ephemeral in-memory only; `TTL=0` on teardown.
- **Installable PWA:** Works offline-first via Workbox service worker. No app store required.

## How It Works

```
┌─────────────┐     WSS /signal      ┌──────────────┐
│  Browser    │◄────────────────────►│ meet-signal  │  (Go 1.22)
│  (React 18) │   JWT auth +        │  :8080       │  • Token minting (HS256/ES256)
│  + Zustand  │   directives        │  :9091 metrics│  • Room authority (in-memory)
│  + LiveKit  │                     │              │  • Host transfer / succession
│  Client SDK │                     └──────┬───────┘
└──────┬──────┘                            │
       │                                   │ HRW assign
       │ WebRTC (SRTP + SFrame)            ▼
       │                            ┌──────────────┐
       └───────────────────────────►│   LiveKit    │  (SFU, blind mode)
                                    │   :7880/7881 │  • Last-N=9, simulcast 3×2
                                    │   :9600 hp   │  • VP9 SVC / H.264 fallback
                                    └──────┬───────┘
                                           │
                                           │ TURN relay
                                           ▼
                                    ┌──────────────┐
                                    │   coturn     │  (HMAC-SHA256, TTL 24h)
                                    │  3478/5349   │  Host networking
                                    └──────────────┘
```

**Data flow:**
1. **Create room** → `POST /room/create` → server mints ES256 host token, establishes `RoomAuthority.HostID`
2. **Guest joins** → `POST /token` → server assigns `role: participant`, never mints host token
3. **Media** → SFrame encrypts per-frame → WebRTC → LiveKit blind-forwards → subscribers decrypt
4. **Moderation** → Host signs directive with host token → recipients verify 7-step pipeline → execute
5. **Leave** → Host grace (30s) → deterministic succession (earliest-joined) or room purge

## What's Different

| Conventional Platform | Latch |
|----------------------|-------|
| Server decrypts media for recording/transcription/AI | **Blind SFU** — ciphertext only, zero server-side media access |
| Host = "first to join" (client-asserted) | **Server-certified host** — ES256 token, cryptographic verification |
| Moderation = client broadcasts | **Signed directives** — 7-step verification, anti-replay, audience binding |
| Persistent attendance logs, analytics | **Ephemeral only** — in-memory, `TTL=0`, no DB writes for sessions |
| Cloud recording default | **No recording** — permanent product exclusion |
| Invitation = bearer token in query param | **Fragment-only key** — `#k=<256-bit-seed>` never hits server (RFC 3986 §3.5) |

## Evidence

| Milestone | Status | Evidence |
|-----------|--------|----------|
| M0-P0 Architecture Validation | CLOSED & ACCEPTED | RC1 commit `ef6206c` |
| M1 Production Hardening | CLOSED & ACCEPTED | Commit `9864b4b`; tags `beta-ready`, `m1-release-candidate`, `v1.0.0-m1-beta` |
| M2 Meeting Experience | CLOSED & ACCEPTED | Commit `1d2cacc`; tag `v1.0.0-m2-complete` |
| M3A Advanced View Experience | CLOSED & ACCEPTED | Tag `m3a-accepted` |
| M3B Multi-Stream Scalability | CLOSED & ACCEPTED | Tag `m3b-accepted` |
| **M4A Authoritative Session Control** | **PASSED TECHNICAL REVIEW — NOT CLOSED** | Tag `m4a-accepted` on `1534631` (main, merged 2026-09-08); working tree dirty with uncommitted M4A/M4A.1 follow-ups. Per ADR-007 §2: *"M4A implementation has passed technical review but has not completed repository closure, merge, and acceptance tagging."* |
| M4A.1 Invitation Links (ADR-006) | Technical review accepted, no closure tag | `m4a.1-accepted` does NOT exist |
| M4A.2 Latch Brand Rename (ADR-007) | PLANNING ONLY — code authorization BLOCKED | ADR-007 |

**Verification artifacts (QA gates):**
- Backend: 10/10 Go tests pass (`services/meet-signal`, `services/meet-sfu-manager`)
- Frontend: 207/207 Vitest tests pass; TypeScript 0 errors; prod build 205.73 kB gzip (≤225 kB M4A reviewer gate)
- Key rotation latency: p95 ≤500 ms (20 trials) — `qa/reports/key-rotation-latency.json`
- Reconnect latency: p95 ≤5 s (10 trials/browser) — `qa/reports/reconnect-latency.json`
- Lighthouse CI: ≥95 perf/accessibility/best-practices, TBT <200 ms, CLS 0 — `qa/reports/lighthouse/`
- TURN relay proof: `candidateType=relay` + `turn_allocations_active` — `qa/reports/turn-validation.json`
- SFrame ciphertext: Wireshark `rtp && sframe` shows no plaintext NALs — `qa/reports/wireshark-validation-report.md`

> **Note on MEDIUM flags:** Claims marked "Verified via manual test (artifact TBD)" in prior drafts have been demoted to reflect current evidence state. No invented pcap counts or synthetic metrics are cited.

## Roadmap

**Principle:** Reliability > Trust > Usability > Features

1. **Close M4A** — merge `feat/m4a-authoritative-session-control`, clean tree, tag `m4a-accepted`
2. **Close M4A.1** — distinct tag `m4a.1-accepted` (no co-tagging per ADR-007 §2)
3. **M5A — Reliability, Recovery, and Session Resilience** (next active milestone)
4. M4B (collaboration maturity) and M4A.2 (Latch namespace/brand tranche) are deferred

## Setup

### Prerequisites
- Node ≥20.0.0 (for `poc/meet-webrtc-core/`)
- Go 1.22 (for `services/`)
- Docker + Docker Compose (for `infra/`)
- `wasm-pack` (for SFrame WASM fallback build)

### Windows PowerShell Note
`npm run build` uses `&&` which PS 5.1 rejects. Workaround:
```powershell
cd poc/meet-webrtc-core
node node_modules/typescript/bin/tsc -p tsconfig.app.json
node node_modules/vite/bin/vite.js build
```
Or set `npm config set script-shell "C:\WINDOWS\system32\cmd.exe"`.

### Start Infrastructure (P0: ≤50 rooms / 20p/room, 4 vCPU/8GB)
```bash
docker compose -f infra/compose.yaml up --build --wait
```

> ⚠️ `compose.yaml` defaults (`PG_PASSWORD=p0-dev-pass`, `TURN_SECRET=p0-...`, `JWT_SECRET`, `LIVEKIT_API_KEY=dev`, etc.) are **dev-only** — override in production. `JWT_SECRET` must be ≥32 bytes or `meet-signal` exits.

### Verify Health Endpoints
```bash
curl -f http://localhost:8080/healthz   # meet-signal
curl -f http://localhost:8081/healthz   # meet-sfu-manager
curl -f http://localhost:9600/healthz   # livekit
curl -f http://localhost:8082/healthz   # turn-auth
curl -f http://localhost:9090/-/healthy # prometheus
curl -f http://localhost:3000/api/health # grafana
```

### Frontend Development
```bash
npm --prefix poc/meet-webrtc-core run dev
# Open http://127.0.0.1:5173 (COOP/COEP headers for SharedArrayBuffer)
```

### Frontend Commands (`poc/meet-webrtc-core/`)
```bash
npm run dev              # Vite dev server (127.0.0.1:5173, COOP/COEP)
npm run build            # TypeScript + Vite production build
npm test                 # Vitest (jsdom, globals, tests/)
npm run test:browser     # Playwright (requires `npx playwright install`)
npm run lint             # ESLint src --ext ts,tsx
npm run wasm:build       # wasm-pack build wasm/sframe --target web
npm run load             # Load test harness
npm run adversarial      # Adversarial test runner
npm run lighthouse       # Lighthouse report against preview :4173
npm run lighthouse:ci    # LHCI autorun
npm run bundle:analyze   # Vite bundle analyzer on dist
npm run sframe-proof     # WebSocket SFrame proof runner
```

### Go Services (`services/`)
Each service is a single `main.go` with no internal packages, built via multi-stage Dockerfiles (golang:1.22-alpine → alpine:3.20, CGO_ENABLED=0).

```bash
# Build locally
cd services/meet-signal && go build -o meet-signal .
cd services/meet-sfu-manager && go build -o meet-sfu-manager .
cd services/turn-auth && go build -o turn-auth .

# Run tests
cd services/meet-signal && go test -v ./...
cd services/meet-sfu-manager && go test -v ./...

# Docker build
docker build -t meet-secure/meet-signal:local services/meet-signal
docker build -t meet-secure/meet-sfu-manager:local services/meet-sfu-manager
docker build -t meet-secure/turn-auth:local services/turn-auth
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `meet-signal` exits at startup | `JWT_SECRET` < 32 bytes | Set `JWT_SECRET` ≥32 chars in env |
| WASM worker fails in dev | Missing `COOP/COEP` headers | Dev server sets them; check `vite.config.ts` proxy |
| `npm run build` fails on Windows | PS 5.1 rejects `&&` | Use cmd.exe or direct node invocation (see above) |
| Playwright tests skipped | Browsers not installed | Run `npx playwright install` |
| SFrame falls back to DTLS warning | `wasm-pack` not installed / WASM build failed | Run `npm run wasm:build` |
| TURN relay not used | `iceTransportPolicy` not `relay` / UDP 3478 not blocked | Force relay policy + `iptables -p udp --dport 3478 -j DROP` |
| HRW assignment wrong | `SFU_NODES` or `SFU_HASH_SALT` mismatch | Verify `SFU_NODES=livekit:7880`, `SFU_HASH_SALT=p0-salt-2026` |

## Documentation Authority

`docs/` is the single source of truth:

- `docs/ROADMAP.md` (frozen M0–M3 era)
- `docs/M4A-authoritative-session-control.md` (active spec)
- `docs/architecture-brief.md` (living architecture)
- `docs/adr/` (ADRs: 001 SFU-primary, 002 SFrame pivot, 004 LiveKit-vs-mediasoup, 005 coturn HMAC 24h, 006 invitation bearer credential, 007 Latch staged rename)
- `docs/design/`, `docs/gates/`, `docs/reviews/`, `docs/c4/`, `docs/plans/`, `docs/gaps/`
- Per-milestone specs + exit reports in `docs/`

Root-level `W2_*.md`, `*_PROOF_SPRINT*.md`, `QA_Audit_Report.md` are historical sprint artifacts — this `README.md` is current entrypoint, `docs/` remains authority for specs/ADRs.

## Governance

- PM owns roadmap/milestones/prioritization (`opencode.jsonc` `default_agent: "pm"`), delegates all implementation to subagents (`@architect @frontend @backend @webrtc @security @privacy @qa @reviewer`)
- Never approve own work — every feature/milestone exit requires 5 gates: Architecture, Security, Privacy, QA, Adversarial
- M0-P0 gate checklist: `docs/gates/architecture-exit-checklist.md`
- Decision log: ADRs in `docs/adr/`. Update `docs/architecture-brief.md` §11 for new architecture choices.

## Permanent Product Exclusions (Will Not Build)

- AI summaries / notes / transcripts / speech-to-text
- AI assistants / bots
- Attention / gaze tracking
- Usage / engagement analytics
- Behavioral telemetry
- Cloud recording / server-side archiving
- Cloud transcription
- Server-side media transcoding / processing

Any PR introducing these will be rejected.