# M3A Remediation Plan

> **Document status:** SUPERSEDED  
> **Historical decision:** Remediation completed  
> **Milestone status:** CLOSED  
> **Acceptance classification:** FULLY ACCEPTED  
> **Authoritative closure record:** [`docs/M3A-exit-report.md`](../M3A-exit-report.md)  
>
> This document records the remediation proposed after the conditional
> M3A acceptance review. It is retained for traceability and must not be
> interpreted as an active implementation plan. Where this proposal differs
> from the accepted implementation, the exit report and accepted source
> revision are authoritative.

---

## 1. Background

Following the initial M3A Milestone Acceptance Review, M3A was classified as **ACCEPTED WITH CONDITIONS** pending remediation of 3 blocking conditions and 3 non-blocking conditions:

1. **Runtime Speaker Smoothing Integration** (Blocking)
2. **Layout Arbitration Runtime Wiring** (Blocking)
3. **Host Authority Hardening** (Blocking)
4. **Gallery Dynamic Sizing** (Non-Blocking)
5. **SpeakerView Pin/Spotlight Hierarchy** (Non-Blocking)
6. **Gallery Pagination Integration** (Non-Blocking)

All six items were subsequently implemented, verified through automated testing, audited, and closed in the authoritative exit report.

---

## 2. Historical Remediation Commitments

### Component 1: Runtime Speaker Smoothing & Layout Arbitration (Blocking Conditions 1 & 2)

#### [`src/layout/layoutAdapter.ts`](../../poc/meet-webrtc-core/src/layout/layoutAdapter.ts)
- Instantiated `SpeakerSmoothingEngine` within `LayoutAdapter`.
- Subscribed to `RoomEvent.ActiveSpeakersChanged` on `room` to feed raw participant audio levels into `speakerSmoothingEngine.updateEnergy(speaker.identity, speaker.audioLevel, now)`.
- Implemented a 150 ms evaluation ticker and presence subscriber to call `speakerSmoothingEngine.resolveActiveSpeaker(now)` and `speakerSmoothingEngine.getConfidence(id, now)`.
- Passed current state (screen share, spotlight, pin, smoothed speaker, confidence, user locked mode) to `layoutEngine.evaluate(input)` to update `LayoutStore.mode` and `LayoutStore.activeSpeakerId`.
- Cleaned up the smoothing engine, interval timer, and event listeners in `detach()`.

#### [`src/layout/layoutStore.ts`](../../poc/meet-webrtc-core/src/layout/layoutStore.ts)
- Added `userLockedMode: LayoutMode | null` to track when a user explicitly clicked a mode in `LayoutControls`.
- Updated `setLayoutMode` to record `userLockedMode`.
- Ensured all mode mutations delegate through `layoutEngine.evaluate()`.

---

### Component 2: Host Authority Hardening (Blocking Condition 3)

#### [`src/host/hostControlManager.ts`](../../poc/meet-webrtc-core/src/host/hostControlManager.ts)
- In `onDataReceived`: Removed the insecure `!presence.hostId` fallback.
- Enforced `Boolean(presence.hostId && presence.hostId === senderId)` strictly.
- When `presence.hostId` is null/undefined, rejected non-knock directives with a warning log.

#### [`src/collaboration/collaborationAdapter.ts`](../../poc/meet-webrtc-core/src/collaboration/collaborationAdapter.ts)
- Removed `!presence.hostId` fallback for `ANNOUNCEMENT_TOPIC` and `HAND_ACTION_TOPIC`.

#### [`src/layout/layoutAdapter.ts`](../../poc/meet-webrtc-core/src/layout/layoutAdapter.ts)
- Removed `!hostId ||` fallback for `SPOTLIGHT_TOPIC`. Require sender to be confirmed host.

---

### Component 3: Gallery Dynamic Sizing & Pagination (Non-Blocking Conditions 4 & 6)

#### [`src/components/layout/GalleryView.tsx`](../../poc/meet-webrtc-core/src/components/layout/GalleryView.tsx)
- Added `containerRef` and `ResizeObserver` to measure real-time container dimensions (`width`, `height`) instead of hardcoded `1280x720`.
- Replaced inline slicing with `paginateParticipants` from [`src/layout/gridOptimizer.ts`](../../poc/meet-webrtc-core/src/layout/gridOptimizer.ts).
- Passed dynamic dimensions into `calculateOptimalGrid`.
- Disconnected observer on component unmount.

---

### Component 4: SpeakerView Pin/Spotlight Hierarchy (Non-Blocking Condition 5)

#### [`src/components/layout/SpeakerView.tsx`](../../poc/meet-webrtc-core/src/components/layout/SpeakerView.tsx)
- Corrected arbitration order: delegated directly to `layoutEngine.resolveStageParticipant()`.
- Enforced the specification rule: `Local Pin ≻ Host Spotlight ≻ Active Speaker`.
- Connected filmstrip tile clicks to `pinParticipant(tile.id)`.

---

## 3. Historical Verification Plan

### Automated Tests
1. **Unit & Integration Suite:**
   - Vitest suite: `npm --prefix poc/meet-webrtc-core test`.
   - Verified `tests/m3a-layout-engine.test.ts`, `tests/m3a-speaker-smoothing.test.ts`, `tests/m3a-grid-optimizer.test.ts`, and `tests/m3a-presentation-modes.test.tsx`.
2. **Security & Wiring Tests:**
   - Added unit tests in `tests/m2-host-manager.test.ts` verifying `HostControlManager` strictly rejects directives when `hostId` is null (`E-21`) or forged (`E-22`).
   - Verified `LayoutAdapter` updates `activeSpeakerId` and `mode` through `SpeakerSmoothingEngine` and `LayoutEngine`.
   - Verified `SpeakerView` prioritizes `pinnedParticipantId` over `spotlightParticipantId`.
3. **Build & Bundle Validation:**
   - Verified 0 TypeScript errors and clean production build.
