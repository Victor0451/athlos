CREATE OR REPLACE FUNCTION tesoreria.guard_cash_tender_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shift_row tesoreria.dues_cash_shifts%ROWTYPE; settlement_kind text; gasto_date date; BEGIN
  SELECT * INTO shift_row FROM tesoreria.dues_cash_shifts WHERE id = COALESCE(NEW.shift_id, OLD.shift_id) FOR SHARE;
  IF shift_row.status = 'CLOSED' THEN PERFORM tesoreria.cash_policy_error('closed cash shifts are immutable'); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM tesoreria.cash_policy_error('cash movements are append-only'); END IF;
  IF NEW.created_at < shift_row.opened_at OR NEW.created_at > clock_timestamp() OR clock_timestamp() > shift_row.opened_at + interval '24 hours' THEN PERFORM tesoreria.cash_policy_error('cash movement is outside the shift interval'); END IF;
  IF NEW.source_type = 'MANUAL' AND (NEW.source_id IS NOT NULL OR NEW.direction NOT IN ('INCOME','EXPENSE')) THEN PERFORM tesoreria.cash_policy_error('manual tender source is invalid'); END IF;
  IF NEW.source_type = 'SETTLEMENT' THEN
    IF NEW.source_id IS NULL THEN PERFORM tesoreria.cash_policy_error('settlement tender source is invalid'); END IF;
    SELECT settlement.kind INTO settlement_kind FROM tesoreria.dues_settlements AS settlement WHERE settlement.id = NEW.source_id;
    IF settlement_kind IS DISTINCT FROM 'MONETARY' THEN PERFORM tesoreria.cash_policy_error('only monetary settlements may enter cash'); END IF;
    IF NEW.direction = 'EXPENSE' AND NOT EXISTS (SELECT 1 FROM tesoreria.dues_settlements AS reversal JOIN tesoreria.dues_settlements AS original ON original.id = reversal.reversal_of_settlement_id JOIN tesoreria.dues_cash_tenders AS original_tender ON original_tender.source_id = original.id WHERE reversal.id = NEW.source_id AND original_tender.source_type = 'SETTLEMENT' AND original_tender.direction = 'INCOME' AND original_tender.shift_id = NEW.shift_id AND original_tender.tender = NEW.tender AND original_tender.amount = NEW.amount) THEN PERFORM tesoreria.cash_policy_error('settlement reversal expense is invalid'); END IF;
    IF NEW.direction NOT IN ('INCOME','EXPENSE') THEN PERFORM tesoreria.cash_policy_error('settlement tender source is invalid'); END IF;
  END IF;
  IF NEW.source_type = 'GASTO' THEN
    IF NEW.direction <> 'EXPENSE' OR NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM tesoreria.dues_cash_shift_expenses AS expense WHERE expense.shift_id = NEW.shift_id AND expense.gasto_id = NEW.source_id) THEN PERFORM tesoreria.cash_policy_error('gasto tender source is invalid'); END IF;
    SELECT gasto.fecha INTO gasto_date FROM tesoreria.gastos AS gasto WHERE gasto.id = NEW.source_id;
    IF gasto_date IS DISTINCT FROM shift_row.business_date THEN PERFORM tesoreria.cash_policy_error('gasto accounting date is outside the cash business date'); END IF;
  END IF;
  RETURN NEW;
END $$;
