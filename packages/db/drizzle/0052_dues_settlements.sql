DO $$ BEGIN CREATE TYPE tesoreria.dues_settlement_kind AS ENUM ('MONETARY', 'NON_CASH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tesoreria.dues_allocation_kind AS ENUM ('ALLOCATION', 'COMPENSATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tesoreria.dues_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), socio_id uuid NOT NULL REFERENCES socios.socios(id) ON DELETE RESTRICT,
  kind tesoreria.dues_settlement_kind NOT NULL, amount numeric(14,2) NOT NULL, currency char(3) NOT NULL DEFAULT 'ARS',
  evidence jsonb NOT NULL DEFAULT '{}', reason text, reversal_of_settlement_id uuid REFERENCES tesoreria.dues_settlements(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE RESTRICT, authorization_evidence jsonb NOT NULL DEFAULT '{}',
  caller_key text NOT NULL, request_fingerprint char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_settlements_amount_check CHECK (amount > 0), CONSTRAINT dues_settlements_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT dues_settlements_fingerprint_check CHECK (length(btrim(request_fingerprint)) = 64),
  CONSTRAINT dues_settlements_reversal_check CHECK (reversal_of_settlement_id IS NULL OR (reason IS NOT NULL AND btrim(reason) <> '')),
  CONSTRAINT dues_settlements_operator_caller_key_unique UNIQUE (operator_id, caller_key)
);
CREATE INDEX IF NOT EXISTS dues_settlements_socio_idx ON tesoreria.dues_settlements (socio_id, created_at);

CREATE TABLE IF NOT EXISTS tesoreria.dues_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), settlement_id uuid NOT NULL REFERENCES tesoreria.dues_settlements(id) ON DELETE RESTRICT,
  obligation_id uuid NOT NULL REFERENCES tesoreria.dues_obligations(id) ON DELETE RESTRICT, kind tesoreria.dues_allocation_kind NOT NULL,
  amount numeric(14,2) NOT NULL, compensates_allocation_id uuid REFERENCES tesoreria.dues_allocations(id) ON DELETE RESTRICT, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT dues_allocations_amount_check CHECK (amount > 0),
  CONSTRAINT dues_allocations_kind_check CHECK ((kind = 'ALLOCATION' AND compensates_allocation_id IS NULL AND reason IS NULL) OR (kind = 'COMPENSATION' AND compensates_allocation_id IS NOT NULL AND reason IS NOT NULL AND btrim(reason) <> '')),
  CONSTRAINT dues_allocations_settlement_obligation_kind_unique UNIQUE (settlement_id, obligation_id, kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS dues_allocations_compensation_unique ON tesoreria.dues_allocations (compensates_allocation_id) WHERE compensates_allocation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dues_allocations_obligation_idx ON tesoreria.dues_allocations (obligation_id);

CREATE OR REPLACE FUNCTION tesoreria.validate_dues_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  settlement_socio uuid;
  settlement_amount numeric;
  obligation_socio uuid;
  obligation_amount numeric;
  original_obligation uuid;
  original_kind tesoreria.dues_allocation_kind;
  original_amount numeric;
  original_socio uuid;
  allocated_obligation numeric;
  allocated_settlement numeric;
BEGIN
  SELECT socio_id, amount INTO settlement_socio, settlement_amount
    FROM tesoreria.dues_settlements WHERE id = NEW.settlement_id FOR UPDATE;
  SELECT socio_id, amount INTO obligation_socio, obligation_amount
    FROM tesoreria.dues_obligations WHERE id = NEW.obligation_id FOR UPDATE;

  IF settlement_socio IS NULL OR obligation_socio IS NULL OR settlement_socio <> obligation_socio THEN
    RAISE EXCEPTION 'allocation settlement and obligation members must match'
      USING ERRCODE = '23514', CONSTRAINT = 'dues_allocations_member_check';
  END IF;

  IF NEW.kind = 'COMPENSATION' THEN
    SELECT a.obligation_id, a.kind, a.amount, s.socio_id
      INTO original_obligation, original_kind, original_amount, original_socio
      FROM tesoreria.dues_allocations a
      JOIN tesoreria.dues_settlements s ON s.id = a.settlement_id
      WHERE a.id = NEW.compensates_allocation_id
      FOR SHARE;
    IF original_kind IS DISTINCT FROM 'ALLOCATION'::tesoreria.dues_allocation_kind
      OR original_obligation IS DISTINCT FROM NEW.obligation_id
      OR original_socio IS DISTINCT FROM settlement_socio
      OR original_amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION 'compensation must reference the original allocation for the same obligation and member'
        USING ERRCODE = '23514', CONSTRAINT = 'dues_allocations_compensation_reference_check';
    END IF;
  ELSE
    SELECT COALESCE(SUM(CASE WHEN kind = 'ALLOCATION' THEN amount ELSE -amount END), 0)
      INTO allocated_obligation
      FROM tesoreria.dues_allocations
      WHERE obligation_id = NEW.obligation_id;
    IF allocated_obligation + NEW.amount > obligation_amount THEN
      RAISE EXCEPTION 'allocation exceeds the obligation balance'
        USING ERRCODE = '23514', CONSTRAINT = 'dues_allocations_obligation_amount_check';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO allocated_settlement
      FROM tesoreria.dues_allocations
      WHERE settlement_id = NEW.settlement_id AND kind = 'ALLOCATION';
    IF allocated_settlement + NEW.amount > settlement_amount THEN
      RAISE EXCEPTION 'allocation exceeds the settlement amount'
        USING ERRCODE = '23514', CONSTRAINT = 'dues_allocations_settlement_amount_check';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dues_allocations_validate ON tesoreria.dues_allocations;
CREATE TRIGGER dues_allocations_validate BEFORE INSERT ON tesoreria.dues_allocations FOR EACH ROW EXECUTE FUNCTION tesoreria.validate_dues_allocation();

CREATE OR REPLACE FUNCTION tesoreria.reject_dues_settlement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'dues settlements and allocations are immutable' USING ERRCODE = '55000'; END $$;
DROP TRIGGER IF EXISTS dues_settlements_immutable ON tesoreria.dues_settlements;
CREATE TRIGGER dues_settlements_immutable BEFORE UPDATE OR DELETE ON tesoreria.dues_settlements FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_dues_settlement_mutation();
DROP TRIGGER IF EXISTS dues_allocations_immutable ON tesoreria.dues_allocations;
CREATE TRIGGER dues_allocations_immutable BEFORE UPDATE OR DELETE ON tesoreria.dues_allocations FOR EACH ROW EXECUTE FUNCTION tesoreria.reject_dues_settlement_mutation();
