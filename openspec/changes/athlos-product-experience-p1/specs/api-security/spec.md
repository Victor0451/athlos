# Delta for API Security

## ADDED Requirements

### Requirement: Public Contact Route Boundary

The implementation-contact route MUST be explicitly unauthenticated, accept only POST and its documented request shape, and use the configured CORS allowlist without wildcard credentials. It MUST enforce a dedicated per-IP submission limit and body/field limits, reject or neutralize honeypot and origin-policy failures without delivery, and return generic external responses. Security telemetry MAY record outcome, route, timestamp, and rate-limit metadata but MUST redact submitted personal/contact/message values and SMTP configuration.

#### Scenario: Cross-origin attack cannot submit
- GIVEN an Origin outside `CORS_ORIGINS`
- WHEN it POSTs an otherwise valid inquiry
- THEN no message SHALL be delivered and no permissive CORS response SHALL be returned

#### Scenario: Sensitive values are redacted
- GIVEN a contact attempt fails delivery
- WHEN telemetry is inspected
- THEN inquiry text, email, phone, and SMTP secrets SHALL not be present

### Requirement: Club Status RBAC Boundary

The club-status endpoint MUST require a valid JWT and enforce role projection on the server before serialization. A client-supplied role, hidden UI, query parameter, or stale frontend state MUST NOT expand the returned field set. A denied request MUST return the existing authorization semantics and MUST NOT disclose status data.

#### Scenario: Role escalation is ineffective
- GIVEN a CONSULTA token submits `role=ADMIN` in any request field
- WHEN club status is requested
- THEN the response SHALL contain only CONSULTA-authorized fields
