# SEC-02A — implementation and local containment evidence

Date: 2026-09-12  
Incident: **SEC-CRIT-02 OPEN / CRITICAL — RELEASE BLOCKED**  
Status: **Implemented, built, independently reviewed, and deployed to the local meet-signal instance. Full operational/repository closure is not claimed.**

## Implemented behavior

Only `services/meet-signal/main.go` production code changed:

- `assignRole` (line 129) no longer accepts an authorization override or changes an existing room's `HostID` or host grace. Existing-host role lookup remains read-only; unknown rooms remain unhosted.
- `handleToken` (line 593) denies every present Authorization header, case-insensitively and regardless of value, with `403 host_resume_temporarily_disabled` before request-body parsing or token issuance. Credential-free guest requests always receive participant credentials and no host token in either issuance configuration.
- `handleTransferHost` (line 865) returns `503 host_transfer_temporarily_disabled` for POST. The former transfer/mint/broadcast/credential-response body is deleted, not retained as an alternate path. Unsupported methods retain 405.

Temporary behavior: host transfer and credential-based host resume are unavailable. SEC-02B/C are not implemented. Frontend source was not reviewed or modified by this work. Unrelated preexisting local changes were preserved.

## Candidate and rollback identity

| Item | Recorded value |
|---|---|
| Base HEAD | `c1b18be2b9fc0b6f0873e5e36e4917fa6f1d6100` |
| Production source SHA-256 | `bc7158cb659024ef46ec46ebfdd8dc005b40ffa0952daa681c3f97a3db3199bb` |
| New test source SHA-256 | `635a813133c35535efca6fdacfaf832ee185139b7c44e18e5b428cf0d79729a9` |
| Production/contained rollback tag | `meet-secure/meet-signal:sec02a-contained` |
| Production/contained rollback image ID | `sha256:0afe954b3d7798ab0510d622dc21d2a457dac6526e3ea1ab0fa014836f489f33` |
| Production Docker build ID | `sy5774tduf16u9inmd90hltd0` |
| Test-runner image ID | `sha256:b730800ccc2d3bac89eb80a7ffadbd360e0e4b35716fcf2d0b47b9dbbe028cc8` |
| Former local service image | `sha256:5a629a4c5581a083f79c1157715e8dfa0b0c036c238a697ba830306767c7e3a0` — vulnerable baseline, not a safe rollback target |

The existing production Dockerfile built the candidate with Go 1.22 Alpine. The contained tag is retained; the immutable image ID above identifies the actual rollback content. Source changes and evidence remain in the working tree; no new commit, merge, acceptance tag, or release was performed.

## Regression and independent review

See [independent QA report](sec-02a-test-results.md), [baseline events](sec-02a-baseline-tests.jsonl), [candidate events](sec-02a-candidate-tests.jsonl), and [Go 1.22 full/race results](sec-02a-go122-race-results.json).

- The preserved vulnerable source failed five new security test functions as expected. Actual transfer HTTP responses and all three connected peers received the target credential; `/token` replay issued replacement host authority and changed grace.
- The candidate passed **24 test functions / 68 leaf cases, zero failures or skips**, including seven new SEC-02A functions, both issuance modes, real signed still-valid B/C-equivalent fixtures, malformed/duplicate headers, unsupported methods, actual three-peer barriers, and concurrent transfer/resume attempts.
- Supported production-toolchain verification: `go1.22.12 linux/amd64`; `go test -count=1 ./...` → `ok meet-signal 0.020s`; `go test -race -count=1 ./...` → `ok meet-signal 1.061s`; Docker build exit 0.
- Native Go 1.27 full suite also passed. Native race execution could not start because cgo was disabled; this is superseded by the successful Go 1.22 race run, not counted as a pass itself.

PM consolidated these role-specific reviews from agents independent of the production patch author. They are bounded source/test gates, not claims of fleet-wide incident closure:

| Gate | Result | Evidence and limit |
|---|---|---|
| Architecture | PASS | Independent architecture reviewer verified the three-function diff, read-only role lookup, unconditional participant issuance, removal of transfer side effects, and explicit temporary loss of functionality. |
| Security | PASS | Independent security reviewer verified denial by header presence before issuance, deletion of host-token exchange, and deletion of transfer token distribution. Deployment/revocation was outside this source gate. |
| Privacy | PASS | Separate privacy assessment by the independent architecture reviewer: no new persistence, credential logging, identifying error content, or third-party data flow; transfer credential distribution and its identifying log removed. |
| QA | PASS | QA authored and ran regression tests separately from the production patch author; baseline failures and exact candidate passes documented in the linked report. |
| Adversarial | PASS | Separate adversarial assessment by the independent security reviewer challenged header variants, method ordering, role-lookup promotion, transfer replay, and disclosure. The noted non-POST test gap was subsequently covered by QA. |

## Runtime verification and local rollout

1. Built and ran the production candidate on isolated localhost ports 18080/19091 using synthetic credentials. A real host creation succeeded; replay of its signed host credential to `/token` returned 403; transfer returned 503; ordinary guest issuance returned participant role with no host token; authority fields were unchanged. [Isolated runtime results](sec-02a-isolated-runtime.json).
2. Read the local instance's Compose provenance and compared its effective environment against `infra/compose.yaml` without logging secret values. **Zero environment changes** were found.
3. Immediately before local replacement, checked all four relevant gauges: signaling rooms 0, signaling connections 0, LiveKit rooms 0, LiveKit participants 0. The deployment command would stop if a gauge was missing or nonzero.
4. Retagged the verified contained image as `meet-secure/meet-signal:local` and recreated **only** `meet-secure-p0-meet-signal-1` with `docker compose -p meet-secure-p0 -f infra/compose.yaml up --no-deps --force-recreate --wait meet-signal`. The command exited 0 and the container became healthy. No media service, shared secret, database, or unrelated container was changed.
5. Inspected the replacement container: running/healthy, started at `2026-09-12T19:14:28.017361284Z`, exact image ID `sha256:0afe954b3d7798ab0510d622dc21d2a457dac6526e3ea1ab0fa014836f489f33`. The local Compose inventory showed one meet-signal service instance.
6. Actual served endpoints on `127.0.0.1:8080` returned health OK, resume 403, and transfer 503 with stable errors. These final probes were stateless; real signed fixtures and guest issuance were already verified in the identical isolated image. [Local deployment results](sec-02a-local-deployment.json).
7. Caddy's HTTP entry at `http://127.0.0.1` returned the same 403/503 errors. Both tested HTTPS entries failed TLS negotiation before any HTTP response, even with local certificate trust verification skipped. **HTTPS containment-route verification remains unavailable**, and no TLS configuration change was made. [Accurate ingress results](sec-02a-local-ingress.json).
8. Removed the task-owned isolated verification container and its synthetic room state after checking its ownership label. The deployed service, contained rollback image, and evidence remain available.

The first isolated smoke harness needed correction for PowerShell 7 response handling and the authority endpoint's per-response timestamp. The first ingress harness also needed terminating error handling so failed HTTPS requests could not reuse prior HTTP results. The saved artifacts are the corrected executions: authority comparison excludes only the changing response timestamp, and failed HTTPS routes are explicitly not marked PASS. No application code was changed in response to those harness issues.

## Credential cutover and remaining limits

The local service replacement discards its former volatile authority/key state. There were no reported active signaling/media sessions to drain at that moment. No old Authorization credential can resume or transfer authority through the two contained handlers, because they no longer interpret credentials for those operations.

**This is not universal token revocation.** Legacy and LiveKit shared signing secrets were preserved. Other accepting services or routes are not established as rejecting every previously issued token by this scoped patch. The separate credential/verifier inventory and any required coordinated retirement remain outstanding under the remediation program. No external environment or fleet was inventoried or deployed.

Local source/test/container evidence is sufficient to report implemented and locally deployed containment. It does not prove the program's full all-instance cutover condition, HTTPS route behavior, global credential invalidation, repository closure, or permanent authority security. Do not label SEC-CRIT-02 closed or release eligible.

## Safe rollback and next action

The recorded contained image is the safe rollback artifact. If later candidates fail, restore this exact contained image while preserving the current configuration and any later credential invalidation. Keep transfer/resume disabled. Never restore the former vulnerable image or old authority/session state as a rollback shortcut. The contained image's build/start/health/HTTP behavior is verified; a later-generation rollback rehearsal is still a future verification requirement.

Next engineering work is SEC-02B private identity binding followed by SEC-02C generation/atomicity, subject to the program's containment closure and integration gates. Repository review/commit/merge, broader cutover evidence, and SEC-02D remain outstanding. **SEC-01A stays complete in its frontend scope; UX-01 continues under its existing boundaries; release remains BLOCKED.**
