# Delta for ctacte-mutations

## MODIFIED Requirements

### Requirement: Register Payment Endpoint

`POST /api/v1/socios/:socioId/ctacte/movements/payment` SHALL require an opaque `Idempotency-Key` header (1–128 characters). Callers MUST reuse one key per payment intent across ambiguous retries and use a new key for a new intent. The system MUST persist the key and canonical payload: same key/payload MUST replay the original result without further effects; same key/changed payload MUST return `409 CONFLICT`.

When `comprobante` is supplied, the route MUST delegate directly to the shared `uploadAttachment` service with `category='comprobante'`, preserving its validation, quota, storage, and audit behavior. It MUST NOT call the attachments HTTP route internally.

(Previously: payments used a 10-second audit-key contract and specified internal attachment-route delegation.)

#### Scenario: New payment with attachment
- GIVEN an authenticated operator supplies a new valid key and multipart payment
- WHEN the request includes a valid comprobante
- THEN the response SHALL be `201 Created` with one movement/audit effect
- AND the attachment SHALL be created through the shared service

#### Scenario: Payment retry replays durably
- GIVEN a completed payment for a key and canonical payload
- WHEN the caller retries with that key and payload
- THEN the original result SHALL be returned with no additional effects

#### Scenario: Payment key conflicts on changed intent
- GIVEN a completed payment for a key
- WHEN the caller reuses it with a changed canonical payload
- THEN the response SHALL be `409 CONFLICT` and create no effects

### Requirement: Add Note to Movement Endpoint

`POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes` SHALL require the same durable caller-key contract. Its canonical payload MUST include operator, socio, movement, and body. Same key/payload MUST replay; a changed payload MUST return `409 CONFLICT`; distinct keys MAY create identical notes.

(Previously: notes used a 10-second audit-key contract.)

#### Scenario: Note retry replays durably
- GIVEN a note was created for a key and canonical payload
- WHEN its caller retries with the same key and payload
- THEN the original note SHALL be returned without duplicate note/audit

#### Scenario: Changed note conflicts
- GIVEN a completed note key
- WHEN the caller changes the body or target movement while reusing it
- THEN the response SHALL be `409 CONFLICT`

### Requirement: Zod Validation + ApiError Surfacing on All Forms

Mutation forms SHALL render server field validation inline and also call `notify('error', ...)`. The modal MUST retain entered values for correction and retry. Client-side validation MUST remain inline and MUST NOT send a request.

(Previously: server field validation suppressed the error toast.)

#### Scenario: Server field error is additive
- GIVEN a payment response is `400 VALIDATION_ERROR` with field details
- WHEN the client processes the envelope
- THEN it SHALL display each field message inline and fire one error toast

#### Scenario: Client validation prevents submission
- GIVEN a required field is invalid before submission
- WHEN the operator attempts to submit
- THEN no request SHALL be sent and the inline message SHALL be shown

## ADDED Requirements

### Requirement: Disposable PostgreSQL Verification Evidence

Final approval MUST record successful migration-reapplication, lease/concurrency, and payment/note/comprobante retry evidence against disposable PostgreSQL selected by `ATHLOS_TEST_DATABASE_URL`. Verification MUST NOT access production, apply production migrations, deploy, or use an unverified URL.

#### Scenario: Disposable database evidence
- GIVEN a disposable PostgreSQL URL is assigned to `ATHLOS_TEST_DATABASE_URL`
- WHEN required migrations and retry suites run
- THEN their passing commands and results SHALL be recorded as final-verification evidence

#### Scenario: Missing database URL
- GIVEN `ATHLOS_TEST_DATABASE_URL` is unset or non-disposable
- WHEN final verification is attempted
- THEN it SHALL be blocked and SHALL NOT claim database-backed approval

### Requirement: Reviewable Remediation Slices

Contracts, header/tests, and database-evidence work MUST be delivered as independent stacked-to-main slices of at most 400 changed lines each.

#### Scenario: Oversized slice
- GIVEN a planned remediation slice exceeds 400 changed lines
- WHEN delivery is prepared
- THEN it SHALL be split before apply
