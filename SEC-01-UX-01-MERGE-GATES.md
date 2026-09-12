# SEC-01 + UX-01 Merge Gates + Review Gates + Daily Checklists + Release Tracking

## MISSION SUMMARY
Define concrete PASS/FAIL checklists with commands and evidence for M4A-authoritative-session-control (SEC-01) and UX quality gates (UX-01), plus review gate ownership and release tracking logic.

---

## 1. SEC-01 MERGE GATE

**Security PASS + QA PASS + exploit regression PASS (V1-V5/ORDER/SENDER in m4a-sec01-verifier.test.ts) + no open criticals + Architecture PASS**

### PASS Conditions (ALL must be ✅)
| Condition | Requirement | Evidence Artifact |
|-----------|-------------|-------------------|
| **SEC-01 Security PASS** | All 7 test vectors (V1-V5, ORDER, SENDER) pass in `m4a-sec01-verifier.test.ts` | `poc/meet-webrtc-core/tests/m4a-sec01-verifier.test.ts` — run via `npm --prefix poc/meet-webrtc-core test` |
| **QA PASS** | All M0-P0 QA criteria green (10/10) | `qa/reports/browser-matrix.html`, `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json`, `qa/reports/turn-validation.json`, `qa/reports/screen-share-validation.json`, `qa/reports/lighthouse/*.json` |
| **Exploit Regression PASS** | V1: Forged host-announce rejected; V2: Valid host-changed accepted; V3: Key-overwrite rejected; V4: Replay >10s rejected; V5: Tokenless spoof rejected; ORDER: No setAuthoritativeHost before verifyDirective; SENDER: Spoofed msg.senderId ignored | Same test file — all 7 describe blocks pass |
| **No Open Criticals** | Zero critical/blocking issues in `git status --porcelain=v1`; delivering branch clean per ADR-007 | `git status --porcelain=v1` — no uncommitted changes in delivering branch |
| **Architecture PASS** | 5-gate architecture review signatures present + `p0-gate-verify` label | `docs/gates/architecture-exit-checklist.md` — all 5 signatures + `p0-gate-verify` label |

### FAIL Conditions (any one triggers FAIL)
- Any V1-V5/ORDER/SENDER test fails in `m4a-sec01-verifier.test.ts`
- Any QA criterion red (any of the 10 M0-P0 pre-conditions not met)
- Critical/open issue in git status (dirty delivering branch)
- Architecture gate not signed (missing `p0-gate-verify` label or <5 signatures)

### EXECUTION COMMANDS
```bash
# 1. Run SEC-01 verification test suite (vitest)
npm --prefix poc/meet-webrtc-core test  # runs vitest, includes m4a-sec01-verifier.test.ts

# 2. Verify all QA artifacts are present and green
ls -la qa/reports/key-rotation-latency.json qa/reports/reconnect-latency.json \
  qa/reports/browser-matrix.html qa/reports/turn-validation.json \
  qa/reports/screen-share-validation.json qa/reports/lighthouse/

# 3. Check git status for critical open issues
git status --porcelain=v1

# 4. Verify architecture gate signatures
# Check for p0-gate-verify label and 5 signatures in architecture-exit-checklist.md
```

### EVIDENCE FILES (must exist in `qa/reports/`)
- `browser-matrix.html` — 4-browser matrix (3/3 PASS on Windows, Safari skipped)
- `key-rotation-latency.json` — p50=205.9ms p95=367.2ms (p95 ≤500ms ✅)
- `reconnect-latency.json` — p95=4123ms (p95 ≤5s ✅, 50 trials across browsers)
- `turn-validation.json` — TURN relay HMAC 24h, relay verified ✅
- `screen-share-validation.json` — getDisplayMedia ✅
- `lighthouse/*.json` — ≥95 perf/accessibility/best-practices ✅
- `wireshark-livekit-sframe.pcapng` — SFrame ciphertext on wire ✅

---

## 2. UX-01 MERGE GATE

**no frozen-surface mods + a11y PASS + visual PASS + tsc PASS + vitest PASS + invariant grep PASS**

### PASS Conditions (ALL must be ✅)
| Condition | Requirement | Evidence Artifact |
|-----------|-------------|-------------------|
| **No Frozen-Surface Mods** | `git diff` must NOT modify any frozen invariants or invariant declarations | `git diff --stat` — no paths in `src/**/invariant*`, `src/**/types.ts` (frozen state), or ADR-protected files |
| **a11y PASS** | Lighthouse accessibility score ≥95; no WCAG violations; screen-reader flow verified | `qa/reports/lighthouse/lighthouse-report2.json` — a11y ≥95 |
| **Visual PASS** | No visual regressions; UI pixel diff within threshold; no broken layouts | Playwright visual diff baseline — `npm --prefix poc/meet-webrtc-core run test:browser` |
| **tsc PASS** | TypeScript compilation succeeds with zero errors | `cd poc/meet-webrtc-core && node node_modules/typescript/bin/tsc -p tsconfig.app.json` (workaround for PShell && issue) |
| **vitest PASS** | ≥215 tests pass with zero M0-M3B regressions | `npm --prefix poc/meet-webrtc-core test` — vitest run, jsdom |
| **Invariant Grep PASS** | `git diff` contains zero lines removing/weakening `invariant` declarations, `MAX_PAGE_TILES`, state type unions, or pre-connect invariants | `git diff` | grep -i invariant — must be empty (or only additive) |

### FAIL Conditions (any one triggers FAIL)
- `git diff` modifies frozen invariant declarations (state types, MAX_PAGE_TILES, counter initializations, SFrame salt, HRW salt)
- Lighthouse a11y score <95 or new WCAG violations
- Visual regressions detected in playwright E2E
- tsc compilation errors (>0 errors)
- vitest <215 tests pass or M0-M3B regressions introduced
- `git diff` removes/weakens invariant grep matches

### EXECUTION COMMANDS
```bash
# 1. Check frozen-surface invariants are untouched
git diff --stat
# Must NOT include: src/**/types.ts, src/**/invariant*, src/layout/gridOptimizer.ts, tests/invariant*

# 2. Run invariant grep to confirm no invariant weakening
git diff | grep -i invariant
# Must return empty (exit code 1 is OK — no matches found)

# 3. Run tsc compilation (workaround for PowerShell && issue)
cd poc/meet-webrtc-core && node node_modules/typescript/bin/tsc -p tsconfig.app.json

# 4. Run vitest unit test suite
npm --prefix poc/meet-webrtc-core test  # glob: tests/**/*.test.{ts,tsx}

# 5. Run playwright E2E (visual + a11y)
npm --prefix poc/meet-webrtc-core run test:browser  # skips if browsers not installed

# 6. Run lighthouse CI
npm --prefix poc/meet-webrtc-core run lighthouse:ci  # generates qa/reports/lighthouse/*.json
```

### EVIDENCE FILES
- `qa/reports/lighthouse/lighthouse-report2.json` — a11y ≥95, perf ≥95, best-practice ≥95
- `browser-matrix.html` — unchanged (3/3 PASS)
- vitest summary output — ≥215 tests passing
- playwright-results.json — visual + a11y pass
- `git diff` output — invariant grep clean

---

## 3. REVIEW GATES

### Architecture Review Gate
| Owner | Required Evidence | PASS Condition | FAIL Condition |
|-------|-------------------|----------------|----------------|
| **@architect** (author) + **@reviewer** (approver) | `docs/architecture-brief.md` v0.2.0-p0; `docs/c4/p0-context.md`; ADRs `ADR-001/002/004/005`; consistent hash design; HA/RTO note; pivot criteria; compose parity proof | All deliverables present; pivot documented (honest downgrade); no facades | Missing deliverables; pivot undocumented; facade risk flagged |
| **Signature** | `p0-gate-verify` label + 5 signatures in `architecture-exit-checklist.md` | ✅ GO | ❌ NO-GO |

### Security Review Gate
| Owner | Required Evidence | PASS Condition | FAIL Condition |
|-------|-------------------|----------------|----------------|
| **@security** | STRIDE 8 re-checked; 5 conditions: SAS/QR rotation ≤500ms; CSP `default-src 'none'`; TURN audit (HMAC 24h, no IP retention >24h); Argon2id key derivation | All 5 conditions green | Any HIGH open; CSP missing; TURN audit gap |
| **Signature** | Signed approval in `architecture-exit-checklist.md` gate row | ✅ APPROVED | ❌ CRITICAL open |

### QA Review Gate
| Owner | Required Evidence | PASS Condition | FAIL Condition |
|-------|-------------------|----------------|----------------|
| **@qa** | `docs/qa/m0-p0-test-plan.md` + browser-matrix + 20p load + rotation/reconnect histograms + Lighthouse + privacy scans | All 10 reproducible; label `p0-gate-verify` present | Any criterion red; <215 tests pass; `p0-gate-verify` missing |
| **Signature** | @qa signs with `p0-gate-verify` label | ✅ APPROVED | ❌ PENDING |

### Accessibility Review Gate
| Owner | Required Evidence | PASS Condition | FAIL Condition |
|-------|-------------------|----------------|----------------|
| **@reviewer (a11y)** | Lighthouse a11y ≥95; screen-reader flow; CSP; no `__Host-` cookie misuse | a11y ≥95; zero new WCAG violations | a11y <95; new violations |
| **Signature** | Reviewer signs off accessibility verdict | ✅ PASS | ❌ FAIL |

### Reviewer (Adversarial) Gate
| Owner | Required Evidence | PASS Condition | FAIL Condition |
|-------|-------------------|----------------|----------------|
| **@reviewer** | Challenge doc: SFrame+SFU H264/Safari; key rotation; TURN cost; honest downgrade (no facade); E2EE honesty | Honest downgrade documented; no facade claim; GO or documented waiver | Facade claimed; no honest downgrade plan; NO-GO without waiver |
| **Signature** | @reviewer signs "GO/NO-GO/WAIVER" in architecture-exit-checklist.md | ✅ GO/WAIVER | ❌ NO-GO |

---

## 4. DAILY CHECKLISTS

### Daily SEC Binary Q
**Question:** Can attendee still exploit the meeting?  
**Answer:** YES / NO  
**Evidence:** Specific git commit/hash + description of what was verified

| Format | Example |
|--------|---------|
| `SEC-EXPLOIT: NO — m4a-sec01-verifier.test.ts all 7 vectors pass; V1-V5/ORDER/SENDER intact; hostTokenVerifier 7-step pipeline validated; no host-key injection possible` | `SEC-EXPLOIT: NO — 2026-09-16T09:00Z / commit a1b2c3d` |
| `SEC-EXPLOIT: YES — V3 key-overwrite still possible if hostToken provided from wrong sub; freshness window 60s > spec 5s; see issue #402` | `SEC-EXPLOIT: YES — 2026-09-16T09:00Z / commit e5f6g7h` |

**Daily Verification Command:**
```bash
# Run the full SEC-01 test suite to confirm no regressions
npm --prefix poc/meet-webrtc-core test -- --testNamePattern="SEC-01A: Emergency Containment Hotfix"

# Check hostTokenVerifier freshness window (code says 60s, spec says 5s)
grep -n "freshness\|60_000\|10_000" poc/meet-webrtc-core/src/host/hostTokenVerifier.ts
```

### Daily UX Binary Q
**Question:** Did UX diff touch frozen?  
**Answer:** YES / NO  
**Evidence:** `git diff` output referencing frozen invariant files

| Format | Example |
|--------|---------|
| `UX-FROZEN: NO — git diff touches only InviteModal.css, no invariant files modified` | `UX-FROZEN: NO — 2026-09-16T09:00Z` |
| `UX-FROZEN: YES — git diff modifies src/types.ts state union, weakening 'frozen' | 'waiting' |` | `UX-FROZEN: YES — 2026-09-16T09:00Z` |

**Daily Verification Command:**
```bash
# Check if any invariant files changed in yesterday's UX diff
git diff HEAD~1 -- . ':!node_modules' ':!dist' | grep -E '(invariant|frozen|MAX_PAGE_TILES|state.*frozen|types\.ts)' 
# Must return empty (exit code 1 = no matches = GO)

# Full invariant grep check
git diff | grep -ci invariant || echo "0 invariant changes — GO"
```

---

## 5. RELEASE TRACKING

### Conditions State Machine

```
RELEASE BLOCKED
  │
  ├─── ELIGIBLE when ALL of:
  │   ✅ SEC-01 merge gate PASS (all 7 vectors + no criticals + arch PASS)
  │   ✅ UX-01 merge gate PASS (no frozen mods + a11y/visual/tsc/vitest + invariant grep)
  │   ✅ All 5 review gates signed (Architecture + Security + QA + Accessibility + Reviewer)
  │   ✅ `p0-gate-verify` label present on merge request
  │   ✅ All QA artifacts in `qa/reports/` green (histograms, browser matrix, Lighthouse)
  │   ✅ `npm audit telemetry` clean
  │   ✅ `grep -rn analytics` clean (no persistent telemetry)
  │
  ▼
APPROVED when ALL of ELIGIBLE +:
  │   ✅ PM coordinates final approval vote (per M0-P0.md §8)
  │   ✅ @reviewer adversarial gate gives GO (or WAIVER documented)
  │   ✅ No open critical issues in `git status --porcelain=v1`
  │   ✅ Daily burn-down RAG published by PM
  │   ✅ Release notes drafted + reviewed (no PII, no analytics claims)
  │
  ▼
RELEASED — tag `v1.0.0-m4a-complete` + `m4a-accepted` tag created
  │
  └─── RE-BLOCKED if any ELIGIBLE condition flips to FAIL post-approval
```

### Gate Hierarchy
| Gate Level | Owner | Decision Required |
|------------|-------|-------------------|
| **M4A Merge Gate** | @architect + @reviewer + @security + @privacy + @qa | Merge to main only when `p0-gate-verify` label + 5 signatures |
| **SEC-01 Gate** | @security + QA | Pass: all m4a-sec01-verifier.test.ts vectors + no criticals |
| **UX-01 Gate** | @frontend + @reviewer | Pass: no frozen-surface mods + a11y/visual/tsc/vitest+invariant-grep |
| **Daily Burn-Down** | PM | RAG status per day; if any daily SEC-EXPLOIT=YES → immediate re-block |
| **Release Approval** | PM + @reviewer | Final GO/NO-GO vote; creates acceptance tag |

### RELEASE BLOCKED → ELIGIBLE → APPROVED Decision Matrix

| Condition | Current State | Action |
|-----------|---------------|--------|
| SEC-01 test suite fails | ❌ BLOCKED | Fix m4a-sec01-verifier.test.ts vectors; re-run `npm --prefix poc/meet-webrtc-core test` |
| UX-01 frozen-surface touch | ❌ BLOCKED | Revert invariant changes; git checkout frozen files; verify invariant grep clean |
| Lighthouse a11y <95 | ❌ BLOCKED | Fix accessibility issues; re-run `npm --prefix poc/meet-webrtc-core run lighthouse:ci` |
| `npm audit telemetry` not clean | ❌ BLOCKED | Remove/replace telemetry SDKs; audit `package.json` deps |
| `grep -rn analytics` finds matches | ❌ BLOCKED | Remove analytics imports; sanitize logs; CSP already `default-src 'none'` |
| Reviewer gives NO-GO | ❌ BLOCKED | Address adversarial concerns; document waiver if applicable; no merge without GO |
| `p0-gate-verify` label missing | ❌ BLOCKED | PM add label after all 5 gate signatures collected |

---

## 6. CONFIDENCE & TERMINATION

**Status:** DONE — All checklists, gates, commands, and evidence files defined concretely.

**Confidence:** HIGH — All conditions mapped to existing artifacts, test files, and repo invariants. No speculative dependencies.

**STOP: Plan only, no test execution.**