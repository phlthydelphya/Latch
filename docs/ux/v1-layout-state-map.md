# V1 Layout State Map

**Status:** `OPEN FOR VERIFICATION` / design artifact only. This document does not authorize layout implementation changes, select a final precedence rule, or establish a release outcome.

## Purpose

The repository already contains source modes and arbitration for gallery, speaker, presentation, dynamic view, pins, spotlight, PiP, filmstrip, and bandwidth state (`src/layout/layoutStore.ts:5-41,44-62,66-207`; `src/components/layout/LayoutControls.tsx:25-58`). This artifact organizes verification of their coherence. It is not a request to add or rewrite layout code.

## States To Verify

| State | Questions to answer with evidence |
|---|---|
| Gallery | How are participants ordered? What happens at zero, one, normal, maximum, and over-limit participants? Does the grid remain legible at mobile, tablet, desktop, and ultra-wide breakpoints? |
| Speaker | Which tile is the current speaker? How does the view behave when the active speaker changes, is muted, leaves, or is not yet known? What does the user see when speaker mode is selected but no active speaker exists? |
| Presentation | When screen share starts, stops, changes owner, or fails, which stage and supporting participants are visible? Is the presentation state clearly distinct from ordinary speaker view? |
| Screen share | Verify publish, permission denial, browser limitation, stop, reconnect, multiple-share attempts, and encryption/fallback messaging. Do not infer a successful share from a local button state alone. |
| Spotlight | Distinguish host-authoritative spotlight from a local pin/layout choice. Verify spotlight start, clear, host departure, reconnect, and stale-event behavior. |
| Pin | Verify one pin, clear pin, pinning a participant who leaves, and interaction with active speaker, screen share, and spotlight. |
| Multi-pin | Verify the supported maximum, ordering, removal, participant arrival/departure, narrow screens, and whether overflow is visible or silently omitted. |
| Active speaker | Verify speaking detection, rapid speaker changes, muted speakers, local speaker state, and whether active-speaker emphasis overrides or only informs the selected layout. |
| Filmstrip | Verify which participants remain in the filmstrip during presentation and speaker states, ordering, scrolling, focus, keyboard access, and mobile collapse behavior. |
| Responsive behavior | Verify controls, tile sizing, stage/filmstrip composition, overflow, orientation changes, safe areas, reduced motion, and PWA/browser viewport changes at the contract breakpoints (`docs/ux/UX-F1-design-token-contract.md:239-247`). |

## State Inputs

The verification matrix should vary these inputs independently and in combination:

- Selected mode: Gallery, Speaker, or Presentation.
- Screen-share owner: none, local participant, remote participant, owner leaves, and share stops.
- Spotlight: none, one participant, cleared, stale after reconnect.
- Pin set: none, one, multiple, maximum, participant removed.
- Active speaker: stable, rapidly changing, muted, unknown, and local participant.
- Participant count and stream availability: empty, small, supported limit, over limit, camera-off, audio-only, and unavailable media.
- Viewport and lifecycle: mobile portrait, mobile landscape, tablet, desktop, ultra-wide, resize, tab suspension, reconnect, and refresh.

## Deterministic Precedence Questions

These are questions for `@architect` and `@frontend`; they are intentionally not resolved here:

1. If Presentation is selected or a screen share becomes active, does it take precedence over Speaker, Gallery, pin, or spotlight, and is that rule global or conditional?
2. If a host spotlight conflicts with a participant’s local pin or multi-pin set, which state is shown, which state is preserved, and how is scope communicated?
3. If active speaker changes while a pin, multi-pin, spotlight, or presentation is active, does it change the stage, a tile emphasis, the filmstrip, or nothing?
4. If the selected participant leaves or their stream disappears, what is the deterministic fallback and how is it announced?
5. If multiple signals change in one update, what ordering prevents flicker or contradictory controls?
6. Which state is authoritative after reconnect or refresh, and which local preferences may safely be restored?
7. Do responsive breakpoints change only composition, or can they change the effective visibility/precedence of pins, spotlight, active speaker, and filmstrip?

## Proposed Rule

**OPEN: no proposed precedence rule is final truth.** Any candidate ordering must be reviewed and verified by `@architect` and `@frontend` against the source state machine, server-authoritative host actions, local layout scope, accessibility, responsive behavior, and participant/stream limits. Until that review produces reproducible evidence, documentation and UI copy must not imply that one mode always overrides another.

## Verification Record

For each scenario, record selected inputs, expected state, observed stage and controls, participant/stream limits, viewport/device, browser, reconnect/lifecycle conditions, accessibility observations, and artifact location. A source mode being present is not evidence that its combined transitions are coherent at runtime.
