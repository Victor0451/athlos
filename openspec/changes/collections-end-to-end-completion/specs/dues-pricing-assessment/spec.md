# Delta for Dues Pricing Assessment

## ADDED Requirements

### Requirement: Read-Only Bounded Assessment Range Preview

The system MUST provide an authorized operator a read-only preview of an explicit assessment range before any obligation mutation. The requested start MUST NOT be after the inclusive through-period, and the through-period MUST NOT be in the future. For each base and sport component, lifecycle eligibility MUST use the half-open interval `[alta, baja)`: the alta date is eligible, the baja date is not, and equal alta and baja dates yield zero eligible days. Preview MUST itemize every requested period, source price and currency, lifecycle bounds, eligible days, calendar-day denominator, proration calculation, rounding result, existing-obligation status, and amount that would be created.

For each eligible component-period, effective-date selection MUST occur before billing-label handling and exactly one price MUST apply. Lifecycle boundaries MUST override legacy billing labels: a boundary month MUST be daily-prorated even when the price is labelled `FULL_MONTH`; a fully eligible month MUST charge the full unit price. An effective legacy `NEXT_PERIOD` price anywhere in the requested eligible range MUST block preview as a pricing conflict rather than postpone accrual from alta. Missing or overlapping/ambiguous applicable prices MUST block the entire preview as exact issues requiring price correction. An explicit zero price MUST remain distinguishable as a valid zero amount.

A component-period MAY contain successive non-overlapping price versions. The system MUST intersect lifecycle eligibility `[alta,baja)` with each price effective interval and partition the result into price segments. Every eligible day MUST be covered by exactly one price; any gap or overlap MUST block the whole requested range rather than being guessed or silently repaired. For each segment, the integer numerator MUST be `unitAmountCents * eligibleDaysInSegment`; all segment numerators MUST be summed using the component-period's actual calendar-day denominator before one nearest-cent rounding with exact halves rounded up. Segment amounts MUST NOT be rounded independently, and every segment's price version, interval, eligible days, unit amount, rule, numerator, aggregate numerator, denominator, remainder, and result MUST be snapshotted. QA-001 uncovered sport days MUST block as uncovered pricing days and MUST never be silently backcharged to an earlier or later price. No range mutation MAY proceed unless one complete, conflict-free preview covers the whole requested range.

#### Scenario: Mid-month altas use half-open lifecycle eligibility

- GIVEN a member alta or sport alta occurs during a requested month
- AND exactly one applicable non-`NEXT_PERIOD` price exists
- WHEN the operator previews the range
- THEN the alta date MUST count as the first eligible day
- AND the component amount MUST use eligible days divided by the actual days in that month
- AND the preview MUST not mutate obligations

#### Scenario: Sport baja is excluded

- GIVEN a sport baja occurs during a requested month
- WHEN the operator previews the range
- THEN the day before baja MUST be the final eligible day
- AND the baja date and every later date MUST contribute zero sport accrual

#### Scenario: Same-day lifecycle has zero eligible days

- GIVEN a member or sport has the same alta and baja date
- WHEN a range containing that date is previewed
- THEN that lifecycle interval MUST contain zero eligible days
- AND no positive amount or obligation MUST be proposed for it

#### Scenario: Inverted requested range is rejected

- GIVEN the requested range start is after its inclusive through-period
- WHEN preview is requested
- THEN the request MUST be rejected as an invalid range without mutation

#### Scenario: Full eligible month charges full price

- GIVEN a component is eligible for every calendar day of a month
- AND exactly one applicable non-`NEXT_PERIOD` unit price exists
- WHEN that month is previewed
- THEN the amount MUST equal the full unit monthly price without proration

#### Scenario: Boundary proration overrides FULL_MONTH label

- GIVEN a `FULL_MONTH` price applies during a month with a member or sport lifecycle boundary
- WHEN that month is previewed
- THEN the component MUST be daily-prorated for only its eligible days
- AND the label MUST NOT cause a full-month boundary charge

#### Scenario: NEXT_PERIOD conflicts with accrual from alta

- GIVEN an effective legacy `NEXT_PERIOD` price applies to an eligible day in the requested range
- WHEN preview is requested
- THEN the entire preview MUST be blocked with the exact conflicting price and period
- AND accrual MUST NOT be postponed or silently recalculated under another rule

#### Scenario: Missing or ambiguous price blocks the entire preview

- GIVEN any eligible component-day has no applicable price or more than one applicable price
- WHEN the operator previews a multi-period range
- THEN the entire preview MUST be non-executable
- AND every missing or ambiguous price issue MUST identify its component and affected period
- AND no partial subrange MUST be offered for execution

#### Scenario: Explicit zero price remains valid

- GIVEN exactly one applicable price is explicitly zero
- WHEN its eligible period is previewed
- THEN the component MUST appear as an explicit zero amount rather than missing
- AND it MUST NOT be treated as a positive obligation or a pricing conflict

#### Scenario: Calendar denominator and half-up rounding are exact

- GIVEN a partial month produces an unrounded amount exactly halfway between two cents
- WHEN the amount is previewed
- THEN the denominator MUST equal the actual calendar days in that month
- AND the amount MUST round to the higher cent

#### Scenario: Successive price versions share one component-period denominator

- GIVEN successive non-overlapping price versions cover different eligible intervals in one component-period
- WHEN the component is previewed
- THEN lifecycle eligibility MUST be intersected with each effective interval
- AND each eligible day MUST belong to exactly one price segment
- AND integer segment numerators MUST be summed before one nearest-cent exact-half-up rounding
- AND every segment MUST be included in the immutable preview snapshot

#### Scenario: QA-001 uncovered sport days are not backcharged

- GIVEN QA-001 has eligible sport days before the authoritative NATACION price begins
- AND those days have no applicable price version
- WHEN the range is previewed
- THEN the whole preview MUST be blocked with the uncovered interval
- AND those days MUST NOT be silently charged under another price version

#### Scenario: Existing periods are excluded from pending creation

- GIVEN some periods in the requested range already have obligations
- WHEN the operator previews a valid range
- THEN those periods MUST be identified as already generated and excluded from pending creation

#### Scenario: Future cutoff is rejected

- GIVEN the requested through-period is in the future
- WHEN the operator requests a preview
- THEN the request MUST be rejected without mutation

## MODIFIED Requirements

### Requirement: Idempotent Monthly Generation

The system MUST allow only ADMIN or TESORERO to execute a previously reviewed, complete assessment range through an inclusive, non-future cutoff using a stable idempotency key. Execution MUST reproduce the preview's explicit range, `[alta, baja)` lifecycle eligibility, successive non-overlapping effective-price segments, exactly-one-price coverage, actual calendar-day denominator shared by all segments in a component-period, aggregate integer numerators, one nearest-cent exact-half-up rounding, daily boundary proration, full-price fully eligible months, and immutable segment snapshots. It MUST create only missing obligations and distinguish created, replayed, zero-obligation, conflict, error, and success results. Equivalent retries MUST return the original result without duplicates. Missing, uncovered, or ambiguous prices, an effective `NEXT_PERIOD` conflict, conflicting reviewed facts, or any validation or persistence failure MUST reject the entire range without creating any obligation from that execution.

(Previously: Authorized operators generated one selected period idempotently, without a bounded range, preview parity, fixed lifecycle interval, exact denominator and rounding, pricing-conflict precedence, or entire-range atomicity.)

#### Scenario: Ambiguous retry

- GIVEN range generation timed out after submission
- WHEN the operator retries with the original idempotency key and equivalent input
- THEN the original created or replayed result MUST be returned
- AND no obligation MUST be duplicated

#### Scenario: Inclusive cutoff creates only missing periods

- GIVEN a reviewed range contains both already-generated and missing applicable periods
- WHEN an authorized operator executes through the requested current-period cutoff
- THEN every missing applicable period through and including the cutoff MUST be created once
- AND already-generated periods MUST remain unchanged

#### Scenario: Boundary and full months match preview math

- GIVEN a reviewed range contains lifecycle boundary months and fully eligible months
- WHEN missing obligations are generated
- THEN boundary months MUST use `[alta, baja)` eligible days over actual calendar days with exact-half-up cent rounding
- AND fully eligible months MUST charge their full unit prices
- AND every amount MUST equal the reviewed preview

#### Scenario: Invalid pricing blocks all range creation

- GIVEN any eligible part of a reviewed range has a missing or ambiguous price or an effective `NEXT_PERIOD` price
- WHEN execution is attempted
- THEN no obligation from the range MUST be created
- AND the exact pricing issues MUST require correction and a fresh preview

#### Scenario: Concurrent reviewed fact change blocks all range creation

- GIVEN an operator reviewed a complete range
- AND enrollment, lifecycle, pricing, existing-obligation, or other reviewed facts change concurrently
- WHEN the stale range is executed
- THEN the entire execution MUST be rejected as a conflict
- AND the conflict MUST identify the reviewed facts that changed
- AND no obligation from that execution MUST be created
- AND a fresh complete preview MUST be required

#### Scenario: Range persistence failure is atomic

- GIVEN a valid reviewed range contains multiple missing obligations
- WHEN persistence fails after execution begins
- THEN none of those obligations MUST remain created
- AND retry MUST use the original idempotency semantics rather than a partial range
