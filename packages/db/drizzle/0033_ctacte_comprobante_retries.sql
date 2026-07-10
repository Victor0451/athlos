-- Durable cross-replica comprobante replay. This hand-written migration is
-- deliberately excluded from Drizzle's incomplete production journal.
CREATE TABLE IF NOT EXISTS tesoreria.ctacte_comprobante_retries (
  idempotency_key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('rendering', 'complete', 'failed')),
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
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE tesoreria.ctacte_comprobante_retries ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS ctacte_comprobante_retries_expires_at_idx
  ON tesoreria.ctacte_comprobante_retries (expires_at);
