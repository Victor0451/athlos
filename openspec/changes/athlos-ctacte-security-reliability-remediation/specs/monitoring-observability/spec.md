# Delta for Monitoring & Observability

## ADDED Requirements

### Requirement: Comprobante Render Failure Visibility

The system MUST make live 30-second comprobante deadline outcomes observable without exposing payloads or creating high-cardinality Prometheus labels. An owner timeout MUST emit a structured log containing `event: "ctacte_comprobante_render_failed"`, `error_code: "RENDER_TIMEOUT"`, `request_id`, `actor_id`, and a bounded owner/follower role field. A follower wait timeout MUST emit a distinguishable structured timeout log with the same correlation fields and MUST NOT report that the owner's render failed. Ordinary renderer failures MUST be logged as non-timeout failures and MUST NOT use `error_code: "RENDER_TIMEOUT"`.

The counter `ctacte_comprobante_render_timeout_total` MUST increment exactly once when a live owner or follower request first reaches its 30-second deadline and returns `504`. Replaying an already persisted terminal timeout MUST NOT increment it again. The counter MUST have no labels; in particular, `request_id`, `actor_id`, caller key, payload identity, and socio identifiers MUST NOT be metric labels.

#### Scenario: Timely render

- GIVEN an authorized actor requests a comprobante
- WHEN rendering completes within 30 seconds
- THEN the completed state and result MUST be observable
- AND the timeout counter MUST NOT increment

#### Scenario: Owner render times out

- GIVEN an owner render exceeds 30 seconds
- WHEN the owner deadline transition succeeds
- THEN one structured owner failure log MUST contain `event`, `error_code`, `request_id`, `actor_id`, and the bounded role field
- AND `ctacte_comprobante_render_timeout_total` MUST increment once

#### Scenario: Follower wait times out

- GIVEN a follower waits 30 seconds while another healthy owner retains the lease
- WHEN the follower returns `504 RENDER_TIMEOUT`
- THEN a structured follower-wait timeout log MUST carry the request and actor correlation fields
- AND `ctacte_comprobante_render_timeout_total` MUST increment once
- AND observability MUST NOT indicate that the healthy owner's render failed

#### Scenario: Terminal timeout is replayed

- GIVEN a stored timeout failure has already been observed and counted
- WHEN the same actor replays it and receives `504 RENDER_TIMEOUT`
- THEN the replay MUST remain correlatable by its current `request_id`
- AND the timeout counter MUST NOT increment again

#### Scenario: Ordinary renderer failure

- GIVEN rendering fails before the deadline for a non-timeout reason
- WHEN the failure is logged and returned through the redacted 5xx contract
- THEN its structured log MUST distinguish it from `RENDER_TIMEOUT`
- AND `ctacte_comprobante_render_timeout_total` MUST NOT increment
