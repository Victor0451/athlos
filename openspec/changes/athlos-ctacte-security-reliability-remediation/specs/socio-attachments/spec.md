# Delta for Socio Attachments

## ADDED Requirements

### Requirement: Payment Comprobante Attachment Compensation and Provenance

A payment comprobante attachment MUST preserve provenance linking the payment, attachment, caller key, and creating actor. If attachment persistence or its required provenance cannot complete, the system MUST compensate so no orphaned file, row, or completed payment state remains. Compensation MUST be safe to retry.

#### Scenario: Attachment completes with provenance
- GIVEN a payment includes a valid comprobante attachment
- WHEN the payment succeeds
- THEN the attachment and provenance MUST identify the payment, caller key, and actor

#### Scenario: Attachment persistence fails
- GIVEN the financial mutation has not completed and attachment persistence fails
- WHEN compensation executes
- THEN no orphaned attachment state MAY remain and the payment MUST not complete
