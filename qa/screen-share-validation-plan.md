# Screen-Share Wiring Fix — Q5+Q6 Validation Plan

## Defect Summary
`ControlBar.handleScreenShare()` calls `setLocalScreenShare()` (Zustand store update only) but never calls `useWebRTC.startScreenShare()` which wires through `roomRef.current.localParticipant.setScreenShareEnabled(true)` → `getDisplayMedia()` → `LocalTrackPublished`. Result: picker never appears, no publication, `publications.size` unchanged.

---

## Q5: Automated Validation

### File Naming Convention
`m4a-screen-share*.test.ts(x)` — follows `m{milestone}-{domain}-*.test.ts(x)` pattern.

### Q5.1: Unit Tests — `m4a-screen-share-unit.test.tsx`

| Test Case | Assertion | Scope |
|---|---|---|
| `M4A-SS-01: ControlBar handleScreenShare calls setLocalScreenShare` | `expect(setLocalScreenShare).toHaveBeenCalledWith(true)` when share activated; `expect(setLocalScreenShare).toHaveBeenCalledWith(false)` when deactivated | ControlBar → `setLocalScreenShare` prop call (no store mirror yet) |
| `M4A-SS-02: setLocalScreenShare mirrors to localParticipant.screenSharing` | After `setLocalScreenShare(true)`, `useLocalParticipant.screenSharing` is `true`; after `false`, it is `false` | `appStore.setLocalScreenShare` state update |
| `M4A-SS-03: setLocalScreenShare does NOT call startScreenShare` | Verify that calling `setLocalScreenShare(true)` does NOT trigger `startScreenShare` (separation of concerns) | Store vs. WebRTC wiring boundary |
| `M4A-SS-04: Mock Room.setScreenShareEnabled publication size delta` | Mock `room.localParticipant.setScreenShareEnabled(true)` → assert `publicationCount` increases by +1; `setScreenShareEnabled(false)` → `-1` | Unit: mocked LiveKit participant |

### Q5.2: Integration Tests — `m4a-screen-share-integration.test.tsx`

| Test Case | Assertion | Scope |
|---|---|---|
| `M4A-SS-05: Mock getDisplayMedia grant → publication size +1` | `mockGetDisplayMedia` resolves with valid `MediaStream` → `trackPublications.size` increments by 1 | `navigator.mediaDevices.getUserMedia` mock → publication registry |
| `M4A-SS-06: Mock getDisplayMedia deny → publication size unchanged` | `mockGetDisplayMedia` rejects with `NotAllowedError` → `trackPublications.size` stays same | Permission denied flow |
| `M4A-SS-07: Mock getDisplayMedia abort → publication size -1` | `mockGetDisplayMedia` initially resolves, then `getUserMedia` called with `{audio:false,video:false}` → size decrements by 1 | Abort/stop flow |
| `M4A-SS-08: Camera track undisturbed during screen share start` | `setCameraEnabled(true)` called before screen share → `cameraTrackPublications.size` unchanged (no regression) | Camera/screen-share non-interference |
| `M4A-SS-09: SFrame transform attached exactly once on startScreenShare` | `installSFrameOnSenderShared` called once; second startScreenShare no-op for SFrame install | SFrame single-attach guard |

### Q5.3: Regression Tests — `m4a-screen-share-regression.test.tsx`

| Test Case | Assertion | Scope |
|---|---|---|
| `M4A-SS-10: Local camera track preserved when screen share starts/stops` | `localParticipant.getVideoTrack()` still returns original video track after screen share cycle | No camera disruption |
| `M4A-SS-11: SFrame transform detached on stopScreenShare` | After `stopScreenShare()`, `sframeRef.current` cleared, encrypt counter reset | Cleanup integrity |
| `M4A-SS-12: publications.size monotonic during share cycle` | Grant → size +1; Stop → size -1 → Grant → size +1 (same track, not double-published) | Publication lifecycle correctness |

---

## Q6: Manual Validation Matrix

| # | Browser | Permission Path | Multi-Monitor | Stop Method | Audio Share | Remote Render | Local Camera | Reconnect During Share | Permission Revoked Mid-Share | Severity | Complexity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Chrome 127 | Allow → picker appears → screen selected → share active | Single monitor | In-app button ✅ | Off ✅ | Remote renders shared screen ✅ | Local camera stays on ✅ | Reconnect re-joins, share resumes ✅ | — | Permission revoked → alert shown, share stops ✅ | P1 | M |
| M2 | Edge 127 | Allow → picker appears → screen selected → share active | Single monitor | In-app button ✅ | On ✅ | Remote renders shared screen ✅ | Local camera stays on ✅ | Reconnect re-joins, share resumes ✅ | — | Permission revoked → alert shown, share stops ✅ | P1 | M |
| M3 | Firefox 127 | Allow → picker appears → "Share Screen" dialog → screen selected → share active | Single monitor + "Share Audio" tick | Browser chrome ✅ (Win+Shift+S) | Off ✅ | Remote renders shared screen ✅ | Local camera stays on ✅ | Reconnect re-joins, share resumes ✅ | — | Permission revoked → alert shown, share stops ✅ | P1 | M |
| M4 | Safari 17.0 | Allow → picker appears (webkit screen capture) → screen selected → share active | Single monitor | In-app button ✅ | Off ✅ | Remote renders shared screen ✅ | Local camera stays on ✅ | Reconnect re-joins, share resumes ✅ | — | Permission revoked → alert shown, share stops ✅ | P1 | M |
| M5 | Chrome 127 | Deny → picker dismissed → `handleScreenShare` logs error → size unchanged | N/A | N/A | N/A | N/A | Local camera preserved ✅ | N/A | Permission permanently denied → UI reflects restricted state ✅ | P2 | L |
| M6 | Edge 127 | Deny → same as Chrome | N/A | N/A | N/A | N/A | Local camera preserved ✅ | N/A | Same ✅ | P2 | L |
| M7 | Firefox 127 | Deny → same as Chrome | N/A | N/A | N/A | N/A | Local camera preserved ✅ | N/A | Same ✅ | P2 | L |
| M8 | Safari 17.0 | Deny → same as Chrome/FF (WebKit screen capture prompt) | N/A | N/A | N/A | N/A | Local camera preserved ✅ | N/A | Same ✅ | P2 | L |
| M9 | Chrome 127 | Dismiss picker (close) → no publication → size unchanged | N/A | N/A | N/A | N/A | Local camera preserved ✅ | N/A | N/A | P2 | L |
| M10 | Chrome 127 | Multi-monitor: select Monitor 2 → remote renders Monitor 2 only ✅ | Two monitors | In-app button ✅ | Off ✅ | Remote renders selected monitor ✅ | Local camera stays on ✅ | Reconnect during multi-monitor share → share re-prompts ✅ | — | P2 | M |
| M11 | Chrome 127 | Audio share toggle on (include audio from shared screen) | Single monitor | In-app button ✅ | On ✅ | Remote renders screen with audio ✅ | Local camera stays on ✅ | Reconnect with audio share → audio resumes ✅ | — | P2 | M |
| M12 | Chrome 127 | Audio share toggle off | Single monitor | In-app button ✅ | Off ✅ | Remote renders screen without audio ✅ | Local camera stays on ✅ | Reconnect with audio off → share resumes without audio ✅ | — | P2 | M |

**Severity legend:** P0 = blocker (cannot close gate), P1 = critical (must fix), P2 = minor (verify/confirm)
**Complexity legend:** L = ≤2h, M = ½ day, H = ≥1 day

### Required Evidence Checklist (Q6)
- [ ] `chrome://webrtc-internals` — candidateType=relay + screen track `trackPublications.size` checks
- [ ] SFrame ciphertext in Wireshark `rtp && sframe` pcap (if SFrame enabled)
- [ ] `trackPublications.size` before/after share start/stop (console log or devtools)
- [ ] Browser console `LocalTrackPublished` event presence/absence
- [ ] Permission state after deny/revoke (settings UI check)
- [ ] Multi-monitor device ID verification in picker UI

---
**Stop Condition:** When Q5/Q6 plans listed above, stop. Do NOT write tests.