# Athlos Runbook

## Deploy Checklist

### Manual CTACTE comprobante replay migration (0031 → 0032 → 0033 → 0034)

> Do not use Drizzle for these migrations: the production journal is incomplete after 0020.
> Stop immediately on backup, migration, or verification failure; do not roll out the API.

1. Create and verify a database backup.
2. Apply `0031_ctacte_movement_notes.sql`, `0032_ctacte_idempotency_key_unique.sql`, `0033_ctacte_comprobante_retries.sql`, then `0034_ctacte_movement_notes_idempotency_key_full_unique.sql` in that order with `psql -v ON_ERROR_STOP=1 --single-transaction`.
3. Verify `tesoreria.ctacte_comprobante_retries` has its status check, lease/result columns, and `ctacte_comprobante_retries_expires_at_idx`.
4. Verify `socios.ctacte_movement_notes` has the FULL (unconditional) UNIQUE INDEX `ctacte_movement_notes_idempotency_key_unique` (no `WHERE` predicate). 0034 replaces the partial index created by 0031 with a full one so PostgreSQL can infer it for `ON CONFLICT (idempotency_key) DO NOTHING`. 0034 is forward-only + idempotent (`DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`) and is safe to apply whether 0031 has already run or not.
5. Only then roll out the API version that uses durable comprobante + note replay.

This repository change does not apply migrations, deploy, or access production.

### Pre-deploy

- [ ] Verify all migrations have been applied (`pnpm db:migrate:status`)
- [ ] Run `pnpm test:run` — all tests must pass
- [ ] Run `pnpm typecheck` — 0 errors
- [ ] Run `pnpm lint` — 0 errors

### Post-deploy (API)

- [ ] Verify `/health` returns `{"status":"ok"}`
- [ ] Verify `/health/ready` returns `{"status":"ready"}`

### Post-deploy (DATA_STEWARD Permission — PR 7b.2)

> **IMPORTANT**: After deploying PR 7b.2, drift alerts are SILENT by default.
> The `role_permissions` table starts EMPTY — no operator receives `data_steward`
> permission out of the box. Drift alerts (`drift_alert` notifications) are only
> sent to operators with a `data_steward` row in `role_permissions`.

To enable drift alerts for an operator:

<!-- DEPRECATED 2026-06-19: the raw SQL GRANT block below has been replaced by
     the idempotent, audited CLI. If you have this snippet saved somewhere,
     please update to the new command. -->

```bash
# Idempotent, audited grant — safe to re-run:
pnpm ops:grant-data-steward --username alice

# Bulk grant via env var (comma-separated UUIDs):
DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env
```

After granting, the operator will receive `drift_alert` in_app and email notifications
when the `drift-detection` job (cron: every 5 min) detects hash mismatches.

To revoke:

```sql
DELETE FROM role_permissions
WHERE operator_id = '<operator-uuid>' AND permission_key = 'data_steward';
```

### Post-deploy (Import Pipeline)

- [ ] Verify `POST /api/v1/import/trigger` returns 202 with a `batchId`
- [ ] Wait for batch to complete; check `GET /api/v1/import/status/:batchId`
- [ ] Verify `GET /api/v1/lineage/:entityId` returns the expected entity chain
- [ ] Verify `GET /api/v1/freshness` returns 11 domain items with `current` or `stale` status

### Post-deploy (Reconciliation Job)

- [ ] Verify `GET /api/v1/admin/jobs/runs?job_name=reconciliation` shows recent runs
- [ ] If `RECONCILIATION_CRON` is set, verify the job fires at the expected time

### Socios evidence closure — future beta acceptance (PR4)

> This is an operator checklist for a **future beta execution**. It does not deploy an image, run a closure, or authorize production use. Record only sanitized identifiers and aggregate evidence; never copy legacy payloads into tickets, logs, or this document.

#### Preflight — every item is required

- [ ] Record the immutable beta API image digest and revision; do not use a mutable tag.
- [ ] Verify migration status is clean and that `0040` through `0043` are applied.
- [ ] Verify a current database backup is present, readable, and the beta database is ready.
- [ ] Verify the operator is authenticated as `ADMIN` and the audit identity is correct.
- [ ] Record the selected catalog batch ID and Socios batch ID; verify they are the intended distinct pair.
- [ ] Create a new preview and record its sanitized ID and fingerprint. Confirm it is fresh immediately before confirmation.
- [ ] Verify no closure lease is active for the selected pair.
- [ ] Generate and record one explicit idempotency key bound to this preview; do not reuse a key for another pair or fingerprint.
- [ ] Record the approved delivery/maintenance change authorization and governance state for this beta run, including approver and timestamp. This is approval evidence, not a runtime review-mode API expectation.

#### Execute and observe

1. Request the ADMIN dry-run/preview for the exact selected pair. Record only its `previewId`, `fingerprint`, `counts.catalog`, and `counts.socios`; stop if it is missing, stale, or invalid.
2. Stop unless the preview fingerprint is fresh immediately before confirmation. Eligible, projected, and exception reconciliation is terminal runner evidence, not preview evidence.
3. Confirm once with the recorded idempotency key, preview ID, and fingerprint. A compatible replay is evidence of the same request; do not issue a different key while the pair is leased.
4. Observe the returned `jobRunId` through the existing unfiltered `GET /api/v1/admin/jobs/runs` history: find the item whose `id` equals that value and record its terminal status and timestamps. Do not use a status filter; the endpoint's supported status enum does not include `completed_with_review`, and it does not expose metadata.
5. If explicitly authorized for read-only operational database access, collect terminal reconciliation evidence from the actual schema: the matched `public.job_runs` row's `metadata` plus `socios.evidence_closure_phase_receipts`. Verify the job row's `id`, `job_name`, `status`, `started_at`, and `finished_at`; inspect actual metadata keys without assuming an API projection. For the receipt rows, retain only `execution_identity`, `phase`, `selected_batch_id`, `fingerprint`, `eligible_count`, `projected_count`, `exception_count`, `unknown_type_count`, `ambiguous_identity_count`, `missing_identity_count`, `status`, `started_at`, and `committed_at`. Establish the real metadata-to-`execution_identity` binding before using receipt rows; if it is absent or cannot be read, no-go. Do not invent a receipt endpoint, metadata field, filter, or SQL column.

#### Go / no-go

| Outcome                                                                                                                                  | Decision       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Terminal reconciliation evidence exactly matches its receipt constraints; every eligible row is projected or explicitly excepted         | Go             |
| `completed_with_review` with exact reconciliation and explicit exception counts                                                          | Go with review |
| Missing or incomplete authorized evidence, stale/mismatched preview, technical failure, non-terminal job, or any reconciliation mismatch | No-go          |

#### Sanitized acceptance evidence

```text
imageDigest: sha256:<digest>
revision: <immutable revision>
catalogBatchId: <uuid>
sociosBatchId: <uuid>
previewId: <uuid>
fingerprint: <sha256>
leaseFence: <integer>
jobRunId: <uuid>
previewCounts: catalog=<n>, socios=<n>
terminalReconciliation: eligible=<n>, projected=<n>, exceptions=<n>, unknownType=<n>, ambiguousIdentity=<n>, missingIdentity=<n>
durationsMs: preview=<n>, execution=<n>
status: completed | completed_with_review | failed
```

For `completed_with_review`, record the follow-up owner in the external acceptance-evidence record or runbook signoff; do not persist it as runtime metadata. Do not add raw legacy identifiers, names, payloads, SQL output, tokens, or credentials to acceptance evidence.

#### Abort and recovery boundary

Before durable idempotency-key reservation, aborting leaves no closure effects. After reservation commits, it is the point of no return: never delete the shared key, closure evidence, or committed phase receipts. Stop future phases at the next documented boundary, preserve committed receipts, and fence or release the lease only through its safe owner-aware lifecycle. Recover schema or data defects with a forward-fix migration; recover a runtime defect by rolling back to the prior immutable image when applicable. Re-run only through the same durable receipt and idempotency contracts.

## Rollback Procedure

<!-- DEPRECATED 2026-06-18: the rollback procedure that lived here was removed.
Migrations are forward-only by spec. If your runbook snippet still contains
a rollback command, ignore it and follow the procedure below. -->

If a migration fails to apply:

Migrations are **forward-only** by spec (`openspec/specs/database-migrations/spec.md:56`).
There is no rollback command. To revert a bad migration:

1. Author a new forward migration that undoes the bad change's effect (column drop,
   constraint reversal, etc.).
2. Commit it via the normal PR flow (`pnpm db:generate` to scaffold).
3. Re-deploy.

If a deployed version causes issues:

1. Re-deploy the previous image/tag
2. Verify `/health` is ok
3. Check `GET /api/v1/admin/jobs/runs` for any failed jobs

## Backup & Restore

### Daily backup

The `scripts/backup.sh` script runs on the host via `/etc/cron.d/athlos-backup`
(at 03:00 local). It reads `DATABASE_URL`, `BACKUP_DIR`, and `BACKUP_RETENTION_DAYS`
from the environment and produces a gzip-compressed SQL dump:

```bash
# Manual run (from the host):
DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/athlos \
  BACKUP_RETENTION_DAYS=7 bash scripts/backup.sh
```

Verify a backup:

```bash
# List recent backups
ls -lh /var/backups/athlos/athlos-*.sql.gz

# Check integrity (does not extract)
gunzip -t /var/backups/athlos/athlos-2026-06-22-0300.sql.gz
```

Retention: files older than `BACKUP_RETENTION_DAYS` are deleted automatically at the
end of each backup run. The worst-case disk footprint is
`BACKUP_RETENTION_DAYS × ~50 MB ≈ 350 MB`.

### Restore procedure

Restore requires `--confirm` to proceed. Run with `--dry-run` first to verify
the source file is valid and see the target DB host:

```bash
# dry-run (safe — no DB writes)
bash scripts/restore.sh \
  --source /var/backups/athlos/athlos-2026-06-22-0300.sql.gz \
  --confirm --dry-run
```

Apply (active connections will block by default):

```bash
bash scripts/restore.sh \
  --source /var/backups/athlos/athlos-2026-06-22-0300.sql.gz \
  --confirm
```

Apply with active connections (DANGEROUS — only for maintenance windows):

```bash
bash scripts/restore.sh \
  --source /var/backups/athlos/athlos-2026-06-22-0300.sql.gz \
  --confirm --force-allow-active
```

Exit codes:

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Success                                                       |
| 1    | Bad argv (missing `--source` or `--confirm`)                  |
| 2    | Safety refused (active connections, corrupt source, bad path) |
| 3    | `psql` restore failed                                         |

### USB Rotation (weekly)

Weekly offsite backup to a LUKS-encrypted external USB drive. Runs every Sunday
at 04:00 as `root` via `/etc/cron.d/athlos-backup`.

**One-time setup** (before first use):

```bash
# Format the USB drive (DESTRUCTIVE — only once per drive)
sudo bash scripts/setup-usb.sh --device /dev/sdX  # replace sdX with your USB device

# Verify the setup
sudo bash scripts/setup-usb.sh --device /dev/sdX --dry-run
```

**Cron entry** (add to `/etc/cron.d/athlos-backup`):

```
0 4 * * 0 root /run/media/vlongo/Archivos/Projectos/Athlos/scripts/backup-to-usb.sh
```

**Manual run**:

```bash
# Full pipeline: mount → rsync → retention → unmount
sudo bash scripts/backup-to-usb.sh
```

**Verify last weekly backup**:

```bash
# Mount USB manually to inspect
sudo bash scripts/mount-usb.sh
ls -lh /mnt/athlos-backup-usb/
sudo bash scripts/unmount-usb.sh
```

**Emergency unmount** (if the USB is left mounted after an incident):

```bash
sudo bash scripts/unmount-usb.sh
```

Exit codes for `mount-usb.sh` / `unmount-usb.sh` / `backup-to-usb.sh`:

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | Success                                                    |
| 1    | Configuration error (missing env var, keyfile perms wrong) |
| 2    | USB device not present (mount-usb.sh only)                 |
| 3    | rsync or retention failed (backup-to-usb.sh only)          |

**Troubleshooting**:

- Keyfile error (exit 1): ensure `$USB_KEYFILE` has mode `0600` and owner `root:root`
  ```bash
  ls -l /root/athlos-usb.key      # should be -rw------- 1 root root
  ```
- USB not found (exit 2): check the USB is plugged in and has the correct label
  ```bash
  sudo lsblk -o NAME,LABEL,SIZE
  sudo blkid /dev/disk/by-label/athlos-backup-usb
  ```
- LUKS status:
  ```bash
  sudo cryptsetup status athlos-backup-usb
  sudo ls -l /dev/mapper/athlos-backup-usb
  ```

## Common Issues

### Drift alerts not received

1. Check `role_permissions` has rows: `SELECT COUNT(*) FROM role_permissions WHERE permission_key = 'data_steward'`
2. If 0, grant `data_steward` permission to the target operator (see Post-deploy DATA_STEWARD section above)
3. Check `notifications` table for failed dispatches

### Import batch stuck in `running`

- Check the `scheduled-import` job log for errors
- If the job process was killed mid-run, the row remains `running`
- The scheduler reconciles orphaned `running` rows on boot (marks them `failed`)
- Manual recovery: `UPDATE job_runs SET status = 'failed', finished_at = NOW() WHERE id = '<batch-id>'`

### Freshness shows `unknown` for all domains

- Verify the `freshness-refresh` job is running: check `GET /api/v1/admin/jobs/runs?job_name=freshness-refresh`
- Verify `domain_freshness` table has rows: `SELECT COUNT(*) FROM domain_freshness`
- If empty, manually trigger: `POST /api/v1/admin/jobs/run-now` with `{"job_name": "freshness-refresh"}`

## Containerized Deploy (Docker)

Slice C delivers the production containerized deploy for Athlos. The API runs in a multi-stage `node:22-alpine` image; the database runs in `postgres:16-alpine`. Migrations and pre-migration backups run in the API container's entrypoint before the Fastify process starts.

### First deploy

```bash
cd /run/media/vlongo/Archivos/Projectos/Athlos
cp .env.example .env.production
$EDITOR .env.production   # set POSTGRES_PASSWORD, JWT_SECRET, etc.
docker compose pull       # no-op on first run (local image)
docker compose build      # builds api via Dockerfile
docker compose up -d      # starts api + db, entrypoint runs migrations + backup
```

### Verify

```bash
docker compose ps                                       # both healthy
curl -s http://localhost:3000/health/ready             # 200 OK
docker compose logs --tail 100 api                      # json-file driver logs
ls -la ./backups/                                       # athlos-<ts>.sql.gz from entrypoint backup
```

### Migrations

`RUN_MIGRATIONS=true` is set in the compose `environment:` block, so every `docker compose up -d` runs migrations before the API starts. Subsequent restarts are no-op (idempotent).

### Manual 0033 + 0034 comprobante + note idempotency rollout

`0033_ctacte_comprobante_retries.sql` and `0034_ctacte_movement_notes_idempotency_key_full_unique.sql` are deliberately outside the incomplete Drizzle production journal. Do not run `pnpm db:migrate` for this rollout. Before any API deployment, take and verify a database backup, then run these host commands in this exact order; each command stops on SQL error and executes as one transaction:

```bash
docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction -U athlos -d athlos < packages/db/drizzle/0031_ctacte_movement_notes.sql
docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction -U athlos -d athlos < packages/db/drizzle/0032_ctacte_payment_idempotency.sql
docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction -U athlos -d athlos < packages/db/drizzle/0033_ctacte_comprobante_retries.sql
docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction -U athlos -d athlos < packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql
docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 -U athlos -d athlos -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'tesoreria' AND table_name = 'ctacte_comprobante_retries' ORDER BY column_name; SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'tesoreria.ctacte_comprobante_retries'::regclass AND contype = 'c'; SELECT indexname FROM pg_indexes WHERE schemaname = 'tesoreria' AND tablename = 'ctacte_comprobante_retries' AND indexname = 'ctacte_comprobante_retries_expires_at_idx'; SELECT indexdef FROM pg_indexes WHERE schemaname = 'socios' AND tablename = 'ctacte_movement_notes' AND indexname = 'ctacte_movement_notes_idempotency_key_unique';"
```

The final SELECT on `socios.ctacte_movement_notes` MUST return a `UNIQUE INDEX` definition WITHOUT a `WHERE` clause — that confirms migration 0034 replaced the partial index from 0031.

Deploy the API only when every migration and the verification query succeeds. The PR deployment note must state that this manual 0031 → 0032 → 0033 → 0034 sequence is required before rollout; this procedure does not apply a migration or deploy an image.

### Backups

`BACKUP_BEFORE_MIGRATE=true` runs `scripts/backup.sh` to `$BACKUP_DIR` (mounted to `./backups` on the host) before every migration. See `deployment-devops/spec.md` for the full backup strategy (B1a's daily cron writes to the same path).

### Rollback

To redeploy a previous image tag:

```bash
docker compose pull
IMAGE_TAG=<old-sha> docker compose up -d
```

### One-off migration

```bash
docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'
```

### Health checks

The `api` container healthcheck hits `/health/ready` every 30s. The `db` container healthcheck runs `pg_isready`. Both must be healthy for the stack to be considered ready.

### Logs

```bash
docker compose logs -f api        # follow
docker compose logs --tail 200 api # recent
```

Logs are stored via the `json-file` driver with `max-size: 10m, max-file: 3` rotation.

## Promotion Pipeline

The promotion pipeline moves data from VFP source files → `raw_events` → `*_projection` tables → **master tables**. The master tables are what the API queries at runtime.

### How to run promotion (CLI vs API)

**CLI** (full `domain: 'all'`, ~60–90s on live DB):

```bash
DATABASE_URL=postgresql://athlos:athlos@100.78.95.34:5432/athlos pnpm db:promote
```

**API** (single-domain or full, ADMIN role required):

```bash
# Full promotion
curl -X POST http://localhost:3001/api/v1/promote/trigger \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{}'

# Single domain
curl -X POST http://localhost:3001/api/v1/promote/trigger \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"domain": "socios"}'

# Check status
curl http://localhost:3001/api/v1/promote/status \
  -H "Authorization: Bearer $ADMIN_JWT"
```

> **Recommendation**: Use the API for single-domain promotions (<10s, no NGINX timeout risk). Use the CLI for full `domain: 'all'` promotions.

### The 8 master tables + their natural keys

| Domain     | Master table                | Natural key (legacy)       | legacy_id source                              |
| ---------- | --------------------------- | -------------------------- | --------------------------------------------- |
| `socios`   | `socios.socios`             | `numero_socio`             | `deterministicUuid('socios:'+numeroSocio)`    |
| `escuela`  | `socios.escuela`            | `codigo`                   | `deterministicUuid('escuela:'+codigo)`        |
| `deportes` | `deportes.disciplinas`      | `codigo`                   | `deterministicUuid('deporte:'+codigo)`        |
| `locacion` | `socios.locacion`           | `(tipo_principal, numero)` | `deterministicUuid('locacion:'+tipo\|numero)` |
| `caja`     | `tesoreria.caja_movimiento` | 4-tuple                    | `deterministicUuid('caja:'+4-tuple)`          |
| `gastos`   | `tesoreria.gastos`          | 5-tuple                    | `deterministicUuid('gastos:'+5-tuple)`        |
| `ctacte`   | `tesoreria.ctacte`          | 5-tuple                    | `deterministicUuid('ctacte:'+5-tuple)`        |
| `ctacte1`  | `tesoreria.ctacte1`         | 5-tuple                    | `deterministicUuid('ctacte1:'+5-tuple)`       |

**Promotion order** (topological by FK dependency):

```
socios → escuela → deportes → locacion → caja → gastos → ctacte → ctacte1
        ↑                                              ↑
   independent                                 FK: ctacte1.ctacte_id → ctacte.id
```

### The `promoted_at` audit column

`raw_events.promoted_at` tracks which source rows have been promoted to master tables.

```sql
-- Per-domain promotion status
SELECT
  source_table,
  count(*) AS total,
  count(promoted_at) AS promoted,
  count(*) - count(promoted_at) AS pending
FROM public.raw_events
GROUP BY source_table
ORDER BY source_table;
```

Expected output post-E2:

| source_table |   total | promoted | pending |
| ------------ | ------: | -------: | ------: |
| socios       |  39,357 |   16,383 |  22,974 |
| ctacte       | 326,275 |        0 | 326,275 |
| ctacte1      | 245,370 |        0 | 245,370 |
| escuela      |      66 |        0 |      66 |
| deportes     |      32 |        0 |      32 |
| locacion     |      89 |        0 |      89 |
| caja         |   8,145 |        0 |   8,145 |
| gastos       |   2,114 |        0 |   2,114 |

> **Note**: `socios` shows 16,383 promoted (the current master table count). The 22,974 pending are pre-E1a orphan rows that lack `legacy_id` and cannot be matched for backfill.

### Cross-run idempotency contract

Re-running `pnpm db:promote` or `POST /api/v1/promote/trigger` is **idempotent**:

- `inserted` = 0 (no new rows inserted)
- `skipped` = total projection rows (all filtered by `promoted_at IS NULL` + dedup)
- `failed` = 0 (no errors on re-run)

Three layers of protection:

1. **`WHERE raw_events.promoted_at IS NULL`** — skips rows already stamped as promoted
2. **`master.legacy_id` UNIQUE INDEX** — blocks duplicates at the DB level
3. **`ON CONFLICT DO NOTHING`** — no-op on conflict (belt-and-suspenders)

### Admin API: `POST /api/v1/promote/trigger`

| Attribute     | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Method + Path | `POST /api/v1/promote/trigger`                                            |
| Auth          | `requireRole('ADMIN')` (JWT Bearer)                                       |
| Rate limit    | 1 request / 60s per operator (via `@fastify/rate-limit`)                  |
| Request body  | `{}` (defaults to `domain: 'all'`) or `{"domain": "socios"}`              |
| Timeout       | 120s (avoids NGINX `proxy_read_timeout 60s` cut-off)                      |
| Response 200  | `{ status: 'completed', inserted, skipped, failed, durationMs, domains }` |
| Response 200  | `{ status: 'already_running' }` (concurrent trigger guard)                |
| Response 401  | Unauthorized (no/invalid JWT)                                             |
| Response 403  | Forbidden (non-ADMIN role)                                                |
| Response 429  | Rate limit exceeded (`Retry-After` header)                                |
| Audit row     | 1 × `audit_events` with `action: 'PROMOTE_TRIGGER'` per trigger           |

`GET /api/v1/promote/status` returns the last 20 promotion runs from `audit_events`.

### Known Limitations

| ID      | Description                                                                       | Future slice              |
| ------- | --------------------------------------------------------------------------------- | ------------------------- |
| N7      | `caja_detalle` has 122 wide columns — deferred to future slice                    | N7                        |
| N8      | `deportes.inscripciones` rebuild needs a `*_inscripciones_projection` table       | N8                        |
| ~~N14~~ | ~~~107k ctacte1 orphan rows stuck at ~61% promotion rate (stale `entity_uuids`)~~ | **CLOSED in E3 (v0.5.7)** |
| N16     | `gastos` has no FK to `ctacte` via `cctcuenta` (flat ledger in v1)                | N16                       |

**N14 CLOSED in E3 (v0.5.7)**: ctacte/ctacte1 now promote directly from `raw_events` via `legacy_id` (a deterministic UUIDv5-like from the 5-tuple natural key). Promotion rate:

- `tesoreria.ctacte`: 200,945 rows (~78% of 256,088 unique natural keys; 55k FK-blocked by orphan socio)
- `tesoreria.ctacte1`: 152,797 rows (~62.3% of 245,370 total raw_events; limited by 17k parent ctacte FK failures + 75k duplicates with NULL legacy_id)
- Remaining ~38% ctacte1 gap is structural: 75k duplicate 5-tuples (UNIQUE INDEX allows one legacy_id per natural key) + 17k orphan parents (CCTCUENTA=0 sentinel or socio not in master) — neither is addressable in MVP without importing additional data.

**N16 detail**: `gastos` intentionally has no `socio_id` or `ctacte` FK in v1. The ledger is flat — each `gastos` row stands alone. FK reconstruction is deferred.

**E3 NEW**: `raw_events.legacy_id` is the source-of-truth dedup key for ctacte/ctacte1. The `entity_uuids` table is no longer consulted for these domains. The legacy_id is computed at-import time by the SQL `promotion_deterministic_uuid()` function (mirrors the TypeScript `deterministicUuid()` byte-for-byte; verified by `uuid-parity.test.ts`). The partial UNIQUE INDEX (`WHERE legacy_id IS NOT NULL`) accommodates domains that don't have a natural key.

---

## CI/CD

### Deploy flow

Athlos uses one-way promotion lanes. Direct commits to `beta` and `production` are forbidden:

1. Feature branches merge into a green `main`; this never deploys an environment.
2. A promotion PR from `main` to `beta` creates the next `vX.Y.Z-beta.N` tag and deploys the isolated beta stack.
3. A promotion PR from `beta` to `production` creates `vX.Y.Z` and deploys production.
4. The stable version in every workspace `package.json` must be bumped on `main` before starting a new release train. Stable tags are immutable and cannot be reused.
5. Hotfixes branch from `production`, then synchronize back through `beta` and `main`.

The reusable GitHub Actions `deploy.yml` runs for each release lane:

1. Install + lint + typecheck + test (fail fast on regression)
2. Build the API and web images with buildx + independent GHA caches
3. Push both images to GHCR with `:latest` and `:main-<sha>` tags
4. Deploy job (production environment approval required) runs after both immutable digest handoffs
5. An ephemeral `tag:ci` Tailnet runner joins before connectivity checks
6. The runner materializes a restricted SSH key and pinned known-host file in `$RUNNER_TEMP` with mode `0600`, without logging either value
7. `scripts/deploy/request.sh preflight` performs the restricted, read-only SSH preflight using both canonical immutable images and the fixed target contract
8. `scripts/deploy/request.sh deploy` makes the only remote deployment request after preflight succeeds
9. The runner removes the temporary SSH files regardless of the request outcome

### Beta runtime foundation

The beta stack shares the host but not runtime state. It remains dormant until the release-promotion workflow is enabled:

- Web: `http://100.78.95.34:3100`
- API: `http://100.78.95.34:4100`
- Database: `athlos_beta`
- Compose project: `athlos-beta`
- Environment: `beta`

### Deployment boundaries

- The workflow deploys only immutable API and web digests produced by its `publish` job.
- The server gate verifies API readiness, the web login route, and both running image identities.
- During the first web container deployment, the gate stops the legacy PM2 process. It restores PM2 if the container deployment fails and removes the PM2 process after success.
- The only deploy-target metadata enforced by CI contracts is:
  - `DEPLOY_HOST=100.78.95.34`
  - `DEPLOY_PORT=2244`
  - `DEPLOY_USER=vlongo`
  - `DEPLOY_PATH=/srv/apps/athlos`

### Beta Compose synchronization protocol

`docker-compose.beta.yml` in the checked-out repository is the sole canonical
non-secret beta deployment configuration. The beta client allowlists exactly
`$GITHUB_WORKSPACE/docker-compose.beta.yml`, snapshots those bytes, computes a
lowercase SHA-256, and sends the snapshot on SSH stdin with the hash in the
forced-command arguments. It never sends `.env.beta`, environment values, or an
arbitrary path; no SCP, SFTP, rsync, or server Git pull is part of this flow.

Roll out server-first, without changing the installed gate in this repository:

1. The server administrator backs up the root-owned gate and installs the
   reviewed `server-gate.sh` as `/usr/local/sbin/athlos-deploy-gate`, mode `0755`.
2. Keep the existing forced-command `authorized_keys` entry and verify the
   old production `preflight`/`deploy` protocol still succeeds before enabling
   any beta workflow run. Production accepts no stdin or config argument.
3. Confirm the destination `/srv/apps/athlos/docker-compose.beta.yml` is a
   regular non-symlink file, then run the repository checks and an approved
   beta preflight. Preflight validates the artifact, hash, Compose, and beta
   invariants without installing it.
4. Only after that evidence is reviewed may the protected beta deploy request
   install the artifact atomically and run the beta readiness checks.

The gate bounds the beta payload at 1 MiB, requires exact EOF and matching
lowercase SHA-256, uses restrictive temporary files on the destination
filesystem, and rejects malformed commands, symlink destinations, invalid
Compose, and invalid beta ports/network/storage policy. An identical artifact
retry is idempotent.

The beta transaction rollback boundary is the destination Compose file only:
the prior file is preserved before installation and restored after any
post-install pull, startup, image-identity, or readiness failure. This does
not roll back container images, database state, or application data. Evidence
must include the checked-out artifact hash, gate preflight output, the exact
operation/hash contract, unchanged destination after preflight, and—after a
failed deploy—a read-only comparison proving restoration.

### Connectivity boundary

- `publish` emits canonical `ghcr.io/victor0451/athlos-{api,web}@sha256:<digest>` references for both restricted requests.
- If the workflow must be withdrawn, revert the workflow and Compose configuration, then restore the PM2 web process from `/srv/config/athlos/ecosystem.config.js`.
- If `deploy.yml` or its contracts change, rerun:
  - `actionlint .github/workflows/{deploy,test}.yml`
  - `shellcheck scripts/deploy/request.sh scripts/tests/deploy-workflow.test.bats`
  - `bats scripts/tests/deploy-workflow.test.bats`

### GitHub Secrets

| Secret                             | Purpose                                                                                           | Rotation              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------- |
| `DEPLOY_HOST`                      | Server IP (current: `100.78.95.34`; switch when prod host is provisioned)                         | When server changes   |
| `DEPLOY_SSH_KEY`                   | Long-lived ed25519 deploy key, restricted via `authorized_keys` `command=` + `from=` GitHub IPs   | Quarterly             |
| `DEPLOY_KNOWN_HOSTS`               | Pinned `[100.78.95.34]:2244` host-key line; written only to the runner temporary known-hosts file | When host key rotates |
| `DEPLOY_TAILSCALE_OAUTH_CLIENT_ID` | OAuth client ID for ephemeral `tag:ci` GitHub runner nodes                                        | When client rotates   |
| `DEPLOY_TAILSCALE_OAUTH_SECRET`    | OAuth client secret for ephemeral `tag:ci` GitHub runner nodes                                    | When client rotates   |
| `GITHUB_TOKEN`                     | Automatic (used for GHCR push)                                                                    | Automatic             |

### db-destructive label

Auto-applied by `actions/labeler@v5` when a PR touches `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**`. `check-destructive.yml` then requires either a backup URL (matching `https://.*\.sql\.gz` in a PR comment) OR `/backup-skipped` directive in PR body. Both paths log to the workflow summary for audit.

### Application recovery

PR2 does not define automatic image rollback or application readiness verification. Handle application recovery under a separately approved operator procedure; this workflow must not be treated as evidence that either behavior is implemented.

### Server hardening (one-time setup, NOT automated by CI)

- Install `scripts/deploy/server-gate.sh` as root-owned mode `0755` at `/usr/local/sbin/athlos-deploy-gate`.
- `authorized_keys` entry for the dedicated deploy key uses `command="/usr/local/sbin/athlos-deploy-gate"` + `from="100.64.0.0/10"` (Tailnet addresses only) + `restrict,no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`.
- The gate accepts the backward-compatible production `preflight|deploy <api-image> <web-image>` commands with empty stdin, plus beta `preflight-beta|deploy-beta <api-image> <web-image> <lowercase-sha256>` with the exact Compose artifact on stdin.
- The root-installed gate authority remains out-of-band; repository changes do not install, replace, or mutate it automatically.
- Tailnet ACLs must separately allow only `tag:ci` to reach `100.78.95.34:2244`; the SSH source restriction is defense in depth, not an ACL replacement.
- Quarterly key rotation: `ssh-keygen -t ed25519` on server, update GitHub Secret, remove old public key from `authorized_keys`

### Quarterly key rotation

See `docs/security.md` (TODO) for the rotation procedure.
