# Proposal: db-status-and-drift-gate

- **Change name:** `db-status-and-drift-gate`
- **Date:** 2026-06-18
- **Phase:** proposal
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** proposed
- **Branch base:** `origin/main`
- **Delivery:** single PR, expected ~250 changed lines (well below 400-line review budget)
- **Target version bump:** `0.4.0 → 0.4.1` (patch, ops-only, no user-facing feature change) — bumped at PR close per project convention
- **Slice:** A of 4 — first autonomous slice of the future `athlos-deploy` chained series. Slices B (backup/restore/grants), C (Dockerfile+compose), D (CI deploy workflow) are SEPARATE future changes.

---

## Intent

This change delivers the **foundational slice of deploy automation**. It closes three concrete operational gaps that already exist today:

1. **Operators have no real `pnpm db:migrate:status` command.** The runbook (`docs/runbook.md:7`) tells every operator to run it before every deploy. It does not exist in `packages/db/package.json`. Operators currently have to read `__drizzle_migrations` by hand.
2. **CI never checks for schema drift.** `database-migrations/spec.md:121-124` mandates `drizzle-kit check` as the drift gate, and `spec.md:133` says "CI blocks merges when `drizzle-kit check` fails". The current `test.yml` does not run it. Any developer who edits the live DB via `psql` and forgets to commit a generated migration ships undetected drift.
3. **The runbook instructs operators to run a command that does not exist AND contradicts the spec.** `docs/runbook.md:61-67` documents `pnpm db:migrate:rollback --to 0009_domain_freshness`. That script is not in `packages/db/package.json`. Worse, `database-migrations/spec.md:56` explicitly mandates **forward-only rollback** ("Rollback SHALL be forward-only — no down migrations"). An operator following the runbook during an incident will panic when the command fails. **This is operational risk that this change MUST fix as part of Slice A.**

Without this change, the runbook misleads operators, drift ships silently, and every "first slice" of the future deploy roadmap stays blocked.

---

## Scope

### In Scope

| # | Deliverable | One-line justification |
|---|-------------|------------------------|
| 1 | `packages/db/src/scripts/status.ts` + `packages/db/src/scripts/status.test.ts` (Vitest, strict TDD) | Implements the real `pnpm db:migrate:status`: reads `__drizzle_migrations` via Drizzle migrator API, lists committed `.sql` files in `packages/db/drizzle/` (excluding `meta/`), computes `applied ∩ local` (OK) / `applied − local` (DIVERGENCE — DB has rows not in filesystem) / `local − applied` (PENDING — filesystem has files not yet applied). Exits `0` if all migrations applied AND no divergence, `1` otherwise. Human-friendly text output by default; `--json` flag emits machine-readable JSON for CI. |
| 2 | `pnpm db:migrate:status` script wired in `packages/db/package.json` (and surfaced at root if the existing `db:*` namespace there mirrors it) | Operator-facing entry point referenced by the runbook. |
| 3 | `drizzle-kit check` step added to `.github/workflows/test.yml` as a new job (or step) that runs against the existing Postgres service | CI drift gate per `database-migrations/spec.md:121-124` and `spec.md:133`. Fails the build if schema drift detected. |
| 4 | `docs/runbook.md` reconciliation: drop the `pnpm db:migrate:rollback --to 0009_domain_freshness` block (lines 61-67) and any related forward-only-contradicting references; replace with the forward-only narrative: "to roll back, re-deploy a previous image tag; migrations are forward-only by spec (`database-migrations/spec.md:56`)" | Removes the misleading instruction that contradicts the spec. Keep the "re-deploy previous image/tag" subsection as-is (already correct, lines 69-73). |

### Out of Scope

- **Slices B / C / D of the future deploy automation series** — these are SEPARATE future changes:
  - Slice B: `scripts/backup.sh` + `restore.sh` + `grant-data-steward.sh` (~350 LoC)
  - Slice C: production `Dockerfile` + `docker-entrypoint.sh` + real `docker-compose.yml` (~280 LoC)
  - Slice D: `.github/workflows/deploy.yml` + `check-destructive.yml` + `.github/labeler.yml` (~250 LoC)
- **Adding a `db:migrate:rollback` script** — would contradict `database-migrations/spec.md:56`. Forward-only is the contract. The runbook fix removes the reference instead.
- **Auto-rollback on smoke failure** — separate post-Slice-D follow-up.
- **Secrets manager migration** (Vault, AWS SM) — env-var injection is the v1 contract per `deployment-devops/spec.md:108`.
- **Multi-region / blue-green / canary deploys** — Athlos is single-node Postgres; defer until scale demands.
- **`.env.example` updates for backup-related vars** (`RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BACKUP_BUCKET`, `BACKUP_DIR`) — that's Slice B / C / D.
- **Replacing the placeholder `Dockerfile` (8L) or `docker-compose.yml` (65L)** — Slice C.
- **The `db-destructive` PR label + CI guard** — Slice D.

---

## Approach

Execute as a **single linear PR** in this order so each commit is reviewable in isolation. Strict TDD is mandatory: every TS line lands via RED → GREEN → REFACTOR, traceable in `apply-progress`.

1. **Tests first (RED).** Write `status.test.ts` covering: empty DB → all-pending, fully applied DB → all-ok, DB has row not in filesystem → divergence, filesystem has file not in DB → pending (PENDING is non-zero exit per spec), `--json` shape, exit codes. Tests run against a Vitest Postgres fixture (or a `pg-mem` mock if `pg-mem` is already in the tree — verify in apply).
2. **Implementation (GREEN).** `status.ts` calls `drizzle-orm`'s migrator introspection (no manual SQL-file parsing — the journal already enumerates them). Read filesystem with `node:fs/promises`, compute the three-set diff, format output, set `process.exitCode`.
3. **Refactor.** Extract a pure `diffMigrations(applied, local)` function for testability. Keep CLI wrapper minimal.
4. **Wire `pnpm db:migrate:status`** in `packages/db/package.json` (`"status": "tsx src/scripts/status.ts"`) and at root if the existing `db:*` namespace mirrors it (verify during apply — pattern follows `db:smoke`).
5. **Add CI step.** New job `drift-check` in `.github/workflows/test.yml` that reuses the existing Postgres service, installs `@athlos/db`, runs `pnpm --filter @athlos/db exec drizzle-kit check`. Runs after `pnpm test:run` + `pnpm typecheck` succeed (so a green `drift-check` does not hide a failing test suite).
6. **Runbook fix as a separate commit in the same PR.** Easy to review in isolation. Add a one-line deprecation note above the old rollback block: `<!-- DEPRECATED 2026-06-18: forward-only by spec, see corrected procedure below -->` — preserved for anyone whose snippets still match.
7. **Open the PR.** Title: `chore(db): migrate status script + CI drift gate + runbook forward-only fix`. Description summarizes the 4 buckets and links this proposal.
8. **PR close (separate commit on merge).** Bump root + `@athlos/db` `package.json` to `0.4.1`; prepend `[0.4.1]` to `CHANGELOG.md`; merge. NO bump or CHANGELOG edit during the PR per project convention.

---

## Affected Areas

| Path | Impact | Description |
|------|--------|-------------|
| `packages/db/src/scripts/status.ts` | **New** | ~80 LoC. The `pnpm db:migrate:status` implementation. Reads `__drizzle_migrations`, compares to `packages/db/drizzle/*.sql`, prints + exits. |
| `packages/db/src/scripts/status.test.ts` | **New** | ~60 LoC. Vitest suite covering empty / fully applied / divergence / pending / `--json` / exit codes. |
| `packages/db/package.json` | Modified | Add `"status": "tsx src/scripts/status.ts"` script. |
| `package.json` (root) | Possibly modified | Add `db:migrate:status` to root-level `db:*` namespace if `db:smoke` / `db:studio` are mirrored there. Verify during apply. |
| `.github/workflows/test.yml` | Modified | Add new `drift-check` job (or extend `test` job) that runs `drizzle-kit check`. ~20 LoC YAML. |
| `docs/runbook.md` | Modified | Drop lines 61-67 (`pnpm db:migrate:rollback` block); replace with forward-only narrative that points to `database-migrations/spec.md:56` and "re-deploy previous image/tag" subsection (already correct, lines 69-73). Keep deprecation note. ~15 LoC diff. |
| `package.json` (root) — at PR close | Modified | Bump `version` to `0.4.1` (NOT during PR). |
| `CHANGELOG.md` — at PR close | Modified | Prepend `[0.4.1]` entry (NOT during PR). |

No other files touched. No schema changes, no API changes, no dependency upgrades.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `status.ts` reads stale metadata if Postgres connection drops mid-query (returns a partial migration list, exits 0 incorrectly) | Low | Wrap the Drizzle introspection call in a single transaction with `SET LOCAL statement_timeout = '5s'`. On any error, exit 1 with the error on stderr. Tests cover the timeout/error path. |
| `drizzle-kit check` produces false positives in CI when snapshots lag behind the live schema (e.g., a developer generated a migration locally but didn't commit `meta/_journal.json`) | Medium | Pin `drizzle-kit` to the version in `packages/db/package.json` (already `^0.30.0`); add a `pnpm install --frozen-lockfile` pre-step (already present). Document in the workflow step name that "drift detected" always means "regenerate and commit a migration". |
| Runbook fix breaks someone's saved snippet of the old `db:migrate:rollback --to 0009_domain_freshness` line (they paste it during an incident and the command doesn't exist anymore — which is the WHOLE POINT, but they don't know) | Medium | Add the explicit deprecation note (`<!-- DEPRECATED ... -->`) above the old block AND link to the corrected procedure. The corrected procedure explicitly says "re-deploy previous image tag; migrations are forward-only by spec". |
| Strict TDD slows the change if a sub-agent skips RED and writes `status.ts` first | Low | Verify during `sdd-apply` that `apply-progress` shows the RED → GREEN → REFACTOR trace. Block the apply if RED is missing. |
| Version bump ambiguity (`minor` vs `patch`) if the user locks the wrong one | Low | This proposal recommends **patch** (no user-facing feature change). See Open Questions. |

---

## Acceptance Criteria

- [ ] `pnpm db:migrate:status` (run from repo root or `@athlos/db`) lists applied migrations with timestamps.
- [ ] `pnpm db:migrate:status` exits `0` if every filesystem migration is applied AND no DB row is missing from filesystem.
- [ ] `pnpm db:migrate:status` exits `1` if pending migrations exist OR if the DB has rows not represented in filesystem (divergence).
- [ ] `pnpm db:migrate:status --json` emits machine-readable JSON: `{ applied: [...], pending: [...], divergence: [...], exitCode: 0|1 }`.
- [ ] `pnpm test:run` passes with no regression (439+/439+ tests, same count as before this change).
- [ ] `pnpm typecheck` passes with 0 errors.
- [ ] `.github/workflows/test.yml` runs `drizzle-kit check`; the workflow is green on `main` and red on a branch where a developer edits the DB schema without committing a generated migration.
- [ ] `docs/runbook.md` no longer contains the string `db:migrate:rollback` anywhere; the corrected procedure references `database-migrations/spec.md:56` and the "re-deploy previous image/tag" subsection.
- [ ] Strict TDD followed: `apply-progress` shows RED → GREEN → REFACTOR for `status.ts`; tests committed before implementation.
- [ ] No AI co-author in any commit. Conventional Commits format.
- [ ] PR title matches the format from §Approach.

---

## Review Workload Forecast

- **Estimated changed lines:** ~250 (≈140 TS impl+test, ≈30 YAML, ≈30 docs, ≈50 misc / package.json / lockfile churn).
- **400-line review budget risk:** **LOW** — ~38% of budget used.
- **Chained PRs recommended:** **No** — this IS the smallest autonomous slice of the future 4-slice deploy series. No further slicing is needed within it.
- **Suggested split:** N/A. (The wider 4-slice split is documented in `openspec/changes/explore-athlos-deploy-scoping/exploration.md`; only Slice A is in this change.)
- **Note:** this is the FIRST of 4 future deploy automation changes. Slices B/C/D are out of scope here and will be separate proposals when their turn comes.

---

## Open Questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | **Version bump:** minor (`0.4.0 → 0.5.0`, "new operational tool") or patch (`0.4.0 → 0.4.1`, "ops-only")? | **Patch** (`0.4.0 → 0.4.1`). No user-facing feature change; no schema change; no API change. Operators get a new command, but the product surface is identical. |
| 2 | **Drift gate posture:** should `drizzle-kit check` in CI **block** merge, or just **warn** on PR? | **Block.** `database-migrations/spec.md:133` explicitly says "CI blocks merges when `drizzle-kit check` fails". Spec is the contract. Warning would silently drift the contract. |
| 3 | **`--json` schema:** should it match the existing `__smoke__.ts` output style (loose), or use a strict Zod-validated shape? | **Zod-validated.** Athlos uses Zod per `validation/spec.md`; the JSON output will be consumed by future CI tooling (Slice D's `check-destructive.yml`) and needs a stable contract. |
| 4 | **Anything else to lock before spec phase?** | Confirm with user. If silence, proceed with the recommendations above. |

---

## Capabilities

This section is the CONTRACT between this proposal and the `sdd-spec` phase.

### New Capabilities

None. The behavior this change introduces (status command, drift gate, runbook correctness) is already described under existing capabilities (`database-migrations`, `deployment-devops`). Slice A implements existing spec requirements; it does not introduce new spec territory.

### Modified Capabilities

| Capability | What requirement is changing |
|------------|------------------------------|
| `database-migrations` | Adds two NEW scenarios under the existing requirements (no requirement text changes, only scenario coverage): (1) under "Migration History" (`spec.md:101-111`), add a scenario for the `--json` flag and a scenario for the new "divergence" state (DB has rows not in filesystem); (2) under "Schema Snapshot" / "Drift detected" (`spec.md:118-124`), add a scenario for the new CI workflow job. |
| `deployment-devops` | None at the spec level for Slice A. The CI workflow touched in this change is `.github/workflows/test.yml` (the test pipeline), which `deployment-devops/spec.md` does not currently constrain. Slice C/D will introduce a deploy workflow that will modify this capability. |

---

## Source-of-Truth References

| Path | What it tells us |
|------|------------------|
| `openspec/changes/explore-athlos-deploy-scoping/exploration.md` | The 4-slice roadmap. Slice A is the first autonomous piece. |
| `openspec/specs/database-migrations/spec.md` | Lines 56, 101-111, 121-124, 133 — mandates status, check, forward-only, CI block. |
| `openspec/specs/deployment-devops/spec.md` | Defines the future deploy surface (out of scope for Slice A). |
| `docs/runbook.md` | Lines 7, 61-67 — references the missing status command and the non-existent rollback script. |
| `packages/db/package.json` | Scripts `generate`, `migrate`, `studio`, `smoke` — no `status` yet. |
| `packages/db/drizzle/` | 11 SQL migrations (`0000..0011`) + `meta/_journal.json` — the filesystem side of the comparison. |
| `packages/db/src/__smoke__.ts` | Pattern to follow for the `status.ts` script (DB connection + SELECT sanity). |
| `.github/workflows/test.yml` | 46 lines — Postgres service + test + typecheck. No drift gate. |
| `openspec/changes/athlos-docs-refresh/archive/2026-06-18/proposal.md` | Last cycle's proposal shape (single PR, no bump during PR, bump at close). |