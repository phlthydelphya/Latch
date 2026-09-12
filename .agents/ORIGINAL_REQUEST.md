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
