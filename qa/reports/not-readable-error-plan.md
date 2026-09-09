# NotReadableError Reproduction Test Plan

**Status:** DRAFT — QA Definition for M0-P0 Gate
**Owner:** @qa
**Related:** `docs/reports/phase2a-closure.md`, `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:842,867`, `poc/meet-webrtc-core/src/screen/manager.ts:125`

---

## 1. Quick Reproduction Checklist

Use this checklist to reproduce and diagnose `NotReadableError` in any browser. Run each step in order.

### Step 1: Baseline — enumerateDevices
```js
// Open browser console and run:
const devices = await navigator.mediaDevices.enumerateDevices();
devices.forEach(d => console.log(d.kind, d.label));
```
- ✅ List all available camera/microphone devices
- ✅ Note if any device shows "busy" or "in use" labels
- ❌ No devices listed → Could be `NotFoundError` or hardware missing

### Step 2: Check OS Camera Privacy Settings
- **Windows:** Settings → Privacy → Camera → Ensure "Camera access for this device" is On, and the app has permission
- **macOS:** System Settings → Privacy & Security → Camera → Verify browser has permission
- **Linux:** Check `v4l2-ctl` / `udev` rules; ensure `/dev/video0` is not locked
- ❌ If camera is blocked at OS level → `NotReadableError` with message "Camera in use by OS privacy block"

### Step 3: Check if Another App Holds the Camera
- Close all other applications that might use the camera:
  - Zoom, Teams, Meet, Discord, Snapchat, Photo Booth, QuickTime, etc.
  - Browser tabs with active camera (YouTube, Meet, etc.)
- Re-run `enumerateDevices()` — devices should appear without "busy" indicator
- ❌ If another app holds the camera → `NotReadableError: "Camera already in use by another app."`

### Step 4: Test in a New Tab / Incognito Window
- Open a **new browser tab** and run the same camera join flow
- Open **Incognito/Private window** and test — no extensions, fresh state
- ❌ If it works in incognito → extension or tab conflict in regular window

### Step 5: Check chrome://media-internals
- Navigate to `chrome://media-internals/` (Chrome/Edge) or `about:media` (Firefox)
- Look for active camera streams from other tabs/apps
- Check "Current streams" section for camera device status
- ❌ Active streams from other tabs → resource conflict → `NotReadableError`

### Step 6: Verify Constraint vs. Permission vs. Hardware
| Condition | Expected Error | Console Clue |
|-----------|---------------|--------------|
| Camera physically disconnected / disabled | `NotFoundError` | "No camera device found" |
| User denied permission in browser prompt | `NotAllowedError` / `PermissionDeniedError` | "Permission denied" |
| Another app holds camera (foreground/background) | `NotReadableError` | "Camera already in use by another app." |
| Browser bug / unsupported device config | generic `Error` | varies |
| Hardware busy (GPU/VS allocation failure) | `NotReadableError` | "Failed to allocate video source" (exact match) |

### Step 7: Hardware-Busy vs. Permission vs. Constraint Distinction
- **Hardware-busy** (`NotReadableError` with "Failed to allocate videosource"): Occurs when OS cannot allocate the video source — often due to GPU constraints, another tab capturing, or driver issues. Try `enumerateDevices()` first; if devices list is OK but `getUserMedia` fails, it's hardware-busy.
- **Permission** (`NotAllowedError`): User explicitly denied. Browser prompts again on retry.
- **Constraint** (`OverConstrainedError`): Device exists but can't meet constraints (e.g., no facingMode environment). Different error name.
- **NotFoundError**: No device present at all.

### Step 8: Reproduce the Exact Error
```js
try {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
} catch (e) {
  console.error('ERROR NAME:', e.name);
  console.error('ERROR MESSAGE:', e.message);
  console.error('IS NotReadableError:', e.name === 'NotReadableError');
}
```
- ✅ Captures the exact error name and message
- ✅ Distinguishes between the three main categories

---

## 2. Browser Matrix — Known NotReadableError Quirks

| Browser | Version | Quirk | Workaround |
|---------|---------|-------|------------|
| **Chrome** | 127+ | Standard `NotReadableError: "Failed to allocate videosource"` or `"Camera already in use"` | `enumerateDevices()` first; close other tabs; try `video: { facingEnvironment: "environment" }` |
| **Edge** | 127+ | Same as Chromium (same engine) | Same as Chrome |
| **Firefox** | 128+ | `NotReadableError` may include `"Permission denied for video"` even when OS grants permission; distinct from Chrome phrasing | Check `about:permissions`; ensure `media.camera` permission is set to "Allow" |
| **Safari** | 17.4+ | `NotReadableError` often fires on **first** `getUserMedia` if SIP/camera not yet authorized; requires user gesture on same page | Ensure `mousedown`/`touchstart` gesture before `getUserMedia`; check Safari console for "Camera access denied" banner |
| **Safari iOS PWA** | 17.4+ | `NotReadableError` may fire if PWA doesn't have `camera` in `Permitted Domains`; `getDisplayMedia` preferred for screen share | Add `camera` permission in iOS Settings → Safari → Settings for PWA; use `getDisplayMedia` for screen capture |

**Key Distinction**: In all browsers, `NotReadableError` message `"Failed to allocate videosource"` indicates hardware/busy state, while `"Camera already in use by another app."` indicates another process holds the device.

---

## 3. Automated Test Suggestion — vitest Mock

Add a unit test that verifies the UI correctly handles `NotReadableError` from `getUserMedia`. This test should be placed in `poc/meet-webrtc-core/tests/` and run via `npm --prefix poc/meet-webrtc-core test`.

### Test: `not-readable-error.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { useAppStore } from '../src/store/appStore';
import { useWebRTC } from '../src/hooks/useWebRTC';

// Mock navigator.mediaDevices.getUserMedia to throw NotReadableError
vi.mock('livekit-client', () => ({
  Room: class {
    connect() { return Promise.resolve(this); }
  },
}));

describe('NotReadableError Handling', () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'alice',
      livekitToken: 'mock-token',
      sfuUrl: 'ws://127.0.0.1:7880',
      isConnected: false,
      shieldMode: false,
      error: null,
      participants: new Map(),
    });
    
    // Mock getUserMedia to throw NotReadableError
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: vi.fn().mockRejectedValue({
        name: 'NotReadableError',
        message: 'Failed to allocate videosource',
      }),
      writable: true,
      configurable: true,
    });
  });

  it('camera: UI shows "Camera already in use" error banner on NotReadableError', async () => {
    const { result } = renderHook(() => useWebRTC());
    
    // Attempt to enable camera — should catch NotReadableError
    await act(async () => {
      await result.current.setCameraEnabled(true);
    });
    
    // Verify error state is set with the right message
    const error = useAppStore.getState().error;
    expect(error).toBe('Camera already in use by another app.');
    
    // Verify role="alert" banner would render (tested via DOM in integration)
    // document.querySelector('div[role="alert"]') should contain the error text
  });

  it('microphone: UI shows "Microphone already in use" error on NotReadableError', async () => {
    const { result } = renderHook(() => useWebRTC());
    
    await act(async () => {
      await result.current.setMicrophoneEnabled(true);
    });
    
    const error = useAppStore.getState().error;
    expect(error).toBe('Microphone already in use by another app.');
  });

  it('NotReadableError is distinguished from NotAllowedError and NotFoundError', async () => {
    // Test NotAllowedError
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: vi.fn().mockRejectedValue({
        name: 'NotAllowedError',
        message: 'Permission denied',
      }),
      writable: true,
      configurable: true,
    });
    
    const { result } = renderHook(() => useWebRTC());
    await act(async () => {
      await result.current.setCameraEnabled(true);
    });
    expect(useAppStore.getState().error).toBe('Camera access denied — grant permission and reload.');
    
    // Test NotFoundError
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: vi.fn().mockRejectedValue({
        name: 'NotFoundError',
        message: 'No camera device found',
      }),
      writable: true,
      configurable: true,
    });
    
    const { result: r2 } = renderHook(() => useWebRTC());
    await act(async () => {
      await r2.current.setCameraEnabled(true);
    });
    expect(useAppStore.getState().error).toBe('No camera device found.');
  });
});
```

### Test Execution
```bash
npm --prefix poc/meet-webrtc-core test not-readable-error
```

**Expected:** All 3 sub-tests pass, verifying the error branching in `useWebRTC.ts:842-846` and `useWebRTC.ts:867-871` works correctly.

---

## 4. References to Existing Tests and Scripts

| File | Purpose | Related Lines |
|------|---------|---------------|
| `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:842-843` | Camera `NotReadableError` handling → `setError('Camera already in use by another app.')` | 842 |
| `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:867-868` | Mic `NotReadableError` handling → `setError('Microphone already in use by another app.')` | 867 |
| `poc/meet-webrtc-core/src/screen/manager.ts:125` | Screen share `NotReadableError` → `'Could not start screen capture. Another application may be using the screen.'` | 125 |
| `docs/reports/phase2a-closure.md` | Verifies error surfacing was fixed in Phase 2A (B hypothesis) | §4.2, §5.2 |
| `poc/meet-webrtc-core/tests/wp4-welcome-reliability.test.ts` | Existing vitest pattern for mocked LiveKit interactions | Uses `vi.fn().mockRejectedValue` pattern |
| `poc/meet-webrtc-core/tests/test-vectors.ts` | Test vectors include key rotation, reconnect, TURN, lighthouse, privacy | 540 lines total |
| `qa/reports/key-rotation-latency.json` | Histogram artifact — p95 ≤500ms threshold used for rotation validation | |
| `qa/reports/reconnect-latency.json` | Histogram artifact — p95 ≤5s threshold used for reconnect validation | |
| `qa/reports/browser-matrix.html` | 4-browser matrix — relevant for testing NotReadableError across browsers | |
| `qa/reports/lighthouse/*.json` | Lighthouse reports — perf/accessibility/best-practice ≥95 | |
| `qa/reports/screen-share-validation.json` | Screen share validation — includes NotReadableError handling verification | |

---

## 5. Verification Checklist — Any Developer Can Run

### Unit Test Level (reproducible without hardware)
```bash
# 1. Run the vitest mock test
npm --prefix poc/meet-webrtc-core test not-readable-error

# 2. Verify the error messages are correct
#    - Camera: "Camera already in use by another app."
#    - Microphone: "Microphone already in use by another app."
#    - These are already implemented in useWebRTC.ts:842-843, 867-868

# 3. Run existing tests to ensure no regressions
npm --prefix poc/meet-webrtc-core test
```

### Browser-Level (requires camera hardware)
```bash
# 1. Test each browser with the reproduction checklist (Section 1)
# 2. Check chrome://media-internals for active streams
# 3. Close all other apps using camera
# 4. Test in incognito/private window
# 5. Verify error name is NotReadableError (not NotAllowedError or NotFoundError)

# 6. Run browser matrix test
npm --prefix poc/meet-webrtc-core run test:browser

# 7. Verify browser-matrix.html is generated
# 8. Check that NotReadableError is handled consistently across Chromium browsers
```

### Gate Artifact Requirements
- `qa/reports/not-readable-error-plan.md` — this plan (read-only, reference)
- Error branching in `useWebRTC.ts` must be covered by vitest (see test above)
- No `NotReadableError` → silent failure (verified via `phase2a-closure.md` evidence)

---

## 6. Known Issues & Edge Cases

| Issue | Description | Impact |
|-------|-------------|--------|
| **Stale tab camera hold** | A browser tab left open with camera active in another app causes `NotReadableError` on re-join | User must close all camera-holding tabs |
| **Background app camera access** | On macOS, background apps can hold camera without obvious indicator | Use `chrome://media-internals` to diagnose |
| **Safari Encoded Transform limitation** | Safari 17.4 `NotReadableError` may fire if `encodedTransform` not supported for device | Fall back to DTLS-SRTP with explicit ⚠️ UI shield |
| **iOS PWA camera permission** | PWA camera permission separate from iOS Safari permission | Requires iOS Settings → PWA camera grant |
| **Edge profile isolation** | Edge may have separate profile camera settings from Chrome | Test each browser profile independently |

---

**End of NotReadableError Reproduction Test Plan**