CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_table" varchar(32) NOT NULL,
	"source_key" varchar(64) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"import_batch" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_raw_events_source_key_hash" ON "raw_events" USING btree ("source_table","source_key","content_hash");--> statement-breakpoint
CREATE INDEX "idx_raw_events_import_batch" ON "raw_events" USING btree ("import_batch");--> statement-breakpoint
CREATE INDEX "idx_raw_events_source_key" ON "raw_events" USING btree ("source_table","source_key");