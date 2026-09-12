# ADR-008 — Session Identity Binding (Private Caller Authentication)

**Status:** `ACCEPTED` | **Date:** 2026-09-12 | **Author:** @architect + @security | **Implementer:** @backend
**Milestone:** SEC-02B (child of SEC-CRIT-02)
**Refs:** [SEC-CRIT-02 remediation program](../plans/SEC-CRIT-02-remediation-program.md) §3, [SEC-02 session identity contract](../design/SEC-02-session-identity-contract.md), [backend credential replay review](../reviews/SEC-CRIT-02-backend-host-credential-replay.md)

## Context

SEC-CRIT-02 demonstrated that a signed host attestation was treated as proof of caller identity. A room peer could capture a host token, present it to `handleToken`, and obtain host authority because the backend did not independently authenticate that the caller owned the token subject. Renaming or reusing the public attestation cannot fix this: possession of a publicly distributed credential is not identity.

## Decision

Introduce a **private session capability** as the sole identity proof for privileged endpoints, and demote the ES256 host token to an **operation proof** that is never sufficient on its own.

1. **Session capability.** At bootstrap (`/room/create`, `/token` guest), the server mints a 256-bit random capability, returns it only in the direct bootstrap response, and stores only its SHA-256 hash together with participant ID, room instance ID, purpose, session version, and expiry. No persistence, no logging, no broadcast.
2. **Credential-purpose separation.** Legacy HS256, LiveKit HS256, and ES256 host tokens are no longer interchangeable. Access tokens authenticate identity/signaling only; host tokens prove a host operation only.
3. **Identity binding.** Caller identity is derived exclusively from the server-validated session. Session `participantID` must equal the access-token subject and belong to the current room instance. The request body, display name, arbitrary participant ID, and host-token subject are untrusted for identity.
4. **Resume path.** `/token` selects the resume path on the presence of any privileged header (even empty or malformed) and fails closed; it never downgrades to anonymous guest issuance. On success the identity is preserved and the session capability rotated.
5. **Target-only delivery.** `/room/transfer-host` authenticates the requester's private session and current host proof, and delivers the new target credential only over the target's authenticated signaling channel. The requester receives public metadata only.

## Consequences

- A captured host attestation alone (or combined with another participant's session) cannot resume or transfer authority.
- Unsupported/legacy clients without a session receive an explicit authentication error rather than a silent fallback.
- Host transfer requires the target to hold a live authenticated connection; otherwise the operation is refused before any authority mutation.
- The capability is a bearer identity proof; session rotation and expiry bound its lifetime. It must never appear in room frames, logs, or the outgoing host's response.

## Alternatives rejected

- Copying `claims.sub` into the participant ID, comparing against a body-supplied ID, requiring a signature on the already-disclosed token, shortening TTL, or adding an unauthenticated nonce. None establish caller identity.
- Renaming the public host attestation into a "private" credential. Distribution remains public.

## Gates

Implementation owner is @backend; independent Architecture, Security, Privacy, QA, and Adversarial decisions are required against the tested revision. The implementer does not approve their own patch.
