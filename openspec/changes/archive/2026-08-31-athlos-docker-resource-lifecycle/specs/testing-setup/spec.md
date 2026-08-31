# Delta for Testing Setup

## ADDED Requirements

### Requirement: Resource-Neutral Disposable PostgreSQL Execution

Supported recovery, test, and CI entry points MUST resolve the repository root independently of caller cwd, forward focused Vitest arguments unchanged, use the disposable PostgreSQL lifecycle, and leave the label-scoped Docker resource inventory equal to its pre-run baseline after teardown.

#### Scenario: Non-root focused invocation

- GIVEN a supported command starts outside the repository root with a focused Vitest selector
- WHEN the command runs
- THEN repository operations MUST use the resolved root
- AND Vitest MUST receive the selector unchanged and execute the intended focused scope

#### Scenario: Terminal and retry matrix is resource-neutral

- GIVEN the baseline owned-resource inventory is captured
- WHEN a successful, failing, timed-out, cancelled, partial-startup, or retry scenario completes
- THEN awaited cleanup MUST restore exact baseline equality before the result is reported
- AND concurrent foreign-owner resources MUST remain unchanged

#### Scenario: Candidate-timeout regression is bounded

- GIVEN the prior `candidate-timeout` leak path is exercised with a finite deadline and retry bound
- WHEN timeout and retry handling completes
- THEN no attempt MUST create its next resource set before prior reconciliation finishes
- AND the final owned-resource inventory MUST equal the baseline within the declared bound

#### Scenario: Crash recovery restores neutrality later

- GIVEN an invocation leaves labeled resources after SIGKILL or parent crash
- WHEN a later supported invocation classifies them as stale
- THEN it MUST recover only those stale owned resources
- AND its terminal evidence MUST show baseline equality while excluded resources remain unchanged
