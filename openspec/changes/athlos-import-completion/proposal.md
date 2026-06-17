# Proposal: Athlos — Import Pipeline Completion

## Intent

Close the remaining backend work for the import pipeline that proves Athlos as a reliable reader and projector of legacy VFP data. Archived `athlos-foundation` shipped 12 PRs (322 tests, 25 specs, 15 packages including `@athlos/import` with raw_events schema + hash + bridge validator), but 6 implementation tasks remain. Without them, the pipeline is a write-only vacuum — data lands in `raw_events` but nothing traces it back, rebuilds projections, detects drift, or audits mutations.

**Why now**: only backend work blocking PR 8 (UI) and PR 10b (E2E). The 5 main specs are FINALIZED — no spec gap, only implementation. The dispatcher-stale `gentle-ai sdd-status` view still reports `nextRecommended = apply` for `athlos-foundation`; the orchestrator correctly overrides it because the filesystem archive is final and re-opening `athlos-foundation` would muddy the audit trail (per `archive-report.md` §Stakeholders).

## Scope

### In Scope
- TASK-055 `packages/lineage/src/{query,verify}.ts` (~80L + tests)
- TASK-056 `packages/projection/src/{rebuild,saldo}.ts` (~200L + tests)
- TASK-057 `packages/drift/src/{detect,alert}.ts` (~100L + tests)
- TASK-058 `packages/freshness/src/{api,thresholds}.ts` (~80L + tests)
- TASK-059 `packages/audit/src/{middleware,emitter,query}.ts` (~150L + tests)
- TASK-060 `apps/api/src/routes/{import,lineage,drift,freshness,audit}.ts` (~180L + tests)
- 4 stub job body swaps: `drift-detection`, `freshness-refresh`, `scheduled-import`, `reconciliation`
- 6 delta specs adding implementation-grade requirements to existing main specs

### Out of Scope
- Anything in `openspec/changes/athlos-foundation/` (archived; do NOT touch)
- PR 8 UI, PR 9 deploy, PR 10b E2E — separate changes
- Drift auto-correction (spec explicitly forbids it)
- Writing business facts — still legacy's job during coexistence

## Capabilities

> sdd-spec contract: all 6 target specs already exist as primary specs in `openspec/specs/`. sdd-spec produces DELTAS, not new specs.

### New Capabilities
- None.

### Modified Capabilities
- `lineage-tracker`: ADD `LineageResponse` shape; MODIFY hash verification to include `audit_event_id?`.
- `projection-engine`: ADD saldo recalculation contract; MODIFY rebuild to specify per-domain table list.
- `drift-detector`: ADD `drift_snapshots` table + `detect({domain?})` query shape; MODIFY alert to require audit_events write + notification trigger.
- `freshness-monitor`: ADD `getFreshness({domain?})` shape + `DomainFreshness.status` enum (`'current' | 'stale' | 'unknown'`) + per-domain thresholds.
- `audit-logger`: ADD Fastify onRequest/onResponse hook contract; ADD idempotency key (`sha256(operator_id+action+entity_id+payload+10s_window)`).
- `legacy-import`: ADD POST `/import/trigger` (202 + batchId); MODIFY append-only semantics to clarify `raw_events.payload ≤1MB/row` cap + paginated cursor above.

## Approach

- **5 new `@athlos/*` packages** with strict domain boundaries. No cross-coupling: `drift` writes directly to the `audit_events` table (not via `@athlos/audit`) because drift emits *system-generated* events while `@athlos/audit` handles *operator-initiated* events — two distinct write paths documented in code.
- **Stub-swap pattern**: PR 6a already wired stable handler SHAPE for `drift-detection`, `freshness-refresh`, `reconciliation` jobs. PR 7 only swaps the body in place; no orchestrator changes.
- **Fastify plugin encapsulation**: `@athlos/audit/middleware` MUST be wrapped with `fastify-plugin` (lesson from PR 3a — un-wrapped plugins silently bounce every protected route to 401, Engram bugfix obs). Apply ATHLOS_GATE_MARKER pattern (lesson from PR 4b route-audit).
- **DI**: wire 5 new packages into existing `createAppDeps` factory.
- **Idempotency**: `@athlos/audit/emitter.emitAudit` dedupes within a 10s window via SHA-256; truncate `Date.now()` to a 10s bucket before hashing.
- **No schema migrations in 7b**: all needed tables (`raw_events`, `audit_events`, `drift_snapshots`, `domain_freshness`) should be live from PR 2 + PR 7a; verify before applying, add `0007_*` migration only if a gap is found.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/{lineage,projection,drift,freshness,audit}/` | New | 5 packages + tsconfig + vitest configs + fixtures + tests |
| `apps/api/src/routes/{import,lineage,drift,freshness,audit}.ts` | New | 5 routes (mix of admin + any) |
| `apps/api/src/jobs/{drift-detection,freshness-refresh,scheduled-import,reconciliation}.ts` | Modified | Stub → real body |
| `apps/api/src/di.ts` | Modified | Wire 5 new packages |
| `apps/api/src/server.ts` | Modified | Register 5 routes + audit plugin (fp-wrapped) |

## Risks

| Risk | Lik | Mitigation |
|------|-----|------------|
| Sub-agent `session_message.seq` platform error (last hit on PR 7b attempt; Engram #2037) | Med | Run sdd-apply directly OR split into 7b.1/7b.2 sub-PRs (this proposal recommends split — see Sub-slice) |
| `drift_snapshots` table may be missing (PR 7 schema gap) | Low | Verify Drizzle schema in apply preflight; add migration `0007_*` if missing before `drift.detect` lands |
| Audit middleware Fastify encapsulation bug (PR 3a class) | Med | MUST use `fastify-plugin` wrapper; route-audit rejects unwrapped plugins |
| Two audit write paths (drift direct vs `@athlos/audit` operator) | Low | Acceptable: system events vs operator events. Document the split in code comments |
| `raw_events.payload` bloat on ctacte1 (~325MB at production scale) | Low | Spec caps ≤1MB/row + paginated cursor; optimization is out of scope |

## Sub-slice Recommendation (PR Strategy)

**Total ~790 lines exceeds the 400-line review budget.** Recommend splitting into 2 stacked sub-PRs:

- **PR 7b.1 (data plane) — ~460 lines code + ~280 lines tests**
  - TASK-055 lineage + TASK-056 projection + TASK-057 drift + TASK-058 freshness
  - 3 job body swaps: `drift-detection`, `freshness-refresh`, `scheduled-import`
  - **Verification**: run import → query lineage → rebuild projection → check drift → check freshness
  - **Independent rollback**: revert data plane without touching routes

- **PR 7b.2 (route + audit plane) — ~330 lines code + ~320 lines tests**
  - TASK-059 audit package + TASK-060 5 routes
  - 1 job body swap: `reconciliation`
  - **Depends on 7b.1** (routes call data plane packages)
  - **Verification**: curl each route, verify RBAC + audit idempotency

**Why this split**: 7b.1 builds the read-side queryable surface (lineage + projection + drift + freshness) without touching auth or routes — easy to verify in isolation. 7b.2 introduces auth-coupled routes + the audit middleware that wraps every mutation. The 7b.1 → 7b.2 dependency is clean because drift writes directly to the `audit_events` table (not via `@athlos/audit`), so 7b.1 does not block on 7b.2.

**Alternative considered (rejected)**: single PR with `size: exception` override. Rejected because (1) ~790L overwhelms reviewer focus and the diff is hard to read; (2) one bad package reverts 6 tasks — rollback granularity is worse; (3) we lost ~7h last attempt to the platform sub-agent error on a PR this size (Engram #2037) — smaller slices reduce blast radius if the platform fails again.

## Open Questions (for user — answer in next turn before sdd-spec)

1. **Drift alert routing**: when `drift.emitDriftAlert` writes to `audit_events` AND triggers a notification, should the notification go to ALL admins, or only to a designated "data steward" operator role? (PR 6b's `NotificationDispatcher` supports both; spec is silent.)
2. **Freshness threshold defaults**: per-domain numbers (e.g. CTACTE=1h, paramet=24h) — hard-code in `thresholds.ts` or expose as config-table-driven (deferred to follow-up)?
3. **Audit retention**: spec says "immutable, no delete" but doesn't state duration. Any regulatory minimum (club bylaws, Argentine data protection law `Ley 25.326`)? Or is "indefinite" acceptable?
4. **Lineage entityId shape**: UUID, legacy key, or domain-scoped string (`socio:SOC-001` vs raw `SOC-001`)? Affects index strategy and `verifyHash` lookup.
5. **Manual import UI affordance** (relevant for PR 8): should `/import/trigger` confirm-and-wait ("This will re-import 14 tables, ~5 min") or fire-and-forget (poll `/import/status/:batchId`)?

## Testing Strategy (Strict TDD — honors `strict_tdd: true` from sdd-init)

Per sdd-init obs #2047: Vitest 2.1.9, `@athlos/vitest-config` node preset, `@athlos/test-builders` fluent factories (`aSocio`, `aOperator`, `aAuditEvent`), `@athlos/integrations/legacy-db` (Real/Stub), in-memory Drizzle standin DB for unit tests, real PostgreSQL in CI.

**RED-GREEN-REFACTOR cycle for each package**:
1. **RED**: write the acceptance test FIRST (one per TASK-AC bullet in `tasks.md`), using `@athlos/test-builders` factories. Failure expected.
2. **GREEN**: write minimal package code to make the test pass. Stub external deps via `integrations/legacy-db` `Stub`.
3. **REFACTOR**: extract shared helpers; keep tests green.

**Per-slice test plan**:
- **7b.1 unit**: `lineage.queryLineage` returns 5-field shape; `verifyHash` returns `match:true`/`false`; `rebuildProjection` truncates+replays idempotently; `computeSaldo` equals `SUM(debe-haber)`; `drift.detect` compares hashes; `drift.emitDriftAlert` writes 1 audit_events row + calls notifications dispatcher; `freshness.getFreshness` maps age → status correctly.
- **7b.1 integration**: full chain — import → rebuild → lineage query returns correct batch.
- **7b.2 unit**: `audit.middleware` captures operator + diffs old/new; `emitAudit` dedupes within 10s window via SHA-256; `queryAudit` paginates.
- **7b.2 integration (HTTP)**: `POST /api/v1/import/trigger` requires admin (401 for non-admin), returns 202 + batchId; `GET /api/v1/lineage/:id` returns full chain; `PATCH /socios/:id` produces exactly 1 audit row, repeat within 10s produces 0 additional rows.

**Coverage gates**: 322 → ≥420 tests (+98). Co-located pattern (`packages/{pkg}/src/*.test.ts`). No E2E in this change (PR 10b territory).

## Rollback Plan

- **If 7b.1 ships and breaks import pipeline**:
  1. Halt `scheduled-import` + `drift-detection` crons (env=`""`, redeploy).
  2. `raw_events` is append-only — no data loss. Delete bad rows by `import_batch` if needed.
  3. TRUNCATE new projection tables; reverts to PR 7a state ("imports raw but no projections") which was already green.
  4. `git revert 7b.1`.
- **If 7b.2 ships and breaks routes**:
  1. Routes are additive — omit the `server.ts` registration. All other routes continue.
  2. Audit middleware: disable the plugin in `server.ts` if it corrupts requests; mutations fall back to non-audited (degraded but not broken).
  3. `git revert 7b.2`.
- **Projection corruption (any time)**: `TRUNCATE projection_{socios,ctacte,contable,...}` then `rebuildProjection(domain)` from `raw_events`. Idempotent.

## Dependencies

- `@athlos/import` (PR 7a, merged) — `raw_events` + hash + pipeline + bridge-validator
- `@athlos/db` (PR 2, merged) — Drizzle schemas
- `@athlos/auth` (PR 3a, merged) — `requireRole` / `requirePermission`
- `@athlos/notifications` (PR 6b, merged) — `NotificationDispatcher` for drift alerts
- `@athlos/scheduler` (PR 6a, merged) — job orchestrator with stub handlers
- `@athlos/test-builders` (PR 10a, merged) — fluent factory API
- `@athlos/vitest-config` (PR 10a, merged) — shared preset
- 6 finalized specs in `openspec/specs/` (lineage-tracker, projection-engine, drift-detector, freshness-monitor, audit-logger, legacy-import)
- Vitest 2.1.9, Fastify 5.2.0, Drizzle 0.36.0, TypeScript 5.7.2 strict

## Success Criteria

- [ ] All 6 task ACs from TASK-055..060 pass.
- [ ] 5 new packages compile clean under TypeScript strict.
- [ ] 5 routes return expected status codes (202, 200, 401, 403).
- [ ] Audit middleware emits exactly 1 row per mutation (integration test).
- [ ] Drift detector writes 1 `audit_events` row + 1 notification trigger per drift found.
- [ ] Freshness `status`: 5min-old → `'current'`; 2h-old on 1h threshold → `'stale'`.
- [ ] Projection rebuild idempotent (running twice produces identical saldo).
- [ ] Total tests: 322 → ≥420 passing.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:run`, `pnpm --filter web build` all green.
- [ ] Stacked-to-main: PR 7b.1 merges, then PR 7b.2 merges on top.
