CREATE TABLE IF NOT EXISTS tesoreria.dues_family_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  authorization_evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_family_groups_reason_check CHECK (btrim(reason) <> '')
);

ALTER TABLE tesoreria.dues_benefit_rules DROP CONSTRAINT IF EXISTS dues_benefit_rules_family_group_id_fkey;
ALTER TABLE tesoreria.dues_benefit_rules ADD CONSTRAINT dues_benefit_rules_family_group_id_fkey
  FOREIGN KEY (family_group_id) REFERENCES tesoreria.dues_family_groups(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS tesoreria.dues_family_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_group_id uuid NOT NULL REFERENCES tesoreria.dues_family_groups(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios.socios(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT,
  authorization_evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.operators(id) ON DELETE RESTRICT,
  revoke_reason text,
  CONSTRAINT dues_family_memberships_interval_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT dues_family_memberships_reason_check CHECK (btrim(reason) <> ''),
  CONSTRAINT dues_family_memberships_revoke_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND btrim(revoke_reason) <> ''))
);
CREATE INDEX IF NOT EXISTS dues_family_memberships_lookup_idx ON tesoreria.dues_family_memberships (socio_id, effective_from);
ALTER TABLE tesoreria.dues_family_memberships DROP CONSTRAINT IF EXISTS dues_family_memberships_active_socio_overlap;
ALTER TABLE tesoreria.dues_family_memberships ADD CONSTRAINT dues_family_memberships_active_socio_overlap EXCLUDE USING gist
  (socio_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&) WHERE (revoked_at IS NULL);
