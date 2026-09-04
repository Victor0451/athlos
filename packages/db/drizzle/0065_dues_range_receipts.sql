-- A range receipt binds [period_start, period_end): its end is the first day
-- after the last processed month. Monthly obligation uniqueness already exists
-- on fresh installs; keep it explicit for databases that predate 0049.
ALTER TABLE tesoreria.dues_generation_receipts
  DROP CONSTRAINT IF EXISTS dues_generation_receipts_period_check;
ALTER TABLE tesoreria.dues_generation_receipts
  ADD CONSTRAINT dues_generation_receipts_period_check
  CHECK (
    period_start = date_trunc('month', period_start)::date
    AND period_end > period_start
    AND period_end = date_trunc('month', period_end)::date
  );

CREATE UNIQUE INDEX IF NOT EXISTS dues_obligations_monthly_natural_key
  ON tesoreria.dues_obligations (socio_id, period_start)
  WHERE kind = 'MONTHLY_DUES';
