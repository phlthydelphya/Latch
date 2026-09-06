# PM Review Decision — M3B Performance & Scalability / Multi-Stream Architecture

**Decision:** ✅ **APPROVED FOR IMPLEMENTATION WITH DESIGN CONDITIONS**

**Milestone:** M3B — Performance & Scalability / Multi-Stream Architecture
**Status:** Approved & Conditions Resolved in Authoritative Specification
**Authority:** Principal Product Manager & Technical Program Manager
**Date:** 2026-09-06
**Baseline Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md)

---

## Executive Summary

The proposed M3B milestone correctly addresses the primary unresolved scalability concern following M3A closure:

> Layout optimization currently exists without corresponding media subscription optimization.

The proposal successfully preserves the project's core architectural principles:

- Blind SFU operation (`LIVEKIT_E2EE_MODE=blind`)
- SFrame E2EE integrity (RFC 9605)
- Zero server-side media processing or transcoding
- Zero analytics or telemetry persistence
- Ephemeral state management
- Client-driven bandwidth adaptation

The overall direction is approved.

The following six design conditions were required and have been incorporated into the authoritative specification and runtime codebase:

---

# Condition 1: Priority Participant Subscription Override

## Finding

The current proposal ties subscription state too closely to gallery page boundaries.

This introduces failure cases where:

- Active speaker is off-page
- Host spotlight targets an off-page participant
- Local pin references an off-page participant
- Screen sharer exists outside the current gallery view

## Required Revision

Replace:

```text
Visible Page Participants = Subscribed
Off-Page Participants = Unsubscribed
```

with:

```text
Subscription Set =
    Visible Gallery Participants
    + Stage Participant
    + Pinned Participant
    + Spotlighted Participant
    + Active Speaker
    + Screen Sharer
```

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-1)
- **Runtime Module:** [`src/webrtc/subscriptionManager.ts`](../../poc/meet-webrtc-core/src/webrtc/subscriptionManager.ts)
- **Protecting Tests:** `tests/m3b-subscription-manager.test.ts` (`M3B-5: Off-Page Active Speaker Promotion`, `M3B-6: Spotlight Override`)
- **Verification:** Any priority participant remains subscribed regardless of gallery page boundaries.

---

# Condition 2: Dynamic Last-N Ownership

## Finding

Last-N must be a dynamic ceiling governed by network health rather than a static constant of 9.

## Required Revision

Platform invariant revised to:

```text
Maximum Last-N = 9
```

`BandwidthEngine` is authoritative for effective Video N:

| Congestion Tier | Effective Video N |
|---|:---:|
| Optimal | 9 |
| Mild Congestion | 9 |
| Moderate Congestion | 6 |
| Severe Congestion | 4 |
| Emergency Audio Only | 0 |

`SubscriptionManager` enforces the effective N supplied by `BandwidthEngine`.

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-2)
- **Runtime Modules:** [`src/webrtc/bandwidthEngine.ts`](../../poc/meet-webrtc-core/src/webrtc/bandwidthEngine.ts), [`src/webrtc/subscriptionManager.ts`](../../poc/meet-webrtc-core/src/webrtc/subscriptionManager.ts)
- **Protecting Tests:** `tests/m3b-bandwidth-engine.test.ts` (`DC-2: reports authoritative effective Video N`), `tests/m3b-subscription-manager.test.ts` (`contracts effective Last-N`)

---

# Condition 3: Subscription Policy Model

## Finding

Track subscription presence (`boolean`) and spatial quality level (`VideoQuality`) must be decoupled.

## Required Revision

```typescript
export interface SubscriptionPolicy {
  subscribed: boolean;
  quality: VideoQuality;
}
```

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-3)
- **Runtime Module:** [`src/webrtc/subscriptionManager.ts`](../../poc/meet-webrtc-core/src/webrtc/subscriptionManager.ts) (`SubscriptionPolicy`, `getSubscriptionPolicies()`)
- **Protecting Tests:** `tests/m3b-subscription-manager.test.ts`

---

# Condition 4: Composite Congestion Scoring

## Finding

Downlink congestion assessment must not rely solely on naive packet loss percentages.

## Required Revision

Calculate composite score in $[0, 100]$:

$$\text{CongestionScore} = \min(100, \; 0.45 \cdot S_{\text{loss}} + 0.25 \cdot S_{\text{rtt}} + 0.15 \cdot S_{\text{jitter}} + 0.15 \cdot S_{\text{bitrate}})$$

Tier transitions are derived from score bands with a 3-cycle ($6\text{ s}$) hysteresis recovery hold.

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-4)
- **Runtime Module:** [`src/webrtc/bandwidthEngine.ts`](../../poc/meet-webrtc-core/src/webrtc/bandwidthEngine.ts)
- **Protecting Tests:** `tests/m3b-bandwidth-engine.test.ts` (`DC-4: calculates deterministic composite congestion score`, `M3B-7: Audio-Only Congestion Recovery`)

---

# Condition 5: SFrame + Simulcast Compatibility Validation (Gate M3B-E01)

## Finding

Simulcast layer transitions must be proven not to corrupt SFrame ciphertext counters or keyframe decoders.

## Required Revision

Establish formal validation gate `M3B-E01` for layer switching, keyframe acquisition, epoch continuity, counter continuity, and recovery behaviors. Escalation rule: Discrepancy $\longrightarrow$ Specification Review $\longrightarrow$ ADR.

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-5)
- **Protecting Tests:** `tests/m3b-simulcast.test.ts`, `tests/wp3-use-webrtc.test.ts`

---

# Condition 6: Observability Language Alignment & Ephemeral Diagnostics

## Finding

Terminology like "Telemetry", "Metrics Collection", and "Analytics" violates product privacy principles.

## Required Revision

All observability renamed to **Ephemeral Runtime Diagnostics**. 100% in-memory volatile store, zero persistent logging, destroyed on call exit.

## Resolution & Implementation

- **Status:** **RESOLVED**
- **Specification:** [`docs/M3B-multi-stream-specification.md`](../M3B-multi-stream-specification.md) §3 (DC-6)
- **Runtime Modules:** [`src/webrtc/bandwidthEngine.ts`](../../poc/meet-webrtc-core/src/webrtc/bandwidthEngine.ts), [`src/components/devices/NetworkDiagnosticsView.tsx`](../../poc/meet-webrtc-core/src/components/devices/NetworkDiagnosticsView.tsx)
