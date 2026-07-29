-- Operational resolution applications are append-only overlays; source evidence remains historical fact.
BEGIN;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolution_application_receipts (
  execution_identity text PRIMARY KEY,
  selected_batch_id uuid NOT NULL,
  application_fingerprint varchar(64) NOT NULL CHECK (length(application_fingerprint) = 64),
  eligible_count integer NOT NULL CHECK (eligible_count >= 0),
  applied_count integer NOT NULL CHECK (applied_count >= 0),
  unresolved_count integer NOT NULL CHECK (unresolved_count >= 0),
  stale_count integer NOT NULL CHECK (stale_count >= 0),
  technical_count integer NOT NULL CHECK (technical_count >= 0),
  status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
  committed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (eligible_count = applied_count + unresolved_count + stale_count + technical_count)
);

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolution_applications (
  execution_identity text NOT NULL REFERENCES socios.legacy_member_evidence_resolution_application_receipts(execution_identity) ON DELETE RESTRICT,
  legacy_member_evidence_id uuid NOT NULL REFERENCES socios.legacy_member_evidence(id) ON DELETE RESTRICT,
  resolution_id uuid NOT NULL REFERENCES socios.legacy_member_evidence_resolutions(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  membership_type_candidate_source_row_id uuid NOT NULL
    REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  application_fingerprint varchar(64) NOT NULL CHECK (length(application_fingerprint) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_identity, legacy_member_evidence_id),
  UNIQUE (execution_identity, resolution_id)
);

CREATE OR REPLACE FUNCTION socios.prevent_legacy_member_evidence_resolution_application_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy member evidence resolution applications are append-only';
END;
$$;
DROP TRIGGER IF EXISTS legacy_member_evidence_resolution_applications_append_only
  ON socios.legacy_member_evidence_resolution_applications;
CREATE TRIGGER legacy_member_evidence_resolution_applications_append_only
  BEFORE UPDATE OR DELETE ON socios.legacy_member_evidence_resolution_applications
  FOR EACH ROW EXECUTE FUNCTION socios.prevent_legacy_member_evidence_resolution_application_mutation();
DROP TRIGGER IF EXISTS legacy_member_evidence_resolution_application_receipts_append_only
  ON socios.legacy_member_evidence_resolution_application_receipts;
CREATE TRIGGER legacy_member_evidence_resolution_application_receipts_append_only
  BEFORE UPDATE OR DELETE ON socios.legacy_member_evidence_resolution_application_receipts
  FOR EACH ROW EXECUTE FUNCTION socios.prevent_legacy_member_evidence_resolution_application_mutation();

COMMIT;
