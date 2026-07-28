BEGIN;
CREATE TABLE IF NOT EXISTS socios.evidence_closure_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_batch_id uuid NOT NULL,
  socios_batch_id uuid NOT NULL, fingerprint varchar(64) NOT NULL,
  catalog_count integer NOT NULL CHECK (catalog_count >= 0), socios_count integer NOT NULL CHECK (socios_count >= 0),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socios.evidence_closure_leases (
  pair_fingerprint varchar(64) PRIMARY KEY, owner text NOT NULL, fence bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
