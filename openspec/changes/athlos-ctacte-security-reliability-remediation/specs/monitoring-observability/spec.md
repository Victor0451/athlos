# Delta for Monitoring & Observability

## ADDED Requirements

### Requirement: Comprobante Render Failure Visibility

The system MUST bound CTACTE comprobante rendering to 30 seconds. A timeout MUST persist a failed render state with request correlation and actor identity, emit a structured log containing `event: "ctacte_comprobante_render_failed"`, `error_code: "RENDER_TIMEOUT"`, `request_id`, and `actor_id`, increment the `ctacte_comprobante_render_timeout_total` metric, and cause retry to return `504 RENDER_TIMEOUT`; it MUST NOT leave work indefinitely pending.

#### Scenario: Timely render
- GIVEN an authorized actor requests a comprobante
- WHEN rendering completes within 30 seconds
- THEN the completed state and result MUST be observable

#### Scenario: Timed-out render
- GIVEN rendering exceeds 30 seconds
- WHEN the limit elapses and the actor retries
- THEN failed state MUST be visible through the structured `RENDER_TIMEOUT` log and `ctacte_comprobante_render_timeout_total` metric, and the retry MUST return `504 RENDER_TIMEOUT`
