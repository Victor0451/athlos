# Padrones Lifecycle Specification

## Purpose

Manage enrollments.

## Requirements

### Requirement: Authorized lifecycle commands

Authenticated `ADMIN` and `OPERADOR` callers MUST create, deactivate, or reactivate enrollments. Other roles MUST receive the established `403` envelope with no side effect.

#### Scenario: Authorized creation
- GIVEN a valid `OPERADOR` command
- WHEN submitted
- THEN the enrollment MUST be created

#### Scenario: Forbidden mutation
- GIVEN a `CONSULTA` caller
- WHEN it submits a mutation
- THEN it MUST receive `403` with no side effect

### Requirement: Immutable enrollment identity

Creation MUST provide `socio`, `disciplina`, `ejercicio`, `fecha_alta`, and initial `estado` of `activa` or `pendiente`. Identity fields and `fecha_alta` MUST NOT be editable. `estado` MUST change only by lifecycle command, never a generic patch. The database MUST allow only `activa`, `pendiente`, and `baja`, and require non-null baja reason and effective date for `baja`.

#### Scenario: Invalid status or identity edit
- GIVEN an unsupported status or identity edit
- WHEN it is validated
- THEN it MUST return the established `400` envelope with no side effect

### Requirement: Unique, reversible enrollment

The system MUST retain exactly one enrollment per `(socio, disciplina, ejercicio)`. Duplicate creation, including after `baja`, MUST return the established `409` envelope; reactivation MUST reuse it. Unknown references or enrollment IDs MUST return the established `404` envelope.

#### Scenario: Create after withdrawal
- GIVEN a `baja` enrollment for the tuple
- WHEN creation is submitted
- THEN it MUST return `409` and preserve the existing enrollment

### Requirement: Conditional status transitions

The system MUST transition `activa` or `pendiente` to `baja`, and `baja` to `activa` only. Reactivation MUST NOT accept a target or restore prior state. Baja requires a non-empty reason and effective date. Repeated baja MUST be a no-op, preserving metadata with no audit event. Other same-state requests MUST be no-op successes. A stale or incompatible transition MUST return `409` with no side effect.

#### Scenario: Deactivate and reactivate
- GIVEN an active enrollment
- WHEN baja then reactivation succeeds
- THEN it MUST be `activa` and retain withdrawal metadata

#### Scenario: Missing withdrawal metadata
- GIVEN an active enrollment
- WHEN baja omits its reason or date
- THEN it MUST return `400` and leave the enrollment unchanged

#### Scenario: Repeated baja
- GIVEN a `baja` enrollment with metadata
- WHEN baja is repeated
- THEN it MUST preserve metadata and emit no event

### Requirement: Caller-key idempotency and atomic evidence

Create and transition commands MUST require a valid `Idempotency-Key`. A missing or malformed key MUST return `400 VALIDATION_ERROR` with no enrollment or audit side effect. The same key and canonical payload MUST replay the original result without another write or audit event; a changed payload MUST return `409`. Each state-changing command MUST atomically commit the enrollment, caller-key outcome, and one event, or none. The event MUST contain actor, source IP, `inscripcion` identity, before/after snapshots, action (`INSCRIPCION_CREATED` or `INSCRIPCION_STATUS_CHANGED`), and caller key. Rejected and no-op commands MUST NOT emit lifecycle events.

#### Scenario: Idempotent replay
- GIVEN a success with caller key `K`
- WHEN the identical command replays with `K`
- THEN it MUST return the original result with no additional audit event

#### Scenario: Invalid caller key
- GIVEN a command without a valid `Idempotency-Key`
- WHEN it is submitted
- THEN it MUST return `400 VALIDATION_ERROR` with no side effect

#### Scenario: Concurrent transition
- GIVEN two transitions race from the same prior state
- WHEN one commits first
- THEN the other MUST return `409` and create no audit event

### Requirement: Explicit exclusions

The system MUST NOT support hard deletion, identity or `fecha_alta` edits, Socio-detail actions, deployment, or production access.

#### Scenario: Unsupported lifecycle surface
- GIVEN an excluded operation
- WHEN requested
- THEN no lifecycle operation MUST be available or performed
