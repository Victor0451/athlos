# Delta for UI Design

## ADDED Requirements

### Requirement: Landing and Home Contract

`/` SHALL be the public landing and `/dashboard` the protected home. This supersedes prior Navigation and Key Screens entries naming `/` Dashboard. The landing MUST use institutional language and **Iniciar sesión**; the home SHALL use role-aware cards, not public or invented metrics.

#### Scenario: Distinct routes
- GIVEN a visitor opens `/`
- WHEN it renders
- THEN it SHALL be the landing and `/dashboard` SHALL require authentication

### Requirement: Accessible Responsive Navigation

Below 1024px, navigation SHALL be a dark `night-900` drawer with a labeled control, focus, keyboard close, Escape, overlay, blocked background, and focus restoration. Hidden roles MUST NOT appear available.

#### Scenario: Keyboard drawer
- GIVEN focus is on the menu control
- WHEN the drawer opens and Escape is pressed
- THEN drawer and overlay SHALL close and focus SHALL return to that control

#### Scenario: Overlay
- GIVEN the drawer is open
- WHEN background content is activated
- THEN the overlay SHALL intercept it and only defined dismissal SHALL close the drawer

### Requirement: Personal Menu Boundary

The operator menu MUST distinguish every authenticated operator's personal account actions from ADMIN system settings. Account overview MAY be read-only; password change and sign-out MUST be actionable. Notification preferences MUST be the only read-only personal-settings surface in slice one.

#### Scenario: Personal actions for every role
- GIVEN an `ADMIN`, `TESORERO`, `OPERADOR`, or `CONSULTA` opens the operator menu
- WHEN it renders
- THEN it SHALL present account overview, password change, notification preferences, and sign-out
- AND it SHALL NOT present ADMIN system settings as personal actions

#### Scenario: Password feedback
- GIVEN an authenticated operator submits the password-change form
- WHEN the existing authenticated password contract succeeds or rejects the submission
- THEN the interface SHALL present clear success or safe error feedback without making notification preferences editable

## MODIFIED Requirements

### Requirement: Sidebar / Nav Item

The system SHALL retain dark navigation and active treatment while grouping ADMIN task/job destinations under **Operations**, without route or authorization change.
(Previously: Sidebar / Nav Item referred only to generic Navigation.)

#### Scenario: Operations route identity
- GIVEN an ADMIN views desktop navigation
- WHEN Operations renders
- THEN task/job links SHALL retain targets and the active item SHALL retain its accent left border
