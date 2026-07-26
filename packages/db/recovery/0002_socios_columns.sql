BEGIN;

DO $$
BEGIN
  IF to_regclass('socios.socios') IS NULL THEN
    RAISE EXCEPTION 'socios.socios prerequisite is missing';
  END IF;
END
$$;

ALTER TABLE socios.socios
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date,
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMIT;
