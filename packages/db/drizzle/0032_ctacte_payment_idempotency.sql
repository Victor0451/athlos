-- Migration 0032: payment idempotency key constraint
--
-- Migration 0031 may already be applied, so this forward-only migration owns
-- the idempotency column and replaces its partial index with a full unique
-- index. PostgreSQL can infer this index for ON CONFLICT (idempotency_key).

ALTER TABLE "tesoreria"."ctacte"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

DROP INDEX IF EXISTS "tesoreria"."ctacte_idempotency_key_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_idempotency_key_unique"
  ON "tesoreria"."ctacte" ("idempotency_key");
