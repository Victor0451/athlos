-- P6: manual tender reversals — an append-only link from a reversing tender to its original.
-- The cash ledger never rewrites history: editing or deleting a manual movement records an
-- opposite-direction reversal tender referencing the original exactly once (partial unique).
ALTER TABLE tesoreria.dues_cash_tenders
  ADD COLUMN IF NOT EXISTS reverses_tender_id uuid REFERENCES tesoreria.dues_cash_tenders(id);
CREATE UNIQUE INDEX IF NOT EXISTS dues_cash_tender_reversal_unique
  ON tesoreria.dues_cash_tenders (reverses_tender_id) WHERE reverses_tender_id IS NOT NULL;
