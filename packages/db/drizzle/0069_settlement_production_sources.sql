-- U7-A: storage only. U7-B will write this source in the authoritative settlement transaction.
-- The source retains accounting attribution; the existing settlement/tender remains the payment authority.
CREATE TABLE IF NOT EXISTS tesoreria.dues_cash_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES tesoreria.dues_cash_shifts(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL REFERENCES tesoreria.dues_settlements(id) ON DELETE RESTRICT,
  origin text NOT NULL,
  account_code_snapshot text NOT NULL,
  account_name_snapshot text NOT NULL,
  account_path_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_cash_source_origin_check
    CHECK (origin = 'AUTOMATIC_DUES_PRODUCTION'),
  CONSTRAINT dues_cash_source_settlement_unique UNIQUE (settlement_id),
  CONSTRAINT dues_cash_source_dues_snapshot_check CHECK (
    account_code_snapshot = '4.1.01'
    AND account_name_snapshot = 'Cuotas sociales'
    AND account_path_snapshot = '[{"code":"4","name":"Ingresos"},{"code":"4.1","name":"Ingresos Operativos"},{"code":"4.1.01","name":"Cuotas sociales"}]'::jsonb
  )
);

CREATE OR REPLACE FUNCTION tesoreria.guard_dues_cash_source_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_row contabilidad.plan_cuentas%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash sources are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO account_row
  FROM contabilidad.plan_cuentas
  WHERE code = NEW.account_code_snapshot
  FOR SHARE;
  IF account_row.active IS DISTINCT FROM true OR account_row.imputable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'automatic dues production requires active imputable Cuotas sociales' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dues_cash_source_policy ON tesoreria.dues_cash_sources;
CREATE TRIGGER dues_cash_source_policy
  BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_sources
  FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_dues_cash_source_policy();
