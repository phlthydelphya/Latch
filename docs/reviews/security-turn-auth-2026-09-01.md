# Security Review — `services/turn-auth/main.go` POST /turn/credentials

**Artifact:** `services/turn-auth/main.go` | **Date:** 2026-09-01 | **Reviewer:** @security | **Status:** `REVIEW REQUIRED`
**Authority:** `M0-P0.md` §3 #8/#10, `ADR-005`, `architecture-brief.md` §4.5, `privacy-inventory.md` §5 CSP, 5 conditions (SAS/QR, rotation ≤500ms, CSP, TURN audit, Argon2id)

---

## Verdict: CHANGES_REQUESTED — 1 HIGH blocks gate; 3 MEDIUM, 3 LOW

---

### 1. HMAC Strength Audit

| Check | Result |
|-------|--------|
| TURN_SECRET entropy ≥32 chars, ≥128-bit | ✅ `len(turnSecret) < 32` fail-fast at startup. Default `p0-turn-secret-32chars` would fatal — correct fail-safe. No charset/entropy validation beyond length (LOW F-06). |
| From env, not committed | ✅ `os.Getenv("TURN_SECRET")`; no `.env` committed; compose uses `${TURN_SECRET:-p0-turn-secret-32chars}` |
| HMAC-SHA256, not SHA1/MD5 | ✅ `hmac.New(sha256.New, []byte(turnSecret))` |
| Coturn `--static-auth-secret` match | ✅ `compose.yaml:44` shares same `TURN_SECRET` env; coturn validates `expiry > now` + HMAC match |
| Timing-safe compare not needed for mint | ✅ turn-auth only mints; coturn validates |
| Credential = base64(HMAC) length 44 | ✅ `base64.StdEncoding.EncodeToString(mac.Sum(nil))` → 32 bytes → 44 chars |
| username expiry integer seconds | ✅ `time.Now().Unix() + int64(turnTTL)` |
| userHash base64url(sha256(...)) not reversible | ✅ `base64.RawURLEncoding.EncodeToString(sha256(participantHash|roomId))` |

### 2. TTL/Replay — 86400s Window

**Risk confirmed.** POST `/turn/credentials` is **fully unauthenticated** — no JWT, no API key, no session. Combined with 24h TTL:
- Any HTTP client can mint unlimited TURN credentials for any `roomId`
- Credentials valid for 24h — large replay window
- No rate limiting, no IP throttling, no token gating

**ADR-005 §3 mentions JWT-gated POST as future** but P0 does not implement it.

**Recommendation:** Gate behind `Authorization: Bearer <jwt>` with `aud=roomId`, 5m TTL from meet-signal, OR at minimum: rate-limit (10 req/min/IP) + IP hash bucket. Document 24h replay limit vs 5m JWT lifetime mismatch.

### 3. Log/Sanitize

| Check | Result |
|-------|--------|
| TURN_SECRET in logs | ✅ Never logged |
| credential in logs | ✅ Never logged — JSON encoded directly to response writer |
| SDP/PII/raw IP in logs | ✅ Not logged. Only `roomId`, `userHash[:8]`, `expiry` |
| JSON error messages | ✅ Generic: "Invalid JSON", "Method not allowed", "roomId is required" — no secret leakage |
| `allocationsTotal` race | ⚠️ non-atomic int increment under concurrent requests (F-02) |

### 4. Input Validation

| Check | Result |
|-------|--------|
| maxBody 1KB | ✅ `http.MaxBytesReader(w, r.Body, 1024)` |
| DisallowUnknownFields | ✅ |
| Content-Type strict | ⚠️ exact match rejects `charset=utf-8` (F-05) |
| POST only | ✅ |
| Expiry integer parsing safe | ✅ Server-generated `time.Now().Unix()`, not user-controlled |
| rand.Read entropy 32 bytes | ✅ `crypto/rand.Read(b)` — 256-bit entropy |

### 5. STRIDE 8 Re-check

| Threat | Analysis | Status |
|--------|----------|--------|
| **Spoofing** | HMAC-SHA256 prevents forgery; BUT unauthenticated POST allows anyone to mint valid creds | ⚠️ Medium |
| **Tampering** | HMAC integrity on username field | ✅ Pass |
| **Repudiation** | Log: `roomId`, `userHash[:8]`, `expiry`. Prometheus counter. Redis audit TODO (F-03) | ⚠️ Partial |
| **Info Disclosure** | TURN sees SFrame ciphertext only (opaque relay) | ✅ Pass |
| **DoS** | 1KB body limit, 5s read /10s write timeout. BUT unauthenticated endpoint + no rate limit = amplification vector | ⚠️ Medium |
| **Elevation of Privilege** | No authorization bypass — standalone service | ✅ Pass |

### 6. SFrame Ciphertext via TURN

**Confirmed.** coturn RFC 5766 relays `Allocate/ChannelBind` bytes without DTLS/SRTP termination. SFrame RFC9605 ciphertext passes through TURN relay opaque. `candidateType=relay` + Wireshark shows no plaintext NALs. **No plaintext leak.**

### 7. CSP `connect-src` Analysis

**Gap.** `privacy-inventory.md:53` CSP specifies `connect-src 'self' wss:` — **missing `turn:` and `turns:` schemes** (if enforced via meta, browser would block TURN). Must be added: `connect-src 'self' wss: turn: turns:` before W2 CSP enforcement.

---

## Findings (7)

| # | Severity | Finding | Remediation |
|---|----------|---------|-------------|
| **F-01** | **HIGH** | **Unauthenticated POST /turn/credentials — credential farming, no rate-limit, 24h replay window.** | Gate behind JWT `aud=roomId` 5m TTL OR rate-limit 10 req/min/IP. **Blocks M0-P0 security gate.** |
| **F-02** | **MED** | **`allocationsTotal++` data race.** non-atomic int increment. | Use `atomic.AddInt64` or prom client. |
| **F-03** | **MED** | **Redis audit TODO not implemented.** ADR-005 requires `SET turn:alloc:{hash} EX 86400`. | Implement Redis SET or document Prometheus alternative. |
| **F-04** | **MED** | **CSP `connect-src` missing `turn:` / `turns:`.** | Add `turn: turns:` to CSP. |
| **F-05** | **LOW** | **Content-Type exact-match fragility.** | Use `strings.HasPrefix` or `mime.ParseMediaType()`. |
| **F-06** | **LOW** | **TURN_SECRET entropy validated by length only.** | Document `openssl rand -base64 32` requirement. |
| **F-07** | **LOW** | **Hardcoded TURN URLs not configurable.** | Add `TURN_URLS` env var fallback. |

---

## Gate Impact

| Gate | Status | Blocker |
|------|--------|---------|
| Security | 🔴 **CHANGES_REQUESTED** | F-01 HIGH blocks gate |
| Privacy | 🟡 PARTIAL | F-03 + F-04 |

**Gate exit:** F-01 (JWT gate or rate-limit) + F-02 (atomic counter) + F-03 (Redis audit) → re-review → **APPROVED** (no HIGH open).

---

**@security** `________________` **Date** `2026-09-01` **Verdict** `CHANGES_REQUESTED` — F-01 HIGH blocks; F-02-04 MEDIUM must close before APPROVED.
