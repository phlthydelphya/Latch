# Latch Brand Promise and Evidence Gate Map

**Status:** Documentation-only guidance; no release, gate, milestone, or ticket is marked passed by this document.

This map translates Latch's public brand strategy into promises that can be made only when the corresponding release evidence exists. The source of truth for phase and ticket status remains [`v1-release-tickets.md`](v1-release-tickets.md) and [`v1-release-gates.md`](v1-release-gates.md). Marketing copy must not outrun the exact release candidate (RC), its evidence index, or the five independent gate decisions.

## Promise map

### PRIVATE

| Promise | Supporting release phases and tickets | Evidence artifacts | Public-claim condition |
|---|---|---|---|
| Meeting content is designed to remain private from services: supported media is encrypted, invitation keys stay in the URL fragment boundary, and servers do not receive plaintext media or client encryption keys. | **Phase 5 — Authority, invitation, and abuse-resistant access:** V1-05A, V1-05B, V1-05C. **Phase 6 — Media, device, encryption, and recovery:** V1-06A, V1-06B, V1-06C. **Phase 9 — Security, privacy, and adversarial review:** V1-09A, V1-09B, V1-09C. | Authorization report and redacted signaling traces; invite URL/network and fragment-isolation inspection; redacted packet capture and opaque-SFU review; key-handling and rotation evidence; forced-TURN and reconnect evidence; security, privacy, and adversarial verdicts; exact-RC evidence index. | Use only wording that matches the verified boundary and supported path. A privacy claim requires the relevant Phase 5/6 evidence and Phase 9 independent review for the same RC. Do not imply that services see nothing at all. |

### HUMAN

| Promise | Supporting release phases and tickets | Evidence artifacts | Public-claim condition |
|---|---|---|---|
| Latch makes room participation understandable and respectful across real devices and real failure states: people can join, wait, be admitted or declined, recover, and understand what is happening. | **Phase 4 — Mobile browser and PWA lifecycle:** V1-04A, V1-04B, V1-04C. **Phase 8 — Accessibility and usable failure states:** V1-08A, V1-08B, V1-08C. | Versioned mobile/PWA run sheets, install/update and lifecycle logs, platform capability notes, accessibility scans, keyboard and assistive-technology runs, readable-state inventory, screenshots, redaction checklist, and privacy review memo. | Describe supported platforms and limitations precisely. A usability, accessibility, or “works everywhere” claim requires the applicable matrix rows and Phase 4/8 evidence; unsupported capabilities must remain labeled as such. |

### TRUSTWORTHY

| Promise | Supporting release phases and tickets | Evidence artifacts | Public-claim condition |
|---|---|---|---|
| Latch earns trust through reproducible release evidence, independent review, honest limitations, and a recorded decision for one exact RC. | **Five-gate model:** Architecture, Security, Privacy, QA, and Adversarial, with independent verdicts. **Phase 10 — Evidence reconciliation and release decision:** V1-10A, V1-10B, V1-10C. Reproducibility is cross-phase: the same immutable RC, checksum, environment, procedure, timestamp, owner, reviewer, redaction statement, and artifact location must be traceable. | RC manifest and checksums; clean-build transcript; SBOM/dependency and secret-scan outputs; phase evidence index; five independent gate records; architecture/ADR cross-reference; risk/waiver and rollback records; final GO/NO-GO decision naming the exact RC checksum. | “Verified before release” and equivalent claims are conditional, never evergreen branding. They may be published only after the relevant RC has all five independent approvals and Phase 10 has reconciled the evidence and recorded the decision. A ticket, partial phase, milestone record, or marketing review cannot substitute for a gate. |

## Website messaging examples

These examples are templates, not current release claims:

- **Private:** “Meeting content stays private.”
- **Private:** “Private video designed around clear boundaries.”
- **Human:** “Clear room controls and understandable states, from waiting room to reconnect.”
- **Trustworthy:** “Evidence-led release decisions, with independent Architecture, Security, Privacy, QA, and Adversarial review.”
- **Conditional trust claim:** “Verified before release” — use only when the relevant RC has all five independent approvals and the Phase 10 evidence reconciliation and release decision are recorded.

Avoid the literal absolute phrase **“Nothing leaves the room.”** It can mislead because ciphertext, signaling, and operational metadata transit services to establish, route, secure, and operate a meeting. Prefer **“Meeting content stays private”** or **“Private video designed around clear boundaries,”** with the applicable technical boundary and evidence available when the claim is published.

## Claim discipline

- Public copy must identify whether it is a product promise, a supported limitation, or a release-verification claim.
- Do not convert `NOT YET VERIFIED`, `EVIDENCE REQUIRED`, `BLOCKED`, or `REVIEW REQUIRED` into a positive public claim.
- Claims must be checked against the exact RC and current evidence index after any code, dependency, configuration, infrastructure, security, data-handling, or user-visible-scope change.
- This document changes no implementation, ticket status, gate outcome, ADR, milestone status, or release authority decision.
