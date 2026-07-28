-- Durable catalog materialization receipts. Schema rollback is forward-fix only.
BEGIN;

ALTER TABLE socios.legacy_membership_type_source_rows
  DROP CONSTRAINT IF EXISTS legacy_membership_type_source_rows_batch_id_record_ordinal_key;

CREATE TABLE IF NOT EXISTS socios.legacy_catalog_materialization_receipts (
  batch_id uuid PRIMARY KEY REFERENCES socios.legacy_membership_type_snapshots(batch_id) ON DELETE RESTRICT,
  phase text NOT NULL DEFAULT 'catalog_materialization' CHECK (phase = 'catalog_materialization'),
  input_hash varchar(64) NOT NULL,
  eligible_source_row_count integer NOT NULL CHECK (eligible_source_row_count >= 0),
  materialized_source_row_count integer NOT NULL CHECK (materialized_source_row_count >= 0),
  failed_source_row_count integer NOT NULL DEFAULT 0 CHECK (failed_source_row_count >= 0),
  CHECK (eligible_source_row_count = materialized_source_row_count + failed_source_row_count),
  outcome text NOT NULL DEFAULT 'materialized' CHECK (outcome = 'materialized'),
  committed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
