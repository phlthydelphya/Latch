# M3 Milestone Specification — Advanced View Experience

**Milestone:** M3 Advanced View Experience
**Status:** M3A CLOSED (`docs/M3A-exit-report.md`) | M3B AUTHORITATIVE & ACTIVE (`docs/M3B-multi-stream-specification.md`)
**Prerequisites:** M0-P0 (RC1 Closed), M1 Hardening (Closed, baseline tagged `beta-ready`), M2 Meeting Experience (Complete, Commit `1d2cacc`), M3A Closed (Baseline tagged `m3a-accepted`, commit `d3c504d` / `cbac579`)
**Timeline:** 4–5 Weeks (M3A Closed; M3B Active Weeks 3–4)
**Owner:** PM & TPM
**Governance:** 5-Gate Review (`@architect`, `@security`, `@privacy`, `@qa`, `@reviewer`)  

---

## 1. Executive Vision

With M0-P0 (Architecture Validation), M1 (Production Hardening), and M2 (Core Meeting Experience: Presence, Layout Foundations, Ephemeral Collaboration, Hardware Management, Host Moderation) fully accepted and passing all 148 automated tests, **the core operational surface of meet-secure is complete and functional**.

**M3: Advanced View Experience** elevates the visual ergonomics, spatial flexibility, and accessibility of the meeting interface to tier-1 enterprise standards. M3 focuses strictly on **participant presentation, viewport optimization, speaker focus dynamics, self-view customization, and inclusive accessibility**.

No new backend services, no new transport protocols, and zero media decryption/transcoding will be introduced. M3 is purely client-side domain evolution built on top of our proven ephemeral state architecture.

---

## 2. Permanent Product Exclusions ("Will Not Build")

The following product invariants remain **strictly forbidden**. Any pull request, architectural proposal, or dependency introducing any of the following will be rejected without review:

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
  ✗ Breakout rooms                 (Strictly single-session ephemeral security context)
  ✗ Meeting templates              (Zero database persistence of configuration profiles)
========================================================================================
```

### Core Invariants Preserved
1. **100% Ephemeral State:** All view preferences, layout modes, multi-monitor detaches, and self-view settings are in-memory Zustand state. Zero persistence to disk, `localStorage`, or remote databases.
2. **Zero Media Transcoding:** Layout compositions occur exclusively on the local client canvas/DOM via CSS and HTML5 Video elements. The SFU remains completely blind (`LIVEKIT_E2EE_MODE=blind`) and forwards encrypted SFrame packets without modification.
3. **Bandwidth Invariant (Last-N=9 Ceiling):** Even with expanded multi-speaker or stage layouts, active video subscriptions never exceed Last-N=9 (blind-forward 3 layers, $\le 10\text{–}12\text{ Mbps}$ down budget). Off-stage/off-page video tracks are cleanly paused at the WebRTC subscriber layer.
4. **Clean Teardown:** Exiting a meeting immediately releases all detached window references, audio meters, observation listeners, and state slices.

---

## 3. Seven M3 Feature Categories

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         M3: ADVANCED VIEW EXPERIENCE                             │
├─────────────────────────┬───────────────────────────┬────────────────────────────┤
│ 1. Dynamic Gallery View │ 2. Advanced Speaker View  │ 3. Multi-Speaker Stage     │
│  - Responsive grid math │  - Audio smoothing        │  - Interview mode (2p)     │
│  - Multi-monitor aware  │  - Hysteresis hold (1.5s) │  - Panel mode (3-4p)       │
│  - Mobile port/land     │  - Confidence scoring     │  - Podcast mode            │
│  - Last-N pagination    │  - Smooth stage FLIP      │  - Multi-speaker spotlight │
├─────────────────────────┼───────────────────────────┼────────────────────────────┤
│ 4. Advanced Presentation│ 5. Self-View Controls     │ 6. Accessibility Views     │
│  - Side-by-side split   │  - Show / Hide self       │  - Reduced motion cuts     │
│  - Presenter over/below │  - Mirror camera toggle   │  - WCAG AAA high contrast  │
│  - Content-only focus   │  - Detached floating tile │  - Large names & controls  │
│  - Resizable divider    │  - S / M / L tile sizing  │  - Low-vision content zoom │
├─────────────────────────┴───────────────────────────┴────────────────────────────┤
│ 7. Layout Engine Evolution                                                       │
│  - Deterministic scoring model: S = w_spot*P_spot + w_share*P_share + w_spk*C_spk│
│  - Formal state transition matrix (Presentation vs Multi-Spotlight resolution)   │
│  - Fallback hierarchy: Presentation -> Multi-Stage -> Speaker View -> Auto-Grid │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### Category 1: Dynamic Gallery View
- **Objective:** Ensure optimal spatial distribution, tile aspect ratios, and device-responsive gallery presentation across any participant count ($1\text{ to }20$) and form factor.
- **Deliverables:**
  1. **Responsive Grid Layout Math:** Geometric grid optimizer that calculates the optimal columns $\times$ rows configuration for arbitrary viewport aspect ratios, eliminating orphaned single tiles and excessive letterboxing.
  2. **Adaptive Participant Sizing:** Subtle tile weighting where active participants maintain prominent positioning while preserving overall grid balance.
  3. **Multi-Monitor Awareness:** Integration with the browser Window Management API (`window.getScreenDetails()`) where supported, allowing users to pop out the Gallery or Video Stage into an independent secondary monitor window with automatic mirror sync and clean lifecycle teardown.
  4. **Mobile Portrait & Landscape Behavior:** Fluid viewport detection adapting mobile devices between a swipeable 2-column portrait gallery and an auto-fitting landscape grid.
  5. **Last-N Aware Pagination:** Interactive pagination controls (`< Page 1 of 2 >`) for meetings $>9$ participants, ensuring subscriber bandwidth limits (Last-N=9) are respected by requesting video track disablement for off-screen pages.

---

### Category 2: Advanced Speaker View
- **Objective:** Eliminate visual jitter and rapid stage switching caused by brief utterances, coughs, or transient background noise.
- **Deliverables:**
  1. **Active Speaker Smoothing:** Rolling window audio filter smoothing raw audio energy levels over a $300\text{ ms}$ window.
  2. **Speaker Hold Timing (Hysteresis):** Configurable speaker stage hold duration ($1500\text{–}2500\text{ ms}$). A newly detected speaker must sustain continuous speech for $\ge 600\text{ ms}$ before triggering a stage transition, preventing momentary interjections ("yes", "uh-huh") from stealing the stage.
  3. **Stage Transition Rules:** Smooth, hardware-accelerated CSS FLIP transitions ($250\text{ ms}$) between stage and filmstrip positions, avoiding sudden popping or layout reflows.
  4. **Active Speaker Confidence Scoring:** Multi-factor score combining RMS volume, speech duration, and silence penalty to deterministically rank speakers when multiple attendees speak simultaneously.

---

### Category 3: Multi-Speaker Stage Layouts
- **Objective:** Support conversational formats beyond single-speaker dominance, such as debates, interviews, and panels.
- **Deliverables:**
  1. **Interview Mode (Dual Stage):** Equal 50/50 stage split featuring the two primary conversants side-by-side (or stacked vertically on narrow displays), with other attendees placed in a compact peripheral filmstrip.
  2. **Panel Mode (Tri / Quad Stage):** Symmetrical 3-up or 4-up stage configuration for designated panelists or co-hosts.
  3. **Podcast Mode:** Visual focus layout featuring up to 4 active participants with real-time waveform glow rings and dedicated stage priority.
  4. **Multi-Speaker Spotlight:** Extension of M2 single-spotlight allowing the host to select and pin up to 4 participants concurrently to the shared stage for all attendees.

---

### Category 4: Advanced Presentation Layouts
- **Objective:** Provide superior ergonomics when screen sharing, accommodating different presenter styles and content legibility needs.
- **Deliverables:**
  1. **Side-by-Side Presenter/Content:** Split screen featuring the screen share on the left/center and the active presenter(s) on the right, with a draggable/clickable split divider (50/50, 70/30, 80/20).
  2. **Presenter Over Content (Floating PiP):** Presenter webcam overlay placed inside the screen-share container with customizable corner anchoring (top-right, bottom-right, top-left, bottom-left).
  3. **Presenter Below Content:** 16:9 maximized screen share placed on top, with a centered row of prominent presenter webcams positioned directly below.
  4. **Content-Only Focus Mode:** Complete one-click suppression of all webcam tiles, control bars, and filmstrips, dedicating 100% of the display area to shared documentation or code.

---

### Category 5: Self-View Controls
- **Objective:** Relieve "self-view fatigue" / camera anxiety and grant participants granular control over how their own feed appears on their screen.
- **Deliverables:**
  1. **Hide Self-View:** Completely hide the local participant's video tile from their own display while continuing to broadcast encrypted video to all peers.
  2. **Mirror Self-View Toggle:** User setting to flip the local camera preview horizontally (`scaleX(-1)` vs. unmirrored real orientation) to match user preference.
  3. **Detach Self-Tile:** Detach self-tile into a floating, draggable local element positioned anywhere on top of the meeting stage.
  4. **Self-Tile Resizing:** Three discrete sizing presets for self-view: Mini ($120\text{ px}$ width), Standard ($180\text{ px}$ width), and Prominent ($240\text{ px}$ width).

---

### Category 6: Accessibility Views (WCAG 2.2 AAA Alignment)
- **Objective:** Ensure complete usability for participants with visual, cognitive, or motor impairments.
- **Deliverables:**
  1. **Reduced Motion Engine:** Explicit detection of `prefers-reduced-motion` plus manual in-app toggle, immediately replacing all slide, zoom, and FLIP animations with instant $0\text{ ms}$ state cuts.
  2. **High-Contrast Theme Mode:** WCAG AAA high-contrast palette ($7:1$ contrast ratio), featuring deep `#000000` canvas, high-contrast borders ($2\text{ px}$ solid `#00ffcc`), and stark text labels.
  3. **Large Participant Names & Status Indicators:** Accessibility preference scaling participant name tags and status icons to $\ge 18\text{ px}$ with solid contrast backdrop pills.
  4. **Large Control Bar Mode:** Enlarged UI target mode ($56\text{ px}$ height buttons with expanded padding and clear textual descriptions) meeting motor-dexterity accessibility targets.
  5. **Low-Vision Content Zoom:** Client-side magnification tool for screen shares (1.5x, 2.0x, 3.0x digital pan-and-zoom) allowing low-vision users to inspect code or small text independently without altering the host's broadcast.

---

### Category 7: Layout Engine Evolution
- **Objective:** Unify all view modes, spotlights, pins, and screen shares into a formal, deterministic state machine.
- **Deliverables:**
  1. **Layout Scoring Model:** Mathematical priority evaluator:
     $$\text{Score}_i = w_{\text{spotlight}} \cdot P_{\text{spotlight}} + w_{\text{pin}} \cdot P_{\text{pin}} + w_{\text{screen}} \cdot P_{\text{screen}} + w_{\text{speaker}} \cdot C_{\text{speaker}}$$
     resolving tile placement and stage occupancy deterministically.
  2. **State Transition Matrix:** Formal finite state machine governing transitions between `Gallery`, `Speaker`, `Presentation`, `MultiStage`, and `ContentFocus`, eliminating race conditions or flickering.
  3. **Screen-Share Priority Rules:** Attendee preference toggle to either "Auto-switch to screen share" or "Maintain current participant layout".
  4. **Spotlight vs. Pin Arbitration:** Clear hierarchy: Local User Pin $\succ$ Host Multi-Spotlight $\succ$ Active Speaker.
  5. **Fallback Hierarchy:** Graceful degradation on bandwidth contraction or stream drops: Presentation $\rightarrow$ Multi-Speaker Stage $\rightarrow$ Single Speaker $\rightarrow$ Auto-Gallery.

---

## 4. Execution Phases & Timeline

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ M3A: CORE VISUAL ENGINE & PRESENTATION (Weeks 1–2)                                     │
│  - Phase 1: Layout Engine Evolution & Scoring Model                                    │
│  - Phase 2: Dynamic Gallery View & Last-N Pagination                                   │
│  - Phase 3: Advanced Speaker View (Smoothing, Hysteresis, Confidence)                  │
│  - Phase 4: Advanced Presentation Layouts (Side-by-side, Over/Below, Content-Only)     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ M3B: SPECIALIZED STAGES, SELF-VIEW & ACCESSIBILITY (Weeks 3–4)                         │
│  - Phase 5: Multi-Speaker Stage Layouts (Interview, Panel, Podcast, Multi-Spotlight)  │
│  - Phase 6: Self-View Controls (Hide, Mirror, Detach, Resize)                          │
│  - Phase 7: Accessibility Views (Reduced Motion, High Contrast, Large Controls, Zoom)  │
│  - Phase 8: Milestone M3 Final 5-Gate Governance & Verification                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Acceptance Criteria

| Area | Requirement | Verification Method |
|---|---|---|
| **Responsive Grid** | Grid balances 1–20 tiles with 0 orphaned tiles or layout overflow | Automated Jest/Vitest DOM snapshot test matrix |
| **Speaker Smoothing** | Short speech bursts $<600\text{ ms}$ do NOT trigger stage swap; speech $\ge 600\text{ ms}$ holds for $1.5\text{ s}$ | Fake-timer Vitest test with simulated audio levels |
| **Last-N Pagination** | Switching gallery pages pauses off-screen video tracks via LiveKit SDK | Mock room subscriber track verification test |
| **Multi-Speaker Stage**| Supports up to 4 simultaneous spotlighted participants with balanced geometry | LayoutStore unit tests + component rendering test |
| **Presentation Layouts**| Side-by-side resizes smoothly; Content-only hides 100% of chrome | Unit tests for PresentationStage component |
| **Self-View Controls** | Hiding self removes tile locally but keeps `videoEnabled: true` in signaling | PresenceStore + LayoutStore cross-verification test |
| **Accessibility (a11y)**| `prefers-reduced-motion` stops all CSS transitions; contrast $\ge 7:1$ in High Contrast mode | Lighthouse CI audit + CSS rule assertion tests |
| **Resource Efficiency**| Zero garbage leaks; all secondary windows and resize listeners cleaned on unmount | Memory heap inspection in automated browser test |

---

## 6. Exit Criteria & Governance Gates

Milestone M3 completion requires unanimous sign-off across all 5 governance gates:

1. **Architecture Gate (`@architect`):**
   - Clean domain separation maintained: Layout logic contained strictly in `src/layout/` and Presentation components.
   - Zero coupling between UI components and LiveKit transport primitives.
   - Deterministic layout scoring model verified without circular state updates.
2. **Security Gate (`@security`):**
   - SFrame E2EE media transform pipeline intact with zero regressions across all new layouts.
   - Pop-out window communication (if multi-monitor used) restricted to same-origin in-memory MessageChannel/BroadcastChannel with strict origin validation.
3. **Privacy Gate (`@privacy`):**
   - 100% ephemeral in-memory state: zero cookies, zero `localStorage`, zero telemetry, zero session persistence.
   - Self-view hide state does not emit any metadata to peers or SFU.
4. **QA Gate (`@qa`):**
   - Minimum 25 new unit/integration tests covering layout scoring, speaker smoothing, pagination, and accessibility.
   - Total test suite $\ge 175$ passing tests with 0 failures.
   - Zero P0 and zero P1 bugs.
5. **Reviewer Gate (`@reviewer`):**
   - Bundle size gate: Total gzipped bundle $\le 225\text{ kB}$ gzip (well below the $250\text{ kB}$ warning threshold).
   - Zero TypeScript compiler errors (`tsc -p tsconfig.app.json`).
   - Clean ESLint run with zero warnings.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| **Layout Thrashing / Jitter** | Jarring UX when multiple participants talk over each other | Strict $1500\text{ ms}$ hysteresis hold and $600\text{ ms}$ sustained vocalization threshold in confidence scorer. |
| **Bandwidth Saturation with Multi-Spotlight** | 4-speaker stages might increase download bitrates | LiveKit simulcast layer selection: request 360p for multi-stage tiles; enforce Last-N=9 cap strictly. |
| **DOM Complexity with Pop-out Windows** | Multi-monitor `window.open()` may leak memory or video tracks | Synchronized teardown: closing main meeting window sends immediate broadcast message to close and destroy auxiliary windows. |
| **Bundle Size Bloat** | Rich layouts and controls might exceed the $250\text{ kB}$ budget | Zero third-party layout libraries. Implement grid math, FLIP animations, and splitters using lightweight vanilla CSS and TypeScript math. Estimated footprint: $\le 15\text{ kB}$ gzip. |

---

## 8. PM Recommendation & Milestone Phasing

### A. Milestone Structure: Split into M3A and M3B
**Recommendation: Split M3 into M3A and M3B.**
- **Rationale:** M3 encompasses 7 distinct categories. Grouping them into two focused, bite-sized delivery cycles reduces merge risk and keeps quality gates sharp:
  - **M3A (Visual Engine & Presentation):** Categories 1, 2, 4, 7 (Dynamic Gallery, Speaker View Smoothing, Presentation Modes, Layout Engine Evolution). Focuses on the core meeting visual pipeline.
  - **M3B (Advanced Stages, Ergonomics & Accessibility):** Categories 3, 5, 6 (Multi-Speaker Stages, Self-View Controls, WCAG AAA Accessibility Views). Focuses on specialized formats and universal design.

### B. Estimated Engineering Duration
- **M3A:** 2 Weeks (10 engineering days).
- **M3B:** 2 Weeks (10 engineering days).
- **Total Duration:** 4 Weeks.

### C. Expected Bundle Budget Impact
- Current Baseline (M2 Exit): **204.56 kB gzip**.
- M3A Expected Addition: $+8.5\text{ kB}$ gzip.
- M3B Expected Addition: $+6.5\text{ kB}$ gzip.
- Projected Total M3 Exit Bundle: **~219.5 kB gzip** ($\approx 30.5\text{ kB}$ headroom below the strict $250\text{ kB}$ warning budget).

### D. Relationship to Public Launch
**Recommendation: M3A should precede general public launch; M3B can roll out as the first post-launch feature wave (or fast-follow beta).**
- **M3A (Gallery optimization, speaker smoothing, side-by-side presentation)** directly affects core call perception. Without speaker smoothing and responsive gallery grids, users perceive meetings as "clunky" during group discussions.
- **M3B (Multi-speaker podcast mode, detached self-view, secondary monitor popouts)** is a high-value differentiator for power users, but not an existential blocker for initial private beta release.
