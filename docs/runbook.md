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
