-- Ordered projector receipts. Rows are immutable COMMIT evidence; recovery is forward-fix only.
BEGIN;

DO $$ BEGIN
  ALTER TYPE socios.legacy_member_review_state ADD VALUE IF NOT EXISTS 'missing_identity';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

COMMIT;
BEGIN;
ALTER TABLE socios.legacy_member_evidence
  DROP CONSTRAINT IF EXISTS legacy_member_evidence_check1;
ALTER TABLE socios.legacy_member_evidence
  ADD CONSTRAINT legacy_member_evidence_review_attachment_check CHECK (
    (review_state = 'validated' AND member_id IS NOT NULL AND membership_type_candidate_source_row_id IS NOT NULL)
    OR (review_state IN ('unknown_type', 'ambiguous_identity', 'missing_identity')
      AND member_id IS NULL AND membership_type_candidate_source_row_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS socios.evidence_closure_phase_receipts (
  execution_identity text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('candidates', 'members')),
  selected_batch_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (length(fingerprint) > 0),
  eligible_count integer NOT NULL CHECK (eligible_count >= 0),
  projected_count integer NOT NULL CHECK (projected_count >= 0),
  exception_count integer NOT NULL CHECK (exception_count >= 0),
  unknown_type_count integer NOT NULL DEFAULT 0 CHECK (unknown_type_count >= 0),
  ambiguous_identity_count integer NOT NULL DEFAULT 0 CHECK (ambiguous_identity_count >= 0),
  missing_identity_count integer NOT NULL DEFAULT 0 CHECK (missing_identity_count >= 0),
  status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
  started_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_identity, phase),
  CHECK (eligible_count = projected_count + exception_count),
  CHECK (exception_count = unknown_type_count + ambiguous_identity_count + missing_identity_count),
  CHECK (
    phase <> 'candidates'
    OR (unknown_type_count = 0 AND ambiguous_identity_count = 0 AND missing_identity_count = 0)
  )
);

COMMIT;
