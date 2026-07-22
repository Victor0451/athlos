-- Normalize legacy enrollment state and add durable lifecycle metadata.
BEGIN;

DO $$
DECLARE
  unknown_count integer;
BEGIN
  SELECT count(*) INTO unknown_count
  FROM deportes.inscripciones
  WHERE lower(btrim(estado)) NOT IN ('activa', 'pendiente', 'baja');

  IF unknown_count > 0 THEN
    RAISE EXCEPTION 'padrones inscription migration aborted: unknown estado count=%', unknown_count
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE deportes.inscripciones
  ADD COLUMN IF NOT EXISTS baja_motivo text,
  ADD COLUMN IF NOT EXISTS fecha_baja date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
DECLARE
  normalized_count integer;
  historical_baja_count integer;
BEGIN
  UPDATE deportes.inscripciones
  SET estado = lower(btrim(estado))
  WHERE estado <> lower(btrim(estado));
  GET DIAGNOSTICS normalized_count = ROW_COUNT;

  SELECT count(*) INTO historical_baja_count
  FROM deportes.inscripciones
  WHERE estado = 'baja' AND (baja_motivo IS NULL OR fecha_baja IS NULL);

  UPDATE deportes.inscripciones
  SET baja_motivo = '[historic reason unavailable]'
  WHERE estado = 'baja' AND baja_motivo IS NULL;
  UPDATE deportes.inscripciones
  SET fecha_baja = CURRENT_DATE
  WHERE estado = 'baja' AND fecha_baja IS NULL;

  RAISE LOG 'padrones inscription lifecycle migration outcome=applied normalized_statuses=% historical_baja_backfilled=%',
    normalized_count, historical_baja_count;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inscripciones_estado_check'
      AND conrelid = 'deportes.inscripciones'::regclass
  ) THEN
    ALTER TABLE deportes.inscripciones
      ADD CONSTRAINT inscripciones_estado_check
      CHECK (estado IN ('activa', 'pendiente', 'baja')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inscripciones_baja_metadata_check'
      AND conrelid = 'deportes.inscripciones'::regclass
  ) THEN
    ALTER TABLE deportes.inscripciones
      ADD CONSTRAINT inscripciones_baja_metadata_check
      CHECK (estado <> 'baja' OR (baja_motivo IS NOT NULL AND fecha_baja IS NOT NULL AND length(btrim(baja_motivo)) > 0)) NOT VALID;
  END IF;
END $$;

ALTER TABLE deportes.inscripciones VALIDATE CONSTRAINT inscripciones_estado_check;
ALTER TABLE deportes.inscripciones VALIDATE CONSTRAINT inscripciones_baja_metadata_check;

CREATE TABLE IF NOT EXISTS deportes.inscripcion_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES "public"."operators"("id") ON DELETE RESTRICT,
  caller_key text NOT NULL,
  command text NOT NULL,
  request_fingerprint text NOT NULL,
  inscripcion_id uuid REFERENCES deportes.inscripciones(id) ON DELETE RESTRICT,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inscripcion_command_receipts_operator_caller_key_unique UNIQUE (operator_id, caller_key)
);

COMMIT;
