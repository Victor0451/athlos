# CTACTE Mutations Specification

## Purpose

Define the durable and user-visible contracts for payment and note mutations.

This specification covers caller-key replay, comprobante attachment handling,
and actionable mutation validation.

## Requirements

### Requirement: Durable Caller-Key Idempotency for Payment and Notes

#### Caller-key validation

- Payment and note mutations MUST require a valid opaque caller key from 1 to 128 characters.
- A missing or malformed caller key MUST return `400`.
- A rejected key MUST cause no mutation, attachment, or audit side effect.

#### Replay outcome

- A caller key and canonical payload MUST identify one durable mutation result.
- The same key and canonical payload MUST replay the original result.
- Replay MUST NOT create another domain row or audit record.
- The same key with a changed canonical payload MUST return `409`.
- A `409` conflict MUST NOT create or modify a mutation result.

#### Scenario: Payment replay and payload conflict

- GIVEN a payment has completed for a valid caller key and canonical payload
- WHEN the caller submits the same key and canonical payment payload again
- THEN the system MUST replay the original payment result without a second row or audit record
- AND a submission of that key with a changed canonical payload MUST return `409`

#### Scenario: Note replay and payload conflict

- GIVEN a note has completed for a valid caller key and canonical payload
- WHEN the caller submits the same key and canonical note payload again
- THEN the system MUST replay the original note result without a second row or audit record
- AND a submission of that key with a changed canonical payload MUST return `409`

#### Scenario: Missing or malformed caller key

- GIVEN a payment or note request has a missing or malformed caller key
- WHEN the mutation request is submitted
- THEN the system MUST return `400`
- AND it MUST create no mutation, attachment, or audit side effect

### Requirement: Payment Comprobante Uses the Shared Attachment Service

#### Attachment boundary

- A payment containing a comprobante MUST delegate handling directly to
  `uploadAttachment` with the category `comprobante`.
- The payment mutation MUST NOT issue an internal HTTP request for comprobante
  handling.
- On successful payment completion, the persisted attachment MUST be linked to
  the resulting payment.

#### Scenario: Payment persists its comprobante attachment

- GIVEN a valid payment request includes a valid comprobante attachment
- WHEN the payment mutation completes successfully
- THEN it MUST delegate directly to `uploadAttachment` with category `comprobante`
- AND it MUST make no internal HTTP request for the attachment
- AND the persisted attachment MUST be linked to the resulting payment

### Requirement: Mutation Field Validation Uses Inline Guidance and an Error Toast

#### Structured errors

- For an `ApiError` with `details`, the form or modal MUST apply the supplied
  field errors inline.
- It MUST show exactly one general error toast.
- The form or modal MUST remain open for correction.

#### Unstructured errors

- For an error without `details`, the form or modal MUST show exactly one
  general error toast only.
- It MUST NOT fabricate an inline field error.
- The form or modal MUST remain open for correction.

#### Scenario: Structured validation error remains actionable

- GIVEN an open payment or note form receives an `ApiError` with field `details`
- WHEN the mutation failure is presented to the caller
- THEN the form or modal MUST apply the supplied field errors inline
- AND it MUST show exactly one general error toast while remaining open

#### Scenario: Unstructured error remains toast-only

- GIVEN an open payment or note form receives an error without `details`
- WHEN the mutation failure is presented to the caller
- THEN the form or modal MUST show exactly one general error toast
- AND it MUST not fabricate an inline field error and MUST remain open
