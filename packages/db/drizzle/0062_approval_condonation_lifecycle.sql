ALTER TABLE "approval_tokens"
  ADD COLUMN "condonation_snapshot" jsonb,
  ADD COLUMN "request_reason" text,
  ADD COLUMN "request_evidence" text,
  ADD COLUMN "decided_by_operator_id" uuid REFERENCES "operators"("id") ON DELETE restrict,
  ADD COLUMN "decision_reason" text,
  ADD COLUMN "decision_evidence" text,
  ADD COLUMN "decided_at" timestamp with time zone,
  ADD COLUMN "execution_id" uuid;
