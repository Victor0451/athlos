-- Migration 0019: gastos ↔ ctacte mapping (athlos-n16-gastos-ctacte-fk)
--
-- Closes the Slice 8 deferred gap: no gastos CRUD endpoints and no
-- explicit correlation between `tesoreria.gastos` (accounting-plan
-- code `cuenta_principal`) and `tesoreria.ctacte` (socio carnet
-- `cctcuenta`). The two namespaces do not intersect in the live
-- data — verified 2026-06-29 (0 of 165 distinct `cuenta_principal`
-- resolve to any `cctcuenta`).
--
-- Adds:
--   1. `tesoreria.gastos_ctacte_mapping` table — explicit many-to-many
--      bridge with PARTIAL UNIQUE INDEX so anulada rows don't block
--      re-linking. ON DELETE CASCADE on both FKs mirrors the spec:
--      hard-delete a gasto → links go with it.
--   2. `tesoreria.gastos_with_ctacte_candidates` view — read-only
--      LEFT JOIN LATERAL heuristic on (fecha ± 3 days AND
--      debe::numeric = importe::numeric), LIMIT 1. Operator confirms
--      before any link is persisted; this view NEVER auto-inserts.
--   3. `tesoreria.ctacte` index on (fecha, debe) WHERE anulado=false
--      to make the LATERAL subquery fast on 215k ctacte rows.
--   4. ALTER on `tesoreria.gastos` — three soft-delete audit
--      columns (anulado, anulado_at, anulado_motivo) mirroring the
--      pattern already in place on `tesoreria.ctacte`.
--
-- Idempotent: re-running is a no-op (CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE VIEW, ADD COLUMN
-- IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "tesoreria"."gastos_ctacte_mapping" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gasto_id" uuid NOT NULL REFERENCES "tesoreria"."gastos"("id") ON DELETE CASCADE,
  "ctacte_id" uuid NOT NULL REFERENCES "tesoreria"."ctacte"("id") ON DELETE CASCADE,
  "monto_cubierto" numeric(14,2) NOT NULL CHECK ("monto_cubierto" > 0),
  "motivo" text NOT NULL CHECK ("motivo" IN ('manual','heuristic-pending','auto')),
  "anulado" boolean NOT NULL DEFAULT false,
  "anulado_at" timestamp with time zone,
  "anulado_motivo" text,
  "created_by" uuid REFERENCES "public"."operators"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- CRITICAL: PARTIAL UNIQUE INDEX excludes anulado rows so the
-- spec's Re-link scenario (operator creates a new link after
-- the previous one was anulado) returns 201 not 409.
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_ctacte_mapping_active_uniq"
  ON "tesoreria"."gastos_ctacte_mapping" ("gasto_id","ctacte_id")
  WHERE "anulado" = false;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "gastos_ctacte_mapping_gasto_idx"
  ON "tesoreria"."gastos_ctacte_mapping" ("gasto_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "gastos_ctacte_mapping_ctacte_idx"
  ON "tesoreria"."gastos_ctacte_mapping" ("ctacte_id");
--> statement-breakpoint

-- Heuristic discovery view: NEVER auto-persists. The operator must
-- confirm before any `gastos_ctacte_mapping` row is created from a
-- candidate. Read-only by design — no INSERT/UPDATE/DELETE on a view.
CREATE OR REPLACE VIEW "tesoreria"."gastos_with_ctacte_candidates" AS
SELECT
  g.id AS gasto_id,
  g.cuenta_principal,
  g.fecha AS gasto_fecha,
  g.importe AS gasto_importe,
  g.concepto AS gasto_concepto,
  c.id AS ctacte_id,
  c.socio_id,
  c.fecha AS ctacte_fecha,
  c.debe,
  c.haber,
  c.concepto AS ctacte_concepto,
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
--> statement-breakpoint

-- Index for the LATERAL subquery on (fecha, debe) filtered by
-- anulado=false. Cheap build (~200ms on the live 215k ctacte).
CREATE INDEX IF NOT EXISTS "ctacte_fecha_debe_anulado_idx"
  ON "tesoreria"."ctacte" ("fecha","debe") WHERE "anulado" = false;
--> statement-breakpoint

-- Soft-delete audit columns on `tesoreria.gastos`. Mirrors the
-- ctacte pattern (PR 5). Anular sets `anulado=true` + motivo; the
-- `gastos_ctacte_mapping` rows are NOT cascaded (spec Q5: soft
-- warning, no cascade on anular).
ALTER TABLE "tesoreria"."gastos"
  ADD COLUMN IF NOT EXISTS "anulado" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "tesoreria"."gastos"
  ADD COLUMN IF NOT EXISTS "anulado_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "tesoreria"."gastos"
  ADD COLUMN IF NOT EXISTS "anulado_motivo" text;