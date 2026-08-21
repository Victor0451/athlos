# Delta for Web Frontend

## ADDED Requirements

### Requirement: Capability-Aware Collections Navigation

The system MUST show `/collections` only when the assessment capability is enabled and the operator has an allowed role; hiding it MUST NOT authorize an API action.

#### Scenario: Enabled authorized navigation
- GIVEN an ADMIN or TESORERO and the assessment capability enabled
- WHEN the AppShell renders
- THEN it SHALL expose the Collections entry and route

#### Scenario: Disabled or unauthorized navigation
- GIVEN the capability is disabled or the operator is not allowed
- WHEN navigation or `/collections` is requested
- THEN the entry SHALL be absent and route access SHALL be denied or unavailable

## MODIFIED Requirements

### Requirement: Protected Routing

The system SHALL wrap protected routes under a `(authed)` route group with an auth-enforcing layout and SHALL enforce Collections capability/role route access independently of client navigation.
(Previously: Protected routing only required auth enforcement.)

#### Scenario: Unauthenticated user hits protected route
- GIVEN no token and no valid refresh cookie
- WHEN the user navigates to `/socios`
- THEN the layout SHALL redirect to `/login?from=/socios`

#### Scenario: Direct Collections access is denied
- GIVEN an authenticated operator without Collections access
- WHEN they navigate directly to `/collections`
- THEN the route SHALL not expose the workspace
