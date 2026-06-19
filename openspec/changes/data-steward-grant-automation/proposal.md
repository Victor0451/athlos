# Proposal: data-steward-grant-automation

| Field | Value |
|-------|-------|
| Change | `data-steward-grant-automation` |
| Date | 2026-06-19 |
| Phase | proposal |
| Artifact mode | both (Engram + OpenSpec) |
| Status | draft |
| Slice | B0 of deploy automation (B1 = backup/restore/S3, separate future change) |
| Estimated LoC | ~180 (single PR, well under 400-line budget) |
| Branch | `feature/data-steward-grant-automation` from `origin/main` |
| Target version | `v0.4.2` (patch — no schema/API/user-facing change; CLI is additive) |

## Intent

This change replaces the manual SQL block in `docs/runbook.md:26-43` (lines 26-43 of
the runbook) with a typed CLI: `pnpm ops:grant-data-steward --username <u>`. The CLI is
a thin wrapper around the existing `PermissionsRepo.grant()` at
`packages/db/src/repositories/permissions.ts:48-53`, which already handles idempotency
via `ON CONFLICT DO NOTHING` (the hard part is already done — Slice B0 is mostly a CLI
shell around it). The script also emits one `permission.granted` audit row per grant via
`emitAudit()` from `@athlos/audit/emitter`, mirroring the system-event pattern used by
`emitDriftAlert()`. Reporting supports a `--json` flag with Zod-validated output
(`{ granted: string[], alreadyGranted: string[], auditIds: string[] }`) so operators and
automation can verify the result without parsing prose.

Slice B0 has **zero external dependencies** — no S3, no IAM, no deploy-host wiring. It
unblocks operators from running raw SQL, gives them a verifiable audit trail, and lays
the foundation for Slice B1 (backup/restore/S3) without coupling the two slices.
Slice B1 stays a separate future change.

## Scope

### In Scope

| Path | Change | LoC | Why |
|------|--------|-----|-----|
| `packages/db/src/scripts/grant-data-steward.ts` | new | ~80 | CLI entry: arg parsing, operator lookup, calls `PermissionsRepo.grant()` in a loop, emits audit, formats output |
| `packages/db/src/scripts/grant-data-steward.schema.ts` | new | ~30 | Zod schema for `--json` output shape; mirrors `status.schema.ts` pattern |
| `packages/db/src/scripts/grant-data-steward.test.ts` | new | ~60 | Vitest cases — RED phase first (strict TDD). Covers happy path, idempotency, unknown username, JSON shape |
| `packages/db/package.json` | modify | +1 | Add `"grant:data-steward": "tsx src/scripts/grant-data-steward.ts"` |
| `package.json` (root) | modify | +1 | Add `"ops:grant-data-steward": "pnpm --filter @athlos/db grant:data-steward"` |
| `docs/runbook.md` | modify | ~10 net | Replace lines 26-43 with `pnpm ops:grant-data-steward --username <u>`; add deprecation note mirroring Slice A's rollback pattern |
| `openspec/changes/auth-login/spec.md` | modify (delta) | +1-2 scenarios | New scenario(s) for the automated grant path (MODIFIED capability) |

### Out of Scope

- **Slice B1 entirely** — `scripts/backup.sh`, `scripts/restore.sh`, `BACKUP_*`/`S3_*` env vars, compose `backup` service. Separate future change.
- **Granting arbitrary permission_keys** — script is hardcoded to `data_steward` for v1. Future `--key` flag is a v2 concern.
- **DB-query-based operator discovery** — `SELECT id FROM operators WHERE role='A'` was considered and **rejected** (privilege escalation footgun — auto-grants to all active admins).
- **Bulk CSV import** — repeat `--username` flags on one invocation is enough for v1.
- **UI for grant management** — operations script only.
- **Auto-revoke** — no spec demand; out of scope.
- **`OperatorsRepo.findByUsername()`** — no such repo exists today; the spec phase may add it OR the script may query the `operators` table directly via Drizzle (decision deferred to spec).
- **Modifying `PermissionsRepo.grant()` signature** — it currently returns `void` (no `RETURNING`). The spec phase will detect "already granted" via the existing `hasPermission()` instead, keeping the repo signature unchanged. (See Open Questions.)

## Approach

1. **Strict TDD (RED → GREEN → REFACTOR).** Write `grant-data-steward.test.ts` first; the orchestrator's `apply` sub-agent verifies the RED commit exists before any implementation lands.
2. **Reuse `PermissionsRepo.grant()` for the DB write.** No new SQL in this PR. Idempotency is already handled at the repo level.
3. **Reuse `emitAudit()` from `@athlos/audit/emitter`** for the audit trail. Mirror the pattern from `emitDriftAlert()`: `operatorId: null`, `action: 'permission.granted'`, `entityType: 'role_permission'`, `entityId: <operator-uuid>`, `payload: { permissionKey: 'data_steward', grantedBy: <granting-uuid-or-null> }`.
4. **Inline 10-line `parseArgv`** mirroring `packages/db/src/scripts/status.ts:136-138`. The repo has no `commander`/`yargs` dep; `status.ts` already established the inline pattern.
5. **Use `createDb()` from `@athlos/db`** (matches `__smoke__.ts:14-19` pattern) rather than raw `pg.Pool` (which `status.ts` does because it doesn't need Drizzle ORM features).
6. **Input sources (locked):** primary `--username <u>` (repeatable); bootstrap fallback `--from-env` flag reads `DATA_STEWARD_OPERATOR_IDS` (CSV of UUIDs). Explicit `--from-env` flag avoids ambiguity.
7. **Output (locked):** human-readable stdout by default; `--json` flag emits Zod-validated `{ granted: string[], alreadyGranted: string[], auditIds: string[] }`.
8. **Exit codes:** `0` = all grants succeeded (or were already granted); `1` = any operator not found / unknown error; `2` = cannot connect to DB. Matches `status.ts` semantics.
9. **Script lives at `packages/db/src/scripts/grant-data-steward.ts`** next to `status.ts` (Slice A sibling).

## Affected Areas

| Area | Path | Impact |
|------|------|--------|
| Code (new) | `packages/db/src/scripts/grant-data-steward.ts` | New CLI entry |
| Code (new) | `packages/db/src/scripts/grant-data-steward.schema.ts` | New Zod schema |
| Code (new) | `packages/db/src/scripts/grant-data-steward.test.ts` | New vitest suite (RED phase first) |
| Code (modify) | `packages/db/package.json` | +1 script line |
| Code (modify) | `package.json` (root) | +1 script line |
| Docs (modify) | `docs/runbook.md` | Replace lines 26-43 raw SQL; add deprecation banner |
| Specs (delta) | `openspec/changes/auth-login/spec.md` | +1-2 scenarios (MODIFIED capability) |
| Specs (this change) | `openspec/changes/data-steward-grant-automation/{proposal,specs,design,tasks}.md` | New change folder |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | **Idempotency regression in `PermissionsRepo.grant()`** — a future refactor drops `onConflictDoNothing()` and the CLI silently starts failing on retry with PG `23505`. | Low | The new test explicitly calls `grant()` twice and asserts: no error, no duplicate row, exactly one audit row (modulo the 10s `emitAudit` bucket — see R6). Test fails loudly if repo behavior regresses. |
| R2 | **Audit dedup bucket collision.** `emitAudit()` uses a SHA-256 hash with a 10-second bucket (`packages/audit/src/emitter.ts:36`). If two grants fire within 10s for the same operator with the same payload, only one audit row is emitted. | Low | Documented behavior; acceptable for the runbook use case (single-shot invocations ≥10s apart). Spec phase will assert this expectation in the test. |
| R3 | **Username resolution failure** — operator passes `--username alice` but the DB row is missing or inactive. | Med | Script resolves username → UUID via direct Drizzle query on `operators` table (or `OperatorsRepo.findByUsername()` if spec phase adds it). Fails fast with a clear error: `operator not found or inactive: alice`. Exit code 1. |
| R4 | **Strict TDD drift.** Apply sub-agent may skip RED phase. | Med | Orchestrator's `verify` step asserts a RED test commit precedes the GREEN impl commit. Slice A's lesson (apply may miss artifacts) directly motivates this guard. |
| R5 | **Operator muscle memory** — someone has the old SQL block saved in a personal runbook snippet. | Low | Deprecation banner in `docs/runbook.md` mirrors Slice A's `db:migrate:rollback` pattern (2026-06-18). The SQL block is removed, not just annotated. |
| R6 | **`grant()` returns `void` — no `RETURNING` clause** — the exploration claimed `ON CONFLICT DO NOTHING + RETURNING`, but the current implementation has only `onConflictDoNothing()` and resolves `Promise<void>`. To distinguish "newly granted" from "already granted", the script must call `hasPermission()` first. | Low | Spec phase will lock this: pre-check `hasPermission(operatorId, 'data_steward')` → if true, put in `alreadyGranted`; otherwise call `grant()` and put in `granted`. No repo signature change required. |

## Acceptance Criteria

- [ ] `pnpm ops:grant-data-steward --username <existing-operator>` exits 0; audit row created with `action='permission.granted'`, `operatorId=null`.
- [ ] Re-running the same command is idempotent: no error, no duplicate `role_permissions` row, audit count does not double (within the documented 10s dedup window).
- [ ] `pnpm ops:grant-data-steward --username <nonexistent>` exits 1 with `operator not found: <u>` on stderr.
- [ ] `pnpm ops:grant-data-steward --username <u> --json` returns a Zod-valid shape: `{ granted: string[], alreadyGranted: string[], auditIds: string[] }`.
- [ ] `pnpm ops:grant-data-steward --from-env` (with `DATA_STEWARD_OPERATOR_IDS` set) grants to all listed UUIDs and emits one JSON summary.
- [ ] `pnpm test:run` passes (existing 450 tests + new tests, no regression).
- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `grep -c "INSERT INTO role_permissions" docs/runbook.md` returns `0` (raw SQL block removed).
- [ ] Strict TDD traceable in `apply-progress`: a RED test commit precedes the GREEN impl commit.
- [ ] `openspec validate data-steward-grant-automation --strict` passes (specs phase artifact).
- [ ] No new external dependencies added to any `package.json`.

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | ~180 (80 script + 30 schema + 60 test + 2 package.json + 10 docs + ~5 misc) |
| 400-line chained-PR threshold | **LOW risk** — single PR fits comfortably |
| Chained PRs recommended | **No** — Slice B0 itself is one PR; Slice B1 is a separate change |
| Suggested split | N/A |
| Commit structure | 2 commits: (1) `feat(db): data steward grant CLI with --json output` (TDD trace), (2) `chore(release): v0.4.2` (closing bump, per project convention: no manual bumps during PR) |
| Review focus areas | (1) idempotency test, (2) audit emission pattern (operatorId=null), (3) username → UUID resolution, (4) Zod schema, (5) runbook deprecation banner |

## Open Questions for User

1. **Version bump target** — `v0.4.1 → v0.4.2` (patch — recommended; the CLI is purely additive, no schema/API change) OR `v0.4.1 → v0.5.0` (minor — if "deploy automation Slice B0" is considered a feature series start). **Recommend patch.** The Slice B0 closing-bump commit will apply at PR close (project convention).
2. **CLI parser choice** — Repo has no `commander`/`yargs`/`meow` dep; `status.ts` uses an inline 10-line `parseArgv`. **Recommend: inline parser**, mirrors `status.ts`. Adds zero deps and ~5 LoC. Confirm?
3. **`OperatorsRepo.findByUsername()` — introduce now or defer?** No such repo exists. Two paths: (a) script queries `operators` table directly via Drizzle (no new repo, ~5 LoC); (b) spec phase adds `OperatorsRepo.findByUsername()` for testability and reuse (slightly more LoC but cleaner). **Recommend (b)** — keeps the script thin and the repo consistent with the `_template.ts` pattern. Confirm?
4. **`DATA_STEWARD_OPERATOR_IDS` semantics** — CSV of UUIDs (locked) with mandatory `--from-env` flag (locked) — confirm that an explicit flag is required (vs. auto-detecting env var presence)? Explicit flag is safer (avoids surprise grants on env var inheritance).
5. **`grantedBy` field** — when invoked from the runbook (no JWT session), who is the `granted_by`? Three options: (a) `null` (system event — matches `emitDriftAlert`); (b) the CLI requires `--granted-by <uuid>`; (c) the CLI falls back to a single env var `DATA_STEWARD_GRANTED_BY`. **Recommend (a)** — `null`, since this is a system-bootstrap CLI. Confirm?
6. **Anything else to lock before spec phase?** (e.g., should `--dry-run` be in v1? Should the script write to a structured log file in addition to stdout?)

---

## Source-of-truth References

| Path | Relevance |
|------|-----------|
| `docs/runbook.md:17-43` | The manual SQL block this change replaces |
| `packages/db/src/repositories/permissions.ts:48-53` | `grant()` already uses `onConflictDoNothing` — reused as-is |
| `packages/db/src/repositories/permissions.ts:37-46` | `hasPermission()` — used to distinguish "newly granted" vs "already granted" |
| `packages/db/src/repositories/permissions.ts:63-72` | `listOperatorsWithPermission()` — useful for "verify after grant" reporting (optional) |
| `packages/audit/src/emitter.ts:22-77` | `emitAudit()` API + 10s bucket dedup behavior |
| `packages/db/src/scripts/status.ts:1-196` | Script template (tsx + Zod + exit codes 0/1/2) — followed exactly |
| `packages/db/src/__smoke__.ts:14-19` | `createDb()` instantiation pattern |
| `openspec/changes/explore-athlos-deploy-slice-b/exploration.md` | Slice B parent exploration; B0/B1 sub-slicing rationale |
| `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md` | Slice A (predecessor) — TDD discipline, runbook deprecation pattern |
