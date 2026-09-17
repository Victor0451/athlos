# Delta for Web Frontend

## MODIFIED Requirements

### Requirement: Capability-Aware Collections Navigation

The system MUST show `/collections` only when the Collections capability is enabled and the operator has an allowed role. ADMIN and TESORERO MUST retain their existing Collections access. An OPERADOR MUST see the authorized Treasury/Caja entry and shift-opening action even without an active shift; the Collections full-payment entry alone requires that operator's active own personal shift. Hiding an entry MUST NOT authorize an API action.

(Previously: Collections navigation was limited to ADMIN or TESORERO when the assessment capability was enabled.)

#### Scenario: Enabled authorized navigation

- GIVEN an ADMIN or TESORERO and the Collections capability enabled
- WHEN the AppShell renders
- THEN it SHALL expose the Collections entry and route

#### Scenario: Operator navigation distinguishes Treasury opening from payment

- GIVEN an OPERADOR and the Collections capability enabled without an active own personal shift
- WHEN the AppShell renders
- THEN it SHALL expose the Treasury/Caja entry and shift-opening action
- AND it MUST NOT expose a Collections full-payment action

#### Scenario: Disabled or unauthorized navigation

- GIVEN the capability is disabled or the operator is not allowed
- WHEN navigation or `/collections` is requested
- THEN the entry SHALL be absent and route access SHALL be denied or unavailable

### Requirement: Protected Routing

The system SHALL wrap protected routes under a `(authed)` route group with an auth-enforcing layout and SHALL enforce Collections capability and role independently of client navigation. It SHALL enforce an own active personal shift only for the Collections full-payment action, not for Treasury/Caja entry or shift opening.

(Previously: Protected routing required auth enforcement and independent Collections capability/role route access.)

#### Scenario: Unauthenticated user hits protected route

- GIVEN no token and no valid refresh cookie
- WHEN the user navigates to `/socios`
- THEN the layout SHALL redirect to `/login?from=/socios`

#### Scenario: Direct Collections access is denied

- GIVEN an authenticated operator without Collections access
- WHEN they navigate directly to `/collections`
- THEN the route SHALL not expose the restricted workspace

#### Scenario: Operator without a shift opens Treasury but not payment

- GIVEN an authenticated OPERADOR with Collections access and without an active own personal shift
- WHEN they navigate to `/collections`
- THEN the route SHALL expose Treasury/Caja entry and shift opening
- AND it MUST NOT expose or authorize a full-payment action

### Requirement: Computed-Close and Manual-Method Presentation

The personal Caja UI MUST require account, description, amount, and exactly one payment method for both manual income and manual expense. The proposed first-version matrix permits `CASH`/`DEBIT`/`CREDIT`/`TRANSFER` for income and `CASH`/`DEBIT`/`CREDIT`/`TRANSFER`/`BANK_DEBIT` for expense; this is not a retroactive history assertion. It MUST present automatic production separately from manual income with linked source detail and CASH/DEBIT/CREDIT/TRANSFER totals. It MUST label payment-card DEBIT and expense-only bank-debit BANK_DEBIT distinctly; `Débito bancario` MUST NOT be presented as a bank-ledger integration.

The close UI MUST present an informational server-computed expected CASH preview, CASH-only exact-cent physical count/variance/reason controls, and the derived logical `Valores a Depositar` transfer. New UI/API requests MUST reject non-cash count/opening keys. On submit it MUST lock and recompute on the server, accept no client transfer amount, and block/refetch on a negative final result. It MUST NOT render or submit a declared-handoff amount, custody declaration, treasurer approval, or client-selected transfer amount. Non-cash expenses MUST remain visible without lowering displayed expected physical CASH. Completed historical replay/history remains readable unchanged.

#### Scenario: Mixed-method close preview uses computed cash

- GIVEN a shift has CASH income of 30000, CASH expense of 5000, and TRANSFER expense of 4000
- WHEN the operator views close
- THEN the UI SHALL show expected CASH and derived logical transfer of 25000
- AND it SHALL keep the TRANSFER expense outside physical CASH
- AND it SHALL not offer an editable handoff field

### Requirement: Design System and Deferred Features

The system SHALL use Gorriti Premium tokens exclusively via Tailwind utility classes (no inline styles, no hard-coded hex). Dark mode SHALL NOT be enabled in MVP. The authorized personal Caja and full-payment Collections journeys MUST NOT display as `Próximamente`. Deferred features outside this change, including Approval executor, File storage, and Receipt reprint, SHALL display `Próximamente`.

(Previously: Caja was a deferred feature and displayed `Próximamente` with other deferred features.)

#### Scenario: Navigating to a deferred feature

- GIVEN an operator clicks a feature deferred outside this change
- WHEN the page renders
- THEN the system SHALL display `Próximamente — disponible en una próxima versión`
- AND the URL SHALL NOT 404

#### Scenario: Authorized Caja journey is active

- GIVEN an authorized operator opens the personal Caja Collections journey
- WHEN the page renders
- THEN it SHALL render the applicable Caja actions and states
- AND it MUST NOT display `Próximamente` for that journey
