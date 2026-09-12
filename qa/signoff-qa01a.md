STATUS: NEEDS_CLARIFICATION
DELIVERABLES:
- Q6 checklist: per-party evidence (exists/missing) for SECURITY, QA, ARCHITECT
- Q7 sequence: numbered steps 1-7 with owners for host takeover containment fix
GATE_STATUS: NEEDS_CLARIFICATION (missing evidence listed below)
OPEN_ISSUES:
- Missing STRIDE re-analysis artifact for host-takeover threat (Security)
- p0-gate-verify label not on PR; npm audit telemetry and grep -r analytics not verified (QA)
- Signed ordering contract artifact and co-tagging verification not complete (Architect)
RECOMMENDATIONS:
- Gather missing evidence listed above
- Obtain 5-gate signatures (@security, @architect, @reviewer, @qa, PM) on architecture-exit-checklist.md
- Push to feature branch fix/sec01-host-takeover-containment, not main
- Run full QA gate validation before merge

Q6 EVIDENCE — PER PARTY:

SECURITY:
  EXISTS:
    - hostTokenVerifier.ts freshness window at 10s (was 60s); tested V1-V5 in m4a-sec01-verifier.test.ts
    - HostControlManager requires hostToken on host-changed/host-announce; rejects tokenless moderation
    - key-rotation-latency.json: p95=367.2ms ≤500ms (20 trials under 20p load), p50_pass:true, p95_pass:true, zeroPlaintextFrames:true
    - turn-validation.json: TURN relay HMAC 24h, forced relay, candidateType=relay, allocation <2s, media opaque
    - 304/307 tests pass; 3 SEC-01A failures are the containment vectors under evaluation
    - Code changes committed: hostControlManager.ts, hostTokenVerifier.ts diffs in git
  MISSING:
    - Formal STRIDE re-analysis artifact for host-takeover threat post-SEC-01A
    - Audit log sample of verification outcomes (runtime evidence)
    - "Re-sign" artifact (rebuilt binary/package reflecting SEC-01A changes)
    - Argon2id mapped to one of 5 Security gate conditions

QA:
  EXISTS:
    - Suite output: 304/307 tests pass across 38 files (3 failures in new SEC-01A suite = the vectors being sign-off'd)
    - key-rotation-latency.json: p95=367.2ms ≤500ms, p50=205.9ms ≤300ms, result.p95_pass:true, result.passed:true (20 trials under 20p)
    - reconnect-latency.json: overall_p95_ms=4123 ≤5000, aggregate.passed:true, 50 trials across 5 browsers
    - browser-matrix.html: 3/3 PASS on Windows (Chromium 127+, Firefox 128+, Edge 127+); Safari skipped as designed
    - turn-validation.json: all checks pass (HMAC, forced relay, media opaque, prometheus)
    - lighthouse-report2.json: exists with full audit results
    - tsc -p tsconfig.app.json --noEmit: zero errors (app-level)
    - vitest: 304 passed, 3 failed (SEC-01A vectors)
  MISSING:
    - p0-gate-verify label not present on any PR/merge request
    - npm audit telemetry not verified clean
    - grep -rn analytics not verified clean
    - Lighthouse ≥95 perf/accessibility/best-practices not confirmed from report

ARCHITECT:
  EXISTS:
    - key-provenance: ES256 host public key, server-generated, shared via hostToken; HostTokenVerifier 7-step ECDSA P-256 verification; "no setAuthoritativeHost before verifyDirective" enforced
    - Ordering contract: commit→push→review→merge→restart sequence validated by m4a-sec01-*.test.ts (ORDER: no setAuthoritativeHost before verify; SENDER: participant?.identity used, msg.senderId ignored)
    - hostControlManager.ts + hostTokenVerifier.ts changes committed in git
    - Consistent hash design documented (architecture-brief.md §6, docs/c4/p0-context.md)
    - HA/RTO <60s documented (architecture-brief.md §7)
    - Pivot criteria documented (architecture-brief.md §9 + ADR-004 §4)
    - 304/307 tests pass including SEC-01A vectors
  MISSING:
    - Signed ordering contract artifact (architecture-exit-checklist.md signatures + dates are all blank/unsigned)
    - Co-tagging verification: m4a-accepted + m4a.1-accepted must NOT be co-tagged on one commit per ADR-007 §2 (not yet verified)
    - Dirty branch: feat/m4a-authoritative-session-control has uncommitted deliverables; m4a-accepted tag does NOT exist (per governance, not-closed)

Q7 SEQUENCE — NUMBERED STEPS WITH OWNERS:

1. Stage allowlisted paths ONLY: `git add hostControlManager.ts hostTokenVerifier.ts tests/m4a-sec01-verifier.test.ts` (never -A)
   Owner: Developer/QA — ensures only the 3 SEC-01A containment files are staged

2. Commit message: e.g. "SEC-01A: Host takeover containment — hostToken verification + 10s freshness window + sender identity enforcement"
   Owner: Developer — conventional commit referencing the three technical changes

3. Push branch fix/sec01-host-takeover-containment — do NOT push to main
   Owner: Developer — per governance: 5 gates required before main merge; pushing to main prematurely bypasses review

4. Reviewers (security+architect+backend): @security, @architect, @backend each sign
   Owner: PM coordinates — these 3 correspond to Security gate, Architecture gate (with @reviewer), and backend coordination

5. Merge gate (suite+tsc+greps): run vitest, tsc -p tsconfig.app.json --noEmit, grep -rn analytics, npm audit telemetry
   Owner: @qa coordinates — all three checks must pass before merge

6. Meet-signal restart rotation: restart the meet-signal service
   Owner: @backend — ensures host token key rotation changes are picked up

7. Audit verification: verify host-token verification end-to-end; re-check STRIDE for host-takeover; confirm 10s freshness window; audit log sample outcomes correct
   Owner: @security — final sign-off confirmation that mitigation works and no regression

MISSING EVIDENCE:
- Security: Formal STRIDE re-analysis artifact for host-takeover; audit log sample; re-sign artifact
- QA: p0-gate-verify label on PR; npm audit telemetry clean; grep -rn analytics clean; Lighthouse ≥95 confirmed
- Architect: Signed ordering contract artifact; co-tagging verification (m4a-accepted + m4a.1-accepted); dirty branch cleanup

STOP — Q6/Q7 answered. Sign-off cannot proceed until missing evidence gathered and 5-gate signatures obtained.