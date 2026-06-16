CREATE TYPE "tesoreria"."ctacte_tipo" AS ENUM('DEBITO', 'CREDITO');--> statement-breakpoint
CREATE TABLE "tesoreria"."ctacte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"socio_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"tipo" "tesoreria"."ctacte_tipo" NOT NULL,
	"concepto" text NOT NULL,
	"debe" text DEFAULT '0.00' NOT NULL,
	"haber" text DEFAULT '0.00' NOT NULL,
	"anulado" boolean DEFAULT false NOT NULL,
	"anulado_at" timestamp with time zone,
	"anulado_motivo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deportes"."disciplinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deportes"."ejercicios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anio" integer NOT NULL,
	"descripcion" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deportes"."inscripciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"socio_id" uuid NOT NULL,
	"disciplina_id" uuid NOT NULL,
	"ejercicio_id" uuid NOT NULL,
	"estado" text DEFAULT 'activa' NOT NULL,
	"fecha_alta" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_by" text DEFAULT 'scheduler' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tesoreria"."ctacte" ADD CONSTRAINT "ctacte_socio_id_socios_id_fk" FOREIGN KEY ("socio_id") REFERENCES "socios"."socios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deportes"."inscripciones" ADD CONSTRAINT "inscripciones_socio_id_socios_id_fk" FOREIGN KEY ("socio_id") REFERENCES "socios"."socios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deportes"."inscripciones" ADD CONSTRAINT "inscripciones_disciplina_id_disciplinas_id_fk" FOREIGN KEY ("disciplina_id") REFERENCES "deportes"."disciplinas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deportes"."inscripciones" ADD CONSTRAINT "inscripciones_ejercicio_id_ejercicios_id_fk" FOREIGN KEY ("ejercicio_id") REFERENCES "deportes"."ejercicios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ctacte_socio_id_idx" ON "tesoreria"."ctacte" USING btree ("socio_id");--> statement-breakpoint
CREATE INDEX "ctacte_fecha_idx" ON "tesoreria"."ctacte" USING btree ("fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "disciplinas_codigo_unique" ON "deportes"."disciplinas" USING btree ("codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "ejercicios_anio_unique" ON "deportes"."ejercicios" USING btree ("anio");--> statement-breakpoint
CREATE UNIQUE INDEX "inscripciones_unique" ON "deportes"."inscripciones" USING btree ("socio_id","disciplina_id","ejercicio_id");--> statement-breakpoint
CREATE INDEX "inscripciones_disciplina_ejercicio_idx" ON "deportes"."inscripciones" USING btree ("disciplina_id","ejercicio_id");--> statement-breakpoint
CREATE INDEX "idx_job_runs_job_name_started" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "idx_job_runs_status" ON "job_runs" USING btree ("status") WHERE status IN ('running','failed','dead_letter');