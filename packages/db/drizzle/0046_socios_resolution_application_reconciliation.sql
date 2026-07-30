ALTER TABLE socios.legacy_member_evidence_resolution_application_receipts
  ADD COLUMN unresolved_unknown_type_count integer NOT NULL DEFAULT 0,
  ADD COLUMN unresolved_ambiguous_identity_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT legacy_member_evidence_resolution_application_receipts_unresolved_check
    CHECK (unresolved_count = unresolved_unknown_type_count + unresolved_ambiguous_identity_count) NOT VALID;
