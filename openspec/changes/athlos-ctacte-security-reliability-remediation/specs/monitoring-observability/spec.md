# Delta for Monitoring & Observability

## ADDED Requirements

### Requirement: Comprobante Render Failure Visibility

The system MUST bound CTACTE comprobante rendering to 30 seconds. A timeout MUST persist a failed render state with request correlation and actor identity, expose the failure to operators, and cause retry to return `504 RENDER_TIMEOUT`; it MUST NOT leave work indefinitely pending.

#### Scenario: Timely render
- GIVEN an authorized actor requests a comprobante
- WHEN rendering completes within 30 seconds
- THEN the completed state and result MUST be observable

#### Scenario: Timed-out render
- GIVEN rendering exceeds 30 seconds
- WHEN the limit elapses and the actor retries
- THEN failed state MUST be visible and the retry MUST return `504 RENDER_TIMEOUT`
