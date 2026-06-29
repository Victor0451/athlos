# Delta for Web Frontend

## ADDED Requirements

Additive-only per B1b LESSON #1. The existing web-frontend requirements (Operator Login, Silent Token Refresh, Protected Routing, AppShell Layout, Dashboard Cards, Design System) are NOT modified; this delta ONLY adds new ADMIN-gated routes and a new sidebar entry for the N16 gastos-ctacte mapping capability.

### Requirement: Sidebar "Tesorería > Gastos" Link (ADMIN-Only)

The system SHALL render a "Tesorería > Gastos" sidebar entry under the Admin group, visible only when the authenticated operator's role is `ADMIN`.

#### Scenario: ADMIN sees Gastos in the sidebar

- GIVEN an ADMIN operator with a valid session
- WHEN the AppShell renders on any authed route
- THEN a "Tesorería > Gastos" nav link SHALL appear under the Admin group
- AND the link SHALL target `/admin/gastos`
- AND the active item SHALL show the `accent` left-border per existing sidebar styling

#### Scenario: Non-ADMIN operator does NOT see Gastos

- GIVEN an OPERADOR/TESORERO/CONSULTA operator
- WHEN the AppShell renders
- THEN the "Tesorería > Gastos" link SHALL NOT appear in the sidebar

### Requirement: /admin/gastos List Page

The system SHALL render `/admin/gastos` as a paginated table of gastos with filters (cuenta_principal, fecha_desde, fecha_hasta, anulado) and a per-row link to the detail page. ADMIN-only.

#### Scenario: ADMIN opens the gastos list page

- GIVEN an ADMIN at `/admin/gastos`
- WHEN the page mounts
- THEN it SHALL fetch `GET /api/v1/gastos?...filters...` AND SHALL render a table with `link_count`
- AND each row SHALL navigate to `/admin/gastos/[id]`
- AND the page SHALL include an "Anulado" filter AND a date-range picker

### Requirement: /admin/gastos/[id] Detail Page with Link Management

The system SHALL render `/admin/gastos/[id]` showing gasto detail, the `links[]` table with add/remove/anular actions per link, and a "Candidatos heurísticos" section for unconfirmed heuristic matches.

#### Scenario: ADMIN manages links on gasto detail

- GIVEN an ADMIN at `/admin/gastos/:id`
- WHEN the page mounts
- THEN it SHALL render the gasto header, the `links[]` table, an "Agregar enlace" button, AND per-link "Eliminar / Anular" actions
- AND the heuristic candidates section SHALL list pending matches with "Confirmar" and "Descartar" buttons
- AND confirming a candidate SHALL call `POST /api/v1/gastos/:id/ctacte-links` with the candidate's `ctacte_id`

### Requirement: /ctacte/[cuenta] "Gastos vinculados" Panel

The system SHALL replace the "Próximamente" placeholder for the gastos dimension on `/ctacte/[cuenta]` with a "Gastos vinculados" panel that fetches `GET /api/v1/ctacte/:cuenta/gastos-links` and lists every active link.

#### Scenario: Linked gastos render on ctacte detail (no "Próximamente" for gastos)

- GIVEN any authed operator at `/ctacte/[cuenta]` with active `gastos_ctacte_mapping` links for that cuenta
- WHEN the page mounts
- THEN a "Gastos vinculados" panel SHALL render below MovementList with `concepto`, `importe`, `fecha`, `motivo` per link
- AND the gastos dimension SHALL NOT show "Próximamente"
- AND the panel SHALL be omitted (zero state) when the list endpoint returns zero active links

---

## Success Criteria (this change)

3. **web-frontend ADDED**: ADMIN sees a "Tesorería > Gastos" sidebar entry; `/admin/gastos` and `/admin/gastos/[id]` render against the live API; `/ctacte/[cuenta]` shows the "Gastos vinculados" panel (no "Próximamente" placeholder for the gastos dimension).
