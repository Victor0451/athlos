# Proposal: Padrones Enrollment Lifecycle

## Intent

Replace Padrones' read-only placeholders so ADMIN and OPERADOR can enroll socios and manage status without losing history.

## Current-State Gap and User Outcome

`deportes.inscripciones` has unconstrained status, no withdrawal metadata, and no mutation API or UI. Authorized operators will manage durable, auditable enrollments from Padrones.

## Scope

### In Scope
- Create an enrollment as `activa` or `pendiente`.
- Transition explicitly to `baja` and reactivate the same enrollment.
- Persist required deactivation reason and effective date.
- Add typed wrappers, create/status UI, query invalidation, and strict TDD.

### Non-Goals
- Editing `socio`, `disciplina`, `ejercicio`, or `fecha_alta` after creation.
- General editing, Socio-detail actions, deployment issue #12, or production access.

## Business Rules

- ADMIN and OPERADOR may create, deactivate, and reactivate.
- Exactly one enrollment exists per `(socio, disciplina, ejercicio)`; removal is reversible `baja`, never deletion or reinsertion.
- Identity and `fecha_alta` are immutable.
- Deactivation reason, effective date, and atomic audit evidence are mandatory.

## Capabilities

### New Capabilities
- `padrones-inscription-lifecycle`: creation, transitions, invariants, withdrawal metadata, idempotency, and UI workflow.

### Modified Capabilities
- `audit-logger`: add atomic enrollment creation/status events and action values.
- `api-security`: authorize Padrones mutations for ADMIN and OPERADOR only.
- `web-frontend`: replace Padrones mutation placeholders with create and status controls.

## Approach

Add schema constraints and withdrawal metadata. Expose validated commands with stable errors, caller-key idempotency, and transactional audit emission. Keep create separate from conditional transitions; same-state retries are no-op successes. Reuse the modal and invalidate affected roster queries.

## Delivery Strategy

Forecast exceeds 400 authored changed lines; use chained review slices:
1. Schema + backend lifecycle API + strict TDD + atomic audit/idempotency.
2. Typed web wrappers + create/status UI + strict TDD + query invalidation.

Each slice remains independently verifiable, reversible, and under budget unless maintainers approve an exception.

## Dependencies

- Existing Drizzle, RBAC, error-envelope, audit, TanStack Query, and modal patterns.

## Risks

- Existing invalid status data may block the constraint migration; inspect/backfill first.
- Concurrent transitions risk stale state or misleading audits; use transactional conditional writes.
- Row navigation plus actions may create accessibility conflicts; separate navigation and controls.

## Rollback Plan

Disable mutation UI/routes and redeploy the prior image. Retain additive columns; correct schema issues through a forward migration.

## Success Criteria

- [ ] Authorized operators complete create, baja, and reactivation flows; other roles receive 403.
- [ ] Duplicate identity, immutable fields, persistent baja metadata, idempotency, and atomic audit rules hold under tests and retries.
- [ ] Successful web mutations refresh affected Padrones data without a full reload.
