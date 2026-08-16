CREATE SCHEMA IF NOT EXISTS tesoreria;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN CREATE TYPE tesoreria.dues_price_kind AS ENUM ('BASE', 'SPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_assessment_rule AS ENUM ('FULL_MONTH', 'DAILY_PRORATED', 'NEXT_PERIOD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_obligation_kind AS ENUM ('MONTHLY_DUES', 'COMPENSATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_component_kind AS ENUM ('BASE', 'SPORT', 'BENEFIT', 'ADJUSTMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tesoreria.dues_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind tesoreria.dues_price_kind NOT NULL,
  disciplina_id uuid REFERENCES deportes.disciplinas(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL, currency char(3) NOT NULL DEFAULT 'ARS',
  effective_from date NOT NULL, effective_to date,
  rule tesoreria.dues_assessment_rule NOT NULL,
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  authorization_evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revoked_by uuid REFERENCES public.operators(id) ON DELETE RESTRICT, revoke_reason text,
  CONSTRAINT dues_price_versions_amount_check CHECK (amount >= 0),
  CONSTRAINT dues_price_versions_interval_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT dues_price_versions_kind_discipline_check CHECK ((kind = 'BASE' AND disciplina_id IS NULL) OR (kind = 'SPORT' AND disciplina_id IS NOT NULL)),
  CONSTRAINT dues_price_versions_revoke_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND btrim(revoke_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS dues_price_versions_lookup_idx ON tesoreria.dues_price_versions (kind, disciplina_id, effective_from);
CREATE INDEX IF NOT EXISTS dues_price_versions_active_idx ON tesoreria.dues_price_versions (kind, disciplina_id, effective_from) WHERE revoked_at IS NULL;
ALTER TABLE tesoreria.dues_price_versions DROP CONSTRAINT IF EXISTS dues_price_versions_base_overlap;
ALTER TABLE tesoreria.dues_price_versions ADD CONSTRAINT dues_price_versions_base_overlap EXCLUDE USING gist
  (daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (kind = 'BASE' AND revoked_at IS NULL);
ALTER TABLE tesoreria.dues_price_versions DROP CONSTRAINT IF EXISTS dues_price_versions_sport_overlap;
ALTER TABLE tesoreria.dues_price_versions ADD CONSTRAINT dues_price_versions_sport_overlap EXCLUDE USING gist
  (disciplina_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (kind = 'SPORT' AND revoked_at IS NULL);

CREATE TABLE IF NOT EXISTS tesoreria.dues_generation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  caller_key text NOT NULL, request_fingerprint char(64) NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  authorization_evidence jsonb NOT NULL DEFAULT '{}', result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_generation_receipts_period_check CHECK (period_start = date_trunc('month', period_start)::date AND period_end = (period_start + INTERVAL '1 month')::date),
  CONSTRAINT dues_generation_receipts_fingerprint_check CHECK (length(btrim(request_fingerprint)) = 64),
  CONSTRAINT dues_generation_receipts_operator_caller_key_unique UNIQUE (operator_id, caller_key)
);

CREATE TABLE IF NOT EXISTS tesoreria.dues_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), socio_id uuid NOT NULL REFERENCES socios.socios(id) ON DELETE RESTRICT,
  kind tesoreria.dues_obligation_kind NOT NULL, period_start date NOT NULL, period_end date NOT NULL, amount numeric(14,2) NOT NULL,
  generation_receipt_id uuid NOT NULL REFERENCES tesoreria.dues_generation_receipts(id) ON DELETE RESTRICT,
  compensates_obligation_id uuid REFERENCES tesoreria.dues_obligations(id) ON DELETE RESTRICT, compensation_reason text,
  snapshot jsonb NOT NULL DEFAULT '{}', actor_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  authorization_evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_obligations_period_check CHECK (period_end > period_start),
  CONSTRAINT dues_obligations_kind_check CHECK ((kind = 'MONTHLY_DUES' AND amount > 0 AND compensates_obligation_id IS NULL AND compensation_reason IS NULL) OR (kind = 'COMPENSATION' AND amount <> 0 AND compensates_obligation_id IS NOT NULL AND compensation_reason IS NOT NULL AND btrim(compensation_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS dues_obligations_socio_period_idx ON tesoreria.dues_obligations (socio_id, period_start);
CREATE UNIQUE INDEX IF NOT EXISTS dues_obligations_monthly_natural_key ON tesoreria.dues_obligations (socio_id, period_start) WHERE kind = 'MONTHLY_DUES';

CREATE TABLE IF NOT EXISTS tesoreria.dues_obligation_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), obligation_id uuid NOT NULL REFERENCES tesoreria.dues_obligations(id) ON DELETE RESTRICT,
  kind tesoreria.dues_component_kind NOT NULL, component_key text NOT NULL, amount numeric(14,2) NOT NULL,
  price_version_id uuid REFERENCES tesoreria.dues_price_versions(id) ON DELETE RESTRICT,
  disciplina_id uuid REFERENCES deportes.disciplinas(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES deportes.inscripciones(id) ON DELETE RESTRICT,
  unit_amount numeric(14,2), rule tesoreria.dues_assessment_rule, eligible_from date, eligible_to date,
  eligible_days integer, period_days integer, calculation_inputs jsonb NOT NULL DEFAULT '{}', eligibility_snapshot jsonb NOT NULL DEFAULT '{}', price_snapshot jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT dues_obligation_components_obligation_key_unique UNIQUE (obligation_id, component_key),
  CONSTRAINT dues_obligation_components_interval_check CHECK ((eligible_from IS NULL AND eligible_to IS NULL) OR (eligible_from IS NOT NULL AND eligible_to IS NOT NULL AND eligible_to > eligible_from)),
  CONSTRAINT dues_obligation_components_days_check CHECK (eligible_days IS NULL OR (eligible_days >= 0 AND period_days IS NOT NULL AND period_days > 0 AND eligible_days <= period_days)),
  CONSTRAINT dues_obligation_components_unit_amount_check CHECK (unit_amount IS NULL OR unit_amount >= 0)
);

CREATE OR REPLACE FUNCTION tesoreria.reject_dues_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'dues obligations and components are immutable' USING ERRCODE = '55000'; END $$;
DROP TRIGGER IF EXISTS dues_obligations_immutable ON tesoreria.dues_obligations;
CREATE TRIGGER dues_obligations_immutable BEFORE UPDATE OR DELETE ON tesoreria.dues_obligations FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_dues_history_mutation();
DROP TRIGGER IF EXISTS dues_obligation_components_immutable ON tesoreria.dues_obligation_components;
CREATE TRIGGER dues_obligation_components_immutable BEFORE UPDATE OR DELETE ON tesoreria.dues_obligation_components FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_dues_history_mutation();
