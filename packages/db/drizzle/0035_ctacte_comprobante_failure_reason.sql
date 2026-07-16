-- Additive terminal failure classification for comprobante rendering.
ALTER TABLE tesoreria.ctacte_comprobante_retries
  ADD COLUMN IF NOT EXISTS failure_reason text DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ctacte_comprobante_retries_failure_reason_check'
      AND conrelid = 'tesoreria.ctacte_comprobante_retries'::regclass
  ) THEN
    ALTER TABLE tesoreria.ctacte_comprobante_retries
      ADD CONSTRAINT ctacte_comprobante_retries_failure_reason_check
      CHECK (failure_reason IS NULL OR failure_reason = 'RENDER_TIMEOUT') NOT VALID;
  END IF;
END $$;

ALTER TABLE tesoreria.ctacte_comprobante_retries
  VALIDATE CONSTRAINT ctacte_comprobante_retries_failure_reason_check;
