# Delta for Audit Logger

## ADDED Requirements

### Requirement: Financial Lifecycle Audit Evidence

The system MUST append an audit event for authorized pricing, generation, benefit, agreement, settlement, allocation, reversal, cash, close, discrepancy, compensation, expense-protection, and projection commands. Each event MUST include actor, time, action, entity, reason when applicable, authorization evidence, idempotency identity, and the relevant configuration or calculation snapshot. Audit query responses MUST minimize family, debt, agreement, and community-work evidence according to caller privilege.

#### Scenario: Assessed obligation is auditable

- GIVEN an authorized monthly assessment completes
- WHEN its audit event is queried by an authorized reviewer
- THEN it MUST identify the actor, period, pricing snapshot, authorization evidence, and idempotency identity

#### Scenario: Unauthorized audit query is minimized

- GIVEN a caller lacks financial-evidence privilege
- WHEN the caller requests agreement or community-work audit data
- THEN the system MUST deny access or return no sensitive evidence
