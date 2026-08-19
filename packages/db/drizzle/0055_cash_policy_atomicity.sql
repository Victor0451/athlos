ALTER TABLE tesoreria.dues_cash_shifts ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE tesoreria.dues_cash_shifts ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Argentina/Jujuy';
UPDATE tesoreria.dues_cash_shifts SET business_date = (opened_at AT TIME ZONE 'America/Argentina/Jujuy')::date WHERE business_date IS NULL;
ALTER TABLE tesoreria.dues_cash_shifts ALTER COLUMN business_date SET NOT NULL;
DO $$ BEGIN ALTER TABLE tesoreria.dues_cash_shifts ADD CONSTRAINT dues_cash_shift_timezone_check CHECK (timezone = 'America/Argentina/Jujuy'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE tesoreria.dues_cash_tenders ADD COLUMN IF NOT EXISTS request_fingerprint char(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE tesoreria.gasto_compensations ADD COLUMN IF NOT EXISTS request_fingerprint char(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE tesoreria.dues_cash_tenders ALTER COLUMN request_fingerprint DROP DEFAULT;
ALTER TABLE tesoreria.gasto_compensations ALTER COLUMN request_fingerprint DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS dues_cash_tender_operator_key_unique ON tesoreria.dues_cash_tenders (operator_id, caller_key);
CREATE UNIQUE INDEX IF NOT EXISTS gasto_compensation_operator_key_unique ON tesoreria.gasto_compensations (operator_id, caller_key);
CREATE TABLE IF NOT EXISTS tesoreria.gasto_mutation_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT, caller_key text NOT NULL, request_fingerprint char(64) NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (operator_id, caller_key));

CREATE OR REPLACE FUNCTION tesoreria.cash_policy_error(message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%', message USING ERRCODE = '55000'; END $$;

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_shift_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.timezone := 'America/Argentina/Jujuy';
    NEW.business_date := (NEW.opened_at AT TIME ZONE 'America/Argentina/Jujuy')::date;
    IF NEW.status = 'OPEN' AND NEW.closed_at IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('open cash shifts cannot have a close time'); END IF;
  ELSE
    IF OLD.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('closed cash shifts are immutable'); END IF;
    IF NEW.opened_at <> OLD.opened_at OR NEW.business_date <> OLD.business_date OR NEW.timezone <> OLD.timezone THEN PERFORM tesoreria.cash_policy_error('cash shift opening identity is immutable'); END IF;
    IF NEW.status = 'OPEN' AND NEW.closed_at IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('open cash shifts cannot have a close time'); END IF;
    IF NEW.status = 'CLOSED' AND (NEW.closed_at IS NULL OR NEW.closed_at < OLD.opened_at OR NEW.closed_at > OLD.opened_at + interval '24 hours') THEN PERFORM tesoreria.cash_policy_error('cash shifts must close within 24 hours'); END IF;
    IF NEW.status = 'CLOSED' AND NOT EXISTS (SELECT 1 FROM tesoreria.dues_cash_closes WHERE shift_id = NEW.id) THEN PERFORM tesoreria.cash_policy_error('closed cash shifts require an immutable close'); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_shift_policy ON tesoreria.dues_cash_shifts;
CREATE TRIGGER dues_cash_shift_policy BEFORE INSERT OR UPDATE ON tesoreria.dues_cash_shifts FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_cash_shift_policy();

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_tender_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row tesoreria.dues_cash_shifts%ROWTYPE; settlement_kind text; gasto_date date; BEGIN
  SELECT * INTO shift_row FROM tesoreria.dues_cash_shifts WHERE id = COALESCE(NEW.shift_id, OLD.shift_id) FOR SHARE;
  IF shift_row.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('closed cash shifts are immutable'); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM tesoreria.cash_policy_error('cash movements are append-only'); END IF;
  IF NEW.created_at < shift_row.opened_at OR NEW.created_at > clock_timestamp() OR clock_timestamp() > shift_row.opened_at + interval '24 hours' THEN PERFORM tesoreria.cash_policy_error('cash movement is outside the shift interval'); END IF;
  IF NEW.source_type = 'MANUAL' AND (NEW.source_id IS NOT NULL OR NEW.direction NOT IN ('INCOME','EXPENSE')) THEN PERFORM tesoreria.cash_policy_error('manual tender source is invalid'); END IF;
  IF NEW.source_type = 'SETTLEMENT' THEN
    IF NEW.direction <> 'INCOME' OR NEW.source_id IS NULL THEN PERFORM tesoreria.cash_policy_error('settlement tender source is invalid'); END IF;
    SELECT kind INTO settlement_kind FROM tesoreria.dues_settlements WHERE id = NEW.source_id;
    IF settlement_kind IS DISTINCT FROM 'MONETARY' THEN PERFORM tesoreria.cash_policy_error('only monetary settlements may enter cash'); END IF;
  END IF;
  IF NEW.source_type = 'GASTO' THEN
    IF NEW.direction <> 'EXPENSE' OR NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM tesoreria.dues_cash_shift_expenses WHERE shift_id = NEW.shift_id AND gasto_id = NEW.source_id) THEN PERFORM tesoreria.cash_policy_error('gasto tender source is invalid'); END IF;
    SELECT fecha INTO gasto_date FROM tesoreria.gastos WHERE id = NEW.source_id;
    IF gasto_date IS DISTINCT FROM shift_row.business_date THEN PERFORM tesoreria.cash_policy_error('gasto accounting date is outside the cash business date'); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_tender_policy ON tesoreria.dues_cash_tenders;
CREATE TRIGGER dues_cash_tender_policy BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_tenders FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_cash_tender_policy();

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_expense_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row tesoreria.dues_cash_shifts%ROWTYPE; gasto_date date; BEGIN
  SELECT * INTO shift_row FROM tesoreria.dues_cash_shifts WHERE id = COALESCE(NEW.shift_id, OLD.shift_id) FOR SHARE;
  IF shift_row.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('closed cash shifts are immutable'); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM tesoreria.cash_policy_error('cash expense inclusions are append-only'); END IF;
  SELECT fecha INTO gasto_date FROM tesoreria.gastos WHERE id = NEW.gasto_id;
  IF gasto_date IS DISTINCT FROM shift_row.business_date THEN PERFORM tesoreria.cash_policy_error('gasto accounting date is outside the cash business date'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_expense_immutable ON tesoreria.dues_cash_shift_expenses;
CREATE TRIGGER dues_cash_expense_immutable BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_shift_expenses FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_cash_expense_policy();

CREATE OR REPLACE FUNCTION tesoreria.reject_closed_gasto_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed_shift uuid; BEGIN
  SELECT s.id INTO closed_shift FROM tesoreria.dues_cash_shift_expenses e JOIN tesoreria.dues_cash_shifts s ON s.id = e.shift_id JOIN tesoreria.dues_cash_closes c ON c.shift_id = s.id WHERE e.gasto_id = OLD.id ORDER BY s.id FOR UPDATE;
  IF closed_shift IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('gasto belongs to a closed cash shift'); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gastos_closed_cash_mutation ON tesoreria.gastos;
CREATE TRIGGER gastos_closed_cash_mutation BEFORE UPDATE OR DELETE ON tesoreria.gastos FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_closed_gasto_mutation();

CREATE OR REPLACE FUNCTION tesoreria.validate_gasto_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_gasto_id = NEW.compensating_gasto_id OR NOT EXISTS (SELECT 1 FROM tesoreria.dues_cash_shift_expenses e JOIN tesoreria.dues_cash_closes c ON c.shift_id = e.shift_id WHERE e.gasto_id = NEW.original_gasto_id) THEN
    RAISE EXCEPTION 'compensation requires a distinct gasto from a closed cash shift' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gasto_compensation_policy ON tesoreria.gasto_compensations;
CREATE TRIGGER gasto_compensation_policy BEFORE INSERT ON tesoreria.gasto_compensations FOR EACH ROW EXECUTE FUNCTION tesoreria.validate_gasto_compensation();
