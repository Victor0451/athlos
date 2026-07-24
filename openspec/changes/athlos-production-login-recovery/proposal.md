# Proposal: Athlos Production Login Recovery

## Intent

Restore operator login without treating migration history as schema proof. Preserve evidence, rehearse on a clone, and prevent false-ready deployments.

## Scope

### In Scope
- P0 read-only inventory, verified backup, clone rehearsal, and restore-versus-repair decision.
- Audited first-administrator bootstrap only when no operator is recoverable; execution requires separate approval.
- Migration/bootstrap safety tooling, production `API_INTERNAL_URL`, schema readiness, real-Postgres/proxy tests, and runbook.
- Parallel PR2 delivery from its isolated worktree with distinct ownership and delivery boundaries.

### Out of Scope
- Production migration, bootstrap, deploy, or mutation without later authorization.
- Secret creation/storage, unrelated schema redesign, or mixing PR2 and incident-recovery candidates.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `database-migrations`: Add preflight, rehearsal, abort gates, and recovery/bootstrap rules.
- `auth-login`: Define operator verification, audited administrator bootstrap, and login validation.
- `config-environment`: Require production `API_INTERNAL_URL`.
- `monitoring-observability`: Fail readiness when required tables are absent.
- `deployment-devops`: Define approval gates, isolated delivery tracks, and rollback.
- `error-handling`: Bound proxy failures while preserving upstream 401 responses.

## Approach

Freeze mutation; inventory database identity, schema, counts, extensions, and history; verify a dump; restore to a clone; rehearse while preserving `audit_events`. Deliver safeguards as work units under 400 changed lines. PR2 advances independently under its owner.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/db/`, `scripts/` | Modified | Recovery safety tooling |
| `apps/api/src/routes/health.ts` | Modified | Required-table readiness checks |
| `apps/web/src/app/api/v1/[...path]/route.ts` | Modified | Explicit upstream and proxy contract |
| `.env.example`, `docs/runbook.md` | Modified | Configuration and recovery gates |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Data loss or incoherent schema | High | Verified dump, clone rehearsal, count/hash checks, approval gate |
| PR2 contamination | Medium | Separate owner/worktree/branch/PR; no shared staging |
| False readiness/proxy target | High | Real Postgres and contract tests |

## Rollback Plan

Abort on failed backup integrity, uncertain database identity/history, rehearsal mismatch, lost audit rows, missing approval, or mixed diffs. Repository slices revert independently. Production recovery uses the preserved dump and documented restore decision; no unproven reverse migration.

## Dependencies

- Read access, backup storage, PostgreSQL clone, designated owners, and execution approval.

## Success Criteria

- [ ] Inventory, verified backup, clone rehearsal, decision record, abort criteria, and ownership are auditable.
- [ ] Invalid synthetic login returns 401 directly and through the web proxy.
- [ ] Valid login succeeds only after a preserved/recovered operator is verified.
- [ ] Readiness returns 503 when `operators`, `refresh_tokens`, or `job_runs` is absent.
- [ ] No production mutation or PR2 scope mixing occurs in planning/apply by default.
