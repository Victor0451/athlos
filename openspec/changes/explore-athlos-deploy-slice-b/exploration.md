# Exploration: athlos-deploy-slice-b

**Date:** 2026-06-18
**Mode:** Standalone exploration (Slice B has not been named as a change yet).
**Parent roadmap:** `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md`
(Slice A, archived 2026-06-18, shipped at v0.4.1).
**Verdict:** ~500 LoC across 3 deliverables — backup script, restore procedure, and
DATA_STEWARD grant automation. Slice B is large enough (~525 LoC) to warrant
**internal sub-slicing**: a first autonomous slice (B0 — grant automation) with
zero external deps, followed by B1 (backup/restore + S3 wiring).

---

## 1. Runbook content (current state)

`docs/runbook.md` is 98 lines, forward-only after the Slice A fix (rollback block
dropped 2026-06-18).

### Manual steps Slice B must automate

| # | Section | Step | Status today |
|---|---------|------|--------------|
| 1 | Pre-deploy | `pnpm db:migrate:status` | DONE in Slice A |
| 2 | Post-deploy API | `GET /health`, `GET /health/ready` | Already wired (compose healthcheck is TODO in Slice C) |
| 3 | Post-deploy DATA_STEWARD | `SELECT … FROM operators WHERE role = 'A'` + raw `INSERT INTO role_permissions` | **Manual SQL only — lines 26-43** |
| 4 | Rollback | "Re-deploy previous image/tag" + forward-fix migration | Manual, no automation |
| 5 | Common Issues | "Drift alerts not received → grant data_steward" | References the same manual SQL step |

### DATA_STEWARD grant step (lines 17-43 of runbook)

```sql
-- Find the operator
SELECT id, username FROM operators WHERE role = 'A' AND is_active = true;

-- Grant data_steward permission
INSERT INTO role_permissions (operator_id, permission_key, granted_by)
VALUES ('<operator-uuid>', 'data_steward', '<granting-operator-uuid>');
```

**Composite PK** on `role_permissions (operator_id, permission_key)`
(migration `0010_role_permissions.sql:13`) makes a plain retry fail with
`unique_violation` (PG `23505`).

### What is **NOT** in the runbook today

- **Backup step** — absent. The spec (`database-migrations/spec.md:65-70` and
  `deployment-devops/spec.md:165-196`) defines a daily `pg_dump` script with 7-day
  retention and 30-day auto-delete, but no script exists.
- **Restore step** — absent. Disaster recovery is not documented.
- **`pg_dump` is spec-mandated** (`database-migrations/spec.md:69`) when a PR
  carries the `db-destructive` label — that wiring will land in Slice D
  (deploy workflow), but the dump script itself must exist before D.

### Runbook changes Slice B will introduce

- Replace raw SQL block (lines 26-43) with reference to `pnpm ops:grant-data-steward <username>`.
- Add "Backup & Restore" subsection that points to `scripts/backup.sh` and
  `scripts/restore.sh`.
- Note: the runbook reconciliation for forward-only + DATA_STEWARD was already
  done in Slice A. Slice B only adds new automation, does not touch the existing
  rollback/deploy sections.

---

## 2. Code surface that already exists (reusable for Slice B)

| Asset | Path | Reuse for Slice B |
|-------|------|-------------------|
| `PermissionsRepo.grant()` | `packages/db/src/repositories/permissions.ts:48-53` | **Already uses `onConflictDoNothing()`** — the idempotency hazard is already mitigated at the repo level. The grant automation script can call this directly. |
| `PermissionsRepo.listOperatorsWithPermission(key)` | `packages/db/src/repositories/permissions.ts:63-72` | Returns `Array<{id, username}>` for active operators holding `key`. Use for "verify after grant" reporting. |
| `emitAudit(db, record)` | `packages/audit/src/emitter.ts:35-76` | System events use `operatorId: null`. The grant script can emit a `permission.granted` audit row per successful grant. |
| `status.ts` script pattern | `packages/db/src/scripts/status.ts:1-196` | Standalone TS script with `tsx`, `pg.Pool`, Zod schema, exit codes 0/1/2. The grant script can follow this template. |
| `__smoke__.ts` template | `packages/db/src/__smoke__.ts:1-32` | Pool + SELECT 1 + console.info pattern. |
| `node-cron` scheduler | `packages/scheduler/src/scheduler.ts:1-80` | In-process cron with retry policy. Backup can register as a job here OR run as a separate compose service (deferred decision). |
| Bash CI guards | `apps/api/scripts/ci-check-audit-fp.sh:1-43` | Pattern for `set -euo pipefail`, documented exit codes, grep-based checks. |
| `pg_dump` Docker image | `postgres:16-alpine` (in compose) | `pg_dump` is included in the postgres image — no extra dependency in scripts. |

**Key insight:** The grant script can be a thin TypeScript CLI that wires
`PermissionsRepo.grant()` + `emitAudit()` — ~80 LoC of impl, ~60 LoC of test.
The hardest idempotency work is already done.

---

## 3. S3 backend decisions

The spec mandates `s3://athlos-backups/pre-deploy-<sha>.sql.gz`
(`database-migrations/spec.md:69`). Athlos already runs on
postgres:16-alpine in compose; the S3 dependency is the only thing Slice B
adds that requires external infrastructure.

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| Storage backend | AWS S3 / MinIO (self-host) / DO Spaces / Backblaze B2 / Local-only | **AWS S3** (with local-only fallback if `BACKUP_BUCKET` is unset) | Spec literal. MinIO is overkill for single-node v1. Spaces/B2 are fine but add vendor lock-in. Local-only is the v1 fallback so Slice B1 doesn't block on infra. |
| Bucket naming | `athlos-backups-<env>` / `athlos-prod-backups` / env-scoped prefix | **`athlos-backups` with env-prefix key** (`dev/`, `staging/`, `prod/`) | One bucket, env-scoped keys — cheaper (no multi-bucket IAM), easier to reason about, lifecycle policy applies per-prefix. |
| Credentials strategy | env vars (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) / IAM role (prod) / service account / GitHub OIDC | **env vars for v1, IAM role for prod (post-Slice-D)** | env vars match existing `SMTP_*` pattern in `.env.example`. IAM role + OIDC requires the deploy host, which lands in Slice D. Spec says "env-var-only secrets" (`deployment-devops/spec.md:108`). |
| Region | `us-east-1` / `sa-east-1` / whatever the deploy target is | **Defer to deploy host region (Slice C/D decides)** | Cross-region transfer cost + latency penalty. Pick the bucket region when the deploy host region is chosen. |
| Endpoint URL | n/a for AWS / required for MinIO | **Required only if non-AWS** | Add `S3_ENDPOINT` to env, leave empty for AWS. Lets the same script work against MinIO in dev. |
| Path layout | `pre-deploy-<sha>.sql.gz` / `daily/<date>/athlos-<ts>.sql.gz` / both | **Both** (spec compliance + operational) | Spec requires `pre-deploy-<sha>.sql.gz` for deploy-time dumps. Daily cron dumps go under `daily/<YYYY-MM-DD>/athlos-<ts>.sql.gz`. |
| Retention policy | 7d / 30d / 90d / indefinite | **30d hot + lifecycle transition to Glacier after 30d (S3-native)** | Spec (`deployment-devops/spec.md:186-188`) requires ≥7 daily, deletes >30d. Implement as S3 Lifecycle policy on the bucket (not in the script). |
| Encryption at rest | none / SSE-S3 / SSE-KMS | **SSE-S3 (S3 default — no extra config)** | Free, transparent, satisfies "data at rest" without KMS key management. KMS can be added later if compliance demands. |
| Public/block access | public-read / signed URL / block-all | **Block all public access + bucket-policy deny** | Default for S3; required to avoid accidental exposure of `role_permissions` dumps. |

### Environment vars Slice B adds to `.env.example`

```bash
# ── Backup & restore (PR 11 — deploy-automation Slice B) ────────
# BACKUP_DIR: local fallback path when S3 is not configured.
#   Used when BACKUP_BUCKET is empty (dev/test).
BACKUP_DIR=./backups

# BACKUP_BUCKET: S3 bucket for deploy-time and scheduled dumps.
#   Empty value = skip S3 upload (BACKUP_DIR is used).
#   Format: s3://athlos-backups  (no trailing slash)
BACKUP_BUCKET=

# BACKUP_BEFORE_MIGRATE: run pg_dump before drizzle-kit migrate on startup.
#   Required for db-destructive deploys (database-migrations/spec.md:65-70).
BACKUP_BEFORE_MIGRATE=false

# RUN_MIGRATIONS: apply pending migrations on container startup.
#   Spec mandates this for prod (deployment-devops/spec.md:139-145).
RUN_MIGRATIONS=false

# S3 endpoint override (only for MinIO/non-AWS; leave empty for AWS).
S3_ENDPOINT=
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Backup retention (days). 0 = keep forever (not recommended).
BACKUP_RETENTION_DAYS=30

# DATA_STEWARD grant automation (operator IDs to grant on bootstrap).
# Comma-separated UUIDs. Empty = no auto-grants (runbook manual path).
DATA_STEWARD_OPERATOR_IDS=
```

---

## 4. pg_dump technical decisions

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| Output format | `--format=custom` / `--format=plain` / `--format=tar` | **`--format=plain` + gzip** (for spec literal `.sql.gz`) | Spec says `.sql.gz` which is plain-SQL compressed. `custom` is more flexible (`pg_restore --list`, selective table restore) but produces `.dump` not `.sql.gz`. **Pragmatic call:** ship plain+gzip to match spec, document `custom` as a future option if selective restore is needed. |
| Flags | `--no-owner --no-acl --no-privileges` / plain pg_dump | **All three (`--no-owner --no-acl --no-privileges`)** | Spec mandates this (`deployment-devops/spec.md:1548-1568` per parent exploration). Portability across roles. |
| Compression | gzip on plain SQL / rely on `--format=custom` (already compressed) / zstd | **gzip on plain SQL** | Spec literal. `--compress` is for custom format only. |
| Connection | `DATABASE_URL` / separate `PG_ADMIN_URL` | **`DATABASE_URL` (read-only role acceptable)** | Single connection for v1. Backup user needs `SELECT` on all tables (which the app role has). Document upgrade path to dedicated `pg_backup` role in spec follow-up. |
| Verification | `pg_restore --list` / `gunzip -t` / skip | **`gunzip -t` only** | `pg_restore --list` is for custom format. For plain SQL, decompress-then-grep-for-error suffices. Full restore verification is out of scope for v1. |
| Pre-dump lock | `--lock-wait-timeout=30s` / `--single-transaction` / accept brief lock | **`--lock-wait-timeout=30s` only** | `--single-transaction` blocks all writes during the dump. For a 24/7 API, `--lock-wait-timeout` is safer — it waits up to 30s for a lock, then errors rather than blocking writes. Pair with the spec's pre-deploy dump gate (only fires when `db-destructive` label present). |
| Trigger | node-cron via scheduler / docker-compose `backup` service / external cron / on-demand CLI | **Phase A: on-demand CLI + compose `backup` service for daily cron. Phase B (deferred): scheduler job.** | The scheduler runs **inside the API process** — coupling backups to API uptime is wrong. A dedicated `backup` service in compose (cron container with `pg_dump` in a loop) is cleaner. The CLI is callable from CI for deploy-time dumps. |

### Recommended `backup.sh` shape (~80 LoC)

```bash
#!/usr/bin/env bash
# scripts/backup.sh — pg_dump + optional S3 upload.
# Env:
#   DATABASE_URL      — Postgres connection string (required)
#   BACKUP_DIR        — local output dir (default ./backups)
#   BACKUP_BUCKET     — s3://bucket[/prefix] — if set, upload after dump
#   S3_ENDPOINT       — override for MinIO (optional)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — S3 creds (optional)
# Exit codes:
#   0 — dump OK (and S3 upload OK if BACKUP_BUCKET set)
#   1 — dump failed
#   2 — dump OK but S3 upload failed (non-fatal warning in dev)
#   3 — pre-flight failed (missing env vars, dir not writable)
```

Composition: `pg_dump --no-owner --no-acl --no-privileges --lock-wait-timeout=30s
--format=plain "$DATABASE_URL" | gzip > "${BACKUP_DIR}/athlos-${ts}.sql.gz"`,
then `if [ -n "$BACKUP_BUCKET" ]; then aws s3 cp ... fi`. Plus retention sweep:
`find "$BACKUP_DIR" -name '*.sql.gz' -mtime +${BACKUP_RETENTION_DAYS:-30} -delete`.

---

## 5. DATA_STEWARD grant automation

### Current shape (runbook:26-43)

Two-step manual: (1) find operator uuid via `SELECT`, (2) `INSERT INTO
role_permissions VALUES (...)`. Errors on retry with `23505`.

### Recommended shape — TypeScript CLI following `status.ts` pattern

**Why TS not bash:** the repo's existing pattern (`packages/db/src/scripts/status.ts`)
is a standalone TS script run via `tsx`. It already imports `@athlos/db` to talk
to Postgres, validates output with Zod, and emits clear exit codes. Bash would
duplicate `psql` wiring that already exists in TS form, and would lose the
ability to call `PermissionsRepo.grant()` (which has the safe `ON CONFLICT`
behavior baked in).

**Path:** `packages/db/src/scripts/grant-data-steward.ts` (~80 LoC) +
`grant-data-steward.test.ts` (~60 LoC).

### Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Idempotency | `ON CONFLICT DO NOTHING` / `INSERT ... RETURNING` to detect new vs existing | **`ON CONFLICT DO NOTHING` + `RETURNING`** (already in `PermissionsRepo.grant()`) — gives both safety AND reporting. |
| Input source | env var `DATA_STEWARD_OPERATOR_IDS` (CSV of UUIDs) / DB query (`SELECT id FROM operators WHERE role='A' AND is_active=true`) / config file / CLI arg (`--username`) | **CLI arg `--username` (single or repeated) — primary path; env var as fallback for bootstrap.** | Most flexible: ad-hoc from runbook, batched from bootstrap compose. Config files add a third source of truth. DB query is wrong — granting to ALL active admins is a privilege escalation footgun. |
| Reporting | stdout log / JSON output / `--json` flag | **`--json` flag (mirrors `status.ts`)** + human-readable stdout by default. Emits `{ granted: string[], alreadyGranted: string[], auditIds: string[] }`. |
| Audit emission | per-grant `emitAudit` row / single batch row / skip | **Per-grant `emitAudit` with `action: 'permission.granted'`, `entityType: 'role_permission'`, `operatorId: null` (system event)** | Matches the `emitDriftAlert()` pattern (`audit/emitter.ts:5-13`). Operators can later query "who got data_steward granted and when" via `queryAudit`. |
| Permission key | hardcoded `data_steward` / env var | **Hardcoded `data_steward`** | The whole point of this script is to automate THIS specific grant. Future grants get a `--key` flag in v2. |
| Script shape | standalone TS / bash wrapper / hybrid | **Standalone TS** + add `pnpm ops:grant-data-steward` script to root `package.json` | Matches `pnpm db:migrate:status` pattern. |

### Recommended `grant-data-steward.ts` shape (~80 LoC)

```ts
// packages/db/src/scripts/grant-data-steward.ts
// Usage:
//   pnpm ops:grant-data-steward --username alice --username bob
//   pnpm ops:grant-data-steward --operator-id <uuid> --granted-by <uuid>
//   pnpm ops:grant-data-steward --json
//
// Idempotent via PermissionsRepo.grant() (which uses onConflictDoNothing).
// Emits one audit row per successful grant via emitAudit() with operatorId:null.
```

Wires: `createDb()` from pool, looks up operator by username (or accepts
`--operator-id`), calls `permissionsRepo.grant(id, 'data_steward', grantedBy)`,
emits audit row. Zod-validated output schema mirrors `status.schema.ts`.

---

## 6. Restore procedure

### Decisions

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| Automated vs manual | full automation / assisted CLI / pure runbook | **Assisted CLI** — `scripts/restore.sh` that requires explicit `--confirm` flag and refuses if DB has active connections | Pure automation is too dangerous. Runbook-only is too error-prone. CLI with safety gates is the middle path. |
| Where | same env (overwrite) / different env (clone) | **Same env with mandatory downtime** | Different-env restore is "clone" — different use case. Disaster recovery is always same-env overwrite. |
| Permissions | `pg_restore --clean --if-exists --no-owner --no-acl` (needs owner) / `--data-only` (less invasive) | **`--clean --if-exists --no-owner --no-acl`** — requires elevated role | Spec implies this. Document the role requirement. |
| Downtime | required / zero-down via logical replication | **Required (with a banner)** | Logical replication is way out of scope. The script prints "this requires downtime" and asks `--confirm`. |
| Test frequency | weekly / monthly / quarterly / on-demand | **Out of scope for v1** — document a future "restore drill" runbook section | Restore drills need a separate DB (no overlap with prod) — that's its own slice. |

### Recommended `restore.sh` shape (~60 LoC)

```bash
#!/usr/bin/env bash
# scripts/restore.sh — restore a dump into the target DB.
# Usage: pnpm ops:restore <path/to/dump.sql.gz> --confirm
# Required:
#   DATABASE_URL      — target DB
# Safety:
#   - Refuses unless --confirm is passed.
#   - Refuses if active connections > 0 on target DB.
#   - Streams gunzip | psql for plain SQL; uses pg_restore for .dump.
```

---

## 7. Estimated LoC

| Component | Path | Type | LoC |
|-----------|------|------|-----|
| `backup.sh` | `scripts/backup.sh` | bash | ~80 |
| `restore.sh` | `scripts/restore.sh` | bash | ~60 |
| `grant-data-steward.ts` | `packages/db/src/scripts/grant-data-steward.ts` | TS | ~80 |
| `grant-data-steward.schema.ts` | `packages/db/src/scripts/grant-data-steward.schema.ts` | TS | ~30 |
| `grant-data-steward.test.ts` | `packages/db/src/scripts/grant-data-steward.test.ts` | TS test | ~60 |
| `backup.sh` test | `scripts/backup.test.sh` (bats) | bash test | ~50 |
| `restore.sh` test | `scripts/restore.test.sh` (bats, negative cases) | bash test | ~40 |
| `.env.example` additions | `.env.example` | env | ~25 |
| `package.json` scripts (root + db) | `package.json`, `packages/db/package.json` | JSON | ~5 |
| `docker-compose.yml` (backup service + env passthrough) | `docker-compose.yml` | YAML | ~30 |
| `docs/runbook.md` updates | `docs/runbook.md` | md | ~30 |
| **Total** | | | **~490 LoC** |

**Verdict: ~490 LoC → **exceeds the 400-line chained-PR threshold**. Slice B
should be internally sub-sliced.

---

## 8. Slicing recommendation

### Slice B0 — DATA_STEWARD grant automation (~170 LoC)

**The first autonomous slice.** Smallest blast radius, zero external
dependencies, value delivered immediately (runbook no longer requires manual SQL).

- **New:** `packages/db/src/scripts/grant-data-steward.ts` (80L) +
  `grant-data-steward.schema.ts` (30L) + `grant-data-steward.test.ts` (60L)
- **Modify:** `package.json` — add `"ops:grant-data-steward": "pnpm --filter @athlos/db grant:data-steward"`
- **Modify:** `packages/db/package.json` — add `"grant:data-steward": "tsx src/scripts/grant-data-steward.ts"`
- **Modify:** `docs/runbook.md` — replace lines 26-43 with `pnpm ops:grant-data-steward --username <u>`.
- **External deps:** None.
- **Why first:** Pure refactor of an existing runbook manual step into a tested
  CLI. Uses the existing `PermissionsRepo.grant()` (which already handles
  `ON CONFLICT`). No S3, no infra, no compose changes.

### Slice B1 — Backup + Restore + .env additions (~320 LoC)

- **New:** `scripts/backup.sh` (80L) + `scripts/restore.sh` (60L)
- **New:** `scripts/backup.test.sh` (50L) + `scripts/restore.test.sh` (40L, negative cases)
- **Modify:** `.env.example` — add `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BACKUP_DIR`, `BACKUP_BUCKET`, `S3_*`, `BACKUP_RETENTION_DAYS` (~25L)
- **Modify:** `docker-compose.yml` — add `backup` service (cron container running `backup.sh` daily, mounting `/backups` volume) + env var passthrough (~30L)
- **Modify:** `docs/runbook.md` — add "Backup & Restore" subsection (~30L)
- **External deps:** AWS CLI in backup image (~30MB) — base on `postgres:16-alpine` + add `awscli`. Optional: skip if `BACKUP_BUCKET` is empty (local fallback).
- **Why second:** Requires S3 bucket (or local fallback) and AWS CLI in the
  backup image. Bigger but still single-PR sized.

### Slice B2 (optional — merge into B1) — `docker-entrypoint.sh` glue (~80 LoC)

This is the part that calls `backup.sh` when `BACKUP_BEFORE_MIGRATE=true`
before running `drizzle-kit migrate`. It naturally belongs to Slice C
(Dockerfile + entrypoint), not Slice B. **Recommend: defer to Slice C**, NOT
include in Slice B1.

---

## 9. Risks (top 5)

1. **Backup safety — inconsistent dumps under write load.** `pg_dump` without
   `--single-transaction` against a live DB can produce inconsistent output if
   tables are mid-DDL during the dump. **Mitigation:** `--lock-wait-timeout=30s`
   makes the dump abort if it would block writes; combined with the spec's
   "dumps fire before `db-destructive` deploys only" gate, this is acceptable.
   Verification: write a bats test that dumps a seeded DB (~50k rows) and grep
   the output for `ERROR` / unexpected transaction abort markers.

2. **Credential leakage in S3 env vars.** `AWS_SECRET_ACCESS_KEY` printed to a
   CI log = game over. **Mitigation:** the bash script reads from env without
   echoing, AWS CLI masks keys in output by default, CI uses
   `${{ secrets.X }}` in env declarations only. Add a CI guard that greps the
   script for accidental `echo $AWS_*` and fails if found.

3. **Grant idempotency regression.** If a future refactor removes the
   `onConflictDoNothing()` from `PermissionsRepo.grant()`, the script silently
   starts failing on retry. **Mitigation:** the test for
   `grant-data-steward.ts` must explicitly call grant() twice and assert
   idempotency (no error, audit rows not duplicated). Already covered if test
   asserts on `EmitAuditResult.inserted`.

4. **Restore overwrites live data without confirmation.** A misplaced
   `restore.sh prod.sql.gz` would wipe the production DB. **Mitigation:** script
   requires explicit `--confirm`, refuses if active connections > 0, prints the
   target DB host in the warning banner.

5. **Backup retention drifts if lifecycle policy isn't set.** Without an S3
   Lifecycle policy, the bucket grows forever. **Mitigation:** the `backup.sh`
   script applies a local retention sweep (`find ... -mtime +30 -delete`) AND
   documents that an S3 Lifecycle policy must be configured on the bucket
   (one-time infra setup, not in this PR's scope).

### Lesser risks

- `pg_dump` against a long-running advisory-lock-held transaction will block on
  the lock. Mitigated by `--lock-wait-timeout`.
- `awscli` adds ~30MB to the backup image. Acceptable for v1; can move to a
  sidecar container in v2 if image size becomes a concern.
- Backup during a long-running import job may take 10× longer (more rows to
  dump). Out of scope: pause imports during backup. Document as a v2
  consideration.

---

## 10. Out of scope (recommend deferring to future slices)

- **S3 cross-region replication** — single-region is fine for v1.
- **KMS-encrypted backups** — SSE-S3 is enough until compliance demands more.
- **Multi-database backups** — Athlos is a single-DB system today.
- **Per-tenant backup partitioning** — multi-tenancy spec lists it as future work.
- **Automated restore testing** — needs a separate DB + scheduled drill.
- **`pg_basebackup` for PITR** — WAL archiving is a separate, much larger slice.
- **Backup encryption with a passphrase** — adds key-management burden; defer.
- **MinIO as primary S3** — only needed if self-hosting becomes a hard requirement.
- **Dockerfile + entrypoint wiring** (`RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`
  in entrypoint) — Slice C.
- **CI deploy workflow + pre-deploy dump gate** — Slice D.

---

## 11. Open questions for the user (defer to proposal phase)

1. **S3 backend** — AWS S3 (recommended) or self-hosted MinIO? If AWS, who owns
   the bucket creation?
2. **Credentials strategy** — env vars for v1 + IAM role for prod (post-Slice-D)?
3. **Retention policy** — 30 days hot + Glacier transition (recommended), or
   simpler "delete >30d, no Glacier"?
4. **Restore automation level** — assisted CLI with safety gates (recommended),
   or pure runbook manual steps?
5. **DATA_STEWARD input source** — `--username` CLI arg primary + env var
   fallback (recommended), or DB query (NOT recommended — privilege escalation
   risk)?
6. **Cron trigger** — dedicated `backup` service in compose (recommended) vs
   scheduler job inside the API?
7. **Slice B0 vs B1 split** — confirm the two-PR split, or merge into one PR
   (~490 LoC, over the 400-line threshold)?
8. **First autonomous slice** — start with B0 (grant automation, zero deps) or
   jump to B1 (backups)?

---

## 12. Recommendation

| Question | Answer |
|----------|--------|
| Is Slice B >400 LoC? | **Yes — ~490 LoC.** Should be sub-sliced. |
| Sub-slice structure | **B0 (grant, ~170 LoC) + B1 (backup+restore, ~320 LoC).** B0 first. |
| First autonomous slice | **B0 — DATA_STEWARD grant automation** — no external deps, pure refactor of existing runbook step into a tested CLI. |
| External deps in B0? | **None.** Pure local + repo-internal. |
| External deps in B1? | **AWS CLI in backup image + S3 bucket (or local fallback).** |
| Ready for proposal? | **Yes.** Orchestrator should propose B0 as the first change (`deploy-automation-grant-cli` or similar), with B1 as a follow-up. |

### Immediate next step

Propose B0 as a separate change:

- **Why B0 first:** delivers value (manual SQL → tested CLI), has zero external
  deps, smallest blast radius, fits in a single PR (~170 LoC, well under the
  400-line review cap).
- **Why B1 second:** adds infra (AWS CLI, bucket) and is bigger (~320 LoC). It
  is a different change because it touches compose, env vars, and adds two
  bash scripts with bats tests.

Slice C (Dockerfile + entrypoint + `RUN_MIGRATIONS` wiring) and Slice D (CI
deploy workflow + pre-deploy dump gate) follow as separate changes, per the
parent roadmap.

---

## 13. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `docs/runbook.md:17-43` | DATA_STEWARD manual SQL — what B0 replaces |
| `docs/runbook.md:55-78` | Rollback section — already forward-only, B1's restore adds a NEW subsection |
| `docs/runbook.md:80-85` | "Drift alerts not received" troubleshooting — references the same manual SQL |
| `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md` | Parent roadmap — Slice B defined at ~350 LoC (this exploration revises to ~490 with the entrypoint stub deferred) |
| `openspec/specs/database-migrations/spec.md:65-70` | Pre-migration backup mandate: `s3://athlos-backups/pre-deploy-<sha>.sql.gz` |
| `openspec/specs/database-migrations/spec.md:139-145` | `RUN_MIGRATIONS` semantics (Slice C wires this; Slice B just adds the env var) |
| `openspec/specs/deployment-devops/spec.md:165-196` | Backup strategy: `scripts/backup.sh`, gzip, 7d retention, 30d auto-delete, offsite storage |
| `openspec/specs/deployment-devops/spec.md:108` | "env-var-only secrets" → credentials strategy |
| `.env.example:1-42` | 42 lines — no BACKUP_*, RUN_MIGRATIONS, or S3 vars yet |
| `packages/db/drizzle/0010_role_permissions.sql:8-14` | role_permissions schema: composite PK `(operator_id, permission_key)`, `granted_by` nullable |
| `packages/db/src/repositories/permissions.ts:48-53` | `grant()` already uses `onConflictDoNothing()` — the hard part is done |
| `packages/db/src/repositories/permissions.ts:63-72` | `listOperatorsWithPermission()` returns `Array<{id, username}>` for active operators |
| `packages/db/src/scripts/status.ts:1-196` | Script template (tsx + pg.Pool + Zod + exit codes 0/1/2) — B0 grant script follows this shape |
| `packages/audit/src/emitter.ts:22-77` | `AuditRecord` shape + `emitAudit(db, record)` for system events (operatorId: null) |
| `packages/audit/src/index.ts:1-29` | audit package surface — re-exports `emitAudit` |
| `packages/scheduler/src/scheduler.ts:1-80` | node-cron in-process scheduler — B1 does NOT use this (backup is a separate service) |
| `packages/notifications/src/dispatcher.ts:198-208` | `fetchDataStewards()` confirms `permissionKey = 'data_steward'` (lowercase, underscored) |
| `docker-compose.yml:1-65` | 65-line placeholder — B1 adds `backup` service + env var passthrough |
| `apps/api/scripts/ci-check-audit-fp.sh:1-43` | Bash script pattern (set -euo pipefail, documented exit codes) — B1's backup.sh follows this |
| `packages/scheduler/package.json` | Confirms node-cron is available, but B1 uses a dedicated compose service for backups |
| `package.json:22` | `db:migrate:status` script — added by Slice A, root-level `pnpm ops:grant-data-steward` follows the same pattern |
| `packages/db/package.json:18-19` | `migrate:status` script — Slice B0 adds `grant:data-steward` next to it |