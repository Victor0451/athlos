# Delta for ui-design

## ADDED Requirements

### Requirement: Premium Cuenta Header

`/ctacte/[cuenta]` SHALL render the canonical Gorriti Premium header as a tokenized card containing a back control, icon tile, titular name, socio number, DNI, and estado treatment. It MUST use existing design tokens and preserve the page's existing action affordances and test identifiers. The header MUST NOT introduce raw hex values, new tokens, gradients, regular-card shadows, or pill controls.

The titular name SHALL use the established prominent uppercase heading treatment; numeric identifiers SHALL use the mono token; the estado SHALL use an accessible status badge. The back control and action buttons MUST have visible focus states and text labels where required by the existing component rules.

#### Scenario: Complete header renders
- GIVEN an authenticated operator opens `/ctacte/<cuenta>` with titular data
- WHEN the page renders
- THEN the header SHALL show the back control, icon tile, titular metadata, and estado
- AND the existing mutation actions SHALL remain available

#### Scenario: Tokens and accessibility are preserved
- GIVEN the header is rendered
- WHEN a focused control is inspected
- THEN it SHALL have a visible focus state and semantic accessible name
- AND the header SHALL use existing tokens without raw hex literals

#### Scenario: Focused regression coverage
- GIVEN the premium header is changed
- WHEN focused page tests run
- THEN they SHALL assert its required elements and retain existing page assertions

### Requirement: Header Slice Review Boundary

The premium header and its focused tests MUST remain in one independently reviewable stacked-to-main slice of at most 400 changed lines. This UI work MUST NOT require production access, production migration, deployment, or unrelated layout redesign.

#### Scenario: Header review scope
- GIVEN the header slice is prepared for review
- WHEN its authored additions and deletions are counted
- THEN the slice SHALL be at most 400 changed lines
