# Release Readiness Review — Post SEC-CRIT-02 Closure

Date: 2026-09-12
Scope: Remaining blockers between the current repository state and release eligibility.
Explicitly excluded: SEC-CRIT-02 remediation review (assumed closed).
Verified baseline: `main` @ `a5957b0`, clean working tree; frontend `vitest` 36 files / 278 tests PASS; Go `meet-signal` tests PASS; SEC-CRIT-02 tag `sec-crit-02-closed` present.

---

## SECTION 1 — CURRENT RELEASE STATUS

**NOT READY**

Multiple release-blocking items remain outside SEC-CRIT-02: an activated backend/client contract mismatch, uncommitted SEC-01A remediation, unclosed M4A.1 acceptance, unexecuted SEC-01B/01C/01D, unsigned privacy/architecture gates, and unverified TLS/cutover readiness. The program's own release-restoration criteria (`docs/plans/SEC-CRIT-02-remediation-program.md` §8) are not all met.

---

## SECTION 2 — OPEN BLOCKERS

| ID | Owner | Severity | Description | Required Action |
|---|---|---|---|---|
| **REL-01** | @frontend + @backend | **Critical** | Activated host resume/transfer contract is not implemented by the client. Backend now requires `X-Session-Capability`, `X-Host-Proof`, `X-Resume-Handle` and returns only public metadata; the committed frontend has **zero** references to `sessionToken`/`resumeHandle`/those headers, and `hostControlManager.ts:508` still posts `Authorization` only and expects `body.newHostToken`. Server transfer returns 401 and the client silently degrades to the legacy data-channel broadcast. | Wire the client to the new contract (persist session capability + resume handle from bootstrap, send the three headers, consume target-only delivery), or feature-flag resume/transfer off, then re-verify end-to-end with a real client. |
| **REL-02** | @frontend + @security + PM | **Critical** | SEC-01A frontend remediation is uncommitted (`stash@{0}`): `presenceAdapter.ts`, `hostControlManager.ts`, `hostTokenVerifier.ts`, `main.tsx`, `tests/m4a-sec01-*.test.ts`, `qa/reports/SEC01A-*`, `docs/adr/ORDERING-CONTRACT-SEC01A.md`, `docs/adr/STRIDE-host-takeover-SEC01A.md`, `SEC-01-UX-01-MERGE-GATES.md`. `git ls-files` confirms none are on `main`. | Restore the stash, run the SEC-01 merge gate (V1-V5/ORDER/SENDER, clean branch), review, and commit/merge. |
| **REL-03** | @qa + PM | **High** | M4A.1 acceptance tag absent (`m4a.1-accepted`) and QA explicitly froze tagging pending the §5.2 mandatory manual two-browser runtime convergence gate (`qa/reports/m4a1-identity-convergence-verification-2026-08-25.md` §11). | Execute the manual two-browser gate on the verified revision, append a signed addendum, then tag M4A.1 separately (no co-tagging with `m4a-accepted` per ADR-007 §2). |
| **REL-04** | PM + @architect | **High** | M4A closure governance is contradictory. `AGENTS.md:13` says M4A `PASSED TECHNICAL REVIEW — NOT CLOSED` and `m4a-accepted` "does NOT exist", but the tag exists and is an ancestor of `main` (`1a67358`); `feat/m4a-authoritative-session-control` is stale (fully behind main). | Reconcile the authoritative portfolio/closure record (ADR-007 §2) against fresh `git` evidence and correct `AGENTS.md`. |
| **REL-05** | @backend + @architect | **High** | SEC-01B dependent remediation is not executed. It was blocked by SEC-CRIT-02 and is now unblocked, but its transfer contract must consume the new private-session/generation rules; the verifier/trust-boundary/transfer-hardening/rotation specs and audit sink (`docs/plans/SEC-01B-controlled-kickoff-packaging.md` B1-B7) are unwritten; client mutations remain gated on SEC-01A closure. | Execute B1-B7 after REL-02/REL-01, including the audit sink and rotation endpoint spec. |
| **REL-06** | PM + @architect + @security | **High** | SEC-01C and SEC-01D are named in the release dependency chain (`SEC-CRIT-02-backend-host-credential-replay.md` final disposition) but have no documents, plans, or artifacts in the repository. | Define, scope, and execute SEC-01C/01D (SEC-01D full STRIDE + adversarial ladder). |
| **REL-07** | @backend + @security | **High** | SEC-CRIT-02 program §8 cutover conditions are not executed/proven: still-valid pre-cutover ES256/HS256/LiveKit credentials rejected on every privileged path, old sessions terminated, fleet/credential inventory, and controlled runtime activation with rollback rehearsal. Only unit/container tests were run; legacy/LiveKit signing secrets are unchanged and no fleet inventory exists. | Run the coordinated cutover/revocation + rollback rehearsal with per-verifier evidence and connection-termination proof. |
| **REL-08** | @privacy + @backend | **High** | Privacy gate is unsigned. `docs/privacy-inventory.md` is `DRAFT`; ROPA is a stub; DSR (`DELETE /accounts/me`) is a W2 stub; retention rows are unverified; `turn-auth` Redis audit sink is a TODO stub. | Finalize ROPA/DSR, verify retention/audit, and record the privacy gate signature. |
| **REL-09** | @architect + @reviewer + @qa | **High** | Architecture exit gate artifacts/signatures are incomplete: `docs/gates/architecture-exit-checklist.md` signatures are blank; ARCH-009 (adversarial honesty memo) and ARCH-012 (SFrame pcap) are OPEN; ARCH-013..017 Amber (browser matrix / 20p load / rotation / reconnect / Lighthouse); ARCH-010 Helm parity missing (`docs/gaps/architecture-gaps.md`). | Close or waive each with artifacts (or record which are superseded by M4A/M5A gates) and obtain the 5 gate signatures + `p0-gate-verify`. |
| **REL-10** | @frontend + PM | **High** | UX-01 is incomplete and its artifacts are uncommitted (`docs/ux/UX-F1-*.md`, `docs/ux/interaction-spec.md`, `src/components/primitives/`, `src/styles/tokens*`, `package.json` deps, `.stylelintrc.json`), all in `stash@{0}`. | Complete UX-01 against its frozen-surface/merge gates, review, and commit. |
| **REL-11** | @qa | **Medium** | Coverage artifact is absent. `vitest.config.ts` targets `./qa/reports/coverage`, but no `qa/reports/coverage` directory exists. | Generate and commit the coverage report for the release candidate. |
| **REL-12** | @qa | **Medium** | QA performance/browser evidence is stale or incomplete: full 20p×10min endurance remains OPEN (`docs/gaps/qa-gaps.md` G2); browser matrix is Windows 3/3 with Safari skipped; playwright browsers may not be installed. | Re-run the 4-browser matrix and 20p endurance on the release candidate; record histograms. |
| **REL-13** | @infra + @backend | **High** | TLS/secure-route verification is unavailable. SEC-02A ingress testing failed HTTPS negotiation before any HTTP response (`qa/reports/sec-crit-02/sec-02a-containment.md` §7); production Ingress-Nginx + cert-manager path is unvalidated. | Verify TLS termination and privileged-route behavior over HTTPS on the production ingress profile. |
| **REL-14** | @infra + @backend | **Medium** | Deployment/monitoring readiness unverified: `docs/infrastructure-blockers.md` records a LiveKit container startup failure under `compose up --wait`; Helm/K8s parity missing (ARCH-010); production Grafana/alerting validation outstanding. | Re-verify `compose up --wait` and health checks, commit Helm parity, validate alerts/runbooks. |
| **REL-15** | PM | **Medium** | Repository governance hygiene: out-of-scope deliverables remain stashed rather than committed; `AGENTS.md` is stale; no release tag exists; release must not co-tag distinct milestones. | Land REL-02/REL-10, refresh `AGENTS.md`, and define the release-tag/merge policy before eligibility. |

---

## SECTION 3 — REMAINING MILESTONES

| Milestone | Status | Release relevance |
|---|---|---|
| M0-P0 Architecture Validation | CLOSED & ACCEPTED (`ef6206c`) | Predecessor |
| M1 Production Hardening | CLOSED & ACCEPTED | Predecessor |
| M2 Meeting Experience | CLOSED & ACCEPTED | Predecessor |
| M3A Advanced View Experience | CLOSED & ACCEPTED | Predecessor |
| M3B Multi-Stream Scalability | CLOSED & ACCEPTED | Predecessor |
| M4A Authoritative Session Control | Merged to `main`; `m4a-accepted` tag present; governance record contradictory (REL-04) | Blocker |
| M4A.1 Invitation Links (ADR-006) | Automated PASS; manual gate pending; no acceptance tag (REL-03) | Blocker |
| SEC-01A Frontend Remediation | Remediation complete per incident premise; uncommitted (REL-02) | Blocker |
| SEC-01B Controlled Kickoff Packaging | Conditional; not executed (REL-05) | Blocker |
| SEC-01C / SEC-01D | Undefined (REL-06) | Blocker |
| UX-01 | In progress; artifacts uncommitted (REL-10) | Blocker |
| M4A.2 Latch Brand Rename (ADR-007) | Planning only; code authorization BLOCKED | Deferred, not a release blocker |
| M5A Reliability/Recovery/Resilience | BLOCKED until M4A + M4A.1 closed | Next milestone |

---

## SECTION 4 — RELEASE CRITICAL PATH

Ordered by dependency (each step gates the next):

1. **REL-02** Restore/commit SEC-01A remediation and pass the SEC-01 merge gate.
2. **REL-04 / REL-03** Reconcile M4A closure governance; run the M4A.1 manual convergence gate; tag M4A.1 separately.
3. **REL-01** Resolve the activated backend/client contract mismatch (wire the client or feature-flag resume/transfer), then re-verify with a real client.
4. **REL-07 / REL-13** Execute the credential cutover/rollback rehearsal and HTTPS secure-route verification.
5. **REL-05 / REL-06** Execute SEC-01B, SEC-01C, SEC-01D on the new contract.
6. **REL-10** Complete and commit UX-01.
7. **REL-08 / REL-09 / REL-11 / REL-12** Close Privacy, Architecture, coverage, and performance-gate artifacts.
8. **REL-14 / REL-15** Confirm infra/deployment readiness and finalize governance + release-tag policy.
9. PM release eligibility assessment (program §8 conjunctive criteria).

---

## SECTION 5 — FINAL RECOMMENDATION

**Release Blocked.**

SEC-CRIT-02 is closed and the security remediation is complete, but the repository is not release-eligible: the newly activated authority endpoints are incompatible with the committed client (REL-01), the SEC-01A remediation and UX-01 work are uncommitted (REL-02/REL-10), M4A.1 acceptance is frozen pending a manual gate (REL-03), SEC-01B/01C/01D are unexecuted or undefined (REL-05/REL-06), and the cutover, TLS, privacy, architecture, and QA evidence required by the program's release criteria remain outstanding. No release tag may be applied until the critical path in Section 4 is complete.
