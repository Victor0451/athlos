# Delta for Audit Logger

## ADDED Requirements

### Requirement: Atomic Enrollment Lifecycle Events

The system MUST record exactly one `INSCRIPCION_CREATED` or `INSCRIPCION_STATUS_CHANGED` event for each successful state-changing enrollment command in the same transaction. Each event MUST include actor, source IP, `entity_type: inscripcion`, entity ID, before/after snapshots, and the caller key. Failed, rejected, replayed, and same-state no-op commands, including repeated baja, MUST NOT add an event.

#### Scenario: Transactional status event
- GIVEN a valid baja command
- WHEN its enrollment update commits
- THEN its status event MUST commit with it

#### Scenario: Audit failure
- GIVEN an audit insert cannot commit
- WHEN the lifecycle command completes
- THEN the enrollment update and caller-key outcome MUST roll back
