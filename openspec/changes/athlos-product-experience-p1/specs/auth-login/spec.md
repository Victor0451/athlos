# Delta for Auth Login

## ADDED Requirements

### Requirement: Login as a Public Secondary Path

The login route MUST remain available to unauthenticated visitors through a secondary CTA from the public landing. Visiting the landing or opening its form MUST NOT create a session, reveal role data, or alter the existing username/password authentication, lockout, token, or RBAC contract.

#### Scenario: Public login handoff
- GIVEN an unauthenticated visitor on the landing
- WHEN they activate the login CTA
- THEN they SHALL reach `/login` without an issued token or exposed operator information

### Requirement: Club Status Role Projection

The four existing roles MUST authorize club-status fields as follows: ADMIN and TESORERO may receive approved aggregates; OPERADOR may receive regularization workload without monetary values; CONSULTA may receive non-sensitive institutional status. This read projection SHALL NOT grant technical ADMIN operation, scheduler, evidence-resolution, or delegated-stewardship authority.

#### Scenario: Read projection does not grant operation authority
- GIVEN a TESORERO, OPERADOR, or CONSULTA receives club status
- WHEN it attempts an ADMIN technical operation
- THEN existing RBAC SHALL continue to deny the operation
