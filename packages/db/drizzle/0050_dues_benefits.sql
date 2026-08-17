CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN CREATE TYPE tesoreria.dues_benefit_kind AS ENUM ('FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'SCHOLARSHIP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tesoreria.dues_family_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  authorization_evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tesoreria.dues_family_members (
  family_group_id uuid NOT NULL REFERENCES tesoreria.dues_family_groups(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios.socios(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_group_id, socio_id)
);

CREATE TABLE IF NOT EXISTS tesoreria.dues_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind tesoreria.dues_benefit_kind NOT NULL,
  socio_id uuid REFERENCES socios.socios(id) ON DELETE RESTRICT,
  family_group_id uuid REFERENCES tesoreria.dues_family_groups(id) ON DELETE RESTRICT,
  amount numeric(14,2), percentage numeric(5,2), currency char(3) NOT NULL DEFAULT 'ARS',
  effective_from date NOT NULL, effective_to date, reason text NOT NULL,
  authorization_evidence jsonb NOT NULL DEFAULT '{}', created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  revoked_by uuid REFERENCES public.operators(id) ON DELETE RESTRICT, revoke_reason text,
  CONSTRAINT dues_benefits_target_check CHECK (((socio_id IS NOT NULL)::int + (family_group_id IS NOT NULL)::int) = 1),
  CONSTRAINT dues_benefits_value_check CHECK ((kind = 'FIXED_DISCOUNT' AND amount > 0 AND percentage IS NULL) OR (kind IN ('PERCENT_DISCOUNT', 'SCHOLARSHIP') AND amount IS NULL AND percentage > 0 AND percentage <= 100)),
  CONSTRAINT dues_benefits_interval_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT dues_benefits_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT dues_benefits_revoke_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND btrim(revoke_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS dues_benefits_lookup_idx ON tesoreria.dues_benefits (effective_from, kind);
ALTER TABLE tesoreria.dues_benefits DROP CONSTRAINT IF EXISTS dues_benefits_member_overlap;
ALTER TABLE tesoreria.dues_benefits ADD CONSTRAINT dues_benefits_member_overlap EXCLUDE USING gist (socio_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (socio_id IS NOT NULL AND revoked_at IS NULL);
ALTER TABLE tesoreria.dues_benefits DROP CONSTRAINT IF EXISTS dues_benefits_family_overlap;
ALTER TABLE tesoreria.dues_benefits ADD CONSTRAINT dues_benefits_family_overlap EXCLUDE USING gist (family_group_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (family_group_id IS NOT NULL AND revoked_at IS NULL);

ALTER TABLE tesoreria.dues_obligation_components ADD COLUMN IF NOT EXISTS benefit_id uuid REFERENCES tesoreria.dues_benefits(id) ON DELETE RESTRICT;
ALTER TABLE tesoreria.dues_obligation_components DROP CONSTRAINT IF EXISTS dues_obligation_components_benefit_check;
ALTER TABLE tesoreria.dues_obligation_components ADD CONSTRAINT dues_obligation_components_benefit_check CHECK ((kind = 'BENEFIT' AND benefit_id IS NOT NULL AND amount < 0) OR (kind <> 'BENEFIT' AND benefit_id IS NULL));
