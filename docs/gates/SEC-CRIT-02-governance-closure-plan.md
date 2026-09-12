# SEC-CRIT-02 — Governance Closure Plan

Date: 2026-09-12
Mode: Governance closure execution (no new functionality, architecture, or security scope)
Incident authority: [SEC-CRIT-02 — Executable Remediation Program](../plans/SEC-CRIT-02-remediation-program.md)
Adjudication: [Backend Host Credential Replay / Authority Reassignment](../reviews/SEC-CRIT-02-backend-host-credential-replay.md)

Verified basis (fresh at plan time):

- HEAD `c1b18be`; delivering tree **dirty** (44 entries).
- Tags: `m4a-accepted` → commit `1a67358` (not `c1b18be`).
- `go test -count=1 ./...` from `services/meet-signal`: **ok** (191 run cases).
- `go test -race` on this Windows host: **not runnable** (`-race requires cgo`).

Status framing honored throughout: SEC-02A/B/C/D are **technically resolved**; the incident is **FORMALLY OPEN**.

---

## MILESTONE 1 — REPOSITORY HYGIENE

### Repository Hygiene Review

All SEC-CRIT-02 production, test, and evidence artifacts are currently **untracked**. None of the backend test files, plans, reviews, or `qa/reports/sec-crit-02/` evidence is in Git. The only tracked SEC-CRIT-02-adjacent change is `services/meet-signal/main.go` (+ `main_test.go`), both unstaged.

### Files To Commit (SEC-CRIT-02 allowlist)

**Backend production (SEC-02A/B/C):**

- `services/meet-signal/main.go` (M) — containment gates, session/handle stores, generation-bound host tokens, `resumeIdentity`, `transferHostIdentity`, `deliverHostCredential`.

**Backend tests:**

- `services/meet-signal/main_test.go` (M)
- `services/meet-signal/sec02a_containment_test.go` (??)
- `services/meet-signal/sec02b_identity_binding_test.go` (??)
- `services/meet-signal/sec02c_authority_generation_test.go` (??)

**Program / plan / review docs:**

- `docs/plans/SEC-CRIT-02-remediation-program.md` (??)
- `docs/plans/SEC-02B-identity-binding.md` (??)
- `docs/plans/SEC-02C-authority-generation-hardening.md` (??)
- `docs/reviews/SEC-CRIT-02-backend-host-credential-replay.md` (??)

**QA evidence:**

- `qa/reports/sec-crit-02/` — all 10 files (`sec-02a-containment.md`, `sec-02a-test-results.md`, `sec-02a-baseline-tests.jsonl`, `sec-02a-candidate-tests.jsonl`, `sec-02a-go122-race-results.json`, `sec-02a-isolated-runtime.json`, `sec-02a-local-deployment.json`, `sec-02a-local-ingress.json`, `sec-02a-native-race-attempt.txt`, `sec-02d-independent-verification.md`).

**Conditional (do NOT commit as-is):**

- `docs/reviews/SEC-CRIT-02-closure-report.md` (??) — include **only after** it is corrected. As written it declares “RELEASE ELIGIBLE FOR GOVERNANCE REVIEW,” 143 tests, and five PASS gates, which contradicts the program’s `KEEP OPEN / BLOCKED` disposition and the actual 191-case run. Committing it verbatim would create a false closure record.
- `Latch-Backend-Review.md` (??, repo root) — original external intake review. Recommend relocating under `docs/reviews/` before committing; do not leave at root.

### Files To Exclude (not SEC-CRIT-02)

- `AGENTS.md` (M) — governance metadata; separately contains an unsupported M4A “CLOSED & ACCEPTED” edit (see Risks).
- Frontend (SEC-01A/UX-01, explicitly out of scope): `poc/meet-webrtc-core/src/components/ControlBar.tsx`, `src/host/hostControlManager.ts`, `src/host/hostTokenVerifier.ts`, `src/main.tsx`, `src/presence/presenceAdapter.ts`.
- UX-01 assets/deps: `poc/meet-webrtc-core/package.json`, `package-lock.json`, `scripts/token-audit.ts`, `.stylelintrc.json`, `src/components/primitives/`, `src/styles/tokens.ts`, `src/styles/tokens.css.ts`, `docs/ux/`.
- SEC-01A artifacts: `docs/adr/ORDERING-CONTRACT-SEC01A.md`, `docs/adr/STRIDE-host-takeover-SEC01A.md`, `poc/meet-webrtc-core/tests/m4a-sec01-order-sender.test.ts`, `tests/m4a-sec01-verifier.test.ts`, `qa/reports/SEC01A-*`, `qa/signoff-qa01a.md`.
- SEC-01/UX-01 gates: `SEC-01-UX-01-MERGE-GATES.md`, `docs/gates/frozen-surface-guard-SEC01-UX01.md`.
- SEC-01B planning: `docs/plans/SEC-01B-controlled-kickoff-packaging.md`.
- Tooling/upload: `check_registries.py`, `meet-secure-backend-dev.zip` (do not commit the binary archive).
- Other pre-existing QA noise: `qa/reports/phase4-status.md`, `q7-q8-q10-validation.md`, `playwright-results.json`, `audit-log-sample-SEC01A.json`.
- `qa/reports/not-readable-error-plan.md` — intentionally untracked per `AGENTS.md`; preserve.

### Missing Files (required by program, absent)

1. `docs/design/SEC-02-session-identity-contract.md` (SEC-02B deliverable) — **absent** (`docs/design/` has no SEC-02 file).
2. SEC-02B/C architecture decision recorded via the ADR process and referenced from `architecture-brief §11` — **absent**; `architecture-brief.md` contains no `SEC-02`/`SEC-CRIT` reference and `docs/adr/` has no SEC-02 ADR.
3. **Privacy** and **Adversarial** independent gate decisions for SEC-02D — the program requires five gates; `sec-02d-independent-verification.md` records only Architecture, Security, QA, Reviewer.
4. SEC-02B/C race evidence on a supported runner (`go test -race`) — only the SEC-02A Go 1.22 race artifact exists; the SEC-02B/C candidate has no race run (Windows host cannot run `-race`, cgo disabled).
5. Cutover/revocation rehearsal (R13) and rollback rehearsal (R14) evidence for the SEC-02B/C candidate — absent.

### Clean Tree Status

**FAIL** — 44 dirty/untracked entries; every SEC-CRIT-02 test, plan, review, and QA artifact is untracked. Delivering checkout is not clean.

---

## MILESTONE 2 — ACTIVATION READINESS

### Activation Readiness Review

### Current Endpoint State

| Endpoint | State | Evidence |
|---|---|---|
| `POST /token` (`handleToken`) | **SEC-02A containment active.** Any present `Authorization` header (any value/scheme) → `403 host_resume_temporarily_disabled` before body parse or issuance. Guests only; participant `sessionToken` issued. Never calls `resumeIdentity`. | `services/meet-signal/main.go:869-878`, `904-929` |
| `POST /room/transfer-host` (`handleTransferHost`) | **SEC-02A containment active.** Unconditional `503 host_transfer_temporarily_disabled` for POST. Former transfer/mint/broadcast/response body is deleted. Never calls `transferHostIdentity`. | `services/meet-signal/main.go:1289-1299` |

Containment **remains active**: **YES**. Both vulnerable paths are unreachable; `resumeIdentity` (`:1188`), `transferHostIdentity` (`:1240`), `deliverHostCredential` (`:514`), and `resumeHandleStore.issue` (`:379`) have **zero production callers** (tests only). `assignRole` (`:147`) is read-only for host state.

### Required Wiring

1. **`handleToken` resume branch**: detect credentials, read `X-Session-Capability` / `X-Host-Proof` / one-use handle, call `resumeIdentity`, and on `isHost` mint a generation-bound host token + rotate session capability + issue a fresh resume handle; otherwise preserve identity as participant. Fail closed, never downgrade to anonymous guest.
2. **Bootstrap handle issuance**: `createRoom` (and guest bootstrap) must issue a resume handle; `resumeHandleStore.issue` currently has no caller, so host resume cannot function even after wiring.
3. **`handleTransferHost`**: authenticate via `transferHostIdentity`, mint the target host token, deliver it via `deliverHostCredential` to the target’s WSS channel only, return public metadata only (`hostId`/`hostKey`/`timestamp`), and never include `newHostToken` in the requester response.
4. **Private delivery**: `deliverHostCredential` is presently dead code; activation must actually use it and assert target-only frames.

### Activation Risks

- **Verification/reality gap:** `sec-02d-independent-verification.md` asserts “Target-only credential delivery … via `hub.deliverHostCredential`” and a broken attack chain, but no production path invokes delivery or the resume/transfer primitives. The report validates unit-tested primitives, not wired endpoint behavior.
- **No resume-handle issuance:** host resume is structurally impossible until bootstrap issues handles.
- **No race evidence** for the SEC-02B/C candidate on a supported runner.
- **Two missing gates** (Privacy, Adversarial) and two missing program deliverables (contract doc, ADR).
- **Contradictory records:** `SEC-CRIT-02-closure-report.md` claims release eligibility; the program and SEC-02D both say `KEEP OPEN / BLOCKED`.

### Rollback Plan

Retain and roll back only to the verified SEC-02A contained artifact (`meet-secure/meet-signal:sec02a-contained`, image `sha256:0afe954b…`). Keep both routes disabled; never restore the vulnerable baseline image or old authority/session state. If activation fails, disable transfer/resume immediately and re-run guest + R02/R03 checks.

### Ready For Activation

**NO** — containment is complete, but the activation candidate is not wired, not race-verified, and not fully gated. Do not activate.

---

## MILESTONE 3 — FORMAL SIGN-OFF PACKAGE

| Gate | Result | Basis |
|---|---|---|
| Architecture | **FAIL** | SEC-02B contract doc and SEC-02B/C ADR absent; bootstrap/resume-handle and delivery wiring absent; `architecture-brief §11` not updated. |
| Security | **FAIL** | Endpoints still hard-disabled with no activation path; no cutover/revocation rehearsal (R13) for the SEC-02B/C candidate; verification report conflicts with production code. |
| QA | **FAIL** | No SEC-02B/C `-race` evidence on a supported runner; R13/R14 not evidenced; only 4 of 5 required gates recorded. |
| Reviewer | **FAIL** | `sec-02d-independent-verification.md` asserts delivered behavior that has no production call site; cannot sign against the candidate. |

### Outstanding Items

- Write `docs/design/SEC-02-session-identity-contract.md` and the SEC-02B/C ADR; update `architecture-brief §11`.
- Wire `handleToken`/`handleTransferHost` to `resumeIdentity`/`transferHostIdentity`; issue resume handles at bootstrap; use `deliverHostCredential`.
- Produce SEC-02B/C race evidence on a cgo-enabled runner; run R13 cutover/revocation and R14 rollback rehearsals.
- Obtain independent **Privacy** and **Adversarial** decisions tied to the exact candidate revision.
- Correct or annotate `SEC-CRIT-02-closure-report.md`; it must not claim release eligibility while the program says BLOCKED.
- Reconcile `AGENTS.md`: the M4A “CLOSED & ACCEPTED” edit contradicts ADR-007 §2 (delivering tree dirty; `m4a-accepted` points at `1a67358`, not the current HEAD).

---

## MILESTONE 4 — REPOSITORY CLOSURE

### Repository Closure Plan

| Step | Action | Status |
|---|---|---|
| 1. Commit | Stage the SEC-CRIT-02 allowlist only (backend + tests + plans + reviews + `qa/reports/sec-crit-02/`) on a dedicated branch. | **BLOCKED** — closure-eligible; but `closure-report.md` must be corrected first, and an interim containment commit must not be tagged as incident closure. |
| 2. Push | Push branch; no direct-to-main. | Pending step 1. |
| 3. Review | Independent review of the candidate revision and evidence manifests. | Pending; gates currently FAIL. |
| 4. Merge | Merge only after all five gates PASS on the exact revision. | Pending; not eligible. |
| 5. Tag | Tag the verified candidate (distinct from `m4a-accepted`; no co-tagging per ADR-007 §2). | Pending; not eligible. |
| 6. Closure artifact | Author the authoritative closure record (ADR/decision log entry), not `SEC-CRIT-02-closure-report.md` as written. | Pending. |

### Commit / Merge / Tag / Evidence

- **Commit:** allowlist defined in Milestone 1; execution blocked until Milestones 2–3 clear.
- **Merge:** gated on Architecture, Security, Privacy, QA, Adversarial PASS tied to one revision.
- **Tag:** incident-closure tag must differ from `m4a-accepted`; no dual-milestone co-tagging.
- **Evidence:** must include build/source digests, activation wiring diff, race output, R13/R14 rehearsals, and the missing contract/ADR.

**PASS | FAIL:** **FAIL** — sequence is correct but cannot complete; the candidate is not activation-verified.

---

## MILESTONE 5 — INCIDENT CLOSURE DECISION

### Incident Closure Recommendation

**KEEP OPEN**

### Required Justification

- SEC-02A containment is real and verified, but the program defines closure as SEC-02D acceptance on an **activation-ready** candidate (program §5, §8). The privileged routes remain permanently disabled and the identity/generation primitives are unwired dead code.
- The only verification report asserts behaviors (target-only delivery, resume/transfer enforcement) that no production path executes; it also omits two of five required gates.
- Required program deliverables (identity-contract design, ADR/architecture-brief update) and rehearsals (race, cutover R13, rollback R14) are missing.
- Records conflict: `closure-report.md` claims release eligibility while the program and SEC-02D say BLOCKED. Closing now would freeze contradictory, unverified evidence as the closure record.

Formal closure may proceed only after Milestones 1–4 complete with activation wired, all five gates PASS on one revision, and the closure record is authored authoritatively. Until then: containment complete, incident OPEN.

---

## MILESTONE 6 — RELEASE GOVERNANCE REVIEW

### Remaining Release Blockers

| Domain | Blocker |
|---|---|
| Security | SEC-CRIT-02 OPEN; SEC-01B dependent execution/acceptance blocked; host transfer/resume disabled (functional security gap); cutover/revocation and race evidence outstanding. |
| Architecture | SEC-02B identity-contract design + SEC-02B/C ADR absent; `architecture-brief §11` not updated; M4A security acceptance blocked (per program §9). |
| QA | No SEC-02B/C `-race` evidence; R13/R14 rehearsals absent; five-gate package incomplete (Privacy, Adversarial missing). |
| Privacy | No independent Privacy gate for SEC-02B/C; volatile session/handle stores and no-raw-credential-logging invariants not independently evidenced. |
| UX | UX-01 in progress under frozen-surface gates; emergency unavailability of transfer/resume is an operational limitation, not a release exception; frontend changes uncommitted. |
| Infrastructure | Fleet-wide cutover/credential/verifier inventory unexecuted; HTTPS containment-route verification unavailable; mixed-version exposure not bounded. |

### Release Readiness

**NOT READY** — release remains BLOCKED.

---

## FINAL OUTPUT — Governance Closure Plan

| Field | Value |
|---|---|
| **Current Status** | SEC-02A/B/C/D **technically resolved**; SEC-CRIT-02 **FORMALLY OPEN**; release BLOCKED. Activation primitives exist but are unwired; all SEC-CRIT-02 artifacts untracked. |
| **Remaining Actions** | (1) Wire `handleToken`/`handleTransferHost` + bootstrap resume-handle issuance + `deliverHostCredential`; (2) write SEC-02 contract doc + ADR + architecture-brief §11; (3) run SEC-02B/C race evidence and R13/R14 rehearsals on a supported runner; (4) obtain Privacy + Adversarial gates; (5) correct `closure-report.md` and AGENTS.md; (6) commit allowlist → review → merge → tag → authoritative closure record. |
| **Responsible Owner** | PM (program/release hold); @backend (wiring + evidence); @architect (contract/ADR); @security + @reviewer (cutover/race/adversarial); @qa (suite/race artifacts); @privacy (privacy gate); @frontend/UX-01 (separate scope, excluded). |
| **Expected Exit Criteria** | All Section 6 rows pass on the exact built candidate in both issuance configurations; five independent gates PASS on one revision; reviewed patch committed/merged with clean checkout; controlled activation with contained rollback available; authoritative closure record replaces the current contradictory report. |
| **Final Recommendation** | **KEEP SEC-CRIT-02 OPEN.** Containment is complete and should be preserved; do not tag, merge, or declare release eligibility until activation is wired and independently verified. This document is a plan, not a closure signature. |
