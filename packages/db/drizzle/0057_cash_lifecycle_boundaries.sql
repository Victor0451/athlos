DO $$ BEGIN
  ALTER TABLE tesoreria.dues_cash_tenders
    ADD CONSTRAINT dues_cash_tender_manual_reason_check
    CHECK (source_type <> 'MANUAL' OR NULLIF(btrim(reason), '') IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION tesoreria.guard_cash_close_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row tesoreria.dues_cash_shifts%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT * INTO shift_row FROM tesoreria.dues_cash_shifts WHERE id = NEW.shift_id FOR UPDATE;
  IF shift_row.status <> 'OPEN' THEN PERFORM tesoreria.cash_policy_error('cash close requires an open shift'); END IF;
  IF NEW.closed_at < shift_row.opened_at THEN PERFORM tesoreria.cash_policy_error('cash close cannot precede opening'); END IF;
  IF NEW.force_close AND NULLIF(btrim(NEW.reason), '') IS NULL THEN PERFORM tesoreria.cash_policy_error('forced cash close requires a reason'); END IF;
  IF NEW.force_close AND NEW.closed_at < shift_row.opened_at + interval '24 hours' THEN PERFORM tesoreria.cash_policy_error('forced cash close requires an expired shift'); END IF;
  IF NEW.force_close AND COALESCE(NEW.authorization_evidence->>'role', '') NOT IN ('ADMIN', 'TESORERO') THEN PERFORM tesoreria.cash_policy_error('forced cash close requires a finance operator'); END IF;
  IF NEW.closed_at > shift_row.opened_at + interval '24 hours' AND NOT NEW.force_close THEN PERFORM tesoreria.cash_policy_error('expired cash shifts require a forced close'); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tesoreria.complete_cash_close_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tesoreria.dues_cash_shifts
  SET status = 'CLOSED', closed_at = NEW.closed_at
  WHERE id = NEW.shift_id AND status = 'OPEN';
  IF NOT FOUND THEN PERFORM tesoreria.cash_policy_error('cash close requires an open shift'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_cash_close_lifecycle ON tesoreria.dues_cash_closes;
CREATE CONSTRAINT TRIGGER dues_cash_close_lifecycle
  AFTER INSERT ON tesoreria.dues_cash_closes
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION tesoreria.complete_cash_close_lifecycle();

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
