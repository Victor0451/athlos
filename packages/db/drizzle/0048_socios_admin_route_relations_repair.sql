-- Forward repair for upgraded BETA-like databases whose 0044 frontier skipped
-- the relation DDL needed by the admin Socios read routes. No data or ledger
-- rows are created; every object is additive and idempotent.
-- This targets missing-whole-relation state only. IF NOT EXISTS deliberately
-- leaves existing tables untouched; partially malformed tables require a
-- separately evidenced repair and are not claimed to be fixed here.
CREATE SCHEMA IF NOT EXISTS socios;

DO $$ BEGIN
  CREATE TYPE socios.identity_lifecycle_state AS ENUM ('imported', 'validated', 'review_required');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.membership_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  lifecycle_state socios.identity_lifecycle_state NOT NULL DEFAULT 'imported',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS socios.member_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  lifecycle_state socios.identity_lifecycle_state NOT NULL DEFAULT 'imported',
  credential_ref text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS socios.legacy_identity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL UNIQUE REFERENCES public.raw_events(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES socios.membership_accounts(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  import_batch uuid NOT NULL,
  soccarnet text,
  socfamilia text,
  anomaly_codes text[] NOT NULL DEFAULT '{}',
  review_state text NOT NULL DEFAULT 'imported'
    CHECK (review_state IN ('imported', 'validated', 'review_required')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_identity_evidence_pair_idx
  ON socios.legacy_identity_evidence (soccarnet, socfamilia);

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

DO $$ BEGIN
  CREATE TYPE socios.legacy_member_fee_state AS ENUM ('blank', 'zero', 'non_zero');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE socios.legacy_member_review_state AS ENUM (
    'validated', 'unknown_type', 'ambiguous_identity', 'missing_identity'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE socios.legacy_member_review_state ADD VALUE IF NOT EXISTS 'missing_identity';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL UNIQUE REFERENCES public.raw_events(id) ON DELETE RESTRICT,
  import_batch uuid NOT NULL,
  identity_evidence_id uuid NOT NULL REFERENCES socios.legacy_identity_evidence(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  membership_type_candidate_source_row_id uuid REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  legacy_type_code text NOT NULL,
  legacy_category text,
  fee_state socios.legacy_member_fee_state NOT NULL,
  fee_value numeric(11, 2),
  review_state socios.legacy_member_review_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (fee_state = 'blank' AND fee_value IS NULL)
    OR (fee_state = 'zero' AND fee_value = 0)
    OR (fee_state = 'non_zero' AND fee_value IS NOT NULL AND fee_value <> 0)
  ),
  CHECK (
    (review_state = 'validated' AND member_id IS NOT NULL AND membership_type_candidate_source_row_id IS NOT NULL)
    OR (review_state IN ('unknown_type', 'ambiguous_identity', 'missing_identity')
      AND member_id IS NULL AND membership_type_candidate_source_row_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS socios.evidence_closure_phase_receipts (
  execution_identity text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('candidates', 'members')),
  selected_batch_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (length(fingerprint) > 0),
  eligible_count integer NOT NULL CHECK (eligible_count >= 0),
  projected_count integer NOT NULL CHECK (projected_count >= 0),
  exception_count integer NOT NULL CHECK (exception_count >= 0),
  unknown_type_count integer NOT NULL DEFAULT 0 CHECK (unknown_type_count >= 0),
  ambiguous_identity_count integer NOT NULL DEFAULT 0 CHECK (ambiguous_identity_count >= 0),
  missing_identity_count integer NOT NULL DEFAULT 0 CHECK (missing_identity_count >= 0),
  status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
  started_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_identity, phase),
  CHECK (eligible_count = projected_count + exception_count),
  CHECK (exception_count = unknown_type_count + ambiguous_identity_count + missing_identity_count),
  CHECK (phase <> 'candidates' OR (unknown_type_count = 0 AND ambiguous_identity_count = 0 AND missing_identity_count = 0))
);

DO $$
DECLARE
  target_table oid := 'socios.legacy_member_evidence'::regclass;
  target_namespace oid;
  constraint_name constant text := 'legacy_member_evidence_id_review_state_unique';
  existing_relation oid;
BEGIN
  SELECT c.relnamespace INTO target_namespace
  FROM pg_class c
  WHERE c.oid = target_table;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = target_table
      AND c.conname = constraint_name
  ) THEN
    RETURN;
  END IF;

  SELECT c.oid INTO existing_relation
  FROM pg_class c
  WHERE c.relnamespace = target_namespace
    AND c.relname = constraint_name;

  IF existing_relation IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indexrelid = existing_relation
        AND i.indrelid = target_table
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND i.indnkeyatts = 2
        AND pg_get_indexdef(i.indexrelid) LIKE '%(id, review_state)%'
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'relation "%" already exists but is not the expected unique constraint', constraint_name
      USING ERRCODE = '42710';
  END IF;

  ALTER TABLE socios.legacy_member_evidence
    ADD CONSTRAINT legacy_member_evidence_id_review_state_unique UNIQUE (id, review_state);
END $$;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_member_evidence_id uuid NOT NULL REFERENCES socios.legacy_member_evidence(id) ON DELETE RESTRICT,
  resolution_kind socios.legacy_member_review_state NOT NULL,
  selected_member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  selected_membership_type_candidate_source_row_id uuid
    REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  steward_operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  evidence_fingerprint varchar(64) NOT NULL CHECK (length(evidence_fingerprint) = 64),
  supersedes_resolution_id uuid
    REFERENCES socios.legacy_member_evidence_resolutions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (legacy_member_evidence_id, resolution_kind)
    REFERENCES socios.legacy_member_evidence (id, review_state),
  CHECK (
    (resolution_kind = 'unknown_type' AND selected_member_id IS NOT NULL
      AND selected_membership_type_candidate_source_row_id IS NOT NULL)
    OR (resolution_kind = 'ambiguous_identity' AND selected_member_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_steward_idempotency_key_unique
  ON socios.legacy_member_evidence_resolutions (steward_operator_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_root_evidence_unique
  ON socios.legacy_member_evidence_resolutions (legacy_member_evidence_id)
  WHERE supersedes_resolution_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS legacy_member_evidence_resolutions_successor_unique
  ON socios.legacy_member_evidence_resolutions (supersedes_resolution_id)
  WHERE supersedes_resolution_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolution_application_receipts (
  execution_identity text PRIMARY KEY,
  selected_batch_id uuid NOT NULL,
  application_fingerprint varchar(64) NOT NULL CHECK (length(application_fingerprint) = 64),
  eligible_count integer NOT NULL CHECK (eligible_count >= 0),
  applied_count integer NOT NULL CHECK (applied_count >= 0),
  unresolved_count integer NOT NULL CHECK (unresolved_count >= 0),
  stale_count integer NOT NULL CHECK (stale_count >= 0),
  technical_count integer NOT NULL CHECK (technical_count >= 0),
  status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
  committed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (eligible_count = applied_count + unresolved_count + stale_count + technical_count)
);

CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolution_applications (
  execution_identity text NOT NULL
    REFERENCES socios.legacy_member_evidence_resolution_application_receipts(execution_identity) ON DELETE RESTRICT,
  legacy_member_evidence_id uuid NOT NULL REFERENCES socios.legacy_member_evidence(id) ON DELETE RESTRICT,
  resolution_id uuid NOT NULL REFERENCES socios.legacy_member_evidence_resolutions(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  membership_type_candidate_source_row_id uuid NOT NULL
    REFERENCES socios.legacy_membership_type_candidates(source_row_id) ON DELETE RESTRICT,
  application_fingerprint varchar(64) NOT NULL CHECK (length(application_fingerprint) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_identity, legacy_member_evidence_id),
  UNIQUE (execution_identity, resolution_id)
);
