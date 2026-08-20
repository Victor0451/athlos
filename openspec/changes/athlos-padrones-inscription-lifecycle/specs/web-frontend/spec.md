# Delta for Web Frontend

## ADDED Requirements

### Requirement: Padrones Lifecycle Controls

The web console MUST show create and status controls only to `ADMIN` and `OPERADOR` on a filtered Padrones roster context. Creation MUST offer `activa` and `pendiente`; baja MUST collect reason and effective date; reactivation MUST be explicit, set status to `activa`, and offer no target selector. Row actions MUST be accessible controls separate from socio-navigation controls. The UI MUST use the established accessible modal behavior, expose pending work through a loading state, surface mutation failures accessibly, and keep the modal open on failure.

#### Scenario: Create enrollment
- GIVEN an authorized operator viewing a filtered roster
- WHEN they submit a valid creation modal
- THEN the UI MUST show pending feedback and close after success

#### Scenario: Failed baja
- GIVEN an authorized operator submits incomplete or rejected baja data
- WHEN the API responds with an error
- THEN the modal MUST remain open and announce the error

### Requirement: Lifecycle Refresh Without Reload

After a successful create or state-changing transition, the web console MUST invalidate affected Padrones queries and render current enrollment data without a full-page reload. Same-state no-op and failed commands MUST NOT present a false success state.

#### Scenario: Status refresh
- GIVEN a successful baja or reactivation
- WHEN the mutation resolves
- THEN the affected roster MUST refetch and display the returned status

#### Scenario: Separate row action
- GIVEN a roster row with a status action
- WHEN keyboard focus reaches its navigation and action controls
- THEN each MUST have an independent accessible name and operation
