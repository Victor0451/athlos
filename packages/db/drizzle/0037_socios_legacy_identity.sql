-- Additive identity foundation. Forward-fix rollback may remove only these objects after proving no consumers exist.
BEGIN;

DO $$ BEGIN
  CREATE TYPE socios.identity_lifecycle_state AS ENUM ('imported', 'validated', 'review_required');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS socios.membership_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  lifecycle_state socios.identity_lifecycle_state NOT NULL DEFAULT 'imported',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socios.member_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  lifecycle_state socios.identity_lifecycle_state NOT NULL DEFAULT 'imported',
  credential_ref text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS socios.account_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES socios.membership_accounts(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz,
  UNIQUE (id, account_id), UNIQUE (account_id, member_id, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE IF NOT EXISTS socios.account_holder_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES socios.membership_accounts(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz,
  predecessor_id uuid REFERENCES socios.account_holder_history(id) ON DELETE RESTRICT,
  actor_operator_id uuid, source text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text UNIQUE,
  FOREIGN KEY (membership_id, account_id) REFERENCES socios.account_memberships(id, account_id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE IF NOT EXISTS socios.legacy_identity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raw_event_id uuid NOT NULL UNIQUE REFERENCES public.raw_events(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES socios.membership_accounts(id) ON DELETE RESTRICT, member_id uuid REFERENCES socios.member_identities(id) ON DELETE RESTRICT,
  source_key text NOT NULL, import_batch uuid NOT NULL, soccarnet text, socfamilia text, anomaly_codes text[] NOT NULL DEFAULT '{}',
  review_state text NOT NULL DEFAULT 'imported' CHECK (review_state IN ('imported', 'validated', 'review_required')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_identity_evidence_pair_idx ON socios.legacy_identity_evidence (soccarnet, socfamilia);
CREATE UNIQUE INDEX IF NOT EXISTS account_holder_history_current_account_unique
  ON socios.account_holder_history (account_id) WHERE effective_to IS NULL;

CREATE OR REPLACE FUNCTION socios.reject_holder_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM socios.account_holder_history h WHERE h.account_id = NEW.account_id AND h.id <> NEW.id
    AND tstzrange(h.effective_from, h.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')) THEN
    RAISE EXCEPTION 'overlapping holder history' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION socios.require_account_holder() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state socios.identity_lifecycle_state;
BEGIN
  SELECT lifecycle_state INTO state FROM socios.membership_accounts WHERE id = NEW.id;
  IF state = 'validated' AND (SELECT count(*) FROM socios.account_holder_history WHERE account_id = NEW.id AND effective_to IS NULL) <> 1 THEN
    RAISE EXCEPTION 'validated account requires exactly one current holder' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION socios.require_history_holder() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_uuid uuid; state socios.identity_lifecycle_state;
BEGIN
  account_uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  SELECT lifecycle_state INTO state FROM socios.membership_accounts WHERE id = account_uuid;
  IF state = 'validated' AND (SELECT count(*) FROM socios.account_holder_history WHERE account_id = account_uuid AND effective_to IS NULL) <> 1 THEN
    RAISE EXCEPTION 'validated account requires exactly one current holder' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS account_holder_overlap ON socios.account_holder_history;
CREATE TRIGGER account_holder_overlap BEFORE INSERT OR UPDATE ON socios.account_holder_history FOR EACH ROW EXECUTE FUNCTION socios.reject_holder_overlap();
DROP TRIGGER IF EXISTS validated_account_holder ON socios.membership_accounts;
CREATE CONSTRAINT TRIGGER validated_account_holder AFTER INSERT OR UPDATE ON socios.membership_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION socios.require_account_holder();
DROP TRIGGER IF EXISTS validated_history_holder ON socios.account_holder_history;
CREATE CONSTRAINT TRIGGER validated_history_holder AFTER INSERT OR UPDATE OR DELETE ON socios.account_holder_history DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION socios.require_history_holder();
COMMIT;
