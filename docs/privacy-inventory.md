# Privacy Inventory — M0-P0 Zero Telemetry (DRAFT W1 Scaffold)
**Status:** DRAFT — Pending @privacy + @security sign-off | **Owner:** PM delegated via @privacy findings | **Date:** 2026-09-01
**Authority:** docs/M0-P0.md §3 #10, docs/architecture-brief.md §1/§10, docs/gates/architecture-exit-checklist.md Privacy gate (F1-F4, F6)

> This scaffold unblocks W1 "Make compose up work" by creating the canonical file referenced in 6+ docs. Full ROPA + DSR spec expands in W2. Privacy gate remains 🔴 until CSP enforced + zero-telemetry statement signed.

## 1. Zero Telemetry Statement (Draft for sign-off — see @privacy Finding F-03)
> I, @privacy, will confirm M0-P0 implements zero persistent telemetry: no analytics SDK, no tracking cookies (only __Host- Strict 5m JWT), no localStorage tracking keys, VAPID not FCM, logs sanitized (no SDP/PII/IP beyond 24h hash), 24h TTL ephemeral Redis/PG, CSP default-src 'none' blocks 3rd-party. Exclusions: Google Fonts self-host by W2, console.log stripped prod. Signature: ________ Date: ________ Verdict: ☐ APPROVED

## 2. Data Inventory (Minimization Table)
| # | Data Type | Collection | Purpose | Legal Basis | Storage | Retention | Deletion | Minimized |
|---|-----------|------------|---------|-------------|---------|-----------|----------|-----------|
| D-1 | roomId | URL hash #k= | Room routing | Art.6(1)(b) | sessionStorage / PG | Session / 24h | Tab close / PG GC hourly | ✅ hash |
| D-2 | participantId hash | JWT sub | Presence | Art.6(1)(b) | sessionStorage / Redis presence:{roomId}:{hash} | Session / 24h | TTL expiry | ✅ hash |
| D-3 | JWT 5m aud=roomId nonce | OIDC PKCE | Auth | Art.6(1)(b) | sessionStorage / stateless | 5m | Expiry | ✅ |
| D-4 | keyParam #k= | URL hash | SFrame HKDF | Art.6(1)(b) | sessionStorage client-only never server | Session | Tab close/zeroize | ✅ |
| D-5 | SFrame epoch secrets | KeyManager CryptoKey | E2EE | Art.6(1)(b) | In-memory only | Session | zeroizeKey() on leftAt | ✅ |
| D-6 | WebRTC stats | getStats() | QA metrics | Legitimate interest | In-memory MetricsCollector | Session | reset()/destroy() | ✅ no PII |
| D-7 | TURN HMAC allocation | coturn | NAT traversal | Art.6(1)(b) | Redis TTL 86400 | 24h | TTL GC | ✅ hash |
| D-8 | rooms/participants PG rows | PG | Lifecycle | Art.6(1)(b) | PG16 | 24h post-end | hourly GC | ✅ hash |
| D-9 | Presence heartbeat 5s | Redis | Presence | Art.6(1)(b) | Redis EX 86400 | 24h | TTL | ✅ |
| D-10 | sfu:assign cache | Redis | room→SFU HRW | Art.6(1)(b) | Redis EX 300 | 5m | TTL | ✅ |
| D-11 | Prometheus metrics | /metrics | RED monitoring | Legitimate interest | Prometheus TSDB | Configurable | retention | ✅ no PII |
| D-12 | JSON logs | Loki | Debug | Legitimate interest | Loki sanitized | 24h | rotation | ✅ no SDP/IP |

## 3. Retention Enforcement (W1 scaffold — verify live W2)
| Store | TTL | Enforcement | Verified |
|-------|-----|-------------|----------|
| Redis presence | 24h | EX 86400 | ⬜ redis-cli TTL check |
| Redis sfu:assign | 5m | EX 300 | ⬜ |
| Redis signal buffer | 30s | EX 30 | ⬜ |
| PG rooms | 24h post-end | expires_at + hourly GC cron | ⬜ scaffold only — no GC yet |
| TURN allocations | 24h | TURN_SECRET TTL 86400 | ⬜ force relay test |
| Logs | 24h | Loki retention | ⬜ |
| sessionStorage | Session | browser | ✅ |

Enforcement commands: `redis-cli KEYS "presence:*" | xargs redis-cli TTL {}; psql -c "SELECT id, expires_at FROM rooms WHERE expires_at < NOW();"`

## 4. ROPA (GDPR Art.30) — Stub
- **Controller:** meet-secure self-host deployer (single compose). No cross-border transfer in P0 single host.
- **Purposes:** Conferencing only (join/publish/subscribe/screen share) — no analytics, no marketing.
- **Data subjects:** Participants (ephemeral hashes only). No persistent identifiers.
- **Recipients:** None — SFU/TURN see ciphertext only, no disclosure.
- **Transfers:** None — self-hosted.
- **Security:** SFrame RFC9605 ciphertext, SFU opaque, HMAC TURN, Argon2id for OIDC passwords (Keycloak), CSP.

## 5. DSR / Erasure Spec (W2 implement)
- `DELETE /accounts/me` — JWT auth, deletes PG rooms/participants where host_id_hash == caller, deletes Redis presence keys, zeroizes SFrame epoch, returns 204. GDPR Art.17.
- `GET /data-inventory` — JWT auth, returns D-1..D-12 entries for caller.

## 6. CSP Enforcement (W2 — see @security FINDING-SEC-001)
Target header (Caddyfile + meta fallback):
`Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; worker-src 'self' blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
Verify: `curl -I https://localhost:443/ | grep -i content-security-policy`

## 7. Known Gaps (from @privacy/@security reviews)
- F-01 docs/privacy-inventory.md missing → **FIXED W1 scaffold (this file)**
- F-02 DSR endpoint missing → W2 @backend
- F-03 zero-telemetry statement unsigned → W2 @privacy sign
- F-04 CSP not enforced → W2 @frontend Caddyfile + index.html
- F-05 Google Fonts third-party → W2 self-host font-src 'self'
- F-06 UA sniffing → W2 feature detection
- SEC-002 WASM integrity placeholder → W2 CI inject sha384
- SEC-006 turn-auth HMAC missing → W2 implement POST /turn/credentials

## 8. Verification for QA (Criterion #10)
```
grep -r analytics --include="*.ts" poc/meet-webrtc-core/src/  # expect clean
grep -r "googleapis\|gstatic" poc/meet-webrtc-core/             # expect 0 after W2
grep -r "localStorage" poc/meet-webrtc-core/src/                # expect 0
curl -I http://localhost:80/ | grep -i content-security-policy  # expect CSP header W2
```

Gate exit: @privacy APPROVED only when F-01..F-06 + SEC-001/002 closed and privacy-scan.json PASS.
