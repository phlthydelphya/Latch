# Architecture Verification — B-06 Global Sender Counter (AES-GCM Nonce Uniqueness)

**Reviewer:** @architect (Principal Architect)  
**Date:** 2026-09-05  
**Mission:** Verify `phase2b-sframe-design-v2.1` global sender counter eliminates AES-GCM `(sender_key, IV)` reuse across 8 flows where `IV = salt XOR BE64(counter)` and `(sender_key, salt, counter, IV)` uniqueness is required per NIST SP800-38D / RFC5116 / RFC9605 §4.7.  
**Input Docs:**
- `docs/plans/phase2b-sframe-design-v2.1.md` v2.1 (834L patch, B-06 only) — §§3.1, 3.2, 4.2, 5.1-5.4, 6, 7, 8, 9.2/9.5, 10.1-10.3, 12.3, 12.7, 13.1-13.4, 16, 19 T-01
- `docs/reviews/phase2b-b06-resolution.md` v2→v2.1 delta — §§1-9 (proof Lemmas 1-4, Theorem)
- Authority: `docs/M0-P0.md` §§3/4/8-10 · `docs/architecture-brief.md` §§4.2/5/8-9 · `docs/media-p0-proof.md` · `docs/adr/ADR-002-sframe.md` · `docs/gates/architecture-exit-checklist.md`
- Baseline superseded: `docs/plans/phase2b-sframe-design-v2.md` v2 §§4.2/5/6/7 (per-track defect)

**Stack Locked:** LiveKit Go SFU 1.25 `LIVEKIT_E2EE_MODE=blind`, AES-GCM-128, HKDF-SHA256, DHKEM(P-256), Encoded Transform primary + RTCRtpScriptTransform 2nd + wasm-sframe 150KB 3rd (fallback).

> Design-only review. No production code modified. No `phase2b` implementation until Architecture + Security GREEN.

---

## 1. File References & Normative Sections (Traceability)

| Requirement | Normative Section (v2.1) | Companion Section (B-06 resolution) | Verdict |
|-------------|--------------------------|-------------------------------------|---------|
| Global counter replaces per-track | §§3.1 diagram, 3.2 flowchart (PWA_v2.1), 4.2 cipher suite, **5.1 ownership table**, **5.2 persistence table**, 6 sender lifecycle, 7 receiver lifecycle, 9.2 rotate sequence, 16 I-5/I-6/I-8/I-9 | §§2 B-06 revised, 4.1/4.2 ownership+persistence excerpt, 6 Lemmas | Present |
| Preserve sender_key derivation HKDF | §4.2 unchanged, §8.2 `HKDF(epoch_secret,0,"sframe"+canonicalId)→128bit` | §2 preserved properties, §6 Lemma 4 | Present |
| Preserve per-epoch salt HKDF | §4.2 `deriveSalt HKDF("sframe-salt",96b)=12B` in `EpochKeys.salt`, §8.1 | §2 EpochKeys unchanged | Present |
| Counter `Map<epoch,bigint>` global monotonic | §5.1 `encryptCounter: Map<Epoch,bigint>` + `decryptCounters: Map<Epoch,Map<CanonicalId,bigint>>`, §5.4 proof | §2 revised code `encryptFrame with withCounterLock` | Present |
| IV injective `salt XOR BE64(counter)` | §4.2 `deriveIV()` 12B XOR last-8B, §5.4 Lemma 2 | §6 Lemma 2 (XOR bijection) | Present |
| Mutex single increment path | §5.1 ownership rule 1, §5.2 concurrency note `AsyncMutex/SharedArrayBuffer Atomics`, §6.3 `globalCounterMutex`, §13.2 logs `globalCounter` | §2 Reason #4, §6 Why #4 | Present |
| previousEpochs TTL 30s sweep 10s max3 + salt retention + zeroize | §4.2 salt stored in `EpochKeys`, §5.2 TTL eviction row, §9.5 lifecycle, §12.7 zeroize `salt.fill(0)` | §4.2 TTL row | Present |
| Test gate `TestIVUniquenessAcrossTracks` | **§5.3** (4 sub-tests + 4 supporting), §20 Step 2 gate-blocking, §13.4 Wireshark cross-SSRC | §5 gate-blocking spec | Present |
| Threat model T-01 update | §19 T-01 table (global counter mitigation, evidence `Test + Wireshark + grep encryptCounter`) | §2 Reason, §6 Why | Present |

**BLOCK CONDITION Check:** No missing normative section. v2.1 §5 (new), §5.1 ownership, §5.2 persistence, §5.3 test spec, §5.4 proof, §6/7 lifecycles, §9.2/9.5 rotation, §10.1-10.4 rekey, §16 I-table are all present and cross-referenced in resolution §7 traceability matrix. ⊘ NOT BLOCKED.

---

## 2. Invariant Under Review

**Tuple:** `(sender_key, salt, counter, IV)` where:

- `sender_key = HKDF-SHA256(epoch_secret:32B_rand, salt=0, info=UTF8("sframe"+canonicalSenderId), L=128)` → `AES-GCM-128` non-extractable CryptoKey. Deterministic per `(epoch, canonicalSenderId)`. Canonicalization `trim+lower` per §5.1 rule 5, §16 I-10. Distinct `info` per sender ⇒ distinct keys per sender even if `epoch_secret` equal. Re-derived on every `rotateEpoch` from new `epoch_secret`. (v2.1 §8.2, unchanged)
- `salt = HKDF-SHA256(epoch_secret, salt=0, info="sframe-salt", L=96)` → 12B per epoch, stored in `EpochKeys.salt`, archived in `previousEpochs: Map<epoch,EpochKeys>` TTL 30s, zeroized `salt.fill(0)` on evict. `epochSecret` 32B CSPRNG (`crypto.getRandomValues` / `generateEpochSecret`). Collision probability `2^-96`. (v2.1 §4.2, §8.1)
- `counter: bigint u64 0n..2^64-1` — **GLOBAL** per `(epoch, canonicalSenderId)`: `encryptCounter: Map<Epoch,bigint>` (sender-local, single monotonic, shared audio/video/screen-share, one increment path under `AsyncMutex`/`counterMutex` or `SharedArrayBuffer+Atomics` for WASM). `decryptCounters: Map<Epoch,Map<CanonicalId,bigint>>` per `(epoch, remoteSender)` strict `counter > lastCounter` replay. No `trackId/mediaType/SSRC/mid` in key. (v2.1 §5.1, §5.2, §6.3, §7.1)
- `IV: Uint8Array(12) = salt XOR BE64(counter)` — `deriveIV(salt,counter)` per §4.2: `ctrBE = BE64(counter)` 8B, `iv[i]=salt[i]^(i<4?0:ctrBE[i-4])`. `KID=epoch` in AAD (`header=varint(KID)||varint(counter)`, `additionalData=header`), not in IV (RFC9605 §4.7.2). TagLen 128b. **Injectivity Lemma:** For fixed `salt`, map `counter → IV` is bijection because `BE64` is bijection `bigint → 8B` and XOR with constant `salt` is bijection on `12B`. Hence `counter1≠counter2 ⇒ IV1≠IV2` for same salt. (v2.1 §4.2 code, §5.4 Lemma 2)

**Uniqueness Requirement (NIST SP800-38D, RFC5116 §5.1.1):** For AES-GCM, `(key, nonce)` must never repeat for distinct plaintexts. Here `key=sender_key`, `nonce=IV`. Reuse leaks `GHASH` key `H=AES(key,0)` and `keystream = plaintext1 XOR plaintext2`, catastrophic.

**Theorem to check (§5.4):** `∀ f1≠f2 sent by sender S in epoch E: counter(f1)≠counter(f2) ⇒ IV(f1)≠IV(f2) ⇒ (key_{E,S},IV(f1))≠(key_{E,S},IV(f2))`. Across epochs/senders, `key` or `salt` also differ.

---

## 3. The 8 Paths — PASS/FAIL with Tuple Uniqueness Reasoning

### Path 1 — `audio + video` (camera VP9 + mic Opus, concurrent)

- **Reference:** v2.1 §5.2 rows "audio (Opus) frames" / "video (VP9 SVC) frames" (interleave monotonically), §5.1 rule 1 single increment path, §5.2 concurrency note, §6.3 shared `globalSFrame` + `globalCounterMutex`, §7.1 receiver `decryptCounters` no trackId, §5.3 Test ordering `['video','audio','video',...]→counters 0..9`, resolution §2 revised `withCounterLock`.
- **v2 defect:** `Map<KID,Map<trackId,bigint>>` → first video CTR 0 and first audio CTR 0 both `IV=salt XOR 0` + same `sender_key HKDF(epoch,"sframe",S)` → identical tuple `(key_E,S, salt_E, 0, salt_E⊕0)` reused 100% on first frames.
- **v2.1 design:** Single `Map<Epoch,bigint>` shared. All local `RTCRtpSender`s (camera, mic) share same `SFrameTransform` or call `GlobalCounterService.getAndIncrement(epoch)` under `counterMutex`. Sequence is globally monotonic: if camera used `0..99`, next mic frame is `100`, not `0` (§5.2). Receiver `lastCounter[E][S]` is scalar, not per trackId, so `audio CTR1` after `video CTR0` checks `1>0 OK`; duplicate `video CTR0` replay after `audio CTR1` checks `0<=1 ⇒ Replay detected` (cross-track replay caught, §5.3 test 4).
- **Injectivity:** Fix `(epoch E, sender S)`. `sender_key_E,S` constant per HKDF. `salt_E` constant per epoch HKDF. Counters distinct per frame (`0,1,2…`) due to atomic `counter++`. For any two frames `f1,f2` with counters `c1≠c2`, `IV1=salt_E XOR BE64(c1) ≠ salt_E XOR BE64(c2)=IV2` by Lemma 2 (XOR bijection). Thus `(key_E,S, IV)` unique per frame across audio/video interleaving.
- **Mutex dependency:** Without `counterMutex`, two concurrent `TransformStream.transform` calls could `read c` before either `set(c+1)` ⇒ both encrypt with same `c`. Design mandates `withCounterLock` / `AsyncMutex` (§5.2: "must serialize counter++ — either AsyncMutex around getAndIncrement or single shared TransformStream with atomic counter++"). Alternative WASM path needs `SharedArrayBuffer+Atomics`.
- **Gate check required:** `grep -n "encryptCounter"` shows single increment site under lock, not per-track unsynchronized `++`; `TestIVUniquenessAcrossTracks` asserts `counters==[0n..9n]` and `Set<IVHex>.size==10`.
- **Verdict:** **PASS** — reuse eliminated *iff* mutex/atomicity implemented as normative; design provides injective guarantee. Residual risk is implementation race, not design flaw; gate scan mitigates. No counterexample possible under normative mutex.

### Path 2 — `screen share` (`getDisplayMedia` / `setScreenShareEnabled(true)`)

- **Reference:** v2.1 §5.2 row "screen share getDisplayMedia / setScreenShareEnabled" (same counter domain), §10.4 screen share rekey, §6.3 install helper `installSFrameOnSenderShared(screenSender, globalSFrame, mutex)` (§16 I-9), §5.2 mute row (preserve, not clear).
- **v2 defect (same as Path 1):** Separate per-track counter for screen `trackId=S` would start `0` → `IV_screen0 == IV_video0 == IV_audio0`.
- **v2.1 design:** Screen-share `RTCRtpSender` shares **same** `globalSFrame.encryptCounter`. No epoch change on screen share (M0-P0 §4.2). `replaceTrack` keeps counter. First screen frame after camera used `0..199` will be `200`. Same `salt_E`, same `sender_key_E,S`, distinct `counter` ⇒ distinct `IV`.
- **Injectivity:** Same `(E,S)` domain as Path 1; monotonic holds across publishTrack boundary. Two screen frames `c_n, c_{n+1}` distinct; video `c_i` vs screen `c_j` with `i≠j` also distinct because global sequence. Formal same as Path 1 Lemma 2.
- **Mute interaction:** `setMicrophoneEnabled(false)` preserves `encryptCounter` frozen; unmute resumes `+1` (§5.2). Prevents reuse after unmute (if cleared, next unmute frame would reuse old counter). Correct.
- **Verdict:** **PASS**. Counterexample would require separate `Map` per screen trackId — design explicitly forbids (`trackId never part of counter key`, §5.1 rule 2). Wireshark proof §13.4 expects cross-SSRC CTR consecutive per sender including screen SSRC.

### Path 3 — `simulcast layers` (VP9 SVC 3×2: 180p@300k / 360p@800k / 720p@1.8M, LiveKit adaptive)

- **Reference:** v2.1 §5.2 row "video (VP9 SVC) frames" normative note — *one logical counter per sender, not per simulcast layer; if SVC sends 3 layers as 3 encoded frames, they are 3 increments (180p→n, 360p→n+1, 720p→n+2). If single sender with 3 encodings, each encoding is separate EncodedFrame → separate increment. v2.1 mandates per-EncodedFrame increment, not per-track* (§5.2), §6.3 shared pipeline, §13.4 cross-SSRC tshark.
- **v2 defect:** Per-track counter ambiguous for simulcast: each `rid` might be separate trackId → each layer CTR `0` → 3× reuse per timestamp.
- **v2.1 design:** Increment **per `EncodedFrame`** (`TransformStream` sees one `EncodedFrame` per encoding). So timestamp `T` with 3 layers = 3 frames = 3 consecutive counters. If SVC encodes as single frame with spatial layers muxed inside one `data`, still single `EncodedFrame` → single counter → no per-layer split needed (still unique). Design documents both interpretations and mandates per-EncodedFrame.
- **Injectivity:** For fixed `(E,S,salt_E)`, layer frames `L1 c=n, L2 c=n+1, L3 c=n+2` ⇒ `IV_L1=salt⊕BE64(n)`, `IV_L2=salt⊕BE64(n+1)` etc. distinct via bijection. Across senders, keys differ (Lemma 4). Across epochs, salt/key differ (Lemma 3).
- **Concurrency:** 3 encodings may emit concurrently from same `RTCRtpSender`'s `createEncodedStreams` — same mutex `globalCounterMutex` serializes. §5.2 concurrency note applies equally to simulcast as to audio+video.
- **Edge:** If implementation counted per timestamp (not per EncodedFrame) and sent 3 layers as 3 RTP packets derived from same `EncodedFrame`, would they share same IV? Design says no — each encoding is separate `EncodedFrame`, so separate IV. If LiveKit SFU later splits one SFrame ciphertext into 3 RTP packets (unlikely, opaque relay), still same ciphertext/IV per frame — not reuse.
- **Verdict:** **PASS** — normative per-EncodedFrame rule eliminates reuse; cross-SSRC Wireshark `tshark -e sframe.ctr -e rtp.ssrc` showing consecutive CTR across SSRCs for same sender (e.g., video SSRC CTR 0,1,3,5 and audio SSRC 2,4,6) proves global monotonic (§13.4). No counterexample under normative increment.

### Path 4 — `join rotation` (new participant → leader `rotateEpoch('join')`)

- **Reference:** v2.1 §9.1 trigger taxonomy (join), §9.2 rotate-and-broadcast sequence (global reset `encryptCounter.set(newEpoch,0n)` + `decryptCounters.set(newEpoch,new Map())`), §10.1 join mermaid (L→ `rotationMutex.run → waitForHPKEKey(B,1s) → rotateEpoch('join') old→1 → deriveSalt + re-derive senderKeys → encryptCounter[1]=0n`), §5.2 row "join (new participant) → leader rotateEpoch('join')" (reset to 0n for new epoch, old archived, TTL 30s), §8.1/9.5 EpochKeys archived, §12.3 replay now global.
- **Tuple evolution:** Old epoch `E_old` with `epochSecret_old 32B` → `salt_old=HKDF(oldSecret)`, `key_old_S=HKDF(oldSecret,"sframe",S)`, counters `0..k` used. New epoch `E_new=E_old+1` with fresh `epochSecret_new 32B CSPRNG` → `salt_new=HKDF(newSecret)`, `key_new_S=HKDF(newSecret,"sframe",S)`, `counter_new` reset `0n`. Old `EpochKeys` retained in `previousEpochs` (max3, TTL 30s, sweep 10s, `salt.fill(0)` on evict).
- **Uniqueness proof:**
  - Pick `f_old` in `E_old` with `c_old`, `f_new` in `E_new` with `c_new` where `c_new==c_old` (e.g., both `0`) ⇒ `salt_new≠salt_old` with prob `1-2^-96` (96-bit HKDF output collision) AND `key_new_S≠key_old_S` (different `epochSecret`). So `IV_old=salt_old⊕BE64(c_old)` vs `IV_new=salt_new⊕BE64(c_new)` ⇒ `IV_old≠IV_new` w.h.p., plus `(key_old,IV_old)≠(key_new,IV_new)` because keys differ regardless of IV collision. Lemma 3 (§5.4, resolution §6).
  - Within `E_new`, counters restart `0,1,2…` monotonic globally (same as Path 1) ⇒ intra-epoch uniqueness via Lemma 2.
  - Cross-sender within same new epoch: `key_new_Alice≠key_new_Bob` even if same `salt_new` and same `counter 0` → `(key,IV)` not reused (Lemma 4, §5.4). Joiner B's first frames `CTR 0,1…` use same `salt_new` but distinct `key_B` vs leader's `key_L`.
- **Leader serialization:** `rotationMutex` single-flight + debounce 500ms (§9.1, §10.1) ensures only `sorted[0]` (canonical lowest) rotates, epoch increments atomically `old+1`, no fork where two leaders generate same epoch number with different secrets. Metrics `webrtc_rotation_contention_total` records queued rotations.
- **Joiner init:** `B.keyManager.init` local `epoch 0` never sent; upon `DataReceived sframe-welcome` (enc65+ct, `AAD=epoch||roomIdHash||B`), `processWelcome` sets `epochSecret=E_new`, `salt_new`, `encryptCounter[E_new]=0n` (§10.1). So joiner's first audio/video frames distinct counters `0,1…` globally, not colliding with existing participants' `0,1…` because keys differ.
- **Counterexample attempted:** Could joiner encrypt with `E_new` counter `0` while existing member still encrypting buffered old epoch frame `E_old` counter `0` concurrently before commit ACK? No reuse because epochs differ ⇒ keys/salts differ. Even same counter value, tuple differs.
- **Verdict:** **PASS**. No `(key,IV)` reuse across join rotation; reset to `0n` safe due to fresh salt+key.

### Path 5 — `leave rotation` (participant disconnect → leader `rotateEpoch('leave', leavingId)`)

- **Reference:** v2.1 §9.1 leave trigger, §9.2/9.5 same reset `encryptCounter[newEpoch]=0n`, §10.2 leave mermaid (B leader `handleParticipantLeave(canonicalA)→ zeroize senderKeys[A] → rotationMutex.run → rotateEpoch('leave') → deriveSalt → encryptCounter[2]=0n → publish commit {B:ct,C:ct} reliable`, §5.2 row "leave rotateEpoch('leave')" (leaving sender's key zeroized, not carried, decryptCounters[*][A] delete), §12.7 zeroize `epochSecretRaw.fill(0)`+`senderKeys`+`salt.fill(0)`.
- **Same argument as Path 4:** New epoch fresh secret/salt/key ⇒ reset safe. Leaving sender `A` ceases to encrypt after disconnect; its old counters `0..k` in `E_old` not continued in `E_new`. Remaining senders `B,C` restart `0n` with new salt/key ⇒ no overlap with old `(key_old_B, salt_old, c_old)` tuples.
- **Deletion correctness:** `decryptCounters[*].delete(canonicalLeaver)` per sender, not per trackId (§16 I-11). Ensures no stale `lastCounter` for leaver carries into new epoch (irrelevant, they left). Other senders' `lastCounter` for old epoch retained until TTL to allow in-flight old KID frames to pass `counter>last` check; for new epoch, fresh `Map` ensures `counter 0 > -1` accepted.
- **Zeroize:** `senderKeys[A]` zeroized, `epochSecretRaw.fill(0)`, `salt.fill(0)` on TTL or leave (§12.7) — forward secrecy, not reuse-related but ensures old key material not later reused.
- **Concurrent join during leave:** Queued behind `rotationMutex` (§10.2 note); global counter ensures no reuse across queued rotations (same Lemma 3 sequential).
- **Verdict:** **PASS**. No reuse; leaver domain ends, new domain distinct via HKDF.

### Path 6 — `periodic rotation` (300s timer, `KeyManager` timer → `periodic`)

- **Reference:** v2.1 §9.1 periodic trigger (KeyManager timer), §9.2 same reset, §9.5 lifecycle, §5.2 row "periodic rotation (300s)" (same reset to 0n), §20 Step 4 Welcome reliability not needed (no joiner), §13.1 `webrtc_key_rotation_latency_ms_bucket` p95≤500ms includes `mutexWait`.
- **Identical to Paths 4/5** except no participant change, only time-based rekey for forward secrecy. New `epochSecret` 32B CSPRNG → new `salt` 12B HKDF → new `senderKeys` re-derived for self+all canonical (`§9.2 re-derive senderKeys for all remaining`). Counter reset `0n` with new salt/key ⇒ same Lemma 3 guarantee.
- **Timer + mutex:** `rotationMutex.run` ensures periodic rotation not racing with concurrent join/leave trigger; debounce coalesces. If two periodic timers fire (e.g., after reconnect pause), only one acquires mutex.
- **No Welcome:** Only `publishData topic:sframe-commit` to all participants (no filtered exclude). All receivers `processCommit` → `decryptCounters[newEpoch]=new Map()`, `encryptCounter[newEpoch]=0n` for leader and peers.
- **Verdict:** **PASS**. Periodic reset safe for same IV-uniqueness reasons.

### Path 7 — `reconnect` (`RoomEvent.Reconnecting/Reconnected`, WSS/ICE drop, 5s p95)

- **Reference:** v2.1 §5.2 row "reconnect RoomEvent.Reconnecting/Reconnected" (preserve counter — do NOT reset on transient disconnect; `isReconnecting=true` pauses `previousEpochs` sweep but counter stays), §10.3 re-join / token refresh (existing epoch preserved if re-connect within `previousEpochs` TTL, decryptCounters retained, encryptCounter resumes at last value, sync-request/sync-response replay buffered commits), §12.8 ICE/WSS disconnect mid-rotation (buffer via previousEpochs TTL, sweep paused), §13.1 `webrtc_reconnect_latency_ms_bucket` p95≤5s.
- **Critical design choice:** On transient disconnect *within same epoch*, `encryptCounter` **preserved** (not reset) and `decryptCounters` preserved. This is essential: resetting to `0` while same `salt_E`+`key_E,S` still active would immediately reuse `IV=salt_E⊕0` for next frame after reconnect.
- **Proof of uniqueness for reconnect:**
  - *Case 7a — Reconnect < TTL, no rotation while away (≤30s, leader didn't rotate):* Sender S had used counters `0..k` before `Reconnecting`, pauses sweep. On `Reconnected`, next frame uses `k+1`. Same `(salt_E, key_E,S)` + `c=k+1` distinct from all `0..k` ⇒ `IV_{k+1}=salt⊕BE64(k+1)` distinct via Lemma 2. No reuse. Design explicitly forbids `encryptCounter.clear()` on mute/reconnect (§5.2 "Preserve counter" vs I-8/I-9).
  - *Case 7b — Reconnect > sweep window and leader rotated to E_new while away:* Sender offline counters `0..k` in `E_old`. Leader's `rotateEpoch` archived `E_old` with `salt_old` and `decryptCounters[old]` TTL 30s (paused during `Reconnecting`). On `Reconnected`, buffered `sframe-commit` replay via `sync-request/response` delivers new `epochSecret_new` → new `salt_new`+`key_new_S` + `encryptCounter[newEpoch]=0n`. So next frame after reconnect is either still `E_old` if reconnect quick (7a) or `E_new` with fresh salt/key (Lemma 3) ⇒ no reuse. Resolution §10.3 notes "If reconnect exceeds TTL 30s and epoch rotated while away, buffered commits replay → then reset."
  - *Case 7c — Page reload / new Room instance (not transient):* `KeyManager.initialize` fresh `epochSecret` random, `counter 0` — but this is new local epoch `0` never sent pre-Connected; after `Room.connect` + `hpke-pubkey` + leader `Welcome` to `E_current` (e.g., 6), sender switches to `E_current` with `salt_current` distinct. No wire frames ever encrypted with reload-local `epoch 0`, so no reuse on wire. Documented as "fresh domain, no persistence to IndexedDB" (§5.2 reload row).
- **Negative test — what would FAIL:** If `reconnect` incorrectly did `encryptCounter.set(currentKID,0n)` or `new KeyManager` without Welcome, then `IV=salt_E⊕0` would repeat for second connection. Design normatively prohibits; gate must verify no reset on `Reconnecting`.
- **Replay protection preserved:** `decryptCounters` not cleared on reconnect (§5.2 "Preserve decryptCounters (do not clear) to allow replay protection across reconnect gap") — ensures `lastCounter[E][S]` still enforced, preventing old frame replay after gap.
- **Verdict:** **PASS** — under normative preserve rule, no reuse in any reconnect sub-case. Implementation must pass audit: `isReconnecting` pauses sweep, not `encryptCounter` reset.

### Path 8 — `previousEpochs grace` (TTL 30s sweep 10s max 3, retention for in-flight old KID)

- **Reference:** v2.1 §4.2 salt stored per EpochKeys, §5.2 row "previousEpochs TTL eviction (10s sweep, 30s TTL, max 3)" (on eviction delete `encryptCounter[old]` + `decryptCounters.delete(old)` + `zeroizeKey(epochSecret)`+`senderKeys`+`raw.fill(0)`+`salt.fill(0)`), §7.1 receiver `salt = epochKeys.salt (from currentEpoch if kid==currentKID else previousEpochs.get(kid).salt)`, §9.5 lifecycle archive oldEpoch→previousEpochs, §12.7 zeroize, §13.4 Wireshark pcap includes old KID frames during grace, §5.3 `TestPreviousEpochsRetainsSalt` + `TestZeroizeClearsSalt`.
- **Function:** After `rotateEpoch E→E+1`, `previousEpochs` retains `EpochKeys {salt_E, senderKeys_E, epochSecret_E}` to decrypt delayed old KID frames still in SFU or DataChannel. `decryptCounters` retains `lastCounter[E][S]` window until TTL. Encryption never uses old KID after rotation (`currentKID=E+1` atomically, "no frame encrypted with old KID after rotation ack" §9.2).
- **Tuple uniqueness:**
  - *Within grace, old epoch frames:* Sender S old counters `c_old_0..c_old_k` were monotonic pre-rotation via global counter; each `IV_old_c = salt_E_old ⊕ BE64(c)` distinct per Lemma 2 (same salt_old). No new frames use `E_old`, so no additional `c` values contend.
  - *New epoch frames during grace:* `E_new` uses `salt_new`, `key_new_S`, counters `0..m` monotonic. For any `f_old (E_old,c_old)` vs `f_new (E_new,c_new)` even if `c_old==c_new==0`, `salt_new≠salt_old` and `key_new_S≠key_old_S` ⇒ `(key,IV)` distinct (Lemma 3). Different epochs never collide.
  - *Within `E_old`, after TTL expiry:* Salt zeroized (`salt.fill(0)`), `decryptCounters.delete(E_old)` (§5.2, §12.7). Late arrival with `KID=E_old` then throws `No sender key for KID` → `decryptError` expected, triggers `sframe-welcome-request` backoff. Not a reuse event, but decrypt failure. No second encryption with that key exists to reuse against.
  - *Max 3, sweep 10s:* If rapid rotations `E→E+1→E+2→E+3` within <30s, oldest `E` evicted when `size>3` (§5.2). This truncates grace earlier than 30s but still safe: evicted `salt_E` zeroized, so any late `E` frame fails rather than reused. No nonce reuse, only availability hit.
- **Replay during grace:** Receiver checks `counter>lastCounter[E_old][S]` globally (no trackId). So duplicate `E_old` frame with same `c` after it was seen is rejected as `Replay detected`. Per-track old window would have accepted cross-track duplicate; now correctly rejected (§12.3).
- **Entropy not relevant:** Grace retention does not increase reuse probability; it just extends decrypt window. The only risk would be accidentally reusing old `counter` value for new epoch with *same* salt (if `deriveSalt` not re-randomized) — but `deriveSalt` HKDF over fresh `epochSecret` ensures `salt_new` random independent.
- **Verdict:** **PASS**. `previousEpochs` grace preserves decryptability without introducing reuse; TTL+zeroize ensures forward secrecy and prevents indefinite salt reuse.

---

## 4. Synthetic Counterexample Summary (Why Each Would FAIL Without Fix)

| Path | v2 Counterexample (per-track) demonstrating reuse | v2.1 Mitigation |
|------|---------------------------------------------------|-----------------|
| audio+video | `Alice E1: video trackV CTR0 IV=salt⊕0 key=K_A, audio trackA CTR0 IV=salt⊕0 key=K_A` → same `(K_A, IV)` for distinct Opus vs VP9 plaintexts → keystream recovery. `Set<IV>` size 1 not 2. | `CTR 0(video) → CTR1(audio)` global, `IV0≠IV1` |
| screen share | `screen CTR0` after `video CTR0` reuses same `0` → 3-way collision at 0. | `screen CTR2` after `video 0,1` |
| simulcast | `3 layers rid0/r1/r2 each CTR0` → 3 same IVs per timestamp. | Per-EncodedFrame `CTR n,n+1,n+2` |
| join | Without salt/key change, reset to `0` would reuse `IV0` with same key — but v2 already had salt per epoch; still join rotation reset safe only because salt changed. Per-track would still have reuse *within* new epoch across tracks at `0`. | Global 0 in new epoch distinct across tracks |
| leave | Same as join | Same |
| periodic | Same | Same |
| reconnect | If reset to `0` on reconnect within same epoch → `IV0` reuse. | Preserve `k+1` |
| previousEpochs | If old salt retained but new epoch reused same counter with same salt (if salt not re-derived) → `IV0` reuse across epochs. | Fresh HKDF salt per epoch |

All counterexamples require demonstrating `two frames produce same (sender_key, salt, counter, IV)` where `IV=salt XOR BE64(counter)`. v2.1 prevents each.

---

## 5. Formal Injectivity & Mutex Proof (Consolidated)

- **Sender_key distinctness:** `HKDF-SHA256(epoch_secret, salt=0, info="sframe"+canonId)` — `info` domain separation ⇒ `S1≠S2 ⇒ key_{E,S1}≠key_{E,S2}` with overwhelming prob. Same `S` across epochs `E1≠E2` ⇒ different `epoch_secret` ⇒ `key_{E1,S}≠key_{E2,S}`.
- **Salt distinctness:** `HKDF(epoch_secret, info="sframe-salt")` 96-bit ⇒ cross-epoch collision `2^-96`; per epoch constant.
- **Counter monotonicity:** `encryptCounter: Map<Epoch,bigint>` single entry per current epoch, `counter_{next}=counter+1` atomically under `counterMutex` (`Promise` chain or `AsyncMutex` or `Atomics` on `SharedArrayBuffer` for WASM). No other write site (gate `grep encryptCounter` must show single increment).
- **IV injectivity:** Fixed `salt`, `IV(c)=salt XOR BE64(c)`. `BE64` bijective `bigint↔8B BE`. XOR with constant `salt` is bijection (self-inverse). So `c1≠c2 ⇔ IV(c1)≠IV(c2)`. Consequently for fixed `(E,S)`, all frames have distinct `(key_E,S, IV)`.
- **Cross-dimension:** Different `E` ⇒ `salt_E1≠salt_E2` and `key_E1,S≠key_E2,S` ⇒ even if `c1==c2`, `(key,IV)` differ. Different `S` ⇒ `key` differ ⇒ `(key,IV)` differ even if `IV` collides (same `salt`, same `c`).
- **Replay:** `decryptCounters[E][S]` tracks `last=max c seen`. `c<=last ⇒ Replay` — strict monotonic per sender, not per track, catches cross-track replay (correct for GCM strictness; LiveKit preserves order per sender).
- **PreviousEpochs:** TTL 30s sweep 10s max3 preserves `salt_E_old` for decrypt, but no new encryptions use old `E_old`. Eviction zeroizes `salt`+`key` after TTL, preventing later reuse.

**Theorem restated:** No two distinct frames `f1≠f2` share `(sender_key, IV)` if design implemented verbatim. ∎ (resolution §6 Lemmas 1-4, v2.1 §5.4)

---

## 6. Open / Residual Risks (Not Design Flaws, but Gate Must Verify)

1. **Mutex implementation correctness** — Design specifies mutex, but `TransformStream` WebCodecs may invoke `transform(frame, controller)` concurrently on different tracks. If implementer uses per-track `SFrameTransform` instances instead of shared `globalSFrame`, mutex not shared → race → reuse possible. **Gate:** Code scan `grep -rn "encryptCounter"` must show single `Map<Epoch,bigint>` and single `increment` site wrapped in `withCounterLock`/`AsyncMutex`/`Atomics`. Tests `TestIVUniquenessAcrossTracks` must run with real concurrency (Promise.all 10 interleaved).

2. **WASM 150KB worker fallback** — JS `Map`+`Promise` mutex not shareable with `wasm-sframe` worker. v2.1 §4.3, §5.4, §11, §21 Q7 note: WASM multi-track must use `SharedArrayBuffer` + `Atomics.add` or main-thread counter handoff; if `crossOriginIsolated` false (no SAB), must gate as `DTLS-only` for multi-track and document `WASM global-counter limited` in `browser-matrix.html`. Firefox 128-131 WASM-primary is therefore single-track safe but multi-track degraded — honest downgrade acceptable per M0-P0 §4.2.

3. **Strict replay vs reordering** — Global strict `>` means network reordering within sender's sequence (e.g., audio `CTR5` arrives before video `CTR4`) will cause `CTR4` rejected as `4<=5 Replay`. This is correct GCM strictness but may cause audio/video glitch if SFU or transport reorders. Design notes SFU preserves order per sender (LiveKit blind-forward preserves publish order per participant). If observed, future patch could relax to sliding window without changing counter ownership (§5.4 residual risks). Not a nonce reuse issue.

4. **No persistence to storage** — Counters in-memory only; reload fresh epoch via Welcome. Verified via `grep -rn "IndexedDB|sessionStorage|localStorage" src/sframe` clean for counters (only optional non-extractable keys may use IndexedDB, not counters).

5. **Metrics label cardinality** — v2.1 §13.1 removes `mediaType` from `frames_encrypted_total/frames_decrypted_total` to avoid implying per-track. Must verify `MetricsCollector` patched, not counting per media.

All risks are explicitly documented in v2.1 §§5.2, 5.4, 11, 21 — no hidden spec gaps.

---

## 7. Overall B-06 Resolution Verdict

| Criterion | Verdict |
|-----------|---------|
| **8 paths analyzed with explicit tuple `(sender_key, salt, counter, IV)` uniqueness reasoning** | ✅ All 8: audio+video **PASS**, screen share **PASS**, simulcast **PASS**, join **PASS**, leave **PASS**, periodic **PASS**, reconnect **PASS**, previousEpochs grace **PASS** |
| **HKDF sender_key + salt HKDF + global Map<epoch,bigint> + IV XOR BE64 injective + mutex + previousEpochs TTL referenced per path** | ✅ Each path reasoning cites `HKDF("sframe"+canonId)` vs `HKDF("sframe-salt")`, `Map<epoch,bigint>` global, `IV=salt XOR BE64(counter)` bijection, `counterMutex`/`SharedArrayBuffer`, `Map<epoch,Map<sender,bigint>>` + TTL 30s/10s/max3 |
| **Counterexample provided if FAIL** | ✅ N/A — no FAIL; v2 counterexamples tabulated for contrast |
| **File references with section numbers** | ✅ Table §1 traceability, per-path § anchors |
| **BLOCK CONDITION (missing normative section)** | ✅ **NOT BLOCKED** — all normative sections present |
| **Overall B-06 resolved?** | **YES — RESOLVED (design-level).** Global sender counter eliminates per-track AES-GCM nonce reuse for all 8 flows *under normative mutex* and fresh HKDF salt/key per epoch. Catastrophic reuse vector (same `(sender_key, IV)` at CTR 0 across tracks) is provably eliminated (Lemmas 1-4, Theorem §5.4). |

**Condition for GREEN:** Implementation must pass **code + test + Wireshark gates** before YELLOW→GREEN:

- `src/sframe/transform.ts` scan: single `encryptCounter: Map<number,bigint>` (not `Map<number,Map<string,bigint>>`), single `increment` under `AsyncMutex`/`withCounterLock`/`Atomics`, `decryptCounters: Map<number,Map<string,bigint>>` no `trackId`/`mediaType`.
- `vitest` gate-blocking: `TestIVUniquenessAcrossTracks` (4 sub-tests) + `TestDeriveIVDeterministic` + `TestSaltUniquenessPerEpoch` + `TestPreviousEpochsRetainsSalt` + `TestZeroizeClearsSalt` PASS, artifact `qa/reports/sframe-global-counter-test-output.txt`.
- Wireshark `meet-secure-p0_default` bridge `tshark -e sframe.kid -e sframe.ctr -e rtp.ssrc` showing per-sender CTR consecutive across SSRCs (not per-SSRC restart at 0), entropy >7.5, artifact `qa/reports/wireshark-livekit-sframe.pcapng` + `tshark-sframe-output.txt` (§13.4).
- WASM multi-track: if `SharedArrayBuffer` unavailable, `browser-matrix.html` flags `WASM global-counter limited` → DTLS-only honest fallback (§11, Q7).

No further design revision required for B-06. Ready for @security STRIDE T-01 re-review.

---

## 8. Recommendations

1. **Gate scan script:** Add `scripts/verify-sframe-global-counter.sh` (`grep -n "encryptCounter"` + `grep -n "counterMutex\|AsyncMutex\|Atomics"` + `grep -n "trackId" src/sframe/transform.ts` must fail) to CI `p0-gate-verify`.
2. **Test harness ordering:** `TestIVUniquenessAcrossTracks` should use `Promise.all` parallel encrypts on 3 tracks to stress mutex race; assert `counters 0..N-1` not length-N set with duplicates.
3. **Mute/reconnect audit:** Add unit `TestMutePreservesCounter` and `TestReconnectPreservesCounter` (simulate `setMicrophoneEnabled(false/true)` and `RoomEvent.Reconnecting` still `counter==k`).
4. **WASM decision by Step 0:** Probe `crossOriginIsolated && SharedArrayBuffer` in `vite.config.ts` COOP/COEP; decide WASM SAB path or DTLS-only before browser matrix (§20 Step 0/5).
5. **Documentation sync:** Update `docs/architecture-brief.md` §11.1 gate and `docs/qa/m0-p0-test-plan.md` to reference `TestIVUniquenessAcrossTracks` as blocking; keep `ADR-002-sframe.md` pivot honest.

---

*End of verification — @architect 2026-09-05. Design-only; no code modified. Requires @security sign-off on T-01 and @qa `p0-gate-verify` before implementation.*
