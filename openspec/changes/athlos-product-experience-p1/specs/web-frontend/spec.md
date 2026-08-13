# Delta for Web Frontend

## ADDED Requirements

### Requirement: Product Landing and Role-Aware Status Surface

The web application MUST render `/` as the public Athlos product landing for unauthenticated visitors and the authenticated club-status dashboard for operators. The landing MUST position Athlos first and Gorriti as proof/current edition, include an embedded implementation-contact CTA, and retain login as a secondary CTA. The dashboard MUST consume only the role-projected club-status response, MUST NOT aggregate or authorize data in the client, and MUST distinguish loading, unavailable, empty, error, and zero states.

#### Scenario: Landing secondary login
- GIVEN an unauthenticated visitor opens `/`
- WHEN the landing renders
- THEN a visible secondary login CTA SHALL navigate to `/login`

#### Scenario: No false zero
- GIVEN the status API returns an unavailable metric or request failure
- WHEN the dashboard renders
- THEN it SHALL show an unavailable or error state and SHALL NOT show zero

## MODIFIED Requirements

### Requirement: Dashboard Cards

The dashboard MUST obtain its role-projected club status from one server request and MUST render only fields present in that response. It MUST keep ADMIN technical readiness, canonical freshness, job health, and attention runs separate from the club-status surface; club-status MUST not initiate operations. It MUST poll only if the server contract permits it and MUST preserve independent loading, unavailable, empty, error, and data states.
(Previously: ADMIN cards obtained technical readiness, freshness, job health, and attention runs through one query.)

#### Scenario: Role projection drives rendered cards
- GIVEN an OPERADOR dashboard response excludes monetary fields
- WHEN dashboard cards render
- THEN no monetary card SHALL be rendered or inferred client-side

#### Scenario: Technical operations remain separate
- GIVEN an ADMIN opens the club-status dashboard
- WHEN the page renders
- THEN scheduler execution and evidence-resolution controls SHALL not appear in the status surface
