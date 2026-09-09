# M3B Milestone Specification — Multi-Stream Architecture & Performance Scale

**Milestone:** M3B Multi-Stream Architecture & Performance Scale  
**Status:** AUTHORITATIVE & BASELINED 🎯  
**Authority:** PM & Technical Program Management  
**Prerequisites:** M0-P0 (Closed), M1 (Closed), M2 (Closed), M3A (Closed, baseline tagged `m3a-accepted`, commit `d3c504d` / `cbac579`)  
**Timeline:** Sprint 1–2 (2 Weeks)  
**Governance:** 5-Gate Review (`@architect`, `@security`, `@privacy`, `@qa`, `@reviewer`)  

---

## 1. Executive Summary & Problem Statement

Milestone M3A established the client-side visual foundations: geometric grid layout, active speaker audio energy smoothing, host authority hardening, and gallery pagination. However, running a 20-participant meeting under full-mesh or naive SFU subscription yields severe downlink congestion:
- Unconstrained 20-participant 720p streams consume $>25\text{–}30\text{ Mbps}$ downlink bandwidth, inducing packet loss, queue bloat, buffer exhaustion, and frame freezes.
- Blind SFU forwarding (`LIVEKIT_E2EE_MODE=blind`) cannot inspect, transcode, or dynamically downscale media payloads without breaking SFrame RFC 9605 ciphertext.

**M3B: Multi-Stream Architecture & Performance Scale** delivers an end-to-end client-authoritative multi-stream pipeline:
1. **Client-Driven Simulcast (3 Spatial Layers):** SFrame ciphertext publication ladder ($180\text{p} / 360\text{p} / 720\text{p}$) respecting transport MTU headroom (+16B auth tag, KID, CTR counter).
2. **Layout-Aware Subscription Manager:** Explicit track subscription arbitration prioritizing visible tiles and stage focal points, while pausing off-screen tracks.
3. **Dynamic Bandwidth Engine:** Closed-loop downlink congestion evaluation adjusting the effective Last-N ceiling and layer quality to preserve interactive audio and stage clarity.

### The Authoritative Core Strategy
$$\text{Layout-Aware Subscription Management} + \text{SFrame-Compatible Simulcast} + \text{Bandwidth-Adaptive Last-N} = \text{Scalable 20-Participant Experience}$$

---

## 2. Permanent Product Invariants & Privacy Guardrails

The following product invariants from `AGENTS.md` and `docs/M3-advanced-view-experience.md` are **strictly non-negotiable**:

```
========================================================================================
                          PERMANENT PRODUCT EXCLUSIONS
========================================================================================
  ✗ AI summaries                   (Zero LLM/ML models processing meeting content)
  ✗ AI transcripts                 (Zero speech-to-text inference or audio ingestion)
  ✗ AI assistants / bots           (Zero automated non-human meeting participants)
  ✗ Attention / gaze tracking      (Zero biometric or gaze capture)
  ✗ Usage / engagement analytics   (Zero telemetry SDKs, zero telemetry endpoints)
  ✗ Behavioral tracking            (Zero user profiling or clickstream capture)
  ✗ Cloud recording                (Zero server-side media archiving or disk persistence)
  ✗ Cloud transcription            (Zero cloud-based audio processing)
  ✗ Server-side media transcoding  (Zero server-side composition, decoding, or relay changes)
========================================================================================
```

### Architectural Constraints
1. **Zero Media Transcoding / Blind SFU:** Media payloads remain completely encrypted under RFC 9605 SFrame (`LIVEKIT_E2EE_MODE=blind`). The SFU acts solely as a selective packet router.
2. **Maximum Last-N Ceiling $\le 9$:** Active video subscriptions never exceed $N=9$ (peak downlink budget $\le 10\text{–}12\text{ Mbps}$ at 20 participants).
3. **100% Ephemeral Runtime Diagnostics (DC-6):**
   - Telemetry, behavioral analytics, and persistent metric logging are forbidden.
   - All network quality metrics (RTT, packet loss, jitter, congestion scores) exist purely in volatile browser memory for the current session.
   - All diagnostic buffers are destroyed immediately upon call teardown. Zero disk, cookie, or remote storage.

---

## 3. Incorporation of Architectural Review Conditions

This specification formally adopts and incorporates the six required design conditions (DC-1 through DC-6) from the Architectural Review:

### DC-1: Priority Participant Subscription Override
Subscriptions shall never be coupled exclusively to gallery pagination boundaries. When an attendee is navigating page 1, critical speakers or presenters must not be dropped.

**Subscription Policy Invariant:**
```text
Subscription Set = 
    Visible Gallery Participants
    + Stage Participant
    + Pinned Participant
    + Spotlighted Participant
    + Active Speaker
    + Screen Sharer
```

**Acceptance Criterion:** Any priority participant remains subscribed regardless of gallery page assignment or viewport scrolling.

---

### DC-2: Dynamic Last-N Ownership & Tier Ladder
Last-N is defined as a **dynamic ceiling governed by network health**, rather than a static constant.

**Ownership Model:**
`BandwidthEngine` is the single authoritative source of truth for the **Effective Video N**. `SubscriptionManager` enforces the effective N supplied by `BandwidthEngine`.

| Congestion Tier | Network State | Congestion Score | Effective Video N | Video Layer Policy |
|---|---|:---:|:---:|---|
| **Tier 0: Optimal** | Clean link ($<1\%$ loss, $<80\text{ ms}$ RTT) | $0\text{–}15$ | **9** | Stage: High ($720\text{p}$), Gallery: Low ($180\text{p}$) |
| **Tier 1: Mild Congestion** | Moderate queueing ($1\text{–}4\%$ loss, $<150\text{ ms}$ RTT) | $16\text{–}35$ | **9** | Stage: High ($720\text{p}$), Gallery: Low ($180\text{p}$) |
| **Tier 2: Moderate Congestion** | Elevated jitter/loss ($5\text{–}10\%$ loss, $<250\text{ ms}$ RTT) | $36\text{–}65$ | **6** | Stage: Med ($360\text{p}$), Gallery: Low ($180\text{p}$) |
| **Tier 3: Severe Congestion** | Heavy packet loss ($11\text{–}20\%$ loss, $<400\text{ ms}$ RTT) | $66\text{–}85$ | **4** | Stage: Low ($180\text{p}$), Gallery: Low ($180\text{p}$) |
| **Tier 4: Emergency Audio-Only** | Critical network collapse ($>20\%$ loss or $>400\text{ ms}$ RTT) | $86\text{–}100$ | **0** | All video unsubscribed; $100\%$ audio prioritized |

---

### DC-3: Formal Subscription Policy Model
Separation of subscription presence (`subscribed: boolean`) from spatial quality level (`quality: VideoQuality`).

```typescript
export interface SubscriptionPolicy {
  subscribed: boolean;
  quality: VideoQuality;
}
```

- **Stage Participant:** `{ subscribed: true, quality: VideoQuality.HIGH }` (or adapted via Tier)
- **Visible Gallery Participant:** `{ subscribed: true, quality: VideoQuality.LOW }`
- **Priority Override Participant:** `{ subscribed: true, quality: VideoQuality.LOW }`
- **Off-Page / Beyond Effective N:** `{ subscribed: false, quality: VideoQuality.LOW }`

---

### DC-4: Composite Congestion Scoring Engine
Downlink network assessment must evaluate composite transmission health rather than naive single-metric packet loss.

**Inputs:**
- Fractional Packet Loss ($L \in [0, 1]$)
- Round Trip Time ($\text{RTT}$ in ms)
- Packet Jitter ($J$ in ms)
- Available Bitrate Ratio ($B_{\text{ratio}} = R_{\text{curr}} / R_{\text{target}}$)

**Scoring Function:**
$$\text{CongestionScore} = \min\left(100, \; \text{round}\left(w_L \cdot S_L + w_R \cdot S_R + w_J \cdot S_J + w_B \cdot S_B\right)\right)$$
where:
- $w_L = 0.45$ (Loss component: $S_L = \min(100, L \times 500)$)
- $w_R = 0.25$ (RTT component: $S_R = \min(100, \max(0, (\text{RTT} - 80) \times 0.35))$)
- $w_J = 0.15$ (Jitter component: $S_J = \min(100, \max(0, (J - 20) \times 1.5))$)
- $w_B = 0.15$ (Bitrate deficiency: $S_B = \min(100, \max(0, (1 - B_{\text{ratio}}) \times 100))$)

**Hysteresis & Damping:**
- **Degradation:** Instantaneous trigger if score sustains tier boundary for $\ge 2$ polling cycles ($4\text{ s}$).
- **Recovery:** Strict hysteresis hold requiring $\ge 3$ consecutive cycles ($6\text{ s}$) in a healthier score band before step-up promotion, eliminating rapid tier-flapping.

---

### DC-5: SFrame + Simulcast Compatibility Validation (Gate M3B-E01)
Formal validation gate for LiveKit WebRTC client SDK simulcast layer switching while SFrame transform streams are engaged.

**Validation Scope:**
1. Layer switching without decrypt frame drop or cryptographic desynchronization.
2. Keyframe (`PLI`/`FIR`) acquisition upon layer transition.
3. Epoch and counter monotonicity preserved across spatial layer swaps.
4. Recovery behavior when switching between $180\text{p}$, $360\text{p}$, and $720\text{p}$.

**Governance Rule:**
If compatibility validation uncovers browser Encoded Transform discrepancies:
$$\text{SFrame Compatibility Issue} \longrightarrow \text{Specification Review} \longrightarrow \text{Architecture Decision Record (ADR)}$$
prior to proceeding with downstream stage features.

---

### DC-6: Ephemeral Runtime Diagnostics Standards
All runtime inspection adheres strictly to zero-persistence requirements:
- Terminology replaced: Telemetry / Analytics $\longrightarrow$ **Ephemeral Runtime Diagnostics**.
- Storage: 100% in-memory Zustand store.
- Exposure: Accessible via `NetworkDiagnosticsView` modal for developer and user debugging.
- Teardown: Disconnecting or unmounting the meeting immediately purges all diagnostics and resets store values.

---

## 4. Simulcast Layer Configuration

Published video tracks are configured with 3 spatial layers with bitrates budgeted to accommodate SFrame ciphertext overhead:

| Layer | RID | Resolution | Framerate | Target Bitrate | SFrame Overhead Allowance |
|---|:---:|:---:|:---:|:---:|:---:|
| **Low** | `q` | $320 \times 180$ | $15\text{ fps}$ | $120\text{ kbps}$ | $\le 160\text{ kbps}$ ceiling |
| **Medium** | `h` | $640 \times 360$ | $30\text{ fps}$ | $400\text{ kbps}$ | $\le 500\text{ kbps}$ ceiling |
| **High** | `f` | $1280 \times 720$ | $30\text{ fps}$ | $1200\text{ kbps}$ | $\le 1800\text{ kbps}$ ceiling |

Total published upstream bandwidth per camera: $\approx 1.7\text{–}2.3\text{ Mbps}$.

---

## 5. Formal Test Scenarios & Acceptance Test Matrix

In addition to unit validation, the following end-to-end scale scenarios are authoritative:

### Scenario M3B-1: Baseline 20-Participant Scale Gating
- **Setup:** 20 connected participants, Gallery View (Page 0 showing 9 tiles).
- **Assertion:** Exactly 9 remote video tracks subscribed at `VideoQuality.LOW`. 10 remote video tracks set to `subscribed: false`. Downlink bandwidth $\le 1.8\text{ Mbps}$.

### Scenario M3B-2: Dynamic Stage Layer Elevation
- **Setup:** Speaker View active. Participant A identified as stage focal point.
- **Assertion:** Participant A video track upgraded to `VideoQuality.HIGH`. Peripheral filmstrip tiles subscribed at `VideoQuality.LOW`.

### Scenario M3B-5: Off-Page Active Speaker Promotion (DC-1)
- **Setup:** User viewing Page 0 of Gallery. Participant 15 (residing on Page 2) begins speaking.
- **Assertion:** `SubscriptionManager` identifies Participant 15 as priority active speaker. Video track for Participant 15 is subscribed immediately without requiring the user to paginate to Page 2.

### Scenario M3B-6: Host Spotlight Override (DC-1)
- **Setup:** Host spotlights Participant 19 who is not on the active gallery page.
- **Assertion:** Priority subscription override triggers. Participant 19 is subscribed at `VideoQuality.HIGH` on the stage; total subscribed video tracks does not exceed effective Last-N.

### Scenario M3B-7: Audio-Only Congestion Recovery (DC-2, DC-4)
- **Setup:** Severe simulated packet loss ($>25\%$) triggers Tier 4 (Emergency Audio-Only). All video unsubscribed.
- **Assertion:** Network conditions recover (loss $<1\%$, RTT $<60\text{ ms}$). After 6-second hysteresis hold, video tracks are progressively restored to Tier 0 without oscillation or UI freezing.

### Scenario M3B-8: 20-Participant Endurance Validation
- **Setup:** 20 simulated participants for 10 minutes with continuous active speaker transitions and page flipping.
- **Assertion:** Zero memory leaks, zero dangling WebRTC subscriptions, zero unhandled promise rejections, and zero state desynchronizations.

---

## 6. Milestone Exit Gates & Sign-Off Criteria

| Governance Gate | Sign-Off Authority | Verification Standards |
|---|:---:|---|
| **Architecture Gate** | `@architect` | Clean decoupling of `BandwidthEngine`, `SubscriptionManager`, and `simulcastConfig`. Strict adherence to DC-1 priority set and DC-2 Last-N dynamic ownership. |
| **Security Gate** | `@security` | SFrame RFC 9605 ciphertext integrity preserved. Zero plaintext payload inspection or SFU transcoding dependencies. |
| **Privacy Gate** | `@privacy` | 100% ephemeral in-memory state. Strict compliance with DC-6: zero telemetry, zero session logging, immediate teardown purge. |
| **QA Gate** | `@qa` | 100% test pass rate across all unit and integration suites ($\ge 190$ tests). M3B-1 through M3B-8 scenarios validated. |
| **Reviewer Gate** | `@reviewer` | Clean TypeScript check (0 errors), clean production Vite build, bundle impact within budgeted envelope ($\le 225\text{ kB}$ gzip). |

---

## 7. Approval & Baselining

**Principal PM Sign-Off:** ✅ **APPROVED & BASELINED**  
**Technical Program Management Sign-Off:** ✅ **APPROVED & BASELINED**  
**Effective Date:** 2026-09-06  
