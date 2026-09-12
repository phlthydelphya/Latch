# SEC-CRIT-02 — Backend Host Credential Replay / Authority Reassignment

Date: 2026-09-12  
Disposition: **OPEN SECURITY INCIDENT — RELEASE BLOCKED**  
PM decision: **RETURN TO EXECUTION through the remediation workstream below.** This review defines the work; it does not implement or approve a fix.

## Finding classification

| Field | Adjudication |
|---|---|
| Tracking | **SEC-CRIT-02**, a separate backend finding linked to SEC-01A and dependency-linked to SEC-01B. Do not rename it SEC-CRIT-01B or fold it into the existing SEC-01B workstream. |
| Severity | **Critical, P0 release blocker (product/program severity).** An ordinary room peer can obtain a privileged credential through normal server delivery, replace server-authoritative host identity, and receive a new valid host credential. |
| Class | Privilege escalation through credential disclosure, replay/impersonation, missing caller binding, and unauthorized authority reassignment. |
| Exploitability | Demonstrated in the supplied Q6 evidence and supported by the current source. A peer receives a still-valid transfer token for its room, then makes a crafted backend request. No signing-key theft, signature forgery, or frontend verification failure is required. A legitimate transfer is the trigger for the reported capture path. |
| Affected system | `services/meet-signal/main.go`: `handleTransferHost`, `handleToken`, `assignRole`; room authority, credential issuance, and host transfer/reconnection. Both token issuance modes share the vulnerable decision before branching. |
| Impact boundary | Unauthorized host authority in an affected room; subsequent credentials carry that authority. This review does not establish arbitrary cross-room takeover, server compromise, media decryption, or exploitation in a deployed environment. |
| Owner | **@backend** implements. **@security** owns security validation; **@architect** owns the authentication/authority contract; **PM** owns priority, dependencies, and release hold. |
| Confidence | **High in the finding:** supplied verified exploit plus matching local source. No new runtime exploit was executed during this adjudication. |

Scope: backend only. Frontend Verify→Mutate controls are assumed correct, as instructed. Frontend source and verification implementations were not reviewed. Existing program documents were consulted only for workstream boundaries.

## Evidence and root cause

Reviewed baseline: `main`, HEAD `c1b18be2b9fc0b6f0873e5e36e4917fa6f1d6100`. The working tree contains unrelated changes; `services/meet-signal/main.go` was not reported modified by the fresh status check. Line references below describe the source reviewed on this date, not a deployment claim.

| Evidence | Source | What it establishes |
|---|---|---|
| Q1–Q2 | `main.go:925–942` | `newHostToken` is included in `host-changed` and sent to every peer returned by `h.peers(req.RoomID, nil)`, including non-target peers. |
| Q3–Q4 | `main.go:630–639` | A validated token with the matching room and host role sets `isHostReconnection=true`. This does not authenticate a separate caller identity or check that the token subject is the room's current host. |
| Q5 | `main.go:641–650`, `main.go:129–157` | The handler generates a new participant ID. A boolean reconnection flag lets `assignRole` overwrite `HostID` with that ID, clear grace, and return host role; the handler then mints a new host token. |
| Q6 | User-supplied verified exploit | Transfer token B → attacker `/token` request → attacker becomes authoritative host → new host token C. Accepted as supplied runtime evidence; not rerun here. |
| Additional disclosure | `main.go:947–952` | The HTTP transfer response also returns the target's token to the outgoing host. Removing only the broadcast leaves this recipient with the token. |
| Additional replay surface | `main.go:891–912` | Transfer itself uses the supplied token's subject as requester identity. Source analysis indicates that a holder of B can submit B to transfer authority while B's subject remains current host. This extension was not executed during this review. |

The failure is a chain: disclosure of a privileged bearer credential → treating that credential as proof of caller identity → reducing authorization to a boolean → assigning authority to a newly created identity → issuing fresh credentials for the unauthorized result. A correctly signed token proves its issuer and claims; possession of a publicly distributed host attestation does not independently identify the presenting participant.

This is distinct from SEC-01A. The backend itself certifies the attacker after its authority state changes. Correct frontend verification cannot repair that server decision.

## Release impact and immediate containment

Release eligibility is blocked now. Existing frontend passes, old acceptance tags, or a clean working tree cannot clear an open Critical. The incident is not dependent on rerunning frontend analysis.

PM assigns this incident ahead of overlapping SEC-01B backend work. Preserve the supplied exploit evidence and attach a sanitized backend reproducer and exact revision to the incident during remediation. Preserve unrelated local changes.

If an affected build is running, @backend and @security must identify affected rooms and contain the vulnerable transfer/resume routes. A safe interim option is to disable host-token-only resume and unsafe transfer until the complete contract is ready. Merely hiding transfer in the UI is insufficient. Containment does not restore release eligibility or establish that reconnect/transfer compatibility is preserved.

Previously disclosed tokens and attacker-issued successors must be invalidated, not merely excluded from future broadcasts. In affected running rooms, use an enforced authority/session generation or explicit revocation covering every accepted credential type. Restore authority only from trusted server evidence; if none exists, end and recreate the affected room under controlled remediation. Do not assume that current `HostID` is legitimate after a successful takeover. No production action is performed by this review.

## Remediation workstream

Scope for implementation: the three named backend functions and the minimal in-file authentication/authority helpers they need; regression tests in `services/meet-signal/main_test.go`; incident evidence and contract documentation. No unrelated service refactoring or frontend reinvestigation. If a safe protocol requires a new client input, @architect must specify that dependency separately; this review does not authorize client implementation.

| Stage | Owner | Deliverable and exit condition |
|---|---|---|
| Contract and containment | @architect + @security; @backend implements containment | Specify which private credential authenticates a participant, how target delivery is authenticated, stable reconnect identity, current authority generation, and invalidation. Host attestations alone must never authenticate either scoped endpoint. |
| **Phase 1 — Remove token broadcast** | @backend | Broadcast only public authority-change information. Deliver the target's credential solely to that authenticated target over a private channel or authenticated retrieval flow. Remove `newHostToken` from the outgoing host's HTTP response as well. Public verification key material may remain public. Fail closed if target identity/delivery cannot be established; never fall back to room-wide delivery. |
| **Phase 2 — Subject-binding enforcement** | @backend, contract reviewed by @architect/@security | Authenticate the caller with a separate, privately delivered participant/session credential or possession proof. Verify the credential's signature, allowed algorithm, issuer, purpose, expiry, and canonical room/audience. Where a host attestation is accepted alongside it, require `authenticated caller ID == attestation subject == current HostID`, and require the current authority/session generation. Enforce this on both `/token` host resume and `/room/transfer-host`. Reject host-token-only requests and stale, mismatched, or invalid resume attempts with a defined 401/403 response and no authority mutation. Ordinary unauthenticated guest issuance remains participant-only. |
| **Phase 3 — HostID assignment hardening** | @backend | Remove the boolean authority override from `assignRole`. Routine token issuance cannot create or replace a host. Resume preserves the authenticated current host's stable participant identity; it does not generate a replacement host ID. Validate current authority and update state atomically. Authority changes are confined to explicit, authorized creation/transfer and the approved server succession lifecycle. Bind minted credentials to the checked authority generation so stale/racing requests cannot issue usable authority. |
| Exploit regression and gate review | @qa + independent @security/@reviewer; @architect/@privacy | Capture the original attack failing, alternate replay failures, intended transfer/resume successes, and relevant backend regressions at the exact candidate revision. Obtain independent gate decisions. |
| Repository and runtime verification | @backend executes; PM coordinates | Reviewed patch committed/merged, delivering revision verified, candidate built, and runtime exploit regression verified. Required repository governance and all other release prerequisites still apply. |

**Insufficient fixes:** only deleting the broadcast field; only copying `claims.sub` into `participantID`; comparing against a body-supplied ID; requiring a signature on the already disclosed token; shortening token TTL; adding an unauthenticated nonce; checking current host outside the mutation lock. None independently establishes the caller and prevents replay across authority changes.

A nonce or one-use resume handle must be bound to the authenticated private session and current authority generation, consumed atomically, and invalidated on transfer/revocation if chosen by the contract. A public host attestation must not become the private credential by renaming it.

## Acceptance criteria and required regression tests

Every negative test must assert both the response and authoritative state: unchanged `HostID`/authority generation/grace state, no unauthorized host access token or host token, and no unauthorized authority-change event. An attempted resume must not silently become a successful privileged join.

| Test ID | Required scenario | Acceptance |
|---|---|---|
| SEC-CRIT-02-R01 | Three peers: outgoing host A, target B, attacker X; normal A→B transfer. Inspect actual backend recipient frames and HTTP response. | B alone receives its private credential. A and X receive no B credential in any response/frame. Public authority notification identifies B. Target binding comes from private authentication, not a client-supplied label. |
| SEC-CRIT-02-R02 | Original exploit, using a captured pre-fix token B to call `/token`. | Request is denied without separate matching private authentication; no token C, no new host identity, no grace cancellation. Run in legacy and LiveKit issuance configurations. |
| SEC-CRIT-02-R03 | X's valid private credential plus B's host attestation; forged body ID B; B attestation alone. | All fail. Setting a request ID or copying the attestation subject cannot impersonate B. |
| SEC-CRIT-02-R04 | B attestation alone, or X's private credential plus B attestation, submitted to `/room/transfer-host`. | No transfer. Check the additional source-derived replay path independently of `/token`. |
| SEC-CRIT-02-R05 | Outgoing A reuses A's still-unexpired prior credentials after A→B; revoked/consumed resume credentials; B→C→B authority cycle. | Previous authority generations cannot reclaim or transfer authority even if the subject later becomes host again. |
| SEC-CRIT-02-R06 | Wrong room/audience, missing subject, wrong role/purpose/issuer/algorithm, invalid signature, expired token, deleted/recreated room. | Fail closed before privileged issuance or state mutation. A recreated room cannot inherit old authority credentials. |
| SEC-CRIT-02-R07 | Valid current host reconnects within the supported grace contract using its private authentication; ordinary guest calls `/token`. | Reconnect retains the same authorized identity. Guest remains participant and cannot replace the host. Verify relevant success paths for both issuance configurations. |
| SEC-CRIT-02-R08 | Transfer races with resume, duplicate resume/replay, and grace expiry/succession. | Validation and mutation respect one authority order. Superseded work cannot overwrite the winner, clear another host's grace, or mint a credential usable for an obsolete generation. Where a one-use handle is used, at most one concurrent use succeeds. |
| SEC-CRIT-02-R09 | Missing/disconnected/unauthorized transfer target; credential minting or delivery failure. | No credential leaks or false success. The documented atomic/failure behavior preserves one authoritative host and supplies an authorized recovery path. |
| SEC-CRIT-02-R10 | Previously exposed token B and attacker-issued C after containment/reset. | Neither can resume, reassign, or exercise authority through either scoped endpoint. Current legitimate credentials still work. |
| SEC-CRIT-02-R11 | Backend test suite and race-sensitive execution; inspect emitted test evidence and logs. | Relevant service regressions pass, race checks pass on a supported runner, and evidence contains no real credentials or added persistent attendee history. |

Required backend commands during implementation: `go test ./...` and `go test -race ./...` from `services/meet-signal` on a runner supporting the race detector, plus the multi-peer WebSocket/HTTP regression above. A skipped or unsupported check is not a PASS. These checks are requirements, not execution results from this review.

Independent exit gates: **Architecture, Security, Privacy, QA, Adversarial**. The implementing owner cannot approve their own patch. Gate evidence must identify the tested revision and configuration. All three phases, exposure invalidation where applicable, original/alternate exploit rejection, and intended-flow compatibility are required; Phase 1 alone cannot close the incident.

## Program impact

| Workstream | Status and dependency |
|---|---|
| **SEC-01A** | **FRONTEND REMEDIATION COMPLETE**, retained as the instructed premise. Its bounded frontend closure is not invalidated or reopened by this backend finding. Any broader assertion that host takeover is eliminated or release is safe is withdrawn. Repository closure is a separate governance question, not re-adjudicated here. |
| **SEC-01B** | **DEPENDENT EXECUTION/ACCEPTANCE BLOCKED by SEC-CRIT-02.** Previously authorized disjoint planning/documentation may continue. Pause overlapping backend authority edits and integration dependent on this contract until incident remediation is verified. SEC-01B's existing requirements remain; its completion must additionally depend on SEC-CRIT-02 closure. |
| **UX-01** | **CONTINUES UNCHANGED within its existing authorized boundaries.** Design, tokens, specifications, inventories, and authorized ADR work may continue under existing frozen-surface and merge gates. This incident grants no broader meeting/authority code scope and no release exception. |
| Release | **BLOCKED.** Revised dependency: SEC-01A scoped completion → SEC-CRIT-02 backend remediation and independent verification → remaining SEC-01B/01C/01D and other existing release gates → eligibility assessment. Independent UX work continues alongside this sequence. |

This ruling supersedes the unsafe token-distribution premise in `docs/plans/SEC-01B-controlled-kickoff-packaging.md` B3.1 and any permission there to proceed with overlapping authority implementation before this incident is resolved. It does not erase the prior workstream or expand UX authorization.

Fresh Git inspection found an existing `m4a-accepted` tag, contrary to the dated absence claim in AGENTS.md. Its presence does not prove acceptance of a fix for this newly open incident, and this review makes no new milestone-closure claim. The delivering tree must still satisfy repository governance; Git cleanliness is not a security-issue inventory.

## Final disposition

**OPEN SECURITY INCIDENT — SEC-CRIT-02 — CRITICAL — RELEASE BLOCKED.**

The reported backend exploit is accepted as verified evidence and matches current source; **NOT REPRODUCIBLE is not the supported disposition**. Remediation ownership, three implementation phases, measurable tests, independent gates, and downstream dependencies are defined. No source code, deployment, acceptance tags, or frontend remediation was changed by this incident review.
