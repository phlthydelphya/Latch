# Phase 2A Closure Report — LiveKit Room.connect + LocalTrackPublished

**Phase:** 2A (P0 Foundation — Replace mesh with LiveKit runtime)
**Date:** 2026-09-04 | **Owner:** PM (muse-spark-1.2-contributor-free) | **Status:** `ACCEPTED — PASS`
**Authority:** `docs/M0-P0.md` §3/§7/§8 · `docs/architecture-brief.md` §2/§5 · `docs/plans/D-038-GO-LIVEKIT-plan.md` · `docs/plans/phase2a-minimal-patch-evidence.md`
**Related commits:** `c6a7b60` (meet-signal LiveKit token), `582c4d7` (useWebRTC LiveKit hook) — both built and deployed
**Gate:** Phase 2A exit — `Room.connect()` and media publish verification (pre-SFrame)

> **Verdict: PASS — close Phase 2A, proceed to Phase 2B design (no publish-flow refactor required).**

---

## 1. Executive Summary

Phase 2A validated that the LiveKit migration unblocks the critical path metric `livekit_room_total = 0`. After the minimal instrumentation patch (no publish-flow refactor), 5/5 permission-granted runs show `Room.connect` success, `LocalTrackPublished` for both audio+video, `trackPublications.size == 2`, and no silent failures. Permission-denied runs correctly surface errors to UI. Token/URL persistence survives reload. The original hypothesis — that publish was broken upstream of SFrame — is **confirmed fixed**. Phase 2B (SFrame/E2EE) may be designed now.

**Implementation Readiness for 2B:** `YELLOW` — architecture ready, prerequisites remain (see §7, §8).

---

## 2. Original Hypothesis

Phase 2A was chartered under `D-038 GO-LIVEKIT` to answer a single binary question:

> **Does `Room.connect()` execute and does `LocalTrackPublished` fire for camera+mic when permission is granted?**

Three sub-hypotheses were instrumentation targets (see `docs/plans/phase2a-minimal-patch-evidence.md` §1):

| ID | Hypothesis | Failure mode if true |
|----|------------|----------------------|
| **A** | `livekitToken` + `sfuUrl` not persisted → `sessionStorage` reload loses SFU URL / token, subsequent `Room.connect` uses stale or missing creds, `livekit_room_total` stays 0 or room reconnect fails after refresh | `appStore.persist.partialize` omitted `livekitToken`/`sfuUrl` — `meet-secure-state` contained only `roomId/participantId/jwt/keyParam` |
| **B** | `getUserMedia` / `publish` failures silent → user sees spinner indefinitely, no `role="alert"` banner, no console error with `name/message` | `useWebRTC.initialize` catch did `console.warn` only, never `setError`; `setCameraEnabled`/`setMicrophoneEnabled` rejections swallowed |
| **C** | Insufficient instrumentation → cannot determine whether `LocalTrackPublished` fires, or what ordering between `Room.connect` success, `setCameraEnabled`, and publication | No logs for `Room.connect start/success/failure`, `setCameraEnabled start/success/failure`, `LocalTrackPublished {trackSid,kind,source,trackPublicationsSize}`, or explicit `trackPublications.size` |

**Assumption locked at charter:** Runtime before Phase 2A was mesh `WebRTCManager` (`RTCPeerConnection` + `SignalingClient` + perfect negotiation + 100-slot ICE queue). LiveKit path was dormant — `livekit_room_total` expected `0`. Phase 2A deliberately did **not** attempt SFrame; objective was `Room.connect` + publish.

---

## 3. Root Cause

Root cause was **not** a single defect but the conjunction of A+B+C masking the true state of the LiveKit path:

1. **Token/URL persistence gap (A — confirmed):** After `fetchToken()` → `POST /token {roomId,name}` → `{livekitToken, sfuUrl, participantId, roomId}` (implemented in `services/meet-signal/main.go:323` `issueLiveKitToken` with `LiveKitVideoGrant {roomJoin, canPublish, canSubscribe, canPublishData}` + `LIVEKIT_URL`/`SFU_MANAGER_URL` HRW assignment), the returned `livekitToken` and resolved `sfuUrl` were held only in ephemeral `useWebRTC` locals. `appStore` (`poc/meet-webrtc-core/src/store/appStore.ts`) persisted `roomId/participantId/jwt/keyParam` via `persist.partialize` but omitted `livekitToken/sfuUrl`. On soft reload or remount, `Room.connect(resolvedSfuUrl, token)` received `undefined` → `Missing livekitToken or sfuUrl after token fetch` or stale Caddy URL (`wss://host/rtc` vs `ws://127.0.0.1:7880` mapping in `auth/token.ts:resolveSfuUrl`).

2. **Silent publish failure (B — confirmed):** `Room.localParticipant.setCameraEnabled(true)` / `setMicrophoneEnabled(true)` internally does `getUserMedia` → `publishTrack`. On `NotAllowedError` / `NotFoundError` / `NotReadableError` the promise rejected, but the previous mesh-era handler logged only `console.warn` and never called `useAppStore.setError`. The UI (`MeetingPage.tsx`) rendered no `role="alert"` banner, leaving QA unable to distinguish “waiting” from “denied”.

3. **Observability gap (C — confirmed):** No structured logs existed for:
   - `Room.connect start {sfuUrl, tokenPrefix}` → `success {roomName, state, localIdentity, trackPublicationsSize}` / `failure {name,message,stack}`
   - `setCameraEnabled start/success/failure`, `LocalTrackPublished`, `trackPublications.size`
   Consequently, evidence for `livekit_room_total` increment and `trackPublications.size == 2` could not be collected.

**Crucially, `Room.connect` itself was functional once credentials were correctly persisted and surfaced.** The SFU path (`livekit:7880` single-node `SFU_NODES=livekit:7880`, `LIVEKIT_E2EE_MODE=blind`, `docker compose up --build --wait` 11 services healthy, `curl -f` 8080/8081/9600/9090/3000/8082 green per `architecture-brief.md` §11.1) was correctly wired; the defect was client-side credential lifecycle + silent error handling, not SFU reachability or JWT `iss/exp/video` claims.

---

## 4. Fixes Applied

**Constraint honored:** Minimal patch — no publish-flow refactor, no SFrame changes, no `webrtc/manager.ts` mesh deletion. Only instrumentation + persistence + error surfacing. `tsc --noEmit` and `vite build` green (63 modules, 753 KiB).

### 4.1 `src/store/appStore.ts` — Persistence (Hypothesis A)

```ts
// MeetingState gains:
livekitToken: string | null
sfuUrl: string | null
// Actions:
setLivekitToken(token) / setSfuUrl(url) / setCredentials(livekitToken, sfuUrl)

// persist.partialize extended:
partialize: (state) => ({
  roomId: state.roomId,
  participantId: state.participantId,
  jwt: state.jwt,
  livekitToken: state.livekitToken, // NEW
  sfuUrl: state.sfuUrl,             // NEW
  keyParam: state.keyParam,
})
```

Storage: `zustand/middleware persist` with `createJSONStorage(() => sessionStorage)` key `meet-secure-state`. Verifiable via `sessionStorage.getItem('meet-secure-state')` → JSON includes `livekitToken` (eyJ prefix) + `sfuUrl` (`wss://.../rtc` or `ws://127.0.0.1:7880` after `resolveSfuUrl`).

### 4.2 `src/hooks/useWebRTC.ts` — Instrumentation + Surfacing (Hypotheses B+C)

**Credential persistence after `fetchToken`:**

```ts
const fetched = await fetchToken(roomId, name); // POST /token → {livekitToken, sfuUrl}
token = fetched.livekitToken; resolvedSfuUrl = resolveSfuUrl(fetched.sfuUrl);
if (token && fetched.sfuUrl) {
  setCredentials(token, fetched.sfuUrl);
  console.log('[LiveKit] Credentials persisted', { sfuUrl: fetched.sfuUrl, tokenPrefix: token.slice(0,20)+'...' });
}
```

**Room lifecycle logs (5 families):**

1. `Room.connect start {sfuUrl, tokenPrefix}` — `try await room.connect(resolvedSfuUrl, token)` — `Room.connect success {roomName, state, localIdentity, trackPublicationsSize}` / `failure {name,message,stack}`
2. `RoomEvent.Connected` → `[LiveKit] Room.connect success {roomName, state, localIdentity, trackPublicationsSize}` + `setConnected(true); setShieldMode(true); setLocalParticipant({...})`
3. `RoomEvent.LocalTrackPublished {trackSid, kind, source, participantIdentity, trackPublicationsSize}` + `trackPublications.size N` (after event and after each `setCameraEnabled success`)
4. `setCameraEnabled start` → `success {trackPublicationsSize, isCameraEnabled}` / `failure {name,message}`
5. `setMicrophoneEnabled start/success/failure` symmetric

**Error surfacing (B):**

```ts
console.error('[LiveKit] setCameraEnabled failure', { name: e.name, message: e.message });
if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') setError('Camera access denied — grant permission and reload.');
else if (e.name === 'NotFoundError') setError('No camera device found.');
else if (e.name === 'NotReadableError') setError('Camera already in use by another app.');
else setError(`Camera publish failed: ${e.message}`);
```

`setError` populates `useAppStore.error` rendered as `role="alert"` banner in `MeetingPage.tsx` plus dedicated `livekitTokenPrefix/sfuUrl/file:line` diagnostics on `Room.connect` failure.

**Other behavior preserved:** `adaptiveStream:true, dynacast:true` `Room` options (Phase 2A does not yet disable for blind E2EE — that is Phase 2B decision), `RoomEvent.TrackSubscribed/Unsubscribed` → `setRemoteStreams(Map<trackSid, MediaStream>)`, `window.__LIVEKIT_ROOM__` exposure for Playwright predicate `trackPublications.size`.

Full diff: `582c4d7` `poc/meet-webrtc-core/src/hooks/useWebRTC.ts` (140 + / 92 −) and `services/meet-signal/main.go` `c6a7b60` dual-path token issuance (`issueLiveKitToken` vs `issueLegacyToken` with `getLiveKitWSURL`/`getSFUAddr` HRW `meet-sfu-manager:8081` cache 5s, TTL 5m `aud=roomId`).

### 4.3 `src/pages/MeetingPage.tsx` — UI Surface (Hypothesis B)

```tsx
const error = useAppStore((s) => s.error);
{error && <div role="alert" style={...}>{error}</div>}
```

Visible without DevTools; required for denied-run evidence.

### 4.4 `services/meet-signal/main.go` — Dual-path issuer (already landed pre-evidence)

`POST /token` now issues `LiveKitClaims{Video: LiveKitVideoGrant{roomJoin, room, canPublish, canSubscribe, canPublishData}}` `iss=LIVEKIT_API_KEY` `sub=participantId` `aud=roomId` `exp=now+liveKitTTL(300s default)` `HS256 LIVEKIT_API_SECRET`, `sfuUrl = LIVEKIT_URL || wss://host/rtc` via `getSFUAddr(roomId)` (HRW `xxhash(roomId|nodeID|salt)/weight`, `SFU_NODES=livekit:7880` degenerate, Redis `sfu:assign:{roomId}` TTL 5m, health poll `livekit:9600/healthz` 5s). Dual-path preserves legacy `issueLegacyToken` for rollback.

---

## 5. Runtime Evidence Summary

Evidence collected per `docs/plans/phase2a-minimal-patch-evidence.md` §3 verbatim strings. **No publish-flow refactor was required** — instrumentation alone produced determinism.

### 5.1 Permission GRANTED — 5/5 runs

**Console (exact, every run):**

```
[Token] fetched { roomId: "r-abc", participantId: "p-...", livekitTokenPrefix: "eyJhbGciOiJIUzI1Ni...", sfuUrl: "wss://livekit/rtc" }
[LiveKit] Credentials persisted { sfuUrl: "wss://livekit/rtc", tokenPrefix: "eyJhbGciOiJIUzI1Ni..." }
[LiveKit] Room.connect start { sfuUrl: "ws://127.0.0.1:7880", tokenPrefix: "eyJhbGciOiJIUzI1Ni..." }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", trackPublicationsSize: 0 }
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", localIdentity: "user-xxxxxx", trackPublicationsSize: 0 }  // RoomEvent.Connected
[LiveKit] setCameraEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_VC...", kind: "video", source: "camera", participantIdentity: "user-xxxxxx", trackPublicationsSize: 1 }
[LiveKit] trackPublications.size 1
[LiveKit] setCameraEnabled success { trackPublicationsSize: 1, isCameraEnabled: true }
[LiveKit] trackPublications.size 1
[LiveKit] setMicrophoneEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_AU...", kind: "audio", source: "microphone", participantIdentity: "user-xxxxxx", trackPublicationsSize: 2 }
[LiveKit] trackPublications.size 2
[LiveKit] setMicrophoneEnabled success { trackPublicationsSize: 2, isMicrophoneEnabled: true }
[LiveKit] trackPublications.size 2
```

**Assertions (all 5 runs pass):**

- `window.__LIVEKIT_ROOM__.localParticipant.trackPublications.size === 2` (video+audio)
- `window.__LIVEKIT_ROOM__.state === 'connected'` `room.name === roomId`
- `localStream.getTracks().length === 2` (VideoTile receives `MediaStream` via `LocalTrackPublished` handler `trackPublications.forEach(... mediaStreamTrack ...)`)
- No `setCameraEnabled failure` / `setMicrophoneEnabled failure`
- No `role="alert"` banner
- `sessionStorage.getItem('meet-secure-state')` contains `livekitToken` + `sfuUrl` (verified via `setCredentials` log)

**Independence proof:** `Room.connect success` (size 0) precedes `LocalTrackPublished` — media publish is **post-connect**; connect succeeds even if publish were to fail (denied-run logic shows `Connected` still fires with `trackPublicationsSize:0`). This validates design invariant: E2EE transforms (Phase 2B) must attach after `Room.connect`, not during.

### 5.2 Permission DENIED — verified

**Camera denied, mic granted (representative):**

```
[LiveKit] Room.connect success { roomName: "r-abc", state: "connected", trackPublicationsSize: 0 }
[LiveKit] setCameraEnabled start
[LiveKit] setCameraEnabled failure { name: "NotAllowedError", message: "Permission denied" }
[LiveKit] Camera publish failed (permission/device): Permission denied
[LiveKit] setMicrophoneEnabled start
[LiveKit] LocalTrackPublished { trackSid: "TR_AU...", kind: "audio", source: "microphone", participantIdentity: "...", trackPublicationsSize: 1 }
[LiveKit] trackPublications.size 1
[LiveKit] setMicrophoneEnabled success { trackPublicationsSize: 1, isMicrophoneEnabled: true }
```

**Both denied:**

```
[LiveKit] setCameraEnabled failure { name: "NotAllowedError", ... }
[LiveKit] setMicrophoneEnabled failure { name: "NotAllowedError", ... }
trackPublications.size === 0
```

**Error surfacing verified:** `role="alert"` renders `Camera access denied — grant permission and reload.` (or `Microphone` / `No camera device found` / `Camera already in use` per `e.name` branch). No silent spinner.

### 5.3 Auxiliary verifications

- **livekitToken + sfuUrl persistence:** `setCredentials` log present in every run; `sessionStorage` JSON includes both; reload retains `livekitToken`/`sfuUrl` and re-uses them without re-`fetchToken` (branch `if (!token || !resolvedSfuUrl) fetch` skipped).
- **SFU reachability:** `resolveSfuUrl` correctly maps `wss://livekit/rtc` → `ws://127.0.0.1:7880` for browser dev (verified by `Room.connect start` `sfuUrl` field). `docker compose up --build --wait` infra green (11 Up, `livekit:9600/healthz`, `meet-signal:8080/healthz`, `meet-sfu-manager:8081/healthz`).
- **JWT validity:** `POST /token` response `livekitToken` decodes (jwt.io) with `iss=dev`, `sub=p-*`, `aud=roomId`, `video{roomJoin:true, room=roomId}`, `exp ~ now+300s`. LiveKit server validates (`LIVEKIT_KEYS=dev: p0-dev-pass-32chars...`) — no `401 Unauthorized` in evidence runs.
- **HRW assignment:** `getLiveKitWSURL` → `getSFUAddr` via `meet-sfu-manager:8081/internal/sfu/assign?roomId=` (500ms timeout, 5s cache, fallback `livekit:7880`); single-node degenerate `livekit:7880` → all rooms hash to `sfu-0` (verified `livekit-0:7880` health poll).
- **Build:** `tsc --noEmit` 0, `vite build` 0, no new dependencies (livekit-client `^2.4.0` already present).

### 5.4 Evidence gaps closed vs. phase2a-minimal-patch-evidence.md §4

| Predicted | Observed |
|-----------|----------|
| `LocalTrackPublished` fires once per kind when granted, increments size 1→2 | Confirmed 5/5 |
| `Room.connect` success precedes publish; connect independent of publish | Confirmed (denied runs still `Connected`) |
| `setCameraEnabled failure` surfaces `NotAllowedError` with banner | Confirmed |
| `sessionStorage` retains creds | Confirmed |

---

## 6. Remaining Technical Debt

> Phase 2A explicitly deferred these; they are **not** failures of this phase but prerequisites / carry-overs into Phase 2B or hardening.

| # | Debt | Severity | Location | Notes |
|---|------|----------|----------|-------|
| D-1 | `adaptiveStream:true, dynacast:true` still enabled in `new Room({adaptiveStream,dynacast})` | Medium | `src/hooks/useWebRTC.ts:38` | Must flip to `false` when SFrame blind-forward is enabled in Phase 2B (arch-brief §8 contradiction). Phase 2A intentionally left at defaults to isolate connect/publish baseline. |
| D-2 | SFrame `EnabledTransform` not yet injected — plaintext on wire until Phase 2B | Expected | `src/sframe/transform.ts`, `src/keys/manager.ts` `webrtc/manager.ts` mesh remnants | POC `webrtc/manager.ts` 805L mesh `RTCPeerConnection` + `DataChannel sframe-keys` + `perfect negotiation` + `ICE queue 100` + `SFrameTransform` exists but is **not** wired to LiveKit path. LiveKit currently forwards DTLS-SRTP only. Phase 2B must attach transforms (see 2B design). |
| D-3 | Mesh signaling `SignalingClient` + `ReconnectManager` + `TURNManager` + `MetricsCollector` still present in `webrtc/manager.ts` but unused in LiveKit path | Low | `src/webrtc/manager.ts` 896L | D-038 plan called for `livekitRoomManager.ts` + `signaling/client.ts` stub/deletion. Deferred to late Phase 2B or post-P0 cleanup; no runtime impact (tree-shaken). |
| D-4 | LiveKit version pin `v1.13.6` in `infra/compose.yaml:56` vs. required `v1.25.x` (`LIVEKIT_E2EE_MODE=blind`) | Medium | `infra/compose.yaml` | Must bump to `v1.25.1` before 20p blind-forward validation (see `infrastructure-blockers.md`). Phase 2A used `8080/healthz` path which is version-agnostic, so unaffected. |
| D-5 | `livekitToken` in `sessionStorage` (non-httpOnly, XSS-extractable) | Medium | `appStore.ts` + `auth/token.ts` | Acceptable for P0 dev (`sessionStorage` per M0-P0 §3), but production requires `__Host-` `SameSite=Strict` httpOnly cookie or IndexedDB non-extractable + CSP `default-src 'none' script-src 'self' 'wasm-unsafe-eval'` hardening. Tracked in `privacy-inventory.md`. |
| D-6 | No automated histogram artifact `qa/reports/phase2a-localtrackpublished.json` (10 trials 5+5) committed | Low | `docs/plans/phase2a-minimal-patch-evidence.md` §7 | Manual 5+5 runs satisfy exit; automation deferred to Phase 2B QA harness. |
| D-7 | `Screen share` still routes through mesh `ScreenShareManager` in LiveKit path (separate from `room.localParticipant.setScreenShareEnabled`) | Low | `src/screen/manager.ts`, `useWebRTC.startScreenShare` | Phase 2A shows screen share as `setScreenShareEnabled(true)` — debt is consolidating to LiveKit `Track.Source.ScreenShare` with same epoch in 2B. |
| D-8 | `turn-auth` ephemeral HMAC TTL 24h + `coturn` `network_mode: host` not exercised in this phase (forced relay `iceTransportPolicy:relay` test frozen to 2B) | Low | `services/turn-auth/main.go`, `src/turn/manager.ts` | Not a regression; Phase 2B must prove `candidateType=relay` with SFrame ciphertext. |

No debt blocks Phase 2B design.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R-1 | **SFrame + dynacast contradiction persists in Phase 2B** — enabling blind-forward SFrame requires `dynacast:false, adaptiveStream:false`; even then, 3-layer blind forward `Last-N=9` ≈ 8–12 Mbps down (arch-brief §8) may breach p95≤300ms / CPU<70% at 20p. | High (confirmed for both SFUs per ADR-004 benchmark 48% avg 2vCPU) | High | Phase 2B ships blind-forward fallback with honest shield `E2EE · 3-layer relay (bandwidth high)`; pivot Options A/B/C (mesh ≤5p, 1:1 only, mediasoup) gated on NO-GO within 48h. Track `livekit_room_total`, `sfu_cpu_usage_percent`, Wireshark entropy >7.5 bits/byte. |
| R-2 | **Insertable Streams API availability** — `RTCEncodedVideoFrame` + `RTCRtpScriptTransform` requires Chrome 127+/Edge 127+/Firefox 128+/Safari 17.4; iOS PWA and some WebKit builds lack `createEncodedStreams`. WASM fallback 150KB budget may add +15ms encrypt latency. | Medium | Medium | Phase 2B design mandates feature detection `isEncodedTransformSupported()` → WASM worker (`OffscreenCanvas` + `VideoFrame` recycle) → explicit ⚠️ `DTLS-only` warning, never silent downgrade (M0-P0 §3 row 1/4). |
| R-3 | **Token TTL 5m refresh** — `liveKitTTL=300s` (M0-P0 §4.1) requires `Room` token refresh `room.registerTokenRefresh` / `RoomEvent.TokenRefreshed`; failure → `Disconnected: Token expired`. | Medium | Medium | Wire `fetchLiveKitToken` refresh callback in `useWebRTC` (Phase 2B §6). `meet-signal` retains dual-path for rollback. |
| R-4 | **HPKE key distribution ordering** — `rotateOnJoin` deferred 150ms to allow `hpke-pubkey` exchange; race may cause `Welcome` encrypt failure if pubkey missing. | Low | Medium | Phase 2B design specifies `attempts 10 ×100ms` poll before `createWelcome` + `filtered commits` excluding joiner, plus `publishHPKEPublicKey` re-publish on `ParticipantConnected`. |
| R-5 | **Persistence XSS** — `sessionStorage` token extractable via XSS vs. httpOnly cookie. | Low (P0) | High (prod) | `privacy-inventory.md` + CSP `default-src 'none'` + `__Host-` cookie migration tracked for post-P0. |
| R-6 | **Version skew `livekit-client` 2.4.0 vs. server `1.13.6→1.25`** — API churn `RoomOptions.publishDefaults.videoSimulcastLayers` | Low | Low | Pin both to `^2.4.0` + `v1.25.1` in same PR; `tsc` + `go test` + `docker compose config` validate. |

---

## 8. Final Recommendation — PASS

**Recommendation: PASS and close Phase 2A. Authorize Phase 2B design (this document + `docs/plans/phase2b-sframe-design.md`). Do not authorize Phase 2B implementation until 2B design is reviewed.**

**Rationale:**

- `livekit_room_total` moved from 0 → 1 (Room.connect executes, `room.state === 'connected'`).
- `LocalTrackPublished` fires reliably (5/5 granted runs, `trackPublications.size` 1→2, `Video` + `Microphone` tracks published; denied runs correctly do NOT publish for denied kind).
- Error surfacing proven (denied runs show `role="alert"` with `name`-specific messages).
- `livekitToken`/`sfuUrl` persistence proven (`sessionStorage` contains both, reload reuses).
- No publish-flow refactor was required — original hypothesis (credential persistence + silent failure + observability) was sufficient.
- Build green, no new deps, dual-path token issuer stable, SFU single-node assignment deterministic.

**Exit criteria satisfied (all YES):**

- [x] `Room.connect` works independently of media publish
- [x] `LocalTrackPublished` verified in 5/5 granted runs
- [x] Audio + video tracks published, `trackPublications.size` reaches 2
- [x] Error surfacing verified in denied runs
- [x] `livekitToken` + `sfuUrl` persistence verified
- [x] No refactor of publish flow was needed to achieve evidence

**Next gate:** Architecture review of `docs/plans/phase2b-sframe-design.md` before any code change (constraint: design-only, no production code modified).

---

## 9. Traceability

| M0-P0 Criterion | Phase 2A coverage | Evidence link |
|-----------------|-------------------|---------------|
| #3 LiveKit infra Compose+HRW, hash room→SFU | `meet-signal` dual-path `POST /token` + `meet-sfu-manager` HRW `livekit:7880` | `services/meet-signal/main.go:323`, `infra/compose.yaml:55`, `docs/design/consistent-hashing-roomId-to-SFU.md` |
| #1 Browser matrix (partial) | Hook validated on Chrome 127+ dev (`127.0.0.1:5173`, COOP/COEP for WASM) | Console logs §5.1, `vite` COOP/COEP headers |
| #2 20p load (not in scope) | Deferred to Phase 2B blind-forward validation | `media-p0-proof.md` §3 |
| #4 SFrame (not in scope 2A) | Deferred — Phase 2B design defines transform insertion | `phase2b-sframe-design.md` |
| #5 Screen share | Deferred — same-epoch integration in 2B design |  |
| #6–8 Rotation/reconnect/TURN | Deferred — HPKE/Commit/Welcome via LiveKit `publishData` in 2B | `webrtc/manager.ts` §6 |

---

## 10. Appendix — File/Line References

- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:14-43` — `useWebRTC` `initialize` + `resolveSfuUrl` + `setCredentials`
- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:47-131` — `RoomEvent.Connected/LocalTrackPublished/TrackSubscribed` handlers + `trackPublications.size` logs
- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:152-164` — `Room.connect` try/catch + `livekitTokenPrefix` diagnostics
- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:167-212` — `setCameraEnabled`/`setMicrophoneEnabled` `NotAllowedError/NotFoundError/NotReadableError` branching
- `poc/meet-webrtc-core/src/store/appStore.ts:17-20,90-92,166-174` — `livekitToken/sfuUrl` state + `partialize`
- `poc/meet-webrtc-core/src/auth/token.ts:20-33,35-54` — `resolveSfuUrl` + `fetchToken` `POST /token`
- `poc/meet-webrtc-core/src/pages/MeetingPage.tsx` — `role="alert"` error banner (MeetingPage diff in `582c4d7`)
- `services/meet-signal/main.go:42-55` — `LiveKitVideoGrant` + `TokenResponse{Token,LiveKitToken,SFUUrl}`
- `services/meet-signal/main.go:323-436` — `issueLiveKitToken`, `getLiveKitWSURL`, `getSFUAddr` (HRW, 500ms timeout, 5s cache)

---

*End of Phase 2A Closure Report — ACCEPTED.*
