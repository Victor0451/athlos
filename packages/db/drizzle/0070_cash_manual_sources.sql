-- U5-A: latent manual-source identity only. U5-B will atomically create the tender and source.
CREATE TABLE IF NOT EXISTS tesoreria.dues_cash_manual_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES tesoreria.dues_cash_tenders(id) ON DELETE RESTRICT,
  account_code_snapshot text NOT NULL,
  account_name_snapshot text NOT NULL,
  account_path_snapshot jsonb NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_cash_manual_source_tender_unique UNIQUE (tender_id),
  CONSTRAINT dues_cash_manual_source_description_check CHECK (NULLIF(btrim(description), '') IS NOT NULL)
);

CREATE OR REPLACE FUNCTION tesoreria.guard_dues_cash_manual_source_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tender_row record; account_row contabilidad.plan_cuentas%ROWTYPE; expected_path jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'manual cash sources are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT tender.*, shift.assigned_operator_id, shift.status
  INTO tender_row
  FROM tesoreria.dues_cash_tenders AS tender
  JOIN tesoreria.dues_cash_shifts AS shift ON shift.id = tender.shift_id
  WHERE tender.id = NEW.tender_id
  FOR UPDATE OF tender, shift;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual cash source requires an authoritative tender' USING ERRCODE = '23503';
  END IF;
  IF tender_row.source_type <> 'MANUAL' OR tender_row.source_id IS NOT NULL
    OR (tender_row.operator_id <> tender_row.assigned_operator_id AND NOT EXISTS (
      SELECT 1 FROM public.operators AS actor WHERE actor.id = tender_row.operator_id AND actor.role = 'A'
    )) OR tender_row.status <> 'OPEN' THEN
    RAISE EXCEPTION 'manual cash source tender is not eligible for its open owner shift' USING ERRCODE = '23514';
  END IF;
  IF (tender_row.direction = 'INCOME' AND tender_row.tender NOT IN ('CASH','DEBIT','CREDIT','TRANSFER'))
    OR (tender_row.direction = 'EXPENSE' AND tender_row.tender NOT IN ('CASH','DEBIT','CREDIT','TRANSFER','BANK_DEBIT'))
    OR tender_row.direction NOT IN ('INCOME','EXPENSE') OR tender_row.amount <= 0 THEN
    RAISE EXCEPTION 'manual cash source tender violates the method matrix' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO account_row FROM contabilidad.plan_cuentas WHERE code = NEW.account_code_snapshot FOR SHARE;
  IF NOT FOUND OR account_row.active IS DISTINCT FROM true OR account_row.imputable IS DISTINCT FROM true
    OR EXISTS (SELECT 1 FROM contabilidad.plan_cuentas WHERE parent_code = account_row.code) THEN
    RAISE EXCEPTION 'manual cash source requires an active imputable leaf account' USING ERRCODE = '23514';
  END IF;
  WITH RECURSIVE path AS (
    SELECT code,name,parent_code,jsonb_build_array(jsonb_build_object('code',code,'name',name)) AS value
    FROM contabilidad.plan_cuentas WHERE code = account_row.code
    UNION ALL
    SELECT parent.code,parent.name,parent.parent_code,jsonb_build_array(jsonb_build_object('code',parent.code,'name',parent.name)) || path.value
    FROM contabilidad.plan_cuentas AS parent JOIN path ON path.parent_code = parent.code
  ) SELECT value INTO expected_path FROM path WHERE parent_code IS NULL;
  IF NEW.account_name_snapshot <> account_row.name OR NEW.account_path_snapshot IS DISTINCT FROM expected_path THEN
    RAISE EXCEPTION 'manual cash source account snapshot does not match the active catalog' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dues_cash_manual_source_policy ON tesoreria.dues_cash_manual_sources;
CREATE TRIGGER dues_cash_manual_source_policy
  BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_manual_sources
  FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_dues_cash_manual_source_policy();
