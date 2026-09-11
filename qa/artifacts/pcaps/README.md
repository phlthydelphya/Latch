# PCAP Artifacts — Manifest

Packet captures (pcapng) from media-path verification. Each file is a raw `tshark`/`tcpdump`/`Wireshark` capture — write-once, immutable.

## Manifest

| File | Test ID | Date | Git SHA | Operator | Environment | Verification Command | Expected Result |
|------|---------|------|---------|----------|-------------|---------------------|-----------------|
| *none yet* | — | — | — | — | — | — | — |

## Planned Captures (per `docs/reports/media-proof-sprint.md`)

| Test ID | Scenario | Target File | Filter |
|---------|----------|-------------|--------|
| MP-03 | Blind SFU — ciphertext only on wire | `MP-03-<date>-<sha>.pcapng` | `rtp && sframe` → **zero plaintext NAL units** |
| MP-04 | TURN relay forced path | `MP-04-<date>-<sha>.pcapng` | `stun || turn` → `candidateType=relay` visible in ICE |
| MP-09 (new) | 20p TURN relay soak | `MP-09-<date>-<sha>.pcapng` | Sustained relay, no media bypass |

## Verification Commands

```bash
# MP-03: Confirm zero plaintext H.264/VP8/VP9 NALs in SFrame payloads
tshark -r MP-03-*.pcapng -Y "rtp && sframe" -T fields -e rtp.payload | xxd -r -p | grep -c "00 00 00 01"  # Should be 0

# MP-04: Confirm TURN allocation + relay candidates
tshark -r MP-04-*.pcapng -Y "stun.type.method == 0x0003" -T fields -e stun.attr.xor_relayed_address
```

## Historical Reference

Legacy capture (pre-manifest): `qa/reports/wireshark-livekit-sframe.pcapng` (24 KB, 2026-09-04) + `.bak-2026-09-01` (420 B). Preserved per `docs/reports/media-proof-sprint.md` MEDIUM-01 resolution. **Do not move.** New captures go here.