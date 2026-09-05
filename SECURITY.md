# Security Policy & Vulnerability Handling Policy

**Version:** 1.0.0-m1  
**Effective Date:** September 2026  
**Status:** ACTIVE ✅  

---

## 1. Commitment to Security & Privacy

`meet-secure` is built on a zero-knowledge, end-to-end encrypted (E2EE) architecture where media confidentiality and client privacy are mathematically guaranteed via SFrame (RFC 9605). We take security vulnerabilities with the highest level of urgency and operate an open, coordinated vulnerability disclosure program.

---

## 2. Supported Versions

Only the active release and release candidate branches receive active security updates and rapid hotfixes:

| Version | Status | Supported | Critical Patch SLA |
| :--- | :--- | :--- | :--- |
| **M1 (v1.0.x)** | Release Candidate / Beta | **YES** | $\le 24\text{ hours}$ |
| **M0-P0 (v0.1.x)** | Baseline Closed | **Maintenance** | $\le 48\text{ hours}$ |
| **< v0.1.0** | Deprecated Alpha | **NO** | N/A |

---

## 3. Reporting a Vulnerability

If you believe you have discovered a security vulnerability in `meet-secure`, **do NOT open a public GitHub issue**.

Please submit your report confidentially to our Security Response Team:
- **Email:** `security@meet-secure.internal`
- **PGP Key Fingerprint:** `4A7F 912C B83D 6E01 F245  89D3 C5E8 7B21 00A4 2026`
- **Encryption:** We strongly encourage encrypting your advisory email using our public PGP key.

### Report Contents
Please include the following details to assist our engineering team in rapid reproduction and triage:
1. Clear description of the vulnerability and affected components (e.g., `src/sframe/transform.ts`, `services/meet-signal`).
2. Detailed step-by-step reproduction instructions or a minimal Proof-of-Concept (PoC) harness.
3. Impact assessment (e.g., ciphertext disclosure, nonce reuse, authentication bypass, denial of service).
4. Any proposed remediations or patches.

---

## 4. Vulnerability Response SLA

Our dedicated Security Response Team adheres to strict operational SLAs based on CVSS v3.1 severity scoring:

| Severity | CVSS Range | First Triage SLA | Status Updates | Remediation Patch SLA |
| :--- | :--- | :--- | :--- | :--- |
| **CRITICAL** | $9.0 - 10.0$ | $\le 4\text{ hours}$ | Every 8 hours | $\le 24\text{ hours}$ |
| **HIGH** | $7.0 - 8.9$ | $\le 12\text{ hours}$ | Every 24 hours | $\le 48\text{ hours}$ |
| **MEDIUM** | $4.0 - 6.9$ | $\le 48\text{ hours}$ | Every 48 hours | $\le 5\text{ days}$ |
| **LOW** | $0.1 - 3.9$ | $\le 5\text{ business days}$ | Weekly | Next regular release |

---

## 5. Scope & Bug Bounty Priorities

### High-Priority In-Scope Components
- **SFrame Cryptographic Layer:** Nonce reuse vulnerabilities (T-01), CTR domain collisions, auth tag bypass, replay attacks, or plaintext media leakage.
- **Key Distribution & Epoch Management:** HPKE Welcome message forgery, key derivation compromise, unauthorized epoch rollbacks.
- **SFU Isolation Invariant:** Any scenario where the SFU or an untrusted relay can inspect or decrypt unencrypted audio/video frames.
- **Signaling & Authentication:** JWT forgery, token replay, participant impersonation, or unauthorized room admission.
- **Coturn / TURN Auth:** HMAC-SHA256 credential compromise, relay lease exhaustion, or credential leakage in server logs.

### Out of Scope
- Volumetric denial of service (e.g., raw L3/L4 UDP floods against edge IP addresses).
- Social engineering, phishing, or physical compromise of client workstations.
- Third-party vulnerabilities in upstream browser engines (report directly to Chromium, WebKit, or Mozilla).

---

## 6. Safe Harbor Policy

We consider ethical security research conducted in accordance with this policy to be authorized and lawful:
- We will **not** initiate legal action against researchers who comply with good-faith disclosure guidelines.
- We will work cooperatively with researchers to validate, patch, and coordinate public disclosure.
- Researchers will receive full attribution in our security advisories and release notes (unless anonymity is requested).
