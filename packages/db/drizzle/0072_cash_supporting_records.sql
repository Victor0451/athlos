-- U6-A: optional zero-or-one supporting record per manual source; transcription only, never issuance, calculation, or payment.
CREATE TABLE IF NOT EXISTS tesoreria.dues_cash_supporting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_source_id uuid NOT NULL REFERENCES tesoreria.dues_cash_manual_sources(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  doc_type text,
  letter text,
  point_of_sale text,
  doc_number text,
  legend text,
  issuer text,
  recipient text,
  issue_date date,
  currency text NOT NULL DEFAULT 'ARS',
  total numeric(14,2) NOT NULL,
  prior_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_cash_supporting_record_source_unique UNIQUE (manual_source_id),
  CONSTRAINT dues_cash_supporting_record_kind_check CHECK (kind IN ('EXTERNAL','INTERNAL')),
  CONSTRAINT dues_cash_supporting_record_total_check CHECK (total > 0),
  CONSTRAINT dues_cash_supporting_record_internal_unnumbered CHECK (kind <> 'INTERNAL' OR (doc_type IS NULL AND doc_number IS NULL AND point_of_sale IS NULL))
);

CREATE OR REPLACE FUNCTION tesoreria.guard_dues_cash_supporting_record_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE component jsonb; additive_total bigint := 0; has_additive boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash supporting records are append-only' USING ERRCODE = '55000';
  END IF;
  IF NEW.kind = 'EXTERNAL' THEN
    IF NEW.doc_type IS NULL OR NEW.doc_type NOT IN ('FACTURA_A','FACTURA_B','FACTURA_C','FACTURA_E','FACTURA_M','FACTURA_T','NOTA_CREDITO','NOTA_DEBITO','RECIBO_A','RECIBO_B','RECIBO_C','RECIBO_X','REMITO_R','REMITO_X','TICKET') THEN
      RAISE EXCEPTION 'external supporting record requires a whitelisted document type' USING ERRCODE = '23514';
    END IF;
    IF NEW.doc_type IN ('NOTA_CREDITO','NOTA_DEBITO') AND (
      jsonb_typeof(NEW.prior_references) <> 'array'
      OR jsonb_array_length(NEW.prior_references) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.prior_references) AS ref
        WHERE NULLIF(btrim(ref), '') IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'credit and debit notes require prior document references' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF jsonb_typeof(NEW.tax_components) <> 'array' THEN
    RAISE EXCEPTION 'tax components must be a json array' USING ERRCODE = '23514';
  END IF;
  FOR component IN SELECT * FROM jsonb_array_elements(NEW.tax_components) LOOP
    IF jsonb_typeof(component) <> 'object'
      OR NULLIF(btrim(coalesce(component->>'label','')), '') IS NULL
      OR component->>'semantic' NOT IN ('ADDITIVE','CONTAINED')
      OR jsonb_typeof(component->'amount_cents') <> 'number'
      OR (component->>'amount_cents') !~ '^[0-9]+$'
      OR (component->>'amount_cents')::bigint <= 0 THEN
      RAISE EXCEPTION 'tax component requires a label, positive integer cents, and explicit additive or contained semantics' USING ERRCODE = '23514';
    END IF;
    IF component->>'semantic' = 'ADDITIVE' THEN
      has_additive := true;
      additive_total := additive_total + (component->>'amount_cents')::bigint;
    END IF;
  END LOOP;
  IF has_additive AND additive_total <> (NEW.total * 100)::bigint THEN
    RAISE EXCEPTION 'additive tax components must reconcile exactly to the document total' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dues_cash_supporting_record_policy ON tesoreria.dues_cash_supporting_records;
CREATE TRIGGER dues_cash_supporting_record_policy
  BEFORE INSERT OR UPDATE OR DELETE ON tesoreria.dues_cash_supporting_records
  FOR EACH ROW EXECUTE FUNCTION tesoreria.guard_dues_cash_supporting_record_policy();
