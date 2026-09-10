# Collections BETA Acceptance Specification

## Purpose

Define the exclusive terminal evidence required to declare the Collections module complete.

## Requirements

### Requirement: QA-001 Live BETA Acceptance Gate

The Collections module MUST remain incomplete until QA-001 is exercised against live BETA enrollment and effective pricing facts through bounded assessment, obligation creation, full-outstanding payment, CashDesk tender evidence, exact reversal, separate treatments, and condonation approval behavior, and an accepting user explicitly signs off on the resulting workflow evidence. Automated checks and generated artifacts MAY support but MUST NOT replace this live acceptance.

#### Scenario: QA-001 passes the complete live workflow

- GIVEN QA-001 has its live Natación enrollment and applicable BASE and NATACION pricing
- WHEN the complete BETA workflow is executed
- THEN the expected bounded and prorated obligations MUST be created without duplicates
- AND selected obligations MUST be paid in full with one supported tender and matching Treasury evidence
- AND exact reversal and separate treatment and approval behavior MUST be demonstrated
- AND an accepting user MUST explicitly sign off before Collections is marked complete

#### Scenario: Any live acceptance step fails

- GIVEN implementation artifacts or automated checks are complete
- WHEN QA-001 fails a required live workflow step or user sign-off is absent
- THEN Collections MUST remain incomplete
- AND the failed evidence MUST be retained without substituting nominal completion

### Requirement: Exclusive Collections P0 Terminal Gate

QA-001 acceptance MUST be the exclusive P0 terminal gate: no other product module MAY proceed under this delivery sequence until the live acceptance and user sign-off are recorded.

#### Scenario: P0 remains blocked

- GIVEN QA-001 acceptance or user sign-off is outstanding
- WHEN work is considered for another module
- THEN that work MUST remain blocked by the Collections P0 gate

#### Scenario: P0 is released

- GIVEN every QA-001 live criterion has passed
- AND the accepting user has explicitly signed off
- WHEN terminal gate status is evaluated
- THEN the Collections P0 gate MUST be released
