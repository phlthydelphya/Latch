# Task: M0-P0 Media Validation & Wireshark Capture

## Delegation
- **Primary:** @webrtc
- **Dependencies:** @qa (for load test timing), @backend (for SFU health)
- **Reviews required:** @security (SFrame ciphertext, key rotation, TURN), @qa (browser matrix, screen share)

## Context
All 11 infra services healthy. LiveKit 1.25 running with `LIVEKIT_E2EE_MODE=blind` via compose env. Compose bridge network: `meet-secure-p0_default` (172.18.0.0/16).

## Mission
Execute Criteria 1,2,4,5,6,7,8 validation and produce deliverables.

## Required Actions

### 1. Wireshark Capture on Compose Bridge (CRITICAL)
```bash
docker run --rm --network meet-secure-p0_default \
  -v C:/Users/joshu/meet-secure-core/qa/reports:/capture \
  corfr/tcpdump:latest \
  -i any -s 0 -w /capture/wireshark-livekit-sframe.pcapng \
  "port 7880 or port 7881 or port 3478 or port 5349 or port 443"
```
Run in background, generate traffic, then stop.

### 2. Generate Real Traffic via Load Harness
```bash
cd C:/Users/joshu/meet-secure-core/poc/meet-webrtc-core
npm run load -- --rooms 1 --participants 20 --duration 120
```
Coordinate with @qa — run load test simultaneously.

### 3. Validate SFrame Ciphertext in Capture
```bash
docker run --rm -v C:/Users/joshu/meet-secure-core/qa/reports:/capture \
  corfr/tcpdump:latest \
  tshark -r /capture/wireshark-livekit-sframe.pcapng \
  -Y "rtp && sframe" -T fields -e frame.number -e rtp.ssrc -e sframe.kid -e sframe.ctr
```
Verify: packets > 0, duration > 10s, SRTP/SFrame ciphertext opaque, no plaintext NALs.

### 4. Key Rotation Latency (Criterion 6)
```bash
npm run load -- --rooms 1 --participants 20 --duration 60 --key-rotation-interval 30
```
Target: p50 ≤300ms, p95 ≤500ms. Output to `qa/reports/key-rotation-latency.json`

### 5. Reconnect Latency (Criterion 7)
10 trials/browser (Chrome, Edge, Firefox, Safari):
- Kill WSS + `tc qdisc add dev eth0 root netem loss 100%` for 3s
- ICE restart with session-update, epoch preserved, Redis buffer 30s replay
- Target: p95 ≤5s. Output to `qa/reports/reconnect-latency.json`

### 6. Screen Share Validation (Criterion 5)
Verify `getDisplayMedia` creates separate TrackPublished, same epoch, dynamic switch works on Safari/iOS.

### 7. TURN Chain Validation (Criterion 8)
Force relay: `iceTransportPolicy: relay`
- Verify `candidateType=relay` in `chrome://webrtc-internals`
- Chain: STUN 3478 UDP → TURN 3478 UDP → TURN 443 TCP → TURNS 443 TLS

### 8. Update POC if Needed
Check `poc/meet-webrtc-core/src/index.ts` for:
- Encoded Transform primary + wasm-sframe 150KB Worker fallback
- OffscreenCanvas + VideoFrame recycle for Safari 17.4
- HKDF epoch_secret → sender_key
- HPKE via DataChannel Commit + signaling Welcome
- Explicit ⚠️ warning if SFrame unavailable (no silent downgrade)

## Deliverables
1. `qa/reports/wireshark-livekit-sframe.pcapng` (valid capture, packets>0, duration>10s)
2. tshark output showing ciphertext, no plaintext NAL
3. `qa/reports/key-rotation-latency.json` (p50/p95)
4. `qa/reports/reconnect-latency.json` (p50/p95 per browser)
5. Updated POC code if fixes needed

## Gate Handoff
After completion, the PM will route deliverables to:
- @security for SFrame ciphertext proof, key rotation, TURN audit
- @qa for browser matrix validation, screen share verification
- @reviewer for adversarial challenge of E2EE claims