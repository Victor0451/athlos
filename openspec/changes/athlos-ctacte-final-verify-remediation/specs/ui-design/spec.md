# Delta for ui-design

## ADDED Requirements

### Requirement: Premium Cuenta Header

`/ctacte/[cuenta]` SHALL render the canonical Gorriti Premium header as a
responsive, tokenized card containing a labeled back control, account icon
tile, titular name, socio number, DNI, and estado treatment. It MUST use
existing design tokens and preserve the page's existing action affordances and
test identifiers. The header MUST NOT introduce raw hex values, new tokens,
gradients, regular-card shadows, or pill controls.

The titular name SHALL use the established prominent uppercase heading
treatment, numeric identifiers SHALL use the mono token, and estado SHALL use
the accessible shared status badge. Interactive controls MUST expose visible
focus states and semantic accessible names.

#### Scenario: Complete header renders

- GIVEN an authenticated operator opens `/ctacte/<cuenta>` with titular data
- WHEN the page renders
- THEN the header SHALL show the back control, icon tile, titular metadata, and estado
- AND the existing mutation actions SHALL remain available

#### Scenario: Tokens and accessibility are preserved

- GIVEN the premium header is rendered
- WHEN an interactive control receives keyboard focus
- THEN it SHALL have a visible focus state and semantic accessible name
- AND the header SHALL use existing tokens without raw hex literals

#### Scenario: Focused regression coverage

- GIVEN the premium header is changed
- WHEN focused page tests run
- THEN they SHALL assert its required elements and retain existing page assertions

### Requirement: Header Slice Review Boundary

The premium header and its focused tests MUST remain in one independently
reviewable slice of at most 400 changed lines. This UI work MUST NOT require
production access, production migration, deployment, or unrelated layout
redesign.

#### Scenario: Header review scope

- GIVEN the header slice is prepared for review
- WHEN its authored additions and deletions are counted
- THEN the slice SHALL be at most 400 changed lines
