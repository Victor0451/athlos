-- Immutable reviewed member evidence. Schema rollback is forward-fix only.
BEGIN;

DO $$ BEGIN
  CREATE TYPE socios.legacy_member_fee_state AS ENUM ('blank', 'zero', 'non_zero');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE socios.legacy_member_review_state AS ENUM ('validated', 'unknown_type', 'ambiguous_identity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL UNIQUE REFERENCES public.raw_events(id) ON DELETE RESTRICT,
  import_batch uuid NOT NULL,
  identity_evidence_id uuid NOT NULL REFERENCES socios.legacy_identity_evidence(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  membership_type_candidate_source_row_id uuid REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  legacy_type_code text NOT NULL,
  legacy_category text,
  fee_state socios.legacy_member_fee_state NOT NULL,
  fee_value numeric(11, 2),
  review_state socios.legacy_member_review_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (fee_state = 'blank' AND fee_value IS NULL)
    OR (fee_state = 'zero' AND fee_value = 0)
    OR (fee_state = 'non_zero' AND fee_value IS NOT NULL AND fee_value <> 0)
  ),
  CHECK (
    (review_state = 'validated' AND member_id IS NOT NULL AND membership_type_candidate_source_row_id IS NOT NULL)
    OR (review_state IN ('unknown_type', 'ambiguous_identity') AND member_id IS NULL AND membership_type_candidate_source_row_id IS NULL)
  )
);

COMMIT;
