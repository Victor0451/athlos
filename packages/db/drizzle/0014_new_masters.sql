-- Migration 0014: Add 4 NEW master tables (3 CREATE TABLE + 1 EXISTING populated)
-- + legacy_id columns + UNIQUE INDEXes for cross-run idempotency.
--
-- Idempotent: re-running is a no-op.
--
-- escuela: per-school master (NO socio_id FK per scope correction #C1).
-- disciplinas: table already exists; migration adds legacy_id column + UNIQUE INDEX.
-- locacion: per-socio address with composite NK (LCNCTAPRIN, LCNNUMERO).
-- caja_movimiento: cash movement header with 4-tuple NK (CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA).

-- ─── escuela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "socios"."escuela" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "codigo" integer NOT NULL,
  "nombre" text NOT NULL,
  "deporte_codigo" integer,
  "estado" varchar(1) NOT NULL,
  "cuota_social" numeric(14,2),
  "cobertura" numeric(14,2),
  "contribucion" numeric(14,2),
  "importe_escolar" numeric(14,2),
  "otro_contrib" numeric(14,2),
  "clave_inscripcion" numeric(14,2),
  "fecha_escolar" date,
  "entrenador_codigo" integer,
  "escuela_numero" integer,
  "instructor" text,
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escuela_codigo_unique"
  ON "socios"."escuela" ("codigo");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escuela_legacy_id_unique"
  ON "socios"."escuela" ("legacy_id");
--> statement-breakpoint

-- ─── disciplinas (table exists; add legacy_id column + UNIQUE INDEX) ──────────
ALTER TABLE "deportes"."disciplinas" ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disciplinas_legacy_id_unique"
  ON "deportes"."disciplinas" ("legacy_id");
--> statement-breakpoint

-- ─── locacion ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "socios"."locacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cuenta_principal" text NOT NULL,
  "cuenta_secundaria" text,
  "numero" integer NOT NULL,
  "calle" text,
  "barrio" integer,
  "piso" text,
  "puerta" integer,
  "departamento" text,
  "anexo1" integer,
  "anexo2" integer,
  "nombre" text NOT NULL,
  "dni" integer,
  "cuit" integer,
  "telefono" integer,
  "fecha_nacimiento" date,
  "fecha_baja" date,
  "situacion_iva" integer,
  "cuota" numeric(14,2),
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locacion_cuenta_principal_numero_unique"
  ON "socios"."locacion" ("cuenta_principal", "numero");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locacion_legacy_id_unique"
  ON "socios"."locacion" ("legacy_id");
--> statement-breakpoint

-- ─── caja_movimiento ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tesoreria"."caja_movimiento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "numero" integer NOT NULL,
  "secuencia" integer NOT NULL,
  "fecha" date NOT NULL,
  "hora" integer NOT NULL,
  "tip" integer,
  "descrip" text,
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caja_movimiento_numero_secuencia_fecha_hora_unique"
  ON "tesoreria"."caja_movimiento" ("numero", "secuencia", "fecha", "hora");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caja_movimiento_legacy_id_unique"
  ON "tesoreria"."caja_movimiento" ("legacy_id");
