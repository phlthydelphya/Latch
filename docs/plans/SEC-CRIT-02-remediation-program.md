# SEC-CRIT-02 — Executable Remediation Program

Date: 2026-09-12  
Program owner: PM  
Implementation owner: @backend  
Status: **SEC-02A implemented, tested, independently reviewed, and deployed locally; full operational/repository closure pending. SEC-02B/C permanent remediation and SEC-02D final verification remain pending.**  
Priority: **P0 / Critical; exploitability HIGH; release BLOCKED**

## SECTION 1 — INCIDENT SUMMARY

SEC-CRIT-02 is confirmed. `handleTransferHost` discloses the target host credential room-wide; `handleToken` accepts it without independent subject ownership; `assignRole` replaces `HostID` with a newly generated participant identity; the server issues a new host credential to the attacker.

Authority: [confirmed adjudication](../reviews/SEC-CRIT-02-backend-host-credential-replay.md). Enabling source remains at `services/meet-signal/main.go:925–942`, `630–650`, and `129–157`. The outgoing host also receives the target credential in the transfer HTTP response (`947–952`). Direct replay to the transfer handler (`891–912`) is an additional source-derived test requirement, not a newly executed exploit claim.

This program accepts frontend Verify→Mutate, the closed bypass, and frontend verification as functioning. It does not review or reopen frontend findings. Implementation focus is the three named backend functions; minimal supporting types/helpers in the same file and backend tests are identified explicitly below. No new implementation is authorized or executed merely by producing these tickets.

The four tickets are child milestones of **SEC-CRIT-02**, not renames of SEC-01A or SEC-01B. Their dependency chain is:

**SEC-02A containment → SEC-02B identity contract/implementation → SEC-02C generation enforcement → SEC-02D independent verification → incident closure assessment.**

SEC-02B design and SEC-02D test preparation may proceed while SEC-02A is being delivered. Unsafe transfer and host resume stay disabled until SEC-02B/C and SEC-02D acceptance pass. Closing SEC-02A means contained, not release-eligible.

## SECTION 2 — SEC-02A: EMERGENCY CONTAINMENT

**Owner:** @backend. Security validation: @security; regression evidence: @qa. PM coordinates the deployment hold.

**Mission:** Stop credential disclosure and host takeover through both scoped HTTP handlers with the smallest reversible backend patch.

**Entry:** Confirmed incident; no further exploit adjudication required. Current execution evidence: [SEC-02A implementation and local containment report](../../qa/reports/sec-crit-02/sec-02a-containment.md). Source/test gates and local HTTP/container checks pass; broader credential cutover, HTTPS route verification, and repository closure remain pending.

**Scope / minimum patch:**

1. At the entry to `handleTransferHost`, return an explicit unavailable response (503 with a stable `host_transfer_temporarily_disabled` error) before authority mutation, minting, or broadcasting. Apply the restriction server-side on every reachable instance; a hidden UI control is not containment.
2. In `handleToken`, reject any request carrying an Authorization credential attempt while resume is disabled (including malformed or alternate schemes) with a defined 401/403 response. Do not silently downgrade a failed credential attempt into guest issuance. Credential-free ordinary guest requests may continue under existing guest validation and receive participant role only.
3. Remove the `isHostReconnection` promotion path and the boolean override in `assignRole`. The `/token` guest path must not write `HostID` or clear its grace. Never allow a newly generated guest ID to become host because of a supplied token or flag.
4. Remove `newHostToken` from the room-wide payload and the outgoing host's transfer response in the code prepared for later re-enablement. Public host ID and public verification key metadata are not private credentials. Re-enabling transfer is a separate gated action after SEC-02B/C/D.
5. Preserve a contained build as the rollback artifact. Prepare the explicit revocation/cutover procedure in Section 7; remove vulnerable replicas and terminate affected old sessions before declaring deployed containment effective.

**Expected limitation:** Host transfer and credential-based host resume are temporarily unavailable. Affected meetings may need to end and be recreated. Do not claim seamless recovery or release readiness for this emergency mode.

**Acceptance / success criteria:**

- Captured B, attacker-issued C, and original-host credentials cannot change authority through either scoped endpoint. Transfer returns the containment response; credential-bearing `/token` requests are denied.
- No target credential appears in any peer frame or outgoing-host response. No denied request mints a privileged credential, changes `HostID`, or cancels grace.
- Credential-free guest issuance remains participant-only in both backend token configurations.
- Tests fail on the vulnerable baseline and pass on the contained candidate; every reachable replica runs the contained build or is removed from service.
- Scope of affected rooms and old credentials is recorded; cutover/termination evidence establishes that old live connections cannot bypass containment.

**Deliverables:** Focused `main.go` patch; backend regression additions in `sec02a_containment_test.go` alongside the existing `main_test.go`; sanitized `qa/reports/sec-crit-02/sec-02a-containment.md`; tested source revision, build digest, instance inventory, and rollback digest.

**Block condition:** Any reachable instance still accepts the attack, any old connection retains an uncontained privileged path, or private target delivery is assumed without proof. Keep service restrictions in place and escalate to PM; do not enable transfer/resume.

**Stop condition:** Deployed containment passes its regression checks and the rollback artifact is recorded. Keep the parent incident OPEN and release BLOCKED.

## SECTION 3 — SEC-02B: IDENTITY BINDING

**Owner:** @backend implements; @architect owns the contract; independent @security review is required.

**Mission:** Authenticate ownership of participant identity independently of the publicly exposed host attestation.

**Entry:** SEC-02A restrictions remain active. Design may begin immediately; activation requires SEC-02C and SEC-02D.

**Scope / architectural contract:**

1. Separate host attestation from private caller authentication. A host-token signature and its `sub` alone cannot authenticate either scoped endpoint. Legacy, LiveKit, and host JWTs must not be interchangeable credential purposes.
2. Baseline design: issue a fresh, unguessable private session capability (at least 256 random bits), deliver it only in the direct room-creation/guest-bootstrap response establishing the owning participant's identity, and retain only a hash plus participant ID, room-instance ID, expiry, and session version in volatile server state. No persistent membership history, raw credential logging, or broadcast delivery. Equivalent cryptographic possession proof requires a documented architecture/security decision before substitution.
3. Derive caller identity from that server-validated private session, not request body, display name, arbitrary participant ID, or host-attestation subject. Require both the private session and a current-generation host-operation proof for privileged resume and transfer. The proof's subject and room instance must match the authenticated session and current authority. A host attestation may serve as that operation proof only if it meets the complete contract; it never substitutes for the private session. Validate the exact credential purpose, expiry, room/audience, issuer, and algorithm where signed credentials are used. Never upgrade an old proof to the current generation during validation.
4. `/token` guest issuance creates a participant identity; authenticated resume preserves the existing identity. An attempted privileged resume without valid private authentication fails closed. Host status is derived from current server authority, never an old role claim.
5. `handleTransferHost` authenticates the current host independently, verifies the target belongs to the same room through a privately authenticated server session, and sends new target credentials only to that target's authenticated channel or retrieval flow. The outgoing host receives status/public metadata only.
6. Define exact request/response fields, authentication error codes, expiration, session rotation, private delivery, and compatibility behavior. Unsupported clients receive an explicit unavailable/upgrade response; no compatibility fallback may restore host-token-only authentication or public credential delivery.

**Bootstrap dependency:** Existing host creation must be able to issue the new private session; a credential cannot be created by accepting an old host token as proof. @architect must identify and explicitly scope the smallest bootstrap/helper changes in `main.go` needed to establish this identity. Those supporting changes are a ticket dependency outside the three primary function bodies, not permission for a broad backend or frontend review. If a new client input is required, document a separate integration dependency and keep the affected features disabled until compatibility is proven. Frontend implementation is outside this program's requested execution scope.

**Acceptance / success criteria:**

- B's public attestation alone cannot resume or transfer; X's private session plus B's attestation also fails. Copying `sub` or a body ID does not change the result.
- A legitimate host resumes under the same participant ID; a legitimate A→B transfer privately delivers credentials to B alone; guests remain participants.
- Exact credential-purpose validation rejects every legacy host/access-token alternative as a substitute for new private session authentication.
- Bootstrap and delivery are demonstrated using backend integration fixtures; unsupported protocol paths remain disabled rather than silently falling back.

**Deliverables:** Backend patch/tests; `docs/design/SEC-02-session-identity-contract.md`; architecture decision recorded through the repository ADR process and referenced from architecture-brief §11 during implementation; sanitized SEC-02B evidence.

**Block condition:** The proposed caller identity can be reconstructed from a room-wide token, there is no private bootstrap/delivery path, or compatibility is unverified. Keep SEC-02A active.

**Stop condition:** Contract and implementation meet identity tests on the candidate. Do not enable privileged features until generation enforcement and independent verification pass.

## SECTION 4 — SEC-02C: AUTHORITY GENERATION HARDENING

**Owner:** @backend; design owner @architect; security challenge @security/@reviewer.

**Mission:** Make authority transitions atomic and prevent credentials from a prior host tenure or room incarnation from regaining authority.

**Entry:** SEC-02B identity and delivery contract settled. SEC-02A remains the deployed restriction until complete candidate verification.

**Scope / architectural changes:**

1. Add a server-generated, unguessable `roomInstanceId` for each new room incarnation and a monotonically increasing `authorityGeneration` within that instance. Never identify an authority tenure using reusable room ID or participant ID alone.
2. Bind host authority credentials and privileged resume handles to room instance, participant, current authority generation, purpose, expiry, and session version. A general identity session is not a permanent host grant. On a new tenure, issue fresh privileged credentials only to the independently authenticated target.
3. On transfer, succession, revocation, or authority reset, advance generation and invalidate previous privileged credentials. A→B→A requires new A credentials; A's first-tenure authority credential stays invalid. Deleted/recreated rooms reject every old instance credential.
4. Replace boolean-driven `assignRole` mutation with explicit authoritative eligibility. Guest token issuance cannot elect or replace the host. Resume preserves current host identity and only clears grace after authenticated current-generation validation.
5. Within one authority critical section (or an equivalent compare-and-swap protocol), recheck session eligibility, expected generation, current host, target eligibility, and any one-use resume handle before committing the transition. Credential minting and transition failure must have documented atomic behavior; a signing failure must not leave a falsely completed transfer.
6. Use a generation/session-bound one-use resume handle for host resume; consume it atomically and return its replacement privately. Concurrent use of the same handle has one winner. An authorized retry mechanism, if supported, must be bound to the same private session and must not create another authority transition.
7. Require transfer requests to identify the authority generation they act on. Concurrent transfers based on the same generation have one winner; the loser receives a conflict or authorization failure and does not mint usable authority. A racing old resume may not clear the new host's grace or revive stale authority.
8. Define delivery failure after a committed transition: never leak or broadcast as fallback, never report a completed usable handoff falsely, and provide private retrieval/retry bound to the committed target and generation. Signing failure before commit leaves prior authority intact.
9. Keep state volatile. A process restart or authority loss cannot restore host identity from an old token. Fail closed and use fresh bootstrap; no durable attendee ledger is introduced.

**Previously issued tokens — mandatory decision:** **YES, revoke/invalidate them for host authority.** Treat every pre-cutover host credential and attacker-issued successor in affected rooms as untrusted, along with credentials exchangeable into host authority. If exposure cannot be bounded, use all active rooms in the affected authority domain. Do not rely on short TTL or the current `HostID`, which may already belong to the attacker. Section 7 defines the cutover.

**Acceptance / success criteria:**

- Old generations, consumed resume handles, old room instances, and pre-cutover credentials fail at both privileged endpoints without mutation or privileged issuance.
- A→B→A, room recreation, transfer-versus-resume, duplicate transfer, duplicate resume, and grace/succession races have defined, asserted outcomes.
- Legitimate transfer and current-generation same-identity resume pass. No new identity is elected by `/token`.
- Signing failure leaves old authority intact; delivery failure follows the documented authenticated recovery path without broad credential disclosure.

**Deliverables:** Backend generation/atomicity patch and tests; identity-contract lifecycle supplement; sanitized SEC-02C race/revocation evidence.

**Block condition:** Check and mutation can race, an old credential is accepted after a generation/instance change, or restart restores identity from an old bearer. Keep SEC-02A active.

**Stop condition:** All lifecycle and concurrency cases pass on the integrated candidate; submit to SEC-02D. This is not an independent gate approval.

## SECTION 5 — SEC-02D: VERIFICATION & ADVERSARIAL TESTING

**Owner:** @qa owns evidence; @security and @reviewer independently attempt replay/bypass. @architect and @privacy provide their respective exit gates. @backend fixes failures but cannot approve its own patch.

**Mission:** Demonstrate that the reported exploit and its backend replay variants fail while intended backend host operations still work.

**Entry:** Test design starts with SEC-02A. Final execution targets a built SEC-02B/C candidate with an exact revision and artifact digest. No production experiment is needed to reproduce the issue.

**Scope:** Table-driven handler/authority tests; multi-peer HTTP/WebSocket integration; real signed fixture credentials; deterministic concurrency barriers; injected signing/delivery failures; private-delivery and log inspection; cutover/rollback rehearsal. Inspect actual peer frames rather than only mocked recipient lists. Do not inspect frontend implementations.

**Execution:** From `services/meet-signal`, run `go test ./...` and `go test -race ./...` on a supported runner. Run the regression matrix under legacy and LiveKit issuance configurations, with both credentials deliberately still valid and credentials deliberately expired. Rejection of a captured credential solely because it expired is not evidence of replay remediation. Capture the baseline exploit failure and candidate rejection without storing real tokens.

**Acceptance:** All required matrix rows pass with no skips; actual backend recipient frames prove target-only delivery; race tests and rollback/cutover tests pass; intended transfer and stable-identity resume pass; five independent gates return PASS against the same candidate or a traceably rebuilt identical revision. Missing evidence or a missing reviewer is not PASS.

**Deliverables:** `qa/reports/sec-crit-02/` test results, configuration manifest, source/build digests, sanitized exploit-before/after evidence, negative-state assertions, race report, revocation/cutover rehearsal, rollback rehearsal, and independent Architecture/Security/Privacy/QA/Adversarial decisions. Existing files are not claimed to exist until produced.

**Block condition:** Any replay succeeds, any identity/generation invariant fails, intended host flow fails, tests are skipped, or any independent gate is FAIL/missing. Route failures to the owning ticket; release remains blocked.

**Stop condition:** All evidence and five PASS decisions are recorded. PM applies the release restoration checklist; SEC-02D does not waive other release blockers.

## SECTION 6 — REGRESSION TEST MATRIX

Common denial assertions: expected non-success response; no unauthorized privileged token or authority event; no unauthorized change to `HostID`, generation, room instance, or grace. In race tests, compare with the winning authorized operation, not the pre-race snapshot. Test every supported credential family and both issuance configurations where applicable.

| ID | Scenario | Required result | Ticket |
|---|---|---|---|
| R01 | Three-peer A→B transfer with observer X | B alone receives private credentials. Neither X nor A's HTTP response receives B's credential. During SEC-02A transfer is unavailable. | A/B/D |
| R02 | **Token replay**: captured still-valid B or attacker-issued C submitted to `/token` | No private session ownership: denied, no replacement identity or host token. | A/B/D |
| R03 | **Transfer replay**: captured B submitted directly to `/room/transfer-host` | Denied without independent current-host session authentication. | A/B/D |
| R04 | **Subject mismatch**: X session + B attestation; body claims B | Denied; copying a subject cannot prove ownership. | B/D |
| R05 | **Wrong room**: valid credential used for another room/audience or another incarnation of the same room ID | Denied before authority mutation. | B/C/D |
| R06 | **Expired token** or session/handle; missing subject; wrong role/purpose/issuer/algorithm; invalid signature | Denied through every accepted credential path. | B/C/D |
| R07 | **Superseded generation** after transfer/succession, including A→B→A | Earlier tenure credentials remain invalid even when the participant becomes host again. | C/D |
| R08 | **Concurrent transfer**: A→B and A→C use the same expected generation | Exactly one transition commits and advances generation once. Loser receives conflict/denial and no usable authority credential. | C/D |
| R09 | **Concurrent reconnect**: two requests use the same private session and one-use resume handle | Exactly one handle consumption succeeds; same participant ID preserved; loser cannot clear grace or mint usable host authority. | C/D |
| R10 | Transfer races with reconnect or grace/succession | A valid serialized result; old work cannot overwrite or revive superseded authority. | C/D |
| R11 | Legitimate host resume and transfer; ordinary guest issuance | Authorized stable-identity resume and private transfer succeed; guests remain participants. | B/C/D |
| R12 | Signing failure, unavailable/private-channel-disconnected target, delivery failure after commit | No unauthorized transition or disclosure; no false success; documented private recovery works. | B/C/D |
| R13 | Cutover/restart/room recreation with still-valid pre-cutover ES256, legacy HS256, and LiveKit credentials plus C | None authenticates privileged routes or exchanges into a current private host session. Old authenticated connections are terminated in the rehearsal. | A/C/D |
| R14 | Rollback to contained artifact; mixed-version/old-replica check | Restrictions remain enforced on every reachable instance; no old room state or credential acceptance returns. | A/D |
| R15 | Full backend suite, race detector, credential/log hygiene | All required checks pass; no real secrets in evidence and no added persistent attendee history. | D |

## SECTION 7 — ROLLBACK PLAN

### Rollout and deployment sequence

1. **Prepare:** Preserve sanitized incident evidence, identify affected running versions/rooms, assign deployment operator @backend, record source revision, build digest, current credential validators, configured signing-key families, and contained rollback artifact. Do not record actual secrets. If deployment exposure is unknown, treat the affected authority domain as exposed until bounded.
2. **Restrict:** Block transfer and host-resume traffic on all reachable instances; pause creation/admission as needed during the coordinated room reset. Restrict direct backend reachability as well as the normal ingress. Do not let a mixed fleet route requests to the vulnerable implementation.
3. **Deploy SEC-02A:** Verify handler restrictions and guest role behavior before restoring limited service. Remove every vulnerable replica. Drain/end affected rooms and terminate their established signaling/session connections; removal from a load balancer alone does not terminate existing connections. Recreate meetings through trusted fresh bootstrap rather than copying potentially attacker-controlled `HostID`.
4. **Invalidate old authority:** SEC-02A's disabled routes reject all old privileged credential attempts. At the permanent cutover, start with fresh room-instance/session state, accept only the new private-session credential purpose/version, and reject every pre-cutover host/access JWT as authentication for the scoped privileged routes. Invalidate old resume handles and authority generations. Do not mint new private sessions in exchange for old host tokens. If trustworthy authority cannot be recovered, use fresh rooms/identities instead.
5. **Verify revocation coverage:** Restart regenerates the in-memory ES256 key but does **not** revoke legacy/LiveKit HS256 tokens signed with unchanged secrets. Account for every accepted validator/key combination. Demonstrate still-valid old tokens cannot enter either privileged handler or exchange into new host credentials; terminate old sessions before reopening affected rooms. If a legacy acceptance path remains, keep it disabled or execute a coordinated relevant-key rollover before re-enablement. Do not claim system-wide revocation in another service solely from meet-signal restart.
6. **Build and verify permanent candidate:** Integrate SEC-02B/C while restrictions remain deployed. SEC-02D runs the full matrix and rehearses revocation plus rollback in an isolated environment. Resolve any explicitly identified bootstrap/client contract dependency without reopening SEC-01A. No partial B-only or C-only activation.
7. **Controlled activation:** Use fresh test rooms on the verified candidate. Demonstrate authentic transfer, reconnect, private delivery, captured-token rejection, and zero old-version traffic. Then activate only the verified cohort with sessions consistently routed to their authoritative instance; no privilege operations may fall back to an older replica. The wider release remains blocked until Section 8 passes.
8. **Record:** Attach deployment digest, instance inventory, cutover boundary, exercised scenarios, sanitized outcomes, and independent sign-offs. PM assesses incident closure and other outstanding release gates. No fixed wall-clock waiting period substitutes for scenario evidence.

Required cutover credential/verifier inventory:

| Existing credential/state | Exact coverage required before privileged re-enablement |
|---|---|
| ES256 host B and attacker-issued C | Retire old host keys on every serving instance or prove equivalent rejection of the old purpose/version/room instance at every scoped privileged verifier. A single restarted instance is insufficient. |
| Legacy HS256 credentials | Prove old credentials cannot authenticate either scoped handler or bootstrap a replacement host session. If key rollover is the chosen revocation method, replace `JWT_SECRET` at every applicable issuer/verifier and remove old-key acceptance. |
| LiveKit-signed alternatives | Apply the same privileged-handler denial proof. If system-wide LiveKit credential revocation is required or chosen, coordinate rollover/removal at its actual accepting services, including the SFU; changing meet-signal alone is not proof of that broader revocation. Record any required external verifier change as an explicit deployment dependency. |
| Existing connections and authority/session state | Terminate affected established connections; invalidate session/resume records and old room instances. Credential rejection alone does not disconnect a previously authenticated session. |

The mandatory result is rejection of all old authority-capable credentials by every relevant privileged path, with old affected sessions gone. Key rotation is one mechanism, not a substitute for acceptance-path and connection evidence. Backend generation checks must not be described as revoking an independent service's admission tokens unless that service actually enforces them.

### Rollback triggers and action

Triggers: any replay/credential disclosure, inconsistent `HostID` or generation, failed intended transfer/resume, revocation gap, old replica reachable, or material service failure attributable to the candidate.

@backend immediately disables transfer/resume and removes the candidate from privileged traffic. Roll back only to the verified **SEC-02A contained artifact**, or keep those routes unavailable if no safe rollback artifact exists. Never roll back to the vulnerable baseline.

Drain affected candidate sessions and bootstrap fresh state if correctness or ownership is uncertain. Preserve credential-purpose rejection and cutover invalidation; do not restore old authority maps, credentials, signing-key acceptance settings, or session snapshots as part of rollback. If reverting generation-aware code would drop enforcement, SEC-02A's unconditional route restrictions must remain in force. Re-run R02/R03/R13/R14 and ordinary guest checks on every reachable rollback instance.

Rollback may cause host-transfer/resume unavailability and meeting interruption. That is the documented containment state. Parent incident remains OPEN; release returns to or stays BLOCKED until the failing ticket and SEC-02D are reverified. No production deployment, connection termination, or key rotation is performed by this planning task.

## SECTION 8 — RELEASE RESTORATION CRITERIA

All conditions are conjunctive. A missing condition means BLOCKED.

- [ ] SEC-02A containment deployed/verified wherever the vulnerable build is reachable; no vulnerable replica or established session can bypass it.
- [ ] SEC-02B private caller binding and target-only delivery implemented; safe bootstrap and any explicit compatibility dependency verified. Host attestation alone is rejected by both scoped endpoints.
- [ ] SEC-02C atomic current-generation authority enforcement, stable reconnect identity, replay-resistant resume, room-instance isolation, and failure behavior implemented.
- [ ] All affected pre-cutover host credentials and attacker-issued successors invalidated for privileged acceptance; still-valid alternatives tested across ES256, legacy HS256, and LiveKit paths; affected old sessions terminated. Exposure scope or conservative domain-wide reset documented.
- [ ] All Section 6 rows pass on the exact built candidate in both issuance configurations where applicable; backend suite, race checks, private-delivery checks, intended flows, and cutover/rollback rehearsals pass without skips.
- [ ] Independent Architecture, Security, Privacy, QA, and Adversarial gates PASS with evidence tied to the candidate. Implementer does not approve their own work.
- [ ] Reviewed patch committed and merged under repository policy; delivering checkout clean; fresh `git log --oneline -5`, `git tag --list`, and `git status --porcelain=v1` captured. A clean tree is not a substitute for an incident register or security evidence.
- [ ] Controlled runtime activation confirms the tested artifact and configuration; no mixed vulnerable fleet; contained rollback remains available.
- [ ] PM records SEC-CRIT-02 closed against the verified candidate only after the preceding conditions pass. This planning document is not a closure signature.
- [ ] SEC-01B and all other still-required program/release gates pass; no other release-blocking Critical/High remains open; existing UX acceptance requirements are satisfied. Only then may overall release status become **ELIGIBLE FOR RELEASE APPROVAL**. Eligibility is not deployment approval or a release claim.

No SEC-02A-only exception, token-TTL-only exception, frontend-pass substitution, or old acceptance-tag substitution restores eligibility. Existing milestone/tag governance still applies; do not invent a new required tag or co-tag distinct milestones to represent incident closure.

## SECTION 9 — PROGRAM IMPACT

| Program | Ruling |
|---|---|
| **SEC-01A** | **FRONTEND REMEDIATION COMPLETE — unchanged.** Its bounded closure remains intact under the user's premise. This program does not re-review its implementation or treat the backend incident as proof of frontend regression. |
| **SEC-01B** | **Dependent execution/integration and acceptance BLOCKED on SEC-02D-verified incident closure.** Disjoint documentation/planning may continue. Pause overlapping host-authority changes; its transfer contract must consume the new private-session/generation rules. Existing SEC-01B requirements are not replaced by SEC-02B. |
| **UX-01** | **Continues unchanged within existing authorization and frozen-surface gates.** Design, tokens, inventories, specifications, and authorized ADR work continue. Emergency transfer/resume unavailability is an operational limitation, not permission to expand UX code scope. Any later compatibility request is separately scoped. UX progress cannot clear the release hold. |
| **M4A** | **Security/release acceptance BLOCKED by SEC-CRIT-02.** Under the current repository governance, retain: “passed technical review but has not completed repository closure, merge, and acceptance tagging.” This program makes no new milestone-closure claim. The existing `m4a-accepted` tag does not certify remediation of this new incident. |

Fresh checks on 2026-09-12 showed HEAD `c1b18be`, a dirty working tree with unrelated frontend/program artifacts, and an existing `m4a-accepted` tag. The dated AGENTS.md tag-absence statement is not repeated as fact. Neither existing tags nor the dirty tree establish incident resolution. The execution update records SEC-02A local containment only; permanent remediation and incident closure remain pending. Preserve all unrelated work.

## SECTION 10 — FINAL DISPOSITION

| Field | Decision |
|---|---|
| Incident | **SEC-CRIT-02 — CONFIRMED, OPEN, CRITICAL; exploitability HIGH** |
| Active critical path | **SEC-02A containment → SEC-02B identity binding → SEC-02C authority generation → SEC-02D independent verification** |
| Accountable owner | **PM** for program and release hold |
| Responsible implementation owner | **@backend** |
| Immediate target milestone | **SEC-02A deployed containment** |
| Incident exit target milestone | **SEC-02D verified closure candidate**, prerequisite to affected M4A release eligibility |
| Release status | **BLOCKED** |
| Current task result | **SEC-02A code/test and independent bounded gates PASS; contained image deployed to the local signaling instance. Broader cutover and repository closure pending; no incident closure or release approval.** |

Stop: SEC-02A local execution evidence is linked above. Preserve the release hold; do not treat local containment as full operational/repository closure. Restore eligibility only through every condition in Section 8.
