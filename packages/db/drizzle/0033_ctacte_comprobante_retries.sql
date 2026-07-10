-- Durable, cross-replica replay results for the 10-second comprobante bucket.
CREATE TABLE IF NOT EXISTS tesoreria.ctacte_comprobante_retries (
  idempotency_key text PRIMARY KEY,
  status text NOT NULL,
  pdf_base64 text,
  sha256 text,
  byte_size integer,
  filename text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ctacte_comprobante_retries_expires_at_idx
  ON tesoreria.ctacte_comprobante_retries (expires_at);
