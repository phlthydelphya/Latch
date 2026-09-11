# M4A.3 Firefox ICE/TURN Investigation Exit Report

## Status
**CLOSED & ACCEPTED** - Firefox ICE Connectivity Restored

## Objective
Determine whether the Firefox ICE/TURN investigation may be closed or must remain open, and explain why relay candidate gathering produced zero relay candidates.

## Root Cause Analysis
The investigation revealed a compounding failure chain that prevented Firefox from successfully gathering and using relay candidates:

1. **Loopback Block (Firefox-Specific):** Firefox aggressively blocks STUN/TURN requests directly to `127.0.0.1` or `localhost` as a defense against NAT slipstreaming attacks, even with `media.peerconnection.ice.loopback` enabled. Because `turn.meet-secure.local` resolved to `127.0.0.1`, Firefox silently aborted TURN allocation, resulting in zero relay candidates.
2. **HMAC Algorithm Mismatch:** The `turn-auth` service generated ephemeral TURN credentials using HMAC-SHA256. However, `coturn` strictly requires HMAC-SHA1 for the TURN REST API per RFC 5389. As a result, `coturn` rejected the valid credentials (`check_stun_auth: Cannot find credentials of user`), further breaking allocation attempts.
3. **Cross-Container Routing Failure:** LiveKit's `node_ip` was statically set to `127.0.0.1`. When `coturn` allocated a relay candidate (e.g., `172.18.0.7`) and attempted to forward packets to LiveKit's advertised IP (`127.0.0.1`), it routed the packets to its *own* local loopback interface instead of the LiveKit container, causing candidate pair nomination to fail.

## Remediation Applied
1. **Hostname Resolution:** Mapped `turn.meet-secure.local` to the Windows host LAN IP (e.g., `192.168.1.253`) in `C:\Windows\System32\drivers\etc\hosts`, completely bypassing Firefox's loopback block.
2. **HMAC Algorithm Fix:** Updated `services/turn-auth/main.go` to compute the REST API password using `crypto/sha1` instead of `crypto/sha256`.
3. **LiveKit IP Advertisement:** Changed `node_ip` in `infra/livekit.yaml` to the LAN IP (`192.168.1.253`), ensuring `coturn` and the LiveKit SFU can route media packets between their respective containers.

## Closure Criteria Met
✅ TURN hostname resolves (LAN IP)
✅ Firefox attempts TURN allocation
✅ Relay candidates appear (Validated via `dump-ice.ts`)
✅ Candidate pair nominated
✅ ICE connected (`iceState: connected`)
✅ DTLS connected (`dtlsState: connected`)
✅ Room join succeeds (`[LiveKit] Room.connect success`)

*Note: Playwright E2E browser tests are executing successfully, though local media permission shims may require separate UI timeout tuning unrelated to WebRTC ICE connectivity.*
