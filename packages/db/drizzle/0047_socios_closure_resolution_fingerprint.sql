BEGIN;
ALTER TABLE socios.evidence_closure_previews
  ADD COLUMN IF NOT EXISTS resolution_set_fingerprint varchar(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE socios.evidence_closure_confirmations
  ADD COLUMN IF NOT EXISTS resolution_set_fingerprint varchar(64) NOT NULL DEFAULT repeat('0', 64);
COMMIT;
