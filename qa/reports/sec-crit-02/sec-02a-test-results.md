# SEC-02A containment — independent backend QA evidence

Date: 2026-09-12  
Owner: @qa, separate from the main.go patch author  
Incident: **SEC-CRIT-02 OPEN / CRITICAL; release BLOCKED**  
Result: **PASS for the tested containment candidate, including the supported Go 1.22 full suite and race detector. Deployed containment is not established by this report.**

## Scope and candidate identity

This report covers emergency restrictions in `handleToken`, `handleTransferHost`, and `assignRole`, plus their backend regression fixtures. No frontend source was inspected or changed. SEC-01A is outside this review. SEC-02B/C identity and generation controls are not implemented or accepted by these tests.

The tested working tree is based on HEAD `c1b18be`; it is not represented as a committed or merged containment revision. Exact file hashes identify the tested content despite unrelated dirty work:

| File | SHA-256 |
|---|---|
| Candidate `services/meet-signal/main.go` | `bc7158cb659024ef46ec46ebfdd8dc005b40ffa0952daa681c3f97a3db3199bb` |
| New `services/meet-signal/sec02a_containment_test.go` | `635a813133c35535efca6fdacfaf832ee185139b7c44e18e5b428cf0d79729a9` |
| Existing `services/meet-signal/main_test.go` | `b6712005966bbe19c357bc8f6427f066c96143aa84b2de58bfa35766ed5be7e7` |
| `services/meet-signal/go.mod` | `58b66b7e4ad64d6818ecffbfbc2ae07048fb4fece05fd93b013c810f8672bda8` |
| `services/meet-signal/go.sum` | `8776c0200d66b2fdbd2dc7546b4741e46230ff490ecd153f087e8f8db7c5a033` |
| Preserved vulnerable `main.go` | `787057d642411207dd06ee180bc4db26264a97622a5a066c5eb2a9641f16ff8a` |

The vulnerable snapshot was captured before implementation at `C:\Users\joshu\AppData\Local\Temp\meet-secure-sec02a-baseline-c1b18be`. Its original `main.go`, `main_test.go`, `go.mod`, and `go.sum` were not changed. The identical new regression file was copied into that directory. Reflection checks the removed variadic authorization override without requiring source adaptation to compile the vulnerable baseline.

## Execution results

| Check | Result | Evidence |
|---|---|---|
| Vulnerable baseline: `go test -count=1 -run '^TestSEC02A' -json ./...` | **FAIL as required**, exit 1, 1.224 s. Five security test functions fail; ordinary guest and unsupported-method test functions pass. | [Baseline test events](sec-02a-baseline-tests.jsonl) |
| Contained candidate: `go test -count=1 -json ./...` | **PASS**, exit 0, 1.565 s. 24 test functions / 68 leaf cases, zero failures and zero skips. Includes 17 existing functions and seven new SEC-02A functions. | [Candidate test events](sec-02a-candidate-tests.jsonl) |
| Native `go test -race -count=1 ./...` | **Unavailable**, exit 2 before test execution: Go requires cgo, which is disabled on this runner. This is not a passing race check. | [Native race attempt](sec-02a-native-race-attempt.txt) |
| Isolated Go 1.22 Alpine full suite and race detector | **PASS**, build exit 0, `go1.22.12 linux/amd64`; full suite 0.020 s, race run 1.061 s. Same final test source. | [Supported-runner results](sec-02a-go122-race-results.json) |

Native environment: Windows, Go `go1.27.0`, `CGO_ENABLED=0`. The installed Go runtime supports `TEST_TELEMETRY_DIR`; the test commands set that variable and `GOCACHE` to task-local temporary directories. No persistent Go configuration or project dependencies were changed. `GOTELEMETRYDIR` is a non-settable Go environment value and was not used as an override.

Go 1.22 matches the repository's production toolchain. Its isolated runner uses `golang:1.22-alpine` with `build-base`, copies the exact five candidate source/test/module files above, and runs `go test -count=1 ./...` followed by `go test -race -count=1 ./...`. It does not mount or mutate production containers or room state. The first request to start this build was rejected by automatic approval review because of an account usage limit; the user explicitly approved retry and PM executed the successful retry. No workaround bypassed that rejection. The unsupported native attempt is superseded by this supported, successful run.

PM supplied the captured successful build output to QA. The test-runner image is `meet-secure/meet-signal:sec02a-race-verification`, manifest-list digest `sha256:b730800ccc2d3bac89eb80a7ffadbd360e0e4b35716fcf2d0b47b9dbbe028cc8`, Docker build ID `njcnpwpqlvdo0sln01b9mhfax`. This test image is separate from the production containment image and is not a deployment claim.

## Regression matrix and observed before/after behavior

| Scenario | Vulnerable baseline | Contained candidate |
|---|---|---|
| Still-valid ES256 original-host credential to `/token` | HTTP 200, fresh identity and host credential; authority/grace changes | HTTP 403 `host_resume_temporarily_disabled`; no credential issuance or authority/grace change |
| Still-valid ES256 B with subject different from caller/current host to `/token` | HTTP 200 plus fresh host credential in both issuance modes; authority is reassigned | HTTP 403; no credential response, token-count change, or authority/grace change |
| Still-valid ES256 attacker-successor C fixture to `/token` | Accepted and reissues host authority | HTTP 403 with identical no-side-effect assertions |
| Legacy HS256 host credential, and LiveKit HS256 host credential in LiveKit mode | Failed-credential or accepted-credential path can still issue a token | HTTP 403; no fallback guest issuance. Fixtures validate their signatures and future expiry first |
| Wrong-room and expired signed host tokens | Fall through to token issuance | HTTP 403, without interpreting credentials or issuing a guest token |
| Invalid JWT, Basic scheme, lowercase bearer, missing bearer separator, empty/whitespace Authorization | Fall through to token issuance | HTTP 403 |
| Duplicate Authorization values, empty-first values, comma-combined schemes, noncanonical/mixed-case header keys, present nil-valued header | Fall through to token issuance in baseline cases | HTTP 403 for any present Authorization key |
| Credential-bearing request with malformed JSON | Body validation runs first | HTTP 403 stable containment error before JSON parsing |
| Credential-free guest, including attempted body identity/creator claim | Participant issuance succeeds | HTTP 200 with signed participant role, new participant identity, no host token, unchanged authority/grace. LiveKit metadata and alias match the signed response |
| Existing-host `assignRole` lookup while grace is active | Clears grace | Returns existing host role without modifying any authority field |
| Guest `assignRole` lookup / unknown room | Participant; unknown room remains unhosted | Same intended result; no variadic authorization override exists |
| Actual HTTP transfer using captured-equivalent B while B is current host; three actual signaling peers | HTTP 200; `newHostToken` in HTTP response and each of the three peer frames; authority/grace changes | HTTP 503 `host_transfer_temporarily_disabled`; no credentials or transfer frames; unchanged authority/grace |
| Transfer with original credential and invalid body; C; absent or malformed credentials | Credential/body processing returns 400/401/403 | Every POST returns the same HTTP 503 gate before credential/body processing |
| Concurrent transfer and credential-based resume | Concurrent replay issues credentials and changes authority | 32 workers per issuance mode (16 transfer, 16 resume), all released by one barrier: transfer 503, resume 403, no credentials, unchanged authority/grace and issued-token counter |
| GET/PUT/PATCH/DELETE/OPTIONS against each handler | HTTP 405 | HTTP 405, no credential issuance or authority change |

There are 39 Authorization-rejection leaf cases across the two issuance configurations, including the malformed-body precedence cases. Header capitalization/nil map cases are direct handler robustness checks; they are not claims that raw HTTP preserves that exact map representation. The transfer integration test uses actual HTTP and authenticated WebSockets. Its signaling fixture tokens use the supported legacy signaling format in both issuance configurations; the configured guest/token issuance path varies independently.

## Evidence quality and limits

- Host B/C fixtures are freshly generated server-signed ES256 tokens. The helper verifies the expected subject, room and role, and at least four minutes of remaining validity before replay. C is a synthetic successor with the same credential shape; the baseline replay also demonstrates issuance of a replacement host token. No captured production credential is used.
- Transfer integration uses three real authenticated signaling connections. After the synchronous transfer response, the test sends a server-side barrier to every peer. Each candidate peer's next frame must be that barrier. Baseline credential-bearing transfer frames precede it and cause explicit failures. This proves absence of the scoped transfer broadcast without treating a read timeout as success.
- Denial assertions inspect the entire `RoomAuthority` snapshot, covering `HostID`, `GraceExpiry`, timestamps, lock state and room identity. They also check the issued-token counter and responses for credential fields. The three-peer test checks actual recipient payloads, including the outgoing host and observer.
- Logs from new fixtures are suppressed. Stored artifacts contain assertion results, not JWTs, credential headers, response bodies, private keys or peer frame contents. Two pre-existing tests' JWT header prefixes were redacted from the candidate event artifact. That redaction does not alter test status, names or timing.
- Ordinary signed guest issuance and the existing backend suite pass. This report does not establish new private identity binding, generation invalidation, target-only delivery after re-enablement, or production credential revocation. Those belong to SEC-02B/C/D and operational cutover.
- The issued-token metric alone cannot prove every possible internal signing operation; the independently reviewed scoped code removal and response/peer observations supply the complementary containment evidence.
- The supported race run passed using the exact new test source. An isolated production-image build or smoke run was not used as a substitute for that test.
- No production rollout, old-session termination, affected-replica inventory, all-instance verification, cutover, rollback rehearsal, merge or incident closure was performed by this QA task. Separate PM/operator evidence is required. Parent incident remains OPEN and release BLOCKED.

## QA disposition

**Independent QA gate: PASS for the bounded SEC-02A tested candidate**, supported by the meaningful vulnerable-baseline failures, full candidate regression pass, actual three-peer recipient checks, concurrency checks, and supported Go 1.22 race pass. The QA test author did not implement the `main.go` fix.

**SEC-02A deployed-containment exit: NOT ESTABLISHED.** All-instance deployment/cutover evidence, affected old-session termination, credential/authority reset coverage, and rollback availability require separate operator/PM evidence under the remediation program. This bounded code/test gate does not accept SEC-02B/C/D, close SEC-CRIT-02, or restore release eligibility.
