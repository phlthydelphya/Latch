# V1 UX Feature Board

**Status:** `NOT YET VERIFIED` / prioritization only. This is a planning board, not an implementation report, design approval, milestone closure record, or release gate outcome.

## Board Rules

- Current implementation evidence is recorded in [`v1-current-journeys.md`](v1-current-journeys.md); this board does not override it.
- Every epic and ticket below remains `NOT YET VERIFIED` until independent evidence exists.
- The V1 scope includes device control, waiting room, host/co-host support, layouts, recovery, responsive mobile, and PWA behavior; its checklist remains evidence-required: `docs/releases/v1-scope.md:27-54`.
- **V1-UX-03 through V1-UX-08 are one unified layout-system epic, not six independent designs.** They share one information architecture, state model, responsive contract, and verification plan.

## Execution Order

### 1. Hardware Control

**Priority:** P0. **Status:** `NOT YET VERIFIED`.

**Goal:** Make permission, device selection, device loss, and local readiness states understandable and recoverable without implying that hardware was accessed when it was not.

**Tickets:**

| ID | Board item | Current evidence / next action |
|---|---|---|
| V1-UX-01 | Permission and hardware readiness states | Preflight has separate camera/microphone controls, busy states, errors, and retry actions (`src/pages/PreJoinPage.tsx:138-189,449-485`). Depends on the declared media/device contract and V1-UX-01A/V1-UX-01B. |
| V1-UX-01A | Permission state map | **Next action:** map unknown, prompt, granted, denied, blocked, busy, and unavailable states for camera and microphone across preflight, in-room settings, browser restart, and retry. Verify copy, control availability, accessibility, and truthful local-only status. |
| V1-UX-01B | Recovery design audit | **Next action:** audit permission recovery, device unplug/replug, device disappearance, browser lifecycle, and reconnect paths. Record where recovery is available, where the person is stranded, and which states need evidence rather than implementation assumptions. |
| V1-UX-02 | Device selection and switching | Preflight selects inputs and in-room settings switches inputs/outputs (`src/pages/PreJoinPage.tsx:488-513`; `src/components/devices/DeviceSettingsModal.tsx:67-94`). Depends on browser capability verification. |
| V1-UX-02A | Output-device strategy | **Next action:** document `setSinkId` support, unsupported-browser behavior, speaker-test behavior, persistence, and truthful fallback when output selection cannot be controlled. |

**Deliverables:** hardware state inventory; permission-denial and device-loss journey run sheet; supported browser/device matrix; accessible copy/state review; redacted evidence of input/output switching.

### 2. Join Experience

**Priority:** P0. **Status:** `NOT YET VERIFIED`.

**Goal:** Make invitation, preflight, admission, and join failure paths predictable, private, and truthful.

**Tickets:**

| ID | Board item | Current evidence / next action |
|---|---|---|
| V1-UX-12 | Invite link, fragment boundary, and sharing | Canonical link, copy, invitation text, and QR exist (`src/utils/roomUrl.ts:109-146`; `src/components/InviteModal.tsx:40-55,142-267`). **Next action:** perform the invitation boundary review against ADR-006, including clipboard, QR, screenshots, logs, referrers, and no-key-leak evidence. |
| V1-UX-13 | Preflight readiness and local-only media | Local preview, name validation, device controls, speaker test, and join gating exist (`src/pages/PreJoinPage.tsx:402-538`). Depends on the hardware matrix and permission-denial recovery evidence. |
| V1-UX-14 | Waiting-room admitted and denied states | Default waiting-room state, lobby, host queue, admit, admit-all, and decline paths exist (`src/host/hostControlStore.ts:29-39`; `src/components/host/HostControlsModal.tsx:332-443`; `src/pages/MeetingPage.tsx:123-159`). **Next action:** verify distinct admitted, denied, refresh, timeout, and reconnect states, including truthful authorization and safe re-entry behavior. |
| V1-UX-15 | Join failure and recovery continuity | Room-not-found/locked states and optimistic status fallback exist (`src/pages/PreJoinPage.tsx:78-94,350-395`; `src/pages/LandingPage.tsx:269-287`); reconnect has backoff and ICE restart (`src/reconnect/manager.ts:48-105`). Depends on V1-UX-01A/B, V1-UX-02A, V1-UX-12, and V1-UX-14. |

**Deliverables:** end-to-end join journey map; invitation/privacy boundary review; preflight state inventory; waiting-room admission/denial run sheet; mobile and desktop failure-state matrix; reconnect/rejoin evidence with truthful authorization and encryption states.

### 3. Co-host Model

**Priority:** P1. **Status:** `NOT YET VERIFIED`.

**Goal:** Make authority legible while preserving server-authoritative moderation and the Host > Co-host > Participant hierarchy.

**Tickets:**

| ID | Board item | Current evidence / next action |
|---|---|---|
| V1-UX-09 | Co-host assignment and removal UX | A local co-host registry and directive names exist (`src/hooks/usePermissions.ts:1-9,22-52`), but current host UI evidence does not show assignment controls. **Next action:** map assign, confirm, revoke, stale-role, reconnect, and unauthorized-action states against M4A authority evidence. |
| V1-UX-10 | Co-host moderation boundaries | The permission hook prevents co-hosts moderating the host or another co-host (`src/hooks/usePermissions.ts:93-102`), and M4A forbids client-asserted moderation (`docs/M4A-authoritative-session-control.md:198-235`). Depends on signed directive verification and adversarial review. |
| V1-UX-11 | Role visibility through transfer, reconnect, and departure | Host transfer and succession are documented (`docs/M4A-authoritative-session-control.md:166-195,239-257`), while release verification remains open (`docs/releases/v1-release-tickets.md:228-247`). Depends on refresh/reconnect and leave-governance evidence. |

**Deliverables:** role/state transition map; assignment/revoke interaction inventory; authority and stale-state copy review; negative-case matrix; server/client role reconciliation evidence; accessibility and privacy review.

### 4. Unified Layout System

**Priority:** P0. **Status:** `NOT YET VERIFIED`.

**Goal:** Verify one coherent layout system rather than design independent screens. Gallery, speaker, presentation, dynamic arbitration, pins, spotlight, PiP, filmstrip, and bandwidth modes already exist in source (`src/layout/layoutStore.ts:5-41,44-62`; `src/components/layout/LayoutControls.tsx:25-58`). This epic is primarily verification and coherence work. It does not authorize layout code changes.

**Tickets:**

| ID | Board item | Current evidence / next action |
|---|---|---|
| V1-UX-03 | Gallery view behavior | Gallery is a current layout mode (`LayoutControls.tsx:32-34`; `layoutStore.ts:44-46`). Verify participant/stream limits, tile ordering, empty states, and responsive continuity. |
| V1-UX-04 | Speaker and active-speaker behavior | Speaker mode and active-speaker arbitration exist (`LayoutControls.tsx:34-35`; `layoutStore.ts:14-16,140-159`). Verify deterministic transitions and user-facing explanation. |
| V1-UX-05 | Multi-pin behavior | Up to nine pins and clear behavior exist (`layoutStore.ts:11-12,64,87-109`; `LayoutControls.tsx:45-49`). Verify pin, multi-pin, active-speaker, spotlight, and participant arrival interactions. |
| V1-UX-06 | Screen-share/presentation behavior | Presentation is exposed when a screen-share owner exists (`LayoutControls.tsx:36-39`; `layoutStore.ts:166-185`). Verify screen-share lifecycle, filmstrip, responsive behavior, and explicit encryption/fallback states. |
| V1-UX-07 | Spotlight and shared-vs-local distinction | Controls distinguish local layout/pins from host-cleared spotlight (`LayoutControls.tsx:41-58`). Verify scope, precedence questions, and authoritative host state. |
| V1-UX-08 | Responsive layout continuity and controls | Breakpoints are specified in the draft token contract (`docs/ux/UX-F1-design-token-contract.md:239-247`), but release verification remains required (`docs/releases/v1-scope.md:35-39,49-53`). Verify desktop, tablet, mobile, filmstrip, controls, and focus behavior as one system. |
| Layout state map | Design and verification artifact | **Next action:** complete [`v1-layout-state-map.md`](v1-layout-state-map.md), then route proposed precedence questions to `@architect` and `@frontend`. No layout implementation change is part of this board item. |

**Deliverables:** one layout state/transition map; deterministic-precedence question set; responsive behavior matrix; gallery/speaker/presentation/pin/spotlight run sheets; accessibility review for controls and focus; participant/stream-limit evidence; one shared component specification. No ticket in this epic is an independent design exercise.

## Dependencies Across Epics

| Dependency | Why it matters |
|---|---|
| V1-UX-01A/B and V1-UX-02A before V1-UX-13 and V1-UX-15 | Join readiness and recovery cannot claim usable hardware behavior without permission, device-loss, switching, and output-support evidence. |
| V1-UX-12 before V1-UX-14 | Possession of the complete invitation may confer decryption capability, but admission remains separate; this boundary must remain visible and verified. |
| M4A authority before V1-UX-09 through V1-UX-11 and V1-UX-14 | UI role labels cannot be trusted unless server-authoritative identity and signed directives govern the action. |
| Layout state map before layout completion claims | Existing modes must be checked for coherent state transitions and responsive behavior; source presence alone is not runtime evidence. |
| Recovery evidence before any completion claim | The release scope requires reconnect/session resume and encryption-state handling, not merely a reconnect class (`docs/releases/v1-scope.md:35-39,50-53`). |

## PRIVATE / HUMAN / TRUSTWORTHY Filter

Use these questions in design review and evidence review. They are filters, not claims that the current product passes them.

### PRIVATE

- Does this state reveal an invitation key, token, device identifier, meeting content, or unnecessary participant data?
- Is local-only preview clearly distinguishable from published media?
- Does any recovery, screenshot, log, QR, or clipboard path cross the ADR-006 fragment boundary?
- Are unsupported permissions and browser capabilities stated without requesting more access than needed?

### HUMAN

- Can a person tell what is happening, what they can control, and what will happen next without relying on color, hover, or hidden state?
- Are waiting, denial, device failure, reconnect, and leave states calm, specific, and recoverable?
- Does the interface preserve the person’s chosen camera, microphone, speaker, name, and layout preferences where the system can safely do so?
- Are mobile lifecycle and assistive-technology paths treated as first-class journeys rather than exceptions?

### TRUSTWORTHY

- Does every role, admission, moderation, encryption, and fallback label match server/runtime truth?
- Could a stale client assertion, stale token, reconnect race, or split-brain state produce a misleading control?
- Is a local layout choice clearly separated from a room-wide host action?
- Is every completion claim backed by reproducible artifact, reviewer, environment, and exact release-candidate evidence?

## Verification Boundary

All epic statuses and ticket statuses remain `NOT YET VERIFIED`. Planning artifacts do not claim a ticket, phase, gate, or release decision passed (`docs/releases/v1-release-tickets.md:1-5,56-76`), and the V1 scope says its checklist is evidence-required rather than a current-pass assertion (`docs/releases/v1-scope.md:8-12,41-43`).
