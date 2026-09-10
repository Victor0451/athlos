# Member Benefits Agreements Specification

## Purpose

Define benefits and debt agreements. This is a subsequent slice, not part of the first slice.

## Requirements

### Requirement: Effective-Dated Benefits

The system MUST authorize and version discounts, scholarships, and family-group rules with effective dates and eligibility evidence. A resulting assessment MUST snapshot the applied benefit without exposing unnecessary family or financial evidence to unauthorized users.

#### Scenario: Scholarship applies during its interval

- GIVEN an eligible member has an active 50 percent scholarship
- WHEN an assessment period falls within its effective interval
- THEN the obligation snapshot MUST record and apply the scholarship

#### Scenario: Expired benefit is excluded

- GIVEN a discount expired before the assessment period
- WHEN the period is generated
- THEN the discount MUST NOT reduce the obligation

### Requirement: Audited Agreements and Rescheduling

The system MUST support simple arrangements and formal installment plans with authorized terms, status, and audit evidence. Rescheduling MUST preserve the original agreement and create an authorized, reasoned revision; it MUST NOT rewrite historical terms.

#### Scenario: Formal plan is rescheduled

- GIVEN an active installment plan
- WHEN an authorized operator reschedules it with a reason
- THEN the original plan MUST remain auditable and the revision MUST contain new terms

### Requirement: Bounded Agreement Terms and Native Obligation Link

Every agreement MUST reference one native obligation owned by the agreement socio. The agreed amount MUST be an integer number of cents from 1 through the obligation's outstanding debt at creation or revision. Terms MUST contain 1 through 60 installments; each installment MUST contain an integer cent amount and a date-only `YYYY-MM-DD` due date. Due dates MUST be valid, unique, strictly increasing, and not earlier than the agreement date. Installment amounts MUST sum exactly to the agreed amount.

#### Scenario: Valid installment schedule is accepted

- GIVEN an authorized operator has an obligation with sufficient outstanding debt
- WHEN the operator creates an agreement with a native obligation reference and a bounded schedule
- THEN the agreement MUST persist the obligation identity and the exact schedule

#### Scenario: Invalid schedule is rejected

- GIVEN an agreement schedule has an invalid date, duplicate/out-of-order dates, an out-of-range installment count, or a mismatched amount sum
- WHEN the operator submits the agreement
- THEN the command MUST be rejected without persisting an agreement

#### Scenario: Rescheduling preserves native debt history

- GIVEN an active agreement linked to a native obligation
- WHEN an authorized operator reschedules it
- THEN the active agreement MUST be atomically superseded and exactly one successor MUST remain active
- AND the obligation identity and append-only debt/allocation history MUST remain unchanged
