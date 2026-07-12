# Delta for `ui-design`

> Spec delta for the `ui-design` spec, authored as part of `athlos-ctacte-mutations` (2026-07-09).

This delta extends the UI Design Specification with the visual contract for the **`/ctacte/[cuenta]` page** (second realization of the canonical Gorriti Premium pattern after `/socios/[id]`), plus the four mutation buttons (Registrar Pago, Registrar Débito, Reimprimir Comprobante, Nota) and the notes card mount point. The change reuses tokens and primitives that already exist in the bundle — **no new tokens are added**. All visual rules match the canonical `/socios/[id]` implementation; the change is a pattern replication, not a pattern invention.

## ADDED Requirements

### Requirement: `/ctacte/[cuenta]` Gorriti Premium Refresh

The `/ctacte/[cuenta]` page SHALL be refreshed to the canonical Gorriti Premium visual contract, matching the `/socios/[id]` implementation. The refresh SHALL consume only existing tokens (`surface-page`, `ink-150`, `radius-xl`, `radius-2xl`, `shadow-sm`) and SHALL NOT introduce new tokens. Raw hex literals SHALL NOT appear in the new component code outside the token files.

The page SHALL adopt the following layout, top to bottom:

1. **Page header card**: `rounded-xl + shadow-sm + p-8` card containing a back-circle button (Lucide `ChevronLeft`, `1px ink-200 border`, circular), an icon tile (matching the canonical pattern), the titular info (`text-3xl uppercase tracking-tight`), the socio number (`mono-md`), the DNI (`mono-md`), and an estado badge.
2. **Summary strip** (3-cell grid): Total Debe (`mono-lg ink-900`), Total Haber (`mono-lg ink-900`), Saldo (`mono-lg accent` if deudor / `mono-lg ink-900` if a favor, matching the existing table color rule for negative vs positive balances).
3. **Mutation button group** (3 buttons, right-aligned in the header card OR a dedicated row below it): "Registrar Pago" (Primary, `accent`), "Registrar Débito" (Secondary, `1px ink-200 border`), "Reimprimir Comprobante" (Secondary, Lucide `Printer` icon — same precedent as the Emitir Solicitud button on `/socios/[id]`).
4. **Notes card mount**: a `<CtacteMovementNotesCard>` placed between the summary strip and the `MovementList`. Default state collapsed; see the `useNotesCollapsed` requirement below.
5. **MovementList**: untouched (existing 236 LoC component) except for a per-row "Nota" callback prop that opens the Nota modal.

#### Scenario: Page header uses canonical tokens

- **WHEN** the page renders
- **THEN** the page header card SHALL have classes `rounded-xl shadow-sm p-8`
- **AND** a CI grep over the new / modified files SHALL find ZERO raw hex literals (`#[0-9a-fA-F]{3,8}`) outside `apps/web/src/styles/tokens.css`

#### Scenario: No new tokens are introduced

- **WHEN** the change is applied
- **THEN** `apps/web/src/styles/tokens.css` SHALL NOT gain new CSS variables
- **AND** `apps/web/tailwind.config.ts` SHALL NOT gain new `theme.extend` entries beyond what was already there before the change

#### Scenario: Existing data-testids are preserved

- **WHEN** the refresh is applied
- **THEN** every existing `data-testid` on the page SHALL remain identical (the existing 10 page tests assert text-level invariants; only the token wrappers change)
- **AND** `pnpm --filter @athlos/web test:run -- ctacte/page.test.tsx` SHALL still pass

#### Scenario: Focused header elements render with canonical tokens

- **WHEN** the premium `/ctacte/<cuenta>` header renders
- **THEN** the header card SHALL carry the token classes `rounded-xl shadow-sm p-8`
- **AND** the back control SHALL be a circular button with a 1px ink-200 border and a visible focus state
- **AND** the icon tile SHALL match the canonical Gorriti Premium pattern
- **AND** the titular name SHALL use the canonical uppercase heading treatment (`text-3xl uppercase tracking-tight`)
- **AND** the socio number and DNI SHALL render using the mono token (`mono-md`)
- **AND** the estado badge SHALL expose an accessible name (`role="status"` or `aria-label`) describing the cuenta's estado
- **AND** focused page-test assertions SHALL cover each element listed above alongside the existing ledger assertions, with no broad snapshot tests introduced

#### Scenario: Header slice review boundary

- **GIVEN** the premium `/ctacte/<cuenta>` header and its focused tests
- **WHEN** the slice is prepared for review
- **THEN** the slice SHALL contain only header markup plus focused page-test assertions
- **AND** the slice SHALL be at most 400 authored changed lines

### Requirement: Mutation Buttons on `/ctacte/[cuenta]`

The `/ctacte/[cuenta]` page SHALL expose four mutation affordances, all visible to any authenticated operator (no role gate):

| Button | Placement | Variant | Icon | Click behavior |
|---|---|---|---|---|
| "Registrar Pago" | Header card action group, PRIMARY | Primary (`accent`) | Lucide `Wallet` or `Banknote` | Opens Pago modal |
| "Registrar Débito" | Header card action group, SECONDARY | Secondary (`#ffffff bg`, `1px ink-200 border`) | Lucide `MinusCircle` | Opens Débito modal |
| "Reimprimir Comprobante" | Header card action group, SECONDARY | Secondary | Lucide `Printer` | Opens Reimprimir Comprobante modal (date-range picker) |
| "Nota" (per-movement) | Each `MovementList` row, right-side icon button | Ghost | Lucide `MessageSquarePlus` | Opens Nota modal scoped to that movement |

The "Reimprimir Comprobante" button SHALL be a sibling of the existing "Emitir Solicitud" button precedent on `/socios/[id]` (Secondary variant, `Printer` icon, no shadow, no `rounded-full`). The mutation button group SHALL be visible to ANY authenticated operator — NOT gated to ADMIN role, matching the backend route's `requireAuth()`-only contract.

#### Scenario: Mutation buttons are visible to any authenticated operator

- **WHEN** any authenticated operator opens `/ctacte/<cuenta>`
- **THEN** the three header buttons ("Registrar Pago", "Registrar Débito", "Reimprimir Comprobante") SHALL be visible in the page header action group
- **AND** SHALL NOT be gated to ADMIN role

#### Scenario: Per-row Nota button opens the Nota modal scoped to that movement

- **WHEN** the operator clicks the "Nota" icon button on a specific movement row
- **THEN** the Nota modal SHALL open
- **AND** the modal title SHALL include the movement identifier (e.g., "Nota · Movimiento #<id>")
- **AND** on Submit, the request URL SHALL include that movement's `:movementId`

#### Scenario: Reimprimir Comprobante uses the Secondary button variant

- **WHEN** the button renders
- **THEN** its background SHALL be `#ffffff` (or `surface`)
- **AND** its border SHALL be `1px solid #d4d4d4` (or `ink-200`)
- **AND** its text SHALL be `ink-700`
- **AND** it SHALL carry a leading Lucide `Printer` icon
- **AND** it SHALL have NO shadow and NO `rounded-full` corner

### Requirement: `useNotesCollapsed(cuentaId, null)` for Per-Cuenta Notes Section

The `<CtacteMovementNotesCard>` SHALL colocate a `useNotesCollapsed(cuentaId, null)` hook that persists the collapsed/expanded state in `localStorage` under the key `ctacte-notes-collapsed-<cuenta>` (one key per cuenta). The hook matches the precedent set by `SocioNotesCard.useNotesCollapsed` (localStorage key shape `notes-collapsed-<socioId>`) — only the namespace prefix changes (`ctacte-` vs the socio's prefix). Default state SHALL be `true` (collapsed) on first visit.

#### Scenario: Collapsed state persists across reloads

- **WHEN** the operator expands the notes section, reloads the page, and the hook reads from localStorage
- **THEN** `localStorage.getItem('ctacte-notes-collapsed-<cuenta>')` SHALL equal `"false"`
- **AND** the section SHALL render expanded on the second visit

#### Scenario: State is isolated per cuenta

- **WHEN** the operator expands notes for `cuenta-A` but collapses notes for `cuenta-B`
- **THEN** `localStorage.getItem('ctacte-notes-collapsed-<cuenta-A>')` SHALL equal `"false"`
- **AND** `localStorage.getItem('ctacte-notes-collapsed-<cuenta-B>')` SHALL equal `"true"`

#### Scenario: Default state is collapsed on first visit

- **WHEN** the operator opens `/ctacte/<cuenta-X>` for the first time (no localStorage key)
- **THEN** the notes section SHALL render collapsed
- **AND** the hook SHALL write `"true"` to `localStorage` for that cuenta

### Requirement: OperatorChip Renders Audit Actors as `username · ROLE`

The `<CtacteMovementNotesCard>` SHALL render every audit actor (the `author_operator_id` on each note row, the `operator_id` on each `CTACTE_MOVEMENT_NOTE_ADDED` event when the timeline is rendered) using the existing `<OperatorChip>` primitive from `apps/web/src/components/socios/OperatorChip.tsx`. The chip SHALL resolve the operator UUID via the existing `/api/v1/operators` endpoint and SHALL render `username · ROLE` (e.g., `jperez · OPERADOR`). The chip replaces any prior pattern that showed the raw UUID (e.g., `Operador 1f2a3b4c-…`).

#### Scenario: OperatorChip resolves a known operator

- **WHEN** a note with `author_operator_id = "<uuid>"` is rendered
- **THEN** the OperatorChip SHALL display `username · ROLE` (e.g., `jperez · OPERADOR`)
- **AND** SHALL NOT display the raw UUID

#### Scenario: OperatorChip shows fallback when operator is deleted

- **WHEN** an operator is hard-deleted and the note references the stale UUID
- **THEN** the OperatorChip SHALL display a fallback like `Operador eliminado`
- **AND** SHALL NOT throw or break the row render

### Requirement: Comprobante Modal Renders a Date-Range Picker

The Reimprimir Comprobante modal SHALL render a date-range picker with two `YYYY-MM-DD` inputs (`from`, `to`) plus an optional selector for the `cuenta` (default: the cuenta currently in the URL). The picker SHALL use the existing `<Input>` token (`1px #d4d4d4` border, `radius-md`, 40px height, focus ring `0 0 0 3px rgba(193,39,45,0.1)`). The Submit button SHALL be a Primary button (`accent` background, `accent-foreground` text, `accent-hover` on hover) with label "Emitir comprobante". The Cancel button SHALL be a Secondary button to the left.

#### Scenario: Date-range picker renders two inputs

- **WHEN** the modal opens
- **THEN** the body SHALL render two `YYYY-MM-DD` inputs labeled `Desde` (from) and `Hasta` (to)
- **AND** the Submit button SHALL be disabled until both dates are populated AND `from <= to`

#### Scenario: Submit triggers the PDF download in a new tab

- **WHEN** the operator fills both dates and clicks "Emitir comprobante"
- **THEN** the client SHALL call `apiFetchBlob('/api/v1/socios/<id>/ctacte/comprobante.pdf?from=...&to=...&cuenta=...')`
- **AND** on success, the client SHALL call `window.open(blobUrl, '_blank', 'noopener,noreferrer')` to open the PDF in a new tab
- **AND** `notify('success', 'Comprobante emitido')` SHALL fire

#### Scenario: Cap error surfaces as an inline message + error toast

- **WHEN** the API returns `400 VALIDATION_ERROR` with `details: { cap: 50, requested: <count> }`
- **THEN** the modal SHALL remain open
- **AND** an inline error message ("El rango excede el límite de 50 movimientos") SHALL display at the top of the modal body
- **AND** `notify('error', 'No se pudo emitir el comprobante')` SHALL fire via the existing `notify()` wrapper