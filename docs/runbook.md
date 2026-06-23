# Athlos Runbook

## Deploy Checklist

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
