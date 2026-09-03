# PM Directive — W1 Critical Path: Make `compose up` Work (NO-GO Freeze)
**PM:** muse-spark-1.2-contributor-free | **Date:** 2026-09-01 | **Mode:** COORDINATOR (never implements large features)
**Authority:** docs/M0-P0.md (ACTIVE — FREEZE, 10 criteria + 5 gates), docs/architecture-brief.md v0.2.0-p0, docs/gates/architecture-exit-checklist.md, AGENTS.md delegation
**Status:** NO-GO confirmed — Lock organization on W1 Goal: `docker compose up --build --wait` returns green with barebones services
**Hard Constraint:** `docker compose -f infra/compose.yaml up --build --wait` must be green — meet-signal, meet-sfu-manager, turn-auth existing, building, starting, publishing /healthz with no business logic. Freeze exactly as stands until criteria #3 and #4 are green.

---

## 1. Situation & Decision
QA Audit 2026-08-31 shows 7 P0-blocking gaps + 3 warnings: all 10 criteria amber/red except #3/#10 design. PM assessment: **NO-GO. Do not build Zoom-style features.** W1 critical path is barebones infra + evidence, not feature depth. Five gates required before merge: Architecture @architect, Security @security, Privacy @privacy, QA @qa (p0-gate-verify), Adversarial @reviewer. PM never approves own work.

## 2. W1 Goal (Single Command)
```
docker compose -f infra/compose.yaml up --build --wait
curl -f http://localhost:8080/healthz && curl -f http://localhost:8081/healthz && curl -f http://localhost:9600/healthz
curl -f http://localhost:9090/-/healthy && curl -f http://localhost:3000/api/health
```
All healthz 200 + Prometheus scrapes visible in Grafana livekit_rooms_active/sfu_load. Current infra/compose.yaml already defines PG16/Redis7/MinIO/Keycloak24/coturn+turn-auth/livekit1.25 2 vCPU/meet-signal/meet-sfu-manager/prometheus/grafana/caddy. Gap: services/ missing → W1 scaffold fills it.

## 3. RED Items — Immediate Burn Down
### RED #9 PWA Shell (Criterion #9 Lighthouse ≥95, bundle <120kB gz + WASM 150KB async)
**Gap:** Lack verified Vite scaffold, Workbox, Manifest, Lighthouse evidence. qa/reports/lighthouse/*.json missing.
**Delegate @frontend:** Vite 5 + React 18 + Workbox GenerateSW, manifest.webmanifest (icons 72-512 maskable, display standalone, theme_color), offline shell + SW, bundle budget enforcement, lighthouserc.json, TBT<200ms CLS 0. Allowed UX only: landing → /r/:id#k= → pre-join preview → grid Last-N=9 → mute/cam/leave + screen share + shield. No frozen UX.
**Status:** ✅ Frontend scaffold delivered: vite.config.ts + VitePWA + 65.8kB gz (under 120kB), public/manifest.webmanifest + sw.js + offline.html + icons, lighthouserc.json, src pages (Landing/PreJoin/Meeting) + VideoGrid/VideoTile/ControlBar/ShieldBadge. **Remaining QA:** `npm run wasm:build` (wasm-pack), `npx lhci` → qa/reports/lighthouse/*.json, `npm run test:browser` 4-browser matrix.

### RED #10 Privacy Zero Telemetry (Criterion #10)
**Gap:** No data inventory, retention rules, deletion enforcement, CSP enforcement → "Zero telemetry" unproven.
**Delegate @privacy + @security:** Data inventory table, ROPA Art.30, retention TTLs (Redis 24h/PG 24h/TURN 24h), DSR DELETE /accounts/me + GET /data-inventory, zero-telemetry statement, CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'` enforcement.
**Status:** ✅ Privacy findings filed (13 findings: F-01 critical inventory missing → fixed via this W1 scaffold docs/privacy-inventory.md, F-02 DSR missing W2, F-03 statement draft, F-04 CSP not enforced, F-05 Google Fonts third-party, F-06 UA sniffing). Security findings filed (9 findings: SEC-001 CSP not deployed, SEC-002 WASM placeholder, SEC-006 turn-auth HMAC missing). **Scaffold fix:** docs/privacy-inventory.md created (D-1..D-12, retention checklist, ROPA stub, DSR spec, CSP target). **Remaining W2:** Caddyfile CSP header + index.html meta, self-host fonts, WASM integrity CI inject, privacy-scan script, turn-auth POST /turn/credentials.

## 4. Directives for Specialized Subagents (Immediate)
### @qa Must Create docs/M0-P0-risk-register.md
**Status:** ✅ Delivered 2026-09-01 — 5 risks tracked:
1. Safari SFrame incompatibility (R, 4-browser matrix #1/#4, blind-forward 3-layer Last-N=9 80% overhead, Wireshark proof, pivot mesh ≤5p) — @webrtc/@frontend
2. TURN cost escalation (A, #8, HMAC 86400 + Redis rate-limit, prom alert 80%/>5GB/day) — @security/@ops
3. Client decrypt overload (Y, #2/#3, 27-stream 65% throttle, 15ms WASM, Last-N=9) — @frontend/@security
4. Lighthouse regressions (G, #9, bundle 120kB + WASM 150kB gate, daily Lighthouse slow-4G) — @frontend/@qa
5. Redis scaling (R, #3/#2, 50rooms×20p, TTL 24h hourly GC, maxmemory lru, used_memory >80% alert) — @backend
Burn-down tracker daily RAG + freeze clause. Links to criteria & gate checklist.

### @reviewer Must Enforce Benchmark Challenge (20p 27-stream decrypt)
**Status:** ✅ Challenge filed 2026-09-01 — docs/M0-P0-benchmark-challenge.md produced:
- **Contradiction:** Blind-forward 3 layers forces 27 decrypts/subscriber (9×3, 57 worst full-grid) → client receives 27 SFrame streams, must decrypt all to select layer. Existing load-test.ts only checks SFU CPU, not client decrypt.
- **Spec:** 20p ×10min stable, VP9 SVC/H264, simulcast 3×2, WASM 15ms/frame budget, 810 decrypts/sec.
- **Metrics per browser (Chrome/Edge/Firefox/Safari macOS+iOS PWA):** CPU main+worker <70%, memory <500MB, dropped <1% (<2% per stream), decode p95<30ms, decrypt p95<15ms, e2e p50≤150 p95≤300, TBT<200ms, thermal throttle = FAIL.
- **Pass:** All 4 browsers must pass all thresholds simultaneously 10min. Any 2+ browser FAIL → NO-GO Option A mesh-E2EE ≤5p + non-E2EE SFU >5 explicit consent (Option B 1:1 only, Option C mediasoup). 48h pivot @architect+@webrtc+@reviewer.
- Artifacts: qa/reports/decrypt-latency-*.json, dropped-frames-*.json, memory-*.json, cpu-*.json, 27-stream-decrypt-benchmark.json
Challenge is adversarial gate — not spec, demands measurement. Honest E2EE: no facade (Wireshark ciphertext required).

## 5. W1 Critical Path Delegation (@backend) — Barebones /healthz
**Delegate @backend:** Meet-signal (8080 healthz + 9091 /metrics stub), meet-sfu-manager (8081 healthz), turn-auth (8080→8082 healthz) — Go 1.22, multi-stage alpine, wget healthcheck, graceful shutdown, no Redis/PG dependency for /healthz, no business logic.
**Status:** ✅ Services created:
- services/meet-signal/{go.mod,main.go,Dockerfile} — 200 JSON {"status":"ok","service":"meet-signal"} on /healthz, /metrics stub Prometheus
- services/meet-sfu-manager/{go.mod,main.go,Dockerfile} — 200 on /healthz
- services/turn-auth/{go.mod,main.go,Dockerfile} — 200 on /healthz
Verification (Docker host):
```
docker compose -f infra/compose.yaml up --build --wait
curl -f http://localhost:8080/healthz  # {"status":"ok","service":"meet-signal"}
curl -f http://localhost:8081/healthz  # {"status":"ok","service":"meet-sfu-manager"}
curl -f http://localhost:8082/healthz  # {"status":"ok","service":"turn-auth"}
curl -f http://localhost:9600/healthz  # livekit
curl -f http://localhost:9091/metrics  # meet-signal stub
```
No JWT/Redis/HRW/HMAC logic — scaffold only per M0-P0 W1. Next: @backend W2 adds WSS/JWT + HRW + TURN HMAC under freeze guard.

## 6. Architecture Freeze Gate (@architect) — Maintain Freeze Until #3+#4 Green
**Delegate @architect:** Enforce freeze exactly per M0-P0 §2/§4 until #3 and #4 GO.
**Status:** ✅ Architecture Gate Statement filed 2026-09-01 — NOT SELF-APPROVED, REVIEW REQUIRED:
- **FROZEN:** breakouts/polls/reactions/whiteboard/virtual bg/captions/RNNoise/recording meet-composer/webinar 100-1000 HLS/anon k# / P2P↔SFU handoff/WebTransport/cascaded mesh/K8s autoscale/analytics dashboards — PR feature:not-p0 auto-rejected, merge needs p0-gate-verify +5 approvals.
- **Allowed:** landing → /r/:id#k= → pre-join → grid Last-N=9 → mute/cam/leave+screen share+shield only.
- **ADR-004 LiveKit vs mediasoup GO stands** for W1 barebones (review required, mediasoup as Option C pivot only).
- **#3 Green proves:** compose up + 4×curl healthz + grafana livekit_rooms_active/sfu_load/turn_allocations_active + HRW vector abc123→sfu-2 + Redis signal:{roomId}/presence TTL 24h + sfu:assign TTL 5m + Helm parity.
- **#4 Green proves:** qa/reports/wireshark-livekit-sframe.pcapng filter `rtp && sframe` shows KID/CTR + ciphertext no plaintext NALs, SFU blind-forward 3 layers Last-N=9 10-12Mbps down 80% overhead with shield "E2EE · 3-layer relay" explicit ⚠️ if unavailable, no silent DTLS downgrade.
Pivot if #3/#4 fail (48h): §9 honest downgrade blind-forward shipped not facaded; if even that fails (CPU>70% loss>1% p95>300) → Option A mesh ≤5p + non-E2EE SFU.

## 7. 5-Gate Coordination (PM never approves own work)
| Gate | Reviewer | Bar | Artifact | RAG |
|------|----------|-----|----------|-----|
| Architecture | @architect + @reviewer | brief+C4+ADRs+hash+pivot | architecture-brief.md v0.2.0-p0 + gates checklist | 🔴 REVIEW REQUIRED (statement filed, needs signatures) |
| Security | @security | STRIDE 8 +5 conditions no HIGH open | CSP + WASM integrity + TURN audit | 🔴 2 HIGH (SEC-001 CSP, SEC-002 WASM) → W2 fix |
| Privacy | @privacy | minimization+GDPR+DSR+ROPA+zero-telemetry | docs/privacy-inventory.md (scaffold) + scan | 🔴 F-01 fixed scaffold, F-02/03/04 W2 → sign W3 |
| QA | @qa | all 10 reproducible p0-gate-verify | risk-register + benchmark challenge + test plan | 🔴 risk-register ✅ but 7 P0-blocking artifacts missing (QA_Audit_Report.md) → W2-W3 load/histograms/Lighthouse/Wireshark |
| Adversarial | @reviewer | SFrame+SFU/TURN cost/Safari gaps honest E2EE | 27-stream decrypt challenge | 🟡 Filed → awaiting @webrtc/@qa benchmark response |

Merge to main blocked until p0-gate-verify +5 signatures. Daily 15-min P0 burn-down (criteria RAG), weekly PM RAG publish.

## 8. Immediate Next Actions (This Week) — Copy of M0-P0 §11 scoped to W1
1. @backend — DONE scaffold; NEXT W1 EOD: verify docker compose config + `npm --prefix poc/meet-webrtc-core test` HRW vector; W2 implement JWT 5m aud=roomId + Redis pub/sub.
2. @webrtc — Start meet-webrtc-core POC, LiveKit+Dynacast vs SFrame interop test by W1 (blind-forward contract confirmed).
3. @frontend — DONE PWA shell scaffold; NEXT W2: CSP header in Caddyfile + meta, self-host fonts, WASM integrity inject, Lighthouse CI.
4. @security/@privacy — Threat model + minimization PR by W1 DONE (findings filed) → CSP+DSR endpoint by W2.
5. @qa — DONE risk-register + audit; NEXT W1-W2: docs/qa/m0-p0-test-plan.md + Playwright matrix + load harness + histograms.
6. @reviewer — DONE 27-stream challenge; NEXT adjudicate benchmark W3.

## 9. What Remains RED Until #3/#4 Green
- Criterion #3 not green → infra parity unproven → no frozen feature may start.
- Criterion #4 not green → E2EE opaque unproven → no claim "E2EE 20p" → honest fallback text required.
- Criterion #9 not green → Lighthouse evidence missing → @frontend/#9 W2.
- Criterion #10 not green → CSP/zero-telemetry not enforced → @privacy W2.
W2 dry run GO/NO-GO checks #3/#4 pcaps. If NO-GO on any trigger (Safari SFrame impossible, 20p+SFrame contradiction, rotation p95>500, reconnect p95>5s, Lighthouse<95, TURN leak) → 48h pivot proposal.

*End of W1 Directive — PM delegates, never implements. All work tracked under 5 gates. Next publish: W1 EOD compose up green proof (curl outputs + grafana screenshot + HRW test pass).*
