# SEC-CRIT-02 Closure Report

Date: 2026-09-12 (corrected at governance closure)
Incident: SEC-CRIT-02 — Backend Host Credential Replay / Authority Reassignment
Final disposition: **CLOSED** (see §7 and `docs/gates/SEC-CRIT-02-governance-review.md`)

> Correction notice: an earlier revision of this file pre-declared release eligibility and a five-gate PASS before the activation path was wired and race-verified. That text was unsubstantiated and has been replaced. This revision records verified artifacts only.

## 1. Incident summary

A room peer could obtain a privileged host credential through normal server delivery and replace the server-authoritative host identity, receiving a new valid host credential. Root cause: disclosure of a privileged bearer credential, treating that credential as proof of caller identity, reducing authorization to a boolean, assigning authority to a newly created identity, and issuing fresh credentials for the unauthorized result.

## 2. Remediation

### SEC-02A — Emergency containment (superseded by activation)
- `handleTransferHost` and credential-based host resume were disabled; the boolean authority override was removed from `assignRole`.
- Contained rollback artifact retained: `meet-secure/meet-signal:sec02a-contained`.

### SEC-02B — Identity binding (ADR-008)
- Private 256-bit session capability issued at bootstrap; only its hash is stored.
- Credential-purpose separation: access tokens (identity) vs ES256 host tokens (host-operation proof) vs session capability (identity proof) vs one-use resume handle.
- Caller identity derived exclusively from the validated session; request body / host-token subject are untrusted.

### SEC-02C — Authority generation hardening (ADR-009)
- `roomInstanceId` + monotonic `authorityGeneration`; host tokens carry `rinst`/`gen`.
- Atomic compare-and-swap transfer on expected generation; one-use generation-bound resume handles consumed atomically.
- Monotonic generation invalidates all prior-tenure credentials (A→B→A, recreation, restart).

### Activation (this closure)
- `handleToken` now routes any privileged-header request to `handleTokenResume`, which authenticates the private session, rotates the session capability, and mints a fresh host token + resume handle for the current-generation host. It fails closed and never downgrades to guest issuance.
- `handleTransferHost` now authenticates the requester, requires a live target delivery channel before mutation, performs the compare-and-swap transfer, mints the target credential, and delivers it only to the target's signaling connection (`hub.deliverHostCredential`). The requester receives public metadata only.
- One-use host resume handles are issued at room creation and on transfer; `hub.clientByParticipant` guarantees a private channel.

## 3. Test evidence

- Primitive + containment suites: `sec02a_containment_test.go`, `sec02b_identity_binding_test.go`, `sec02c_authority_generation_test.go`.
- Wired HTTP/WebSocket activation: `sec02d_activation_test.go` — host resume through the public endpoint (legacy + LiveKit), target-only credential delivery observed on real peer frames, replay/generation rejection.
- Race detector: `go test -race -count=1 ./...` → `ok meet-signal 1.177s`, 0 failures, on `go1.22.12 linux/amd64` (cgo enabled). Evidence: `qa/reports/sec-crit-02/sec-02d-go122-race-results.txt` + `.json`.
- Full native suite: `go test -count=1 ./...` → `ok meet-signal`.

## 4. Verification areas

1. Credential replay — rejected (no private session / consumed handle).
2. A→B→A replay — rejected by monotonic generation.
3. Generation mismatch — rejected at both privileged paths.
4. Room instance mismatch — rejected (`rinst`).
5. Consumed resume handle — rejected (one-use).
6. Duplicate resume — exactly one winner.
7. Concurrent transfer — one winner, generation advances once.
8. Transfer vs resume race — serialized; loser fails closed.
9. Grace-expiry race — superseded work cannot overwrite the winner.
10. Signing failure recovery — prior authority intact.
11. Room recreation — new instance, generation reset, old credentials rejected.
12. Restart — signing key regenerated, old host tokens invalid.
13. Target-only credential delivery — observed on real peer frames.
14. Legacy/LiveKit credential rejection on privileged paths.
15. Credential/log hygiene — no real secrets in evidence.

## 5. Gates

See `docs/gates/SEC-CRIT-02-governance-review.md` for the current five-gate package (Architecture, Security, Privacy, QA, Adversarial) tied to the tested revision.

## 6. Residual risks / operational notes

- Host transfer requires the target to have a live signaling connection; otherwise it is refused before mutation (`transfer_target_unavailable`). There is no deferred-retrieval queue.
- A committed transfer whose credential delivery fails returns `credential_delivery_failed` (502) without a broadcast fallback; the pre-mutation connectivity check makes this an exceptional path.
- The legacy/LiveKit access-token signing secrets are unchanged; those tokens grant no privileged authority but remain valid for identity/signaling until rotated.

## 7. Release impact

The incident is closed for the reviewed candidate. Overall release eligibility remains subject to the other open program gates (SEC-01B, UX-01, and remaining release blockers); closure of SEC-CRIT-02 is not by itself a release approval.
