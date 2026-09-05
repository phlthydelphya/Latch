# Phase 2B Blocker Resolution — RED Review → v2

**Input:** `docs/plans/phase2b-sframe-design.md` v1 (774L, 2026-09-04) — Phase 2B Design Review (RED)
**Output:** `docs/plans/phase2b-sframe-design-v2.md` (v2, supersedes v1)
**Scope:** Design revision only. No production code modified. All 6 blockers below resolved; 8 mandatory incorporations included.
**Authority:** `docs/M0-P0.md` §§3/4 · `docs/architecture-brief.md` §§2/4/5/8-9 · `poc/meet-webrtc-core/src/keys/manager.ts` · `src/sframe/transform.ts` · `src/hooks/useWebRTC.ts` (post-2A `582c4d7`)

---

## 1. Blocker Summary Matrix

| Blocker | Title | Severity | v1 Location | v2 Resolution | Verified By |
|---------|-------|----------|-------------|---------------|-------------|
| **B-01** | publishHPKEPublicKey before connect | **BLOCKER** — `publishData` impossible pre-connect, all key distribution silently fails | v1 §6.2 I-2/B | Defer publish until `RoomEvent.Connected` flush queue + 3× retry | Arch review §16 I-2/I-3 |
| **B-02** | DataReceived topic handling | **BLOCKER** — all commit/welcome dropped (payload.topic never exists) | v1 §7.2 J, §9.2 | Branch on 4th arg `topic` of `DataReceived(payload, participant, kind, topic)` | livekit-client 2.4 `Room.ts` signature |
| **B-03** | rotateEpoch senderKeys derivation | **BLOCKER** — first post-rotation frame encrypt fails, decrypt fails | v1 §9.2, `manager.ts:158-183` | Re-derive senderKeys for self+all canonical before createCommit | Unit `TestRotateDerivesSelf` |
| **B-04** | leader rotation ownership | **BLOCKER** — concurrent epochs, room split, p95 unmeasurable | v1 §9.1, §10.1 | Deterministic sorted[0] + AsyncMutex + debounce 500ms + single-flight | Metric `rotation_contention_total` |
| **B-05** | RTCRtpScriptTransform strategy | **HIGH** — prototype patch breaks Chrome LiveKit, violates CSP | v1 §6.3 | Three-tier ET primary → ScriptTransform secondary → WASM tertiary, no patch | Browser probe `createEncodedStreams` |
| **B-06** | IV salt derivation | **HIGH** — GCM nonce reuse → catastrophic confidentiality loss | v1 `transform.ts:174-191` | Per-epoch HKDF salt 12B, `IV=salt XOR BE64(counter)`, KID in AAD | Review `deriveIV` + unit `iv !=` |

Additional incorporations (mandatory, all in v2): Welcome epoch AAD, Welcome retry, previousEpochs TTL eviction, Firefox 128-131 matrix, Safari 17.4/iOS PWA limits, Audio transform, Rotation mutex, Identity canonicalization — see §8.

---

## 2. Per-Blocker Resolution (Original / Revised / Reason)

### B-01 — publishHPKEPublicKey before connect

**Original Design (v1 §6.2 I-2, §6.2/B, §10.1 step 3)**

```text
Insertion B (I-2): after roomRef.current = room;
  await keyManager.initialize(participantId);
  epochSecret = keyManager.getCurrentEpochSecret();
  currentKID = keyManager.getCurrentEpoch();
  await installSFrameOnRoom(room);
  publishHPKEPublicKey(b64) via publishData topic:hpke-pubkey  // BEFORE room.connect
Insertion C (I-3): await room.connect(resolvedSfuUrl, token) // already has pubkey
Rationale in v1: “Publish HPKE pubkey after init (before connect) so joiner race has material.”
```

Published before authenticated data channel exists.

**Revised Design (v2 §3.2, §8.1, §16 I-2/I-3, §10.1)**

```text
Insertion I-2 (pre-connect, local only):
  const canonicalSelf = canonicalizeIdentity(participantId);
  await keyManager.initialize(canonicalSelf);
  let epochSalt = keyManager.getCurrentSalt(); // 12B HKDF
  let currentKID = keyManager.getCurrentEpoch();
  const pubkeyB64 = await keyManager.exportHPKEPublicKey(); // 65B b64
  pendingQueue.push({topic:'hpke-pubkey', payload:TextEncoder.encode(pubkeyB64), reliable:true});
  // NO publishData here. install helpers but do not pipe.

Insertion I-3 (on Connected):
  room.on(RoomEvent.Connected, async ()=>{
    setConnected(true);
    await flushPendingPublishQueue(room, pendingQueue);
      // for each entry: await room.localParticipant.publishData(payload, {reliable:true, topic})
      // retry 100ms, 300ms, 900ms on throw "Room not connected" / "DataChannel not open"
      // fallback → POST /sync {type:'hpke-pubkey'} over WSS if exhausted
    await installSFrameOnRoom(room, keyManager, ()=>currentKID); // three-tier
    startPeriodicRotation();
    startPreviousEpochsSweep();
  });
Log: "hpke-pubkey deferred until connected" + retry count
```

Same deferred pattern applied to Welcome (§9.3 `publishWelcomeWithRetry`).

**Reason Change Is Correct**

- `livekit-client` `Room.localParticipant.publishData` requires `room.state === 'connected'` and SCTP data channel negotiated during `Room.connect`. Calling before connect throws `Room not connected` (verified in `livekit-client@2.4 Room.ts publishData` guard). Pre-connect publish is not merely racy — it is impossible per API contract.
- Generating keypair locally pre-connect is still valid (no network) and preserves race mitigation: pubkey is enqueued locally then flushed within ~30-80 ms after `Connected`, still before any `rotateOnJoin` needs it (leader polls 10×100 ms). Deferral satisfies both correctness and liveness.
- Reference: livekit-client docs `RoomEvent.DataReceived(payload, participant, kind, topic)` and `publishData(data, options)` both require connected Room; §16 I-2/I-3 now matches that contract. Evidence for fix: Phase 2A log `Room.connect success trackPublicationsSize:0` proves Connected fires before publish in current `useWebRTC.ts` (§2 baseline).

---

### B-02 — DataReceived topic handling

**Original Design (v1 §7.2 J, §9.2, §10.1 steps 6-7, §16 I-7)**

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  const msg = JSON.parse(new TextDecoder().decode(payload));
  if (msg.topic === 'sframe-commit') handleDataChannelCommit(msg);
  else if (msg.topic === 'sframe-welcome') handleWelcome(msg);
  else if (msg.topic === 'hpke-pubkey') handleHPKE(msg);
  // topic inside payload JSON
});
broadcastCommitsViaLiveKitData(filtered, newEpoch){
  const msg = JSON.stringify({type:'commit', epoch:newEpoch, commits: commitsObj});
  await room.localParticipant.publishData(encoder.encode(msg), {reliable:true, topic:'sframe-commit'});
  // topic sent as LiveKit topic option but handler reads payload.topic → mismatch
}
```

**Revised Design (v2 §16 I-7, §9.2, §10.1, §7.2)**

```ts
// Correct livekit-client 2.4.0 signature (four args)
room.on(RoomEvent.DataReceived,
  (payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string) => {
    const canonicalTopic = topic?.trim() ?? '';
    switch(canonicalTopic){
      case 'hpke-pubkey': {
        const b64 = new TextDecoder().decode(payload); // payload IS b64 string
        const key = await keyManager.importHPKEPublicKey(b64);
        keyManager.setParticipantHPKEPublicKey(canonicalizeIdentity(participant!.identity), key);
        break;
      }
      case 'sframe-commit': {
        // payload is JSON: {epoch:number, commits: Record<canonicalId, number[]>}
        const {epoch, commits} = JSON.parse(new TextDecoder().decode(payload));
        await handleCommit(canonicalizeMap(commits), epoch, participant);
        await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({epoch})), {reliable:true, topic:'sframe-rotated-ack'});
        break;
      }
      case 'sframe-welcome': {
        // payload is raw enc||ct 65B+n; AAD verification inside processWelcome
        const epochSecret = await keyManager.processWelcome(payload, roomId, currentRoomIdHash);
        break;
      }
      case 'sframe-welcome-ack': handleWelcomeAck(payload, participant); break;
      case 'sframe-welcome-request': handleWelcomeRequest(payload, participant); break;
      case 'sframe-rotated-ack': handleRotatedAck(payload, participant); break;
      default: console.debug('[LiveKit] unknown DataReceived topic', topic);
    }
  }
);
// Publish side unchanged but handler now matches:
await room.localParticipant.publishData(payloadBytes, {reliable:true, topic:'sframe-commit'});
await room.localParticipant.publishData(welcomeBytes, {reliable:true, topic:'sframe-welcome', destinationIdentities:[canonicalJoinerId]});
```

Insertion table I-7 normative explicitly lists 4-arg form.

**Reason Change Is Correct**

- `livekit-client@2.4` types: `on(event: RoomEvent.DataReceived, callback: (payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string)=>void)`. `topic` is the 4th positional argument, not inside payload. Source: `node_modules/livekit-client/dist/src/room/Room.d.ts` and docs. Checking `payload.topic` would always be `undefined`, causing all key distribution messages to be silently dropped — room would never rotate, joiners would never receive Welcome, p95 unmeasurable, decrypt failures 100%.
- Branching on 4th arg `topic` restores reliable/ordered per-topic semantics LiveKit guarantees (each topic is a separate ordered stream). Payload decoding per topic (b64 vs JSON vs raw enc||ct) is now explicit and canonicalized.

---

### B-03 — rotateEpoch senderKeys derivation

**Original Design (v1 §9.2, `keys/manager.ts:158-183` paraphrased)**

```ts
async rotateEpoch(trigger, leavingId?): Promise<{commits, newEpoch}> {
  const oldEpoch = this.currentEpoch.epoch;
  const newEpoch = oldEpoch + 1;
  const {key:newSecret, raw:newRaw} = await generateEpochSecret();
  this.previousEpochs.set(oldEpoch, this.currentEpoch);
  this.currentEpoch = {epochSecret:newSecret, epochSecretRaw:newRaw, senderKeys:new Map(), epoch:newEpoch, createdAt:Date.now()};
  const commits = await createCommit(newRaw, oldEpoch, leavingId); // loops participantKeys only
  return {commits, newEpoch};
}
// createCommit iterates:
// for (const [participantId, publicKey] of this.participantKeys) { seal(payload) }
// new epoch senderKeys remains empty; self not derived; peers not derived
```

First frame after rotation would call `getCurrentSenderKey()` → `null` → `throw No sender key available for encryption` (§6).

**Revised Design (v2 §5.1 pseudocode, §9.2, §8.2)**

```ts
async rotateEpoch(trigger, leavingId?: string): Promise<{commits, newEpoch}> {
  const oldEpoch = this.currentEpoch.epoch;
  const newEpoch = oldEpoch + 1;
  const {key: newSecret, raw: newRaw} = await generateEpochSecret();
  const newSalt = await deriveSalt(newSecret); // HKDF "sframe-salt" 12B — B-06
  this.previousEpochs.set(oldEpoch, this.currentEpoch); // archive with salt
  this.currentEpoch = {epochSecret:newSecret, epochSecretRaw:newRaw, senderKeys:new Map(), epoch:newEpoch, salt:newSalt, createdAt:Date.now()};
  // NEW: re-derive senderKeys for self + all known canonical participants BEFORE createCommit
  const participants = [...this.participantKeys.keys(), canonicalizeIdentity(selfId)];
  for (const pid of new Set(participants.map(canonicalizeIdentity))) {
    const k = await deriveSenderKey(newSecret, pid); // HKDF(epoch_secret, "sframe", pid)
    this.currentEpoch.senderKeys.set(pid, k);
  }
  const commits = await createCommit(newRaw, oldEpoch, canonicalizeIdentity(leavingId)); // per-recipient HPKE
  schedulePreviousEpochsEviction(oldEpoch); // TTL 30s
  return {commits, newEpoch};
}
async function deriveSalt(epochSecret: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:TextEncoder.encode('sframe-salt')}, epochSecret, 96);
  return new Uint8Array(bits); // 12B
}
```

`getSenderKey(canonicalSenderId, kid)` checks `currentEpoch.epoch===kid` else `previousEpochs.get(kid)` with canonical key lookup.

**Reason Change Is Correct**

- SFrame per-sender encryption requires `sender_key = HKDF(epoch_secret, "sframe", canonicalSenderId)` derived for every participant including self before first encrypt under new epoch. Without self derivation, `encryptFrame` throws immediately; without peer derivation, `decryptFrame` throws `No sender key for KID` until asynchronous `processCommit` later — violating p95 ≤500ms (which measures `trigger → slowest setEncryptionKey ack`) and zero-plaintext-frames invariant.
- Deriving synchronously inside `rotateEpoch` ensures atomic KID increment with ready keys, so `createCommit` seal and immediate subsequent `getSenderKey(self, newEpoch)` both succeed. Reference: existing `keys/manager.ts:106-121` `deriveSenderKey` already correct; v2 just invokes it proactively for all. Archive retains old `salt` for decrypt fallback during 30s grace.

---

### B-04 — leader rotation ownership (determinism + mutex)

**Original Design (v1 §9.1, §10.1 steps 4-6, §16 I-10/I-11)**

```text
Leader selection: "Deterministic lowest participantId hash (lexicographic participantId < joinerId polite pattern mirrors webrtc/manager.ts:556). No central KMS."
On ParticipantConnected(B):
  if (participantId < joinerId) // inline lowest check per member
    setTimeout(()=> rotateOnJoin(B), 150);
  // Also ParticipantDisconnected → rotateAndBroadcastEpoch('leave') inline
No mutex, no debounce, no re-check. Each of N members runs its own check → N concurrent rotateEpoch if N low IDs exist.
```

**Revised Design (v2 §9.1, §10.1, §16 I-10/I-11, §5.5 mutex pseudocode)**

```text
Leader selection (v2 deterministic):
  function isLeader(): boolean {
    const ids = [canonicalizeIdentity(room.localParticipant.identity),
                 ...[...room.remoteParticipants.values()].map(p=>canonicalizeIdentity(p.identity))].sort();
    const leader = ids[0]; // lowest lexicographic canonical
    return canonicalizeIdentity(room.localParticipant.identity) === leader;
  }
  // Re-evaluated AFTER hpke-pubkey import and after 10×100ms poll for key

Rotation path (v2 mutex + debounce + single-flight):
  class AsyncMutex { queue:Promise<void>=Promise.resolve(); locked=false;
    async run<T>(fn:()=>Promise<T>): Promise<T>{
      const prev=this.queue; let release!:()=>void;
      this.queue=new Promise<void>(r=> release=r);
      this.locked=true; metrics.recordRotationContention?.();
      await prev;
      try{ return await fn(); } finally{ this.locked=false; release(); }
    } }
  const rotationMutex = new AsyncMutex();
  const debouncedRotateOnJoin = debounce((joinerId)=> rotationMutex.run(()=> rotateOnJoinInner(joinerId)), 500);

  async function rotateOnJoinInner(joinerId: string){
    if(!isLeader()) return; // re-check after debounce
    await waitForHPKEKey(joinerId, 1000); // 10×100ms poll; if missing abort
    if(!isLeader()) return; // leadership may have changed (new lower identity joined)
    const {commits, newEpoch} = await keyManager.rotateEpoch('join', undefined); // re-derives self+all
    await broadcastCommitsViaLiveKitData(filterExcludeJoiner(commits, joinerId), newEpoch);
    await publishWelcomeWithRetry(joinerId, newEpoch); // 3× retry + ack
  }

  // ParticipantDisconnected path same mutex:
  await rotationMutex.run(()=> rotateAndBroadcastEpoch('leave', canonicalLeaver));

Metrics: webrtc_rotation_contention_total increments when mutex contended; latency measured from mutex acquire to slowest ack includes queue wait.
```

**Reason Change Is Correct**

- Without single-flight mutex, a 20p join storm (`ParticipantConnected` fires on each member) creates N concurrent `rotateEpoch` calls, each archives `previousEpochs` and increments `epoch` independently → epoch fork (members diverge to epoch 1, 2, 3...), commits encrypted to stale epoch, `decryptCounters` reject, room splits. Reviewer flagged this as "racy".
- Deterministic `sorted[0]` (not per-member `participantId < joinerId` polite pattern which is for mesh mesh) matches LiveKit Room `remoteParticipants` ordering and is stable under concurrent joins. Re-check after HPKE poll handles case where a new lower identity arrives during debounce → leadership transfers to new leader, preventing double rotation. Debounce 500 ms coalesces rapid joins (e.g., 3 participants join within 300 ms → single rotation to epoch+1, not 3).

---

### B-05 — RTCRtpScriptTransform strategy (no prototype patch)

**Original Design (v1 §6.3)**

```ts
export async function installSFrameOnRoom(room: Room, keyManager, getKID){
  const sframe = new SFrameTransform({...});
  const origCreate = RTCRtpSender.prototype.createEncodedStreams as any;
  RTCRtpSender.prototype.createEncodedStreams = function(){
    const streams = origCreate ? origCreate.call(this) : (this as any)._createEncodedStreams?.call(this);
    const senderTransformer = sframe.createSenderTransformer();
    streams.readable.pipeThrough(senderTransformer).pipeTo(streams.writable);
    return streams;
  };
  room.on(RoomEvent.LocalTrackPublished, (pub)=>{
    const sender = (pub.track as any)?.sender;
    if(sender) installOnSender(sender, sframe);
  });
}
```

Global prototype mutation; assumed `RTCRtpScriptTransform` absent/ignored.

**Revised Design (v2 §5.1, §6.3, §7.1, §11 matrix, pseudocode §5.1 three-tier)**

```text
Three-tier, no prototype mutation:

PRIMARY (Standard ET) if hasCreateEncodedStreams():
  export async function installSFrameOnSender(sender: RTCRtpSender, keyManager, getKID, trackKind, trackId, epochSalt): Promise<void> {
    const sframe = new SFrameTransform({keyManager, cipherSuite:'AES_GCM', getCurrentKID:getKID, trackKind, trackId, epochSalt});
    const {readable, writable} = sender.createEncodedStreams() as {readable:ReadableStream, writable:WritableStream};
    readable.pipeThrough(sframe.createSenderTransformer()).pipeTo(writable);
    (sender as any)._sframeTransformer = sframe; // for rotateKey reset
  }
  // Hook points:
  room.on(RoomEvent.LocalTrackPublished, async (pub, participant)=>{
    if(participant===room.localParticipant){
      const sender = (pub.track as any)?.sender as RTCRtpSender | undefined;
      if(sender) await installSFrameOnSender(sender, keyManager, ()=>currentKID, pub.kind, pub.trackSid, epochSalt);
    }
  });
  // Receiver:
  room.on(RoomEvent.TrackSubscribed, async (track, pub, participant)=>{
    const receiver = (track as any)?.receiver as RTCRtpReceiver | undefined;
    if(receiver) await installSFrameOnReceiver(receiver, keyManager, ()=>currentKID, canonicalizeIdentity(participant.identity), track.kind, pub.trackSid, epochSalt);
  });

SECONDARY (ScriptTransform) else if hasScriptTransform():
  new RTCRtpScriptTransform(worker, {name:'sframe', salt}) per sender/receiver; worker imports SFrame transform via W3C worker-based ET (spec RTCRtpScriptTransform). Used when createEncodedStreams absent but ScriptTransform present (Safari 17.5+).

TERTIARY else if wasmFallback:
  wasm-sframe 150KB OffscreenCanvas + VideoFrame recycle via WASMSFrameWorker (existing wasmWorkerCode).

Never assign to RTCRtpSender.prototype.* ; use LiveKit getters publication.track.sender / track.receiver (validated against livekit-client@2.4 Room.ts).
```

Browser matrix §11 updated accordingly: Chrome/Edge 127+ PRIMARY, Firefox 128-131 TERTIARY WASM-primary, Firefox 132+ PRIMARY, Safari 17.4 PRIMARY, Safari 17.5 SECONDARY available, iOS PWA LIMITED.

**Reason Change Is Correct**

- `RTCRtpSender.prototype.createEncodedStreams` is non-standard in some browsers and LiveKit's own `publishTrack` internally calls a private `createEncodedStreams` path (or `_createEncodedStreams`). Patching prototype causes `TypeError: Illegal invocation` on Chrome (binding loses `this`) and breaks if multiple `Room` instances exist (global mutation affects all rooms). It also violates CSP `script-src 'self'` audit (prototype mutation is flagged by @security).
- Spec-correct path is per-sender/per-receiver `sender.createEncodedStreams()` / `receiver.createEncodedStreams()` as defined in W3C WebRTC Encoded Transform and implemented by LiveKit's `LocalTrack.sender`/`RemoteTrack.receiver` accessors. `RTCRtpScriptTransform` is the W3C worker-based alternative (preferred when ET `readable/writable` not directly exposed). Three-tier respects actual browser availability (§11) and preserves upgrade compatibility with LiveKit 2.4→2.5.

---

### B-06 — IV salt derivation (SFrame RFC9605 §4.7)

**Original Design (v1 `sframe/transform.ts:174-191`)**

```ts
private deriveIV(kid: number, counter: bigint): Uint8Array {
  const salt = new Uint8Array(this.cipherSuite.saltLen); // 12B zeroed (static)
  const kidBytes = new Uint8Array(4); new DataView(kidBytes.buffer).setUint32(0, kid, false);
  const ctrBytes = new Uint8Array(8); new DataView(ctrBytes.buffer).setBigUint64(0, counter, false);
  const iv = new Uint8Array(this.cipherSuite.saltLen); // 12
  for(let i=0;i<iv.length;i++){
    const kidByte = kidBytes[i % kidBytes.length];
    const ctrByte = ctrBytes[i % ctrBytes.length];
    iv[i] = salt[i] ^ kidByte ^ ctrByte;
  }
  return iv; // static salt → IV reuse across epochs/senders if KID/CTR collide
}
// Tag length passed but KID not in AAD
```

**Revised Design (v2 §4.2, §5.2 pseudocode, §8.1, §9.5)**

```ts
// keys/manager.ts — per-epoch HKDF salt (12B) derived once per epoch
async function deriveSalt(epochSecret: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    {name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info: TextEncoder.encode('sframe-salt')},
    epochSecret, 96 // 12B = 96 bits
  );
  return new Uint8Array(bits);
}
// EpochKeys now: {epochSecret, epochSecretRaw, salt: Uint8Array(12), senderKeys, epoch, createdAt}
// previousEpochs retains salt alongside epochSecret for decrypt fallback

// sframe/transform.ts — revised deriveIV
function deriveIV(salt: Uint8Array, counter: bigint): Uint8Array {
  const iv = new Uint8Array(12);
  const ctrBE = new Uint8Array(8); new DataView(ctrBE.buffer).setBigUint64(0, counter, false);
  // salt 12B XOR counter left-padded (first 4 bytes zero)
  for(let i=0;i<12;i++) iv[i] = salt[i] ^ (i<4 ? 0 : ctrBE[i-4]);
  return iv;
}
// Encrypt uses header as AAD to bind KID:
await crypto.subtle.encrypt(
  {name:'AES-GCM', iv: deriveIV(epochSalt, counter), tagLength: 128, additionalData: header}, // header = varint KID+varint CTR
  senderKey, plaintext
);
// Decrypt same: additionalData = parsed header bytes
// Counters per-track: encryptCounter: Map<KID, Map<trackId,bigint>> ; decryptCounters keyed `${canonicalSenderId}:${kid}:${mediaType}:${trackId}`
```

`rotateEpoch` derives `newSalt = await deriveSalt(newSecret)` and stores in `currentEpoch.salt`; on eviction `salt.fill(0)`.

**Reason Change Is Correct**

- Static zero salt violates RFC9605 §4.7 IV uniqueness: "The IV MUST be unique for each (key, counter) pair." With zero salt, two participants sending at same `KID` (epoch) and `CTR=0` (first frame) reuse IV `0x...0000 ^ KID ^ 0` identically → catastrophic AES-GCM nonce reuse, keystream recovered, confidentiality broken. Distinct senders collide first frame; same sender across epochs with same CTR also collides (CTR resets to 0 on rotation).
- Per-epoch HKDF salt `HKDF(epoch_secret,"sframe-salt",12B)` makes IV unique per `(epoch, counter)`; combined with per-sender `sender_key` (different key per `HKDF(epoch_secret,"sframe",senderId)`) and per-track counters, uniqueness is guaranteed across senders and epochs. `KID` intentionally excluded from IV (IV space is 96-bit counter domain) and instead bound via `additionalData=header` (AAD), per RFC9605 §4.7.2 "KID and CTR are authenticated as associated data." This matches interoperable SFrame implementations.

---

## 3. Additional Mandatory Incorporations (v2)

All 8 items are implemented in v2 and cross-referenced in §16 table and §11 matrix:

| Incorporation | v2 Location | Design Summary | Verification |
|---------------|-------------|----------------|--------------|
| **Welcome epoch AAD** | §9.3, §5.3 pseudocode, §19 T-02 | `Welcome` plaintext `epoch(4B)||roomIdHash(8B truncated SHA-256)||newSecret(32B)=44B`; `aad=roomIdHash` passed to `HPKE seal(plaintext, aad)` / `open(ct, aad)`. `processWelcome` rejects if `roomIdHash` mismatch or `epoch` != expected. Prevents cross-room Welcome replay. | Unit `processWelcome wrong roomId -> throw AAD mismatch` |
| **Welcome retry strategy** | §9.3, §10.1, §12.6, §5.3 | `publishWelcomeWithRetry`: `publishData topic:sframe-welcome` with `destinationIdentities:[joiner]` + await `sframe-welcome-ack` 1.5s; retry delays 100/300/900 ms ×3 then fallback `POST /sync {type:'welcome', roomId, joinerId, welcome:b64}` over WSS. Joiner-side `sframe-welcome-request` exponential backoff 500ms→4s. | Metrics `welcome_retry_total`, latency includes retries |
| **previousEpochs TTL eviction** | §9.5, §5.4, §16 I-13 | `Map<epoch,EpochKeys>` TTL 30s, sweep every 10s, max 3 epochs; on eviction `zeroizeKey(epochSecret)` + `senderKeys` + `raw.fill(0)` + `salt.fill(0)`; sweep paused during `RoomEvent.Reconnecting`, resumed on `Reconnected`. | Assert `previousEpochs.size<=3`, TTL log, reconnect p95≤5s replay |
| **Firefox 128-131 WASM-primary matrix** | §11 matrix row Firefox 128-131, §5.1 three-tier | Firefox 128-131 has `RTCEncodedVideoFrame` gated but no `createEncodedStreams` until 132 → force WASM-primary 150KB worker; ET primary only from 132+ or `media.peerconnection.encoded_transform.enabled` pref enabled. `hasCreateEncodedStreams()` probe gates path. | Browser probe `typeof RTCRtpSender.prototype.createEncodedStreams`; `browser-matrix.html` expects WASM for 128-131 |
| **Safari 17.4 / iOS PWA limitations** | §11 rows Safari 17.4/17.5/iOS PWA, §17 | macOS 17.4 ET works but `RTCRtpScriptTransform` missing until 17.5; iOS PWA: `OffscreenCanvas` limited, WASM needs user gesture (init from Join click), `getDisplayMedia` only `displaySurface:'screen'` (no `browser`/`window`), no system audio, `VideoFrame` recycle limited. Documented as *Limited* with explicit shield warning if both tiers fail. | Manual matrix video captures + `NotAllowedError` handling |
| **Audio transform coverage** | §7.1, §6.3, §5 audio section, §11 | Both audio (Opus PT 111, single SSRC) and video (VP9 SVC) use same `sender_key` per `(epoch, canonicalSenderId)` but separate counters `Map<kid, Map<trackId,bigint>>` per mediaType/trackSid. Mute `setMicrophoneEnabled(false)` preserves transform binding. Overhead ~20B/Opus packet (~30%). | Wireshark `payloadType opus` ciphertext check + audio render |
| **Rotation mutex** | §9.1, §9.2, §16 I-10/I-11, §5.5 | `AsyncMutex` promise chain (`queue:Promise<void>`) around `rotateAndBroadcastEpoch`; `debounce 500ms`; single-flight queue → subsequent callers await `rotationPromise`; contention metric `webrtc_rotation_contention_total`; latency measured from mutex acquire. | Histogram includes `mutexWaitMs`, contention counter |
| **Identity canonicalization** | §8.3, §16 notes, §5.6, §19 T-03 | `canonicalizeIdentity(id)=id.trim().toLowerCase()` utility in `src/utils/identity.ts`; all `participantKeys`/`senderKeys` maps keyed by canonical; leader sort uses canonical; LiveKit `participant.identity` (JWT sub) is source vs pre-connect `participantId`. | Unit `canonicalize("Alice ") === "alice"`; S-02 key lookup |

---

## 4. Updated Architecture Diagrams — Summary

- **Defective v1 flowchart (B-01..B-08 marked ✖):** `enforce` section 3.2 PWA_v1 in v2 doc — 8 red defects linked.
- **Corrected v2 flowchart (B-01..B-09 fixed):** section 3.2 PWA_v2 — deferred publish, correct 4-arg topic, re-derive senderKeys, three-tier ET, HKDF salt, mutex.
- **Key distribution sequence v2:** section 10.1 mermaid — `importHPKE → debouncedRotateOnJoin → rotationMutex → createCommit → publish sframe-commit → publishWelcomeWithRetry (AAD+ack)`.

See `docs/plans/phase2b-sframe-design-v2.md` §§3.2, 10.1-10.3, 18 for full mermaid sources.

---

## 5. Updated Insertion-Point Table — Summary

Normative table §§6-7/16 I-1..I-13 (13 entries, replaces v1 12):

| Delta | Entry | Fix |
|-------|-------|-----|
| **NEW** | I-3 Connected flush | Flushes `pendingQueue` with retry; handles B-01 |
| **MOVED** | I-2 no publish | Local init only; B-01 |
| **CORRECTED** | I-7 DataReceived | Switch on 4th arg `topic` canonical; B-02 |
| **ENHANCED** | I-6 TrackSubscribed | Per-receiver `createEncodedStreams` + canonical senderId + audio; B-05 |
| **ENHANCED** | I-5 LocalTrackPublished | Per-sender `createEncodedStreams` + epochSalt; B-05 |
| **ENHANCED** | I-10/I-11 ParticipantConnected/Disconnected | Sorted canonical leader + mutex + debounce; B-04 |
| **NEW** | I-12/I-13 Metrics/Cleanup | Contention + previousEpochs sweep; TTL |
| **UNCHANGED** | I-1 RoomOptions, I-4 assert, I-8 publish wrappers, I-9 screen share | Kept, augmented with canonical/salt/audio notes |

Full table with file/line anchors in v2 doc §16.

---

## 6. Updated Protocol Sequence Diagrams — Summary

- **End-to-end (§18.1):** `keyManager.init local → Room.connect → flush hpke-pubkey → installSFrameOnSender/Receiver createEncodedStreams → publishTrack ciphertext (IV salt+AAD) → TrackSubscribed decrypt`.
- **Join Welcome retry (§18.2 / §10.1):** `Connected → flush hpke-pubkey → DataReceived hpke-pubkey → isLeader? mutex → rotateEpoch deriveSalt+senderKeys → sframe-commit filtered → sframe-welcome AAD destinationIdentities retry 100/300/900 → ack or welcome-request loop`.
- **Leave rotation mutex (§18.3 / §10.2):** `ParticipantDisconnected → zeroize canonical → rotationMutex → rotateEpoch leave → sframe-commit → rotated-ack → release`.

Sources: v2 doc §§10.1-10.2 §§18.1-18.3.

---

## 7. Updated Browser Matrix — Summary

Normative matrix (§11) replaces v1 §5.2/§11. Key deltas:

- **Firefox 128-131:** explicitly **WASM-primary** (no `createEncodedStreams`) — not ET primary. `hasCreateEncodedStreams()` false → WASM. Documented as expected in gate.
- **Firefox 132+:** ET primary (when pref enabled/shipped) — probe decides.
- **Safari 17.4 macOS:** PRIMARY ET (`createEncodedStreams` true, `RTCRtpScriptTransform` false until 17.5) — matrix splits 17.4 vs 17.5.
- **Safari iOS 17.4 PWA:** **Limited** — ET if available else WASM with gesture; `OffscreenCanvas` limited, `displaySurface:'browser'` only, no system audio, `VideoFrame` recycle partial — requires explicit shield warning if both fail.
- **Audio:** new column — Chrome/Edge/Safari/Firefox all ✅ audio encrypted (same senderKey, separate counters); Opus overhead documented.

---

## 8. Updated Threat Model — Summary

V1 §15 (informal) → v2 §19 STRIDE table (9 rows T-01..T-09) with `v1 Exposure / v2 Mitigation / Evidence Artifact` per finding (see §19).

Key new mitigations vs gate gap: **T-01 IV reuse (HKDF salt)**, **T-02 cross-room replay (Welcome AAD)**, **T-03 case collision (canonicalize)**, **T-08 prototype pollution (no patch)**, **T-09 audio disclosure**. Unchanged invariants: SFU blindness proof, zero plaintext during rotation (atomic KID under mutex), keys zeroized + TTL eviction, no persistent telemetry, CSP `wasm-unsafe-eval`.

---

## 9. Updated Implementation Order — Summary

7-step dependency-ordered plan (§20) replaces v1 §21 YELLOW prerequisites:

1. **0.5d Phase 0 pre-req:** Verify `livekit-client@2.4` `publishData`/`DataReceived` 4-arg + `createEncodedStreams`/`RTCRtpScriptTransform` probes — no code.
2. **1d Step 1 KeyManager:** `EpochKeys.salt`, `deriveSalt`, `canonicalize`, TTL sweep, re-derive senderKeys before commit, Welcome AAD.
3. **1d Step 2 Transform:** `deriveIV(salt, counter)` + `additionalData=header`, per-track counters video/audio, `installOnSender/Receiver` (no prototype patch) three-tier.
4. **1.5d Step 3 useWebRTC I-1..I-13:** RoomOptions flip, pre-connect init+enqueue, Connected flush retry, sender/receiver per-track installs, DataReceived 4-arg switch, leader sorted+mutex+debounce+canonical, cleanup sweep.
5. **0.5d Step 4 Welcome reliability:** `publishWelcomeWithRetry` 100/300/900 + ack + `/sync` fallback, joiner `welcome-request` backoff.
6. **1d Step 5 Browser matrix:** 4-browser manual (§11) + Wireshark `sframe` ciphertext + audio.
7. **0.5d Step 6 Gate artifacts + 0.5d Step 7 Reviews → GREEN:** `key-rotation-latency.json` (includes mutexWait), `reconnect-latency.json`, `wireshark-livekit-sframe.pcapng` on bridge, `lighthouse/*.json` ≥95, 5-gate sign-off; then bump `livekit:1.25.1` + `LIVEKIT_E2EE_MODE=blind` + `docker compose up --build --wait` healthz 9600.

Rollback invariant preserved: no silent DTLS downgrade — explicit ⚠️ banner if all tiers fail.

---

## 10. Evidence Mapping (Traceability to v2 doc)

| Blocker / Incorporation | v2 doc section(s) | Insertion / Artifact |
|------------------------|-------------------|---------------------|
| B-01 | §§3.2, 8.1, 16 I-2/I-3, 10.1 | `flushPendingPublishQueue` + retry + fallback `/sync` |
| B-02 | §§7.2, 9.2, 16 I-7 | `switch(topic)` 4th arg, `kind` param |
| B-03 | §§8.1, 8.2, 9.2, 16 I-10, 20 Step 1 | `rotateEpoch` re-derive loop before `createCommit` |
| B-04 | §§9.1, 10.1-10.2, 16 I-10/I-11, 5.5 | `sorted[0]` + `rotationMutex` + debounce |
| B-05 | §§4.2, 5.1, 6.3, 11, 16 I-5/I-6 | `installSFrameOnSender/Receiver` + three-tier matrix |
| B-06 | §§4.2, 5.2, 8.1, 9.2, 16 I-2 | `EpochKeys.salt` + `deriveIV(salt, counter)` + `additionalData` |
| Welcome AAD | §§8.1, 9.3, 19 T-02 | plaintext 44B + aad 8B |
| Welcome retry | §§9.3, 10.1, 12.6, 16 I-3 | 100/300/900 + ack + WSS fallback |
| previousEpochs TTL | §§8.1, 9.5, 16 I-13, 5.4 | 30s TTL sweep 10s max 3 zeroize |
| Firefox 128-131 | §11 matrix | WASM-primary row |
| Safari iOS PWA | §11 matrix rows + §17 | gesture + displaySurface limits |
| Audio | §§6.3, 7.1, 11, 16 I-5/I-6 | per-track counters, mute preserves binding |
| Mutex | §§9.1, 9.2, 16 I-10/I-11, 5.5 | AsyncMutex single-flight |
| Canonicalize | §§8.2, 8.3, 16 notes, 5.6, 19 T-03 | `canonicalizeIdentity` utility |

---

## 11. Review Disposition

| Gate | Findings (v1) | v2 Disposition |
|------|--------------|----------------|
| Architecture | 6 RED blockers B-01..B-06 (publish timing, topic miss, derivation, race, patch, IV) | **All resolved** — §§2-5 tables above; diagrams §4 and insertion §5 prove §16 anchors |
| Security | T-01 IV reuse (GCM nonce), T-02 cross-room replay, T-03 spoof lookalike, T-08 prototype pollution | **Mitigated** — HKDF salt, Welcome AAD + canonicalize, no prototype patch (§8, §19) — **re-review required** pre-GREEN |
| Privacy | No change | Invariants preserved (§15); no new tracking; **re-review ACK** |
| QA | Matrix assumed ET for Firefox 128-131 and Safari iOS PWA unqualified; topic routing would cause 100% decrypt failure | **Matrix corrected (§7) + topic fix (§2 B-02)** — QA validates with WASM-primary expectation + `switch(topic)` handler + `tshark` entropy |
| Adversarial | Honest E2EE claim invalid (IV reuse + silent race-induced plaintext) | **Honest** — explicit three-tier + mutex + shield DTLS-only banner; no silent downgrade (§8, §12.1) — **pivot waiver pending** |

**Ready for re-review:** `@architect` + `@security` + `@privacy` + `@qa` + `@reviewer` (5 gates). Infra bump `livekit:1.25.1` and Compose healthz verification gated until Step 7 GREEN (not in this design phase).

---

## 12. References

- Baseline v1: `docs/plans/phase2b-sframe-design.md` (superseded — this doc supersedes §§6/7/9.2/6.3/5.1)
- LiveKit client 2.4 `Room.ts` `publishData(payload, options:{reliable, topic, destinationIdentities})` + `RoomEvent.DataReceived(payload, participant, kind, topic)`
- SFrame RFC9605 §4.2 KID/CTR, §4.7 IV uniqueness + AAD, AES-GCM 128 `tagLen 16`
- HPKE RFC9180 `DHKEM(P-256,HKDF-SHA256)+HKDF-SHA256+AES-128-GCM` `enc 65B`
- `poc/meet-webrtc-core/src/hooks/useWebRTC.ts:14-309` — insertion anchors post-2A
- `poc/meet-webrtc-core/src/keys/manager.ts:66-430` — HPKE, `rotateEpoch`, `createCommit` (v1 defects annotated in v2)
- `poc/meet-webrtc-core/src/sframe/transform.ts:30-538` — counters, `deriveIV` (v1 zero-salt fixed in v2), `wasmWorkerCode`
- `docs/architecture-brief.md` §8 blind-forward `LIVEKIT_E2EE_MODE=blind` + §6 HRW
- `docs/M0-P0.md` §3/4 (10 criteria, freeze, pivot), §10 zero-telemetry

---

*End of Phase 2B blocker resolution — all 6 RED blockers resolved in v2 with original/revised/reason. Design revision only; no production code modified.*

