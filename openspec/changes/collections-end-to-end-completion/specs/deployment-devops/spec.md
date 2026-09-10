# Delta for Deployment/DevOps

## ADDED Requirements

### Requirement: Guarded Forward Collections Schema Baseline

The deployment process MUST verify that the database has a supported migration baseline before application startup and MUST apply one guarded migration at the current migration head to supply the Collections enrollment baja field when it is absent. It MUST NOT replay migration `0036`, rewrite historical migration records, or fail merely because the field is already compatible. An unsupported baseline MUST block startup with an actionable diagnostic and MUST NOT partially mutate schema or migration lineage.

#### Scenario: Supported baseline receives forward compatibility

- GIVEN a supported deployment baseline whose enrollment table lacks the baja field
- WHEN the deploy baseline verification and pending migrations run
- THEN the verifier MUST accept the baseline
- AND the current-head guarded migration MUST add the missing compatibility
- AND migration `0036` MUST NOT be replayed or inserted into history

#### Scenario: Already-compatible deployment remains unchanged

- GIVEN a supported deployment baseline whose enrollment table already has compatible baja semantics
- WHEN the guarded current-head migration runs
- THEN the schema change MUST be a no-op
- AND the deployment MUST continue without duplicating or rewriting migration history

#### Scenario: Unsupported baseline blocks deployment

- GIVEN the migration ledger or enrollment schema does not match any supported pre-migration or already-compatible baseline
- WHEN deploy baseline verification runs
- THEN application startup MUST stop with an actionable baseline diagnostic
- AND no compatibility migration or partial lineage mutation MUST be committed
