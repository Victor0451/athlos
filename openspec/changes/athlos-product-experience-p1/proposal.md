# Proposal: Athlos Product Experience P1

## Intent

Present Athlos through its Gorriti edition to club buyers, convert contacts, and provide a role-aware club-status dashboard.

## Scope

### In Scope
- Public `/` landing using Socios' visual language, Athlos-first positioning, Gorriti proof, secondary login, and embedded form.
- Required fields: name, club/organization, role, email, and primary problem; optional phone and additional message.
- Dedicated public contact API with server-configured recipient, validation/limits, honeypot, per-IP throttling, origin/CSRF policy, escaped text, redacted logs, privacy notice, and explicit retention. No submission persistence by default.
- Real SMTP transport with timeout and observable failure; the synthetic `createRealEmail` result is not delivery.
- Server-authorized club-status projection: ADMIN/TESORERO receive aggregate amounts, trends, delinquency, and debt; OPERADOR receives non-monetary regularization workload; CONSULTA receives non-sensitive institutional status.
- Periods: current calendar month (default), rolling 60 days, rolling 90 days. Filtering changes finance/activity only; current membership, delinquency, data-quality, and system-state indicators remain stable.
- Separation from ADMIN technical operations, scheduler execution, evidence resolution, and delegated stewardship controls.

### Out of Scope
- CRM/lead storage, external redirects, analytics, custom dates, multi-club tenancy, new financial policy, client aggregation/authorization, SMTP retry queues, and changes to `/api/v1/admin/operations/snapshot`.

## Capabilities

### New Capabilities
- `public-implementation-contact`: landing, form, secured public route, and delivery.
- `club-status-dashboard`: period aggregate and server role projections.

### Modified Capabilities
- `web-frontend`, `ui-design`: product landing and Socios-derived dashboard.
- `api-security`, `auth-login`: public controls and role projections.
- `notifications`, `config-environment`: real SMTP and configured recipient.

## Approach and Affected Areas

Add focused API routes/read models, wire SMTP/config packages, and compose landing/dashboard web surfaces.

## Delivery Forecast

High risk; `auto-chain` applies. Slices, each <400 changed lines: (1) SMTP/config, (2) contact API/security, (3) landing/form, (4) aggregate/RBAC, (5) dashboard/responsive UI. Decision needed before apply: No. Chained PRs recommended: Yes. 400-line budget risk: High.

## Risks and Required Spec Inputs

- Specs must define metric source, timezone, reversals/cancellations, signs, currency, trend baseline, freshness/health, and privacy retention; do not guess them.
- SMTP failure and abuse can lose leads or leak data; require integration tests, generic responses, redaction, and throttling.

## Rollback Plan

Revert slices independently; restore current surfaces, disable contact, and remove recipient config without changing ADMIN operations or financial records.

## Success Criteria

- [ ] Landing states Athlos/Gorriti positioning, exposes no private data, and submits exactly the approved fields.
- [ ] A controlled SMTP test reaches the configured recipient; synthetic IDs and failed sends never report success.
- [ ] All four roles receive only their authorized aggregate fields; period tests prove current-state stability.
- [ ] Keyboard/focus/label/error checks pass; no horizontal overflow at 320, 768, 1024, and 1440 px.
- [ ] Abuse, origin, validation, retention, log-redaction, unauthenticated-access, and RBAC tests pass.
