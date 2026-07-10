-- Durable cross-replica comprobante replay. This hand-written migration is
-- deliberately excluded from Drizzle's incomplete production journal.
CREATE TABLE IF NOT EXISTS tesoreria.ctacte_comprobante_retries (
  idempotency_key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('rendering', 'complete', 'failed')),
  request_fingerprint text NOT NULL,
  pdf_base64 text,
  sha256 text,
  byte_size integer,
  filename text,
  movement_count integer,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS movement_count integer;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE tesoreria.ctacte_comprobante_retries SET request_fingerprint = idempotency_key WHERE request_fingerprint IS NULL;
ALTER TABLE tesoreria.ctacte_comprobante_retries ALTER COLUMN request_fingerprint SET NOT NULL;
ALTER TABLE tesoreria.ctacte ADD COLUMN IF NOT EXISTS idempotency_operator_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ctacte_comprobante_retries_status_check'
      AND conrelid = 'tesoreria.ctacte_comprobante_retries'::regclass
  ) THEN
    ALTER TABLE tesoreria.ctacte_comprobante_retries
      ADD CONSTRAINT ctacte_comprobante_retries_status_check
      CHECK (status IN ('rendering', 'complete', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ctacte_comprobante_retries_expires_at_idx
  ON tesoreria.ctacte_comprobante_retries (expires_at);
