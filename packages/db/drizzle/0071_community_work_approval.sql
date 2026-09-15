-- migration 0071_community_work_approval.sql
-- Branch-local idx 58, timestamp 1789479500001
--
-- Community-work quota approval persistence.
-- Creates `dues_community_work_executions` in tesoreria schema.
-- Adds nullable community-work fields to `approval_tokens` (public).
--
-- Deployment hold note: This migration is on a feature branch and has NOT
-- been deployed against a full chain with peer migrations 0066–0070.
-- A future full-chain migration (idx 63) must reconcile with peer Caja
-- changes after peer 0066–0070 land on main. Do not deploy 0071 then
-- apply older migrations that copy peer SQL.
--
-- CONSTRAINTS & INDICES:
--   - dues_community_work_executions.id = UUID PK
--   - unique(action_id, requester_key): community-only, no obligation uniqueness
--   - FK restrict-delete on approval_token_id, settlement_id
--   - CHECK positive amount_cents; NOT NULL on fingerprint/receipt
--   - approval_tokens columns are ALL NULLABLE to preserve legacy condonation

CREATE TABLE IF NOT EXISTS tesoreria.dues_community_work_executions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_token_id           uuid NOT NULL REFERENCES public.approval_tokens(id) ON DELETE RESTRICT,
  settlement_id               uuid REFERENCES tesoreria.dues_settlements(id) ON DELETE RESTRICT,
  action_id                   text NOT NULL,
  requester_key               text NOT NULL,
  amount_cents                numeric(14,2),
  allocation_id               uuid REFERENCES tesoreria.dues_obligations(id) ON DELETE RESTRICT,
  snapshot_actor_fingerprint  text NOT NULL,
  receipt                     text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tesoreria.dues_community_work_executions
  ADD CONSTRAINT dues_cwe_amount_positive_check CHECK (amount_cents IS NULL OR amount_cents > 0);

CREATE UNIQUE INDEX IF NOT EXISTS dues_community_work_executions_action_requester_unique
  ON tesoreria.dues_community_work_executions (action_id, requester_key);

CREATE INDEX IF NOT EXISTS dues_community_work_executions_approval_idx
  ON tesoreria.dues_community_work_executions (approval_token_id);

CREATE INDEX IF NOT EXISTS dues_community_work_executions_fingerprint_idx
  ON tesoreria.dues_community_work_executions (snapshot_actor_fingerprint);

-- Nullable community-work extensions to approval_tokens (preserves legacy condonation rows).
ALTER TABLE public.approval_tokens
  ADD COLUMN IF NOT EXISTS community_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS requester_key        text,
  ADD COLUMN IF NOT EXISTS agreement_uuid       uuid,
  ADD COLUMN IF NOT EXISTS terms_version        integer,
  ADD COLUMN IF NOT EXISTS actor_fingerprint    text,
  ADD COLUMN IF NOT EXISTS receipt              text;
    
CREATE INDEX IF NOT EXISTS approval_tokens_community_work_idx
  ON public.approval_tokens (action_type, requester_key)
  WHERE action_type = 'dues.community-work-request';
