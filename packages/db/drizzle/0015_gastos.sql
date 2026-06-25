-- Migration 0015: tesoreria.gastos master table (E1b2b)
-- 1 NEW master table + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha)
-- + 2 secondary INDEXes for cross-run idempotency.
--
-- Flat expense ledger with optional socio_id FK (deferred to N16).
-- Natural key: 5-tuple (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)
--   Verified 2114/2114 distinct = 100% unique (3-tuple yields 346 distinct = 84% dupes).
--
-- Idempotent: re-running is a no-op (CREATE TABLE IF NOT EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "tesoreria"."gastos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tipo" integer NOT NULL,
  "tipo_cuenta" integer NOT NULL,
  "cuenta_principal" text NOT NULL,
  "cuenta_auxiliar" integer,
  "secuencia" integer NOT NULL DEFAULT 0,
  "fecha" date NOT NULL,
  "comprobante" text NOT NULL DEFAULT '',
  "concepto" text,
  "importe" text NOT NULL DEFAULT '0.00',
  "iva" text DEFAULT '0.00' NOT NULL,
  "ingreso_bruto" text,
  "socio_id" uuid,
  "legacy_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_legacy_id_unique"
  ON "tesoreria"."gastos" ("legacy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_5tuple_unique"
  ON "tesoreria"."gastos" ("tipo", "cuenta_principal", "secuencia", "fecha", "comprobante");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_cuenta_fecha_idx"
  ON "tesoreria"."gastos" ("cuenta_principal", "fecha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_socio_id_idx"
  ON "tesoreria"."gastos" ("socio_id") WHERE "socio_id" IS NOT NULL;
