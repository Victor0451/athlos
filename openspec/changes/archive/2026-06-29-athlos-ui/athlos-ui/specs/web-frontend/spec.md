# Web Frontend Specification

## Purpose

Operator-facing web console replacing `psql`/`curl` for ADMIN, TESORERO, OPERADOR, CONSULTA. Authenticates against Fastify API v0.5.8, surfaces live data (socios, ctacte, padrones, scheduler, approvals), and follows the Gorriti Premium design system (`openspec/specs/ui-design/spec.md`). Slice 8 is UI-only: every screen consumes existing endpoints; deferred backend features show "Próximamente".

---

## Requirements

### Requirement: Operator Login and Logout

The system SHALL authenticate against `POST /api/v1/auth/login`, store the access token in module-scope memory (never `localStorage`/`sessionStorage`), and consume the refresh token via httpOnly cookie per `auth-cookies` spec. The system SHALL clear in-memory token + cookie on logout. The access token SHALL NOT persist across browser tabs.

#### Scenario: Successful login

- GIVEN an unauthenticated operator on `/login`
- WHEN they submit valid credentials
- THEN the API SHALL return `{ access_token, refresh_token, expires_in, operator_id, role, permissions }`
- AND the user SHALL redirect to `/dashboard`

#### Scenario: Account lockout

- GIVEN 5 failed attempts in 15 minutes
- WHEN the operator submits correct credentials
- THEN the API SHALL return 429 `ACCOUNT_LOCKED`
- AND the form SHALL display "Cuenta bloqueada — vuelva a intentar en N minutos"

#### Scenario: Logout from topbar

- GIVEN an authenticated operator clicks "Salir"
- WHEN logout fires
- THEN the system SHALL call `POST /api/v1/auth/logout`, clear the in-memory token, and redirect to `/login`

#### Scenario: New tab requires login

- GIVEN no in-memory token and no valid refresh cookie
- WHEN the user opens `/dashboard` in a new tab
- THEN the system SHALL redirect to `/login`

### Requirement: Silent Token Refresh

The system SHALL refresh the access token automatically before expiry and SHALL retry the original request exactly once on a 401 response, using a single-flight `refreshInFlight` Promise to prevent concurrent refreshes from invalidating the new refresh token.

#### Scenario: Single-flight 401 retry

- GIVEN 5 concurrent API calls with an expired access token
- WHEN all 5 receive 401
- THEN exactly 1 refresh request SHALL be issued
- AND all 5 original requests SHALL retry with the new token

#### Scenario: Refresh failure redirects to login

- GIVEN the refresh cookie is expired or revoked
- WHEN silent refresh fails
- THEN the in-memory token SHALL be cleared
- AND the user SHALL redirect to `/login` with "Sesión expirada"

### Requirement: Protected Routing

The system SHALL wrap protected routes under a `(authed)` route group with an auth-enforcing layout.

#### Scenario: Unauthenticated user hits protected route

- GIVEN no token and no valid refresh cookie
- WHEN the user navigates to `/socios`
- THEN the layout SHALL redirect to `/login?from=/socios`

### Requirement: AppShell Layout

The system SHALL render every authed page inside an AppShell with a Topbar (night-900, 56px) and a Sidebar (night-900, 240px) per `ui-design/spec.md`.

#### Scenario: Sidebar role gating

- GIVEN a `CONSULTA` operator
- WHEN the Sidebar renders
- THEN Admin submenu items SHALL be hidden
- AND Dashboard / Socios / Ctacte / Padrones SHALL remain visible

#### Scenario: Sidebar menu items for ADMIN

- GIVEN an ADMIN operator
- WHEN the Sidebar renders
- THEN it SHALL list Dashboard, Socios, Ctacte, Padrones, Admin (Scheduler, Approvals), Settings
- AND the active item SHALL show `accent` left-border + white text

#### Scenario: Mobile sidebar drawer

- GIVEN viewport width < 1024px
- WHEN the user taps the topbar menu button
- THEN the sidebar SHALL slide in as a drawer

### Requirement: Dashboard Cards

The system SHALL render `/dashboard` with auto-refreshing cards: API Health, Master Table Counts, Scheduler Status, Recent Runs.

#### Scenario: Auto-refresh every 30 seconds

- GIVEN any dashboard card is mounted
- WHEN 30 seconds elapse
- THEN each card SHALL refetch without a full page reload

#### Scenario: API Health and Master Counts cards

- GIVEN the dashboard mounts
- WHEN the cards fetch
- THEN API Health SHALL display `status`, `version`, `uptime` from `GET /health`
- AND Master Counts SHALL display row counts for all 8 master tables (socios, escuela, disciplinas, locacion, caja_movimiento, gastos, ctacte, ctacte1)

#### Scenario: Scheduler Status and Recent Runs cards (ADMIN)

- GIVEN an ADMIN operator on the dashboard
- WHEN the cards fetch
- THEN Scheduler Status SHALL display 6 jobs from `GET /api/v1/admin/jobs/health`
- AND Recent Runs SHALL display last 5 runs from `GET /api/v1/admin/jobs/runs?limit=5`

### Requirement: Design System and Deferred Features

The system SHALL use Gorriti Premium tokens exclusively via Tailwind utility classes (no inline styles, no hard-coded hex). Dark mode SHALL NOT be enabled in MVP. Deferred features (Caja, Gastos, Approval executor, File storage, Receipt reprint) SHALL display "Próximamente"; Admin Scheduler + Approvals remain active.

#### Scenario: Navigating to deferred feature

- GIVEN an operator clicks a deferred sidebar item
- WHEN the page renders
- THEN the system SHALL display "Próximamente — disponible en una próxima versión"
- AND the URL SHALL NOT 404

---

## Success Criteria

- **web-frontend NEW**: Operator can log in at `/login` against `localhost:4001`, see role-aware Sidebar, navigate Dashboard/Socios/Ctacte/Padrones/Admin, and logout from Topbar — all wired to live API responses within 30s auto-refresh windows.