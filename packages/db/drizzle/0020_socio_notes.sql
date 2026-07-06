CREATE TABLE "socios"."socio_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"socio_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "socios"."socio_notes" ADD CONSTRAINT "socio_notes_socio_id_socios_id_fk" FOREIGN KEY ("socio_id") REFERENCES "socios"."socios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "socio_notes_socio_id_idx" ON "socios"."socio_notes" USING btree ("socio_id");