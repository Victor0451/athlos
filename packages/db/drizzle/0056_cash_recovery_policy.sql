ALTER TABLE tesoreria.dues_cash_closes ADD COLUMN IF NOT EXISTS force_close boolean NOT NULL DEFAULT false;
ALTER TABLE tesoreria.gasto_compensations DROP CONSTRAINT IF EXISTS gasto_compensations_original_gasto_id_caller_key_key;
DROP INDEX IF EXISTS tesoreria.gasto_compensations_original_gasto_id_caller_key_key;

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_close_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row tesoreria.dues_cash_shifts%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT * INTO shift_row FROM tesoreria.dues_cash_shifts WHERE id = NEW.shift_id FOR UPDATE;
  IF shift_row.status <> 'OPEN' THEN PERFORM tesoreria.cash_policy_error('cash close requires an open shift'); END IF;
  IF NEW.closed_at < shift_row.opened_at THEN PERFORM tesoreria.cash_policy_error('cash close cannot precede opening'); END IF;
  IF NEW.force_close AND NULLIF(btrim(NEW.reason), '') IS NULL THEN PERFORM tesoreria.cash_policy_error('forced cash close requires a reason'); END IF;
  IF NEW.closed_at > shift_row.opened_at + interval '24 hours' AND NOT NEW.force_close THEN PERFORM tesoreria.cash_policy_error('expired cash shifts require a forced close'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_close_policy ON tesoreria.dues_cash_closes;
CREATE TRIGGER dues_cash_close_policy BEFORE INSERT ON tesoreria.dues_cash_closes FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_cash_close_policy();

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_shift_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE close_row tesoreria.dues_cash_closes%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('direct CLOSED shift creation requires a lifecycle close'); END IF;
    NEW.timezone := 'America/Argentina/Jujuy';
    NEW.business_date := (NEW.opened_at AT TIME ZONE 'America/Argentina/Jujuy')::date;
    IF NEW.status = 'OPEN' AND NEW.closed_at IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('open cash shifts cannot have a close time'); END IF;
  ELSE
    IF OLD.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('closed cash shifts are immutable'); END IF;
    IF NEW.opened_at <> OLD.opened_at OR NEW.business_date <> OLD.business_date OR NEW.timezone <> OLD.timezone THEN PERFORM tesoreria.cash_policy_error('cash shift opening identity is immutable'); END IF;
    IF NEW.status = 'OPEN' AND NEW.closed_at IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('open cash shifts cannot have a close time'); END IF;
    IF NEW.status = 'CLOSED' THEN
      SELECT * INTO close_row FROM tesoreria.dues_cash_closes WHERE shift_id = NEW.id;
      IF NOT FOUND THEN PERFORM tesoreria.cash_policy_error('closed cash shifts require an immutable close'); END IF;
      IF NEW.closed_at IS NULL OR NEW.closed_at < OLD.opened_at THEN PERFORM tesoreria.cash_policy_error('cash close cannot precede opening'); END IF;
      IF NEW.closed_at > OLD.opened_at + interval '24 hours' AND NOT close_row.force_close THEN PERFORM tesoreria.cash_policy_error('expired cash shifts require a forced close'); END IF;
      IF close_row.force_close AND NULLIF(btrim(close_row.reason), '') IS NULL THEN PERFORM tesoreria.cash_policy_error('forced cash close requires a reason'); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_shift_policy ON tesoreria.dues_cash_shifts;
CREATE TRIGGER dues_cash_shift_policy BEFORE INSERT OR UPDATE ON tesoreria.dues_cash_shifts FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_cash_shift_policy();

CREATE OR REPLACE FUNCTION tesoreria.reject_closed_gasto_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE included_shift uuid;
BEGIN
  SELECT s.id INTO included_shift
  FROM tesoreria.dues_cash_shift_expenses e
  JOIN tesoreria.dues_cash_shifts s ON s.id = e.shift_id
  WHERE e.gasto_id = OLD.id
  ORDER BY s.id
  FOR UPDATE;
  IF included_shift IS NOT NULL THEN PERFORM tesoreria.cash_policy_error('gasto is immutable after cash inclusion'); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gastos_closed_cash_mutation ON tesoreria.gastos;
CREATE TRIGGER gastos_closed_cash_mutation BEFORE UPDATE OR DELETE ON tesoreria.gastos FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_closed_gasto_mutation();
