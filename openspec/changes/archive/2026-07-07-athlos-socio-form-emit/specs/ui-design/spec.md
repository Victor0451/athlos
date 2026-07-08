# Delta for `ui-design`

This delta extends the UI Design Specification with the visual contract for the "Emitir Solicitud" button in the Socio Detail header, required by `athlos-socio-form-emit`. The button opens the server-rendered PDF in a new browser tab and confirms emission via the existing `notify()` toast primitive.

## ADDED Requirements

### Requirement: Emitir Solicitud Button on `/socios/[id]`

The Socio Detail page (`/socios/[id]`) SHALL render an "Emitir Solicitud" button in the page header's action cluster, placed BEFORE the existing ADMIN-only group (Editar / Dar baja / Reactivar). The button SHALL be visible to ANY authenticated operator — it is NOT gated to ADMIN role, matching the backend route's "any authenticated operator" contract.

| Aspect | Value |
|---|---|
| Label (Spanish, infinitive) | `Emitir Solicitud` |
| Leading icon | Lucide `Printer` (16 px, color follows the button's text token) |
| Variant | Secondary (`#ffffff` background, `1px #d4d4d4` border, `ink-700` text) per the Base Component System's Button token table |
| Size | Default 36 px height |
| Placement | Page header, right-aligned, BEFORE the ADMIN-only action group |
| Click handler | `window.open(<formUrl>, '_blank', 'noopener,noreferrer')` |
| Success feedback | `notify('success', 'Solicitud emitida')` after the new tab opens (no body fetch) |

The button SHALL be a sibling of the existing `<h1>` + status badge in the page header, inside the same `flex shrink-0 items-center gap-2` wrapper. The action cluster SHALL be split into two groups: (a) the always-visible "Emitir Solicitud" group, and (b) the ADMIN-only "Editar / Dar baja / Reactivar" group. The two groups SHALL be separated by a 1 px `ink-100` vertical divider to preserve the "always" vs "admin" separation visually.

#### Scenario: Button is visible in the page header for any authenticated operator

- **WHEN** any authenticated operator opens `/socios/<socioId>`
- **THEN** an "Emitir Solicitud" button SHALL be visible in the page header's right-aligned action cluster
- **AND** the button SHALL carry a leading Lucide `Printer` icon
- **AND** the button SHALL NOT be gated to ADMIN role

#### Scenario: Button appears BEFORE the ADMIN action group

- **WHEN** the page header renders
- **THEN** the "Emitir Solicitud" button SHALL be rendered to the LEFT of the "Editar" / "Dar baja" / "Reactivar" buttons
- **AND** the two groups SHALL be separated by a 1 px `ink-100` vertical divider

#### Scenario: Click opens the PDF in a new tab with `noopener,noreferrer`

- **WHEN** the operator clicks the "Emitir Solicitud" button
- **THEN** the client SHALL call `window.open(formUrl, '_blank', 'noopener,noreferrer')`
- **AND** a new browser tab SHALL open at the form URL
- **AND** the new tab SHALL NOT have an opener reference (security hardening)
- **AND** the new tab SHALL NOT receive the `Referer` header (privacy hardening)

#### Scenario: Success toast fires after the new tab opens

- **WHEN** the click handler completes and `window.open` returns
- **THEN** `notify('success', 'Solicitud emitida')` SHALL fire via the existing `notify()` wrapper from `athlos-toast-primitivo`
- **AND** the toast SHALL auto-dismiss after ~4000 ms
- **AND** the toast SHALL carry `role="status"`

#### Scenario: Button does not block on the PDF request

- **WHEN** the operator clicks the button
- **THEN** the click handler SHALL NOT `await` a fetch of the PDF
- **AND** the page SHALL NOT show a loading spinner on the button
- **AND** the operator MAY immediately click again to open a second tab (idempotency in the audit log is enforced server-side via the 10s bucket)

#### Scenario: Button uses the Secondary button variant

- **WHEN** the button renders
- **THEN** its background SHALL be `#ffffff`
- **AND** its border SHALL be `1px solid #d4d4d4`
- **AND** its text SHALL be `ink-700`
- **AND** it SHALL have NO shadow and NO `rounded-full` corner

#### Scenario: Button is disabled while the socio is missing required titular data

- **WHEN** the socio record is missing the `direccion` field (NULL or empty string)
- **THEN** the "Emitir Solicitud" button SHALL be rendered as disabled
- **AND** a tooltip SHALL explain "Falta domicilio del titular"
- **AND** clicking the disabled button SHALL NOT open a tab
