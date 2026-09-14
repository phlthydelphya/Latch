# Latch V1 Scope

**Status:** Scope authority; release evidence is still required
**Product:** Latch (repository and service namespaces remain `meet-*`)
**Related architecture:** [`docs/architecture-brief.md`](../architecture-brief.md) · ADR-002 · ADR-006 · ADR-007
**Positioning:** [`latch-positioning.md`](latch-positioning.md)

## Purpose

This document defines the intended Latch V1 product boundary. The checklist below is an **evidence requirement for release review**, not a claim that every item has passed. A release decision must cite reproducible evidence and the applicable security, privacy, QA, and adversarial reviews.

For the phased verification process, evidence rules, and release-candidate exit conditions, see [`V1 Release Gates`](v1-release-gates.md). The gate plan is also an evidence requirement, not a claim that any gate has passed.

## Six product principles

1. **No AI features.** Latch includes no AI summaries, transcripts, assistants, bots, attention/gaze tracking, or other AI features.
2. **No telemetry of meeting content.** Operational health metrics and narrowly scoped service logs may exist when privacy-safe, but meeting-content telemetry, usage or engagement analytics, and behavioral telemetry are not permitted.
3. **No cloud recording.** Latch does not provide cloud recording, server-side archiving, or cloud transcription.
4. **No server access to meeting content.** Servers do not access plaintext media or encryption keys. Media forwarding, signaling, and TURN may handle encrypted traffic and necessary operational metadata, but not decrypted meeting content.
5. **Encryption is not optional.** Supported media paths must be encrypted. If a supported path cannot provide the intended encryption, the product must block, clearly warn, or use an explicitly labeled fallback; it must never silently downgrade. SFrame and its SFU trade-offs remain governed by ADR-002, including its pivot criteria.
6. **User-controlled devices and permissions.** Users control browser and operating-system permissions for camera, microphone, and screen sharing, and choose their input/output devices. Permission denial, device changes, and unavailable devices must be handled visibly and safely.

## Product trust boundary

Room trust is explicit: the server-authoritative host/co-host model governs moderation, and admission is controlled through invitations, the waiting room, and explicit host decisions. These controls establish who may participate or moderate; they do not grant the server access to plaintext meeting content.

## V1 feature scope

V1 includes the following product capabilities, subject to the evidence checklist:

- Invite links, with the invitation-key handling and bearer-credential caveats in ADR-006.
- Waiting room and explicit admission/rejection flow.
- Server-authoritative host controls and co-host support.
- Camera, microphone, and screen sharing with explicit permissions and device selection/switching.
- Gallery, speaker, multi-pin, and screen-share layouts.
- Reconnect and session resume behavior, including clear encryption-state handling.
- Responsive mobile web experience.
- Installable PWA experience.
- Security controls covering authentication/authorization, encrypted media, key handling, privacy-safe logging, abuse-resistant room access, and explicit fallback states.

## Release evidence checklist

Each item is a **release evidence requirement**, not a current-pass assertion. Evidence should identify the test or review, environment, result, and artifact location.

- [ ] Invite link works, preserves the ADR-006 fragment/bearer boundary, and does not expose the invitation key to servers or analytics.
- [ ] Waiting room admits and rejects participants correctly, including refresh, reconnect, and denied-admission paths.
- [ ] Host and co-host controls are server-authoritative, authenticated, authorized, and auditable without recording meeting content.
- [ ] Camera, microphone, and screen share work across the supported browser/mobile matrix; permission denial is explicit and recoverable.
- [ ] Users can select and switch audio/video devices without unintended publication or permission escalation.
- [ ] Gallery, speaker, multi-pin, and screen-share layouts are verified at the supported participant and stream limits.
- [ ] Reconnect and session resume recover within the stated target, preserve authorization boundaries, and correctly preserve or renegotiate encryption state.
- [ ] Mobile browser behavior is verified for supported platforms, including lifecycle, permissions, screen sharing where the platform permits it, and reconnect.
- [ ] PWA installation, launch, update, and offline-shell behavior are verified without weakening security policy.
- [ ] Security controls are reviewed: no AI features; no meeting-content telemetry; no cloud recording; no server access to plaintext media or encryption keys; mandatory encryption on supported paths; explicit, user-visible fallback; secure invite and room authorization; privacy-safe operational metrics/logs.

## Explicit exclusions and caveats

The permanent product exclusions remain in force: no AI summaries, transcripts, assistants, bots, attention/gaze tracking, usage or engagement analytics, behavioral telemetry, cloud recording or server-side archiving, cloud transcription, or server-side media transcoding/processing.

ADR-002 governs the SFrame/SFU contradiction, blind-forward trade-off, and documented pivot options. No implementation may present a non-encrypted path as E2EE or silently downgrade. ADR-006 governs invitation links: possession of the complete link may confer decryption capability, while admission remains separately controlled. ADR-007 is planning-only for the staged Latch rename; code authorization is blocked, and repository/service namespaces and HRW stability must not be changed as part of this scope document.

V1 does not change architecture gate outcomes or imply milestone closure. Those outcomes remain authoritative in their existing gate and milestone records.
