# Disaster Recovery Runbook — meet-secure-core (M1 Production Hardening)

## 1. Overview & Service Classification

This runbook outlines the operational procedures for state backup, cold-start restoration, and disaster recovery for the `meet-secure` platform under Milestone M1.

| Service | State Classification | Persistence Engine | RTO Target | RPO Target | Minimization Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **meet-signal** | Stateless relay | In-memory / Redis pubsub | ≤ 15 min | 0s (stateless) | Ephemeral nonces / JWTs only |
| **meet-sfu-manager** | Stateless cache | Redis (`sfu:assign:{roomId}`) | ≤ 15 min | ≤ 5 min (cache TTL) | HRW hash deterministic |
| **LiveKit SFU** | Ephemeral media relay | Blind forward / In-memory | ≤ 15 min | 0s (ephemeral) | Zero media keys retained |
| **turn-auth** | Stateless auth | Ephemeral HMAC tokens | ≤ 15 min | 0s (stateless) | 24h token expiration |
| **coturn** | Ephemeral media relay | In-memory UDP/TCP bindings | ≤ 15 min | 0s (ephemeral) | No session storage |
| **Postgres 16** | Persistent metadata | Volume `pgdata` | ≤ 15 min | ≤ 1 hour | Strict 24h retention / hash-only |
| **Redis 7** | Transient routing/presence | Volume `redisdata` (AOF/RDB) | ≤ 15 min | ≤ 1 hour | Strict TTL ≤ 86400s (24h) |

---

## 2. Core Cryptographic & Privacy Invariants

1. **Zero Media Key Retention:**
   SFrame encryption ratchet keys, HPKE private keys, and session keys are held exclusively in client browser WebAssembly/Worker memory. Under no circumstances are SFrame keys or raw media ciphertext persisted in database backups, Redis snapshots, or host disk.
2. **Strict 24-Hour Data Minimization:**
   Any room record, participant identifier hash, or cache key must have an expiration timestamp ≤ 24 hours. Backups generated older than 24 hours must be securely purged via crypto-shredding or automated retention lifecycle.
3. **Deterministic State Reconciliation:**
   Postgres tables store hash-only values (no PII, no unhashed IPs, no cleartext meeting titles).
4. **Cryptographic Integrity Verification:**
   All backup archives must contain a `manifest.json` and `SHA256SUMS` manifest verifying the hash of every component prior to restoration.

---

## 3. Scheduled Backup Procedures

### Automated Backup Execution
The platform provides dual POSIX and PowerShell backup runners:
- **Linux/CI/Container:** `./scripts/ops/backup-state.sh [TARGET_DIR]`
- **Windows Host:** `powershell -ExecutionPolicy Bypass -File .\scripts\ops\backup-state.ps1 [-BackupDir <path>]`

### Operational Schedule & Retention
- **Frequency:** Every 1 hour via cron or orchestrator job (`0 * * * *`).
- **Target Location:** Encrypted off-site volume or MinIO cold-storage bucket.
- **Encryption:** GPG asymmetric encryption (`--recipient security@meet-secure.local`) for public cloud replication.
- **Retention:** 24 hours rolling retention. Hourly backups older than 24 hours are automatically purged:
  ```bash
  find /var/backups/meet-secure -type d -mtime +1 -exec rm -rf {} +
  ```

---

## 4. Cold-Start Disaster Recovery Procedure

In the event of total host or cluster failure, execute the following step-by-step recovery:

### Phase A: Infrastructure Re-provisioning (T+0 to T+5 min)
1. Provision target node (Ubuntu 22.04 LTS / Alpine Linux or Windows Server with Docker Engine + Compose).
2. Clone certified release tag:
   ```bash
   git clone https://github.com/meet-secure/meet-secure-core.git /opt/meet-secure
   cd /opt/meet-secure
   ```
3. Copy environment secrets (`.env` or orchestrator secret store) containing:
   - `PG_PASSWORD`
   - `TURN_SECRET`
   - `JWT_SECRET`
   - `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
4. Launch base infrastructure:
   ```bash
   docker compose -f infra/compose.yaml up -d --wait postgres redis
   ```

### Phase B: State Restoration & Validation (T+5 to T+10 min)
1. Download verified backup archive:
   ```bash
   scp backup-operator@dr-storage:/backups/latest.tar.gz /opt/meet-secure/backups/
   ```
2. Execute restoration script:
   - **Linux:** `./scripts/ops/restore-state.sh /opt/meet-secure/backups/latest`
   - **Windows:** `powershell -ExecutionPolicy Bypass -File .\scripts\ops\restore-state.ps1 -RestoreSrc .\backups\latest`
3. The restore script automatically:
   - Verifies `SHA256SUMS` across all files.
   - Validates `manifest.json` certifying `zero_media_keys_persisted: true`.
   - Restores Postgres schema and hash-only records.
   - Flushes and populates Redis cache, enforcing 24h TTL on all keys.
   - Checks HTTP health status across all endpoints.

### Phase C: Full Stack Convergence (T+10 to T+15 min)
1. Bring up all remaining services:
   ```bash
   docker compose -f infra/compose.yaml up -d --wait
   ```
2. Run health check suite:
   ```bash
   curl -f http://localhost:8080/healthz   # meet-signal
   curl -f http://localhost:8081/healthz   # meet-sfu-manager
   curl -f http://localhost:9600/healthz   # livekit SFU
   curl -f http://localhost:8082/healthz   # turn-auth
   curl -f http://localhost:9090/-/healthy # prometheus
   curl -f http://localhost:3000/api/health # grafana
   ```
3. Verify Prometheus alert rules are operational (`state: inactive`):
   ```bash
   curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[].state'
   ```

---

## 5. Post-Recovery Verification Checklist

- [ ] `meet-signal` WebSocket listener accepting new room tokens at `POST /token`.
- [ ] `meet-sfu-manager` HRW hashing returning healthy node at `GET /internal/sfu/assign?roomId=test`.
- [ ] LiveKit SFU accepting WebRTC joins with `LIVEKIT_E2EE_MODE=blind`.
- [ ] Postgres public table count matches pre-disaster snapshot.
- [ ] Redis keys verified with `TTL <= 86400` (zero indefinite keys).
- [ ] Total elapsed restore duration verified ≤ 15 minutes (RTO compliant).
