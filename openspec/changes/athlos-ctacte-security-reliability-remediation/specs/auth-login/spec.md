# Delta for Auth Login

## ADDED Requirements

### Requirement: CTACTE Mutation Authorization

The system MUST permit payment, debit, and note mutations only to `ADMIN`, `TESORERO`, and `OPERADOR`. `CONSULTA` MUST remain read-only. Reprinting a CTACTE comprobante MUST additionally require `can_reprint`, regardless of an otherwise eligible role.

#### Scenario: Eligible role mutates
- GIVEN an authenticated `OPERADOR`, `TESORERO`, or `ADMIN`
- WHEN the actor submits a valid covered mutation
- THEN the role gate MUST allow evaluation of the request

#### Scenario: Read-only or unreprintable actor
- GIVEN `CONSULTA`, or an actor with `can_reprint=false`
- WHEN it submits a mutation or reprint respectively
- THEN the endpoint MUST return `403`
