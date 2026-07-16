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

Every `504` MUST use the standard `ApiError` envelope, including `error: "RENDER_TIMEOUT"`, a human-readable `message`, and `request_id`.
(Previously: the status-code contract had no `504` render-timeout outcome.)

#### Scenario: Comprobante deadline response

- GIVEN a comprobante request reaches its 30-second owner or follower deadline
- WHEN the API returns the timeout response
- THEN the status MUST be `504`
- AND the body MUST conform to `ApiError` with `error: "RENDER_TIMEOUT"` and the current `request_id`

## ADDED Requirements

### Requirement: CTACTE Mutation and Comprobante Contracts

Payment, debit, and note mutations MUST accept only uniformly validated UUID identifiers and caller keys; malformed values MUST return `400 VALIDATION_ERROR`. The comprobante endpoint MUST require `can_reprint`; replays MUST remain bound to the originating actor and canonical payload. Same-actor completed replay, cross-actor conflict, payload conflict, and stale-owner takeover semantics MUST remain intact.

#### Scenario: Authorized valid request

- GIVEN an eligible actor supplies valid UUIDs and a new caller key
- WHEN a mutation or owned comprobante replay is requested
- THEN the endpoint MUST process it under its contract

#### Scenario: Invalid or unauthorized request

- GIVEN an invalid UUID/key, missing `can_reprint`, or another actor's replay
- WHEN the endpoint is called
- THEN it MUST return `400`, `403`, or `409` as applicable without exposing another actor's result

#### Scenario: Existing replay outcomes remain intact

- GIVEN a completed same-actor result, a different actor, a different canonical payload, or a stale active lease
- WHEN the same caller key is submitted
- THEN the same actor with the same payload MUST receive the completed result
- AND a different actor or payload MUST receive `409`
- AND a stale lease MUST remain eligible for takeover under the existing lease contract

### Requirement: Comprobante Failure Classification and Replay

The system MUST persist a comprobante failure reason that distinguishes terminal render timeout from an ordinary renderer failure. `RENDER_TIMEOUT` MUST identify a terminal timeout; an absent reason MUST identify no terminal timeout reason. An ordinary renderer failure MUST NOT be classified as `RENDER_TIMEOUT`, MUST remain eligible for the existing reclaim or retry semantics, and MUST propagate through the global redacted 5xx contract. A stored `RENDER_TIMEOUT` failure MUST be terminal for the same actor, caller key, and canonical payload and MUST replay as `504` using the standard `ApiError` envelope.

#### Scenario: Owner reaches its render deadline

- GIVEN an actor owns an active comprobante lease and rendering has not completed within 30 seconds
- WHEN the owner deadline elapses
- THEN the system MUST transition the still-active, still-owned lease to `failed` with reason `RENDER_TIMEOUT`
- AND the request MUST return `504` with `error: "RENDER_TIMEOUT"` and its `request_id`
- AND a completion arriving after that transition MUST NOT publish or replace a successful result

#### Scenario: Timeout failure is replayed

- GIVEN a comprobante is stored as `failed` with reason `RENDER_TIMEOUT`
- WHEN the same actor retries the same caller key and canonical payload
- THEN the system MUST NOT reclaim or rerender that comprobante
- AND it MUST return `504` with the standard `ApiError` envelope, `error: "RENDER_TIMEOUT"`, and the retry request's `request_id`

#### Scenario: Ordinary renderer failure remains reclaimable

- GIVEN rendering fails for a reason other than the 30-second deadline
- WHEN the failure is recorded or propagated
- THEN the persisted failure reason MUST remain absent rather than `RENDER_TIMEOUT`
- AND the current request MUST receive a globally redacted 5xx response
- AND a later eligible request MUST retain the existing reclaim or retry behavior

#### Scenario: Follower request reaches its wait deadline

- GIVEN another healthy owner still holds the active lease
- WHEN a follower has waited 30 seconds for that owner
- THEN the follower request MUST return `504` with `error: "RENDER_TIMEOUT"` and its `request_id`
- AND it MUST NOT change the owner's lease status, ownership, deadline, result, or failure reason

#### Scenario: Unexpected route failure

- GIVEN comprobante processing raises an unexpected non-contract failure
- WHEN the route handles the failure
- THEN it MUST propagate the failure to the global redacted 5xx handler
- AND it MUST NOT convert the failure to `400 VALIDATION_ERROR` or expose internal error details
