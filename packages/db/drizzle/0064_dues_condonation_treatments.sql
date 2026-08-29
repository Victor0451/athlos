CREATE TABLE "tesoreria"."dues_condonation_executions" (
  "execution_id" uuid PRIMARY KEY,
  "approval_token_id" uuid NOT NULL UNIQUE REFERENCES "approval_tokens"("id") ON DELETE RESTRICT,
  "socio_id" uuid NOT NULL REFERENCES "socios"."socios"("id") ON DELETE RESTRICT,
  "actor_id" uuid NOT NULL REFERENCES "operators"("id") ON DELETE RESTRICT,
  "currency" char(3) NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'), "total_amount" numeric(14,2) NOT NULL CHECK ("total_amount" > 0),
  "approved_snapshot" jsonb NOT NULL, "reason" text NOT NULL, "evidence" text NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE "tesoreria"."dues_condonation_treatments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "execution_id" uuid NOT NULL REFERENCES "tesoreria"."dues_condonation_executions"("execution_id") ON DELETE RESTRICT,
  "approval_token_id" uuid NOT NULL REFERENCES "approval_tokens"("id") ON DELETE RESTRICT, "socio_id" uuid NOT NULL REFERENCES "socios"."socios"("id") ON DELETE RESTRICT, "obligation_id" uuid NOT NULL REFERENCES "tesoreria"."dues_obligations"("id") ON DELETE RESTRICT,
  "actor_id" uuid NOT NULL REFERENCES "operators"("id") ON DELETE RESTRICT, "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0), "currency" char(3) NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
  "approved_snapshot" jsonb NOT NULL, "reason" text NOT NULL, "evidence" text NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now(), UNIQUE ("execution_id", "obligation_id")
);
CREATE INDEX "dues_condonation_treatments_obligation_idx" ON "tesoreria"."dues_condonation_treatments" ("obligation_id");
