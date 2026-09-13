# Rollback Runbook — meet-secure-core

**Scope:** Controlled rollback of a failed or unsafe deployment of the
`meet-secure-core` platform (Compose or Kubernetes/Helm).

**Related runbooks:** [`docs/runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md)
(cold-start DR), [`docs/deploy/production-deployment-guide.md`](deploy/production-deployment-guide.md)
(deployment + hardening), [`qa/reports/sec-crit-02/sec-02a-containment.md`](../qa/reports/sec-crit-02/sec-02a-containment.md)
(credential containment rollback artifact).

---

## 1. Rollback invariants (READ FIRST — non-negotiable)

These rules come from ADR-007 and the SEC-CRIT-02 remediation program. Violating
them during a rollback can reintroduce a known vulnerability or perturb live
room scheduling:

1. **Never roll back to a vulnerable baseline.** If a prior image is the known
   vulnerable credential-validation build, restore only the contained/verified
   artifact (e.g. `meet-secure/meet-signal:sec02a-contained`), or keep the
   affected routes unavailable. See `sec-02a-containment.md` for the exact
   image digest that is (and is not) a safe rollback target.
2. **Keep transfer/resume disabled** if the candidate that failed was a
   SEC-02B/C authority-hardening build. Rolling back code must not silently
   re-enable privileged host-transfer/resume paths.
3. **HRW stability.** The room→SFU rendezvous hash depends on
   `h = xxhash(roomId|nodeID|salt)/weight`. During any rollback, HRW node IDs
   **must stay `sfu-*`** and the hash salt **must stay `p0-salt-2026`**
   (ADR-007 §3). Changing either re-hashes every live room to a different SFU.
   Do not roll back to a manifest/values that changed `SFU_HASH_SALT` or
   `SFU_NODES` node IDs.
4. **No implicit DTLS fallback.** A rollback that disables SFrame must surface
   the explicit ⚠️ "DTLS-only: SFrame E2EE unavailable" banner — never a silent
   downgrade (`docs/plans/phase2b-sframe-design.md` §14).
5. **Ephemeral state is not restored.** Room membership, presence, nonces, and
   media keys are volatile and TTL-capped (24h). Rollback targets only code,
   configuration, and (if applicable) hash-only PG metadata. Do not restore old
   authority maps, credentials, or session snapshots.

---

## 2. Pre-rollback: capture current state

Before touching anything, record exactly what is running so rollback is
reversible:

```bash
# Git
git log --oneline -5
git tag --list
git status --porcelain=v1

# Helm (K8s)
helm history meet-secure -n meet-secure
helm get values meet-secure -n meet-secure > /tmp/meet-secure-values-before.yaml

# Compose
docker compose -f infra/compose.yaml config > /tmp/compose-before.yaml
docker compose -f infra/compose.yaml ps
docker inspect --format '{{.Image}}' <container>   # per service, record digests

# Credentials/signing config (values only, never secrets)
grep -nE 'SFU_HASH_SALT|SFU_NODES|LIVEKIT_E2EE_MODE|JWT_ISSUER' \
  infra/compose.yaml /tmp/meet-secure-values-before.yaml 2>/dev/null
```

Record the **rollback target**: the previous known-good release tag / Helm
revision / image digest. Do not proceed without identifying this target.

---

## 3. Rollback — Kubernetes / Helm

> ⚠️ **Chart is metadata-only — not rollback-capable yet.** The chart at
> `infra/helm/meet-secure-core` ships no `templates/` and no `values.yaml`
> (see `Chart.yaml`). Helm can install an empty release but deploys no
> workload resources; therefore `helm rollback` / `helm upgrade` against it
> cannot restore any workload. The commands below are **forward-looking
> scaffolding**; do NOT run them until the chart ships templates/values and an
> actual release exists. Until then, K8s rollback is `kubectl`/GitOps-driven
> (revert the manifest change that failed), not Helm.

```bash
# Preferred: roll back to a prior Helm revision (revision N from `helm history`)
# Only valid once the chart ships workload templates and a release exists.
helm rollback meet-secure <N> -n meet-secure

# Alternative: reinstall pinned image tags from a values file
helm upgrade meet-secure infra/helm/meet-secure-core \
  -n meet-secure \
  -f /tmp/meet-secure-values-before.yaml \
  --set meetSignal.image.tag=<known-good-tag> \
  --set livekit.image.tag=<known-good-tag>
```

Verify the HRW invariant survived the rollback before traffic resumes:

```bash
helm get values meet-secure -n meet-secure | grep -E 'SFU_HASH_SALT|SFU_NODES'
# Expect: SFU_HASH_SALT=p0-salt-2026 and SFU_NODES node IDs unchanged (sfu-*)
```

---

## 4. Rollback — Docker Compose

Compose keeps no release history; rollback is `git` + re-pull of pinned images.

```bash
# 1. Snapshot uncommitted work BEFORE moving the tree (never `git checkout`
#    over a dirty tree — it silently discards uncommitted changes):
git stash push -u -m "pre-rollback snapshot $(date +%s)"   # or commit to a side branch

# 2. Move ONLY the tracked infra/services paths back to the known-good commit.
#    Use `git restore --source=<tag> -- <paths>` (targeted) rather than a
#    whole-tree `git checkout <tag> .` so unrelated in-progress work is
#    preserved. Restore paths, don't overwrite the entire working tree.
git restore --source=<known-good-tag> -- infra/ services/

# 3a. EITHER re-pull pinned images (preferred — honors image digests):
docker compose -f infra/compose.yaml pull
docker compose -f infra/compose.yaml up -d --no-build --wait

# 3b. OR rebuild locally (only if `pull` images are unavailable) — do NOT
#     combine `pull` + `--build`: `--build` would rebuild local images and
#     silently discard the pulled/pinned digests you just fetched.
docker compose -f infra/compose.yaml up -d --build --wait
```

If the rollback target is a specific *image* (not a git revision), pin it
explicitly in `infra/compose.yaml` `image:` fields or via `docker compose run`
overrides, then `up -d`.

> ⚠️ For credential-cutover failures, do **not** `git checkout` the vulnerable
> baseline. Restore the contained artifact image tag only, and leave
> transfer/resume disabled (see §1.1–1.2 and `sec-02a-containment.md`).

---

## 5. Post-rollback verification

Run the full health + behavior probe on the restored revision. All endpoints
must return clean responses before declaring the rollback complete:

```bash
# Health endpoints
curl -f http://localhost:8080/healthz   # meet-signal
curl -f http://localhost:8081/healthz   # meet-sfu-manager
curl -f http://localhost:9600/healthz   # livekit
curl -f http://localhost:8082/healthz   # turn-auth
curl -f http://localhost:9090/-/healthy # prometheus
curl -f http://localhost:3000/api/health # grafana

# Functional probes
#   HRW assignment still deterministic (single-node degenerates to livekit:7880):
curl -f "http://localhost:8081/internal/sfu/assign?roomId=abc123"
#   Room status (must never 404 — returns {exists:false} for unknown rooms):
curl -f "http://localhost:8080/room/status?roomId=rollback-smoke-test"
#   TURN credential minting (HMAC 24h):
curl -sf -X POST http://localhost:8082/turn/credentials \
  -H 'Content-Type: application/json' \
  -d '{"roomId":"rollback-smoke-test"}' | head -c 200; echo
```

Confirm observability is flowing after rollback (Prometheus scrape + key
metrics). Verify only metrics that actually exist: the `meet-signal` gauges
`meet_signal_rooms_active` / `meet_signal_connections_active` must be
non-error/healthy, and (if TURN credential traffic) the `turn-auth` counter
`turn_allocations_total` must increment. Note: `turn_allocations_active` is
documented in ADR-005 but NOT yet implemented — do not assert it.

---

## 6. Secret / signing-config rollback

Secrets (JWT, LiveKit, TURN, PG) live in the secret store, not the chart. A
rollback that reverts *code* but leaves a *rotated* secret in place will fail
JWT/LiveKit/TURN validation. When rolling back across a secret rotation:

1. Restore the secret values that match the rollback target's signing config
   (issuer/keys). During an issuer rename, both `meet-signal` and `latch-signal`
   must remain in the allowed-issuer set (ADR-007 §6) — do not drop the legacy
   issuer mid-rollback.
2. Re-run the cutover/revocation + rollback rehearsal (SEC-CRIT-02 R13/R14)
   against the restored revision before production traffic resumes.
3. Terminate any affected old sessions; do not restore old authority maps or
   session snapshots as a shortcut.

---

## 7. Data-state rollback (limited)

- **Redis:** routing/presence is TTL ≤ 24h. No rollback — simply let TTLs
  expire, or delete ONLY the affected keys with a scoped command if the HRW
  salt/node set was (incorrectly) changed and then restored. Never run an
  unscoped `FLUSHDB` (it wipes every key in the DB, including unrelated
  presence/routing state):

  ```bash
  # Scoped invalidation of a single room's assignment cache (5m TTL anyway):
  redis-cli DEL "sfu:assign:{roomId}"
  # If the whole assign keyspace must be cleared, scope it explicitly:
  redis-cli --scan --pattern 'sfu:assign:*' | xargs -r redis-cli UNLINK
  ```
- **Postgres:** hash-only metadata with 24h retention. Restore only from a
  verified backup (see `scripts/ops/restore-state.sh`) when metadata loss is
  unacceptable; otherwise purge stale rows per the 24h policy.
- **Media keys:** never persisted; nothing to roll back (invariant §1.5).

---

## 8. Declaring rollback complete

- [ ] Rollback target (tag/revision/digest) recorded in the incident log.
- [ ] §3 or §4 procedure completed; HRW invariant verified (§1.3).
- [ ] §5 health + functional probes all green on the restored revision.
- [ ] Secret/signing config reconciled with the restored code (§6) if applicable.
- [ ] Transfer/resume disabled state preserved where required (§1.2).
- [ ] No vulnerable baseline restored (§1.1).

**Post-incident:** keep the rollback artifact recorded, update the deployment
inventory, and re-open the parent incident/release-block if the root cause is
not yet fixed. Do not clear release blockers on rollback alone.
