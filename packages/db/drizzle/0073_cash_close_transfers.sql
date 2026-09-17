-- U8-A: one immutable server-computed CLOSE_TRANSFER outflow per positive close, pinned to the Valores a Depositar catalog leaf.
CREATE TABLE IF NOT EXISTS tesoreria.dues_cash_close_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id uuid NOT NULL REFERENCES tesoreria.dues_cash_closes(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES tesoreria.dues_cash_shifts(id) ON DELETE RESTRICT,
  account_code_snapshot text NOT NULL,
  account_name_snapshot text NOT NULL,
  account_path_snapshot jsonb NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_cash_close_transfer_close_unique UNIQUE (close_id),
  CONSTRAINT dues_cash_close_transfer_shift_unique UNIQUE (shift_id),
  CONSTRAINT dues_cash_close_transfer_amount_check CHECK (amount > 0)
);

CREATE OR REPLACE FUNCTION tesoreria.guard_dues_cash_close_transfer_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE close_row tesoreria.dues_cash_closes%ROWTYPE; account_row contabilidad.plan_cuentas%ROWTYPE; expected_path jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash close transfers are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO close_row FROM tesoreria.dues_cash_closes WHERE id = NEW.close_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash close transfer requires an authoritative close' USING ERRCODE = '23503';
  END IF;
  IF close_row.shift_id <> NEW.shift_id THEN
    RAISE EXCEPTION 'cash close transfer does not correlate with its close shift' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO account_row FROM contabilidad.plan_cuentas WHERE code = '1.1.3.02' FOR SHARE;
  IF NOT FOUND OR account_row.active IS DISTINCT FROM true OR account_row.imputable IS DISTINCT FROM true
    OR EXISTS (SELECT 1 FROM contabilidad.plan_cuentas WHERE parent_code = account_row.code) THEN
    RAISE EXCEPTION 'cash close transfer requires the active imputable Valores a Depositar leaf' USING ERRCODE = '23514';
  END IF;
  WITH RECURSIVE path AS (
    SELECT code,name,parent_code,jsonb_build_array(jsonb_build_object('code',code,'name',name)) AS value
    FROM contabilidad.plan_cuentas WHERE code = account_row.code
    UNION ALL
    SELECT parent.code,parent.name,parent.parent_code,jsonb_build_array(jsonb_build_object('code',parent.code,'name',parent.name)) || path.value
    FROM contabilidad.plan_cuentas AS parent JOIN path ON path.parent_code = parent.code
  ) SELECT value INTO expected_path FROM path WHERE parent_code IS NULL;
  IF NEW.account_code_snapshot <> account_row.code OR NEW.account_name_snapshot <> account_row.name OR NEW.account_path_snapshot IS DISTINCT FROM expected_path THEN
    RAISE EXCEPTION 'cash close transfer account snapshot does not match the active catalog' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dues_cash_close_transfer_policy ON tesoreria.dues_cash_close_transfers;
CREATE TRIGGER dues_cash_close_transfer_policy
  BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_close_transfers
  FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_dues_cash_close_transfer_policy();
