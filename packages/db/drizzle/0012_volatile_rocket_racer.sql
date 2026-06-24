CREATE TABLE "tesoreria"."ctacte1" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ctacte_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"concepto" text NOT NULL,
	"monto" text DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tesoreria"."ctacte1" ADD CONSTRAINT "ctacte1_ctacte_id_ctacte_id_fk" FOREIGN KEY ("ctacte_id") REFERENCES "tesoreria"."ctacte"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ctacte1_ctacte_id_idx" ON "tesoreria"."ctacte1" USING btree ("ctacte_id");