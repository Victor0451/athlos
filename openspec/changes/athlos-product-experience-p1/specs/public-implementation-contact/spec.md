# Public Implementation Contact Specification

## Purpose

Provide a privacy-preserving public implementation inquiry flow without exposing club or member data.

## Requirements

### Requirement: Public Inquiry Form

The public landing MUST identify Athlos as a club-management product and Club Atlético Gorriti as its current edition. It MUST expose an embedded contact form with required `name`, `organization`, `role`, `email`, and `primaryProblem`; `phone` and `message` MAY be optional. The landing MUST offer operator login as a secondary CTA and MUST NOT render private club, member, operator, financial, or operational data.

#### Scenario: Valid inquiry fields are visible
- GIVEN an unauthenticated visitor opens `/`
- WHEN the contact CTA is activated
- THEN the embedded form SHALL show exactly the approved fields and a privacy notice

#### Scenario: Public data boundary
- GIVEN a visitor inspects the landing response
- WHEN no authenticated session exists
- THEN no private club or operator data SHALL be present in its rendered content or API response

### Requirement: Validated and Abuse-Resistant Submission

The public submission endpoint MUST accept only the approved fields plus a hidden honeypot. It MUST enforce server-side requiredness, email syntax, request-body limits, newline-safe text, and a declared numeric maximum for every textual field; an endpoint lacking any maximum MUST not be released. A non-empty honeypot MUST receive the same generic outcome without delivery. The endpoint MUST use a dedicated per-IP limit stricter than the general unauthenticated limit, return 429 with `Retry-After` when exceeded, and enforce an allowed Origin as the CSRF control for this credential-free route; absent Origin is permitted only for same-origin browser submission. It MUST NOT accept credentials or authenticate this route.

#### Scenario: Invalid data is rejected
- GIVEN a required value is missing or exceeds its configured limit
- WHEN the visitor submits the form
- THEN the API SHALL return field-level validation errors without attempting delivery

#### Scenario: Abuse attempt is contained
- GIVEN an origin is disallowed, the honeypot is filled, or the IP limit is exceeded
- WHEN the endpoint receives a submission
- THEN it SHALL not deliver the message or disclose the rejection reason to the visitor

### Requirement: Privacy and Truthful Outcomes

The endpoint MUST send only to a server-configured recipient, MUST NOT accept a recipient from the client, and MUST NOT persist inquiry content in Athlos's application or database. Logs and audit data MUST exclude message content, email address, phone, and SMTP credentials. The privacy notice MUST state both that Athlos does not persist the submission in its application or database and that the submitted inquiry remains in the recipient mailbox until manually deleted. Responses MUST be generic, but MUST report success only after SMTP transport acknowledgement; timeout or failed acknowledgement MUST return a generic failure outcome and MUST NOT claim receipt.

#### Scenario: Privacy retention is disclosed accurately
- GIVEN an unauthenticated visitor views the inquiry form
- WHEN the privacy notice is rendered
- THEN it SHALL state that Athlos does not persist inquiry content in its application or database
- AND it SHALL state that the recipient mailbox retains the inquiry until manually deleted

#### Scenario: SMTP acknowledgement succeeds
- GIVEN a valid inquiry and configured recipient
- WHEN the SMTP transport acknowledges acceptance before its timeout
- THEN the API SHALL return a generic success outcome and no inquiry record SHALL be stored

#### Scenario: SMTP fails or times out
- GIVEN SMTP rejects, errors, or exceeds the configured timeout
- WHEN a valid inquiry is submitted
- THEN the API SHALL return a generic retry-oriented failure outcome and redacted diagnostics only
