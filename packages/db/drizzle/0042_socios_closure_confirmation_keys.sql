BEGIN;
DO $$ BEGIN
  ALTER TABLE socios.evidence_closure_previews
    ADD CONSTRAINT evidence_closure_previews_confirmation_binding_unique
    UNIQUE (id, catalog_batch_id, socios_batch_id, fingerprint);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS socios.evidence_closure_confirmations (
  idempotency_key text PRIMARY KEY,
  catalog_batch_id uuid NOT NULL,
  socios_batch_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  fingerprint varchar(64) NOT NULL,
  CONSTRAINT evidence_closure_confirmations_preview_binding_fk
    FOREIGN KEY (preview_id, catalog_batch_id, socios_batch_id, fingerprint)
    REFERENCES socios.evidence_closure_previews (id, catalog_batch_id, socios_batch_id, fingerprint),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
