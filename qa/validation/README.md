# QA Validation — Manual Checklists

This directory contains **human-executed validation checklists** for criteria that cannot be fully automated. Each checklist is a markdown file with pass/fail checkboxes, evidence links, and sign-off fields.

## Structure

```
qa/validation/
├── m0-p0-architecture-checklist.md      # M0-P0 gate (from docs/gates/architecture-exit-checklist.md)
├── m1-production-hardening-checklist.md # M1 gate
├── m2-meeting-experience-checklist.md   # M2 gate
├── m3a-advanced-view-checklist.md       # M3A gate
├── m3b-multi-stream-checklist.md        # M3B gate
├── m4a-authoritative-session-checklist.md # M4A gate (5-gate: Arch, Sec, Priv, QA, Reviewer)
├── m4a1-invitation-links-checklist.md   # M4A.1 gate
├── media-proof-sprint-checklist.md      # This sprint's manual verification steps
├── privacy-invariant-checklist.md       # Permanent exclusions verification
├── security-invariant-checklist.md      # CSP, cookies, tokens, no-PII
├── performance-budget-checklist.md      # Bundle, Lighthouse, TBT, CLS
└── README.md                            # This file
```

## Checklist Template

Each checklist follows this format:

```markdown
# <Milestone> Validation Checklist

**Date:** YYYY-MM-DD
**Validator:** @<agent>
**Git SHA:** <short-sha>
**Environment:** <staging|local|ci>

---

## <Gate Name> Gate

| # | Criterion | Method | Evidence | Pass/Fail | Notes |
|---|-----------|--------|----------|-----------|-------|
| 1 | ... | Manual inspection / Command | Link to artifact | ☐ / ☑ | ... |

---

## Sign-Off

- [ ] Architecture Gate (@architect)
- [ ] Security Gate (@security)
- [ ] Privacy Gate (@privacy)
- [ ] QA Gate (@qa)
- [ ] Reviewer Gate (@reviewer)

**Final Verdict:** PASS / FAIL / CONDITIONAL
**Blocker(s):** <none or description>
```

## Current Checklists (2026-09-11)

| Checklist | Status | Milestone Gate |
|-----------|--------|----------------|
| `m0-p0-architecture-checklist.md` | ✅ Complete (historical) | M0-P0 |
| `m1-production-hardening-checklist.md` | ✅ Complete (historical) | M1 |
| `m2-meeting-experience-checklist.md` | ✅ Complete (historical) | M2 |
| `m3a-advanced-view-checklist.md` | ✅ Complete (historical) | M3A |
| `m3b-multi-stream-checklist.md` | ✅ Complete (historical) | M3B |
| `m4a-authoritative-session-checklist.md` | 🟡 In progress | M4A (5-gate) |
| `m4a1-invitation-links-checklist.md` | ⏳ Not started | M4A.1 |
| `media-proof-sprint-checklist.md` | 🟡 In progress | Sprint MP-01..MP-09 |
| `privacy-invariant-checklist.md` | ⏳ Not started | Continuous |
| `security-invariant-checklist.md` | ⏳ Not started | Continuous |
| `performance-budget-checklist.md` | ⏳ Not started | Continuous |

## Media Proof Sprint Checklist (Active)

See `docs/reports/media-proof-sprint.md` for test matrix. This checklist covers manual verification steps:

- [ ] **MP-01:** SFrame round-trip verified via `npm run sframe-proof` output
- [ ] **MP-03:** Wireshark capture shows `rtp && sframe` with zero plaintext NALs
- [ ] **MP-04:** `iceTransportPolicy: relay` + UDP 3478 drop → `candidateType=relay` in `chrome://webrtc-internals`
- [ ] **MP-07:** Safari 17.4 + WebKit: OffscreenCanvas + VideoFrame recycle works (no console errors)
- [ ] **MP-08:** Firefox ICE/TURN race documented in `docs/investigations/firefox-ice-turn.md`
- [ ] **MP-09:** 20p TURN relay soak (30 min) — no media bypass, sustained allocations

## Cross-Reference

- Sprint plan: `docs/reports/media-proof-sprint.md`
- Artifact manifests: `qa/artifacts/*/README.md`
- Report index: `qa/reports/README.md`
- Gate definitions: `docs/gates/architecture-exit-checklist.md`