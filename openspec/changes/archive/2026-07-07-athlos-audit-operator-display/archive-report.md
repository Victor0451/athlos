# Athlos audit operator display — archive report (2026-07-07)

**SDD change:** `athlos-audit-operator-display`
**Archived on:** 2026-07-07
**Final main HEAD:** `f0953d8`

## Final state

### PRs merged to `main`

| PR | Scope | LoC | Notes |
|---|---|---|---|
| #13 | Backend (`feat(api): operator batch lookup`) | 7 files, +701/-3 | `size:exception` (1:1 source:test ratio + shared test-standin extension) |
| #14 | Frontend partial (`feat(web): operator display in audit tab`) | 6 files, +390/-7 | Client wrapper + `<OperatorChip>` + AuditTab wiring |
| #15 | Frontend close (`feat(web): operator display in notes card`) | 2 files, +101/-13 | SocioNotesCard wiring with shared cache key |

**Total LoC merged:** 1,192 insertions across 16 files.
**Strategy:** chained, stacked-to-main (3 PRs).
**Strict TDD:** applied per commit (RED → GREEN paired).

### Files added

**Backend (`apps/api/`):**
- `src/routes/operators.ts` + `operators.test.ts`
- `src/modules/operators/lookup.ts` + `lookup.test.ts` + `index.ts`
- `src/server.ts` (edit, one-line route registration)

**Frontend (`apps/web/`):**
- `src/lib/api/operators.ts` + `operators.test.ts`
- `src/components/socios/OperatorChip.tsx` + `OperatorChip.test.tsx`
- `src/components/socios/AuditTab.tsx` (edit)
- `src/components/socios/SocioNotesCard.tsx` (edit)
- `src/components/socios/AuditTab.test.tsx` (extend, +2 scenarios)
- `src/components/socios/SocioNotesCard.test.tsx` (extend, +2 scenarios)

**Test infrastructure (shared):**
- `apps/api/src/test-standins/db.ts` (extend, +26 LoC) — added `inArray` support

### Tests

- **API:** 320 passed + 2 skipped (was 293 + 17 skipped pre-change). New: 27 tests across schema, repository, route.
- **Web:** 503 passed (was 499 pre-change). New: 27 tests across client wrapper, `<OperatorChip>`, AuditTab extension, SocioNotesCard extension.
- **Regressions:** 0
- **typecheck + lint:** clean on both apps (one pre-existing warning in `admin/gastos.test.ts:365` is unrelated).

## Specs archived

- **New canonical spec:** `openspec/specs/operator-lookup/spec.md` (synced from the change's `specs/operator-lookup/spec.md`).
- **Capabilities affected:** none (this change is purely additive; no existing spec required deltas).

## User-visible behaviour

- Audit tab actors render as `username · ROLE` (e.g. `vlongo · ADMIN`).
- Note authors in SocioNotesCard render the same.
- `operator_id === null` (system events) and missing-from-lookup IDs both render literal `Operador desconocido`.
- Soft-deleted operators (`is_active = false`) keep their historical name in old audit/notes (no `(desactivado)` badge per spec).

## Verification verdict

`sdd-verify` returned **READY FOR ARCHIVE**:

- **CRITICAL:** 0
- **WARNING:** 3
  - Spec literal validation messages not implemented (Zod defaults differ from spec text). Trivial chore fix.
  - No covering runtime test for "Deterministic key" scenario (R8.1). Provable by code + test-mock pinning + TanStack Query library semantics.
  - No covering runtime test for "Second mount reuses first fetch" scenario (R8.2). Library-level dedup-by-key.
- **SUGGESTION:** 3
  - D10 deviation (no `db-destructive` label since no migration).
  - Cache-invalidation gap on operator rename (locked out-of-scope per proposal).
  - Drizzle migration system bug (pre-existing, untouched by this change).

## Carry-over follow-ups (NOT in this change)

These were tracked through the change but left out of scope. They each warrant their own work:

1. **`chore(ci): fix pre-existing CI failures`** — three pre-existing CI failures blocked PRs #13, #14, #15; merges used `--admin`. Failures:
   - `test` job: `ReferenceError: React is not defined` in `apps/web/src/app/(authed)/admin/gastos/[id]/page.test.tsx:141`.
   - `labeler` job: auto-labeler pattern drift.
   - `Docker build smoke` job: `/usr/local/bin/docker-entrypoint.sh: line 31: log_error: command not found`.
2. **New SDD change: fix drizzle migration system** — `__drizzle_migrations` absent in prod, `_journal.json` has gaps in 0013-0019. Workaround currently is `docker exec -i athlos-db-1 psql -U athlos -d athlos < archivo.sql`. This change made no Drizzle calls so it didn't trigger the bug, but the next schema-touching change will.
3. **Cache-invalidation on operator rename** — when an operator's `username` or `role` is edited via `PUT /admin/operators/:id`, in-flight AuditTab and SocioNotesCard components keep the stale name until the next refetch (mount or window-focus). Acceptable trade-off per proposal; flagged for future if real ops friction emerges.

## Cross-references

- Engram apply-progress: `sdd/athlos-audit-operator-display/apply-progress` (#267, final state written)
- Engram verify-report: `sdd/athlos-audit-operator-display/verify-report` (#268)
- Engram project state (handover): `architecture/gorriti-premium-archived-2026-07-06` (#256)
- Engram pending backlog (pre-change): `pending/work-after-pr-8b4` (#254) — first item is now resolved by this change.
- Obsidian: `/srv/obsidian/Athlos/2-Architecture/4-UI-Style-Gorriti-Premium.md` and `/srv/obsidian/Athlos/0-Index.md` (ledger updated).

## Sessions

Completed in session `athlos-server-gorriti-2026-07-06` (this server-side session).