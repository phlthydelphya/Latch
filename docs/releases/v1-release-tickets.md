# Latch V1 Release Tickets

**Status:** `NOT YET VERIFIED` — planning artifact only; no ticket, phase, gate, or release decision is claimed passed.
**Authority:** [`v1-release-gates.md`](v1-release-gates.md), [`v1-scope.md`](v1-scope.md), applicable milestone records, and ADR-002, ADR-006, and ADR-007.
**Purpose:** Collapse the V1 release plan into four executive buckets while retaining the ten-phase ticket drill-down. This document authorizes no implementation or scope expansion.

## Executive release plan

The four buckets below are the only executive grouping for V1. Every ticket is assigned to exactly one bucket; the detailed ticket records remain in the appendix. All work and deliverables retain the default status **`NOT YET VERIFIED`**.

### 1. Finish V1 UX

- **Objective:** Complete and verify the user journeys, responsive/PWA lifecycle, accessibility, and understandable security/failure states required by the V1 scope.
- **Included work:** Desktop journeys and media/device paths (V1-03A–C); mobile browser and PWA lifecycle (V1-04A–C); accessibility and usable failure states (V1-08A–C).
- **Deliverables:** Versioned browser/device matrices; journey run sheets and automation output; media/device and lifecycle evidence; accessibility and failure-state reviews; defect disposition and privacy-safe evidence records.
- **Exit criteria:** Required desktop/mobile/PWA and accessibility rows have reproducible results; unsupported capabilities are labeled; authorization and encryption states are truthful; no critical usability, stale-state, or privacy blocker remains; all included tickets remain independently reviewed.
- **Accountable owner:** @qa, with @frontend and @webrtc accountable for their implementation-specific evidence and @privacy for evidence privacy review.
- **Escalation triggers:** Critical keyboard/assistive-technology failure, misleading encryption or authorization state, stale key/authority/cache state, or release-blocking journey failure → stop and route to @qa plus the owning @frontend/@webrtc/@privacy reviewer.

### 2. Build Release Evidence

- **Objective:** Establish one immutable, reproducible release candidate and assemble the architecture, provenance, deployment, media/encryption, and recovery evidence needed for review.
- **Included work:** Scope and verification charter (V1-01A–C); candidate build/provenance/deployment (V1-02A–C); media, encryption, and recovery evidence (V1-06A–C).
- **Deliverables:** Signed scope-freeze and verification charter; RC manifest, checksums, SBOM and clean-build transcript; security scan and deployment/rollback records; media, SFrame, ciphertext, TURN, key-rotation, and reconnect evidence.
- **Exit criteria:** One exact RC is reusable by every later phase; provenance and rollback are reproducible; no secret, plaintext media, or key leakage is evidenced; encryption/fallback claims are honest and ADR-002 compliant; declared recovery thresholds are measured against approved limits.
- **Accountable owner:** @qa for the evidence system and RC; @architect for architecture/ADR conformity; @security for security and encryption evidence.
- **Escalation triggers:** Dirty or mismatched RC, unpinned dependency, secret exposure, plaintext/key exposure, silent downgrade, failed recovery threshold, or unverified relay path → block the RC/evidence package and route to @qa + @architect + @security (and @reviewer where adversarial retest is required).

### 3. Prove Scale

- **Objective:** Demonstrate the declared multi-participant, multi-room, Compose parity, resource, and isolation envelope without weakening limits or privacy boundaries.
- **Included work:** Multi-participant and multi-room stress (V1-07A–C).
- **Deliverables:** Approved load profile; 20-participant room results; 50-room/4 vCPU/8 GB Compose resource time series; room/connection/error histograms; teardown and cross-room isolation traces; limitation and failure reports.
- **Exit criteria:** The declared envelope is measured, not assumed; results are compared with unchanged approved limits; authority, media, keys, invitations, and logs remain isolated across rooms; any capacity limitation is user-visible and documented.
- **Accountable owner:** @qa, with @architect accountable for confirming the P0 capacity envelope and @backend/@webrtc accountable for service/media observations.
- **Escalation triggers:** Failure above 20 participants or 50 rooms, resource ceiling breach, cross-room leakage, unexplained teardown failure, or any workaround that changes the declared limit → stop and route to @qa + @architect for a NO-GO or explicitly documented waiver path.

### 4. Obtain Five Gate Sign-offs

- **Objective:** Obtain independent Architecture, Security, Privacy, QA, and Adversarial decisions for the exact RC, then reconcile evidence and record the release decision without merging or inferring gate results.
- **Included work:** Authority, invitation, and abuse-resistant access (V1-05A–C); security/privacy/adversarial gate packages (V1-09A–C); evidence reconciliation and release decision (V1-10A–C).
- **Deliverables:** Authority and invitation-boundary reports; adversarial challenge report; independent five-gate evidence packages and verdict records; reconciled evidence index, architecture/ADR memo, risk/waiver register, and GO/NO-GO record.
- **Exit criteria:** Each gate reviewer records an independent verdict against the exact RC checksum; no unresolved release-blocking authorization, privacy, security, adversarial, evidence, or ADR issue remains; all missing evidence yields NO-GO or remains `NOT YET VERIFIED`; final decision names all five gate records.
- **Accountable owner:** @pm coordinates the packet and release decision; @architect, @security, @privacy, @qa, and @reviewer remain independently accountable for their own gates.
- **Escalation triggers:** Forged role or stale directive accepted, invitation key leakage, replay/cross-room bypass, high-severity finding, prohibited telemetry/scope, missing independent verdict, checksum mismatch, or unowned evidence → no release approval; route to the affected gate owner and @pm.

### Executive bucket-to-ticket map

| Bucket | Ticket IDs | Default status |
|---|---|---|
| Finish V1 UX | V1-03A, V1-03B, V1-03C, V1-04A, V1-04B, V1-04C, V1-08A, V1-08B, V1-08C | `NOT YET VERIFIED` |
| Build Release Evidence | V1-01A, V1-01B, V1-01C, V1-02A, V1-02B, V1-02C, V1-06A, V1-06B, V1-06C | `NOT YET VERIFIED` |
| Prove Scale | V1-07A, V1-07B, V1-07C | `NOT YET VERIFIED` |
| Obtain Five Gate Sign-offs | V1-05A, V1-05B, V1-05C, V1-09A, V1-09B, V1-09C, V1-10A, V1-10B, V1-10C | `NOT YET VERIFIED` |

## 1. Operating rules

- Every ticket below defaults to `NOT YET VERIFIED`. A ticket may not be marked `PASS` without the artifact and reviewer evidence required by the gate plan.
- Each ticket must run against the same immutable release candidate (RC) identified by checksum. A changed code, dependency, configuration, infrastructure, security, data-handling, or user-visible-scope input requires a new RC and impact review.
- The five independent gates remain separate: **Architecture** (`@architect`), **Security** (`@security`), **Privacy** (`@privacy`), **QA** (`@qa`), and **Adversarial** (`@reviewer`). No ticket owner may infer another gate’s result.
- The release freeze remains active. No AI features, meeting-content/behavioral analytics, cloud recording or archiving, cloud transcription, server-side media processing/transcoding, or other excluded product scope may be introduced.
- ADR-002 remains binding: SFrame/SFU behavior must be honest, blind-forward fallback and pivot criteria must remain explicit, and no silent DTLS-only downgrade or server plaintext access may be claimed.
- ADR-006 remains binding: invitation keys stay in the URL fragment boundary, possession of the complete link remains a bearer/decryption capability, and admission remains separately controlled.
- ADR-007 remains binding: the Latch rename is planning-only with code authorization blocked; repository/service namespaces, metric names, JWT issuer, HRW node IDs, and HRW salt stability are not release-ticket scope. M4A/M4A.1 closure and tags must be verified independently and must not be co-tagged without authoritative evidence.
- Escalations record a concrete blocker and route; they do not convert missing evidence into a pass. Unresolved blockers remain `BLOCKED` or `EVIDENCE REQUIRED`.

## 2. R.A.C.E. definition and ticket status

**R.A.C.E.** means:

- **Responsible** — performs the work and assembles the evidence.
- **Accountable** — owns the phase decision and confirms the evidence is sufficient.
- **Consulted** — provides required specialist review or input; consultation does not replace an independent gate.
- **Escalation trigger/route** — condition that stops the ticket and the named route for decision, remediation, or re-baselining.

Allowed working statuses are `NOT YET VERIFIED`, `EVIDENCE REQUIRED`, `BLOCKED`, `REVIEW REQUIRED`, `PASS`, and `FAIL`; only the responsible reviewer may record `PASS` or `FAIL`. All tickets in this planning artifact start as **`NOT YET VERIFIED`**.

## Appendix A — Phase and ticket drill-down

The phase structure below is retained for execution detail and traceability only. It does not create an additional executive grouping or change the bucket assignment above.

### Original phase index

| Phase | Ticket IDs | Phase owner | Default status |
|---|---|---|---|
| 1 — Scope, freeze, charter | V1-01A, V1-01B, V1-01C | @pm | `NOT YET VERIFIED` |
| 2 — Build, provenance, deployment | V1-02A, V1-02B, V1-02C | @qa | `NOT YET VERIFIED` |
| 3 — Desktop journeys | V1-03A, V1-03B, V1-03C | @qa | `NOT YET VERIFIED` |
| 4 — Mobile/PWA lifecycle | V1-04A, V1-04B, V1-04C | @frontend | `NOT YET VERIFIED` |
| 5 — Authority, invitations, access | V1-05A, V1-05B, V1-05C | @security | `NOT YET VERIFIED` |
| 6 — Media, encryption, recovery | V1-06A, V1-06B, V1-06C | @webrtc | `NOT YET VERIFIED` |
| 7 — Stress and isolation | V1-07A, V1-07B, V1-07C | @qa | `NOT YET VERIFIED` |
| 8 — Accessibility and failures | V1-08A, V1-08B, V1-08C | @qa | `NOT YET VERIFIED` |
| 9 — Security, privacy, adversarial | V1-09A, V1-09B, V1-09C | @security | `NOT YET VERIFIED` |
| 10 — Reconciliation and decision | V1-10A, V1-10B, V1-10C | @pm | `NOT YET VERIFIED` |

## 4. Phase tickets and R.A.C.E. assignments

### Phase 1 — Scope, freeze, and verification charter

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @pm; ticket owners: V1-01A @pm, V1-01B @qa, V1-01C @architect |
| Accountable | @pm for the signed charter; @architect for architecture-boundary confirmation |
| Consulted | @architect, @security, @privacy, @qa, @reviewer, @frontend, @backend, @webrtc |
| Escalation trigger/route | Any unapproved feature, namespace/HRW change, missing owner, or ADR conflict → stop and escalate to @pm + @architect; re-baseline the RC before testing |

#### V1-01A — Freeze scope and exclusions
- **Objective:** Reconcile the candidate feature list with `v1-scope.md`, the release freeze, permanent exclusions, and ADR-002/006/007 constraints.
- **Owner:** @pm
- **Dependencies:** `v1-scope.md`; `v1-release-gates.md`; ADR-002, ADR-006, ADR-007.
- **Deliverables/artifacts:** Signed scope-freeze memo; inclusion/exclusion checklist; change inventory; namespace/HRW stability check.
- **Acceptance criteria:** Every in-scope and frozen item has an owner; no scope expansion or unauthorized rename is unresolved; memo names the exact RC input; default status `NOT YET VERIFIED`.

#### V1-01B — Define matrix, data, thresholds, and evidence map
- **Objective:** Assign browser/device rows, synthetic data rules, retention/redaction rules, thresholds, commands, and artifact paths for all ten phases.
- **Owner:** @qa
- **Dependencies:** V1-01A; browser/mobile matrix in `v1-release-gates.md`.
- **Deliverables/artifacts:** Verification charter; environment and test-data manifest; phase/check-to-artifact index; owner/reviewer roster.
- **Acceptance criteria:** Every phase and critical journey maps to a reproducible procedure, evidence path, reviewer, and threshold; no real PII, keys, tokens, private keys, plaintext media, or unredacted captures are permitted; default status `NOT YET VERIFIED`.

#### V1-01C — Validate architecture and gate plan baseline
- **Objective:** Cross-reference the charter against `docs/architecture-brief.md`, `docs/c4/p0-context.md`, applicable milestone exits, and the five independent gates.
- **Owner:** @architect
- **Dependencies:** V1-01A, V1-01B; architecture brief; C4 context; architecture exit checklist.
- **Deliverables/artifacts:** Architecture-baseline review; five-gate responsibility map; ADR constraint checklist.
- **Acceptance criteria:** No ticket substitutes for a gate, ADR, or milestone decision; ADR-002 pivot/fallback and ADR-007 freeze are explicitly represented; default status `NOT YET VERIFIED`.

### Phase 2 — Candidate build, provenance, and deployment readiness

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @qa; ticket owners: V1-02A @qa, V1-02B @security, V1-02C @backend |
| Accountable | @qa for RC reproducibility; @backend for deployment/rollback evidence |
| Consulted | @architect, @security, @privacy, @reviewer, @pm |
| Escalation trigger/route | Dirty/local-only input, checksum mismatch, secret exposure, failed health/rollback, or unpinned dependency → block RC and escalate to @qa + @backend + @security |

#### V1-02A — Produce immutable RC and provenance
- **Objective:** Build from a clean identified revision and capture the exact source, dependency, configuration, generated assets, and checksums.
- **Owner:** @qa
- **Dependencies:** V1-01A, V1-01B; approved build procedure.
- **Deliverables/artifacts:** RC manifest; clean-build transcript; artifact checksums; dependency lock/SBOM report; reproducibility record.
- **Acceptance criteria:** One immutable RC is identified and reusable by all later phases; no unexplained dirty-tree or local-only input remains; default status `NOT YET VERIFIED`.

#### V1-02B — Scan secrets, headers, and release configuration
- **Objective:** Verify release artifacts and configuration class do not expose secrets and retain required security headers and policy.
- **Owner:** @security
- **Dependencies:** V1-02A; security configuration baseline.
- **Deliverables/artifacts:** Secret-scan output; dependency/security scan; header/CSP review; redaction review.
- **Acceptance criteria:** No release secret or bearer credential is present; findings are dispositioned by @security; configuration is suitable for the declared test/staging environment; default status `NOT YET VERIFIED`.

#### V1-02C — Verify deployment health and rollback
- **Objective:** Exercise startup, health checks, deployment procedure, rollback procedure, and release artifact promotion without changing the RC.
- **Owner:** @backend
- **Dependencies:** V1-02A, V1-02B; deployment runbook.
- **Deliverables/artifacts:** Deployment transcript; health endpoint results; rollback transcript; operator runbook; failure recovery notes.
- **Acceptance criteria:** The exact RC starts and health checks are reproducible; rollback is executable and evidenced; no post-build rebuild is used; default status `NOT YET VERIFIED`.

### Phase 3 — Desktop browser compatibility and core journeys

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @qa; ticket owners: V1-03A @qa, V1-03B @frontend, V1-03C @webrtc |
| Accountable | @qa |
| Consulted | @frontend, @webrtc, @security, @privacy, @reviewer |
| Escalation trigger/route | Missing matrix row, silent authorization/encryption bypass, or release-blocking journey failure → @qa blocks phase and routes to the owning engineering gate plus @reviewer |

#### V1-03A — Execute desktop core-journey matrix
- **Objective:** Run fresh-room, invitation, waiting-room, admission/rejection, transfer, publish/subscribe, mute/camera, screen share where supported, leave, and rejoin on every required desktop row.
- **Owner:** @qa
- **Dependencies:** V1-02A–C; V1-01B matrix.
- **Deliverables/artifacts:** Versioned browser matrix; run sheets; automation output; screenshots/video for failures; defect disposition.
- **Acceptance criteria:** Each required row has a reproducible result and environment record; unsupported capabilities are labeled; default status `NOT YET VERIFIED`.

#### V1-03B — Verify desktop authorization and user-visible state
- **Objective:** Confirm desktop failures, waiting, rejection, lock, reconnect, and encryption states are accurate and cannot bypass server authority.
- **Owner:** @frontend
- **Dependencies:** V1-03A; ADR-002 and M4A authority model.
- **Deliverables/artifacts:** State-transition review; negative-case evidence; UI state inventory; defect links.
- **Acceptance criteria:** No client assertion alone executes moderation; no silent DTLS downgrade or false E2EE claim appears; default status `NOT YET VERIFIED`.

#### V1-03C — Verify desktop media and device paths
- **Objective:** Confirm camera, microphone, device switching, screen share, publication state, and reconnect behavior across supported desktop platforms.
- **Owner:** @webrtc
- **Dependencies:** V1-03A; declared media/encryption contract.
- **Deliverables/artifacts:** Device/media run sheet; permission-denial evidence; stream and reconnect observations; limitation notes.
- **Acceptance criteria:** Permission and device-loss paths are visible and recoverable; supported paths meet the declared encryption contract; default status `NOT YET VERIFIED`.

### Phase 4 — Mobile browser and PWA lifecycle

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @frontend; ticket owners: V1-04A @frontend, V1-04B @qa, V1-04C @security |
| Accountable | @frontend |
| Consulted | @qa, @webrtc, @privacy, @security, @reviewer |
| Escalation trigger/route | Stale authorization/key/cache state, misleading capability claim, unsafe lifecycle transition, or unsupported feature presented as available → block and escalate to @frontend + @security + @privacy |

#### V1-04A — Verify responsive mobile journeys
- **Objective:** Run responsive layout, permissions, orientation, network change, foreground/background, lock/unlock, reconnect, and supported screen-share behavior on iOS/iPadOS and Android rows.
- **Owner:** @frontend
- **Dependencies:** V1-02A–C; V1-01B matrix.
- **Deliverables/artifacts:** Device recordings/screenshots; lifecycle run sheets; platform capability notes; defect disposition.
- **Acceptance criteria:** Each declared mobile row has a result; unsupported features are clearly labeled; no stale authority or key exposure is observed; default status `NOT YET VERIFIED`.

#### V1-04B — Verify PWA install, update, and cache lifecycle
- **Objective:** Verify add-to-home-screen, launch, update, cache refresh, uninstall, and rollback behavior without weakening security policy.
- **Owner:** @qa
- **Dependencies:** V1-04A; RC manifest; deployment/rollback evidence from V1-02C.
- **Deliverables/artifacts:** Install/update logs; cache inspection; rollback run sheet; screenshots of lifecycle states.
- **Acceptance criteria:** Updates do not retain stale authorization or unsafe key material; the tested artifact and version are identified; default status `NOT YET VERIFIED`.

#### V1-04C — Review mobile privacy and security boundaries
- **Objective:** Inspect mobile storage, URL handling, logs, permissions, and lifecycle transitions for invitation/key, token, and privacy leakage.
- **Owner:** @security
- **Dependencies:** V1-04A, V1-04B; ADR-006; privacy data-flow rules.
- **Deliverables/artifacts:** Mobile threat review; storage/network/log inspection; remediation or risk record.
- **Acceptance criteria:** ADR-006 fragment boundary is preserved; no sensitive value is persisted or logged outside the approved boundary; default status `NOT YET VERIFIED`.

### Phase 5 — Room authority, invitation, and abuse-resistant access

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @security; ticket owners: V1-05A @backend, V1-05B @security, V1-05C @reviewer |
| Accountable | @security |
| Consulted | @architect, @privacy, @qa, @reviewer, @backend |
| Escalation trigger/route | Any forged role accepted, stale directive executed, invite key sent to a server, replay/expiry bypass, or cross-room admission → immediate block to @security + @architect; adversarial review required |

#### V1-05A — Verify authoritative room control
- **Objective:** Test host/co-host authorization, forged client-role rejection, transfer, grace/succession, waiting-room admission/rejection, lock, refresh, reconnect, and denied admission.
- **Owner:** @backend
- **Dependencies:** V1-02A; M4A authority specification; V1-01C.
- **Deliverables/artifacts:** Authorization test report; redacted signaling traces; authority timeline; negative-case logs.
- **Acceptance criteria:** Protected actions require server-verifiable authorization; stale/unauthorized directives are rejected; no client assertion is sufficient; default status `NOT YET VERIFIED`.

#### V1-05B — Verify ADR-006 invitation boundary
- **Objective:** Inspect invitation URL, browser/network behavior, logs, analytics surface, expiry/replay, and admission separation.
- **Owner:** @security
- **Dependencies:** V1-05A; ADR-006; V1-04C.
- **Deliverables/artifacts:** Invite URL/network inspection; fragment-isolation evidence; replay/expiry test report; redacted log review.
- **Acceptance criteria:** The key remains in the fragment and never reaches request URLs, server logs, analytics, or telemetry; full-link possession is treated as bearer/decryption capability; default status `NOT YET VERIFIED`.

#### V1-05C — Adversarial room-access challenge
- **Objective:** Attempt role forgery, token confusion, replay, room-ID substitution, unauthorized admission, host takeover, and cross-room access.
- **Owner:** @reviewer
- **Dependencies:** V1-05A, V1-05B; security test artifacts.
- **Deliverables/artifacts:** Adversarial challenge report; attack traces; severity register; remediation/retest requests.
- **Acceptance criteria:** All negative cases have reproducible outcomes and no unresolved release-blocking bypass; this ticket does not replace the independent Security gate; default status `NOT YET VERIFIED`.

### Phase 6 — Media, device, encryption, and recovery behavior

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @webrtc; ticket owners: V1-06A @webrtc, V1-06B @security, V1-06C @qa |
| Accountable | @webrtc for media evidence; @architect for ADR-002 conformity |
| Consulted | @architect, @security, @privacy, @qa, @reviewer |
| Escalation trigger/route | Plaintext/key exposure, silent downgrade, failed rotation/reconnect threshold, or unverified TURN path → stop and escalate to @architect + @security + @reviewer; apply ADR-002 pivot criteria if applicable |

#### V1-06A — Verify media, devices, and recovery
- **Objective:** Exercise permissions, device selection/switching, publication, screen share, reconnect/session resume, and leave cleanup.
- **Owner:** @webrtc
- **Dependencies:** V1-03C, V1-04A; approved RC and media matrix.
- **Deliverables/artifacts:** Device/media report; reconnect histogram; permission/loss recovery evidence; cleanup observations.
- **Acceptance criteria:** Supported paths are recoverable and meet approved thresholds; authorization boundaries survive reconnect; default status `NOT YET VERIFIED`.

#### V1-06B — Verify SFrame, ciphertext, keys, and honest fallback
- **Objective:** Prove ciphertext-on-wire, opaque-SFU behavior, key lifecycle/rotation, and explicit ADR-002 fallback/pivot messaging.
- **Owner:** @security
- **Dependencies:** V1-06A; ADR-002; architecture brief §8–9.
- **Deliverables/artifacts:** Redacted packet capture and inspection; key-rotation histogram; key-handling review; fallback/pivot review.
- **Acceptance criteria:** No plaintext media or client key reaches services/logs/captures; no silent DTLS-only downgrade; blind-forward trade-off and shield text are honest; default status `NOT YET VERIFIED`.

#### V1-06C — Verify TURN relay and recovery thresholds
- **Objective:** Run forced-relay and network-loss scenarios, including relay candidate proof, reconnect latency, and cleanup.
- **Owner:** @qa
- **Dependencies:** V1-06A, V1-06B; TURN proof procedure; declared thresholds.
- **Deliverables/artifacts:** TURN allocation/relay evidence; reconnect histogram; network-failure run sheet; metrics and redaction statement.
- **Acceptance criteria:** Relay behavior is evidenced under forced-relay conditions; p95 results are compared to approved thresholds; no sensitive payload or key is exposed; default status `NOT YET VERIFIED`.

### Phase 7 — Multi-participant and multi-room stress

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @qa; ticket owners: V1-07A @qa, V1-07B @backend, V1-07C @webrtc |
| Accountable | @qa; @architect confirms the P0 capacity envelope remains unchanged |
| Consulted | @architect, @backend, @webrtc, @security, @privacy, @reviewer |
| Escalation trigger/route | Failure above 20 participants, above 50 rooms, resource ceiling breach, cross-room leakage, or limit-changing workaround → stop; route to @qa + @architect and record NO-GO/waiver path |

#### V1-07A — Run 20-participant room scenarios
- **Objective:** Exercise 1 host + 19 guests with camera/mic, layout churn, screen share, host transfer, reconnect, and teardown.
- **Owner:** @qa
- **Dependencies:** V1-02A; V1-06A–C; approved load profile.
- **Deliverables/artifacts:** Load profile; raw latency/error histograms; participant/service logs; resource captures.
- **Acceptance criteria:** Results are compared with approved limits without changing limits to pass; authority and media remain isolated; default status `NOT YET VERIFIED`.

#### V1-07B — Run 50-room Compose parity envelope
- **Objective:** Exercise at least 50 concurrent rooms on the declared 4 vCPU/8 GB Compose target with room/connection/resource observation.
- **Owner:** @backend
- **Dependencies:** V1-07A; Compose parity target; deployment health evidence.
- **Deliverables/artifacts:** Resource/time-series capture; room and connection gauges; failed-room report; teardown evidence.
- **Acceptance criteria:** The declared envelope is measured, not assumed; capacity limitations are user-visible and documented; default status `NOT YET VERIFIED`.

#### V1-07C — Verify isolation under stress
- **Objective:** Test concurrent invitations, keys, authority, media, logs, reconnect storms, and room teardown for cross-room isolation.
- **Owner:** @webrtc
- **Dependencies:** V1-07A, V1-07B; ADR-006 and ADR-002 evidence requirements.
- **Deliverables/artifacts:** Cross-room isolation traces; negative access results; media/key/log leakage review; defect disposition.
- **Acceptance criteria:** No cross-room media, authority, key, or log leakage is observed; any anomaly blocks the phase; default status `NOT YET VERIFIED`.

### Phase 8 — Accessibility and usable failure states

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @qa; ticket owners: V1-08A @qa, V1-08B @frontend, V1-08C @privacy |
| Accountable | @qa |
| Consulted | @frontend, @privacy, @security, @reviewer, assistive-technology reviewer |
| Escalation trigger/route | Critical keyboard/AT failure, inaccessible security warning, or unusable waiting/reconnect/rejection state → block and route to @qa + @frontend + @privacy |

#### V1-08A — Run automated and manual accessibility coverage
- **Objective:** Cover keyboard-only, focus, names/roles/states, dialogs, contrast, reduced motion, zoom/reflow, touch targets, and assistive technology on critical journeys.
- **Owner:** @qa
- **Dependencies:** V1-03A, V1-04A; accessibility matrix.
- **Deliverables/artifacts:** Accessibility scan output; keyboard/AT run sheet; viewport/zoom captures; defect register.
- **Acceptance criteria:** Required automated and manual coverage is complete; critical findings are dispositioned; default status `NOT YET VERIFIED`.

#### V1-08B — Verify understandable failure and security states
- **Objective:** Confirm waiting, denial, rejection, lock, reconnect, device failure, and encryption/fallback warnings are understandable without color, audio, or hover.
- **Owner:** @frontend
- **Dependencies:** V1-08A; ADR-002 messaging; mobile/desktop failure evidence.
- **Deliverables/artifacts:** State/message inventory; screenshots; content and interaction review; remediation links.
- **Acceptance criteria:** User-visible state matches actual authority/encryption state; unsupported features are not implied; default status `NOT YET VERIFIED`.

#### V1-08C — Privacy review of accessibility and failure evidence
- **Objective:** Confirm recordings, screenshots, logs, and assistive-technology artifacts contain synthetic/redacted data and no invitation keys or meeting content.
- **Owner:** @privacy
- **Dependencies:** V1-08A, V1-08B; evidence redaction rules.
- **Deliverables/artifacts:** Privacy review memo; redaction checklist; retention/disposal record.
- **Acceptance criteria:** Evidence is privacy-safe and retained only under the approved policy; any exposure blocks indexing; default status `NOT YET VERIFIED`.

### Phase 9 — Security, privacy, and adversarial review

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @security, @privacy, and @reviewer independently; ticket owners: V1-09A @security, V1-09B @privacy, V1-09C @reviewer |
| Accountable | Each named gate reviewer for its own verdict; @pm coordinates, but cannot merge the verdicts |
| Consulted | @architect, @backend, @webrtc, @frontend, @qa |
| Escalation trigger/route | High-severity issue, privacy mismatch, prohibited feature, E2EE dishonesty, invite/token bypass, or missing independent verdict → no release approval; route to the affected gate reviewer and @pm |

#### V1-09A — Security gate evidence package
- **Objective:** Re-run auth/authorization, abuse, CSP/header, dependency/secret, token, invite, rate/room-control, TURN, and log-sanitization checks.
- **Owner:** @security
- **Dependencies:** Phases 2, 5, 6, and 7 evidence; exact RC checksum.
- **Deliverables/artifacts:** Security review; scan outputs; threat/abuse results; finding and risk register; independent Security gate record.
- **Acceptance criteria:** No unresolved high-severity issue; findings name owners and retest evidence; @security records a verdict against the exact RC; default status `NOT YET VERIFIED`.

#### V1-09B — Privacy gate evidence package
- **Objective:** Reconcile data inventory, flows, retention/deletion, logs/metrics, invite bearer handling, evidence redaction, and permanent product exclusions.
- **Owner:** @privacy
- **Dependencies:** Phases 1, 4, 5, 6, 8; exact RC checksum.
- **Deliverables/artifacts:** Privacy review; data-flow/inventory record; retention/deletion evidence; redacted samples; independent Privacy gate record.
- **Acceptance criteria:** Shipped behavior matches the privacy inventory; no prohibited telemetry, recording, plaintext, or key handling is present; @privacy records a verdict against the exact RC; default status `NOT YET VERIFIED`.

#### V1-09C — Adversarial gate challenge
- **Objective:** Challenge E2EE honesty, mobile caching, TURN, reconnect, host authority, invitation bearer handling, scope freeze, and release claims.
- **Owner:** @reviewer
- **Dependencies:** V1-09A, V1-09B; all phase evidence index; ADR-002/006/007 review points.
- **Deliverables/artifacts:** Adversarial challenge report; attack/reproduction traces; claim-to-evidence reconciliation; independent Adversarial gate record.
- **Acceptance criteria:** No unresolved release-blocking challenge; all accepted risks are bounded, owned, and reversible; @reviewer records a verdict against the exact RC; default status `NOT YET VERIFIED`.

### Phase 10 — Evidence reconciliation and release decision

| R.A.C.E. role | Assignment |
|---|---|
| Responsible | @pm; ticket owners: V1-10A @qa, V1-10B @architect, V1-10C @pm |
| Accountable | @pm for the release packet; release authority for GO/NO-GO; gate reviewers retain their independent decisions |
| Consulted | @architect, @security, @privacy, @qa, @reviewer, @backend, @webrtc, @frontend |
| Escalation trigger/route | Any unowned/missing evidence, checksum mismatch, unresolved blocker/fail, unverified milestone/ADR constraint, or absent gate record → no release decision; route to @pm and the responsible gate owner |

#### V1-10A — Reconcile evidence index to the RC
- **Objective:** Reconcile all phase artifacts, statuses, owners, reviewers, checksums, redaction statements, waivers, and rollback evidence.
- **Owner:** @qa
- **Dependencies:** V1-01A through V1-09C; evidence folder/index structure.
- **Deliverables/artifacts:** Completed `qa/reports/v1-release/<rc-id>/index.md`; artifact manifest; missing-evidence report; waiver/rollback cross-reference.
- **Acceptance criteria:** No unowned `EVIDENCE REQUIRED`, `BLOCKED`, unexplained `FAIL`, stale artifact, or checksum mismatch remains; default status `NOT YET VERIFIED`.

#### V1-10B — Confirm architecture, ADR, and milestone constraints
- **Objective:** Verify the exact RC against the architecture brief, C4 context, architecture exit checklist, ADR-002/006/007, release freeze, and applicable milestone/tag evidence.
- **Owner:** @architect
- **Dependencies:** V1-10A; all five gate records; fresh repository evidence where closure/tag status is relevant.
- **Deliverables/artifacts:** Architecture reconciliation memo; ADR/milestone cross-reference; constraint and no-scope-expansion attestation.
- **Acceptance criteria:** No ADR conflict, prohibited scope, unauthorized rename, silent downgrade, or unsupported closure claim remains; default status `NOT YET VERIFIED`.

#### V1-10C — Record final release decision
- **Objective:** Present the complete packet to the release authority and record GO or NO-GO for one exact RC without inferring any gate result.
- **Owner:** @pm
- **Dependencies:** V1-10A, V1-10B; independent Architecture, Security, Privacy, QA, and Adversarial gate records.
- **Deliverables/artifacts:** Final release decision; risk/waiver register; rollback/support notes; release communication; next-review point.
- **Acceptance criteria:** Decision names the exact RC checksum and all five independent gate records; any missing evidence produces `NO-GO` or remains `NOT YET VERIFIED`; default status `NOT YET VERIFIED`.

## 5. Five-gate preservation checklist

| Gate | Independent accountable reviewer | Required ticket evidence | Default status |
|---|---|---|---|
| Architecture | @architect | V1-01C, V1-06B, V1-10B plus applicable phase evidence | `NOT YET VERIFIED` |
| Security | @security | V1-02B, V1-05B, V1-09A | `NOT YET VERIFIED` |
| Privacy | @privacy | V1-04C, V1-08C, V1-09B | `NOT YET VERIFIED` |
| QA | @qa | V1-01B, V1-02A, V1-03A, V1-07A/B, V1-08A, V1-10A | `NOT YET VERIFIED` |
| Adversarial | @reviewer | V1-05C, V1-09C | `NOT YET VERIFIED` |

These rows are a responsibility map, not gate results. A ticket, phase, or gate remains unverified until its own evidence and reviewer decision are recorded. No item in this document claims a pass, milestone closure, acceptance tag, or release approval.
