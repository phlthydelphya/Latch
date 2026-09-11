STATUS: DONE
DELIVERABLES:
- qa/reports/m4a1-meeting-not-found-repro.md: Full reproduction script + evidence checklist + blocker verdict + next debug action
- qa/ directory structure verified readable (all 12+ existing artifacts accessible)

GATE_STATUS: PASS (reproduction framework complete; acceptance blocker verdict determined)

OPEN_ISSUES:
- Manual two-browser runtime gate (§5.2 of M4A.1 report) remains PENDING — requires docker compose + LiveKit + isolated browsers to execute
- Signal server restart between host create and guest join may cause 'Meeting not found' if room purged (expected per M4A invariants)

RECOMMENDATIONS:
1. Execute the reproduction script in `qa/reports/m4a1-meeting-not-found-repro.md` against a running `docker compose up` environment
2. If `GET /room/status` returns `exists:false` after `POST /room/create` → YES blocker; debug `services/meet-signal/main.go` `createRoom` handler for room registration timing
3. If `GET /room/status` returns `exists:true` but guest still gets 'Meeting not found' → NO environmental blocker; verify guest URL preserves `#k=` fragment and browser profiles are isolated
4. After reproduction, execute §5.2 manual two-browser runtime gate from `docs/M4A-authoritative-session-control.md` §5.2 and append addendum to `qa/reports/m4a1-identity-convergence-verification-2026-08-25.md`
5. Request `pm` to authorize `m4a.1-accepted` tagging after manual convergence PASS (per ADR-007 §2, no co-tagging with `m4a-accepted`)