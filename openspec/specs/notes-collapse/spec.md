# Notes Collapse Specification

> Synced from change `athlos-notes-collapsible` (2026-07-07).

## Purpose

Per-socio collapsible notes panel on `/socios/[id]`. The `SocioNotesCard` exposes a header toggle that collapses or expands the notes region, persists the user's preference per socio in `localStorage`, and keeps the current count visible as a chip even when collapsed so operators retain glanceable context. The collapse guards against hiding an in-flight edit form.

## Requirements

### Requirement: Default Collapsed on First Mount

The system SHALL render `SocioNotesCard` with its content collapsed on first mount, before any `localStorage` read.

#### Scenario: First mount, no persisted state

- **WHEN** the card mounts on `/socios/:id` and `localStorage["notes-collapsed-<socioId>"]` is unset
- **THEN** the panel region is not rendered
- **AND** the toggle button shows `aria-expanded="false"`
- **AND** the chevron points down (rotation 0°)

#### Scenario: Server-side render is collapsed

- **WHEN** the card is rendered on the server during SSR
- **THEN** the panel region is not rendered
- **AND** no hydration mismatch warning is emitted on the client

### Requirement: Per-Socio Persistence in `localStorage`

The system SHALL persist the user's collapsed/expanded state per socio in `localStorage` under the key `notes-collapsed-<socioId>`. State SHALL be read once after mount and SHALL NOT be read on the server.

#### Scenario: Return visit, persisted expanded

- **WHEN** `localStorage["notes-collapsed-<socioId>"]` is the string `"false"`
- **THEN** the card hydrates expanded (panel region rendered, `aria-expanded="true"`)

#### Scenario: Return visit, persisted collapsed

- **WHEN** `localStorage["notes-collapsed-<socioId>"]` is the string `"true"`
- **THEN** the card hydrates collapsed (panel region not rendered)

#### Scenario: Different socio has independent state

- **WHEN** the user navigates from `/socios/:A` to `/socios/:B`
- **THEN** the toggle state for `:A` SHALL NOT affect the toggle state for `:B`

### Requirement: Toggle Button with ARIA

The system SHALL provide a toggle button in the card header whose click flips the collapsed state. The button SHALL expose `aria-expanded` reflecting the state and SHALL declare `aria-controls="socio-notes-panel"`.

#### Scenario: Toggle click flips `aria-expanded`

- **WHEN** the user activates the header button while collapsed
- **THEN** `aria-expanded` flips to `"true"`
- **AND** when activated again, it flips back to `"false"`

#### Scenario: `aria-controls` references the panel id

- **WHEN** the toggle button is rendered in any collapsed or expanded state
- **THEN** `aria-controls="socio-notes-panel"` is present
- **AND** the panel region SHALL carry `id="socio-notes-panel"`

### Requirement: Notes Count Counter Chip

The system SHALL render a `<Badge>` in the card header displaying the current note count, pluralised as `N nota` (count equals 1) or `N notas` (otherwise). The chip SHALL be right-aligned in the header using `ml-auto`.

#### Scenario: Pluralisation across counts

- **WHEN** the notes list contains 0 items
- **THEN** the badge text is `"0 notas"`
- **WHEN** the notes list contains exactly 1 item
- **THEN** the badge text is `"1 nota"`
- **WHEN** the notes list contains N ≥ 2 items
- **THEN** the badge text is `"N notas"`

#### Scenario: Right-aligned in header

- **WHEN** the card header is rendered
- **THEN** the counter chip carries `className="ml-auto"`
- **AND** the parent flex container uses `items-center justify-between gap-3`

### Requirement: Form and List Inside the Collapsible Region

The system SHALL render the "nueva nota" form and the existing notes list inside the collapsible region only.

#### Scenario: Collapsed state hides form and list

- **WHEN** the card is collapsed and no note is being edited
- **THEN** the "nueva nota" form is not rendered
- **AND** the notes list region is not rendered

### Requirement: Edit-While-Collapsed Guard

The system SHALL derive `displayExpanded = !collapsed || editingId !== null` so that an open edit textarea is never hidden by a collapse toggle.

#### Scenario: Open edit prevents collapse

- **WHEN** the user starts editing a note (`editingId` becomes non-null)
- **THEN** clicking the header toggle SHALL NOT hide the open edit form
- **AND** the panel region SHALL remain rendered

#### Scenario: Edit finished reverts to toggle state

- **WHEN** the user saves or cancels the edit (`editingId` becomes null)
- **THEN** the panel visibility reverts to the user's persisted toggle state
- **AND** clicking the header toggle hides the panel again if the persisted state is collapsed

### Requirement: Chevron Rotation

The system SHALL rotate a chevron icon 180° when the card transitions from collapsed to expanded, using `transition-transform duration-fast`.

#### Scenario: Chevron rotates on toggle

- **WHEN** the card transitions from collapsed to expanded
- **THEN** the chevron carries `rotate-180`
- **AND** carries `transition-transform duration-fast`

### Requirement: `localStorage` Unavailable Fallback

The system SHALL fall back to default collapsed when `localStorage` access throws (private mode, quota exceeded) or is absent (SSR). Errors SHALL NOT surface to the user.

#### Scenario: `localStorage.setItem` throws on toggle

- **WHEN** the user activates the header toggle and `localStorage.setItem` throws
- **THEN** the in-memory state still flips
- **AND** the component continues to render normally

#### Scenario: `localStorage.getItem` throws on mount

- **WHEN** the post-mount read of `localStorage["notes-collapsed-<socioId>"]` throws
- **THEN** the card remains in the default collapsed state
- **AND** no error is surfaced to the user

## Success Criteria

- [ ] Card collapsed on first visit; counter chip visible while collapsed.
- [ ] Per-socio persistence via `notes-collapsed-<socioId>`.
- [ ] `aria-expanded` and `aria-controls="socio-notes-panel"` correct in every state.
- [ ] Counter chip pluralised correctly for 0, 1, N.
- [ ] Form and list rendered only inside the panel region.
- [ ] Open edit form is never hidden by a collapse toggle.
- [ ] Chevron rotates 180° with `transition-transform duration-fast`.
- [ ] `localStorage` failures (read or write) degrade silently to default collapsed.
- [ ] SSR renders collapsed with no hydration mismatch.