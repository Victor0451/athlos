# Delta for Web Frontend

## ADDED Requirements

### Requirement: Public Landing

`/` SHALL describe private Athlos access. **Iniciar sesión** MUST be its only primary action; it MUST NOT expose data, marketing, leads, demos, pricing, or contact capture.

#### Scenario: Public root
- GIVEN a visitor at `/`
- WHEN it renders
- THEN it SHALL describe controlled access and **Iniciar sesión** SHALL lead to `/login`

#### Scenario: Public boundary
- GIVEN a visitor at `/`
- WHEN it renders
- THEN metrics, member or scheduler data, and status SHALL NOT render

### Requirement: Personal Boundary

Every authenticated `ADMIN`, `TESORERO`, `OPERADOR`, and `CONSULTA` role MUST have an operator-scoped personal menu, separate from ADMIN system settings. Account overview MAY be read-only. Password change MUST be actionable through the existing authenticated `POST /api/v1/auth/change-password` contract with `current_password` and `new_password`; its success response MUST confirm the change, and rejected current-password or new-password validation responses MUST show a safe error while leaving the action available. Notification preferences MUST be the only read-only personal-settings surface in slice one. Sign-out MUST remain actionable.

#### Scenario: All-role menu
- GIVEN an authenticated `ADMIN`, `TESORERO`, `OPERADOR`, or `CONSULTA` opens the personal menu
- WHEN it renders
- THEN account overview, password change, notification preferences, and sign-out SHALL be available
- AND ADMIN system settings SHALL NOT appear in that personal menu

#### Scenario: Password change succeeds
- GIVEN an authenticated operator provides a valid current password and valid new password
- WHEN they submit the password-change action
- THEN the client SHALL call `POST /api/v1/auth/change-password` with the contracted fields
- AND the returned success message SHALL confirm the password change

#### Scenario: Password change is rejected
- GIVEN an authenticated operator submits an incorrect current password or an invalid new password
- WHEN the endpoint rejects the request
- THEN the personal surface SHALL show a safe error and keep password change available

#### Scenario: Read-only preferences
- GIVEN an operator opens preferences
- WHEN rendered
- THEN notification preferences SHALL show without an editor or write action

#### Scenario: Personal sign-out
- GIVEN an authenticated operator selects sign-out from the personal menu
- WHEN sign-out completes
- THEN the existing logout behavior SHALL clear the session and redirect to `/login`

## MODIFIED Requirements

### Requirement: Protected Routing

`/dashboard` and authed routes SHALL be protected; `/` SHALL remain public.
(Previously: public `/` and `/dashboard` were not reconciled.)

#### Scenario: Protected route
- GIVEN no token or refresh cookie
- WHEN the user opens `/socios`
- THEN the layout SHALL redirect to `/login?from=/socios`

#### Scenario: Dashboard
- GIVEN no token or refresh cookie
- WHEN the user opens `/dashboard`
- THEN the layout SHALL redirect to login

### Requirement: AppShell Layout

Navigation SHALL be permission-aware. ADMIN task/job links SHALL be under **Operations**; UI visibility MUST NOT replace server gates.
(Previously: navigation used a flat Admin listing.)

#### Scenario: Role gating
- GIVEN a `CONSULTA`
- WHEN navigation renders
- THEN unauthorized entries SHALL hide and workspaces SHALL remain

#### Scenario: Operations
- GIVEN an ADMIN
- WHEN navigation renders
- THEN Scheduler/task links SHALL be under **Operations** with unchanged targets

#### Scenario: Mobile drawer
- GIVEN a viewport below 1024px
- WHEN its menu opens the drawer
- THEN focus and overlay SHALL activate; Escape, overlay, or navigation SHALL close and restore focus

### Requirement: Dashboard Cards

`/dashboard` SHALL use truthful authorized data for role-aware orientation, notifications, and cards. It MUST NOT invent totals or show scheduler controls. Only ADMIN MAY query its bounded snapshot, which SHALL link to Operations and retain at most 10 attention runs.
(Previously: the dashboard was primarily an ADMIN operational snapshot.)

#### Scenario: Non-ADMIN home
- GIVEN a non-ADMIN opens `/dashboard`
- WHEN it renders
- THEN authorized cards and notifications SHALL show; the ADMIN snapshot SHALL NOT be requested

#### Scenario: ADMIN summary
- GIVEN an ADMIN snapshot has over 10 runs
- WHEN the dashboard renders
- THEN at most 10 safe signals SHALL link to Operations without controls

#### Scenario: Refresh
- GIVEN an ADMIN dashboard is mounted
- WHEN 30 seconds elapse
- THEN one snapshot query SHALL update signals

#### Scenario: States
- GIVEN an authorized source loads, is empty, or fails
- WHEN `/dashboard` renders
- THEN its region SHALL show an accessible loading, empty, or safe error state; other cards remain usable

## Scope Boundaries

Slice one MUST NOT relocate scheduler routes, add contracts or execution, alter semantics, or relax authorization. Relocation and preference editing are slice-two work.
