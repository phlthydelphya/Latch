# Privacy Review — turn-auth (M0-P0)

**Artifact:** `services/turn-auth/main.go` POST /turn/credentials | **Date:** 2026-09-01 | **Reviewer:** @privacy | **Status:** `REVIEW REQUIRED`
**Authority:** docs/M0-P0.md §3 #10, architecture-brief §1 privacy-by-design, ADR-005 §Privacy Invariant, docs/privacy-inventory.md D-7/D-11/D-12, GDPR Art.5/6/17/30, ROPA

---

## Verdict: CHANGES_REQUESTED (1 HIGH fixable W3)

Core minimization and zero-telemetry are sound. One spec-vs-code gap (Redis audit stub) blocks APPROVED.

---

## 1. Minimization — PASS

| Check | Spec | Result |
|---|---|---|
| Username = hash, not PII | `base64url(sha256(participantHash|roomId))` | ✅ Line 118-119: exact match. No email/plaintext. |
| Random fallback privacy-preserving | Empty participantHash → random 32B | ✅ 43-char base64url, uncorrelated to identity. |
| No PII in request/response | Request `{roomId, participantHash}` only | ✅ Response `{username, credential, ttl, urls}` — no IP, no email. |
| No localStorage/cookies/analytics | Zero tracking code | ✅ grep clean — no `localStorage`, no `googleapis`, no analytics SDK. |
| Log sanitization | roomId + hash[:8] only, no raw IP/SDP | ✅ `roomId=%s userHash=%s...` — 48-bit prefix, no secret logged. |

---

## 2. Retention — 1 FINDING (F1)

| Store | Claimed TTL | Code Status | Verdict |
|---|---|---|---|
| TURN credential expiry | 86400s | ✅ `turnTTL=86400`, `expiry=now+turnTTL` | PASS |
| Redis `turn:alloc:{hash}` | 86400s (D-7) | ❌ `// TODO implement Redis SET` | **F1 HIGH** |
| PG storage | None | ✅ No PG imports | PASS |
| IP retention >24h | None | ✅ No `r.RemoteAddr` extracted | PASS |
| Logs | 24h (Loki) | ✅ JSON stdout | PASS |
| Prometheus cardinality | No per-IP label | ✅ `turn_allocations_total` only, no labels | PASS |

**Finding F1 (HIGH) — Redis audit stub, D-7 unverified.** ADR-005 claims `Redis SET turn:alloc:{hash} EX 86400`. Code has TODO. Without Redis, no server-side allocation record. **Action:** Either implement Redis stub or formally downgrade D-7 to "no server-side allocation tracking — coturn handles TTL natively" and update privacy-inventory.md.

---

## 3. ROPA (GDPR Art.30) — PASS

| ROPA Field | Claim | Code Alignment |
|---|---|---|
| Purpose | NAT traversal | ✅ TURN allocation for ICE relay only |
| Legal basis | Art.6(1)(b) legitimate interest | ✅ Required for service delivery |
| Retention | 24h | ✅ TTL 86400 enforced |
| Recipient | Self-host operator only | ✅ No third-party |
| Transfer | None | ✅ Single compose host |
| Data type | Ephemeral hash only | ✅ SHA-256 truncated, not re-identifiable |

---

## 4. DSR / Erasure (GDPR Art.17) — PASS (ephemeral by design)

`POST /turn/credentials` does not create durable records. Credentials expire at `now+86400` and coturn validates expiry. No PG row, no Redis key. DSR satisfied via TTL expiry.

---

## 5. Zero Telemetry — PASS

| Check | Result |
|---|---|
| No analytics SDK | ✅ No GA/Mixpanel/Sentry imports |
| No googleapis | ✅ grep clean |
| No localStorage tracking keys | ✅ No calls |
| No cookies | ✅ Service sets no cookies |
| No UA sniffing | ✅ No `navigator.userAgent` |

---

## 6. Findings Summary

| ID | Severity | Description | Fix |
|---|---|---|---|
| **F1** | **HIGH** | Redis `turn:alloc:{hash}` EX 86400 is TODO. D-7 spec claim unverifiable. | Implement Redis stub OR formally document "no server-side allocation tracking". |
| **F2** | MEDIUM | ADR-005 promises `ipHash` in logs but code omits IP (better). | Update ADR-005 to reflect "turn-auth: no IP logged; coturn logs ipHash independently." |
| **F3** | MEDIUM | `allocationsTotal` not thread-safe. | Use `sync/atomic` or prom client. |
| **F4** | LOW | `userHash[:8]` truncation = 48 bits — document collision analysis. | Document in ADR-005. |
| **F5** | LOW | Random fallback undocumented. | Align with @architect: keep random or 400, document. |

---

## 7. Checklist — Privacy Inventory §7 (F1-F6 + SEC)

| ID | Item | Status |
|---|------|--------|
| F-01 | privacy-inventory.md exists | ✅ Fixed W1 |
| F-02 | DSR endpoint missing | ⬜ W2 (not TURN-specific) |
| F-03 | Zero-telemetry statement unsigned | ⬜ W2 @privacy sign |
| F-04 | CSP not enforced | ⬜ W2 |
| F-05 | Google Fonts third-party | ⬜ W2 |
| F-06 | UA sniffing | ⬜ W2 |
| SEC-006 | turn-auth HMAC missing | ✅ Implemented |
| F-4 | TURN rotation policy | ⚠️ F1 blocks close |

---

## 8. Exit Checklist Traceability

| Criterion | Privacy Support | Status |
|---|---|---|
| #8 TURN HMAC 24h | Ephemeral creds, no PII, self-host, sanitized logs | ⚠️ F1 blocks |
| #10 No persistent telemetry | No analytics, no cookies, no IP retention | ✅ (F1 doc gap only) |

---

## 9. Sign-Off

**Verdict: CHANGES_REQUESTED** — F1 is spec-honesty gap (code more private than claimed). Fixable in doc PR.

@privacy ________ Date ________ Verdict: ☐ APPROVED ☑ CHANGES_REQUESTED
