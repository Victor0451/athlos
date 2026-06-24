CREATE TABLE "tesoreria"."ctacte1" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ctacte_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"concepto" text NOT NULL,
	"monto" text DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_freshness" (
	"domain" varchar(32) PRIMARY KEY NOT NULL,
	"last_import_at" timestamp with time zone,
	"record_count" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_snapshots" (
	"entity_uuid" uuid PRIMARY KEY NOT NULL,
	"domain" varchar(32) NOT NULL,
	"last_hash" varchar(64) NOT NULL,
	"last_event_id" uuid NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_uuids" (
	"source_table" varchar(32) NOT NULL,
	"source_key" varchar(64) NOT NULL,
	"entity_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_uuids_source_table_source_key_pk" PRIMARY KEY("source_table","source_key"),
	CONSTRAINT "entity_uuids_entity_uuid_unique" UNIQUE("entity_uuid")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"operator_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "role_permissions_operator_id_permission_key_pk" PRIMARY KEY("operator_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "tesoreria"."ctacte1" ADD CONSTRAINT "ctacte1_ctacte_id_ctacte_id_fk" FOREIGN KEY ("ctacte_id") REFERENCES "tesoreria"."ctacte"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_operators_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ctacte1_ctacte_id_idx" ON "tesoreria"."ctacte1" USING btree ("ctacte_id");