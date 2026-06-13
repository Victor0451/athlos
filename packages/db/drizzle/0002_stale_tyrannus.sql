CREATE TABLE "approval_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"action_type" text NOT NULL,
	"action_id" text NOT NULL,
	"context_summary" text NOT NULL,
	"created_by_operator_id" uuid NOT NULL,
	"approver_channel" text NOT NULL,
	"approver_address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_tokens_action_idx" ON "approval_tokens" USING btree ("action_type","action_id");