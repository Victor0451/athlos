# Delta for Auth Login

## ADDED Requirements

### Requirement: Controlled Initial Administrator Bootstrap

The system SHALL bootstrap an administrator only when no operator is recoverable and after explicit operational approval. It MUST audit eligibility, approval, and outcome; credentials MUST NOT be persisted, displayed, or evidenced.

#### Scenario: Recoverable operator exists
- GIVEN an operator can be recovered and verified
- WHEN bootstrap is requested
- THEN it MUST refuse and record the reason without credentials

#### Scenario: Approved zero-operator bootstrap
- GIVEN no recoverable operator and explicit execution approval
- WHEN bootstrap runs in an authorized operation
- THEN it MUST create one administrator and record redacted audit evidence

### Requirement: Recovery Login Validation

The system SHALL validate synthetic invalid credentials directly and through the proxy as `401`; valid login validation MUST follow verified recovery/bootstrap.

#### Scenario: Invalid synthetic login
- GIVEN API and proxy are reachable
- WHEN invalid credentials are submitted by both paths
- THEN each response MUST be `401` without credential disclosure
