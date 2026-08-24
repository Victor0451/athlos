# Delta for Config/Environment

## ADDED Requirements

### Requirement: Negotiated Dues BETA Flag Set

The BETA deployment configuration MUST enable `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_ASSESSMENT_ENABLED`, `DUES_AGREEMENTS_ENABLED`, and `DUES_CASH_ENABLED` together only after their dependent negotiated-dues slices are deployed and smoke-checked. Schema defaults for these flags MUST remain `false` outside the BETA deployment configuration.

#### Scenario: Complete BETA configuration enables the workflow

- GIVEN the negotiated-dues dependent slices are deployed and smoke-checked in the club BETA environment
- WHEN the BETA configuration is applied
- THEN all four required flags MUST be enabled
- AND the configuration MUST expose the complete intended Collections workflow

#### Scenario: Incomplete flag set is rejected

- GIVEN a BETA configuration enables only some of the four required flags
- WHEN configuration validation or release verification runs
- THEN the rollout MUST be rejected as incomplete
- AND the negotiated workflow MUST NOT be represented as ready for BETA use

### Requirement: Negotiated Dues BETA Rollback

The BETA deployment MUST support disabling `DUES_AGREEMENTS_ENABLED` and/or `NATIVE_COLLECTIONS_WEB_ENABLED` to remove the new Web entry points without changing existing monetary collection behavior. Disabling the BETA flag set MUST NOT delete, rewrite, or make unreadable agreement, revision, settlement, evidence, allocation, or audit history created while it was enabled.

#### Scenario: BETA rollback removes new entry points safely

- GIVEN the negotiated dues workflow was enabled in BETA
- WHEN an operator disables the negotiated dues BETA flags
- THEN new negotiation entry points MUST no longer be available
- AND existing monetary settlement and reversal behavior MUST remain available
- AND historical negotiated records MUST remain preserved and readable
