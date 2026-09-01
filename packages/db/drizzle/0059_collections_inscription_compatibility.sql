-- Forward-only compatibility for supported sparse Collections deployments.
DO $$
DECLARE
  sparse boolean; compatible boolean;
BEGIN
  SELECT
    to_regclass('deportes.inscripciones') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'deportes' AND table_name = 'inscripciones'
        AND (column_name IN ('fecha_baja', 'baja_motivo', 'updated_at') OR column_name LIKE 'baja_%'))
    AND NOT EXISTS (SELECT 1 FROM pg_constraint con
      WHERE con.conrelid = 'deportes.inscripciones'::regclass
        AND con.conname IN ('inscripciones_estado_check', 'inscripciones_baja_metadata_check')),
    EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = 'deportes' AND t.relname = 'inscripciones' AND a.attname = 'fecha_baja'
        AND NOT a.attisdropped AND format_type(a.atttypid, a.atttypmod) = 'date' AND NOT a.attnotnull
        AND pg_get_expr(ad.adbin, ad.adrelid) IS NULL)
    AND EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'deportes' AND table_name = 'inscripciones' AND column_name = 'baja_motivo'
        AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL)
    AND EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'deportes' AND table_name = 'inscripciones' AND column_name = 'updated_at'
        AND data_type = 'timestamp with time zone' AND is_nullable = 'NO' AND column_default = 'now()')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'deportes' AND table_name = 'inscripciones' AND column_name LIKE 'baja_%'
        AND column_name <> 'baja_motivo')
    AND EXISTS (SELECT 1 FROM pg_constraint con
      WHERE con.conrelid = 'deportes.inscripciones'::regclass AND con.conname = 'inscripciones_estado_check'
        AND con.convalidated AND pg_get_constraintdef(con.oid) = $check$CHECK ((estado = ANY (ARRAY['activa'::text, 'pendiente'::text, 'baja'::text])))$check$)
    AND EXISTS (SELECT 1 FROM pg_constraint con
      WHERE con.conrelid = 'deportes.inscripciones'::regclass AND con.conname = 'inscripciones_baja_metadata_check'
        AND con.convalidated AND pg_get_constraintdef(con.oid) = $check$CHECK (((estado <> 'baja'::text) OR ((fecha_baja IS NOT NULL) AND (baja_motivo IS NOT NULL) AND (btrim(baja_motivo) <> ''::text))))$check$)
  INTO sparse, compatible;

  IF sparse THEN
    ALTER TABLE deportes.inscripciones ADD COLUMN fecha_baja date, ADD COLUMN baja_motivo text,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE deportes.inscripciones
      ADD CONSTRAINT inscripciones_estado_check CHECK (estado IN ('activa', 'pendiente', 'baja')) NOT VALID,
      ADD CONSTRAINT inscripciones_baja_metadata_check CHECK (estado <> 'baja' OR (fecha_baja IS NOT NULL AND baja_motivo IS NOT NULL AND btrim(baja_motivo) <> '')) NOT VALID;
    ALTER TABLE deportes.inscripciones VALIDATE CONSTRAINT inscripciones_estado_check;
    ALTER TABLE deportes.inscripciones VALIDATE CONSTRAINT inscripciones_baja_metadata_check;
  ELSIF NOT compatible THEN
    RAISE EXCEPTION 'collections compatibility migration requires an exact sparse or compatible inscripciones schema'
      USING ERRCODE = 'P0001';
  END IF; END $$;
