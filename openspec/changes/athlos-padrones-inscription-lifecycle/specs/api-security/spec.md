# Delta for API Security

## ADDED Requirements

### Requirement: Padrones Mutation Role Gate

The system MUST require authentication and role `ADMIN` or `OPERADOR` for enrollment create and status-transition routes. Every other authenticated role MUST receive the established `403` envelope; unauthenticated callers MUST receive the established authentication failure. Rejected callers MUST NOT reach lifecycle persistence or emission of lifecycle audit events.

#### Scenario: ADMIN or OPERADOR is admitted
- GIVEN an authenticated `ADMIN` or `OPERADOR`
- WHEN the caller submits a valid Padrones mutation
- THEN the request MUST proceed to lifecycle validation

#### Scenario: Other role is denied
- GIVEN an authenticated role other than `ADMIN` or `OPERADOR`
- WHEN it submits a Padrones mutation
- THEN it MUST receive `403` with no lifecycle side effect
