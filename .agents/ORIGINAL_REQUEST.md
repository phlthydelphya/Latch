# Original User Request

## 2026-09-12T23:00:22Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: A small focused team

This is a single self-contained analysis task; keep it small and focused. Produce a recovery, rebase, and integration plan for the SEC-01A remediation currently stored in `stash@{0}`. The plan must safely integrate SEC-01A with the active REL-01 contract without redesigning SEC-01A, SEC-02B, or SEC-02C, and assuming the backend contract is authoritative.

Working directory: `C:\Users\joshu\meet-secure-core`
Integrity mode: development

## Requirements

### R1. Stash Analysis and Inventory
Inspect `stash@{0}` to determine what files are present, which portions remain valid, and which are obsolete due to REL-01. Specifically focus on `hostControlManager.ts`, `presenceAdapter.ts`, `hostTokenVerifier.ts`, and test files. Produce a STASH INVENTORY, a list of FILES TO RECOVER, and a list of FILES TO DISCARD.

### R2. Conflict and Compatibility Assessment
Perform a conflict analysis (identifying merge conflicts with current main) and evaluate if any SEC-01A assumptions conflict with the new REL-01 mechanics (`sessionToken`, `resumeHandle`, `roomInstanceId`, `host-credential` delivery). Detail which SEC-01A controls remain required. Produce CONFLICT ANALYSIS and SEC-01A CONTROLS STILL REQUIRED sections.

### R2a. Legacy Authority Path Audit
For every recovered SEC-01A file:
- Identify any references to:
  - `newHostToken`
  - `hostKey` transfer
  - `Authorization`-only host resume
  - DataChannel credential delivery
  - implicit host restoration
  - guest fallback issuance
Classify each occurrence as KEEP, REMOVE, or REPLACE and provide justification. No recovered code may reintroduce legacy credential-transfer behavior that conflicts with REL-01, SEC-02B, or SEC-02C.

### R3. Rebase and Test Strategy
Define a step-by-step rebase plan and identify which tests must be updated to align with the new contracts. Produce TEST UPDATES REQUIRED and REBASE PLAN sections.

### R4. Project Readiness and Complexity
Define the REL-02 ACCEPTANCE CRITERIA, determine the IMPLEMENTATION COMPLEXITY, and explicitly answer READY FOR RECOVERY (YES | NO).

## Verification Resources
The generated execution plan must be reviewed by an independent Agent-as-judge before completion. The reviewer must strictly evaluate the plan against the Acceptance Criteria to ensure the "DO NOT modify" constraints (backend contract, SEC-02B/C, SEC-01A redesign) were strictly upheld.

## Acceptance Criteria

### Execution Plan Output
- [ ] Output contains exactly 10 sections matching the required format (Section 1: Stash Inventory, ..., Section 10: Ready For Recovery).
- [ ] Conflict analysis explicitly addresses interactions between SEC-01A controls and REL-01 `sessionToken`/`resumeHandle`/`roomInstanceId` concepts.
- [ ] The plan explicitly identifies and removes any legacy authority-transfer assumptions that would conflict with the REL-01 contract.
- [ ] Rebase plan relies strictly on standard git commands and clear conflict resolution steps.
- [ ] No instructions are included to redesign SEC-01A, SEC-02B, SEC-02C, or the backend contract.

## 2026-09-13T05:21:12Z

# Teamwork Project Prompt — Draft

> Requested team: Small focused team

This is a single self-contained fix; keep it small and focused.

Fix the Content Security Policy (CSP) blocking `manifest.webmanifest` and resolve the WebSocket 403 connection error on `/signal`. Ensure reliability matches the standards in `UX-STYLES-ZIP-HANDOFF-2026-09-13.md` and run eslint to remediate preexisting issues.

Working directory: `C:\Users\joshu\meet-secure-core`
Integrity mode: development

## Requirements

### R1. Fix CSP Manifest Error
The `manifest.webmanifest` is blocked by `default-src 'none'`. Update the Content Security Policy (likely in `infra/Caddyfile` or `index.html`) to allow the manifest to load properly (`manifest-src`).

### R2. Fix WebSocket 403 Error
The WebSocket connection to `/signal` is returning a 403 error. Diagnose and fix the authentication or token validation issue causing this rejection (likely involving `meet-signal` server validation or `useWebRTC.ts` token generation).

### R3. ESLint Remediation and Reliability
Run `eslint` and fix preexisting issues. Ensure all changes maintain the reliability standards and release blockers (C01, C05, C06, C08) explicitly documented in `docs/plans/UX-STYLES-ZIP-HANDOFF-2026-09-13.md`.

## Acceptance Criteria

### Testing & Verification
- [ ] **Programmatic Verification:** Agent must launch the backend services and test the connection programmatically to prove the 403 error is resolved.
- [ ] Browser console (or equivalent headless test) shows no CSP errors when loading `manifest.webmanifest`.
- [ ] WebSocket successfully connects to `/signal` without a 403 error.
- [ ] `npm run lint` passes with no errors.
- [ ] The existing test suite (`npm test`) continues to pass, ensuring C01, C05, C06, and C08 are preserved.

## 2026-09-13T10:15:29Z

Implement the M4B Collaboration Maturity architecture for Latch, enforcing the strict privacy boundary between Personal State, Shared Ephemeral State, and WebRTC Media. 

Requested team: Full team

Working directory: `C:\Users\joshu\meet-secure-core`
Integrity mode: development

Reference material: `docs/plans/M4B-collaboration-maturity.md`

## Requirements

### R1. Personal State: Dynamic Layout & Multi-Pin
Implement a client-side layout engine that transitions between Gallery, Speaker, and Dynamic views. Implement `multi-pin` allowing multiple participants to be pinned locally. The Dynamic view must use hysteresis (sensible time thresholds) for active speaker switching to prevent frantic UI jumping. This state must never be transmitted over the network.

### R2. Shared Ephemeral State: Server-Authoritative Co-Host Role
Extend the Go `meet-signal` service to support a `CO-HOST` role and a granular moderation permission matrix. Only the `HOST` can assign or revoke the `CO-HOST` role. Moderation actions (mute, remove, spotlight) must be cryptographically validated by the server against this matrix.

### R3. Roster Controls & Screen Sharing Policies
Update the frontend participant roster and controls to reflect the server-authorized permissions. Buttons for unauthorized actions should not render. Implement screen sharing policies (e.g., who is allowed to share) enforced by the signaling server, while keeping media routing opaque through the LiveKit SFU.

## Acceptance Criteria

### R1 Verification: Presentation Engine
- [ ] Vitest unit tests pass, proving that pinning a participant updates local state without triggering any signaling WebSocket messages.
- [ ] Vitest unit tests pass, proving the Dynamic Layout hysteresis logic correctly debounces rapid active-speaker changes.

### R2 Verification: Server-Authoritative Permissions
- [ ] Go unit tests (`main_test.go`) pass, verifying that a `PARTICIPANT` attempting a moderation action receives a 403/Forbidden response.
- [ ] Go unit tests pass, verifying that only a `HOST` can successfully issue an `assignCoHost` directive.

### R3 Verification: Roster & UI Alignment
- [ ] Playwright E2E tests (or Vitest component tests) pass, verifying that moderation buttons (e.g., "Remove Participant") are hidden for standard participants.
- [ ] A load test or manual verification script confirms that screen sharing tracks are terminated immediately when a host revokes sharing permissions.
