# ADR-007 — GO-LATCH-STAGED Rename (Phased Branding, Planning Only)

- **DECISION:** GO-LATCH-STAGED
- **STATUS:** APPROVED FOR PLANNING ONLY
- **CODE AUTHORIZATION:** BLOCKED (phased rename safer than big-bang)
- **Author:** @architect (Principal Architect)
- **Date:** 2026-08-25 (corrected review date; see Section 1)
- **Branch:** `feat/m4a-authoritative-session-control`
- **Refs:** `docs/architecture-brief.md` §6, `docs/design/consistent-hashing-roomId-to-SFU.md`, `services/meet-sfu-manager/main.go:243`, `infra/compose.yaml`, `docs/M4A-exit-report.md` (errata — see ADR-007 §2), `git tag --list`

> **Authority note:** This ADR is the corrected authoritative record for the GO-LATCH-STAGED proposal. It supersedes the prior PM review that proposed GO-LATCH-STAGED with inconsistent dates and milestone-closure claims. No code renames are authorized by this ADR. Implementation is BLOCKED pending phased execution plan.

---

## 1. Date Correction

Prior review drafts cited evidence dated **2026-09-06** as verified Git history and closure facts. That date is **corrected**.

- **Actual review date (system date at review): 2026-08-25.**
- **2026-09-06 is a prospective/target date, not a verified fact.** Any commit, tag, or closure evidence dated 2026-09-06 cited in prior drafts must be treated as prospective/target and re-verified after that date passes.

**Governance rule:**

> Do not use future-dated Git evidence as verified fact. System date at review: 2026-08-25. Evidence dated 2026-09-06 is prospective/target.

Consequences:

- All prior verdicts that state "verified on 2026-09-06" are restated with review date 2026-08-25 and evidence reclassified as prospective.
- This ADR itself is dated 2026-08-25. Future closure evidence (tags, merges, exit-report acceptance) must be re-validated with a fresh `git log --oneline -5`, `git tag --list`, and `git status --porcelain=v1` after the target date.
- No claim in this ADR asserts that 2026-09-06 actions have already occurred.

---

## 2. M4A / M4A.1 Status Correction

Prior draft `docs/M4A-exit-report.md` used header language `CLOSED & FULLY ACCEPTED` while the repository was not closed. That language is **corrected** by this ADR. The single authoritative formulation is:

> **M4A implementation has passed technical review but has not completed repository closure, merge, and acceptance tagging.**

This is the ONLY consistent formulation for M4A / M4A.1 status until closure actually completes. Alternates such as "CLOSED & FULLY ACCEPTED" or "M4A + M4A.1 both closed at same commit" are not authoritative.

Explicit corrections:

1. **m4a-accepted and m4a.1-accepted must NOT be created at same commit unless same revision genuinely accepted.** Each milestone acceptance tag must correspond to a distinct, verified closed revision. Co-tagging two milestones on one commit without dual-milestone acceptance evidence is prohibited.
2. **Dirty working tree proves not closed.** On branch `feat/m4a-authoritative-session-control`, `git status --porcelain=v1` at review shows dirty state: **27 files modified, 6 untracked** (including M4A/M4A.1 deliverables not yet staged/committed). A milestone cannot be CLOSED while its delivering branch is dirty and unmerged.
3. **Current tags verified via `git tag --list` (2026-08-25):** `m3a-accepted` exists; `m3b-accepted` exists; **`m4a-accepted` does NOT exist**. `m4a.1-accepted` also does not exist. Tags `beta-ready`, `m1-release-candidate`, `v1.0.0-m1-beta`, `v1.0.0-m2-complete` exist on prior milestones only.

Errata action: `docs/M4A-exit-report.md` header is corrected by an Errata banner pointing to this ADR for authoritative status (see file edit). The body of that report remains as technical-review evidence but is not a closure authority.

M4A.1 (Invitation Link Bearer Credential Model, ADR-006) status: technical review of the invitation-link model is recorded in ADR-006, but M4A.1 has not been separately tagged or accepted. It must not be assumed closed by inheritance from M4A.

---

## 3. HRW Stability Invariant

The GO-LATCH-STAGED rename is **branding** and must not perturb deterministic room scheduling. Phase 1 soft rename therefore imposes a stability invariant:

| Concern | Phase 1 value | Constraint |
|---|---|---|
| Container / Compose service label | `latch-sfu-manager` | Allowed — display/orchestration label; not hashed |
| HRW node ID (hashed identity) | `sfu-1` (NOT `latch-sfu-1`) | **MUST NOT change in Phase 1** |
| Hash salt | `p0-salt-2026` | **MUST NOT change in Phase 1** |

### Why sfu-1 must not become latch-sfu-1 in Phase 1

The rendezvous HRW assignment is `h = xxhash(roomId|nodeID|salt) / weight` where `weight = 1 + load*10`.

- Code truth: `services/meet-sfu-manager/main.go:243` — `func assignSFU` computes `h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)` and `score := h / divisor` with `divisor = uint64(1 + n.Load*10)`.
- Salt invariant: `salt = p0-salt-2026` per `services/meet-sfu-manager/main.go:88` (`getEnv("SFU_HASH_SALT", "p0-salt-2026")`) and `architecture-brief.md` §6 (D-037) and `docs/design/consistent-hashing-roomId-to-SFU.md:112`.
- Test vector (code truth, D-037): `roomId=abc123`, `nodes=[sfu-0,sfu-1,sfu-2]`, `salt=p0-salt-2026` → `sfu-1`. See `services/meet-sfu-manager/main.go:5` comment and `architecture-brief.md` §6 and design doc § "Test Vectors".

Changing the node ID from `sfu-1` to `latch-sfu-1` changes the `xxhash(roomId|nodeID|salt)` input string even with identical salt. The hash output changes, the HRW winner changes, and rooms remap to different SFU nodes. This is not a cosmetic rename — it is a scheduling perturbation that moves live rooms.

Therefore:

- **Phase 1 soft rename renames the container/service label to `latch-sfu-manager` but retains the HRW node ID as `sfu-1` (and siblings `sfu-0`, `sfu-2`) and salt `p0-salt-2026`.**
- **Runtime node-ID migration (sfu-* → latch-sfu-*) belongs in a separate scheduled operation with explicit re-hash analysis, drain/migration plan, and Redis `sfu:assign:{roomId}` invalidation strategy.** It must NOT be part of the branding tranche.
- Consequently, **HRW-vector update is deferred**. Design-doc vectors remain `sfu-*` namespace until the scheduled migration. No `latch-sfu-1` vector is introduced in Phase 1.

Single-node degeneracy remains valid: `SFU_NODES=livekit:7880` (or `latch-sfu-manager:7880` after label rename) degenerates to the single healthy node; assignment is still deterministic with the unchanged node ID `sfu-0` (auto-assigned when no hyphen in address, per `parseSFUNodes`).

---

## 4. Canonical Namespace Mapping

There is exactly ONE canonical mapping. No alternates.

| Concept | Canonical Name |
|---|---|
| Product | Latch |
| Repository | latch |
| Frontend package | @latch/web |
| Signaling service | latch-signal |
| SFU manager | latch-sfu-manager |
| TURN auth service | latch-turn-auth |
| Upstream SFU | livekit |

Namespacing clarification — these layers are distinct and do not need identical syntax, but must be mapped canonically here:

- **Package names** (npm scope): `@latch/web` — npm package identifier; scoped syntax required by registry.
- **Compose service names** (orchestration labels): `latch-signal`, `latch-sfu-manager`, `latch-turn-auth` — DNS-visible inside `infra/compose.yaml` network; Phase 1 adopts these labels while keeping HRW IDs `sfu-*` per Section 3.
- **Image repositories** (container registry): `ghcr.io/latch/signal`, `ghcr.io/latch/sfu-manager`, `ghcr.io/latch/turn-auth` — registry path syntax; built from the same Dockerfiles with new repository prefix after rename tranche.
- **DNS names** (runtime endpoints): internal `latch-signal:8080`, `latch-sfu-manager:8081`, `latch-turn-auth:8082` (compose network); external `turn.latch.example` / `livekit` upstream remains `livekit` — DNS records follow platform TLS/Caddy/Ingress configuration, not package syntax.
- **Display names** (UI/docs): `Latch` — product display name; title-cased in user-facing surfaces.

No alternate spellings (`latch_web`, `latch-sfu_manager`, `meet-signal` retained) are canonical after Phase 1. Legacy names `meet-secure-core`, `meet-signal`, `meet-sfu-manager`, `turn-auth`, `poc/meet-webrtc-core` are superseded in documentation after the rename tranche but remain in Git history.

---

## 5. Repository Rename Procedure

The repository rename is explicitly three separate steps. Do not conflate them.

### (a) Hosted repository rename via Git hosting platform UI/API (not git mv)

- Action: rename the hosted repository object on the Git hosting platform (e.g., GitHub Repository Settings → Rename, or `gh repo rename`, or platform API). This changes the remote URL namespace (e.g., `github.com/org/meet-secure-core` → `github.com/org/latch`).
- This step is **not** a local `git mv` — it is a platform control-plane operation on the remote object.

### (b) Local remote URL migration (`git remote set-url origin <new-url>`)

- After step (a), each clone must update its remote:
  ```bash
  git remote set-url origin <new-url>
  git remote -v  # verify
  git fetch origin
  ```
- CI deploy keys, branch protections, and environment secrets that reference the repository path must be updated to the new path in the platform settings.

### (c) Directory / package / service renames via `git mv` / filesystem

- After (a) and (b), rename tracked paths with Git-aware moves:
  ```bash
  git mv poc/meet-webrtc-core poc/latch-web  # example
  git mv services/meet-signal services/latch-signal
  git mv services/meet-sfu-manager services/latch-sfu-manager
  git mv services/turn-auth services/latch-turn-auth
  ```
- Update `package.json` name to `@latch/web`, `go.mod` module paths where applicable, `infra/compose.yaml` service names to `latch-*` (retaining HRW IDs per Section 3), and documentation cross-references.
- This step is **BLOCKED** by this ADR (CODE AUTHORIZATION: BLOCKED). It belongs to the phased rename execution plan, not to this planning ADR.

**Hosting redirect note:** The platform may provide redirects from the old repository URL to the new URL after step (a), but **no redirect duration is promised without verifying hosting provider behavior**. Do not assert that redirects persist for N days without checking the provider's current documentation and testing `git fetch` from the old URL after rename. Record verified behavior in the rename execution PR.

---

## 6. JWT Issuer / Signature Validation Correction

Prior-draft wording "JWT issuer is validated via HMAC" is conceptually muddled. Signature verification and issuer validation are separate checks and must be described separately:

1. Verify signature with configured key (HMAC-SHA256 HS256 or ES256 as configured).
2. Validate issuer (`iss`) against allowed issuer set.
3. Validate audience (`aud`).
4. Validate expiration (`exp`) and not-before (`nbf`).
5. Validate subject (`sub`) and role where applicable.

**Migration rule for issuer rename:**

During migration, allowed issuers are:

- `meet-signal`
- `latch-signal`

Then remove the legacy issuer `meet-signal` after the compatibility window closes per the event-based retirement conditions in Section 9. Do not assert "issuer validated via HMAC" in any plan or ADR.

---

## 7. Metrics — Do Not Dual-Emit Indefinitely

Dual-emitting every metric under both old and new Prometheus names creates duplicate time series, ambiguous dashboards, possible double counting, and increased cardinality.

Prefer one of:

- **A. Keep internal metric names unchanged during brand-only rename.** Internal Prometheus names (`meet_signal_*`, `sfu_load`, `livekit_*`, `turn_*`) do not need to match the product brand. Keeping `meet_signal_*` temporarily, or permanently, may be safer than treating metrics as customer-facing identity.
- **B. Rename metrics later with explicit dashboard compatibility rules.** If metrics are renamed, it belongs to a separate scheduled migration with dashboard migration, alert-rule updates, and cardinality review — not to the branding tranche.

No indefinite dual-emission is authorized in Phase 0–1.

---

## 8. Infrastructure Identifiers — Optional Normalization, Not Mandatory Branding

Changes to the following have high operational cost and little visible product value and are **not mandatory Latch adoption**:

- Keycloak realm
- PostgreSQL database name
- TURN realm
- Compose project name (`infra/compose.yaml` `name:` / directory-derived project name)
- Docker network name (`meet-secure-p0_default` or equivalent)

These are classified as **optional infrastructure normalization**, not mandatory branding.

**Recommended scope separation:**

| Tranche | Scope |
|---|---|
| M4A.2 (Brand adoption) | User-facing brand, PWA manifest/manifest.json `name`/`short_name`, HTML metadata (`<title>`, `og:*`), invitation wording, documentation display names, new image **aliases** (not replacements), environment-variable **aliases** with old-name fallback |
| Separate migration milestone | OIDC realm, TURN realm, database name, Compose project, Docker network, metric namespaces, runtime SFU node identifiers (per Section 3) — requires its own ADR, rollback plan, and maintenance approval |

No PR may bundle infrastructure renames with user-visible branding without separate authorization.

---

## 9. Compatibility Periods — Event-Based Exit Conditions

Avoid vague time-bound language such as "one release", "one month", "two releases", or "90 days" unless those periods are formally committed and tracked.

Use measurable retirement conditions. A legacy alias, legacy issuer, or legacy metric name may be removed **only after all of the following are verified**:

- no supported deployment references it (verified via deployment inventory / `grep -r` across infra repos and documented in migration PR);
- no active token can contain the old issuer (max `JWT_TTL_SECONDS` + clock-skew window has elapsed since last issuance of old issuer);
- dashboards consume the canonical metric names (if metrics were renamed);
- deployment rollback has been tested (forward and back) in staging;
- migration documentation has been completed and linked in the removal PR;
- and the PM approves legacy removal in writing.

Record the verification evidence (commands, logs, or dashboards) in the removal PR. No calendar-only expiry.

---

## 10. Unsupported Branding Assertions — Removed

The following phrases are unnecessary or technically questionable and must **not** be used as reasons to approve the name or as implementation requirements unless independently verified with evidence:

- "HMAC-safe"
- "prefix collision-free"
- "latch.video"
- "latch.local"
- "TTL=0 on leave" as a branding justification (TTL semantics are in `docs/M4A-authoritative-session-control.md` and remain `TTL=0` ephemeral purge on room teardown — not a rename rationale)
- "single compose up" as a branding justification (Compose operability is verified in `architecture-brief.md` §11.1 via `docker compose -f infra/compose.yaml up --build --wait` but is not evidence for rename correctness)

The rename is justified sufficiently by:

- coherent product identity,
- clearer user-facing terminology,
- separation of public brand from implementation names,
- and compatibility with the project's privacy positioning.

Do not cite the removed phrases in any ADR or PR description.

---

## 11. Recommended Phase Model (Staged Latch Adoption)

Phase model is **planning guidance**, not code authorization. All phases remain BLOCKED until M4A/M4A.1 closure per Section 12.

**Phase 0 — Brand adoption (no protocol/infra/metrics/runtime change):**

- UI product name (`Latch`)
- PWA manifest (`manifest.json` `name`, `short_name`, `description`)
- HTML metadata (`<title>`, `meta description`, `og:title`)
- Invitation text / InviteModal wording
- Documentation display names
- Accessibility labels (`aria-label`, alt text referencing product name)
- User-visible diagnostics text (shield badge, E2EE notice)

No protocol, infrastructure, metrics, or runtime identifiers change in Phase 0.

**Phase 1 — Safe aliases:**

- New container image aliases (registry alias, e.g., `ghcr.io/latch/signal` alongside existing `ghcr.io/meet-secure/meet-signal` — alias, not replacement)
- New environment-variable names with old-name fallback (e.g., `LATCH_SIGNAL_JWT_SECRET` with fallback to `JWT_SECRET`; document both)
- Documentation for new deployment terminology
- Registry publication under both image aliases (dual publish, not dual metric emit)

HRW node IDs remain `sfu-*` per Section 3; no JWT issuer migration beyond allowed-set expansion per Section 6.

**Phase 2 — Internal package normalization:**

- Frontend package name (`@latch/web`)
- Source directory names where justified (`poc/latch-web` after `git mv`)
- Go module names where externally safe (no breaking import path without verification)
- CI and tooling labels

Phase 2 requires clean Phase 0–1 completion and its own execution PR with `git mv` verification.

**Phase 3 — Optional infrastructure migration (separate ADR + rollback plan + maintenance approval):**

- OIDC realm
- TURN realm
- Compose project name
- Docker network name
- Database name
- Metrics namespaces
- Runtime SFU node identifiers (`sfu-*` → `latch-sfu-*` with re-hash analysis per Section 3)

Phase 3 is **not part of M4A.2**. It requires its own ADR, drain/migration plan, Redis `sfu:assign:{roomId}` invalidation strategy, and explicit PM approval per Section 9.

---

## 12. Authorization & Next Steps — Corrected PM Verdict

- **This ADR authorizes planning only.** It does not authorize code merges, `git mv`, `package.json` renames, or CI image-repository changes.
- **CODE AUTHORIZATION: BLOCKED** — phased rename is safer than big-bang. A follow-on execution plan must sequence (a) → (b) → (c) with verification gates and HRW stability checks (Section 3).
- **HRW-vector update deferred** — no new `latch-sfu-*` test vectors in this tranche.
- **M4A closure prerequisite:** repository closure requires: working tree clean, branch merged, tag `m4a-accepted` created on the accepted revision and verified via `git tag --list`, and `docs/M4A-exit-report.md` errata cleared after re-review. Branch `feat/m4a-authoritative-session-control` must first be separated from uncommitted work before M4A.2 begins.
- **File integrity:** this file must pass `git diff --check` (no trailing whitespace, no conflict markers) and contain zero future-dated claims beyond prospective/target notation defined in Section 1.

**Corrected PM verdict:**

> **M4A.2 is approved for staged product-brand adoption and compatibility planning. Implementation is BLOCKED until the current M4A/M4A.1 work is committed, independently verified, merged into the designated baseline branch, and tagged at the correct accepted revisions. The initial implementation tranche is limited to user-visible branding and non-breaking aliases (Phases 0–1). Runtime SFU identifiers, JWT migration beyond allowed-set expansion, OIDC realms, TURN realms, databases, metric namespaces, Compose projects, and network identifiers are excluded unless separately authorized. No functional meeting, media, authority, invitation, waiting-room, or E2EE changes may be bundled with the branding work.**

Overall, the prior review had the right strategic decision (GO-LATCH-STAGED) but overreached by turning a product rename into a near-total infrastructure migration. Keep Latch adoption small, reversible, and externally visible first.

---

*End of ADR-007 — Approved for planning only. No code renames authorized.*
