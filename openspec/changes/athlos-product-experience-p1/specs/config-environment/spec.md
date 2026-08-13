# Delta for Config/Environment

## ADDED Requirements

### Requirement: Implementation Contact Recipient Configuration

The system MUST define `IMPLEMENTATION_CONTACT_RECIPIENT` as a required, server-only startup variable. The recipient MUST be a syntactically valid single mailbox, MUST be redacted from diagnostics where contact-address privacy policy requires it, and MUST NOT be supplied, overridden, or inferred from a browser request. Missing or invalid recipient configuration in a non-test environment MUST halt startup before the public route accepts traffic.

#### Scenario: Configured recipient is used
- GIVEN valid SMTP configuration and a valid configured contact recipient
- WHEN a valid public inquiry is accepted for delivery
- THEN the email SHALL target only that configured recipient

#### Scenario: Missing recipient blocks startup
- GIVEN a non-test environment lacks a valid configured contact recipient
- WHEN the application starts
- THEN startup SHALL fail before the contact endpoint becomes available
