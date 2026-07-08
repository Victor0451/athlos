-- Migration 0030: socio.fecha_nacimiento (athlos-socio-form-emit, PR 8d.1)
--
-- Adds the `fecha_nacimiento DATE` column to `socios.socios`. Nullable
-- (existing rows have no birth date) so backfill is not required at
-- migration time. The PDF form renders blank when the column is NULL.
--
-- Hand-written (drizzle migrate is broken in prod per handover #253).
-- Deploy runbook:
--   docker exec -i athlos-db-1 psql -U athlos -d athlos \
--     < packages/db/drizzle/0030_socio_fecha_nacimiento.sql
--
-- Idempotent via ADD COLUMN IF NOT EXISTS so a re-run after a partial
-- apply is a no-op.

ALTER TABLE "socios"."socios" ADD COLUMN IF NOT EXISTS "fecha_nacimiento" DATE;