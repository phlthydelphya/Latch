# ADR-006 — Invitation Link Bearer Credential & Key-in-URL Security Model

**Status:** `ACCEPTED — TECHNICAL REVIEW` | **Date:** 2026-08-25 (corrected review date; was 2026-09-06 prospective/target — see ADR-007 §1) | **Author:** @architect + @security | **Milestone:** M4A.1  
**Refs:** `docs/M4A-authoritative-session-control.md`, `docs/architecture-brief.md` §3/8, RFC 9605 (SFrame), RFC 3986 (URI Generic Syntax)

> **Date correction (ADR-007 §1):** System date at review is **2026-08-25**. The date 2026-09-06 cited in prior drafts is a prospective/target date and must not be cited as verified Git history. This ADR records technical-review acceptance of the invitation-link bearer model; it does **not** constitute M4A.1 milestone closure or tag `m4a.1-accepted` (see ADR-007 §2).

---

## Context

In Milestone M4A.1, shareable meeting links and client-side vector QR codes are introduced to provide touchless meeting discovery and mobile onboarding.

To preserve end-to-end encryption (E2EE) under SFrame without server knowledge, the meeting decryption key parameter is embedded in the URL fragment:
```text
https://app.example.com/r/abc12345#k=0123456789abcdef...
```

Per RFC 3986 §3.5, URI fragments (`#...`) are processed exclusively client-side and are **never transmitted in HTTP requests to web servers or signaling infrastructure**.

However, possessing the invitation URL with the key fragment presents a fundamental security consideration:
```text
Invitation URL Possession == Meeting Media Decryption Capability
```

This ADR formalizes the security model, evaluates threat vectors, and defines architectural mitigations.

---

## Decision

**Accepted: Model A — Bearer Invitation Credential with Dual-Layer Host Admission Enforcement.**

1. **Bearer Decryption Credential in URL Fragment**:
   - The `#k=` parameter carries the 256-bit initial SFrame epoch key seed.
   - Anyone in possession of the full invitation URL has the cryptographic capability to decrypt the media stream for that meeting session.

2. **Decoupled Admission Authority (Defense-in-Depth)**:
   - Possession of `#k=` **does not grant automatic meeting entry**.
   - Media transport is gated behind signaling authentication (`POST /token`) and server-governed waiting room admission.
   - Under M4A, `isWaitingRoomEnabled = true` by default. Guests arriving via invitation links or QR codes are held in the lobby until the server-certified host explicitly executes `waiting-room-admit`.
   - The SFU blind-forwards ciphertext only to admitted WebRTC peers (`LIVEKIT_E2EE_MODE=blind`).

3. **Threat Surface & Mitigations**:

| Threat Vector | Risk Level | Architectural Mitigation |
| :--- | :--- | :--- |
| **Server Interception** | `NONE` | RFC 3986 fragments are never sent over HTTP/WSS. Signaling and SFU logs never contain `#k=`. |
| **Clipboard Snooping** | `MEDIUM` | In-memory clipboard write only on explicit user click ("Copy Link"). |
| **Browser History Leak** | `LOW` | Modern browsers do not leak fragments across cross-origin requests; PreJoinPage cleans internal routing states. |
| **Link Forwarding to Impostor** | `MEDIUM` | Host-controlled Waiting Room: unadmitted attendees cannot receive media from the SFU. |
| **Post-Meeting Decryption** | `NONE` | Ephemeral keys: SFrame rotates key epochs upon participant departure (forward/backward secrecy). |

4. **Permanent Product Invariant Compliance**:
   - Zero user tracking: Invitation links and QR payloads contain strictly `https://<domain>/r/<roomId>#k=<key>` with **no analytics, no UTM parameters, and no tracking identifiers**.

---

## Alternatives Considered

- **Model B: Out-of-Band Key Exchange / User Accounts**:
  - Requiring participants to authenticate with identity providers or exchange public keys out-of-band prior to link generation.
  - *Rejected:* Violates product requirements for frictionless, zero-registration, ephemeral meetings.

- **Model C: Server-Brokered Key Distribution (KMS)**:
  - Storing room keys on the server and issuing them upon admission.
  - *Rejected:* Violates core E2EE invariants. The server must remain blind to media keys at all times.

---

## Consequences

- **Documentation**: All user-facing invite dialogs must explicitly display the E2EE privacy shield badge explaining that keys reside exclusively in the link fragment.
- **Frontend**: `roomUrl.ts` must generate canonical URLs without query telemetry.
- **Security & QA**: Automated tests must verify that `#k=` is never dispatched in HTTP request paths or bodies.
