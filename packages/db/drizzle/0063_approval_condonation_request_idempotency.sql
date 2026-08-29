ALTER TABLE "approval_tokens"
  ADD COLUMN "caller_key" text,
  ADD COLUMN "request_fingerprint" text;

CREATE UNIQUE INDEX "approval_tokens_condonation_request_idempotency_idx"
  ON "approval_tokens" ("created_by_operator_id", "caller_key")
  WHERE "action_type" = 'dues.condonation' AND "caller_key" IS NOT NULL;
