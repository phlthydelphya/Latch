# Latch V1 Release Gates

**Status:** NOT YET VERIFIED — evidence required; no gate is claimed passed
**Authority:** [`docs/releases/v1-scope.md`](v1-scope.md), applicable milestone records, and the five-gate review model
**Purpose:** Documentation-only release governance for a V1 release candidate (RC). This plan turns the V1 verification scope into a repeatable evidence and exit process; it does not authorize implementation changes.
**Ticket plan:** [`docs/releases/v1-release-tickets.md`](v1-release-tickets.md) breaks all ten phases into actionable tickets with R.A.C.E. assignments; every ticket defaults to `NOT YET VERIFIED`.

## 1. Governance and decision rules

This plan supplements, and does not replace, milestone acceptance or the required five gates:

1. **Architecture** — @architect, with adversarial architecture review where applicable.
2. **Security** — @security.
3. **Privacy** — @privacy.
4. **QA** — @qa.
5. **Adversarial** — @reviewer.

All five gates must have independent evidence, a reviewer verdict, and a recorded date before release approval. A V1 checklist result is not a substitute for a milestone gate, an ADR decision, or an acceptance tag. In particular, this plan does not override ADR-002, ADR-006, ADR-007, `docs/gates/architecture-exit-checklist.md`, or any active milestone exit criteria.

Use only these statuses in the plan and evidence index:

- `NOT YET VERIFIED` — no qualifying evidence has been recorded.
- `EVIDENCE REQUIRED` — the check is in scope but its artifact is missing or incomplete.
- `BLOCKED` — the check cannot proceed; record the concrete blocker.
- `REVIEW REQUIRED` — evidence exists but the responsible reviewer has not decided.
- `PASS` / `FAIL` — reserved for the responsible reviewer’s recorded result; this document makes no such claims.

No phase may be marked complete from a partial run, an undocumented manual observation, or a result from a non-RC build. Retest after a code, dependency, configuration, infrastructure, or security-relevant change.

## 2. Explicit release freeze

### In scope for V1

- Invitation links and ADR-006 fragment/key boundary.
- Waiting room, admission/rejection, server-authoritative host/co-host controls, and leave/transfer behavior.
- Camera, microphone, screen sharing, device selection/switching, and explicit encryption-state/fallback messaging.
- Gallery, speaker, multi-pin, and screen-share layouts at the supported participant and stream limits.
- Reconnect and session resume behavior.
- Responsive mobile web and installable PWA behavior.
- Accessibility, privacy-safe operational behavior, authentication/authorization, encrypted media, key handling, and abuse-resistant room access.
- Release packaging, reproducibility, rollback evidence, and the five independent governance gates.

### Frozen out of scope

The RC must not add or silently expand scope to include:

- AI summaries, transcripts, assistants, bots, attention/gaze tracking, usage or engagement analytics, or behavioral telemetry.
- Cloud recording, server-side archiving, cloud transcription, or server-side media transcoding/processing.
- Breakouts, polls, reactions, whiteboards, virtual backgrounds, captions, webinar fanout, HLS, P2P/SFU handoff, or WebTransport unless separately accepted by the applicable milestone authority.
- A native mobile application; this plan verifies supported mobile browsers and PWA installation only.
- A silent DTLS-only downgrade, a claim that the SFU can decrypt SFrame, or any server access to plaintext media or client encryption keys.
- Brand, repository, service, infrastructure, metric, JWT issuer, or HRW identifier renames. ADR-007 remains planning-only with code authorization blocked; its HRW node IDs and salt stability rules remain binding.

Any requested exception requires a separately recorded decision and re-baselining of the RC. It must not be hidden as a test configuration change.

## 3. Ten-phase verification plan

Each phase is `NOT YET VERIFIED` until its exit criteria and evidence links are recorded in the evidence index. Phase exits are cumulative: a later phase cannot waive an earlier failure.

### Phase 1 — Scope, freeze, and verification charter

**Checks:** Confirm the candidate’s feature list against `v1-scope.md`, enumerate exclusions, identify supported browsers/devices, define test data and retention, and record the exact commit/build inputs.

**Exit criteria:** Scope freeze is signed by the PM; no unapproved feature or namespace change is present; test owners, environments, thresholds, and artifact paths are assigned; baseline is reproducible.

**Status:** `NOT YET VERIFIED` — evidence required: signed scope freeze, RC manifest, environment manifest, and change inventory.

### Phase 2 — Candidate build, provenance, and deployment readiness

**Checks:** Build the candidate from a clean, identified revision; record dependency locks, generated assets, configuration class (test/staging), migration/rollback procedure, security headers, and deployment health checks. Verify that release artifacts contain no secrets.

**Exit criteria:** A clean-build transcript and checksums exist; the same artifact is used for all subsequent phases; startup/health and rollback procedures are documented; no unexplained dirty-tree or local-only input is part of the candidate.

**Status:** `NOT YET VERIFIED` — evidence required: build log, checksums, SBOM/dependency report, configuration redaction review, deployment and rollback transcripts.

### Phase 3 — Desktop browser compatibility and core journeys

**Checks:** Run fresh-room, invitation, waiting-room, admission/rejection, host transfer, publish/subscribe, mute/camera, screen share where supported, leave, and rejoin journeys on the matrix below. Record browser version, OS, device, result, and known limitations.

**Exit criteria:** Every supported core journey has a reproducible result on each required matrix row; failures are fixed, explicitly accepted by the applicable gate, or block the RC. No browser may silently bypass authorization or encryption messaging.

**Status:** `NOT YET VERIFIED` — evidence required: browser matrix, automated results where available, manual run sheets, screenshots/video for failure states, and defect disposition.

### Phase 4 — Mobile browser and PWA lifecycle

**Checks:** Verify responsive layout, install/add-to-home-screen, launch, update, cache refresh, foreground/background transitions, lock/unlock, network changes, permission prompts, orientation, reconnect, and safe uninstall. Test screen share only where the platform exposes it.

**Exit criteria:** Supported mobile rows complete the documented journeys without stale authorization, key leakage, unsafe cache behavior, or misleading capability claims; unsupported capabilities are clearly labeled; PWA update and rollback behavior is evidenced.

**Status:** `NOT YET VERIFIED` — evidence required: device recordings/screenshots, install/update logs, lifecycle run sheets, and platform capability notes.

### Phase 5 — Room authority, invitation, and abuse-resistant access

**Checks:** Verify server-authoritative host/co-host actions, forged client-role rejection, host transfer and succession/grace behavior, waiting-room admission/rejection, lock state, invite fragment isolation, room authorization, expiry/replay handling, refresh/reconnect, and denied admission.

**Exit criteria:** Protected actions execute only after valid server-verifiable authorization; unauthorized and stale directives are rejected; invitation keys never reach request URLs, server logs, analytics, or telemetry; all negative cases have evidence.

**Status:** `NOT YET VERIFIED` — evidence required: authorization test report, signaling traces with secrets redacted, invite URL/network inspection, negative-case logs, and reviewer disposition.

### Phase 6 — Media, device, encryption, and recovery behavior

**Checks:** Verify camera/microphone/screen-share permissions, device selection and switching, publication state, key lifecycle/rotation, ciphertext-on-wire and opaque-SFU properties, explicit fallback messaging, reconnect/session resume, TURN relay behavior, and leave-time cleanup.

**Exit criteria:** Supported media paths meet the declared encryption contract; no plaintext or key material is exposed in service logs or captures; fallback is explicit and never silent; reconnect and rotation meet the current approved thresholds; device denial and loss are recoverable and visible.

**Status:** `NOT YET VERIFIED` — evidence required: media/encryption capture, key-rotation and reconnect histograms, TURN proof, device matrix, and ADR-002-aligned fallback review.

### Phase 7 — Multi-participant and multi-room stress

**Checks:** Exercise the supported 20-participant room and the P0 Compose parity envelope of up to 50 rooms on the declared 4 vCPU/8 GB target. Include join bursts, simultaneous publish/subscribe, screen-share contention, mute/speaking churn, host transfer under load, reconnect storms, room teardown, and concurrent rooms.

**Required cases:**

| Case | Minimum scenario | Evidence required |
|---|---|---|
| A | 20 participants: 1 host + 19 guests, camera/mic, gallery/speaker transitions | Participant/service logs, latency and error histograms |
| B | 20 participants with screen share and pin/layout churn | CPU/RAM/network, stream stability, UI result |
| C | Join burst and reconnect storm during an active room | Join/reconnect p50/p95, dropped sessions, authorization continuity |
| D | Host disconnect, grace period, transfer/succession, and rejoin | Authority timeline and protected-action results |
| E | At least 50 concurrent rooms within the Compose target | Room/connection gauges, resource envelope, failed-room count |
| F | Concurrent rooms with isolated invitations and keys | Cross-room isolation traces and negative access results |

**Exit criteria:** Results meet the currently approved architecture/QA thresholds, resource ceilings, and room/participant limits; no cross-room media, authority, key, or log leakage occurs; any capacity limit is user-visible and documented. This phase does not authorize changing the limits to make a failure pass.

**Status:** `NOT YET VERIFIED` — evidence required: load profile, raw histograms, service/SFU metrics, resource captures, and incident/defect disposition.

### Phase 8 — Accessibility and usable failure states

**Checks:** Verify keyboard-only operation, focus order and focus return, visible focus, accessible names/roles/states, dialogs, waiting-room status, host controls, live announcements, contrast, reduced motion, zoom/reflow, touch target usability, captions of system state where applicable, and readable encryption/fallback/error messages.

**Exit criteria:** Automated scans plus manual assistive-technology review cover all critical journeys; no unresolved release-blocking accessibility issue remains; permission denial, waiting, reconnect, lock, rejection, and encryption warnings are understandable without relying on color, audio, or hover.

**Status:** `NOT YET VERIFIED` — evidence required: accessibility scan output, keyboard/AT run sheet, viewport/zoom captures, and @qa/@privacy disposition of findings.

### Phase 9 — Security, privacy, and adversarial review

**Checks:** Re-run authentication/authorization and abuse cases; inspect CSP and security headers; dependency and secret scans; invite bearer handling; token expiry/audience/issuer/role validation; rate/room abuse controls; sanitized logs; retention/deletion behavior; no analytics or prohibited product features; and adversarial challenges to E2EE honesty, mobile caching, TURN, reconnect, and host authority.

**Exit criteria:** @security, @privacy, and @reviewer each have independent written verdicts; no unresolved high-severity issue remains; privacy inventory and data-flow evidence match the shipped candidate; any risk acceptance names an owner, expiry/condition, and rollback or mitigation.

**Status:** `NOT YET VERIFIED` — evidence required: security review, privacy review, adversarial challenge report, scan outputs, data-flow/log samples, and risk register.

### Phase 10 — Evidence reconciliation and release decision

**Checks:** Reconcile every phase artifact to the exact RC checksum; confirm all five gates and applicable milestone exits; review open issues, waivers, rollback readiness, support notes, and final release communication.

**Exit criteria:** The evidence index has no unowned `EVIDENCE REQUIRED`, `BLOCKED`, or unexplained `FAIL`; all five gates are independently recorded as approved; scope and ADR constraints are still satisfied; the release authority records GO or NO-GO for this exact candidate. A later rebuild requires a new RC review.

**Status:** `NOT YET VERIFIED` — evidence required: completed evidence index, five gate records, milestone/ADR cross-reference, risk/waiver register, rollback proof, and final release decision.

## 4. Browser and mobile coverage matrix

The matrix is a minimum planning set, not a claim of support or a claim that any row has passed. Record exact versions and device models in the evidence artifact.

| Surface | Required coverage | Core focus |
|---|---|---|
| Desktop Chromium | Current supported Chrome and Edge on Windows; current Chrome on macOS | Join, permissions, publish/subscribe, layouts, screen share, reconnect, PWA |
| Desktop Firefox | Current supported Firefox on Windows and macOS | Core journeys, device switching, permissions, reconnect, encryption state |
| Desktop Safari | Current supported Safari on macOS | Core journeys, screen-share capability note, PWA/browser behavior, reconnect |
| iPhone/iPad | Current supported iOS/iPadOS Safari, including installed PWA | Lifecycle, permissions, orientation, reconnect, install/update, capability limits |
| Android phone/tablet | Current supported Chrome on representative phone and tablet | Lifecycle, permissions, responsive layout, install/update, reconnect |
| Assistive technology | At least one keyboard-only pass and one supported screen-reader pass on the primary desktop browser; mobile accessibility pass on one iOS and one Android device | Names, focus, announcements, dialogs, warnings, recovery |

If a platform cannot provide a feature, mark it `SUPPORTED WITH LIMITATION` or `NOT SUPPORTED`, explain the user-visible behavior, and ensure the product does not imply otherwise. A missing platform run is `EVIDENCE REQUIRED`, not a pass.

## 5. Evidence folder and index structure

Evidence must be stored outside application source and must not contain real participant PII, invitation keys, plaintext media, private keys, bearer tokens, or unredacted network captures. Use synthetic identities and redact artifacts before indexing.

```text
qa/reports/v1-release/<rc-id>/
├── manifest.json                 # commit, checksum, dates, environment, owners
├── index.md                     # phase/status/artifact/reviewer cross-reference
├── phase-01-scope/
├── phase-02-build/
├── phase-03-desktop/
├── phase-04-mobile-pwa/
├── phase-05-authority-invitations/
├── phase-06-media-encryption-recovery/
├── phase-07-stress/
├── phase-08-accessibility/
├── phase-09-security-privacy-adversarial/
├── phase-10-reconciliation/
├── gates/                       # Architecture, Security, Privacy, QA, Adversarial
├── waivers/
└── rollback/
```

Every artifact entry must include: phase, check ID, candidate checksum, environment, command or procedure, timestamp, result status, owner, reviewer, redaction statement, and reproduction location. Raw evidence may be retained according to the approved retention policy; the index must not become a second telemetry system.

## 6. Release-candidate rules

- An RC is an immutable, uniquely named artifact tied to one revision and dependency/configuration manifest.
- Only the RC may be used for release-gate runs. A local patch, unpinned dependency, or post-test rebuild invalidates affected evidence.
- RCs are promoted only after Phase 1 freeze and Phase 2 provenance evidence are `PASS` by their owners; this is not release approval.
- Any change to application code, tests, infrastructure, dependencies, security configuration, data handling, or user-visible scope creates a new RC and requires impact analysis and rerun of affected phases.
- A waiver must be explicit, time/condition bounded, owned, risk-assessed, and approved by the responsible governance gate; waivers cannot excuse prohibited features, silent downgrade, missing five-gate approval, or an ADR conflict.
- Release approval is for one exact RC. Tags, merge status, and milestone closure must be independently verified from repository evidence; this document does not create or imply an acceptance tag.
- Do not describe an unverified phase, RC, milestone, or gate as passed, complete, production-ready, or fully accepted.

## 7. Final release conditions

The final release decision remains `NOT YET VERIFIED` until all conditions below are evidenced for the same RC:

- Phases 1–10 have an indexed result and accountable owner.
- All in-scope critical journeys pass on the declared browser/mobile matrix, or an explicitly approved limitation is user-visible and within scope.
- Multi-participant and multi-room stress evidence meets the approved limits and shows no isolation or authorization failure.
- PWA, accessibility, security, privacy, and adversarial evidence is reviewed.
- Architecture, Security, Privacy, QA, and Adversarial gates are independently approved; no gate is inferred from this plan.
- No prohibited feature, unapproved scope expansion, silent encryption downgrade, or ADR conflict is present.
- Open risks have approved, bounded waivers or are closed; rollback is tested and available.
- The release authority records `GO` or `NO-GO` against the exact RC checksum and identifies the next review point.

Until those conditions are met, the only accurate release statement is: **V1 release gates are NOT YET VERIFIED; evidence is required.**
