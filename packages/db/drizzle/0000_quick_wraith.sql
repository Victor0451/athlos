CREATE SCHEMA "contabilidad";
--> statement-breakpoint
CREATE SCHEMA "deportes";
--> statement-breakpoint
CREATE SCHEMA "socios";
--> statement-breakpoint
CREATE SCHEMA "tesoreria";
--> statement-breakpoint
CREATE TYPE "socios"."socio_estado" AS ENUM('activo', 'baja', 'suspendido');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"source_ip" text,
	"metadata" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "socios"."socios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero_socio" text NOT NULL,
	"nombre" text NOT NULL,
	"apellido" text NOT NULL,
	"dni" text NOT NULL,
	"fecha_alta" date NOT NULL,
	"estado" "socios"."socio_estado" DEFAULT 'activo' NOT NULL,
	"categoria" text,
	"direccion" text,
	"telefono" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "socios_numero_socio_unique" ON "socios"."socios" USING btree ("numero_socio");--> statement-breakpoint
CREATE UNIQUE INDEX "socios_dni_unique" ON "socios"."socios" USING btree ("dni");