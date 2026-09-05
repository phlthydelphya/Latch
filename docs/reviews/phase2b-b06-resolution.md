# Phase 2B Blocker B-06 Resolution — Global Sender Counter (v2 → v2.1)

**Blocker:** B-06 — IV salt/counter (SFrame RFC9605 §4.7) residual: per-track counters cause AES-GCM nonce reuse across audio/video/screen-share
**Input:** `docs/plans/phase2b-sframe-design-v2.md` v2 (834L, 2026-09-04) — 6 RED blockers B-01..B-06 marked resolved, but B-06 residual remained (per-track counters)
**Output:** `docs/plans/phase2b-sframe-design-v2.1.md` v2.1 (B-06 global sender counter patch, supersedes v2 for B-06)
**Scope:** Design revision only. No production code modified. Only B-06 changed; B-01..B-05 + 8 incorporations unchanged and re-affirmed.
**Authority:** `docs/M0-P0.md` §§3/4 · `docs/architecture-brief.md` §§2/4.2/5/8-9 · `poc/meet-webrtc-core/src/sframe/transform.ts` · `src/keys/manager.ts` · `src/hooks/useWebRTC.ts` (post-2A `582c4d7`) · SFrame RFC9605 §4.7 · NIST SP800-38D GCM
**Stack locked:** LiveKit `1.25` `LIVEKIT_E2EE_MODE=blind`, `AES_GCM` 128, `HKDF-SHA256`, `DHKEM(P-256,HKDF-SHA256)`, `wasm-sframe` 150KB
**Reviewers required:** @architect (Architecture) + @security (STRIDE T-01) before GREEN; @privacy/@qa/@reviewer ACK.

---

## 1. Blocker Summary

| Blocker | Title | Severity | v2 Location | v2 Status | v2.1 Resolution | Verified By |
|---------|-------|----------|-------------|-----------|-----------------|-------------|
| **B-06** | IV salt derivation + counter uniqueness | **HIGH (remains BLOCKER if per-track)** — AES-GCM nonce reuse → catastrophic confidentiality loss, keystream recovery, tag forgery (Joux) | `transform.ts:174-191` in v1; v2 §4.2, §5.2, §5.1, §6, §7, §16 I-5/I-6 | **Partially resolved in v2:** per-epoch HKDF salt 12B `HKDF(epoch,"sframe-salt")` + `IV=salt XOR BE64(counter)` + `KID` in AAD was correct, but `encryptCounter: Map<KID,Map<trackId,bigint>>` per-track and `decryptCounters: Map<senderId:kid:mediaType:trackId>` per-track left same `(sender_key, IV)` reused across tracks at same CTR (both 0) | **Fully resolved in v2.1:** Replace per-track with **global sender counter** `Map<epoch,bigint>` single monotonic per `(epoch, canonicalSenderId)` shared audio/video/screen-share under mutex; `decryptCounters: Map<epoch,Map<canonicalSenderId,bigint>>` (no trackId); `IV = salt XOR BE64(counter)` injective per frame | Arch review §5 + Security `TestIVUniquenessAcrossTracks` + Wireshark cross-SSRC CTR monotonic + `grep encryptCounter` single increment proof |

**Why v2 was still BLOCKER despite salt fix:** v2 correctly fixed static zero salt → per-epoch HKDF salt, and moved `KID` to AAD, but retained `encryptCounter` per `trackId`. Applicant demonstrated (and PM quality guard flagged) that audio and video from same sender/epoch both start at `CTR=0` → `IV_audio = salt XOR 0` == `IV_video = salt XOR 0` with same `sender_key = HKDF(epoch,"sframe",senderId)` → identical `(key, nonce)` reused for two distinct plaintexts. NIST SP800-38D states reuse leaks `GHASH` key `H` and allows forgery; RFC5116 §5.1.1 calls it catastrophic. In 20p room, every participant's first audio Opus packet and first VP9 frame collide ⇒ 100% reproducible.

**v2.1 preserves:** `sender_key` derivation `HKDF(epoch_secret,"sframe",canonicalSenderId)` (no change), epoch rotation `generateEpochSecret 32B` + `deriveSalt 12B` (no change), replay protection `counter > lastCounter` (now per `(epoch,sender)` not per track), `previousEpochs` TTL 30s sweep 10s max 3 with `salt` retention + zeroization (no change).

---

## 2. Per-Blocker Resolution: B-06 Original / Revised / Reason

### B-06 — IV salt derivation + counter uniqueness (SFrame RFC9605 §4.7)

#### Original Design (v2 §§4.2, 5, 6, 7 — per-track counters, salt OK)

```ts
// v2 EpochKeys (correct salt part)
type EpochKeys = { epochSecret: CryptoKey, epochSecretRaw: Uint8Array, salt: Uint8Array/*12B HKDF*/, senderKeys: Map<CanonicalId,CryptoKey>, epoch:number, createdAt:number }
async function deriveSalt(epochSecret: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:TextEncoder.encode('sframe-salt')}, epochSecret, 96);
  return new Uint8Array(bits);
}
function deriveIV(salt: Uint8Array, counter: bigint): Uint8Array {
  const iv = new Uint8Array(12);
  const ctrBE = new Uint8Array(8); new DataView(ctrBE.buffer).setBigUint64(0, counter, false);
  for(let i=0;i<12;i++) iv[i] = salt[i] ^ (i<4 ? 0 : ctrBE[i-4]);
  return iv;
}
// v2 COUNTERS — RESIDUAL DEFECT: per-track
// src/sframe/transform.ts
encryptCounter: Map<number, Map<string, bigint>> // kid → (trackId → counter)  e.g. {1: {videoTrackA: 0n, audioTrackB: 0n}} — both 0!
decryptCounters: Map<string, Map<string,bigint>> // key `${canonicalSenderId}:${kid}:${mediaType}:${trackId}`

async encryptFrame(plaintext: Uint8Array, trackId:string, mediaType:'audio'|'video'): Promise<Uint8Array> {
  const kid = this.getCurrentKID();
  const salt = this.epochSaltForKID(kid);
  let ctrMap = this.encryptCounter.get(kid);
  if(!ctrMap) { ctrMap = new Map(); this.encryptCounter.set(kid, ctrMap); }
  const counter = ctrMap.get(trackId) ?? 0n; // per-track start 0
  const header = buildHeader(kid, counter); // KID+CTR varint
  const iv = deriveIV(salt, counter); // same salt + same counter → same IV across tracks!
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128, additionalData: header}, senderKey, plaintext);
  ctrMap.set(trackId, counter+1n);
  return concat(header, ciphertext);
}
async decryptFrame(data: Uint8Array, senderId:string, trackId:string, mediaType:string): Promise<Uint8Array> {
  const {kid, counter, header, payload} = parseHeader(data);
  const lastKey = `${canonicalize(senderId)}:${kid}:${mediaType}:${trackId}`;
  const last = this.decryptCounters.get(lastKey) ?? -1n;
  if(counter <= last) throw new Error('Replay detected');
  // ... deriveIV same salt, AAD=header, decrypt
  this.decryptCounters.set(lastKey, counter);
}
```

**Consequences in v2:**
- Sender Alice epoch 1: `camera.publishTrack` → CTR 0 IV `salt1⊕0`; `mic.publishTrack` → CTR 0 IV `salt1⊕0` → **same IV, same key** → GCM reuse.
- Receiver keeps two windows `Alice:1:video:trackV → 0` and `Alice:1:audio:trackA → 0` → both accepted, masking reuse.
- Wireshark `sframe.ctr` shows per-SSRC restart at 0, not global monotonic.
- Test `iv !=` in v2 only checked across epochs/senders, not across tracks for same sender/epoch — missed.

#### Revised Design (v2.1 §§4.2, 5.1, 5.2, 6, 7, 13, 16 — global sender counter)

```ts
// v2.1 EpochKeys unchanged for salt part — same deriveSalt
// v2.1 COUNTERS — CORRECTED: global per (epoch, sender)
type Epoch = number; // = KID
type CanonicalId = string;

class SFrameTransform {
  // GLOBAL sender counter — single monotonic per (epoch, thisSender) shared across all local tracks
  private encryptCounter: Map<Epoch, bigint> = new Map(); // kid → counter (single bigint) e.g. {1: 7n} meaning next is 7
  // Receiver: per (epoch, remoteSender) last seen
  private decryptCounters: Map<Epoch, Map<CanonicalId, bigint>> = new Map(); // epoch → (canonicalSenderId → lastCounter)
  private counterMutex: Promise<void> = Promise.resolve(); // or AsyncMutex
  private globalSaltForKID: (kid:Epoch)=>Uint8Array;
  // ...
  private async withCounterLock<T>(fn:()=>Promise<T>): Promise<T> {
    const prev = this.counterMutex; let release!:()=>void;
    this.counterMutex = new Promise<void>(r=> release=r);
    await prev;
    try { return await fn(); } finally { release(); }
  }
}

async encryptFrame(plaintext: Uint8Array): Promise<Uint8Array> {
  // No trackId param for counter key — global
  return this.withCounterLock(async () => {
    const kid = this.getCurrentKID(); // epoch
    const salt = this.globalSaltForKID(kid); // 12B per epoch
    const counter = this.encryptCounter.get(kid) ?? 0n;
    if (counter > 0xFFFFFFFFFFFFFFFFn) throw new Error('counter overflow');
    const header = buildHeader(kid, counter); // varint KID + varint counter
    const iv = deriveIV(salt, counter); // salt XOR BE64(counter)
    const senderKey = this.keyManager.getSenderKey(canonicalSelf, kid)!;
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128, additionalData: header}, senderKey, plaintext);
    this.encryptCounter.set(kid, counter+1n);
    // metrics + logs with globalCounter
    return concat(header, ciphertext);
  });
}

async decryptFrame(data: Uint8Array, senderId: CanonicalId): Promise<Uint8Array> {
  const {kid, counter, header, payload} = parseHeader(data);
  const canonicalSender = canonicalizeIdentity(senderId);
  // replay check GLOBAL per (kid, sender) — no trackId, no mediaType
  let perEpoch = this.decryptCounters.get(kid);
  if(!perEpoch) { perEpoch = new Map(); this.decryptCounters.set(kid, perEpoch); }
  const last = perEpoch.get(canonicalSender) ?? -1n;
  if (counter <= last) throw new Error(`Replay detected: epoch ${kid} sender ${canonicalSender} counter ${counter} <= last ${last}`);
  const salt = this.globalSaltForKID(kid); // from currentEpoch or previousEpochs
  const iv = deriveIV(salt, counter);
  const senderKey = this.keyManager.getSenderKey(canonicalSender, kid);
  if(!senderKey) throw new Error(`No sender key for ${canonicalSender} kid ${kid}`);
  const plaintext = await crypto.subtle.decrypt({name:'AES-GCM', iv, additionalData: header}, senderKey, payload);
  perEpoch.set(canonicalSender, counter);
  return plaintext;
}

function deriveIV(salt: Uint8Array, counter: bigint): Uint8Array {
  if(salt.byteLength!==12) throw new Error('salt must be 12B');
  const iv = new Uint8Array(12);
  const ctrBE = new Uint8Array(8); new DataView(ctrBE.buffer).setBigUint64(0, counter, false);
  for(let i=0;i<12;i++) iv[i] = salt[i] ^ (i<4 ? 0 : ctrBE[i-4]);
  return iv;
}

// Installation — single shared instance across all local senders
let globalSFrame: SFrameTransform | null = null;
let globalMutex = new AsyncMutex();
export async function installSFrameOnSenderShared(sender: RTCRtpSender, globalSFrame: SFrameTransform, mutex: AsyncMutex) {
  const {readable, writable} = sender.createEncodedStreams() as any;
  readable.pipeThrough(globalSFrame.createSenderTransformerWithGlobalCounter(mutex)).pipeTo(writable);
}
// All tracks (camera video, mic audio, screen video) share same globalSFrame + mutex

// Rotation — counter reset but salt changes
async function rotateEpoch(trigger): Promise<{commits,newEpoch}> {
  // ... deriveSalt, re-derive senderKeys ...
  this.previousEpochs.set(oldEpoch, this.currentEpoch);
  this.currentEpoch = {epochSecret:newSecret, epochSecretRaw:newRaw, salt:newSalt, senderKeys:newMap, epoch:newEpoch, createdAt:Date.now()};
  globalSFrame.encryptCounter.set(newEpoch, 0n);
  globalSFrame.decryptCounters.set(newEpoch, new Map());
  // old epoch's decryptCounters retained until TTL 30s
}
```

**Ownership normative (v2.1 §5.1):** `epoch → sender → counter` — exactly one counter per `(epoch, canonicalSenderId)` in sender's `encryptCounter: Map<epoch,bigint>` and one `lastCounter` per `(epoch, senderId)` in receiver's `decryptCounters: Map<epoch, Map<sender,bigint>>`. No `trackId`, `mediaType`, `SSRC`, `mid` in key.

#### Reason Change Is Correct

1. **RFC9605 §4.7 IV uniqueness normative:** "The IV MUST be unique for each (key, counter) pair." With per-track counters, two frames from same `sender_key` with same `counter=0` reuse IV → violates MUST → catastrophic. v2.1 with global monotonic per `(epoch,sender)` makes `counter` injective per `(key, salt)` → `IV` injective (XOR with constant salt is bijection) → same `(key, IV)` never repeats.

2. **Same key across tracks:** `sender_key` is intentionally per sender, not per track, to keep HPKE commit size O(participants) not O(tracks) and to avoid per-track key blowup (20p × 3 tracks = 60 keys). This is correct per SFrame MLS-lite design, but it requires counter domain to be shared if key is shared. Alternative of per-track key (`HKDF(epoch,"sframe",senderId+trackId)`) would also avoid reuse but changes commit to O(tracks) and requires device to advertise trackIds before key derivation — unnecessary complexity. Global counter is simpler and preserves v2 key derivation.

3. **Salt alone not enough:** Per-epoch HKDF salt 12B prevents reuse **across epochs** (different salt ⇒ different IV even at same counter) but not **within epoch across tracks** (same salt ⇒ same IV at same counter). Global counter covers within-epoch case. Together they cover both dimensions: `salt` covers epoch, `counter` covers frame index within sender's sequence.

4. **Concurrency correctness:** With global counter, concurrent audio+video `TransformStream.transform` calls must serialize `read+increment`. `AsyncMutex` / `withCounterLock` ensures atomicity; without it, race could read same counter before increment → still reuse. Gate scan `grep -n "encryptCounter"` must show single increment site under lock, not per-track unsynchronized `++`. WASM multi-track needs `SharedArrayBuffer` + `Atomics` or else must be flagged `DTLS-only` for multi-track WASM (iOS PWA limitation documented in v2.1 §11).

5. **Replay protection now global:** `counter > lastCounter[epoch][sender]` without trackId catches cross-track replay (duplicate CTR from different track) — per-track windows would miss. Example: sender global CTR 0(video),1(audio); attacker replays video CTR 0 after audio 1 — global `0 <=1` → rejected (correct), per-track would accept (wrong). Strict monotonic per sender is intended GCM behavior; LiveKit SFU preserves order per sender, so out-of-order legitimate frames would also be rejected — acceptable tradeoff, document; future window relaxation possible without changing ownership.

6. **Preserved properties verified:**
   - `sender_key` derivation unchanged: `HKDF(epoch_secret, "sframe", canonicalSenderId)` — same code path `keys/manager.ts:106-121`.
   - Epoch rotation unchanged: `generateEpochSecret 32B` + `deriveSalt` 12B + `previousEpochs` TTL 30s sweep 10s max 3 + zeroize `salt.fill(0)` — same.
   - `KID` in AAD not IV — same.
   - Insertion points I-5/I-6/I-8/I-9 now share global instance; I-2 init `encryptCounter[0]=0n`; §16 table patched.

---

## 3. Updated Artifacts — Summary (v2 → v2.1)

| Artifact | v2 | v2.1 Delta | File/Section |
|----------|----|------------|--------------|
| **Architecture diagram** | PWA box showed per-track counters `video/audio` split | Updated to global `encryptCounter: Map<epoch,bigint>` + `decryptCounters: Map<epoch,Map<sender,bigint>>` + note `GLOBAL per (epoch,sender)` | `phase2b-sframe-design-v2.1.md` §3.1 |
| **Flowchart** | PWA_v2 with `deriveSalt OK` + per-track counters | Added PWA_v2_residual vs PWA_v2.1 corrected flowchart showing per-track collision vs global monotonic | §3.2 |
| **Cipher suite** | `IV=salt XOR BE64(counter)` + KID in AAD + per-track counters | `IV` same formula but `counter` now defined as global per `(epoch,sender)`; added `deriveIV(salt,counter)` signature + header as AAD + uniqueness proof | §4.2 |
| **New normative counter ownership** | Implied per-track | **NEW §5.1** table `epoch → sender → counter` with JS types, single increment path, canonicalization | §5.1 |
| **Counter persistence rules** | Scattered, unclear | **NEW §5.2** table across `publishTrack`, `audio/video`, `screen share`, `join/leave rotation`, `mute`, `reconnect`, `TTLevict`, `reload` — each row states encrypt/decrypt/salt behavior | §5.2 |
| **Test spec** | `iv !=` across epochs/senders only | **NEW §5.3** `TestIVUniquenessAcrossTracks` with 4 sub-tests + supporting tests; gate-blocking | §5.3 |
| **Why nonce reuse no longer possible** | Brief salt explanation | **NEW §5.4** formal proof: injective IV, salt covers epoch, counter covers frame, key per sender, mutex, epoch rotation safety, empirical verification | §5.4 |
| **Sender lifecycle** | Per-track `Map<kid,Map<trackId,bigint>>` + per-track installs | Patched to shared `globalSFrame` + `globalCounterMutex` + `encryptCounter: Map<kid,bigint>` + reset on rotate | §6 |
| **Receiver lifecycle** | `decryptCounters` keyed `sender:kid:mediaType:trackId` + per-track delete on unsubscribe | Patched to `Map<kid,Map<sender,bigint>>` no trackId + no per-track delete until TTL | §7 |
| **Key rotation** | `rotateEpoch` re-derives senderKeys + salt but not counter global reset | Patched `rotateEpoch` to `encryptCounter.set(newEpoch,0n)` + `decryptCounters.set(newEpoch,new Map())` | §9.2, §9.5 |
| **Rekey sequences** | Join/leave mermits without counter annotations | Annotated `encryptCounter[1]=0n` reset + `CTR 0,1,2... GLOBAL shared` + screen share same domain | §10.1, §10.2, §10.4 |
| **Browser matrix** | WASM fallback note | Added note WASM multi-track must share via SAB or DTLS-only | §11 |
| **Failure handling** | Replay per `sender:kid:mediaType:trackId` | Patched to `counter <= lastCounter[epoch][sender]` global (no trackId) | §12.3, §12.7 |
| **Metrics** | `frames_encrypted_total{kid,mediaType}`, `frames_decrypted_total{kid,sender,mediaType}` | Patched to `{kid}` and `{kid,sender}` (remove mediaType); added `webrtc_sframe_counter_current{epoch}` gauge | §13.1 |
| **Logs** | `[SFrame] encrypt kid ctr media` per track | Patched to `globalCounter` no `media=`; receiver `lastCounter` per `(kid,sender)` | §13.2 |
| **Wireshark proof** | entropy >7.5 + blind | Added cross-SSRC CTR monotonic check (same sender CTR consecutive across SSRCs) | §13.4 |
| **Insertion table** | I-1..I-13 with per-track I-5/I-6/I-8/I-9 | **Patched I-2, I-4, I-5, I-6, I-8, I-9, I-11, I-12, I-13** to share global instance; I-5/I-6/I-8/I-9 now `installSFrameOnSenderShared`/`ReceiverShared` | §16 |
| **Sequence diagrams** | End-to-end without counter sharing | Annotated global CTR 0,1,2 across camera/mic/screen | §18.1 |
| **Threat model** | T-01 per-epoch salt only | **T-01 patched** to name per-track collision vector + global counter mitigation + new evidence `TestIVUniquenessAcrossTracks` + Wireshark cross-SSRC + `grep encryptCounter` lock proof | §19 T-01 |
| **Implementation order** | 7 steps | Step 2 now primary B-06 step with global counter + `TestIVUniquenessAcrossTracks` gate; Step 5/6 add cross-SSRC + test artifact | §20 |
| **Open questions** | 6 Qs | Added Q7 WASM SAB for global counter | §21 |

---

## 4. Detailed Ownership & Persistence (normative excerpt for reviewers)

### 4.1 Ownership `epoch → sender → counter`

| Dimension | Owner | Key | Type | Scope |
|-----------|-------|-----|------|-------|
| Epoch | `KeyManager` | `epoch: number` | `EpochKeys {salt:12B, senderKeys:Map<CanonicalId,CryptoKey>}` | current + 3 previous TTL 30s |
| Sender | Canonical identity | `canonicalSenderId: string` | `sender_key = HKDF(epoch_secret,"sframe",id)` | per epoch |
| Counter | **Global per `(epoch,sender)`** | `counter: bigint` u64 | `encryptCounter: Map<epoch,bigint>` sender-local; `decryptCounters: Map<epoch,Map<sender,bigint>>` receiver | shared audio/video/screen |

Single increment path under `AsyncMutex` — all local `RTCRtpSender`s share same `SFrameTransform` instance.

### 4.2 Persistence rules (condensed)

- **publishTrack (any):** shared, not reset — next frame `counter+1` regardless of track (camera 0..99 → mic 100).
- **audio / video:** interleave monotonically per `EncodedFrame` (each simulcast layer is separate increment if separate `EncodedFrame`).
- **screen share:** same domain, same epoch, no new counter, `replaceTrack` keeps counter.
- **mute:** preserve counter frozen; unmute resume `+1` (no clear).
- **join/leave/periodic rotate:** reset `encryptCounter[newEpoch]=0n`, new `salt`, new `senderKeys`, keep old epoch's decrypt window until TTL.
- **reconnect:** preserve counter (no reset) + pause sweep; if new epoch while away, reset.
- **TTL evict:** delete `encryptCounter[old]` + `decryptCounters.delete(old)` + `salt.fill(0)`.
- **reload:** new `KeyManager` → fresh epoch 0 counter 0 (in-memory only, never persisted to storage).

Full table in `phase2b-sframe-design-v2.1.md` §5.2.

---

## 5. Test: `TestIVUniquenessAcrossTracks` (gate-blocking)

**Location:** `src/sframe/transform.test.ts` or `poc/meet-webrtc-core/tests/sframe-global-counter.test.ts` (vitest)

**Must PASS before GREEN. Artifact `qa/reports/sframe-global-counter-test-output.txt`.**

```ts
// Core — audio, video, screen-share never reuse IV for same sender/epoch
it('audio+video+screen from same sender/epoch never reuse IV', async () => {
  const km = new KeyManager(...); await km.initialize(canonicalize('alice'));
  const salt = km.getCurrentSalt(); const kid = km.getCurrentEpoch();
  const t = new SFrameTransform({keyManager:km, getCurrentKID:()=>kid, epochSalt:salt});
  const ivs = new Set<string>(); const counters: bigint[] = [];
  const order = ['video','audio','video','screen','audio','video','screen','audio','video','audio'] as const;
  for(const kind of order) {
    const {iv, counter} = await (t as any).encryptFrameForTest(new Uint8Array([1,2,3]), kind);
    const hex = [...iv].map(b=>b.toString(16).padStart(2,'0')).join('');
    expect(ivs.has(hex)).toBe(false); // no reuse
    ivs.add(hex); counters.push(counter);
  }
  expect(counters).toEqual([0n,1n,2n,3n,4n,5n,6n,7n,8n,9n]); // global consecutive, not per-track 0,0,0
});
it('same counter on different senders does not collide because sender_key differs', async () => {/* same IV but different keys → cross-decrypt fails */});
it('counter resets to 0 on epoch rotation but IV not reused because salt changes', async () => {/* beforeIV0 != afterIV0 */});
it('decrypt replay is per (epoch,sender) not per track — same counter on different trackIds rejected', async () => {/* video CTR0 → ok, audio CTR1 → ok, replay video CTR0 → Replay */});
```

Supporting tests: `TestDeriveIVDeterministic`, `TestSaltUniquenessPerEpoch` (100×), `TestPreviousEpochsRetainsSalt`, `TestZeroizeClearsSalt`.

**Why this test proves fix:** With v2 per-track, first loop would yield `counters = [0,0,1,0,1,2,1,2,3,3]` (per-track restarts) and `ivs` would collide at 0 → FAIL. With v2.1 global, passes.

---

## 6. Why Nonce Reuse Is No Longer Possible (proof for @security)

**Lemma 1 (per-track reuse vector in v2):** Same `sender_key` (per sender per epoch) + same `salt` (per epoch) + same `counter=0` across two tracks ⇒ `IV = salt XOR BE64(0)` identical ⇒ `(key, IV)` identical for two distinct plaintexts ⇒ GCM nonce reuse.

**Lemma 2 (v2.1 global counter injectivity):** For fixed `salt`, `IV = salt XOR BE64(counter)` is bijective in `counter` (XOR with constant is bijection). `counter` is strictly monotonic `0,1,2...` per `(epoch,sender)` via atomic `counter++` under mutex ⇒ all `IV`s for that `(epoch,sender)` distinct.

**Lemma 3 (cross-epoch uniqueness):** New epoch ⇒ new random `epochSecret` 32B ⇒ new `salt=HKDF(newSecret)` (96-bit, collision 2^-96) AND new `sender_key=HKDF(newSecret)` ⇒ even if `counter` resets to 0, `(key_new, IV_new_0)` differs from `(key_old, IV_old_0)` with overwhelming probability.

**Lemma 4 (cross-sender uniqueness):** Different `senderId` ⇒ `HKDF` with different `info` ⇒ `sender_key` distinct ⇒ same `IV` (if same counter+salt) does not cause reuse (reuse requires same key).

**Theorem:** For any two distinct frames `f1≠f2` sent by sender `S` in epoch `E`, `counter(f1)≠counter(f2)` ⇒ `IV(f1)≠IV(f2)` ⇒ `(key_{E,S}, IV(f1)) ≠ (key_{E,S}, IV(f2))`. No reuse. Across senders/epochs, keys or salts differ. ∎

**Empirical:** `TestIVUniquenessAcrossTracks` + Wireshark cross-SSRC `tshark -e sframe.kid -e sframe.ctr -e rtp.ssrc` showing per-sender CTR consecutive across SSRCs (not per-SSRC restart) proves implementation matches spec.

---

## 7. Evidence Mapping (Traceability to v2.1 doc)

| Requirement (prompt) | v2.1 Section(s) | Artifact |
|----------------------|------------------|----------|
| Replace per-track counters with global sender counter | §§3.1, 4.2, 5.1, 6, 7, 9.2, 16 | `encryptCounter:Map<epoch,bigint>` + `decryptCounters:Map<epoch,Map<sender,bigint>>` + shared `globalSFrame` |
| Preserve sender_key derivation | §8.2 unchanged | `HKDF(epoch_secret,"sframe",canonicalId)` |
| Preserve epoch rotation | §§9.1, 9.2, 9.5 unchanged + global reset annotation | `generateEpochSecret` + `deriveSalt` + `previousEpochs` TTL |
| Preserve replay protection | §§7.1, 12.3 patched to `counter > lastCounter[epoch][sender]` global | `decryptCounters` without trackId |
| Preserve previousEpochs retention | §§8.1, 9.5, 10.3, 12.7 unchanged + salt retained | `Map<epoch,EpochKeys>` TTL 30s max 3 |
| Update architecture diagrams | §§3.1, 3.2 v2.1 corrected flowcharts | PWA_v2.1 diagram + counter mutex |
| Update sequence diagrams | §§10.1, 10.2, 18.1 global CTR annotations | `CTR 0,1,2... GLOBAL shared` |
| Update threat model | §19 T-01 patched | STRIDE T-01 with cross-track vector + global mitigation |
| Update insertion table | §16 I-2, I-4, I-5, I-6, I-8, I-9, I-11, I-12, I-13 | `installSFrameOnSenderShared` |
| Update metrics section | §§13.1, 13.2, 13.4 | labels `{kid}`/`{kid,sender}` + `webrtc_sframe_counter_current` + cross-SSRC Wireshark |
| Specify exact counter ownership: `epoch → sender → counter` | **§5.1** normative table | `Map<epoch,bigint>` + `Map<epoch,Map<sender,bigint>>` |
| Define counter persistence rules across: publishTrack, audio/video, screen share, join/leave rotation | **§5.2** table (7+ rows) | publish shared, audio/video interleave, screen share same domain, rotate reset, etc. |
| Add TestIVUniquenessAcrossTracks | **§5.3** spec (core + 3 sub-tests + 4 supporting) | `sframe-global-counter.test.ts` + `qa/reports/sframe-global-counter-test-output.txt` |
| Explain why nonce reuse is no longer possible | **§5.4** proof (4 lemmas + theorem + empirical) | Injectivity + salt + key binding + Test + Wireshark |

---

## 8. Review Disposition

| Gate | Findings (v2) | v2.1 Disposition |
|------|--------------|----------------|
| Architecture | B-06 partially resolved (salt ok, per-track residual) | **Fully resolved** — §§5.1/5.2 global ownership + §16 shared instance + §3 diagrams prove no per-track path remains |
| Security | T-01 IV reuse residual — per-track same `(key,IV)` at CTR 0 → GCM catastrophic | **Mitigated** — global monotonic per `(epoch,sender)` + `IV=salt XOR BE64(counter)` bijective + `TestIVUniquenessAcrossTracks` + Wireshark cross-SSRC CTR proof — **re-review required** pre-GREEN |
| Privacy | No change | **ACK** — invariants preserved (§15), counters in-memory only, no new telemetry beyond `counter_current` gauge |
| QA | No global-counter test; metrics labels per-track | **Matrix corrected** — add `TestIVUniquenessAcrossTracks` vitest PASS artifact + metrics labels `{kid}`/`{kid,sender}` + Wireshark cross-SSRC check |
| Adversarial | Honest E2EE claim invalid if nonce reuse | **Honest** — explicit global counter + proof + no silent downgrade; shield still DTLS-only if WASM multi-track cannot share via SAB |

**Ready for re-review:** `@architect` + `@security` (focus T-01) + `@qa` (test + metrics) — 5 gates unchanged otherwise.

---

## 9. References

- Baseline v2: `docs/plans/phase2b-sframe-design-v2.md` (superseded for B-06)
- New design: `docs/plans/phase2b-sframe-design-v2.1.md` §§3.1, 3.2, 4.2, 5.1-5.4, 6, 7, 9.2/9.5, 10, 13, 16, 18, 19
- SFrame RFC9605 §4.2 KID/CTR header, §4.7 IV/AAD — v2.1 salt + global counter + AAD
- NIST SP800-38D (GCM) — nonce reuse leaks `H` and allows forgery (Joux)
- HPKE RFC9180 `DHKEM(P-256,HKDF-SHA256)+HKDF-SHA256+AES-128-GCM` `enc 65B`
- `poc/meet-webrtc-core/src/sframe/transform.ts` — `deriveIV`, `encryptCounter` (v2 per-track → v2.1 global)
- `poc/meet-webrtc-core/src/keys/manager.ts` — `generateEpochSecret`, `deriveSalt`, `previousEpochs` TTL
- `docs/architecture-brief.md` §8 blind-forward, §11.1 gate
- `docs/M0-P0.md` §§3/4/8-10 zero-telemetry, 10 criteria
- Prior blockers: `docs/reviews/phase2b-blocker-resolution.md` B-01..B-06 v2 resolutions (this doc is B-06 v2→v2.1 supplement)

---

*End of Phase 2B B-06 Resolution — global sender counter replaces per-track counters. Design revision only; no production code modified. `TestIVUniquenessAcrossTracks` gate-blocking. Requires Architecture + Security re-review before GREEN.*

