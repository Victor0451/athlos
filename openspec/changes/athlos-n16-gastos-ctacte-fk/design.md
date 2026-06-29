# Design: athlos-n16-gastos-ctacte-fk

**Phase**: design (sdd-design sub-agent)
**Mode**: both (Engram + OpenSpec)
**Date**: 2026-06-29

---

## 1. Architecture overview

N16 closes the Slice 8 deferred gap (no gastos CRUD endpoints + no gasto↔ctacte correlation). It ships: (a) a many-to-many bridge table `tesoreria.gastos_ctacte_mapping` with PARTIAL UNIQUE INDEX allowing re-link after annulment; (b) a read-only heuristic view `tesoreria.gastos_with_ctacte_candidates` (LATERAL join on `fecha ± 3 days AND debe::numeric = importe::numeric`, LIMIT 1) that NEVER auto-persists; (c) 12 NEW ADMIN-only Fastify routes; (d) web pages under `/(authed)/admin/gastos/` + a "Gastos vinculados" panel on `/ctacte/[cuenta]`; (e) a Sidebar entry. All mutations emit `GASTOS_CTACTE_LINK_*` or `GASTO_*` audit rows via `emitAudit`. Shipped as 2 stacked sub-PRs (n16a backend, n16b web) per Slice 8 `8a.x→8b.x→8c.x` precedent.

```
apps/api/src/
├── routes/admin/
│   ├── scheduler.ts           (existing — ADMIN-gate + emitAudit reference)
│   ├── gastos.ts              (NEW N16  — 6 gastos CRUD routes)
│   └── gastos-ctacte.ts       (NEW N16  — 5 mapping + 1 candidate route)
├── modules/gastos/
│   ├── repository.ts          (NEW — Drizzle queries + LATERAL heuristic)
│   └── service.ts             (NEW — validation + audit orchestration)
└── server.ts                  (modified — register gastosAdminRoutes)

packages/db/
├── drizzle/0019_gastos_ctacte_mapping.sql   (NEW — table + view + index)
├── drizzle/meta/0019_snapshot.json           (NEW — drizzle-kit regenerated)
└── src/schema/tesoreria.ts                   (modified — gastosCtacteMapping + view)

apps/web/src/
├── app/(authed)/admin/
│   ├── scheduler/             (existing — pattern reference)
│   └── gastos/                (NEW — page.tsx + [id]/page.tsx)
├── app/(authed)/ctacte/[cuenta]/page.tsx     (modified — adds "Gastos vinculados" panel)
├── components/layout/Sidebar.tsx            (modified — adds Tesorería > Gastos)
└── lib/api/
    ├── gastos.ts              (NEW N16 — typed fetch wrapper, was MISSING)
    └── gastos-ctacte.ts       (NEW N16 — typed fetch wrapper for mapping)
```

## 2. Database schema (migration `0019_gastos_ctacte_mapping.sql`)

```sql
-- A. New mapping table
CREATE TABLE "tesoreria"."gastos_ctacte_mapping" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gasto_id"    uuid NOT NULL REFERENCES "tesoreria"."gastos"("id") ON DELETE CASCADE,
  "ctacte_id"   uuid NOT NULL REFERENCES "tesoreria"."ctacte"("id") ON DELETE CASCADE,
  "monto_cubierto" numeric(14,2) NOT NULL CHECK ("monto_cubierto" > 0),
  "motivo"      text NOT NULL CHECK ("motivo" IN ('manual','heuristic-pending','auto')),
  "anulado"     boolean NOT NULL DEFAULT false,
  "anulado_at"  timestamp with time zone,
  "anulado_motivo" text,
  "created_by"  uuid REFERENCES "public"."operators"("id") ON DELETE SET NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- CRITICAL: PARTIAL UNIQUE allows re-link after anular (spec §Re-link scenario).
CREATE UNIQUE INDEX "gastos_ctacte_mapping_active_uniq"
  ON "tesoreria"."gastos_ctacte_mapping" ("gasto_id","ctacte_id")
  WHERE "anulado" = false;

CREATE INDEX "gastos_ctacte_mapping_gasto_idx"  ON "tesoreria"."gastos_ctacte_mapping" ("gasto_id");
CREATE INDEX "gastos_ctacte_mapping_ctacte_idx" ON "tesoreria"."gastos_ctacte_mapping" ("ctacte_id");

-- B. Heuristic view (Option C — read-only, never auto-persists)
CREATE OR REPLACE VIEW "tesoreria"."gastos_with_ctacte_candidates" AS
SELECT
  g.id AS gasto_id, g.cuenta_principal, g.fecha, g.importe, g.concepto,
  c.id AS ctacte_id, c.socio_id, c.fecha AS ctacte_fecha,
  c.debe, c.haber, c.concepto AS ctacte_concepto,
  abs((c.fecha - g.fecha)) AS days_diff,
  abs(c.debe::numeric - g.importe::numeric) AS amount_diff
FROM "tesoreria"."gastos" g
LEFT JOIN LATERAL (
  SELECT * FROM "tesoreria"."ctacte"
   WHERE "fecha" BETWEEN g.fecha - 3 AND g.fecha + 3
     AND "debe"::numeric = g.importe::numeric
     AND "anulado" = false
   ORDER BY abs("fecha" - g.fecha)
   LIMIT 1
) c ON true;

-- C. Index for LATERAL (cheap; ~200ms build on live 215k ctacte rows)
CREATE INDEX "ctacte_fecha_debe_anulado_idx"
  ON "tesoreria"."ctacte" ("fecha","debe") WHERE "anulado" = false;

-- D. ADD `anulado` columns to gastos (NULL default → false) + audit columns
ALTER TABLE "tesoreria"."gastos"
  ADD COLUMN "anulado" boolean NOT NULL DEFAULT false,
  ADD COLUMN "anulado_at" timestamp with time zone,
  ADD COLUMN "anulado_motivo" text;
```

| Decision | Option | Tradeoff | Choice |
|----------|--------|----------|--------|
| UNIQUE on `(gasto_id, ctacte_id)` | plain vs PARTIAL WHERE `anulado=false` | plain = blocks re-link after anular (spec Re-link scenario fails) | **PARTIAL** |
| Heuristic cardinality | one-to-one vs many per gasto | one-to-one misses partial-payment patterns | LATERAL LIMIT 1 per gasto, scored ≥30 |
| `cuenta_principal` FK to socios | add NOW vs defer | live data 0/2,114 match; would introduce false FK | **DEFER** (already decided by orchestrator Q1) |
| `gastos.socio_id` FK | add NOW vs defer | scope correction #C8 + 0 rows have socio_id | **DEFER** (no constraint) |

## 3. API routes (12 NEW, all ADMIN-only via `requireRole('ADMIN')`)

| Method | Path | Body / Params | Response | Audit action |
|--------|------|---------------|----------|--------------|
| GET | `/api/v1/gastos` | `?page,limit,cuenta_principal,fecha_desde,fecha_hasta,anulado` | `{items:Gasto[], total, page, limit, has_more}` | — |
| GET | `/api/v1/gastos/:id` | path | `Gasto & { links[] }` | — |
| POST | `/api/v1/gastos` | `CreateGastoDto` | `Gasto` (201) | `GASTO_CREATE` |
| PATCH | `/api/v1/gastos/:id` | `UpdateGastoDto` | `Gasto` | `GASTO_UPDATE` |
| DELETE | `/api/v1/gastos/:id` | path | `{ok:true}` (200) | `GASTO_DELETE` |
| PATCH | `/api/v1/gastos/:id/anular` | `{motivo}` | `Gasto {anulado:true}` | `GASTO_ANULAR` |
| GET | `/api/v1/gastos/:id/ctacte-links` | `?active=true` | `LinkDTO[]` | — |
| POST | `/api/v1/gastos/:id/ctacte-links` | `{ctacte_id, monto_cubierto, motivo}` | `LinkDTO` (201) | `GASTOS_CTACTE_LINK_CREATE` |
| DELETE | `/api/v1/gastos-ctacte-links/:linkId` | path | `{ok:true}` | `GASTOS_CTACTE_LINK_DELETE` |
| PATCH | `/api/v1/gastos-ctacte-links/:linkId/anular` | `{motivo}` | `LinkDTO {anulado:true}` | `GASTOS_CTACTE_LINK_ANULAR` |
| GET | `/api/v1/ctacte/:cuenta/gastos-links` | path | `LinkDTO[]` (with `gasto` joined) | — |
| GET | `/api/v1/admin/gastos-ctacte-candidates` | `?gasto_id` | `Candidate[]` (heuristic, max 50) | — |

Error contract (per api-security spec §F): 403 → emits `PERMISSION_DENIED` audit row; 409 on duplicate active link → `{error:'LINK_ALREADY_EXISTS'}`; 400 on `monto_cubierto > gasto.importe` → `{error:'MONTO_EXCEEDS_GASTO'}`; 404 on missing gasto/ctacte.

## 4. Heuristic candidate algorithm

Implemented in `apps/api/src/modules/gastos/repository.ts` (no auto-persist):

```sql
-- Pure read against the view (never INSERT)
SELECT * FROM tesoreria.gastos_with_ctacte_candidates
 WHERE gasto_id = $1 AND ctacte_id IS NOT NULL
   AND amount_diff < (importe::numeric * 0.10)   -- ±10% tolerance
 ORDER BY days_diff, amount_diff
 LIMIT 50;
```

Scoring (in SPEC §heuristic, not in SQL — scored client-side for ranking):
- **+50** date proximity (`abs(c.fecha - g.fecha) ≤ 7`)
- **+30** amount match (≤10% diff)
- **+20** socio match (when both `socio_id` non-null — always 0 today for gastos)
- threshold: `score > 30` returns the candidate; otherwise omitted

Contract: candidates return `motivo: "heuristic-pending"` ALWAYS; spec §Heuristic requirement explicitly forbids auto-INSERT.

## 5. State management

| Layer | Mechanism | Source |
|-------|-----------|--------|
| Server state | Drizzle ORM + pg transactions | existing `apps/api/src/modules/ctacte/service.ts` (1:1 pattern) |
| Client state (server) | TanStack Query v5 | existing pattern (`apps/web/src/lib/api/ctacte.ts` + adjacent `use*Query` hooks in `apps/web/src/app/(authed)/ctacte/`) |
| Client state (auth) | Zustand `useAuth` | existing `apps/web/src/lib/use-auth.ts` (used in `Sidebar.tsx`) |
| Audit | `emitAudit(container.db, {...})` per scheduler.ts:116 template | `@athlos/audit` (already imported by scheduler) |
| Validation | `throwIfInvalid(z.object({...}), body, 'body')` | existing pattern from scheduler.ts:192 |

## 6. File changes (2 sub-PRs)

**n16a-backend (~400 LoC)**

| File | Action | LoC |
|------|--------|-----|
| `packages/db/drizzle/0019_gastos_ctacte_mapping.sql` | Create | 50 |
| `packages/db/drizzle/meta/0019_snapshot.json` | Create (regenerated) | 30 |
| `packages/db/src/schema/tesoreria.ts` | Modify — append `gastosCtacteMapping` table (Drizzle def) | +40 |
| `apps/api/src/modules/gastos/repository.ts` | Create — Drizzle queries + heuristic LATERAL | 70 |
| `apps/api/src/modules/gastos/service.ts` | Create — validation + 5-tuple UNIQUE re-check + audit | 60 |
| `apps/api/src/routes/admin/gastos.ts` | Create — 6 endpoints | 100 |
| `apps/api/src/routes/admin/gastos-ctacte.ts` | Create — 6 endpoints | 90 |
| `apps/api/src/server.ts` | Modify — `await app.register(gastosAdminRoutes)` | +3 |
| `apps/api/src/container.ts` | Modify — wire gastos repo into DI | +2 |
| Tests: `modules/gastos/{repository,service}.test.ts` + `routes/admin/{gastos,gastos-ctacte}.test.ts` | Create — RED→GREEN→TRIANGULATE | 100 |

**n16b-web (~300 LoC)**

| File | Action | LoC |
|------|--------|-----|
| `apps/web/src/lib/api/gastos.ts` + `.test.ts` | Create — typed fetch wrapper (was MISSING, per exploration §1.3) | 50 |
| `apps/web/src/lib/api/gastos-ctacte.ts` + `.test.ts` | Create — mapping endpoints wrapper | 40 |
| `apps/web/src/app/(authed)/admin/gastos/page.tsx` + `.test.tsx` | Create — paginated table + filters (cuenta/fecha/anulado) | 80 |
| `apps/web/src/app/(authed)/admin/gastos/[id]/page.tsx` + `.test.tsx` | Create — detail + links + candidates section | 70 |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` | Modify — append "Gastos vinculados" panel below MovementList | +30 |
| `apps/web/src/components/layout/Sidebar.tsx` | Modify — add `{href:'/admin/gastos', label:'Gastos', roles:['ADMIN']}` to `ITEMS` | +1 |
| Tests: 3 RTL suites covering list render + link add/remove + anulación flow | Create | 30 |

**Total: ~700 LoC across 2 sub-PRs, each ≤400 LoC reviewable independently.**

## 7. Risks + decisions to validate

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Heuristic false positives (same importe on same fecha across many socios) | Med | `motivo='heuristic-pending'` ONLY; operator confirm required; 10% amount tolerance; LATERAL LIMIT 1 per gasto |
| 2 | PARTIAL UNIQUE syntax broken in Postgres < 11 | Low | spec already conditional; verify on `192.168.1.102` PG version (≥14 expected) before merge |
| 3 | `hechos` (ctacte rows) change between candidate fetch and POST — race condition | Med | POST re-validates `monto_cubierto ≤ gasto.importe` and active-link check atomically in transaction |
| 4 | Sidebar ordering breaks visual hierarchy | Low | Place under existing Admin group (after Settings); follow existing `roles:['ADMIN']` pattern from `Sidebar.tsx:35-37` |
| 5 | Audit action enum not yet known to `@athlos/audit` | Low | Pre-flight grep `packages/audit/src/emitter.ts` for accepted `action` whitelist; if not whitelisted, extend emitter type per existing pattern |
| 6 | `0019_snapshot.json` divergence on `drizzle-kit generate` | Low | Run `pnpm --filter @athlos/db generate` after SQL is applied on staging DB; commit regenerated snapshot |
| 7 | 2 sub-PRs drift during review | Low | n16a merges first; n16b rebases; if n16b outruns, web falls back to "Próximamente" (Slice 8 fallback) |
| 8 | The `$lib/api` `apiFetch` doesn't support DELETE-with-body | Low | existing `ctacte.ts` is GET-only; n16b adds DELETE wrapper — verify `apiFetch` accepts init.body on DELETE (RFC 9110 allows; current impl from PR 8b.2 may not) |

## 8. Compliance + LESSONs

- **ADITIVE-ONLY** per **B1b LESSON #1** — `web-frontend/spec.md` and `api-security/spec.md` deltas use ADDED-only pattern (no MODIFIED/REMOVED requirements)
- **2-PR SPLIT** per Slice 8 LESSON (each PR ships independently; revert path preserves live data per proposal §Rollback)
- **0 Co-Authored-By** (orchestrator strips via filter-branch before push)
- **Strict TDD**: RED → GREEN → TRIANGULATE; ≥5 vitest backend + ≥3 RTL web per file
- **Stale tag pattern** (orchestrator must `git push origin --delete TAG` if remote already has it before re-pushing)
- **Migration apply order**: `pnpm db:migrate` → 0019 → `pnpm --filter @athlos/db generate` → commit snapshot → `psql \d tesoreria.gastos_ctacte_mapping` must show partial UNIQUE idx
- **Verification gate**: `scripts/verify-slice.sh` exits 0; `docs/runbook.md` Known Limitations table removes N16 entry

---

## Artifact Summary

- **OpenSpec path**: `openspec/changes/athlos-n16-gastos-ctacte-fk/design.md` (this file)
- **Engram topic_key**: `sdd/athlos-n16-gastos-ctacte-fk/design`
- **Type**: architecture
- **Scope**: project
- **Mode**: both (Engram + OpenSpec)
- **Capture prompt**: false (SDD artifact per protocol)
