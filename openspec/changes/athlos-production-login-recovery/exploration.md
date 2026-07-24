## Exploration: Production Login Recovery

### Current State
The verified 42P01 failures are explained by missing physical schema: `operators` and `refresh_tokens` are created by migration `0001_funny_eternals.sql`; `job_runs` by `0003_futuristic_gamma_corps.sql`. Login reads `operators` before writing a refresh token, while the scheduler writes `job_runs`; both therefore fail despite `/health/ready` returning 200 because readiness only executes `SELECT 1`.

Repository migration safety is currently unreliable for an emergency auto-apply. The migration journal ends at `0020`, while SQL files continue through `0036`; prior project evidence also records an incomplete production journal. A database containing only `audit_events` cannot safely receive an unqualified Drizzle migration run: `0000` attempts to create `audit_events` again, and the current journal/state must be inspected before any mutation.

The web proxy uses `API_INTERNAL_URL`, defaulting to `http://localhost:3001`. The production web runtime lacks that variable, so containerized web likely calls itself rather than the API. The proxy has no error handling or direct coverage; a rejected upstream fetch becomes an empty Next.js 500.

Compose and the runbook drift from the intended deployment model: checked-in Compose defines only `api`, healthchecks `/health`, and does not declare database dependency/readiness; documentation claims `api` plus `db`, migration startup, and `/health/ready`. Tests use stand-in databases, so they prove login and readiness logic but do not prove a real migrated schema, web proxy reachability, or production configuration.

### Affected Areas
- `packages/db/drizzle/0000_quick_wraith.sql`, `0001_funny_eternals.sql`, `0003_futuristic_gamma_corps.sql`, `meta/_journal.json` — baseline schema and migration-history mismatch; direct production application is unsafe without classification.
- `docker-entrypoint.sh`, `packages/db/src/scripts/status.ts` — migration startup and status inspection exist, but status assumes `__drizzle_migrations` and does not prove required tables.
- `apps/api/src/services/login.ts`, `packages/db/src/schema/operators.ts` — login requires `operators` and writes `refresh_tokens`.
- `packages/db/src/schema/job-runs.ts`, `packages/scheduler/src/run-tracker.ts` — scheduler requires `job_runs`.
- `apps/api/src/routes/health.ts`, `apps/api/src/routes/health.test.ts`, `docker-compose.yml` — readiness currently proves connectivity only; Compose probes liveness (`/health`).
- `apps/web/src/app/api/v1/[...path]/route.ts` — proxy needs a reachable explicit internal API URL and an upstream-failure contract.
- `.env.example`, `docs/runbook.md` — deployment inputs and operator procedure need an explicit schema/preflight and web-proxy section; they currently contradict checked-in Compose.
- `apps/api/src/routes/auth.test.ts`, `apps/api/src/services/login.test.ts`, `apps/web/src/lib/auth.test.ts` — existing tests are stand-in/mocked; add real-Postgres schema readiness and proxy failure/success coverage.
- `/run/media/vlongo/Archivos/Projectos/Athlos-worktrees/pr2-recovery-finalize` — isolated, uncommitted PR2 recovery must remain a separate delivery candidate.

### Approaches
1. **One urgent recovery PR** — Combine controlled schema recovery tooling/runbook, web proxy configuration, readiness, tests, and Compose reconciliation.
   - Pros: one narrative and one rollout.
   - Cons: exceeds the 400-line budget, combines irreversible database operations with deployment/config changes, conflicts with PR2 files (`.env.example`, `docs/runbook.md`, deploy workflow), and widens rollback.
   - Effort: High.

2. **Operational recovery first, then small repository PRs** — Perform a separately approved operator-only recovery from a verified backup or a rehearsed clone; deliver repository protections as independent work units.
   - Pros: restores service without waiting for code review; preserves evidence; isolates forward-only schema risk; each PR can stay under 400 lines and roll back independently.
   - Cons: requires a maintenance decision and a disciplined evidence record before any production mutation.
   - Effort: Medium.

### Recommendation
Use approach 2.

**Emergency operator remediation (not a repository change, not authorized by this exploration):** freeze deploys; take and integrity-check a fresh `pg_dump`; record database identity, `public` tables, non-public schemas, extensions, row counts, and `__drizzle_migrations` state; restore the dump to an isolated clone; determine whether a known-good full backup can be restored or whether a reviewed, idempotent recovery sequence is needed. Do not run `pnpm db:migrate` against the incident database until that clone proves the exact sequence preserves `audit_events` and creates every required table. Validate a real synthetic login and scheduler write only after schema recovery. Set the web runtime's `API_INTERNAL_URL` to the actual API network address, then validate proxy login separately.

**Repository delivery/dependency graph:**

```text
PR2 recovery: commit/archive state in its isolated worktree -> push -> PR/review
                                                        (no file sharing)
operator backup + read-only preflight -> clone rehearsal -> approved schema recovery
                                                        -> direct API synthetic login
web API_INTERNAL_URL configuration --------------------> proxy synthetic login
schema-aware readiness + tests ------------------------> deploy gate / future regression prevention
Compose/runbook reconciliation ------------------------> follow-up after PR2 lands (likely conflict-prone)
```

Protect PR2 by making no changes in `pr2-recovery-finalize`; commit its archived form there only after a fresh scoped diff/review, push `feat/deploy-connectivity-pr2-recovery-finalize`, and open its PR before staging any recovery files. Create recovery branches from a clean base in a different worktree. Do not cherry-pick, reset, clean, archive, or stage PR2 files from the recovery worktree. Its archive is present on disk but currently uncommitted, so it is not yet delivery-safe.

The smallest first repository slice is **schema-aware API readiness plus real-Postgres tests**: readiness must fail closed when `operators`, `refresh_tokens`, or `job_runs` is absent, while retaining non-sensitive diagnostics; test the 42P01-equivalent missing-table state and the ready state. Keep it independent of Compose, proxy, and migration changes. Estimated scope: 3–5 files and under 400 changed lines. Its rollback is a code/image rollback only; it does not mutate database data. The next slice should make `API_INTERNAL_URL` required/validated in the web runtime and return a bounded gateway error rather than an empty 500, with proxy tests. A final, separately reviewed slice reconciles Compose and the runbook after PR2 is delivered.

### Risks
- Restoring a backup can discard writes after the backup; applying baseline migrations to a partially initialized database can fail or create an incoherent schema. Require a timestamped verified backup, clone rehearsal, row-count/audit preservation checks, and explicit maintenance approval.
- The Drizzle journal does not cover all checked-in SQL; status tooling may report misleading pending/divergent state and must not be treated as schema proof.
- `audit_events` may contain incident-relevant history. No recovery plan may truncate, replace, or silently overwrite it; preserve a dump hash and post-action counts.
- Proxy configuration may be correct for one topology and wrong for another. The selected internal URL must be proven from the web container/runtime network, never inferred from the browser URL.
- Current readiness and container health can remain green while business-critical tables are absent; a schema check must be bounded, non-mutating, and free of sensitive detail.
- PR2 has uncommitted archive-state changes in an isolated worktree. Editing shared files or using broad staging/reset commands risks losing its audit trail or mixing its 620-line candidate into recovery work.

### Ready for Proposal
Yes — propose a multi-slice, ask-on-risk change. The user should approve the operator recovery gate separately from code delivery. Before implementation, preserve and open PR2 from its isolated worktree; then implement only the schema-aware readiness slice first. The 400-line budget requires a decision before any combined Compose/runbook/proxy work; do not accept a single urgent PR without an explicit `size:exception` and operational rollback plan.
