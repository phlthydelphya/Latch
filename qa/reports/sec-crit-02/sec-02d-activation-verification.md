# SEC-02D — Activation Verification (wired endpoints)

Date: 2026-09-12
Incident: SEC-CRIT-02 (child milestone SEC-02D)
Candidate: `services/meet-signal/main.go` SHA-256 `d22c5b72f3ee4e0df4d6d9ba5379a1df8a7a41825741e5864f0be04924cbcac8`

## Scope

Verifies the wired public endpoints, complementing the primitive-level SEC-02B/C verification in `sec-02d-independent-verification.md`.

## Commands

- `go test -count=1 ./...` → `ok meet-signal`
- `go test -race -count=1 -v ./...` (`go1.22.12 linux/amd64`, cgo enabled) → `ok meet-signal 1.177s`, 51 top-level PASS, 0 FAIL
  - Raw: `sec-02d-go122-race-results.txt` (JWT-like strings redacted)
  - Summary: `sec-02d-go122-race-results.json`

## Wired-path results

| Acceptance | Test | Result |
|---|---|---|
| Host resume (legacy + LiveKit) | `TestSEC02DActivationHostResumeHTTP` | PASS |
| Credential rotation on resume | same | PASS (session + handle rotated) |
| Resume handle replay | same | PASS (401 `resume_handle_invalid`) |
| Rotated session reuse | same | PASS (401 `private_session_invalid`) |
| Guest participant-only issuance | same | PASS |
| Host transfer via public endpoint | `TestSEC02DActivationTransferTargetOnlyWebSocket` | PASS |
| Target-only credential delivery | same | PASS (real peer frames) |
| Requester response carries no credential | same | PASS |
| Deposed host replay cannot regain authority | `TestSEC02DReplayAndGenerationRejected` | PASS |
| Stale-generation proof rejected | same | PASS |
| Host proof required | same | PASS (403 `host_proof_required`) |

## Notes

- Native Windows host cannot run `-race` (no cgo/gcc); race evidence is from the supported linux/amd64 Go 1.22 container.
- Test fixtures are synthetic; no production credentials are present in the evidence.
