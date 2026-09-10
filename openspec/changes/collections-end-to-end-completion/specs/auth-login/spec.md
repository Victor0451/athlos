# Delta for Auth Login

## ADDED Requirements

### Requirement: Authorized Scoped Condonation Request

The system MUST allow only an authenticated `OPERADOR` to request condonation through the existing `approval_tokens` capability. Each token MUST be scoped to one condonation request and its selected-obligation snapshot, MUST identify the authenticated requester, MUST expire, and MUST be single-use for exactly one explicit approval or rejection decision. Request authorization or token creation MUST NOT itself produce a financial effect.

#### Scenario: Authenticated operator creates a scoped request

- GIVEN an authenticated `OPERADOR` submits a financially eligible selected-obligation snapshot
- WHEN request authorization succeeds
- THEN exactly one pending condonation token MUST be scoped to that request and snapshot
- AND the token MUST identify the authenticated requester and its expiry
- AND no debt, settlement, allocation, condonation, or CashDesk fact MUST change

#### Scenario: Unauthorized requester is denied

- GIVEN a caller is unauthenticated or lacks the `OPERADOR` request authority
- WHEN the caller attempts to create a condonation request
- THEN authorization MUST be denied without a token or financial effect

### Requirement: Authenticated Treasury Condonation Decision Authorization

The system MUST allow only an authenticated Treasury approver who is not the request's requester to explicitly approve or reject a pending condonation token. The decision MUST identify the authenticated approver. Expired, used, out-of-scope, or concurrently decided tokens MUST NOT authorize execution, and no decision MAY be inferred from token access or consumption.

#### Scenario: Treasury approver explicitly approves

- GIVEN a pending unexpired condonation token
- AND an authenticated Treasury approver is not its requester
- WHEN the approver explicitly chooses approval
- THEN the token MUST authorize only that scoped approval decision
- AND the decision MUST identify the authenticated approver

#### Scenario: Treasury approver explicitly rejects

- GIVEN a pending unexpired condonation token
- AND an authenticated Treasury approver is not its requester
- WHEN the approver explicitly chooses rejection
- THEN the token MUST be consumed as rejected for that scoped request
- AND no approval or financial execution MUST be inferred

#### Scenario: Requester cannot approve own request

- GIVEN the authenticated decision actor is the condonation requester
- WHEN that actor attempts to approve or reject the token
- THEN the decision MUST be denied
- AND the token MUST remain pending unless it independently expires or is decided by an eligible approver

#### Scenario: Invalid token lifecycle cannot authorize execution

- GIVEN a condonation token is expired, already used, scoped to another request, or concurrently decided
- WHEN a decision is submitted
- THEN the token MUST NOT authorize a new decision or financial execution
- AND a prior committed decision MUST NOT be duplicated or changed
