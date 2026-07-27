-- Immutable legacy membership catalog evidence. Schema rollback is forward-fix only.
BEGIN;

DO $$ BEGIN
  CREATE TYPE socios.legacy_membership_snapshot_state AS ENUM ('applied', 'rolled_back');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.legacy_membership_type_snapshots (
  batch_id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  state socios.legacy_membership_snapshot_state NOT NULL DEFAULT 'applied',
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS socios.legacy_membership_type_source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL UNIQUE REFERENCES public.raw_events(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES socios.legacy_membership_type_snapshots(batch_id) ON DELETE RESTRICT,
  record_ordinal integer NOT NULL CHECK (record_ordinal > 0),
  code text NOT NULL,
  name text NOT NULL,
  letter text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, record_ordinal)
);
CREATE INDEX IF NOT EXISTS legacy_membership_type_source_rows_code_batch_idx
  ON socios.legacy_membership_type_source_rows (code, batch_id);

CREATE TABLE IF NOT EXISTS socios.legacy_membership_type_candidates (
  snapshot_batch_id uuid NOT NULL REFERENCES socios.legacy_membership_type_snapshots(batch_id) ON DELETE RESTRICT,
  code text NOT NULL,
  source_row_id uuid NOT NULL UNIQUE REFERENCES socios.legacy_membership_type_source_rows(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_batch_id, code)
);

CREATE OR REPLACE VIEW socios.legacy_membership_type_selectable AS
  SELECT c.code, r.name, r.letter, r.record_ordinal, c.snapshot_batch_id, c.source_row_id
  FROM socios.legacy_membership_type_candidates c
  JOIN socios.legacy_membership_type_source_rows r ON r.id = c.source_row_id
  JOIN socios.legacy_membership_type_snapshots s ON s.batch_id = c.snapshot_batch_id
  WHERE s.state = 'applied'
    AND s.sequence = (
      SELECT max(sequence) FROM socios.legacy_membership_type_snapshots WHERE state = 'applied'
    );

COMMIT;
