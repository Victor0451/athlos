# Dues Pricing Assessment Specification

## Purpose

Define native, versioned dues assessment. This is the **first implementation slice**.

## Requirements

### Requirement: Effective-Dated Dues Pricing

The system MUST maintain authorized, effective-dated base fees and additive sport fees. A pricing rule MUST identify its effective interval and assessment rule: `full-month`, `daily-prorated`, or `next-period`. Overlapping active rules for the same price dimension and date MUST be rejected. Pricing changes MUST NOT alter historical obligations.

#### Scenario: Active sport adds to the base fee

- GIVEN a member eligible for a base fee and two active sport enrollments
- WHEN the monthly assessment is calculated
- THEN the assessment MUST include the applicable base fee plus both sport fees

#### Scenario: Mid-period eligibility uses configured rule

- GIVEN a sport enrollment starts during a period
- WHEN its applicable pricing rule is `daily-prorated`
- THEN the assessment MUST charge only the eligible days

### Requirement: Immutable Native Obligations

The system MUST create native obligations as the debt source of truth, independent of `ctacte`. Each obligation MUST snapshot prices, eligibility, benefits, configuration, calculation inputs, actor, time, and authorization evidence. Obligations MUST NOT be deleted or recomputed; corrections MUST use an authorized compensating record with a reason.

#### Scenario: Later pricing does not alter history

- GIVEN an obligation generated under a prior fee version
- WHEN an operator changes the current fee
- THEN the existing obligation MUST retain its original snapshot and amount

### Requirement: Idempotent Period Generation

The system MUST authorize and idempotently generate at most one assessment result per member, obligation type, and period. A repeated generation request MUST return the prior result without duplicate debt or audit evidence. Generation MUST NOT create late fees automatically.

#### Scenario: Retried monthly generation

- GIVEN a period was successfully generated for an eligible member
- WHEN the same generation command is retried
- THEN exactly one native obligation MUST exist for that identity
