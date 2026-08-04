# Scheduler UI Specification

## Purpose

Operator-facing surface for the Athlos scheduler subsystem. ADMIN operators SHALL be able to list all registered jobs, inspect job detail with recent runs, trigger manual runs, and toggle enable/disable — replacing the current `psql` + `curl` workflow. The UI consumes the scheduler endpoints defined in `openspec/specs/scheduler-jobs/spec.md` (Admin Scheduler Endpoints section).

---

## Requirements

### Requirement: Scheduler Job List

The ADMIN-only `/admin/scheduler` page SHALL use dynamic scheduler reads, one entry per job. It SHALL present all seven statuses and safe projected reason/message only; raw errors and metadata MUST NOT render.
(Previously: fixed six-job grid and raw errors.)

#### Scenario: Dynamic status presentation
- GIVEN a registered job is `cancelled`
- WHEN an ADMIN opens the scheduler page
- THEN it SHALL show cancelled status and safe text only

#### Scenario: Non-ADMIN denied
- GIVEN an authenticated OPERADOR
- WHEN they navigate to `/admin/scheduler`
- THEN the page SHALL deny access

### Requirement: Job Detail Page

The system SHALL render `/admin/scheduler/[name]` showing the job's recent runs (last 20), a "Trigger now" button, and an enable/disable toggle. All controls SHALL require ADMIN role and SHALL be gated by confirmation dialogs for state-changing actions.

#### Scenario: Job detail loads recent runs

- GIVEN an ADMIN operator on `/admin/scheduler/scheduled-import`
- WHEN the page mounts
- THEN it SHALL call `GET /api/v1/scheduler/jobs/scheduled-import`
- AND SHALL display recent runs (last 20) with: status, duration, attempt count, error_message if failed

#### Scenario: Trigger now requires confirmation

- GIVEN an ADMIN operator on a job detail page
- WHEN they click "Disparar ahora"
- THEN a confirmation dialog SHALL appear with the job name and a "Confirmar" button
- AND on confirmation, the system SHALL POST `/api/v1/scheduler/jobs/{name}/run-now`
- AND on success, the recent runs list SHALL refresh

#### Scenario: Trigger now rate-limited

- GIVEN an ADMIN operator just triggered a manual run within the last 60 seconds
- WHEN they click "Disparar ahora" again
- THEN the API SHALL return 429 with `Retry-After`
- AND the UI SHALL display "Espera N segundos antes de volver a disparar"

#### Scenario: Toggle disable stops future cron runs

- GIVEN an ADMIN operator on a job detail page
- WHEN they toggle the enable switch OFF
- THEN the system SHALL PATCH `/api/v1/scheduler/jobs/{name}` with `{ enabled: false }`
- AND the toggle SHALL update to reflect the disabled state
- AND the badge SHALL switch from "Activo" to "Deshabilitado"

#### Scenario: Toggle enable resumes cron runs

- GIVEN an ADMIN operator on a job detail page with a disabled job
- WHEN they toggle the enable switch ON
- THEN the system SHALL PATCH `/api/v1/scheduler/jobs/{name}` with `{ enabled: true }`
- AND the badge SHALL switch back to "Activo"

#### Scenario: Unknown job name returns 404

- GIVEN an ADMIN operator navigates to `/admin/scheduler/unknown-job`
- WHEN the page mounts
- THEN the API SHALL return 404 `JOB_NOT_FOUND`
- AND the UI SHALL display "Trabajo no encontrado" with a link back to the job list

### Requirement: Disabled Job Visual Treatment

The system SHALL visually distinguish disabled jobs in the job list (muted text, "Deshabilitado" badge) so operators do not assume the job is failing.

#### Scenario: Disabled job row rendering

- GIVEN the job grid loads
- WHEN a job has `enabled: false`
- THEN the row SHALL display "Deshabilitado" badge in `ink-500`
- AND the row text SHALL use `text-ink-500` (muted, not the active `text-ink-700`)

### Requirement: Cross-Slice Disabled Feature Placeholders

The system SHALL display "Próximamente" on features deferred from Slice 8 (Caja, Gastos, Approval executor, File storage, Receipt reprint) while keeping in-scope admin features (Scheduler, Approvals read-only) fully active.

#### Scenario: Navigating to Caja/Gastos from sidebar

- GIVEN an ADMIN operator clicks a "Caja" or "Gastos" sidebar item (if surfaced)
- WHEN the page renders
- THEN the system SHALL display "Próximamente — disponible en una próxima versión"
- AND the URL SHALL NOT 404 — it SHALL route to a dedicated placeholder route

---

## Success Criteria

- **scheduler-ui NEW**: ADMIN can see the 6-job grid at `/admin/scheduler`, click a job to see recent runs with error messages, trigger a manual run via confirmed POST, and toggle enable/disable — all wired to `/api/v1/admin/jobs/health`, `/api/v1/scheduler/jobs/:name`, `POST .../run-now`, and `PATCH ...` endpoints.
