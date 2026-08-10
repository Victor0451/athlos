## Exploration: socios-legacy-identity

### Current State
Athlos currently models one `socios.socios` row as both a person and the membership identity. It assigns a UUID primary key but also requires globally unique `numero_socio` and `dni`; the API makes `numeroSocio` immutable. `tesoreria.ctacte` and notes/attachments reference that row, so replacing it directly would break current financial and dossier relationships.

The import pipeline already preserves each source row in append-only `public.raw_events` with its source table, source key, content hash, raw payload, and import batch. `public.entity_uuids` can assign a stable UUID per legacy `(source_table, source_key)`. However, the DBF importer currently treats `SOCCARNET` alone as the `socios` source key, which is insufficient for the operational legacy identity.

Legacy evidence identifies `SOCCARNET + SOCFAMILIA` as the operational pair used by `socios`, `CTACTE`, and `CTACTE1`; `SOCNUMERO` is sparse and non-unique. `SOCTIPSOCI` references `tiposoci`. Family authority cannot safely be inferred from a slot number: the new model needs an explicit primary-holder membership role. Legacy balances and last-payment fields are derived snapshots, not migration truth.

### Affected Areas
- `packages/db/src/schema/socios.ts` — current person-and-membership table, unique constraints, notes, and attachments.
- `packages/db/src/schema/tesoreria.ts` — `ctacte.socio_id` currently targets the single Socio row; legacy account references are retained in `cctcuenta`.
- `packages/db/src/schema/public.ts` — raw source provenance and stable imported-entity UUID support.
- `packages/import/src/dbf-reader.ts` — `socios` source key is presently `SOCCARNET`, requiring composite-key-safe handling.
- `packages/promotion/src/{promote,dedup,fk-lookup,transform-helpers}.ts` — promotion and FK resolution depend on the current Socio natural-key assumptions.
- `apps/api/src/modules/socios/{repository,service}.ts` and `apps/api/src/routes/socios.ts` — CRUD contracts, audit snapshots, and list/search behavior expose the current model.
- `apps/api/src/test-standins/db.ts` — in-memory Socio row and uniqueness behavior must follow any schema/API change.
- `packages/db/src/schema/*test.ts`, `apps/api/src/modules/socios/*.test.ts` — migration and service/repository coverage must prove compatibility.

### Approaches
1. **Replace `socios.socios` in place** — add family columns and redefine `numero_socio` as the legacy pair.
   - Pros: Few tables and one apparent domain model.
   - Cons: Breaks current unique constraints, existing FKs, API/UI contracts, and historical audit snapshots; mixes migration evidence with corrected business data.
   - Effort: High.

2. **Add an identity layer beside the existing Socio model** — introduce membership accounts, immutable people, explicit membership roles, legacy identity/provenance, and migration status while retaining current Socio references during transition.
   - Pros: Preserves current operations and all raw legacy facts; supports composite legacy identity, anomalies, and incremental backfill; makes a future opaque credential resolve to a person UUID without implementing cards now.
   - Cons: Requires an explicit compatibility boundary and later migration of consumers from `socios.id`.
   - Effort: Medium for the first slice; High for the complete domain transition.

3. **Create a one-off import mapping only** — map the pair into the existing Socio table without new aggregates.
   - Pros: Lowest immediate code volume.
   - Cons: Cannot represent multiple people per family, an explicit primary holder, unresolved mappings, or reliable future credentials; would encode known legacy flaws as the new model.
   - Effort: Low initially, High rework risk.

### Recommendation
Choose approach 2. The first reviewable slice should be schema-and-migration only (target: under 400 changed lines): add additive identity tables and enums for membership account, person, membership role, legacy identity/provenance, and `imported | validated | review_required` migration state; enforce one explicit primary holder per account; retain raw legacy values and reasons for anomalies. Do not alter `socios.socios`, CTACTE ownership, fee calculations, payments, categories, or endpoints in this slice.

Use the legacy pair as a preserved, unique-when-resolved identifier—not as the person UUID and not as a silent deduplication rule. The later promotion slice should consume the raw payload and populate mappings deterministically, routing duplicate/missing/ambiguous pairs to `review_required`. Categories should be represented as a legacy reference to `tiposoci` now, with normalized category behavior deferred.

Open product questions for proposal/specification: whether an account may temporarily have no primary holder; who can change the holder role; the operator workflow for merging or splitting historical families; and whether a legacy person can be linked to an existing modern Socio only after human validation.

### Risks
- Existing `socios.numero_socio` and `dni` unique constraints contradict known legacy data quality; destructive migration or automatic deduplication would lose identity evidence.
- `CTACTE` and `CTACTE1` operationally key by the legacy pair, while Athlos currently links financial rows to one Socio UUID; financial ownership must not be reassigned until mapping reconciliation is explicit.
- The importer source key for `socios` is `SOCCARNET` only, so its current lineage key can collide across families; any correction requires compatibility for already-imported events.
- Legacy family slot order and fields such as balances, latest payment, and fee overrides are not authoritative enough to derive authority or account state automatically.
- The current API, web client, PDF forms, audit events, promotion code, and test stand-ins assume a flat Socio record; consumer migration must be staged.

### Ready for Proposal
Yes — propose an additive identity foundation limited to schema, constraints, provenance, migration states, and tests, with a hard under-400-line first slice. The proposal must explicitly defer person-to-current-Socio reconciliation, category normalization, fees/charges/payments, and digital-card endpoints.
