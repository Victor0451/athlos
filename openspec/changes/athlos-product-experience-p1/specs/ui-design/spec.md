# Delta for UI Design

## ADDED Requirements

### Requirement: Socios-Derived Responsive and Accessible Product Surfaces

The landing, embedded form, and club-status dashboard MUST use the existing Socios interaction language: associated labels, visible focus treatment, inline validation, minimum touch targets, token-based states, and responsive containment. At 320, 768, 1024, and 1440 CSS pixels, the surfaces MUST have no page-level horizontal overflow; controls MUST remain operable by keyboard; status MUST not rely on color alone. At widths below 1024px, navigation MUST follow the existing drawer rule.

#### Scenario: Narrow viewport form
- GIVEN a 320px viewport
- WHEN the contact form displays validation errors
- THEN labels, errors, controls, and submit action SHALL remain visible without horizontal page overflow

#### Scenario: Keyboard and status accessibility
- GIVEN a keyboard-only visitor or operator
- WHEN traversing CTAs, fields, period control, and status cards
- THEN each interactive element SHALL have a visible focus indicator and non-color state text

#### Scenario: Dashboard responsive checks
- GIVEN viewports of 768, 1024, and 1440px
- WHEN the dashboard renders loading, unavailable, empty, error, and populated states
- THEN content SHALL remain readable, operable, and contained at each width
