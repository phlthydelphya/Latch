# D-038 — GO-LIVEKIT Implementation Plan

**Author:** @architect (Principal Architect) | **Date:** 2026-09-04 | **Status:** DRAFT for PM review  
**Assumptions (per delegation, do not re-investigate):** Runtime = P2P mesh (`RTCPeerConnection` perfect negotiation via `meet-signal` WSS). LiveKit path = dormant (`livekit_room_total=0` expected). This plan replaces mesh with LiveKit runtime — no dual-mode.  
**Authority:** `docs/M0-P0.md` §§3–4,7–10 · `docs/architecture-brief.md` §§2–6,8–9 · `docs/adr/ADR-004-livekit-vs-mediasoup.md` (LiveKit GO) · `AGENTS.md` service map  
**Stack locked:** React 18 + Vite 5 + Zustand 4.5 + LiveKit Client SDK 2.4 + SFrame RFC9605 (Encoded Transform + wasm 150KB) + Go 1.22 services (`meet-signal`, `meet-sfu-manager`, `turn-auth`) + LiveKit 1.25 `LIVEKIT_E2EE_MODE=blind` + `infra/compose.yaml` single-command parity

> **Exploration snapshot (2026-09-04):** Listed `poc/meet-webrtc-core/src/**/*` (27 files), `services/*/main.go` (signal 500L in-memory hub, sfu-manager HRW `xxhash(roomId|nodeID|salt)/ (1+load*10)`, turn-auth stdlib-only), `infra/compose.yaml` (11 services, livekit `livekit/livekit-server:v1.13.6` — must bump to `v1.25.x`), `docs/architecture-brief.md` §6 HRW, §8–9 pivot, `poc/.../src/webrtc/manager.ts` 805L mesh `RTCPeerConnection` + `SignalingClient` + `KeyManager` + `SFrameTransform`, `src/signaling/client.ts` 300L WSS `offer|answer|ice|join|leave|hpke-pubkey|welcome|session-update`, `src/store/appStore.ts` Zustand persist, `src/hooks/useWebRTC.ts`, `src/keys/manager.ts` MLS-lite HPKE (`@hpke/core` `Dhkemp P-256` + `HKDF-SHA256` + `AES-128-GCM`).

---

## 1. Minimal Code Changes to Replace Mesh with LiveKit Runtime

### Concept delta

| Mesh (current, dormant LK) | LiveKit (target, P0) |
|---|---|
| `WebRTCManager` owns `RTCPeerConnection`, creates `DataChannel sframe-keys`, does perfect negotiation (`makingOffer / polite` + ICE queue 100), relays `offer/answer/ice` via `SignalingClient` WSS `/signal?v=1&room=&token=` | `LiveKitRoomManager` owns `livekit-client` `Room` + `RoomEvent` + `RemoteParticipant`. Signaling is LiveKit's own WSS (`/rtc` via Caddy, JWT `VideoGrant`). `meet-signal` becomes **token issuer + assignment oracle** only — no `offer/answer/ice` relay in hot path. |
| Simulcast set via `transceiver.sender.setParameters(encodings=[q,h,f])` + `setCodecPreferences([VP9 SVC, H264])` | LiveKit `publishOptions: { simulcast:true, videoCodec:'vp9'/{fallback h264}, videoSimulcastLayers:[q(180p@300k),h(360p@800k),f(720p@1.8M)], screencast true, dynacast false when E2EE }`. LiveKit handles `addTrack` / SFU `Subscription` internally. |
| `SFrameTransform` applied as ad-hoc `TransformStream` on `getSenders()[0]` + receiver | E2EE injected via LiveKit `E2EEKeyProvider` + `Worker` (`e2ee.worker.ts` 150KB WASM) OR direct `RTCRtpSender.createEncodedStreams` hook before `Room.connect`. Keep existing `KeyManager` as `KeyProvider` backend, not LiveKit's default ratchet. |
| `ReconnectManager` + `SignalingClient` heartbeat 5s + ICE restart | LiveKit `Room` auto-reconnect (`reconnectPolicy`) + `signal` re-establish. Keep `ReconnectManager` only as wrapper for UI toast; disable manual `iceRestart` offer. |
| `livekit_room_total == 0` (no `Room.connect` ever called, no token with `VideoGrant`) | After: `room.connect(url, token)` → Prometheus `livekit_room_total` incremented, `livekit_participants` visible, `meet-signal` no longer sees `offer/answer` frames for this room. |

### Principle: **Delete mesh negotiation, keep E2EE invariant, reuse everything else**

1. **Keep blind E2EE invariant** (`LIVEKIT_E2EE_MODE=blind`, `turn` relay opaque). No server-side key material. Wireshark proof still required: RTP payload random, SFrame header `KID/CTR` visible, no plaintext NALs. LiveKit forwards SSRC/mid only.
2. **Blind-forward fallback preserved:** When `e2eeEnabled=true`, LiveKit disables Dynacast/AdaptiveStream. Publish all 3 layers, subscribe `Last-N=9` (`room.switchActiveDevices` + `remoteParticipant.setSubscribedTracks`). Documents 80% downlink overhead (~10–12 Mbps for 20p Last-N=9) + UI shield `E2EE · 3-layer relay (bandwidth high)`.
3. **No dual-mode flag:** Remove `WebRTCManager.polite/makingOffer/pendingIceCandidates/DataChannel` code. Feature flag `VITE_USE_LIVEKIT=true` only for migration week, then delete mesh file. Per M0-P0 §4 frozen `feature:not-p0` — this is `p0-required`.
4. **Minimal surface:** ~6 files touched for runtime, 1 Go service rewritten for tokens, 2 infra files versioned. No new Go internal packages (single `main.go` rule per AGENTS.md). No shared lib.

---

## 2. Exact Files to Modify (with paths) — repo-relative

> All paths relative to `C:\Users\joshu\meet-secure-core\`. `M`=modify, `D`=delete, `N`=new, `R`=rename.

### Frontend `poc/meet-webrtc-core/` (Node >=20, Vite 5.2)

| # | Path | Action | What changes (precise) |
|---|------|--------|------------------------|
| F1 | `poc/meet-webrtc-core/src/webrtc/manager.ts` | **M → R** `livekitRoomManager.ts` | Delete 805L mesh class (EventEmitter, `pc: RTCPeerConnection`, `dataChannel`, `perfect negotiation`, `pendingIceCandidates[100]`, `negotiate()`, `handleDescription()`, `handleIceCandidate()`, `setupPeerConnectionHandlers()`). Replace with `LiveKitRoomManager extends EventEmitter` wrapping `import { Room, RoomEvent, ParticipantEvent, Track, VideoPresets, RoomOptions } from 'livekit-client'`. Exports `initialize()`, `join(roomId, constraints)`, `publishCamera/Mic`, `startScreenShare`, `setAudio/VideoEnabled` via `room.localParticipant.*`, `leave()`, `destroy()`. Keep `KeyManager`, `SFrameTransform`, `TURNManager` integration points (see §§4–6). Keep `MetricsCollector` hooks but source from `room.on(RoomEvent.MediaDevicesError)` + `getStats`. ~420L new file. Keep old file one commit as `manager.mesh.bak.ts` then delete. |
| F2 | `poc/meet-webrtc-core/src/signaling/client.ts` | **D (or stub)** | No longer in data path. LiveKit SDK uses its own WS to `wss://host/rtc`. Keep file for `Welcome` HPKE fallback only if not moved to LiveKit DataChannel, but **remove** `sendOffer/sendAnswer/sendIceCandidate/handleMessage offer/answer/ice-candidate`. If keeping welcome via signal, rename to `e2eeWelcomeClient.ts` with only `connect()/sendWelcome()/on('welcome')`. Otherwise delete. Update imports in F1 to not instantiate `SignalingClient` for SDP. |
| F3 | `poc/meet-webrtc-core/src/keys/manager.ts` | **M** | Keep HPKE suite (`CipherSuite DhkemP256HkdfSha256/HkdfSha256/Aes128Gcm`). Adapt to LiveKit DataChannel: current DataChannel `sframe-keys` (ordered, `protocol sframe.mls.1`) becomes **LiveKit `room.localParticipant.publishData(data, {reliable:true, topic:'sframe-commit'})`** + `room.on(RoomEvent.DataReceived, ...)`. `rotateEpoch()` now `await keyManager.rotateEpoch('join','leave')` then `broadcastCommitViaLiveKitData(commits)` (loop `commits: Map<participantId, Uint8Array>` → `room.localParticipant.publishData`). `createWelcome()` + `publishWelcomeViaSignal` → either keep signaling `POST /signal welcome` or use `publishData(topic:'sframe-welcome', destinationIdentities:[joiner])` if LiveKit supports per-participant data (else keep signaling stub F2). Add `getKeyProvider(): { getKey(kid,senderId) }` adapter for `SFrameTransform`. No change to `deriveSenderKey = HKDF(epoch_secret,"sframe",senderId)` or `epochSecretRaw` 32B. |
| F4 | `poc/meet-webrtc-core/src/sframe/transform.ts` | **M** | Add adapter `createLiveKitE2EEAdapter(keyManager): { setupRoom(room: Room): Promise<void> }`. When `useEncodedTransform` (Chrome 127+), inject `TransformStream` via `e2ee.worker.ts` or via LiveKit's `E2EEManager`'s worker path: `room.setE2EEEnabled(true)` is NOT used (that uses LiveKit's ratchet). Instead: before `publishTrack`, call `sender.createEncodedStreams()` then `readable.pipeThrough(sframeSenderTransformer).pipeTo(writable)` — same code as current but bound to `Room.localParticipant.getTrackPublications()` `track.sender`. For WASM fallback, keep `workers/sframe.worker.ts` 5232L, ensure `OffscreenCanvas` + `VideoFrame` recycle path still works (Safari 17.4). Ensure `RTCEncodedVideoFrame` / `SFrameHeader KID/CTR` still opaque to SFU. Add `isLiveKitE2EECompatible(): boolean` check. Budget 150KB async + integrity hash unchanged. |
| F5 | `poc/meet-webrtc-core/src/hooks/useWebRTC.ts` | **M** | Replace `createWebRTCManager` + `createP0Config` import from `../index` (which re-exports mesh interface). New: `import { LiveKitRoomManager, createP0LiveKitConfig, DEFAULT_P0_LIVEKIT_CONFIG } from '../webrtc/livekitRoomManager'`. `signalingUrl` → `livekitUrl` (`import.meta.env.VITE_LIVEKIT_URL || '/rtc'` or `wss://${location.host}/rtc` via Caddy). `turnCredentialsUrl` unchanged (still `POST /turn/credentials` → `RTCIceServer[]` passed to `RoomOptions.iceServers`). `manager.on('track')` → `room.on(RoomEvent.TrackSubscribed, (track, pub, participant)=> setRemoteStreams)`. `on('participant-joined')` → `RoomEvent.ParticipantConnected`. Keep Zustand side-effects (`addParticipant/removeParticipant/setConnected/setShieldMode`). Wire `getConnectionStats` → `room.engine.getStats()` or `room.getStats()`. |
| F6 | `poc/meet-webrtc-core/src/index.ts` | **M** | Change barrel: `export { LiveKitRoomManager as WebRTCManager, type LiveKitRoomManagerConfig as WebRTCManagerConfig }` for backwards compat OR export both and deprecate old. Replace `DEFAULT_P0_CONFIG` with `DEFAULT_P0_LIVEKIT_CONFIG` (same simulcast/layers/sframe/lastN but adds `livekit:{ dynacast:false, adaptiveStream:false, publishDefaults:{ simulcast:true, videoSimulcastLayers:[...], videoCodec:'vp9', dtx:false } }`). Keep `createWebRTCManager` factory but branch: if `VITE_USE_LIVEKIT` → new, else throw. (After migration, delete mesh export.) |
| F7 | `poc/meet-webrtc-core/src/core-types.ts` | **M** | Keep `WebRTCManagerConfig` interface but add `livekitUrl: string` alias for `signalingUrl`, add `roomConnectOptions?: RoomOptions`. Mark `signalingUrl` deprecated. Keep `LiveKitRoomManagerEventMap` if `core-types` is used for tests. (File currently stub for tests — mirror changes to real `webrtc/manager.ts`.) |
| F8 | `poc/meet-webrtc-core/src/auth/token.ts` | **M** | `fetchToken(roomId,name)` currently `POST /token {roomId,name} → {token, participantId, roomId}` (meet-signal legacy HS256). Change to `POST /token {roomId,name, metadata?}` → `{token: livekitJWT, participantId: identity, roomId, url: wssUrl}`. Keep same endpoint, but now token is LiveKit `VideoGrant`. Update error handling to surface `403 room mismatch`. Add helper `fetchLiveKitToken(roomId,name): Promise<{token, url, participantId}>`. |
| F9 | `poc/meet-webrtc-core/src/turn/manager.ts` | **M (minor)** | Currently `POST /turn/credentials {roomId, participantHash} → {username, credential, ttl, urls}` TTL 86400 HMAC. Keep, but wire to `RoomOptions.iceServers` instead of `RTCPeerConnection`. LiveKit client merges `iceServers` from token `iceServers` claim? For P0, keep explicit fetch + pass. No logic change. |
| F10 | `poc/meet-webrtc-core/src/pages/MeetingPage.tsx` | **M (tiny)** | Ensure `useWebRTC()` now uses LiveKit under hood; `localStream` + `remoteStreams` derived from `Room` events — no code change except import path fix. Add `useEffect` for `room.on(RoomEvent.Disconnected, clearRoom)`. |
| F11 | `poc/meet-webrtc-core/vite.config.ts` | **M** | Dev proxy: currently `/signal,/token,/api → meet-signal:8080`, `/sfu,/rtc,/turn → livekit/turn`. Replace `/signal` proxy with `/rtc` → `livekit:7880` (or keep both during migration). Add `/token` proxy still to `meet-signal:8080`. Add `VITE_LIVEKIT_URL=wss://localhost/rtc` env define. Ensure COOP/COEP headers (`require-corp/same-origin`) kept for WASM/SAB. |
| F12 | `poc/meet-webrtc-core/package.json` | **M** | `dependencies` already has `livekit-client ^2.4.0` (dormant) — keep, update to `^2.9.x` if needed for `Room` 1.25 API (`@livekit/rtc-node` not needed). No new dep. `devDependencies` unchanged. |
| F13 | `poc/meet-webrtc-core/src/workers/sframe.worker.ts` | **M (minor)** | Ensure worker can be instantiated by LiveKit `Worker` path: export `self.onmessage = handleSFrame` for both mesh `TransformStream` and LiveKit `E2EEManager`'s `SFrame` path. Keep 150KB budget. |
| F14 | `poc/meet-webrtc-core/src/metrics/collector.ts` | **M** | `MetricsCollector` currently polls `pc.getStats()`. Adapt to `room.engine.pcManager.publisher.getStats()` / `room.getStats()` (LiveKit exposes `Room.getStatsReport`). Keep histogram buckets `[50,100,200,300,400,500,750,1000,...]` for key-rotation/reconnect. No new metric. |

### Backend `services/` (Go 1.22, single `main.go`, no internal packages per AGENTS.md)

| # | Path | Action | Precise change |
|---|------|--------|----------------|
| B1 | `services/meet-signal/main.go` | **M (major, ~120L)** | **Token issuance redesign (see §3).** Keep `GET /healthz`, `GET /metrics` (9091), `DELETE /accounts/me` DSR. Replace `Claims{ParticipantID, RoomID, Name, jwt.RegisteredClaims}` (sub=participantId, 1h TTL HS256) with LiveKit-compatible JWT. Add `import livekit "github.com/livekit/protocol/auth"` **or** manual HS256 without new external dep (prefer manual to keep `turn-auth` zero-dep rule? but meet-signal already has `golang-jwt/jwt/v5` + `google/uuid` + `gorilla/websocket` — add `livekit/protocol` only if approved; else manual). Endpoint `POST /token` now: validate `roomId/name`, generate `identity=p-{8}`, fetch SFU assignment via `GET $SFU_MANAGER_URL/internal/sfu/assign?roomId={roomId}` (NEW call), build LiveKit JWT (`iss= LIVEKIT_API_KEY`, `sub=identity`, `exp=now+TTL(5m per M0-P0 4.1, default 3600s configurable)`, `nbf=now`, `video={roomJoin:true, room:roomId, canPublish:true, canSubscribe:true, canPublishData:true}, metadata=name`), `HMAC-SHA256` with `LIVEKIT_API_SECRET`. Return `{token: livekitJWT, participantId: identity, roomId, url: wssUrl}` where `url = LIVEKIT_URL || wss://${Host}/rtc` or `SFU assignment Addr` mapped via `livekit:7880 → wss://host/rtc` (via Caddy). Deprecate `handleSignal` relay for LiveKit rooms: keep WSS `/signal` only for `welcome` delivery if not moved to LiveKit DataChannel; otherwise remove `hub` `join/leave/relay` hot path or keep stub for backward compat behind `ENABLE_MESH_SIGNAL=false`. Keep JWT validation for signal path but also add LiveKit token validation path. Add env `LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, SFU_MANAGER_URL, JWT_TTL_SECONDS(300 for 5m)`. Keep 32-byte secret check but for `LIVEKIT_API_SECRET`. |
| B2 | `services/meet-signal/go.mod` | **M** | Add `github.com/livekit/protocol v1.25.x` **only if** using SDK helper; else no change (manual JWT keeps AGENTS.md "no shared lib" + minimal deps). If manual, add no dep. Document choice. `go.sum` regenerated. |
| B3 | `services/meet-sfu-manager/main.go` | **M (tiny)** | No HRW formula change (`h=xxhash(roomId|nodeID|salt)/weight`, `weight=1+load*10`, `SFU_NODES=livekit:7880` degenerate, `sfu:assign:{roomId}` TTL 300, health poll `http://{host}:9600/healthz` 5s). Ensure `Addr` returned is usable as `wss://` URL: `livekit:7880` → caller maps to `ws://livekit:7880/rtc` internally, externally `wss://{CADDY_HOST}/rtc` (Caddy reverse_proxy). Add `/internal/sfu/assign` already exists — keep. Optionally add `GET /internal/sfu/url?roomId=` convenience that returns `livekitUrl` + `tokenUrl`. No new Redis key. |
| B4 | `services/turn-auth/main.go` | **M (none)** | No change. `POST /turn/credentials` HMAC ephemeral `username={expiry}:{userHash}`, `credential=base64(HMAC_SHA256(TURN_SECRET, username))`, TTL 86400, `urls=[turn:host:3478, turns:443]`. Frontend still calls it and passes `iceServers` to `RoomOptions`. Keep `network_mode: host` coturn unchanged. |
| B5 | `infra/compose.yaml` | **M** | `livekit` service: bump `image: livekit/livekit-server:v1.13.6 → v1.25.1` (or latest `v1.25.x` per arch-brief). Keep `cpus: '2.0' mem_limit: 4g`, `ports 7880/7881/9600`. Env `LIVEKIT_KEYS="${LIVEKIT_API_KEY:-dev}:${LIVEKIT_API_SECRET:-...}"` (already Tmpl: `LIVEKIT_KEYS: "${LIVEKIT_API_KEY:-dev}: ${LIVEKIT_API_SECRET:-p0-dev-pass-32chars-0123456789abcdef012345}"` — keep). Ensure `LIVEKIT_E2EE_ENABLED=true` + `LIVEKIT_E2EE_MODE=blind` remain. `LIVEKIT_REDIS_URL` unchanged. `meet-signal` env: add `LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL=wss://livekit:7880` (internal) + `EXTERNAL_LIVEKIT_URL=wss://localhost/rtc` for returned URL, plus `SFU_MANAGER_URL=http://meet-sfu-manager:8081`. Keep `PORT 8080`, `REDIS_URL`, `JWT_*` (or rename to `LIVEKIT_*`). `meet-sfu-manager` unchanged (`SFU_NODES=livekit:7880`). Ensure `SFU_HASH_SALT=p0-salt-2026` unchanged. |
| B6 | `infra/livekit.yaml` | **M** | Ensure `port:7880`, `rtc.port_range_start/end 40000-40200`, `tcp_port 7881`, `redis.address redis:6379`, `keys: dev: ...` placeholder (overridden by env), `room.auto_create:true, enabled_codecs:[VP9,H264,opus], max_participants:20, empty_timeout:300, departure_timeout:20`, `turn.enabled:false` (external coturn), `logging json info no PII`, plus new: `e2ee: { enabled: true }` or keep advisory comment that E2EE is client-enforced blind. (LiveKit 1.25 yaml key is `e2ee.enabled` — verify.) |
| B7 | `infra/Caddyfile` | **M** | Keep `:80` + `:443 tls internal` blocks. Add `handle /rtc* { reverse_proxy livekit:7880 }` (already partly there as `/sfu/*` + `/rtc*`). Ensure `handle /token*` → `meet-signal:8080` (currently `handle { reverse_proxy meet-signal }` catches it; make explicit). Ensure `header_up` for websockets (`Connection: Upgrade`). Coturn stays `network_mode: host` not via Caddy. |
| B8 | `infra/prometheus.yml` | **M (optional)** | Add `scrape_configs: job livekit: targets livekit:9600` (already). Ensure `meet-signal:9091/metrics`, `meet-sfu-manager:8081/metrics?`(stub) scraped. No change to Grafana. |

### Docs

| # | Path | Action | Note |
|---|------|--------|------|
| D1 | `docs/architecture-brief.md` §§2,4.1,5,6,8–9 | **M** | Mirror this plan's §3–6 into brief: token is LiveKit `VideoGrant`, `roomId→SFU` now via `LIVEKIT_URL` + HRW assignment returned alongside token, SFrame still HKDF per-sender, blind-forward Last-N=9. |
| D2 | `docs/c4/p0-context.md` | **M** | Update L2 container diagram: `PWA → Caddy :443 /rtc → LiveKit` + `PWA → Caddy /token → meet-signal` (no `/signal offer/answer` arrow). |
| D3 | `docs/adr/ADR-0xx-livekit-token.md` | **N** | Record token choice (manual JWT vs `livekit/protocol` helper) + why `VideoGrant` + TTL 5m `aud=roomId` alignment. |

**Not modified:** `services/meet-signal/go.sum` (unless livekit/protocol added), `poc/meet-webrtc-core/src/pages/LandingPage.tsx`, `PreJoinPage.tsx` (only pass `roomId/name` to `fetchToken`), `src/store/appStore.ts` (maybe add `livekitUrl` field), `qa/*` until verification.

---

## 3. Token Issuance Design

### Current (`meet-signal` mesh)

```
POST /token  Body {roomId: string, name: string}
→ 200 {token: HS256 JWT { sub: "p-xxxx", room: roomId, name, iss:"meet-signal", exp:now+3600s }, participantId, roomId}
Used as: WSS /signal?v=1&room=:id&token=:jwt  (server validateJWT, check aud==room, relay offer/answer/ice via hub map[string]map[*client]struct{})
Secret: JWT_SECRET ≥32B, JWT_ISSUER, JWT_TTL_SECONDS=3600
```

No LiveKit `VideoGrant`, no `LIVEKIT_KEYS`, not accepted by LiveKit SFU (`livekit_room_total` stays 0). Hub in-memory, no Redis pub/sub despite `REDIS_URL` env present.

### Target (LiveKit P0)

```
POST /token  Body {roomId, name, metadata?: string}
→ 200 { token: LiveKitJWT, participantId: identity, roomId, url: wssUrl, sfuNodeId?, iceServers? optional }

LiveKitJWT (HS256, header {alg:HS256, typ:JWT}):
  iss  = LIVEKIT_API_KEY          (from env LIVEKIT_API_KEY, compose default "dev")
  sub  = identity                 (p-xxxx, same as participantId, stable per request)
  nbf  = now
  exp  = now + JWT_TTL_SECONDS    (default 300s=5m per M0-P0 4.1 "JWT 5m aud=roomId"; configurable 3600s for dev)
  aud  = roomId  (optional, for meet-signal validation symmetry)
  jti  = uuid
  name = req.name  (displayName)
  metadata = JSON.stringify({ participantHashShort: identity.slice(0,8) })
  video = {
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,        // for sframe commits
    canPublishSources: ["camera","microphone","screen_share","screen_share_audio"],
  }
  // Optional for TURN merge: iceServers not in token — keep separate POST /turn/credentials
Signature = HMAC-SHA256( LIVEKIT_API_SECRET, base64url(header)+"."+base64url(payload) )
```

**Go implementation — two options (pick one, document in ADR):**

**Option A (preferred for P0, no new dep — manual JWT with existing `golang-jwt/jwt/v5`):**

```go
// services/meet-signal/main.go — handleToken (replace)
// env: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, SFU_MANAGER_URL
func handleToken(w http.ResponseWriter, r *http.Request) {
  var req struct{ RoomID string `json:"roomId"`; Name string `json:"name"` }
  // validate len <=64, body <=4096
  identity := "p-" + uuid.New().String()[:8]
  now := time.Now()
  ttl := time.Duration(getEnvInt("JWT_TTL_SECONDS", 300)) * time.Second // 5m per M0-P0
  // 1) Assign SFU (HRW) for URL
  sfuAddr := getSFUAddr(req.RoomID) // GET http://meet-sfu-manager:8081/internal/sfu/assign?roomId= => {addr:"livekit:7880", nodeId:"sfu-0"}
  livekitURL := getEnv("LIVEKIT_URL", "wss://"+r.Host+"/rtc") // external URL via Caddy
  // internal vs external mapping: sfuAddr "livekit:7880" → livekitURL stays wss://host/rtc

  claims := jwt.MapClaims{
    "iss": getEnv("LIVEKIT_API_KEY","dev"),
    "sub": identity,
    "name": req.Name,
    "nbf":  now.Unix(),
    "exp":  now.Add(ttl).Unix(),
    "iat":  now.Unix(),
    "jti":  uuid.NewString(),
    "aud":  req.RoomID,
    "video": map[string]any{
      "roomJoin": true, "room": req.RoomID,
      "canPublish": true, "canSubscribe": true, "canPublishData": true,
    },
    "metadata": req.Name,
  }
  t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
  signed, _ := t.SignedString([]byte(os.Getenv("LIVEKIT_API_SECRET")))
  json.NewEncoder(w).Encode(map[string]any{
    "token": signed, "participantId": identity, "roomId": req.RoomID,
    "url": livekitURL, "sfuNodeId": sfuAddr,
  })
}
func getSFUAddr(roomID string) string {
  // GET SFU_MANAGER_URL/internal/sfu/assign?roomId= (timeout 500ms, cache 5s)
  // fallback SFU_NODES=livekit:7880 degenerate
}
```

**Option B (with SDK helper, add dep):**

```go
import "github.com/livekit/protocol/auth"
at := auth.NewAccessToken(getEnv("LIVEKIT_API_KEY","dev"), getEnv("LIVEKIT_API_SECRET","..."))
at.SetIdentity(identity); at.SetName(req.Name); at.SetValidFor(ttl)
grant := &auth.VideoGrant{RoomJoin:true, Room: req.RoomID, CanPublish:boolPtr(true), CanSubscribe:boolPtr(true), CanPublishData:boolPtr(true)}
at.AddGrants(grant); jwt, _ := at.ToJWT()
```

**Choice guidance:** Prefer **A** to respect AGENTS.md `single main.go, no shared lib` and keep `turn-auth` zero-dep precedent; `golang-jwt` already vetted. Document that LiveKit server validates `iss` against `keys: dev:` entry in `infra/livekit.yaml` **and** `LIVEKIT_KEYS` env (`dev: p0-dev-pass-32chars-...`). Keep both `JWT_SECRET` (legacy) and `LIVEKIT_API_SECRET` during migration week behind `if LIVEKIT_API_SECRET != ""`.

**HRW integration:** `meet-signal` on each `POST /token` calls `meet-sfu-manager` `GET /internal/sfu/assign?roomId=` (cached 300s in manager, 5s client cache optional). Single-node degenerate returns `livekit:7880` → `url = wss://{CaddyHost}/rtc` (Caddy `reverse_proxy livekit:7880`). Future multi-node returns `wss://sfu-{n}.host/rtc` via same HRW formula `h=xxhash(roomId|nodeID|salt)/weight`. No assignment stored in PG, derived + Redis `sfu:assign:{roomId}` TTL 5m.

**Security invariants:**
- TTL 5m (M0-P0 §4.1 JWT 5m aud=roomId), refresh via re-`POST /token` before `exp` or LiveKit `Room` token refresh callback (`room.on(RoomEvent.TokenRefreshed)`).
- No wildcard room grant (`room` exact), `canUpdateOwnMetadata:true` optional, no admin.
- `POST /token` rate-limited same as before (in-memory); no anon `k#` capability links (frozen).
- Logs: sanitize `token` (first 8 chars), log `roomId` hash only if needed, no SDP.

**Infra env table:**

| var | compose default | K8s secret |
|-----|-----------------|-----------|
| `LIVEKIT_API_KEY` | `dev` | `livekit-api-key` |
| `LIVEKIT_API_SECRET` | `p0-dev-pass-32chars-0123456789abcdef012345` (≥32B) | `livekit-api-secret` |
| `LIVEKIT_URL` | `wss://localhost/rtc` (internal `ws://livekit:7880`) | `wss://rtc.meet-secure.local/rtc` |
| `JWT_TTL_SECONDS` | `300` (5m) | `300` |
| `SFU_MANAGER_URL` | `http://meet-sfu-manager:8081` | same |
| `SFU_HASH_SALT` | `p0-salt-2026` | same |

**Caddy mapping:**

```
:443 {
  handle /token*  { reverse_proxy meet-signal:8080 }
  handle /rtc*    { reverse_proxy livekit:7880 }    # LiveKit WS + RTC
  handle /turn/*  { reverse_proxy turn-auth:8080 }
}
```

---

## 4. Room.connect Integration Design

### LiveKit Client SDK (already in `package.json: livekit-client ^2.4.0`)

```ts
// poc/meet-webrtc-core/src/webrtc/livekitRoomManager.ts — skeleton

import { Room, RoomEvent, ParticipantEvent, Track, RoomOptions, VideoPresets, createLocalVideoTrack, createLocalAudioTrack } from 'livekit-client';
import type { RoomConnectOptions } from 'livekit-client';
import { KeyManager } from '../keys/manager';
import { SFrameTransform } from '../sframe/transform';
import { TURNManager } from '../turn/manager';

export interface LiveKitRoomManagerConfig {
  roomId: string; participantId: string; // identity assigned by token
  livekitUrl: string; // wss://host/rtc from POST /token
  jwt: string;        // LiveKit VideoGrant
  turnCredentialsUrl: string;
  preferredCodecs: { video: ('VP9'|'H264'|'AV1')[]; audio: ('opus')[] };
  simulcast: { enabled:true; layers: SimulcastLayer[]; svc:boolean };
  sframe: { enabled:true; useEncodedTransform:boolean; wasmFallback:boolean; wasmPath:string; cipherSuite:'AES_GCM'|'AES_CTR' };
  lastN: number; dynacast: DynacastConfig;
}

export class LiveKitRoomManager extends EventTarget {
  public room: Room;
  private keyManager: KeyManager;
  private sframe: SFrameTransform;
  private turnManager: TURNManager;
  private config: LiveKitRoomManagerConfig;
  private currentKID=0; private epochSecret: CryptoKey|null=null;

  constructor(config: LiveKitRoomManagerConfig) {
    super();
    this.config = config;
    this.keyManager = new KeyManager({ cipherSuite: config.sframe.cipherSuite, keyRotationIntervalMs: 300000 });
    this.sframe = new SFrameTransform({ keyManager: this.keyManager, cipherSuite: config.sframe.cipherSuite, getCurrentKID: ()=>this.currentKID });
    this.turnManager = new TURNManager({ credentialsUrl: config.turnCredentialsUrl, roomId: config.roomId, participantHash: config.participantId });
  }

  async initialize(): Promise<void> {
    const turnServers = await this.turnManager.getCredentials(); // POST /turn/credentials TTL 86400
    const iceServers = [...(this.config as any).iceServers ?? [], ...turnServers];

    const roomOpts: RoomOptions = {
      adaptiveStream: false,        // disabled when E2EE blind-forward (arch-brief §8)
      dynacast: false,              // disabled with E2EE, else SFU would drop layers based on payload
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: this.config.simulcast.layers.map(l=>({
          rid: l.rid, scaleResolutionDownBy: l.scaleResolutionDownBy, maxBitrate: l.maxBitrate
        })),
        videoCodec: this.config.preferredCodecs.video[0].toLowerCase() as any, // 'vp9' preferred, 'h264' fallback
        dtx: false, red: false,
        screenShareEncoding: VideoPresets.h720, // for getDisplayMedia
      },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      audioCaptureDefaults: { echoCancellation:true, noiseSuppression:true },
      e2ee: undefined, // we manage SFrame ourselves (blind), not LiveKit's built-in
      rtcConfig: { iceServers, iceTransportPolicy:'all', bundlePolicy:'max-bundle', rtcpMuxPolicy:'require' } as RTCConfiguration,
      // token refresh callback for 5m expiry
      // @ts-ignore — depends on livekit-client 2.x
      // tokenRefresh: async () => (await fetchToken(this.config.roomId, 'refresh')).token
    };

    this.room = new Room(roomOpts);
    this.bindRoomEvents();
    await this.keyManager.initialize(this.config.participantId);
    this.epochSecret = this.keyManager.getCurrentEpochSecret();
    // Install SFrame transform before connect so publisher tracks are encrypted from first frame
    await this.installSFrameOnRoom(this.room);
    this.keyManager.stopRotationTimer(); // manager drives rotation
  }

  async join(roomId: string, constraints: MediaStreamConstraints = {video:true,audio:true}): Promise<void> {
    // Room.connect does signal + DTLS + ICE via LiveKit server
    await this.room.connect(this.config.livekitUrl, this.config.jwt, { autoSubscribe:true } as RoomConnectOptions);
    // Publish camera/mic after connect (LiveKit recommends)
    const camTrack = await createLocalVideoTrack({ ...constraints.video as any, resolution: VideoPresets.h720.resolution });
    const micTrack = await createLocalAudioTrack(constraints.audio as any);
    await this.applySFrameToLocalTracks([camTrack, micTrack]);
    await this.room.localParticipant.publishTrack(camTrack, { simulcast:true, videoCodec: this.config.preferredCodecs.video[0].toLowerCase() as any });
    await this.room.localParticipant.publishTrack(micTrack);
    // Optionally publish data channel HPKE pubkey for newcomers
    await this.publishHPKEPublicKey();
    this.startPeriodicRotation();
    this.emit('joined', {roomId});
  }

  private bindRoomEvents() {
    this.room.on(RoomEvent.Connected, ()=> this.emit('connected', undefined));
    this.room.on(RoomEvent.Disconnected, (reason)=> this.emit('disconnected', reason));
    this.room.on(RoomEvent.Reconnecting, ()=> this.emit('reconnecting', undefined));
    this.room.on(RoomEvent.Reconnected, ()=> this.emit('reconnected', undefined));
    this.room.on(RoomEvent.ParticipantConnected, (p)=> this.handleParticipantConnected(p));
    this.room.on(RoomEvent.ParticipantDisconnected, (p)=> this.handleParticipantDisconnected(p));
    this.room.on(RoomEvent.TrackSubscribed, (track, pub, participant)=> {
      this.applySFrameToRemoteTrack(track, participant);
      this.emit('track', {track, streams:[track.mediaStream!], receiver: (track as any).receiver});
    });
    this.room.on(RoomEvent.DataReceived, (payload, participant, kind, topic)=> this.handleDataChannelMessage(payload, participant, topic));
    this.room.on(RoomEvent.MediaDevicesError, (e)=> this.emit('error', e));
  }
  // ... helpers publishHPKEPublicKey, rotateOnJoin, handleDataChannelMessage (commit/welcome), installSFrameOnRoom
}
```

**Key options:**

- `adaptiveStream:false, dynacast:false` when `sframe.enabled` (arch-brief §8 contradiction). When E2EE off (lab), could enable both — but P0 always E2EE.
- `autoSubscribe:true` + `Last-N=9` enforcement: `room.on(ParticipantConnected, enforceLastN)` where `enforceLastN()` keeps 9 most recent speakers subscribed, unsubscribes rest via `participant.trackPublications.forEach(pub=> pub.setSubscribed(false))`. UI `VideoGrid` Last-N=9 respected.
- `iceServers` from `TURNManager` (coturn ephemeral HMAC 86400) — LiveKit merges with `LIVEKIT` server reflexive; still need `candidateType=relay` verification.
- Token refresh: LiveKit 2.x supports `room.registerTokenRefresh(() => fetchToken(...).token)` — needed for 5m TTL; wire to `fetchLiveKitToken`.
- `livekitUrl`: return from `POST /token` as `wss://${location.host}/rtc` in prod, `ws://livekit:7880` in compose via Caddy passthrough. SFU assignment (`meet-sfu-manager HRW`) selects which `livekit` host to return when multi-node; P0 single-node `livekit:7880` → `wss://localhost/rtc`.

**Hook wiring (F5):**

```ts
// poc/meet-webrtc-core/src/hooks/useWebRTC.ts — diff
- const signalingUrl = import.meta.env.VITE_SIGNALING_URL || '/signal';
+ const livekitUrl = (await fetchToken(roomId, name)).url || import.meta.env.VITE_LIVEKIT_URL || '/rtc';
  const config = createP0LiveKitConfig({ roomId, participantId: res.participantId, livekitUrl, jwt: res.token, turnCredentialsUrl, ...DEFAULT_P0_LIVEKIT_CONFIG });
  const manager = await createLiveKitRoomManager(config); // was createWebRTCManager
```

**Store (F7 optional):**

```ts
// poc/meet-webrtc-core/src/store/appStore.ts — add
livekitUrl: string|null  // returned by POST /token
setLivekitUrl: (url:string)=>set({livekitUrl:url})
```

---

## 5. Track Publication / Subscription Design

### Publication (sender)

```
createLocalVideoTrack({resolution: h720}) / createLocalAudioTrack()
  → apply SFrame Encoded Transform BEFORE publish (see §6)
  → room.localParticipant.publishTrack(track, {
       simulcast: true,
       videoCodec: 'vp9' | 'h264',   // try VP9 SVC profile-id=0/2 first, H264 fallback if `Room.isE2EEEnabled`? No, client codec list
       simulcastLayers: [
         {rid:'q', scaleResolutionDownBy:4, maxBitrate:300000, maxFramerate:15},
         {rid:'h', scaleResolutionDownBy:2, maxBitrate:800000, maxFramerate:30},
         {rid:'f', scaleResolutionDownBy:1, maxBitrate:1800000, maxFramerate:30},
       ],
       source: Track.Source.Camera / Microphone,
       name: 'camera' | 'microphone',
     })
  → screen share: getDisplayMedia → createLocalVideoTrack → publishTrack({source: Track.Source.ScreenShare, simulcast:true, videoCodec:'vp9'})  // same epoch, dynamic switch camera→screen→camera

LiveKit SFU forwards opaque SFrame frames by SSRC/mid (blind). No transcoding/mixing. 3 layers forwarded to each subscriber (blind-forward) up to Last-N=9.
```

Codec selection matches `DEFAULT_P0_CONFIG.preferredCodecs.video=['VP9','H264']` in `src/index.ts` and `infra/livekit.yaml room.enabled_codecs: [VP9,H264,opus]`. Client offers `VP9 SVC profile-id=2` first; fallback `VP9 profile-id=0` then `H264 baseline 42e01f`.

**Metrics:** publication insertion attaches `SFrameTransform` pipeline; overhead +6ms (Encoded Transform) / +15ms (WASM) per arch-brief §8.

### Subscription (receiver)

```
RoomEvent.TrackSubscribed -> (track: RemoteVideoTrack|RemoteAudioTrack, pub: RemoteTrackPublication, participant: RemoteParticipant)
  → apply SFrame receiver transform (same HKDF sender_key)
  → track.attach() -> <video> element (VideoTile)
  → track.on(TrackEvent.Muted/Unmuted, update Zustand participant.audioEnabled/videoEnabled)
  → Last-N enforcement:

function enforceLastN(room: Room, N=9) {
  const sorted = [...room.remoteParticipants.values()].sort((a,b)=> (b.joinedAt?.getTime()??0)-(a.joinedAt?.getTime()??0) || (b.isSpeaking?1:0));
  sorted.forEach((p, idx) => {
    const shouldSubscribe = idx < N;
    p.trackPublications.forEach(pub => {
      if (pub.isSubscribed !== shouldSubscribe) pub.setSubscribed(shouldSubscribe);
    });
  });
}
Call on RoomEvent.ParticipantConnected/Disconnected + RoomEvent.ActiveSpeakersChanged.
```

`VideoGrid` keeps Last-N=9 grid rendering; hidden tiles stay subscribed=false (saves ~2.7 Mbps per hidden participant, but blind-forward still sends all 3 layers for subscribed 9 → ~24 Mbps down worst, mitigated by SVC temporal drop → ~8–12 Mbps per arch-brief §8).

**Mute / speaking:**

```
room.localParticipant.setCameraEnabled(bool) / setMicrophoneEnabled(bool)  // toggles publish
room.localParticipant.setTrackMuted(Track.Source.Camera, muted)           // signals via LiveKit data, not custom `mute` frame
room.localParticipant.setSpeaking(bool) → LiveKit ActiveSpeakers
```

No custom `signaling.sendMute/sendSpeaking` — LiveKit handles via `ParticipantEvent`.

**Screen share switch:**

```ts
async startScreenShare() {
  const screen = await navigator.mediaDevices.getDisplayMedia({video:{width:1280,height:720,frameRate:30}, audio:false});
  const screenTrack = screen.getVideoTracks()[0];
  await this.applySFrameToLocalTracks([screenTrack]);
  await this.room.localParticipant.publishTrack(screenTrack, {source: Track.Source.ScreenShare, simulcast:true});
  this.emit('screen-share-started', {stream: screen});
}
async stopScreenShare() { await this.room.localParticipant.unpublishTrack(screenTrack); }
```

Same epoch key as camera — no extra key rotation (M0-P0 §4.2 screen share same epoch).

---

## 6. HPKE / SFrame Integration Impact

### Current (mesh) E2EE

- `KeyManager` 16.6kL: `generateKey ECDH P-256` (extractable), `generateEpochSecret 32B`, `deriveSenderKey = HKDF(epoch_secret, "sframe", sender_id)` → `AES-GCM 128` non-extractable `sender_key`, `CipherSuite HPKE DhkemP256HkdfSha256/HkdfSha256/Aes128Gcm`, `enc = 65B uncompressed ephem pub`, `seal/open`, `exportHPKEPublicKey() b64`, `importHPKEPublicKey(b64)`, `createCommit(epochRaw, oldEpoch) → Map<participantId, Uint8Array>` via per-recipient `HPKE.seal`, `createWelcome(epochSecret, targetPub) → Uint8Array`.
- Distribution: `Commit` (new epoch) broadcast via **DataChannel `sframe-keys`** (`ordered, protocol sframe.mls.1`) to existing members `publishData({reliable:true, topic:'sframe-commit'})`, `Welcome` via **signaling** `welcome` message (`SignalingClient.sendWelcome(welcome, epoch)`). On `join`, deferred `rotateOnJoin(joinerId)` after 150ms HPKE pubkey exchange.
- `SFrameTransform` 16kL: `createSenderTransformer() TransformStream<EncodedFrame>` encrypts `payload AES-GCM` + builds `header {KID: uint4, CTR: varint}` + `combine(header, ciphertext)`, `createReceiverTransformer` decrypts via `getSenderKey(senderId,KID)`, counters `encryptCounter: Map<KID→bigint>`, `decryptCounters: Map<senderId:KID→bigint>`, WASM fallback via `workers/sframe.worker.ts` 150KB `OffscreenCanvas+VideoFrame`.
- Rotation p95 ≤500ms measured `performance.now()` trigger→ack, zeroize on `leftAt` (`crypto.subtle zero + IndexedDB delete`).

### Impact of LiveKit

| Axis | Mesh | LiveKit | Change required | Effort |
|------|------|---------|-----------------|--------|
| **DataChannel** | `pc.createDataChannel('sframe-keys')` own | `room.localParticipant.publishData(data, {reliable:true, topic:'sframe-commit', destinationIdentities?:[id]})` + `RoomEvent.DataReceived` | Replace `dataChannel.onmessage/handleDataChannelMessage` with `room.on(DataReceived, ...)`. `publishData` already reliable/ordered. Keep same binary framing (commit ct+enc, welcome). No new crypto. | S |
| **Welcome path** | via `SignalingClient.sendWelcome` (WSS) | Could stay via `SignalingClient` stub OR move to `publishData(topic:'sframe-welcome', destinationIdentities:[joiner])` (LiveKit 2.4 supports per-participant data). Recommend **move to LiveKit data** to drop WSS dep entirely; keep signaling fallback one commit for backward compat. | Add `if (room.localParticipant.publishData.length>=3) useLiveKitData else signal`. | S |
| **HPKE keys** | `KeyManager` own P-256 pair, publish `hpke-pubkey` via signal `publishHPKEPublicKey(b64)` on `initialize()` + re-publish on `handleParticipantJoin` after 150ms | Same, but `publishHPKEPublicKey` now via LiveKit data `topic:'hpke-pubkey'`. On `RoomEvent.ParticipantConnected`, re-publish after 100ms. `participantKeys: Map<id→CryptoKey>` unchanged. | Rename `signaling.publishHPKEPublicKey` → `room.localParticipant.publishData(..., topic:'hpke-pubkey')`. | S |
| **SFrame transform injection** | Manual `sender.createEncodedStreams().readable.pipeThrough(transform).pipeTo(writable)` on `pc.getSenders()[0]` | Same primitive exists on LiveKit `LocalTrack.sender` (`RTCRtpSender`). LiveKit does NOT intercept if `e2ee` disabled — you still own transform. Hook `room.localParticipant.on(TrackEvent.LocalTrackPublished, (pub) => applySFrameToSender(pub.track.sender))` before first frame. Receiver similarly on `TrackSubscribed`. LiveKit's own `E2EEManager` must stay disabled (`e2ee: undefined` in RoomOptions); else double-encrypt. | Create `installSFrameOnRoom(room)` helper that patches `RTCRtpSender.prototype.createEncodedStreams` if needed (no SDK change). Verify `RTCEncodedVideoFrame` in Chrome 127+ and `RTCRtpScriptTransform` not required for this path. | M |
| **WASM fallback** | `wasm-sframe` worker 150KB, `OffscreenCanvas`, `VideoFrame` recycle, Safari 17 polyfill, `setEncryptionKey(KID→sender_key)` via `performance.now()` | Identical — LiveKit path does not affect worker. Keep `wasmPath:/wasm/sframe.js`, `wasmFallback:true`, `cipherSuite AES_GCM`. Add integrity hash check unchanged. | No change to `workers/sframe.worker.ts` — just ensure worker loaded before `room.connect` if `!isEncodedTransformSupported()`. | S |
| **KID/CTR header** | `SFrameHeader {kid: number, ctr: bigint}` in `transform.ts` | Unchanged — LiveKit forwards whatever SFrame header you emit (blind). SFU never decrypts. | Verify Wireshark `rtp && sframe` still shows ciphertext on `meet-secure-p0_default` bridge (172.18.0.9 livekit). | — |
| **Rotation latency** | `Commit` via DataChannel broadcast → `setEncryptionKey` ack → `key-rotated` event | `publishData` reliable delivery is same underlying `DataChannel` (LiveKit creates `lossy` + `reliable` channels internally). Latency should be comparable (LiveKit adds ~2–5ms hop). Keep `metrics.recordKeyRotationLatency` histogram. Threshold p95 ≤500ms unchanged (arch-brief §4.3). | Keep `startPeriodicRotation(300s)` + `rotateOnJoin/Leave`. Add test `qa/reports/key-rotation-latency.json` under LiveKit. | S |
| **Reconnect epoch** | `ReconnectManager` preserves epoch, buffered commits replayed via Redis `signal:{roomId}:buffer` TTL 30s | LiveKit `Room` reconnects WS automatically, epoch preserved in `KeyManager` (`previousEpochs` map). Buffered commits replayed via LiveKit `DataReceived` (no Redis buffer needed for commits). Keep `ReconnectManager` as UI wrapper only; disable its `iceRestart` offer (LiveKit does ICE restart internally via `signal`). | Remove `reconnectManager.start()` on `pc.connectionState=disconnected`; replace with `room.on(Reconnecting/Reconnected)`. Keep `preserveEpoch:true`. | S |
| **Privacy log** | No SDP/PII in logs, `__Host-` cookies | Same — LiveKit logs also sanitized (`logging.json:true` without PII). Add `room` event log scrub. | No change. | — |

**Summary impact: LOW.** Crypto unchanged, topology unchanged, only transport for `Commit/Welcome/HPKE pubkey` moves from own `RTCDataChannel`/`SignalingClient` to LiveKit's `publishData`. Risk is minimal — keep signing/Wireshark proof identical. Do NOT enable LiveKit's built-in `E2EE` (which would use `E2EEKeyProvider` ratchet) — keep `KeyManager` as source of truth per ADR-002 accepted-with-pivot.

---

## 7. Migration Sequence (single-node P0, no feature freeze violation)

> Branch: `feat/D-038-go-livekit` off `main` @ `2026-09-04`. One command parity: `docker compose -f infra/compose.yaml up --build --wait` must stay green each step.

### Step 0 — Prep (0.5 day)
1. Bump `infra/compose.yaml` `livekit: v1.13.6→v1.25.1` (or `v1.25` latest), verify `curl -f http://localhost:9600/healthz` (F-3). No code change. Tag `step0-bump`.
2. Add ADR `docs/adr/ADR-0xx-livekit-token.md` (choice A manual JWT) and update `docs/architecture-brief.md` §3 `meet-signal` row to reflect token issuer + `SFU_MANAGER_URL`. Keep review `NOT SELF-APPROVED`.

### Step 1 — Token issuer (1 day, backend)
3. Implement B1 in `services/meet-signal/main.go`: add `LIVEKIT_*` env handling, `getSFUAddr()` HRW call, dual-path `handleToken` (if `LIVEKIT_API_SECRET` set → LiveKit JWT else legacy for rollback). Add unit test `main_test.go` for JWT `iss/exp/video.roomJoin` claims (like `meet-sfu-manager/main_test.go` vector). Build `docker build -t meet-secure/meet-signal:local services/meet-signal` + `go test -v ./...`.
4. Wire `infra/compose.yaml` `meet-signal` env `LIVEKIT_API_KEY/SECRET/URL` + `infra/Caddyfile` `/rtc` + `/token` explicit handles. `docker compose up --build --wait` + `curl -f http://localhost:8080/healthz && curl -X POST http://localhost:8080/token -H 'Content-Type: application/json' -d '{"roomId":"test123","name":"alice"}' | jq .` — verify `{token, url, participantId}` and `https://jwt.io` shows `video.roomJoin`.
5. Verify Prometheus: `livekit_room_total` still 0 (no client yet) — expected before frontend.

### Step 2 — LiveKitRoomManager (2 days, frontend)
6. Create `poc/meet-webrtc-core/src/webrtc/livekitRoomManager.ts` (F1) from template §4. Port simulcast/lastN/dynacast defaults from `src/index.ts DEFAULT_P0_CONFIG`. Copy `KeyManager`, `SFrameTransform` glue `installSFrameOnRoom`. Keep `useWebRTC` stubbed to mesh behind `VITE_USE_LIVEKIT=false` (default) so `main` stays green.
7. Modify `src/index.ts` (F6) to export both: `export { LiveKitRoomManager } from './webrtc/livekitRoomManager'` + keep mesh export but mark `@deprecated`. Update `createP0LiveKitConfig()` and `DEFAULT_P0_LIVEKIT_CONFIG`.
8. Modify `src/auth/token.ts` (F8) + `src/turn/manager.ts` (F9) + `src/keys/manager.ts` (F3) + `src/sframe/transform.ts` (F4). Keep changes small, behind `if (config.livekitUrl)` branch if needed.

### Step 3 — Hook & wiring (1 day)
9. Modify `src/hooks/useWebRTC.ts` (F5) to accept `livekitUrl/jwt` and use `LiveKitRoomManager` when `VITE_USE_LIVEKIT=true`. Add `vite.config.ts` (F11) `/rtc` proxy + `VITE_LIVEKIT_URL`. `npm --prefix poc/meet-webrtc-core run build && npm run test` (vitest) must pass (stubbed types in `core-types.ts` updated).

### Step 4 — Cutover (0.5 day, flag flip)
10. Enable `VITE_USE_LIVEKIT=true` in `.env` and `infra/compose.yaml` `meet-signal` (or Vite env). Delete mesh import from `useWebRTC` (keep file `.mesh.bak` for one commit, then delete F2). `npm run dev` + `docker compose up --build --wait` → manual 2-browser join `http://127.0.0.1:5173/r/test#k=...` → verify `VideoGrid` shows local+remote, `ShieldBadge` E2EE on, console `Room connected` + `livekit_room_total` → 1.
11. Deprecate `SignalingClient` relay path: keep `Welcome` via signal only if LiveKit data not yet per-participant; otherwise delete `src/signaling/client.ts` (F2) and remove `WSS /signal` handle from `infra/Caddyfile` (keep `/healthz`).

### Step 5 — Verification (1 day, QA)
12. Run verification checklist §10 (browser matrix 4×, 20p synthetic `npm run load` or `livekit load tester`, Wireshark bridge capture `docker run --network meet-secure-p0_default -v qa/reports:/pcaps nicolaka/netshoot tcpdump -i any -w /pcaps/wireshark-livekit-sframe.pcapng "udp port 7880 or port 3478"`, TURN forced relay `iceTransportPolicy:relay`, Lighthouse `npm run lighthouse`). Produce histograms `qa/reports/key-rotation-latency.json` + `qa/reports/reconnect-latency.json`.

### Step 6 — Docs & gate (0.5 day)
13. Update `docs/architecture-brief.md` §11 ADRs, `docs/c4/p0-context.md` diagram, `docs/gates/architecture-exit-checklist.md` (22 items). Request 5 gates: `@architect` (this plan), `@security` (STRIDE SFrame blind), `@privacy` (no telemetry), `@qa` (`p0-gate-verify`), `@reviewer` (honest E2EE sign). Merge with `p0-gate-verify` + 5 approvals.

**Total calendar:** 6–7 dev days wall-clock (1 engineer full-time + @backend 1 day assist for B1/B5). Elapsed `W1–W2` if started 2026-09-05, before W2 mid-sprint GO/NO-GO.

**Rollback:** Keep `feat/D-038-go-livekit` branch + `VITE_USE_LIVEKIT=false` restores mesh in <1h (legacy `JWT_SECRET` path in `meet-signal`). No DB migration to undo (Redis TTL 24h ephemeral).

---

## 8. Effort Estimate (person-days, M=minimal)

| Area | Tasks | Estimate | Owner |
|------|-------|----------|-------|
| **Backend token + compose** | B1 `meet-signal` LiveKit JWT (manual, HRW URL), B2 `go.mod` if needed, B5 compose `v1.25.1` + env, B6 `livekit.yaml` `e2ee.enabled`, B7 Caddy `/rtc`, Prometheus scrape | **1.0d** | @backend + @architect |
| **Frontend manager** | F1 `livekitRoomManager.ts` 420L (Room, events, publish/subscribe, Last-N, SFrame install), F3 `keys/manager.ts` DataChannel→`publishData`, F4 `sframe/transform.ts` adapter, F12 `package.json` livekit-client bump | **2.5d** | @webrtc |
| **Wiring** | F5 `useWebRTC.ts`, F6 `index.ts`, F7 `core-types.ts`, F8 `auth/token.ts`, F9 `turn/manager.ts`, F11 `vite.config.ts` | **1.0d** | @frontend + @webrtc |
| **Screen share + metrics** | F10 `MeetingPage.tsx` tiny, F14 `metrics/collector.ts` | **0.25d** | @frontend |
| **Testing & Wireshark** | Unit (`go test`, `vitest`), 2-browser manual, `tcpdump` bridge, fix `livekit_room_total` scrape | **1.0d** | @qa + @webrtc |
| **Docs/ADR** | D1 brief, D2 C4, D3 ADR, gate file | **0.5d** | @architect |
| **Review / gates** | PR review, 5-gate sign-offs | **0.5d** (parallel) | PM |
| **Total** | | **6.75 person-days (≈ 1.5 weeks elapsed with 1 FTE, 1 week with 2)** | |

**Buffer:** +1d for `livekit-client` 2.4→2.9 API churn (`RoomOptions` shape `publishDefaults` vs `publishDefaults.videoEncoding`). Keep `livekit-client` at `^2.4.0` initially to avoid churn.

---

## 9. Risks & Mitigations

| # | Risk | Severity | Likelihood | Mitigation (P0) |
|---|------|----------|------------|-----------------|
| R1 | **SFrame + dynacast contradiction persists** — LiveKit with E2EE blind cannot do selective layer forward; blind-forward 3 layers burns 80% downlink (arch-brief §8). Could still blow CPU >70% or network >12 Mbps per client, failing perf criterion #2 `p95 ≤300ms loss<1%`. | High | High (confirmed for both SFUs per ADR-004) | **Accepted fallback:** Ship blind-forward Last-N=9 `adaptiveStream:false,dynacast:false`, UI shield `E2EE · 3-layer relay`. Budget 2 vCPU fallback documented honestly (71% 1 vCPU marginal → 48% 2 vCPU). If even blind-forward fails (CPU >70% sustained), trigger §9 pivot **Option A** mesh ≤5p + non-E2EE SFU for >5 (48h proposal). No facade, no silent downgrade to DTLS. |
| R2 | **Token format mismatch** — LiveKit server rejects JWT (iss/secret mismatch, `keys: dev:` yaml vs env `LIVEKIT_KEYS`, or `room` grant typo) → `Room.connect` fails `401 Unauthorized`, `livekit_room_total` stays 0, user sees infinite “Connecting…”. | High | Medium | Validate locally: `docker compose config` shows `LIVEKIT_KEYS`, `infra/livekit.yaml` placeholder `dev:` matches env, `POST /token` JWT decoded on jwt.io before `Room.connect`. Add `meet-signal` log `token iss={key} room={roomId}` prefix only. Keep legacy path behind env for quick rollback. |
| R3 | **SFrame transform not applied to LiveKit tracks** — forgetting to patch `RTCRtpSender.createEncodedStreams` before `publishTrack` → plaintext on wire, Wireshark shows NALs, fails criterion #4 ciphertext proof and “honest E2EE” gate. | Critical (security) | Medium (new injection point) | Add `installSFrameOnRoom` assertion: `if (!sender.createEncodedStreams) throw`. Test with `ffmpeg`-like pcap check: `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y rtp -T fields -e sframe.kid` shows KID/CTR, payload entropy >7.5 bits/byte. Explicit `ShieldBadge` shows ⚠️ `DTLS-only` if SFrame unavailable, never silent. |
| R4 | **HPKE pubkey race** — newcomer misses `hpke-pubkey` broadcast (LiveKit data reliable but ordered per-topic), `rotateOnJoin` tries to `seal` without pubkey → `Welcome` fails, new participant never gets epoch, decrypt fails. | Medium | Medium (150ms defer in mesh) | Keep mesh mitigation: `rotateOnJoin` loops `while (!getParticipantHPKEPublicKey(joiner) && attempts<10) sleep 100ms` (F3). Also re-publish `hpke-pubkey` on `ParticipantConnected` after 100ms. If still missing after 1s, fall back to signaling `POST /signal welcome` via `SignalingClient` stub. |
| R5 | **Last-N unsubscribe breaks E2EE key sync** — unsubscribed participants still need epoch commits (they may resubscribe). If `publishData(topic:'sframe-commit')` is sent only to subscribed participants, off-screen 11–20p miss rotation and show black when scrolled. | Medium | Medium | Always broadcast `Commit` to **all** `room.remoteParticipants` (no `destinationIdentities` filter) regardless of `subscribed` state. `Welcome` is per-joiner (destinationIdentities=[joiner]). |
| R6 | **TURN relay with LiveKit** — `iceServers` from `turn-auth` not picked up by LiveKit `RTCPeerConnection` (LiveKit merges its own `iceServers` from server `rtc` config). Strict NAT `iptables -p udp --dport 3478 -j DROP` + `iceTransportPolicy:relay` may fail. | Medium | Low | Pass `iceServers` via `RoomOptions.rtcConfig.iceServers` (not token). Verify `chrome://webrtc-internals candidateType=relay` + Prometheus `turn_allocations_active>0`. Keep coturn `network_mode: host` 3478/5349/443. |
| R7 | **LiveKit single-node scale** — single 2 vCPU/4GB SFU handles ≤50 rooms / 20p (80 rooms × 20p would be 1600 publishes) beyond P0 claim. Compose 4 vCPU/8GB host may thrash if QA runs 50 rooms parallel load. | Medium | Low (P0 cap 50 rooms, 20p room) | Enforce load harness `meet-load --rooms 50 --participants 20 --duration 600` one room at a time for P0 proof; document “single compose for ≤50 rooms, K8s required beyond” honest capacity (arch-brief §2). `meet-sfu-manager` HRW ready but Compose only one node. |
| R8 | **Vite proxy / Caddy misroute** — `/rtc` WebSocket upgrade 502 if `header_up` missing or `ws://livekit:7880` vs `wss://host/rtc` confusion (Caddy `admin off`). | Medium | Medium | Keep both dev (`vite.config.ts` proxy `'/rtc' → 'http://livekit:7880'`, `ws:true`) and prod (`Caddyfile handle /rtc* reverse_proxy livekit:7880`). Test `wscat -c ws://localhost:7880/rtc` via Caddy. |
| R9 | **Wireshark capture wrong interface redux** — prior `qa/reports/wireshark-livekit-sframe.pcapng` empty 420B on host `NPF_{FAF60428}` not bridge `meet-secure-p0_default` 172.18.0.0/16 gw 172.18.0.1 (livekit 172.18.0.9). Re-capture failure repeats, blocks gate `architecture-exit-checklist` criterion #4 RED. | Medium | High (history) | Mandate correct cmd in runbook: `docker run --network meet-secure-p0_default -v ${PWD}/qa/reports:/pcaps nicolaka/netshoot tcpdump -i any -w /pcaps/wireshark-livekit-sframe.pcapng "udp port 7880 or port 3478 or tcp port 7880"` during load test. Use `bridge` interface `meet-secure-p0_default`, not host. |
| R10 | **Dependency bump “go.sum missing”** — `services/turn-auth` has zero deps (stdlib only, no `go.sum`). Adding `livekit/protocol` to `meet-signal` but not updating `services/meet-signal/go.sum` or Docker `COPY go.sum` leads to `go mod download` fail in CI `docker build`. | Low | Medium (AGENTS.md gotcha) | If Option A manual JWT, no new dep → no `go.sum` change. If Option B, `COPY go.mod go.sum` in Dockerfile (ensure `go.sum` committed). Document that `turn-auth` still zero-dep. |
| R11 | **Bundle / Lighthouse regression** — `livekit-client 2.4` tree-shaken ~45kB gz (up from mesh 0), may push bundle over <120kB gz P0 budget (§10 #9) or TBT >200ms. | Low | Medium | Lazy-load `livekitRoomManager.ts` dynamic `import('livekit-client')` inside `initialize()`, keep WASM 150KB async + integrity hash, Workbox offline shell unchanged. Verify `npm run lighthouse` on `/join/:id` ≥95 perf/best-practices after cutover. |

---

## 10. Verification Checklist (must be reproducible, per M0-P0 §3 proof artifacts)

> All commands relative to repo root `C:\Users\joshu\meet-secure-core`. Require `docker compose -f infra/compose.yaml up --build --wait` green first (11 Up, 6 healthy: `curl -f` 8080/8081/8082/9090/3000/9600).

### Infra
- [ ] `docker compose -f infra/compose.yaml config | grep -E "livekit:|LIVEKIT_"` shows `image: livekit/livekit-server:v1.25.1`, `LIVEKIT_KEYS=dev:...`, `LIVEKIT_E2EE_ENABLED=true, MODE=blind`, `SFU_NODES=livekit:7880`, `SFU_HASH_SALT=p0-salt-2026`
- [ ] `curl -f http://localhost:8080/healthz` (meet-signal) `{"status":"ok","service":"meet-signal"}`
- [ ] `curl -f http://localhost:8081/healthz` (meet-sfu-manager) `{"status":"ok","service":"meet-sfu-manager"}`
- [ ] `curl -f http://localhost:9600/healthz` (livekit) 200 + `curl -f http://localhost:8082/healthz` (turn-auth)
- [ ] `curl -f http://localhost:9090/-/healthy` (prometheus) + `curl -f http://localhost:3000/api/health` (grafana)
- [ ] `curl -s http://localhost:9090/api/v1/query?query=livekit_room_total | jq .data.result` shows `init = 0` before test

### Token
- [ ] `curl -s -X POST http://localhost:8080/token -H 'Content-Type: application/json' -d '{"roomId":"qa-`date +%s`","name":"qa-alice"}' | tee /tmp/tok.json | jq .` → `{token, participantId: "p-...", roomId, url: "wss://.../rtc"}` (url non-empty)
- [ ] `echo $(jq -r .token /tmp/tok.json) | cut -d. -f2 | base64 -d | jq .` contains `iss: "dev"`, `sub: "p-..."`, `exp` = `nbf+300` (±5s), `video: {roomJoin:true, room:"qa-..."}`, `name`
- [ ] Same token `jwt.io` signature verifies with `LIVEKIT_API_SECRET=p0-dev-pass-32chars-0123456789abcdef012345` (not `JWT_SECRET`)
- [ ] `livekit_room_total` still 0 before any `Room.connect` (dormant expectation confirmed)

### 2-browser smoke
- [ ] `npm --prefix poc/meet-webrtc-core run dev` → `http://127.0.0.1:5173/r/qa-smoke#k=test` 2 tabs (Chrome 127+ vs Edge 127+ or Firefox 128+) → both `isConnected=true`, `ShieldBadge` `E2EE · 3-layer relay`, `VideoGrid` shows local+remote, mute/cam/leave + `getDisplayMedia` screen share works → remote receives ~720p. No console `offer/answer` frames (LiveKit WS frames only).
- [ ] `curl -s http://localhost:9090/api/v1/query?query=livekit_room_total | jq .data.result[0].value[1]` **now >0** (`1` room). `livekit_participants` == 2.

### SFrame ciphertext + SFU opaque (criterion #4)
- [ ] During 2-browser call: `docker run --rm --network meet-secure-p0_default -v ${PWD}/qa/reports:/pcaps nicolaka/netshoot bash -c "tcpdump -i any -w /pcaps/wireshark-livekit-sframe.pcapng 'udp port 7880 or port 3478 or tcp port 7880' & sleep 30; ls -lh /pcaps/wireshark-livekit-sframe.pcapng"` → file >1MB (not 420B header-only). Previous backups `*.bak-2026-09-01` preserved.
- [ ] `tshark -r qa/reports/wireshark-livekit-sframe.pcapng -Y rtp -T fields -e rtp.ssrc -e rtp.payload -e sframe.kid 2>&1 | head` shows `rtp.payload` random bytes, no `00 00 00 01` NAL start-code, `sframe.kid` visible. `tshark -Y sframe` shows ciphertext, no plaintext VP9/H264 magic. Artifact committed: `qa/reports/wireshark-livekit-sframe.pcapng` (>100 KB, >1000 packets).
- [ ] LiveKit server log (`docker compose logs livekit`) contains no `decrypted` or key material, only `forwarding SSRC`.

### Simulcast + Last-N + perf (criterion #2)
- [ ] `npm --prefix poc/meet-webrtc-core run load` (or `livekit load tester --room qa-load --participants 20 --publishVideo --simulcast 3 --duration 600`) → room stable ≥10 min, `docker stats livekit` CPU avg <70% on 2 vCPU (or documented 48% avg 67% p95 per ADR-004), `packet_loss <1%` (`curl http://localhost:9090/api/v1/query?query=rate(livekit_packet_loss[1m])`), `p50 ≤150ms p95 ≤300ms` via `getStats()` `roundTripTime`. Logs show 20 distinct `participantId`.
- [ ] Client subscribes Last-N=9: open 12-participant room, verify `VideoGrid` shows 9 tiles + hidden 3 `trackPublication.isSubscribed==false`, downlink ~8–12 Mbps (`getStats bytesReceived`).

### Key rotation p95 ≤500ms (criterion #6)
- [ ] Trigger 20 joins/leaves under 20p load, instrument `performance.now()` in `KeyManager.rotateEpoch()` → `setEncryptionKey` ack. Produce `qa/reports/key-rotation-latency.json` histogram `p50 ≤300ms p95 ≤500ms`, zero plaintext frames during rotation. Keep `keys zeroized on leftAt` log.

### Reconnect p95 ≤5s (criterion #7)
- [ ] `tc qdisc add dev lo netem loss 100% 3s` or kill WSS, then restore. Measure `RoomEvent.Reconnecting` → `Reconnected` + first decrypted frame `TrackSubscribed` <5s p95 over 10 trials/browser. `qa/reports/reconnect-latency.json`.

### TURN HMAC 24h (criterion #8)
- [ ] `curl -X POST http://localhost:8082/turn/credentials -H 'Content-Type: application/json' -d '{"roomId":"qa-turn","participantHash":"p-abc123"}' | jq .` → `{username:"<expiry>:<hash>", credential: base64(HMAC), ttl:86400, urls:["turn:...:3478","turns:...:443"]}`
- [ ] Force relay: client `iceTransportPolicy:relay` (LiveKit `rtcConfig.iceTransportPolicy='relay'`) + `iptables -p udp --dport 3478 -j DROP` (in `netshoot`) → `candidateType=relay` in `chrome://webrtc-internals` + `turn_allocations_active >0` scrapped `9090`, media still ciphertext. Allocation latency <2s.

### Lighthouse ≥95 (criterion #9)
- [ ] `npm --prefix poc/meet-webrtc-core run build && npx vite preview --port 4173 &` + `npm run lighthouse` → `qa/reports/lighthouse/lighthouse-report.json` perf ≥95, accessibility ≥95, best-practices ≥95, PWA installable, TBT <200ms CLS 0. Bundle `<120kB gz + WASM 150KB async`.

### Zero persistent telemetry (criterion #10)
- [ ] `grep -R "analytics\|mixpanel\|sentry" poc/meet-webrtc-core/src` clean, `grep -R "localStorage.*track"`, CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'` (via Caddy header or `index.html` meta), `@privacy` sign-off `docs/privacy-inventory.md`.

### Browser matrix (criterion #1)
- [ ] `npm --prefix poc/meet-webrtc-core run test:browser` (Playwright) + manual `qa/reports/browser-matrix.html` 100% pass on Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4 macOS+iOS PWA (screen share via `getDisplayMedia` where supported, iOS fallback documented). No silent SFrame fallback — explicit ⚠️ if `RTCEncodedVideoFrame` absent.

### Exit: `docs/gates/architecture-exit-checklist.md` 22 items PASS + 5 gate signatures (`p0-gate-verify` label).

---

## 11. Decision Output: **GO-LIVEKIT** vs GO-MESH — **GO-LIVEKIT**

### Rationale (architecture view)

| Criterion | GO-MESH (keep mesh) | **GO-LIVEKIT (this plan)** | Verdict |
|-----------|----------------------|-----------------------------|---------|
| **Departure from M0-P0 authority** | Violates `architecture-brief.md` §1/3/5 (`SFU primary, P2P 1:1 fallback only`, `LiveKit 1.25 GO` per ADR-004) and `infra/compose.yaml` single-SFU claim. Mesh is frozen per `docs/M0-P0.md` §2 “P2P↔SFU handoff FROZEN”. Keeping mesh would hide `livekit_room_total=0` (dormant) ≠ proof. | Aligns with **all 10 criteria §10 traceability**: #2 20p single-SFU, #3 `docker compose up` parity + HRW, #4 SFrame blind-forward (ADR-004 trade-off), #8 TURN HMAC 24h. | **GO-LIVEKIT** — mesh is not P0. |
| **20p + SFrame honesty** | Mesh 20p = `19×2.75 Mbps ≈ 52 Mbps up/down` full mesh — impossible on 1 vCPU/8GB host, fails criterion #2. Would need silent downgrade or N=5 cap already. | LiveKit single-SFU 2 vCPU 48% avg 67% p95 (ADR-004 benchmark) with blind-forward Last-N=9 AWS ~8–12 Mbps down — **validated GO with fallback** honestly, pivot Option A documented. | **GO-LIVEKIT**— only path to honest 20p. |
| **SFrame vs dynacast contradiction** | Same contradiction for mesh? Mesh has no SFU, so contradiction moot but still O(N²). For >5p, mesh already NO-GO. | Contradiction acknowledged (§8–9); blind-forward shipped not facaded, shield `E2EE · 3-layer relay`. No architecture change to solve before W4; honest. | Tie — both need fallback; LiveKit fallback preserves 20p. |
| **Operational complexity** | P2P requires per-peer `RTCPeerConnection` ×19 = 19 DTLS/SCTP/SRTP stacks per client, 19× ICE, perfect negotiation glare handling, 19 DataChannels for commits — battery/CPU blown, Safari gaps. Server is stateless hub (in-memory `map[room]map[*client]struct{}`) no Redis pub/sub despite `REDIS_URL` env, not K8s-ready for 50 rooms. | LiveKit: 1 WSS per client to SFU, 3 up simulcast tracks, 9 down subscriptions, single reliable DataChannel for commits, stateless `meet-signal` becomes token issuer (no sticky), Redis `presence:{roomId}:{hash}` TTL 24h still valid, K8s parity via Helm. | **GO-LIVEKIT** — simpler, K8s-ready day 1, better CPU/RAM (620 vs 890 MB). |
| **Observability** | `livekit_room_total=0` expected — no SFU metrics, Grafana dark, can't prove 20 distinct participantIds via Prometheus (only in-memory hub logs). Fails gate `livekit_rooms_active`/`sfu_load`. | `livekit_room_total>0`, `livekit_participants`, `packet_loss`, `turn_allocations_active` scrapped day 1 (ADR-004). Single `docker compose up` parity check passes. | **GO-LIVEKIT** — required for gate. |
| **Security/Privacy** | HPKE/SFrame same (good) but no SFU to prove opaque forward. | Preserves identical HPKE suite + `sender_key=HKDF(epoch,"sframe",sender_id)` + Wireshark pcap on bridge 172.18.0.9 proof. No persistent telemetry, CSP unchanged, keys client-only. | Tie — but LiveKit proof is stronger (Wireshark on SFU bridge). |
| **Effort & risk** | 0 dev to keep mesh, but 100% chance P0 NO-GO at W4 (20p fails, gates fail). Pivot 48h → mesh ≤5p + non-E2EE SFU (loss of E2EE honesty narrative). | 6.75 pd, low risk (only transport for commits moves), rollback 1h via `VITE_USE_LIVEKIT=false` + legacy `JWT_SECRET` path. | **GO-LIVEKIT** — cheaper than pivot cost. |
| **Compose parity** | Single command works but media never touches LiveKit — `compose.yaml` LiveKit container idle waste, violates self-host claim “LiveKit infra via Compose” (§3) | Single command stays valid, adds `--build --wait` healthz 8080/8081/9600/8082/9090/3000, ≤50 rooms on 4 vCPU/8GB validated per arch-brief §2. | **GO-LIVEKIT** |

**Decision:** **GO-LIVEKIT — Execute this plan immediately.** Keep mesh only as rollback commit tagged `mesh-backup-2026-09-04`; delete after `p0-gate-verify`.

**GO/NO-GO guardrail:** If after Step 4 `livekit_room_total` stays 0 or Wireshark still shows plaintext NALs (SFrame not applied), stop and file `docs/gates/architecture-gate-review-2026-09-04-no-go.md` with pcap evidence, then pivot per arch-brief §9 Option C (mediasoup custom header-aware) within 48h — no facade.

---

## Appendix A — Code paths to delete vs keep (for reviewer)

**Delete (mesh-only):** `WebRTCManager.pc: RTCPeerConnection`, `pc.onconnectionstatechange` → `ReconnectManager.start()`, `pc.onicecandidate` → `signaling.sendIceCandidate`, `pc.ontrack` → `handleTrack` (+ `applyReceiverTransform` ad-hoc), `setupPeerConnectionHandlers`, `setupDataChannelHandlers`, `makingOffer/polite/ignoreOffer/isSettingRemoteAnswerPending`, `pendingIceCandidates[100]`, `negotiate()`, `handleDescription()` (perfect negotiation), `handleIceCandidate()` queue, `handleTrack()`.

**Keep/adapt:** `KeyManager` (all), `SFrameTransform` (add `installSFrameOnRoom`), `TURNManager`, `ScreenShareManager`, `MetricsCollector` (source change), `ReconnectManager` (wrapper only), `useAppStore` (add `livekitUrl` optional), `VideoGrid/VideoTile/ControlBar/ShieldBadge`.

## Appendix B — LiveKit server JWT validation (for @security)

LiveKit validates `Authorization: Bearer <token>` on WebSocket upgrade `GET /rtc` (or `POST /twirp/livekit.RoomService/CreateRoom` for server SDK). Validation: `HMAC-SHA256(LIVEKIT_API_SECRET, token)` → check `iss == LIVEKIT_API_KEY`, `exp > now`, `video.roomJoin && video.room == requested room`. No JWKS. Re-trace with `LIVEKIT_KEYS=dev: secret` in `livekit.yaml` vs env `LIVEKIT_KEYS` — keep both consistent.

## Appendix C — References

- `docs/M0-P0.md` §3 (#3 LiveKit via Compose+Helm, HRW), §4 (frozen mesh), §7 (5 gates), §10 exit template
- `docs/architecture-brief.md` §§2,4.1,5–9,11
- `docs/adr/ADR-004-livekit-vs-mediasoup.md` GO + benchmark table (LiveKit 48% avg vs mediasoup 78% p95 fail)
- `infra/compose.yaml` `:7880 :8080 :8081 :8082 :9090 :9600`, `SFU_HASH_SALT=p0-salt-2026`
- `poc/meet-webrtc-core/src/webrtc/manager.ts:1-805`, `src/index.ts: DEFAULT_P0_CONFIG`, `services/meet-signal/main.go: handleToken/handleSignal`
