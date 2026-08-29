ALTER TABLE tesoreria.dues_settlements
  ADD CONSTRAINT dues_settlements_no_self_reversal_check
  CHECK (reversal_of_settlement_id IS NULL OR reversal_of_settlement_id <> id);
CREATE UNIQUE INDEX dues_settlements_reversal_of_settlement_unique
  ON tesoreria.dues_settlements (reversal_of_settlement_id)
  WHERE reversal_of_settlement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tesoreria.validate_dues_compensation_reversal_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reversal_of_settlement_id uuid;
  compensated_allocation_settlement_id uuid;
BEGIN
  IF NEW.kind <> 'COMPENSATION'::tesoreria.dues_allocation_kind THEN RETURN NEW; END IF;
  SELECT reversal.reversal_of_settlement_id, original_allocation.settlement_id
    INTO reversal_of_settlement_id, compensated_allocation_settlement_id
    FROM tesoreria.dues_settlements AS reversal
    JOIN tesoreria.dues_allocations AS original_allocation
      ON original_allocation.id = NEW.compensates_allocation_id
    WHERE reversal.id = NEW.settlement_id;
  IF reversal_of_settlement_id IS DISTINCT FROM compensated_allocation_settlement_id THEN
    RAISE EXCEPTION 'compensation must belong to the reversal of its original settlement'
      USING ERRCODE = '23514', CONSTRAINT = 'dues_allocations_compensation_reversal_link_check';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_allocations_validate_compensation_reversal_link ON tesoreria.dues_allocations;
CREATE TRIGGER dues_allocations_validate_compensation_reversal_link
  BEFORE INSERT ON tesoreria.dues_allocations
  FOR EACH ROW EXECUTE FUNCTION tesoreria.validate_dues_compensation_reversal_link();
