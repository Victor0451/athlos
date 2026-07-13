# Delta for API Design

## MODIFIED Requirements

### Requirement: HTTP Status Code Usage

The API MUST return the following status codes:

| Code | Meaning | When Used |
|---|---|---|
| 200 | OK | Successful read, update, action |
| 201 | Created | Successful resource creation |
| 204 | No Content | Successful deletion |
| 400 | Bad Request | Invalid request body, missing fields, or quota exceeded |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Insufficient role or permission |
| 404 | Not Found | Resource does not exist, including soft-deleted metadata |
| 409 | Conflict | Duplicate resource |
| 410 | Gone | Used or expired approval token |
| 413 | Payload Too Large | Upload exceeds its size cap (`PAYLOAD_TOO_LARGE`) |
| 415 | Unsupported Media Type | Upload fails magic-byte validation (`UNSUPPORTED_MEDIA_TYPE`) |
| 422 | Unprocessable Entity | Semantic error |
| 429 | Too Many Requests | Rate limit or lockout |
| 500 | Internal Server Error | Unexpected server error |
| 504 | Gateway Timeout | Comprobante render exceeded 30 seconds |

Every `504` MUST use the standard `ApiError` envelope with `error: "RENDER_TIMEOUT"` and `request_id`.
(Previously: the status-code contract had no `504` render-timeout outcome.)

## ADDED Requirements

### Requirement: CTACTE Mutation and Comprobante Contracts

Payment, debit, and note mutations MUST accept only uniformly validated UUID identifiers and caller keys; malformed values MUST return `400 VALIDATION_ERROR`. The comprobante endpoint MUST require `can_reprint`; replays MUST be bound to the originating actor. A render exceeding 30 seconds MUST be recorded as failed and a retry MUST return `504 RENDER_TIMEOUT`, using the standard error envelope.

#### Scenario: Authorized valid request
- GIVEN an eligible actor supplies valid UUIDs and a new caller key
- WHEN a mutation or owned comprobante replay is requested
- THEN the endpoint MUST process it under its contract

#### Scenario: Invalid or unauthorized request
- GIVEN an invalid UUID/key, missing `can_reprint`, or another actor's replay
- WHEN the endpoint is called
- THEN it MUST return `400`, `403`, or deny the replay without exposing it
