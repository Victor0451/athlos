-- Retain the desk guard during the staged U3a rollout; U3b owns its later removal.
DO $$
DECLARE
  duplicate_shift_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id)
  INTO duplicate_shift_ids
  FROM tesoreria.dues_cash_shifts
  WHERE status = 'OPEN'
    AND assigned_operator_id IN (
      SELECT assigned_operator_id
      FROM tesoreria.dues_cash_shifts
      WHERE status = 'OPEN'
      GROUP BY assigned_operator_id
      HAVING count(*) > 1
    );

  IF duplicate_shift_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add dues_cash_shift_open_operator_unique: duplicate OPEN assigned_operator_id shifts: %',
      duplicate_shift_ids
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS dues_cash_shift_open_operator_unique
  ON tesoreria.dues_cash_shifts (assigned_operator_id)
  WHERE status = 'OPEN';
