# Delta for Audit Logger

## ADDED Requirements

### Requirement: Condonation Request and Decision Audit Completeness

The system MUST append immutable audit evidence for each condonation request and each explicit Treasury decision. The evidence MUST identify the authenticated requester, authenticated approver when a decision exists, requester/approver separation, decision, reason, supporting evidence, scoped token or request identity, and the selected-obligation snapshot including obligation identities, currencies, and full outstanding balances. Request and rejection records MUST state that no financial execution occurred.

#### Scenario: Request audit captures selected-obligation snapshot

- GIVEN an authenticated `OPERADOR` creates an eligible condonation request
- WHEN request creation succeeds
- THEN immutable audit evidence MUST identify the requester and scoped request
- AND it MUST preserve every selected obligation identity, currency, and reviewed full outstanding balance
- AND it MUST record the submitted reason and supporting evidence
- AND it MUST record that no financial execution occurred

#### Scenario: Rejection audit identifies both actors and inert outcome

- GIVEN an authenticated Treasury approver who is not the requester rejects a pending condonation request
- WHEN rejection commits
- THEN immutable audit evidence MUST identify the requester, approver, explicit rejection, decision reason, supporting evidence, and selected-obligation snapshot
- AND it MUST record that debt and financial ledgers were unchanged

#### Scenario: Unauthorized or invalid decision is not audited as approved

- GIVEN a decision is denied because the actor, token lifecycle, scope, or requester/approver separation is invalid
- WHEN the denial is recorded
- THEN no audit fact MUST claim approval or successful financial execution
- AND any denial evidence MUST describe the actual non-executed outcome

### Requirement: Condonation Execution and Recovery Audit

The system MUST append immutable audit evidence for every approved condonation execution attempt and its terminal outcome. The evidence MUST link the request, authenticated requester, authenticated approver, approval decision, decision reason and evidence, selected-obligation snapshot, current-balance revalidation outcome, execution identity, and whether execution committed, was rejected as stale, failed without financial effect, replayed an existing outcome, or recovered. A committed condonation and its successful execution audit MUST be atomic. Recovery or replay MUST preserve one execution lineage and MUST NOT create a second successful execution fact.

#### Scenario: Approved execution is completely auditable

- GIVEN an approved condonation passes selected-balance revalidation
- WHEN all selected full installments are atomically condoned
- THEN one successful execution audit lineage MUST identify requester, approver, approval, reason and evidence, selected snapshot, revalidation, execution identity, and committed outcome
- AND the successful audit fact and financial effect MUST commit together

#### Scenario: Stale approved request records no financial effect

- GIVEN an approved request fails current-balance revalidation
- WHEN execution is rejected as stale
- THEN immutable audit evidence MUST identify the changed or conflicting selected obligation and non-executed outcome
- AND no audit fact MUST claim a successful condonation

#### Scenario: Failed execution records recoverable outcome

- GIVEN an approved request passes authorization but execution fails before commit
- WHEN the failure outcome is recorded
- THEN audit evidence MUST identify the execution identity, failure outcome, and absence of partial financial effect
- AND recovery MUST remain linked to that same execution identity

#### Scenario: Recovery commits exactly one success fact

- GIVEN an approved execution previously failed without financial effect
- WHEN recovery later commits the condonation
- THEN the audit lineage MUST link the recovery to the original request, decision, and execution identity
- AND exactly one successful execution fact MUST exist
- AND the prior failed outcome MUST remain immutable

#### Scenario: Replay does not duplicate successful audit evidence

- GIVEN a condonation execution already committed successfully
- WHEN the approval or recovery request is replayed or submitted concurrently
- THEN the existing committed execution outcome MUST be returned or an already-executed conflict MUST be reported
- AND no duplicate successful execution audit fact MUST be appended
