# Design: Club Dues Collection and Daily Cash

## Technical Approach

Introduce a `tesoreria` native-obligation ledger behind `DUES_ASSESSMENT_ENABLED` (default `false`). Slice 1 implements Pricing Catalog → Eligibility lookup → pure Calculator → idempotent Assessment Generator → immutable obligations. `ctacte` remains untouched and optional; there is no projection in slice 1. `tesoreria.caja_movimiento` is never reconciliation truth.

## Architecture Decisions

| Choice | Alternative | Rationale |
|---|---|---|
| Native obligations own debt | Extend `ctacte` | Preserves calculation evidence and independent operation. |
| `[from,to)` price ranges plus PostgreSQL exclusion constraints | Application overlap checks | Correct under concurrent writes. |
| Structured components plus JSONB evidence | JSONB-only snapshot | Enforces money/identity invariants while retaining exact inputs. |
| Period advisory lock, receipt, and natural-key uniqueness | Request-key dedup only | Handles same-period commands with different keys. |
| Compensation columns now; workflows later | Mutable obligations | Enables append-only correction without overbuilding settlements. |

## Slice 1 Data Model

Migration `0049_dues_pricing_obligations.sql` follows existing `0048_*`; never reuse or renumber migrations. Add enums `dues_price_kind(BASE,SPORT)`, `dues_assessment_rule(FULL_MONTH,DAILY_PRORATED,NEXT_PERIOD)`, `dues_obligation_kind(MONTHLY_DUES,COMPENSATION)`, and `dues_component_kind(BASE,SPORT,BENEFIT,ADJUSTMENT)`.

- `dues_price_versions`: `id uuid PK`, `kind`, nullable `disciplina_id FK deportes.disciplinas RESTRICT`, `amount numeric(14,2)`, `currency char(3) DEFAULT 'ARS'`, `effective_from date`, nullable exclusive `effective_to`, `rule`, `created_by FK operators`, `authorization_evidence jsonb`, `created_at`, nullable `revoked_at/revoked_by/revoke_reason`. Checks: amount `>=0`, valid interval, BASE has no discipline, SPORT has one, revoke metadata is all-or-none. `btree_gist` exclusion constraints reject overlapping `daterange` among non-revoked BASE rows and per-discipline SPORT rows; B-tree indexes cover `(kind,disciplina_id,effective_from)` and active lookup.
- `dues_generation_receipts`: `id uuid PK`, `operator_id FK`, `caller_key`, `request_fingerprint char(64)`, `period_start/end`, `authorization_evidence jsonb`, nullable `result jsonb`, timestamps; unique `(operator_id,caller_key)` and check one calendar month.
- `dues_obligations`: `id uuid PK`, `socio_id FK socios RESTRICT`, `kind`, `period_start/end`, signed `amount numeric(14,2)`, `generation_receipt_id FK`, nullable `compensates_obligation_id FK self RESTRICT/reason`, `snapshot jsonb`, `actor_id FK`, `authorization_evidence jsonb`, `created_at`. Partial unique `(socio_id,period_start)` for `MONTHLY_DUES`; checks require positive monthly dues and non-zero, reasoned compensation. Index `(socio_id,period_start)`.
- `dues_obligation_components`: `id uuid PK`, `obligation_id FK RESTRICT`, `kind`, `component_key`, signed `amount`, nullable `price_version_id/disciplina_id/enrollment_id` FKs, `unit_amount`, `rule`, `eligible_from/to`, `eligible_days/period_days`, `calculation_inputs jsonb`, `eligibility_snapshot jsonb`, `price_snapshot jsonb`; unique `(obligation_id,component_key)`, money/day/range checks. DB triggers reject obligation/component UPDATE and DELETE.

The obligation snapshot records calculator version, rounding, period, base/sport inputs, enrollment state and dates, benefits `[]`, rule, actor/time, role/permissions, source IP, caller key, and receipt fingerprint. Components preserve queryable values and verbatim evidence.

## Flow, Interfaces, and Concurrency

`POST /api/v1/dues/prices` (ADMIN) and `POST /api/v1/dues/assessments/generate` (ADMIN|TESORERO, required `Idempotency-Key`, `{period:"YYYY-MM"}`) use Zod and snake_case DTOs; authenticated ADMIN|TESORERO may GET prices/obligations. Routes call `PricingService`/`AssessmentService`; repositories expose catalog, eligibility (`socios` plus `deportes.inscripciones`), receipt, and obligation ports; calculator is pure integer-cents code. `activa` enrollments and dated pre-`fecha_baja` portions of `baja` are eligible; `pendiente` is excluded.

Generation runs one REPEATABLE READ transaction: claim padrones-style fingerprinted receipt, take a period advisory lock, read eligibility/prices, calculate, insert obligations/components, emit audits, finalize receipt. Natural uniqueness returns prior obligations without duplicate audit; fingerprint mismatch is conflict. Errors use existing taxonomy: validation 400, permission 403, missing reference 404, overlap/key mismatch/concurrent identity 409, in-flight receipt 503, redacted invariant failure 500. Audit actions are `DUES_PRICE_CREATED`, `DUES_PRICE_REVOKED`, and `DUES_PERIOD_GENERATED`, emitted atomically with authorization/idempotency/snapshot evidence.

## Future Boundaries

Benefits add versioned negative components; allocations target obligations and settlements. Monetary settlements create tender income; approved community work creates non-cash settlement and reduces debt without tender/cash income. Agreements reference obligations and create append-only revisions. Agreement terms use integer cents and 1–60 dated installments whose amounts sum exactly to the agreed amount; dates are valid date-only `YYYY-MM-DD` values, strictly increasing, and not earlier than the agreement date. The agreed amount is bounded by the linked obligation's outstanding debt at creation or revision. Rescheduling atomically supersedes the active revision while preserving the obligation and append-only debt history. Agreement create and reschedule paths acquire the obligation row lock before agreement/index work; a deferred database constraint requires each ACTIVE→SUPERSEDED transition to have exactly one same-obligation/socio successor with the next revision number. Desk shifts own tender movements and expense inclusions; immutable closes snapshot identities/totals. The fixed club timezone is `America/Argentina/Jujuy`; `businessDate` derives from opening time and survives after-midnight close. Close totals use the inclusive `[openedAt, closedAt]` interval, shifts cannot exceed 24 hours, and gasto inclusion requires `gasto.fecha = businessDate` and immediately freezes the gasto. Explicit command keys and fingerprints provide database uniqueness and replay/conflict semantics. Database triggers enforce one-way closure, reject direct CLOSED shift creation without a lifecycle close, block post-24-hour movements, permit only reasoned ADMIN/TESORERO force-close recovery, enforce source relationships, included-gasto immutability, and append-only movement history. Force-close audit exposes only allowlisted compensation IDs/reason and recovery evidence. Closed-period changes use compensating corrections. Optional one-way `ctacte` projection attaches by native-record identity only.

## Files and Testing

Create `packages/db/src/schema/dues.ts`, migrations `0049_*`, `0054_dues_cash_closes.sql`, `0055_cash_policy_atomicity.sql`, `0056_cash_recovery_policy.sql`, `apps/api/src/modules/dues/{calculator,repository,service,cash-desk}.ts`, and `apps/api/src/routes/{dues,treasury}.ts`; modify schema exports, server/client feature configuration, `server.ts`, `packages/config/src/schema.ts`, and `packages/audit/src/emitter.ts`. Unit-test calculator rules/rounding and cash-period boundaries. PostgreSQL integration tests prove constraints, overlap races, receipt replay, same-key concurrency, atomic financial/audit writes, immediate included-gasto immutability, direct CLOSED rejection, business-date/date/24h policy, forced recovery, close-vs-gasto races, source relationships, cross-operator compensation, and direct-SQL immutability. Route/contract tests prove DTOs, flag behavior, explicit idempotency, force-close authorization/reason, privacy-safe authorized audit projection, and role denial. Web tests prove server-provided feature gating, hidden navigation, accessible disabled/loading/error states, and handled command failures.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A: no execution classification. |
| Git repository selection | N/A: no VCS integration. |
| Commit state | N/A: no VCS integration. |
| Push state | N/A: no VCS integration. |
| PR commands | N/A: no PR automation. |

## Risks

Current member status lacks period history; slice 1 snapshots execution-time base eligibility and must not claim historical status reconstruction. The implementation must be split under the 400-line review budget; ask before any exception.
