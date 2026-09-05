# Phase 2A Minimal Patch — Evidence Collection (Hypotheses A+B+C)

**Date:** 2026-09-04 | **Owner:** PM | **Status:** PATCH BUILT & VERIFIED — AWAITING RUNTIME EVIDENCE

> Hypotheses assumed correct per decision; this patch does NOT refactor publish flow. It only instruments to prove/disprove.

## 1. Hypotheses Under Test

| ID | Hypothesis | Failure Mode |
|----|------------|--------------|
| **A** | `livekitToken` + `sfuUrl` not persisted → reload loses SFU URL, subsequent `Room.connect` uses stale/missing creds | `appStore.partialize` omitted both fields |
| **B** | `getUserMedia` / `publish` failures silent → user sees spinner, no error banner | `useWebRTC` `catch` did `console.warn` only, never `setError` |
| **C** | Insufficient instrumentation → cannot tell if `LocalTrackPublished` fires | No logs for `Room.connect` phase, `setCameraEnabled` lifecycle, or `trackPublications.size` |

## 2. Minimum Patch Applied (No Refactor)

### 2.1 `src/store/appStore.ts`
- Added `livekitToken: string|null` + `sfuUrl: string|null` to `MeetingState` (already present but not persisted)
- Added actions:
  - `setLivekitToken(token)` / `setSfuUrl(url)` / `setCredentials(livekitToken, sfuUrl)`
- Extended `persist.partialize`:
  ```ts
  partialize: (s) => ({
    roomId: s.roomId,
    participantId: s.participantId,
    jwt: s.jwt,
    livekitToken: s.livekitToken, // NEW
    sfuUrl: s.sfuUrl,             // NEW
    keyParam: s.keyParam,
  })
  ```
- **Proves A:** `sessionStorage` now contains `livekitToken` + `sfuUrl`. Verify via `sessionStorage.getItem('meet-secure-state')` → JSON includes both.

### 2.2 `src/hooks/useWebRTC.ts`
- Persist after fetch:
  ```ts
  const fetched = await fetchToken(roomId, name);
  token = fetched.livekitToken;
  resolvedSfuUrl = resolveSfuUrl(fetched.sfuUrl);
  if (token && fetched.sfuUrl) {
    setCredentials(token, fetched.sfuUrl);
    console.log('[LiveKit] Credentials persisted', { sfuUrl: fetched.sfuUrl, tokenPrefix: token.slice(0,20)+'...' });
  }
  ```
- Instrumentation — 5 log families:
  1. `Room.connect start` → `Room.connect success` / `Room.connect failure`
  2. `setCameraEnabled start` → `setCameraEnabled success { trackPublicationsSize, isCameraEnabled }` / `setCameraEnabled failure { name, message }`
  3. `setMicrophoneEnabled start/success/failure` (same)
  4. `LocalTrackPublished { trackSid, kind, source, participantIdentity, trackPublicationsSize }`
  5. `trackPublications.size` (explicit after each publish + inside event)
- Failure surfacing (Hypothesis B):
  ```ts
  console.error('[LiveKit] setCameraEnabled failure', { name, message });
  if (e.name === 'NotAllowedError') setError('Camera access denied — grant permission and reload.');
  else if (e.name === 'NotFoundError') setError('No camera device found.');
  else if (e.name === 'NotReadableError') setError('Camera already in use by another app.');
  else setError(`Camera publish failed: ${e.message}`);
  // same for microphone
  ```
- UI surfacing: `src/pages/MeetingPage.tsx` now renders `useAppStore(s=>s.error)` as `role="alert"` banner.

### 2.3 `src/pages/MeetingPage.tsx`
- Added:
  ```tsx
  const error = useAppStore((s) => s.error);
  {error && <div role="alert" style={...}>{error}</div>}
  ```

**Build result:** `tsc --noEmit` exit 0, `vite build` exit 0 (63 modules, 753 KiB precache). No refactor of publish ordering.

## 3. Exact Console Output Expected

Copy these strings verbatim into test assertions / manual verification.

### 3A. Permission GRANTED (camera + mic allowed)

```text
[Token] fetched { roomId: "r-abc", participantId: "p-...", livekitTokenPrefix: "eyJhbGciOiJIUzI1Ni...", sfuUrl: "wss://livekit/rtc" }
[LiveKit] Credentials persisted { sfuUrl: "wss://livekit/rtc", tokenPrefix: "eyJhbGciOiJIUzI1Ni..." }
[LiveKit] Room.connect start { sfuUrl: "ws://127.0.0.1:7880", tokenPrefix: "eyJhbGciOiJIUzI1Ni..." }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", trackPublicationsSize: 0 }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", localIdentity: "user-abc123", trackPublicationsSize: 0 }  // from RoomEvent.Connected
[LiveKit] setCameraEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_VC...", kind: "video", source: "camera", participantIdentity: "user-abc123", trackPublicationsSize: 1 }
[LiveKit] trackPublications.size 1
[LiveKit] setCameraEnabled success { trackPublicationsSize: 1, isCameraEnabled: true }
[LiveKit] trackPublications.size 1
[LiveKit] setMicrophoneEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_AU...", kind: "audio", source: "microphone", participantIdentity: "user-abc123", trackPublicationsSize: 2 }
[LiveKit] trackPublications.size 2
[LiveKit] setMicrophoneEnabled success { trackPublicationsSize: 2, isMicrophoneEnabled: true }
[LiveKit] trackPublications.size 2
```

- `window.__LIVEKIT_ROOM__.localParticipant.trackPublications.size === 2`
- `localStream.getTracks().length === 2`
- No `setCameraEnabled failure` / `setMicrophoneEnabled failure`
- UI: no `role="alert"` error banner.

### 3B. Permission DENIED (camera denied, mic granted OR both denied)

**Camera denied, mic granted:**

```text
[LiveKit] Credentials persisted { ... }
[LiveKit] Room.connect start { ... }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", trackPublicationsSize: 0 }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", localIdentity: "user-abc123", trackPublicationsSize: 0 }
[LiveKit] setCameraEnabled start
[LiveKit] setCameraEnabled failure { name: "NotAllowedError", message: "Permission denied" }
[LiveKit] Camera publish failed (permission/device): Permission denied
[LiveKit] setMicrophoneEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_AU...", kind: "audio", source: "microphone", participantIdentity: "user-abc123", trackPublicationsSize: 1 }
[LiveKit] trackPublications.size 1
[LiveKit] setMicrophoneEnabled success { trackPublicationsSize: 1, isMicrophoneEnabled: true }
[LiveKit] trackPublications.size 1
```

**Both denied:**

```text
[LiveKit] setCameraEnabled start
[LiveKit] setCameraEnabled failure { name: "NotAllowedError", message: "Permission denied" }
[LiveKit] setMicrophoneEnabled start
[LiveKit] setMicrophoneEnabled failure { name: "NotAllowedError", message: "Permission denied" }
```

- `trackPublications.size` remains `0` (or `1` if one kind succeeded)
- UI: `role="alert"` shows `"Camera access denied — grant permission and reload."` (or microphone variant) — visible without opening DevTools.
- Wireshark / LiveKit dashboard shows room connected but no video layer published.

### 3C. Room.connect failure (orthogonal, for completeness)

```text
[LiveKit] Room.connect start { sfuUrl: "ws://127.0.0.1:7880", tokenPrefix: "eyJ..." }
[LiveKit] Room.connect failure { name: "ConnectionError", message: "...", stack: "..." }
[LiveKit] Connection failed: { message, stack, roomId, sfuUrl, livekitTokenPrefix, file: "useWebRTC.ts", line: "initialize callback" }
```

UI: `"LiveKit connection failed: ..."` banner.

## 4. Verdict — Does `LocalTrackPublished` Fire When Permission Granted?

**Predicted answer: YES** — conditioned on `Room.connect` success and `getUserMedia` grant.

- LiveKit `Room.localParticipant.setCameraEnabled(true)` internally calls `createTrack` → `getUserMedia` → `publishTrack`. On success it emits `RoomEvent.LocalTrackPublished` **once per kind** and increments `localParticipant.trackPublications.size`.
- Our instrumentation logs `LocalTrackPublished` **before** `setCameraEnabled success`, proving the event is the publication acknowledgement, not the `getUserMedia` grant itself.
- If permission is denied, the promise rejects with `NotAllowedError`, **no** `LocalTrackPublished` fires for that kind, and `trackPublications.size` does not increment. This delta is the B evidence.

**How to collect evidence:**

1. Dev server: `npm --prefix poc/meet-webrtc-core run dev` (COOP/COEP headers required for SFrame WASM).
2. Infra: `docker compose -f infra/compose.yaml up --build --wait` (LiveKit 7880, meet-signal 8080).
3. Open `http://127.0.0.1:5173/r/test-room#k=<64-hex>` in Chrome 127+ with mic/cam allowed.
4. Observe console — match **3A** exactly. Run `window.__LIVEKIT_ROOM__.localParticipant.trackPublications.size` → expect `2`.
5. Revoke camera permission (`chrome://settings/content/camera` → Block `127.0.0.1:5173`, reload). Match **3B**.
6. Capture logs + `sessionStorage.getItem('meet-secure-state')` (should contain `livekitToken` + `sfuUrl`) for `qa/reports/`.

If **3A** shows `LocalTrackPublished` with `trackPublicationsSize:1→2`, hypothesis **C is confirmed** and hypothesis **A+B fixes are validated**. Then we may proceed to refactor publish flow (e.g., pre-publish checks, retry, device fallback). If `LocalTrackPublished` does **not** fire even when granted, hypothesis C is falsified — publish path is broken upstream (token/SFU URL/permission propagation), not event handling.

## 5. Stop / Block Conditions

- **STOP:** Build green + logs above reproducible on 1 browser → evidence complete. Do NOT start publish-flow refactor.
- **BLOCK:** `Room.connect failure` or `trackPublications.size` stays `0` even when granted → attach stack + `livekitTokenPrefix` + `sfuUrl` + file/line and halt.

## 6. Files Changed (Minimal)

- `poc/meet-webrtc-core/src/store/appStore.ts` — persist + setters
- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts` — instrumentation + error surfacing + persist call
- `poc/meet-webrtc-core/src/pages/MeetingPage.tsx` — error banner (UI surface)

No changes to `webrtc/manager.ts` mesh path, SFrame, or SFU assignment.

## 7. Next Step After Evidence

Only after `qa/reports/phase2a-localtrackpublished.json` contains measured `trackPublications.size` histogram for 10 trials (5 granted, 5 denied) may PM authorize Phase 2B publish-flow refactor.
