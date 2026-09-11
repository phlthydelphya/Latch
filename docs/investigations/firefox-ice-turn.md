# Firefox ICE/TURN Race — Active Investigation

**Status:** ACTIVE-INVESTIGATING
**Opened:** 2026-09-11
**Owner:** @webrtc + @qa
**Related Sprint:** `docs/reports/media-proof-sprint.md` (MP-08)
**Related Artifacts:** `qa/artifacts/playwright/MP-08-*.trace.zip` (pending), `qa/artifacts/pcaps/MP-08-*.pcapng` (pending)

---

## Problem Statement

Firefox 129+ exhibits non-deterministic ICE candidate gathering order when TURN is configured alongside STUN. In ~30% of connection attempts, Firefox selects a **host/reflexive candidate pair** over the **relay candidate** even when `iceTransportPolicy: "relay"` is set, causing media to bypass TURN and fail the relay-only verification gate.

This blocks:
- MP-04 TURN relay proof (Firefox column)
- MP-05 Reconnect latency histogram (Firefox column)
- MP-07/MP-08 Cross-browser matrix completion

---

## Environment

| Component | Version |
|-----------|---------|
| Firefox | 129.0+ (tested 129.0, 130.0b) |
| OS | Windows 11, Ubuntu 24.04, macOS 15 |
| coturn | 4.6.2 (HMAC-SHA256, TTL 24h) |
| LiveKit Client SDK | 1.13.6 |
| `iceTransportPolicy` | `"relay"` (explicit) |
| `iceServers` | `[{ urls: "turn:...", username, credential }, { urls: "stun:..." }]` |

---

## Observed Behavior

### Expected (Chrome/Safari)
1. `iceTransportPolicy: "relay"` → only `relay` candidates gathered
2. Single candidate pair: `relay` ↔ `relay`
3. `candidateType=relay` in `chrome://webrtc-internals` / `about:webrtc`
4. Media flows exclusively via TURN (verified by pcap)

### Actual (Firefox)
1. `iceTransportPolicy: "relay"` set → **host + srflx + relay candidates all gathered**
2. Multiple candidate pairs generated
3. **Nomination sometimes picks host/srflx pair** despite policy
4. Media flows direct (bypassing TURN) → pcap shows non-relay path
5. `about:webrtc` shows `candidateType=host` or `srflx` as **selected pair**

---

## Reproduction Steps

```javascript
// Minimal repro in browser console
const pc = new RTCPeerConnection({
  iceTransportPolicy: "relay",
  iceServers: [
    { urls: "turn:turn.example.com:3478?transport=udp", username: "...", credential: "..." },
    { urls: "stun:stun.example.com:3478" }
  ]
});
pc.createDataChannel("test");
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
// Observe pc.localDescription.sdp — contains host/srflx candidates despite "relay" policy
```

```bash
# Force UDP 3478 drop (simulate TURN-only network)
iptables -A OUTPUT -p udp --dport 3478 -j DROP
# Firefox still connects via host/srflx → proves policy not enforced
```

---

## Workarounds Attempted

| Attempt | Result |
|---------|--------|
| Remove STUN from `iceServers` | ✅ Works — only relay candidates gathered. But breaks ICE restart on TURN failure. |
| `iceCandidatePoolSize: 0` | ❌ No effect |
| Filter candidates in `onicecandidate` handler | ⚠️ Partial — Firefox still nominates host pair before filter runs |
| `RTCIceTransport.setRemoteCandidates([])` | ❌ Not implemented in Firefox |

---

## Hypotheses

1. **Firefox bug:** `iceTransportPolicy: "relay"` does not filter local candidate gathering (only remote). Spec says "The ICE agent MUST only use relay candidates" — Firefox may interpret as "prefer relay" not "only relay".
2. **STUN contamination:** Presence of STUN server in `iceServers` triggers host/srflx gathering regardless of policy.
3. **Nomination race:** Firefox nominates first working pair; host/srflx RTT < TURN RTT → wins nomination before relay pair ready.

---

## Next Steps

1. **Capture pcap** — `qa/artifacts/pcaps/MP-08-<date>-<sha>.pcapng` with `tshark -i any -f "udp port 3478"` during Firefox connection
2. **Capture trace** — `qa/artifacts/playwright/MP-08-<date>-<sha>-firefox.trace.zip` with `about:webrtc` export
3. **Test Firefox Nightly** — Check if fixed in 131+
4. **File upstream bug** — If confirmed spec violation, report to Bugzilla
5. **Decision point:** If unfixed, document as **known limitation** — Firefox cannot guarantee TURN-only path with STUN present. Mitigation: separate TURN-only `iceServers` config for relay-forced mode.

---

## Evidence Links (TBD)

| Artifact | Location | Status |
|----------|----------|--------|
| PCAP capture | `qa/artifacts/pcaps/MP-08-*.pcapng` | 🟡 Pending |
| Playwright trace | `qa/artifacts/playwright/MP-08-*.trace.zip` | 🟡 Pending |
| `about:webrtc` export | `qa/artifacts/logs/MP-08-*-webrtc-dump.json` | 🟡 Pending |
| Bugzilla link | — | ⏳ After confirmation |

---

## Cross-References

- Sprint plan: `docs/reports/media-proof-sprint.md` (MP-08)
- Playwright artifacts: `qa/artifacts/playwright/README.md`
- PCAP artifacts: `qa/artifacts/pcaps/README.md`
- TURN validation report: `qa/reports/turn-validation.json`
- Reconnect latency: `qa/reports/reconnect-latency.json`
- Browser matrix: `qa/reports/browser-matrix.html`