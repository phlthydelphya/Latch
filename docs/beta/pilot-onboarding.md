# Beta Pilot Program Onboarding & SLA Agreement

**Milestone:** M1 Production Hardening  
**Audience:** Beta Pilot Organizations & Enterprise IT Administrators  
**Classification:** Confidential / Pilot Specific  

---

## 1. Pilot Program Overview

The `meet-secure` Closed Beta Pilot Program is a controlled operational trial designed to validate enterprise reliability, voice/video quality, and cryptographic guarantees in live high-security workflows.

### 5 Authorized Pilot Cohorts

| Cohort ID | Vertical | Primary Workflow | Key Compliance Focus | Target Meeting Hours |
| :--- | :--- | :--- | :--- | :--- |
| **COHORT-L1** | Corporate Legal & M&A | M&A negotiation & confidential counsel | Attorney-Client Privilege / Zero Log | 25 hours |
| **COHORT-H1** | Telehealth & Clinical | Patient-doctor clinical consultations | HIPAA / Zero PHI retention | 20 hours |
| **COHORT-F1** | Financial Advisory | Wealth management & board briefings | SEC / FINRA / Cryptographic Proof | 25 hours |
| **COHORT-J1** | Investigative Journalism | Confidential whistleblower interviews | Source Protection / Zero Metadata | 15 hours |
| **COHORT-S1** | Enterprise Cyber Response | Security incident war rooms | Operational Resiliency / Isolated E2EE | 15 hours |
| **TOTAL** | **5 Organizations** | **Multi-Tenant / Self-Hosted** | **Zero Knowledge Guarantee** | **100+ Hours** |

---

## 2. Administrator Onboarding Checklist

### Pre-Deployment Verification (IT Admin)
- [ ] **Infrastructure Provisioning:** Cluster deployed per [`docs/deploy/production-deployment-guide.md`](file:///c:/Users/joshu/meet-secure-core/docs/deploy/production-deployment-guide.md).
- [ ] **DNS & TLS Certification:** Fully qualified domain name (FQDN) pointed to Caddy edge with valid Let's Encrypt TLS 1.3 certificate.
- [ ] **Firewall Verification:** Outbound UDP 7881 and fallback TCP/UDP 3478 / 443 open from corporate endpoints.
- [ ] **TURN Relay Operational Check:** Verify `curl -f http://<internal-turn>:8082/healthz` returns `200 OK`.
- [ ] **Browser Compatibility Audit:** Ensure client browser versions meet the supported matrix:
  - Chrome / Edge 127+
  - Firefox 128+
  - Safari 17.4+ (macOS & iOS PWA)

### Pilot Participant Onboarding (End User)
- [ ] **Join URL Format:** Participants receive room links containing ephemeral room keys in the URL fragment (`/r/<room-id>#k=<ephemeral-key>`).
- [ ] **No Account Creation:** Zero username/password creation required; zero persistent cookies written.
- [ ] **Shield Mode Verification:** Verify green shield badge displays `E2EE · SFrame` in the meeting control bar.
- [ ] **Microphone & Camera Permissions:** Grant standard WebRTC media device permissions.

---

## 3. Pilot Service Level Agreement (SLA) Commitments

`meet-secure` commits to the following quantitative operational SLAs throughout the pilot duration:

| Category | SLA Metric | Commitment | Evaluation Method |
| :--- | :--- | :--- | :--- |
| **Availability** | Staging Cluster Uptime | $\ge 99.9\%$ | Prometheus Synthetic Probes |
| **Reliability** | Mean Time Between Failures (MTBF) | $\ge 50.0\text{ meeting hours}$ | Alertmanager Incident Log |
| **Session Integrity** | Meeting Completion Rate | $\ge 98.5\%$ completed | Session State Audit |
| **Voice Quality** | Audio Packet Loss | $\text{p95} \le 0.5\%$, $\text{p99} \le 1.0\%$ | WebRTC Inbound RTP Stats |
| **Latency** | Round-Trip Time (RTT) | $\text{p50} \le 120\text{ ms}$, $\text{p95} \le 250\text{ ms}$ | ICE Candidate Pair RTT |
| **Video Smoothness** | Video Freeze Rate ($>1\text{s}$ stalls) | $\le 0.2\%$ of meeting duration | Video Frame Delivery Stats |
| **Auto-Reconnect** | Network Disconnect Recovery | $\ge 99.0\%$ recover in $\le 5.0\text{s}$ | Room Event Telemetry |
| **Privacy & Security** | Plaintext Media Leaks | **STRICTLY 0** | Wire Capture DPI Audit |
| **Data Retention** | Ephemeral State Expiry | $\le 24\text{ hours}$ (100% purged) | Redis/Postgres Audit Script |

---

## 4. Privacy-Preserving Diagnostic & Feedback Workflow

In the event that an end user encounters unexpected network stutter, video degradation, or audio drops:

1. **User Action:** Click the **"Diagnostics"** button in the meeting Control Bar.
2. **Sanitization:** The browser immediately compiles a [`SanitizedDiagnosticBundle`](file:///c:/Users/joshu/meet-secure-core/poc/meet-webrtc-core/src/utils/diagnostics.ts):
   - Zero usernames, email addresses, or room names (all identifiers hashed via SHA-256).
   - Zero raw IP addresses (scrubbed to candidate transport types).
   - Zero media encryption keys or frame bytes.
3. **Delivery:** The user sends the resulting `.json` file to `support@meet-secure.internal`.
4. **Analysis:** The engineering team correlates the anonymous WebRTC metrics against the Grafana Pilot Metrics Dashboard (`infra/grafana/dashboards/m1-beta-pilot.json`) without any privacy infringement.

---

## 5. Quantitative Beta-Exit Criteria (Gate to General Availability)

The Closed Beta will conclude and declare General Availability (GA) readiness upon achieving:

1. $\ge 100$ cumulative completed meeting hours logged across the 5 pilot cohorts.
2. Zero P0 or P1 security/privacy defects reported.
3. $\ge 98.5\%$ meeting completion rate maintained across all 5 cohorts.
4. Overall Pilot CSAT / NPS $\ge 85\%$ positive satisfaction rating.
