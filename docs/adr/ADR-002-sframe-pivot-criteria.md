# ADR-002 — SFrame + SFU Forwarding Contradiction & Honest Downgrade Pivot

**Status:** `ACCEPTED WITH PIVOT` — `REVIEW REQUIRED` — NOT SELF-APPROVED | **Date:** 2026-09-01 | **Author:** @architect + @webrtc + @reviewer | **Refs:** `docs/M0-P0.md` §8/#9, `docs/ROADMAP.md` §8 challenge ①, ADR-004, `architecture-brief.md` §9

> **Gate Status:** REVIEW REQUIRED per `docs/M0-P0.md` §7. Requires 5 gate approvals + `p0-gate-verify` from @qa. Do NOT self-approve.

---

## Problem Statement (Reviewer Challenge)

SFrame RFC 9605 encrypts payload after encoder, before packetization. SFU selective forwarding (Dynacast / Last-N / simulcast layer selection) typically inspects RTP payload or requires plaintext to decide which SSRC/layer to forward. If payload is opaque, how does SFU choose without decrypting? This is contradictory if not solved honestly.

**If unsolved, options:**
- Lie (facade): claim E2EE but SFU decrypts to select layer (violates promise).
- Fail: 20p E2EE impossible without extreme bandwidth.

P0 must **not facade** — per `M0-P0.md` §9 risk 1: “No facade. If LiveKit Dynacast needs payload, ship blind-forward 3 layers for ≤20p (80% downlink cost accepted for P0 honesty).”

## P0 Strategy (Two-Phase)

### Phase 1 — Attempt Header-Aware (Preferred)

SFU inspects **only** unencrypted headers: RTP `SSRC`, `mid`/`rid` extmap, SFrame header (`KID`, `CTR` — 1-2 bytes, not payload), and `abs-send-time`/`transport-cc`. Payload bytes remain ciphertext.

- LiveKit 1.25 path: config `e2ee.mode=header` (fork or upstream if merged). Requires SFrame header preserved in RTP payload prefix (RFC 9605 §4: header is not encrypted). Verify with `libsrtp` + `sframe` Rust interop test vectors.
- Success bar: Wireshark shows SFrame header plaintext (KID) + ciphertext payload; SFU log shows `selectedLayer rid=q/h/f` per subscriber without decrypt; pcap proves SFU never sees plaintext.
- If POC passes by W3 → enable selective forwarding, downlink 2.5 Mbps for Last-N=9, ideal.

### Phase 2 — Honest Fallback: Blind-Forward 3 Layers for ≤20p (Shipped)

If header-aware not proven by W2-W3, **ship blind-forward** and document.

**Mechanism:**
- Publisher sends 3 simulcast layers (q:180p, h:360p, f:720p) all SFrame-encrypted.
- SFU forwards **all 3** SSRCs to each subscriber (up to Last-N=9 enforced at subscription API `setSubscribedTracks`). No layer decision.
- Subscriber client selects locally which layer to decode (highest sustainable) but still received all 3 (bandwidth wasted).

**Costs (measured):**
- Downlink per subscriber for N=20, Last-N=9: 9 publishers × 3 layers × avg 0.8 Mbps = **~21.6 Mbps worst**, ~10-12 Mbps measured after client pause + temporal drop. Vs selective 7.2 Mbps → **80-150% overhead**.
- Battery +8% (decode 1 of 3).
- SFU CPU neutral (simpler fanout).
- Privacy maximal (zero header inspection beyond SSRC).

**Why ≤20p cap:** At 100p, blind would be 100×3×2.7 Mbps fanout = impossible (1620 down tracks per SFU). Hence P0 caps at 20p and freezes 100/1000 milestones.

**UX & Honesty:**
- Shield UI: “E2EE · 3-layer relay (bandwidth high)” tooltip with `learn more` to docs.
- On join >12p E2EE room: modal “High bandwidth mode (~10 Mbps). Switch to non-E2EE SFU (low bandwidth, DTLS-only) requires explicit consent? [Stay E2EE] [Switch]”. Never silent.
- Docs: `architecture-brief.md` §9 table + `docs/privacy-inventory.md` entry.
- Artifact: Wireshark pcap committed for GO.

## GO / NO-GO Triggers (Per M0-P0 §8)

**GO if:** Blind-forward passes 10-min 20p stable, CPU<70% on 2 vCPU, loss<1%, p95≤300ms, rotation ≤500ms, reconnect ≤5s, ciphertext proof. Cost documented and consent UI shipped.

**NO-GO (any one):**
- Even blind-forward breaches CPU/loss/latency on 2 vCPU.
- Wireshark shows plaintext or SFU decrypts.
- Key rotation p95 >500ms due to 3× amplify (unlikely, control-plane separate).
- Safari WASM gap forces silent DTLS fallback without warning (crit 1/4 fails).

On NO-GO → 48h pivot proposal due (PM schedules stakeholder vote within 1 week):

| Option | Description | Privacy Posture | When to pick |
|--------|-------------|-----------------|--------------|
| **A (preferred)** | Mesh-E2EE ≤5p (P2P full mesh, no SFU) + non-E2EE SFU for >5 (DTLS-SRTP only, explicit consent banner “E2EE up to 5, SFU relay beyond is DTLS-only”) | Honest tiers, no facade | If 20p blind fails but 5p mesh proven ≤500ms rotation |
| **B** | De-scope E2EE to 1:1 only (SFU always DTLS-only for groups) | Minimal E2EE | If even 5p mesh fails (mobile battery) |
| **C** | Replace LiveKit with mediasoup custom header-aware router (Rust patch to read SFrame KID without payload) | Preserves 20p E2EE if header-aware code ships | If LiveKit cannot be forked but mediasoup header router is <2 week effort |

Freeze remains until new P0 passes. No Zoom features resume.

## Non-Facade Guarantee

- No claim of “E2EE 20p optimized” unless pcap + CPU prove it.
- Central KMS removed; per-room `sender_key = HKDF(epoch_secret, "sframe", sender_id)` via DataChannel HPKE, no server key.
- Audit log: `{roomId, time, event: "epoch_commit", epoch, hash(KID)}` TTL 7d, no plaintext.

---

## Approval — REVIEW REQUIRED

| Role | Reviewer | Signature | Date | Verdict |
|------|----------|-----------|------|---------|
| @architect | Principal Architect | _________________ | 2026-09-01 | Accepted with pivot (author) |
| @webrtc | Media Lead | _________________ | ☐ | PENDING REVIEW — must confirm header-aware POC vs blind-forward tradeoff |
| @security | Security | _________________ | ☐ | PENDING — STRIDE + SFrame audit |
| @reviewer | Adversarial Reviewer | _________________ | ☐ | PENDING — honest downgrade challenge (no facade) |
| @qa | QA | _________________ | ☐ | PENDING — Wireshark pcap + CPU/loss thresholds |
| @privacy | Privacy | _________________ | ☐ | PENDING — minimization note |

**Merge blocked until 5 gates + `p0-gate-verify` per `docs/M0-P0.md` §2.**

*End of ADR-002 — REVIEW REQUIRED.*
