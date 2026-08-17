CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN CREATE TYPE tesoreria.dues_benefit_kind AS ENUM ('FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'SCHOLARSHIP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_benefit_combinability AS ENUM ('COMBINABLE', 'EXCLUSIVE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_benefit_percentage_basis AS ENUM ('GROSS', 'REMAINING'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tesoreria.dues_benefit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind tesoreria.dues_benefit_kind NOT NULL,
  socio_id uuid REFERENCES socios.socios(id) ON DELETE RESTRICT,
  family_group_id uuid,
  amount numeric(14,2), percentage numeric(5,2), currency char(3),
  effective_from date NOT NULL, effective_to date,
  priority integer NOT NULL, combinability tesoreria.dues_benefit_combinability NOT NULL,
  exclusive_group text, percentage_basis tesoreria.dues_benefit_percentage_basis,
  reason text NOT NULL, authorization_evidence jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  revoked_by uuid REFERENCES public.operators(id) ON DELETE RESTRICT, revoke_reason text,
  CONSTRAINT dues_benefit_rules_target_check CHECK (((socio_id IS NOT NULL)::int + (family_group_id IS NOT NULL)::int) >= 1),
  CONSTRAINT dues_benefit_rules_value_check CHECK ((kind = 'FIXED_DISCOUNT' AND amount > 0 AND percentage IS NULL AND currency IS NOT NULL AND percentage_basis IS NULL) OR (kind IN ('PERCENT_DISCOUNT', 'SCHOLARSHIP') AND amount IS NULL AND percentage > 0 AND percentage <= 100 AND currency IS NULL AND percentage_basis IS NOT NULL)),
  CONSTRAINT dues_benefit_rules_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT dues_benefit_rules_interval_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT dues_benefit_rules_priority_check CHECK (priority >= 0),
  CONSTRAINT dues_benefit_rules_combinability_check CHECK ((combinability = 'COMBINABLE' AND exclusive_group IS NULL) OR (combinability = 'EXCLUSIVE' AND exclusive_group IS NOT NULL AND btrim(exclusive_group) <> '')),
  CONSTRAINT dues_benefit_rules_reason_check CHECK (btrim(reason) <> ''),
  CONSTRAINT dues_benefit_rules_revoke_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND btrim(revoke_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS dues_benefit_rules_effective_idx ON tesoreria.dues_benefit_rules (priority, effective_from);
ALTER TABLE tesoreria.dues_benefit_rules DROP CONSTRAINT IF EXISTS dues_benefit_rules_member_exclusive_overlap;
ALTER TABLE tesoreria.dues_benefit_rules ADD CONSTRAINT dues_benefit_rules_member_exclusive_overlap EXCLUDE USING gist (socio_id WITH =, exclusive_group WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (socio_id IS NOT NULL AND combinability = 'EXCLUSIVE' AND revoked_at IS NULL);
ALTER TABLE tesoreria.dues_benefit_rules DROP CONSTRAINT IF EXISTS dues_benefit_rules_family_exclusive_overlap;
ALTER TABLE tesoreria.dues_benefit_rules ADD CONSTRAINT dues_benefit_rules_family_exclusive_overlap EXCLUDE USING gist (family_group_id WITH =, exclusive_group WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (family_group_id IS NOT NULL AND combinability = 'EXCLUSIVE' AND revoked_at IS NULL);
