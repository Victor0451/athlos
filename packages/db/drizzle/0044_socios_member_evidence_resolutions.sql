-- Immutable steward resolutions overlay reviewed legacy evidence; corrections append a successor.
BEGIN;

DO $$ BEGIN
  ALTER TABLE socios.legacy_member_evidence
    ADD CONSTRAINT legacy_member_evidence_id_review_state_unique UNIQUE (id, review_state);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_member_evidence_id uuid NOT NULL REFERENCES socios.legacy_member_evidence(id) ON DELETE RESTRICT,
  resolution_kind socios.legacy_member_review_state NOT NULL,
  selected_member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  selected_membership_type_candidate_source_row_id uuid
    REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  steward_operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  evidence_fingerprint varchar(64) NOT NULL CHECK (length(evidence_fingerprint) = 64),
  supersedes_resolution_id uuid
    REFERENCES socios.legacy_member_evidence_resolutions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_member_evidence_resolutions_kind_matches_evidence_fk
    FOREIGN KEY (legacy_member_evidence_id, resolution_kind)
    REFERENCES socios.legacy_member_evidence (id, review_state),
  CONSTRAINT legacy_member_evidence_resolutions_selection_check CHECK (
    (resolution_kind = 'unknown_type'
      AND selected_member_id IS NOT NULL
      AND selected_membership_type_candidate_source_row_id IS NOT NULL)
    OR (resolution_kind = 'ambiguous_identity' AND selected_member_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_steward_idempotency_key_unique
  ON socios.legacy_member_evidence_resolutions (steward_operator_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_root_evidence_unique
  ON socios.legacy_member_evidence_resolutions (legacy_member_evidence_id)
  WHERE supersedes_resolution_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_successor_unique
  ON socios.legacy_member_evidence_resolutions (supersedes_resolution_id)
  WHERE supersedes_resolution_id IS NOT NULL;

CREATE OR REPLACE FUNCTION socios.prevent_legacy_member_evidence_resolution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy member evidence resolutions are append-only';
END;
$$;
DROP TRIGGER IF EXISTS legacy_member_evidence_resolutions_append_only
  ON socios.legacy_member_evidence_resolutions;
CREATE TRIGGER legacy_member_evidence_resolutions_append_only
  BEFORE UPDATE OR DELETE ON socios.legacy_member_evidence_resolutions
  FOR EACH ROW EXECUTE FUNCTION socios.prevent_legacy_member_evidence_resolution_mutation();

COMMIT;
