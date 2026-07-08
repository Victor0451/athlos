# UI Design Specification — Gorriti Premium

## Purpose

Defines the visual identity, design tokens, component system, and key-screen applications for the Athlos operator console. Anchored to the official Club Atlético Gorriti (CAG) escudo at `openspec/image/logo.jpg`: angular red shield `#c1272d`, white sans-serif bold monogram, dark presentation background. The system MUST look and feel like a serious institutional tool that wears the club's identity with restraint — not a marketing site.

---

## Design Philosophy — Gorriti Premium

**Three rules govern every pixel:**

1. **Rojo = intención.** The Gorriti red `#c1272d` appears ONLY where the user is making a decision or where the system demands attention: primary CTAs, focus rings, active nav item, deudor balances, destructive actions, critical alerts. It is never decorative. It earns its place.
2. **Blanco = claridad.** 95% of the interface is white, off-white, and ink-gray surfaces. Backgrounds breathe. Borders are quiet (`#e8e8e8`). Text is high-contrast ink, not muted.
3. **Negro = autoridad.** The sidebar, top bar, and report headers use `night-900` (`#0a0a0a`). They anchor the layout and signal "operator console," not "consumer app."

**Visual rules derived from the philosophy:**

- NEVER gradients. Flat color blocks only.
- NEVER drop shadows on regular cards or buttons. Shadows exist ONLY for floating elements (dropdowns, modals, popovers).
- NEVER `rounded-full` on buttons, badges, or inputs. Angular, sport-club identity.
- NEVER icons without labels in primary navigation. Labels first, icons second.
- The escudo (club crest) appears in three places ONLY: login screen, top bar of authenticated app, empty states tied to onboarding. Nowhere else — repetition cheapens it.

---

## Layout Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR (night-900, 56px)                                             │
│  [Escudo]  Athlos · CAG              [Search]  [Notif]  [Operator]  │
├────────────┬─────────────────────────────────────────────────────────┤
│            │  PAGE HEADER (breadcrumb + title + primary action)      │
│  SIDEBAR   ├─────────────────────────────────────────────────────────┤
│  (night-   │                                                         │
│   900,     │              MAIN CONTENT                               │
│   240px)   │              (white surface, max-width 1400px)          │
│            │                                                         │
│  Dashboard │                                                         │
│  Socios    │                                                         │
│  Cuenta    │                                                         │
│  Import    │                                                         │
│  Audit     │                                                         │
│            │                                                         │
│  [footer:  │                                                         │
│   logout]  │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

| Region | Background | Notes |
|--------|------------|-------|
| Top bar | `night-900` | Fixed, 56px. Holds escudo, global search, notifications, operator menu. |
| Sidebar | `night-900` | Fixed, 240px. Collapsible to 64px icon-only on screens < 1280px. |
| Page header | `surface` | Breadcrumb (12px uppercase ink-500) + h1 title (28px Inter Display) + primary action button right-aligned. 1px `ink-100` bottom border. |
| Main content | `surface` | 32px padding, max-width 1400px, centered. |

**Responsive:** Below 1024px the sidebar becomes a drawer triggered by a top-bar button. The night-900 sidebar MUST stay dark in both modes — never invert to a light drawer.

---

## Navigation

| Route | Screen | Description |
|-------|--------|-------------|
| `/login` | Login | Auth screen with split layout (escudo left, form right). |
| `/` | Dashboard | System health, freshness, recent activity. |
| `/socios` | Socio Lookup | Search and browse socio records. |
| `/socios/:id` | Socio Detail | Tabs: Profile · Cuenta Corriente · Deportes · Cuotas. |
| `/account` | Cuenta Corriente | Standalone CTACTE view with filters. |
| `/import` | Import Status | Live import progress and history. |
| `/audit` | Audit Log | Queryable audit trail. |
| `/approvals` | Aprobaciones | Pending actions queue (if RBAC scope enabled). |

**Sidebar item rules:**

- Default: 14px Inter, color `#a0a0a0`, padding 8px 12px, radius 6px.
- Hover: background `#141414` (night-800), text `#d4d4d4`.
- Active: background `#1a1a1a`, text `#ffffff`, **left border 2px solid `accent`**.
- Section dividers between groups: 1px solid `#1a1a1a`.

---

## Design Tokens

All values are mandatory. Components MUST consume tokens, not raw hex.

### Color tokens — Surfaces

| Token | Value | Role |
|-------|-------|------|
| `surface` | `#ffffff` | Page background, card background |
| `surface-elevated` | `#fafafa` | Table header, row hover |
| `surface-sunken` | `#f4f4f4` | Ghost button hover, badge default |
| `ink-900` | `#0a0a0a` | Critical numbers, strongest text |
| `ink-700` | `#1a1a1a` | Titles, body main |
| `ink-500` | `#4a4a4a` | Body secondary, descriptions |
| `ink-300` | `#9a9a9a` | Labels, metadata, placeholders |
| `ink-200` | `#d4d4d4` | Subtle borders, input border |
| `ink-100` | `#e8e8e8` | Dividers, primary separator |
| `night-900` | `#0a0a0a` | Sidebar, top bar, report headers |
| `night-800` | `#141414` | Hover on night surfaces |

### Color tokens — Accent (≤5% of screen real estate)

| Token | Value | Role |
|-------|-------|------|
| `accent` | `#c1272d` | CTAs, focus, active nav, deudor saldo |
| `accent-hover` | `#9a1f24` | Primary button hover |
| `accent-soft` | `#fdf2f2` | Subtle alert background, selected row |
| `accent-foreground` | `#ffffff` | Text on accent |

### Color tokens — Status (limited use)

| Token | Value | Role |
|-------|-------|------|
| `success` | `#0d6e3d` | Confirmed payments, healthy status |
| `warning` | `#b8741a` | Stale imports, soft alerts |
| `danger` | `#c1272d` | Errors (same as accent + "Error" label + icon) |
| `info` | `#1a4a7a` | Informational notes, neutral alerts |

### Typography

**Families:**

- **Display / titles:** Inter Display variable, weights 700–800, tracking `-0.02em`.
- **Body / UI:** Inter variable, weights 400 / 500 / 600.
- **Mono (critical data only):** JetBrains Mono 500. Used ONLY for: account balances, transaction amounts, receipt numbers, socio numbers, dates, IDs. NEVER in paragraphs, NEVER in labels.

**Type scale:**

| Token | Size / Line / Tracking | Weight | Use |
|-------|------------------------|--------|-----|
| `display` | 40px / 1.1 / -0.025em | 800 | Login hero, empty-state hero only |
| `h1` | 28px / 1.2 / -0.02em | 700 | Page titles |
| `h2` | 22px / 1.25 / -0.015em | 700 | Card section titles |
| `h3` | 17px / 1.3 / -0.01em | 600 | Sub-headings, card titles |
| `body-lg` | 16px / 1.55 | 400 | Lead paragraphs |
| `body` | 14px / 1.55 | 400 | Default body |
| `body-sm` | 13px / 1.5 | 400 | Metadata, helper text |
| `label` | 12px / 1.4 / +0.02em | 600 | UPPERCASE labels, table headers |
| `caption` | 11px / 1.4 | 500 | Hints, timestamps |
| `mono-lg` | 18px / 1.3 / 0 | 500 | Current balance display |
| `mono-md` | 14px / 1.4 / 0 | 500 | Amounts in tables |
| `mono-sm` | 12px / 1.4 / 0 | 500 | Receipt numbers, IDs |

### Spacing

- Base unit: 4px. Use 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.
- Card padding: 24px (default) or 32px (hero cards).
- Section vertical rhythm: minimum 32px (`space-y-8`).
- Table cell padding: 12px vertical, 16px horizontal.

### Radius

| Token | Value | Use |
|-------|-------|------|
| `radius-sm` | 4px | Badges, small chips |
| `radius-md` | 6px | Buttons, inputs, badges (default) |
| `radius-lg` | 8px | Cards, panels |
| `radius-none` | 0px | Tables, dividers, sidebar items, top bar |

### Borders

- Primary separator: `1px solid #e8e8e8` (`ink-100`).
- Card border: `1px solid #e8e8e8`. NEVER rely on shadow to delimit cards.
- Selected table row: `1px solid #e8e8e8` + `2px solid #c1272d` left accent + `bg #fdf2f2`.

### Shadows (floating elements only)

| Token | Value | Use |
|-------|-------|------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | Table row hover only |
| `shadow-md` | `0 4px 12px rgba(0,0,0,0.06)` | Popovers, dropdowns |
| `shadow-lg` | `0 12px 32px rgba(0,0,0,0.08)` | Modals, command palette |

### Motion

| Token | Value | Use |
|-------|-------|------|
| `duration-fast` | 150ms | Hover, color/bg changes |
| `duration-base` | 200ms | State transitions, focus rings |
| `duration-slow` | 300ms | Modal in/out, drawer |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default — smooth, no overshoot |

**Rules:** No springs, no bounces, no parallax, no scale on hover. Modal entrance: fade + 4px slide down.

---

## Base Component System

### Button

| Variant | Background | Border | Text | Padding | Notes |
|---------|-----------|--------|------|---------|-------|
| Primary | `accent` | none | `#ffffff` | 10px 16px | Weight 600. Hover: `accent-hover`. |
| Secondary | `#ffffff` | 1px `#d4d4d4` | `ink-700` | 10px 16px | Hover: bg `surface-elevated`. |
| Ghost | transparent | none | `ink-500` | 10px 16px | Hover: bg `surface-sunken`. |
| Destructive | `accent` | none | `#ffffff` | 10px 16px | Leading alert icon. Hover: `accent-hover`. |

**Universal rules:** height 36px (default) or 40px (lg); radius 6px; NO shadow; NO gradient; NO `rounded-full`. Disabled: 50% opacity, cursor not-allowed.

### Card

- Background `#ffffff`, border `1px solid #e8e8e8`, radius 8px, padding 24px.
- Header: title h3 (17px Inter Display 600), optional subtitle body-sm `ink-500`, optional right-aligned action.
- Header divider: 1px solid `ink-100` below header, 16px margin to body.
- NO shadow. NO inner glow.

### Table (critical — this is where operators live)

- Container: 1px `ink-100` border, radius 0 (tables are NOT cards).
- Header row: background `surface-elevated` (`#fafafa`), font label (12px uppercase 600 `ink-500`), padding 12px 16px, border-bottom 1px `ink-200`.
- Body row: padding 12px 16px, border-bottom 1px `ink-100`. NO zebra striping.
- Row hover: background `surface-elevated`.
- Selected row: background `accent-soft` (`#fdf2f2`) + left border 2px solid `accent`.
- **All numeric cells MUST use mono (`mono-md` 14px or `mono-sm` 12px)**, right-aligned.
- Debit/credit columns: tabular-nums, right-aligned.
- Deudor saldo (negative balance): color `accent`, weight 600.
- Saldo a favor (positive balance): color `ink-700`, weight 500.
- Empty state: centered icon + 14px `ink-500` message + optional CTA.
- Sticky header on scroll within scroll container.
- Pagination footer: 12px label, page-size selector (25/50/100), prev/next buttons.

### Input

- Border `1px solid #d4d4d4`, radius 6px, padding 10px 12px, height 40px.
- Background `#ffffff`, text `ink-700`, placeholder `ink-300`.
- Focus: border-color `accent`, box-shadow `0 0 0 3px rgba(193, 39, 45, 0.1)`. No layout shift.
- Error: border-color `accent`, helper message below in 13px `accent` with leading icon.
- Label above: 12px uppercase `ink-500`, weight 600, margin-bottom 6px.
- Disabled: background `surface-sunken`, text `ink-300`, cursor not-allowed.
- Required indicator: red asterisk on label, not on input.

### Sidebar / Nav Item

See Navigation section. Default/hover/active states defined per token table.

### Badge

| Variant | Background | Text | Use |
|---------|-----------|------|-----|
| Default | `surface-sunken` | `ink-700` | Neutral tags |
| Active / Success | `accent-soft` | `accent` | Selected filters, success states |
| Warning | `#fef7e6` | `#92670f` | Stale imports, soft alerts |
| Error | `accent-soft` | `accent` | Errors (paired with "Error" label) |
| Info | `#eef3f8` | `#1a4a7a` | Informational |

Padding `2px 8px`, radius 4px, font 12px Inter 500, no icon by default. NEVER pill-shaped.

### Modal

- Backdrop: `rgba(10, 10, 10, 0.5)`.
- Panel: `#ffffff`, radius 8px, `shadow-lg`, padding 24px, max-width 560px.
- Entrance: 300ms fade + 4px slide-down. No scale.
- Close: top-right X button, ESC key, backdrop click (unless form is dirty).
- Footer: right-aligned action group (secondary cancel + primary action).

### Toast / Alert Banner

- Position: top-right, 16px from edges, stacked.
- Variants: success / warning / error / info — each with leading icon.
- Background matches variant soft color; left border 3px solid variant.
- Duration: 5s for success/info, sticky for error until dismissed.

---

## Logo & Brand Identity

**Asset:** `openspec/image/logo.jpg` — official Club Atlético Gorriti escudo (angular red shield, white bold "CAG" monogram, black presentation background).

**Placement rules (strict):**

1. **Login screen:** centered on the dark left panel, size 160–200px tall, no surrounding decoration. The dark panel is enough statement.
2. **Top bar (authenticated):** 32px height, left-aligned, 12px margin from edge. Pair with text "Athlos · CAG" in 14px Inter 500 `#a0a0a0` immediately to the right.
3. **Empty states for first-run flows only** (e.g., no socios imported yet, no audit events). Centered, 96px tall, with primary CTA below.

**Placement prohibitions:**

- NEVER in the sidebar (the top bar already carries it).
- NEVER on cards, table headers, or buttons.
- NEVER as a watermark.
- NEVER at sizes below 24px (illegible).

**Variants:** Use the full-color version on white/dark backgrounds. Do not produce a monochrome version. If contrast is poor, change background — do not recolor the logo.

---

## Key Screens

### 1. Login (`/login`)

- **Layout:** split 40/60. Left 40%: `night-900` flat, escudo centered (180px tall), no gradient, no animation. Right 60%: `surface`, single auth card centered.
- **Card content:** wordmark "Athlos" (22px Inter Display 700), h1 "Iniciar sesión" (28px Inter Display 700), subtitle body-sm `ink-500` "Acceso para personal autorizado", email input, password input with show/hide toggle, primary "Ingresar" button (full-width 40px height), footer 12px `ink-300` "Club Atlético Gorriti · v{version}".
- **Error state:** inline below form, 13px `accent`, leading alert icon. No toast.
- **Loading:** button shows spinner, label changes to "Ingresando…", button disabled.

### 2. Dashboard (`/`)

- **Top bar:** night-900 with greeting "Hola, {firstName}" (14px Inter 500 `#d4d4d4`), notification bell (with red dot if unread count > 0), operator avatar.
- **Page header:** h1 "Resumen" + breadcrumb "Inicio / Dashboard".
- **KPI row (3–4 cards):** each card has uppercase 12px `label` `ink-500`, mono-lg number in `ink-900`, body-sm delta in `success` or `accent`. No chart sparklines on KPI cards — keep them scannable.
- **Freshness section:** card with h2 "Estado de importaciones", table of 14 domains: name, last import time (caption), status badge, action link.
- **Recent audit events card:** compact list, last 10 events, "Ver todo" link to `/audit`.
- **Charts (if any):** line/area with 1.5px stroke, no fill, no gradient. Grid lines `ink-100`. Axis labels 11px `ink-300`.

### 3. Socio Lookup (`/socios`)

- **Page header:** h1 "Socios" + primary "Importar archivo" button (accent).
- **Filter bar above table:** pill-style filters (estado, deporte, categoría). Active pill: `accent-soft` bg, `accent` text, 1px `accent` border. Inactive: `surface` bg, `ink-700` text, 1px `ink-200` border.
- **Search input:** full-width above filters, leading magnifier icon, placeholder "Buscar por DNI, nombre o número de socio".
- **Table columns:** N° Socio (mono-sm) · Nombre · DNI (mono-sm) · Estado (badge) · Deportes · Última cuota (mono-sm date).
- **Row click:** navigates to `/socios/:id`.
- **Empty state:** escudo (96px) + "Sin resultados" h3 + "Probá con otro término o importá un nuevo padrón" body-sm + primary CTA "Importar archivo".

### 4. Socio Detail (`/socios/:id`)

- **Header card:** name (h1, 28px), N° Socio mono-md, DNI mono-md, estado badge, action group right (right-aligned: "Ver cuenta corriente" secondary, "Editar" primary if RBAC allows).
- **Tabs (underline style):** Profile · Cuenta Corriente · Deportes · Cuotas. Active tab: 2px `accent` bottom border, `ink-900` text. Inactive: `ink-500` text, no border.
- **Cuenta Corriente tab:** summary strip (3 cells: Total cobrado mono-lg · Total pagado mono-lg · Saldo mono-lg, with deudor saldo in `accent`). Below: same table component as the standalone Cuenta Corriente, scoped to this socio.
- **Empty data tabs:** escudo + "Sin datos" + description.

### 5. Cuenta Corriente (`/account`)

- **Page header:** h1 "Cuenta corriente" + breadcrumb "Operaciones / Cuenta corriente" + secondary "Exportar CSV" button right.
- **Socio selector:** sticky bar at top of content, large search input + recent-selection chips.
- **Filter row:** date range (start / end inputs) + transaction type (cargo / pago / todos segmented control) + apply/clear buttons.
- **Summary card:** 3-cell grid, h2 "Resumen", Total Charged · Total Paid · Outstanding Balance (the last one in mono-lg `accent` if deudor, `ink-900` if a favor).
- **Transaction table:** Fecha (mono-sm) · Tipo (badge: cargo / pago) · Concepto · Debe (mono-md, right) · Haber (mono-md, right) · Saldo (mono-md right, color as per balance).
- **Pagination:** footer with 50 per page default.

### 6. Import Status (`/import`)

- **Page header:** h1 "Importaciones" + primary "Nueva importación" button.
- **Active import banner (if running):** `surface-elevated` card with status badge, current table name, progress bar (thin 4px, `accent` fill on `ink-200` track), records imported / total mono-md, elapsed time caption.
- **History table:** Batch ID (mono-sm) · Origen · Registros (mono-md, right) · Inicio (mono-sm datetime) · Duración (caption) · Estado (badge) · Operator.
- **Row click:** side drawer with full log (mono-sm, dark `night-900` bg, light text).
- **Dependency graph:** collapsed by default behind a "Ver dependencias" secondary button.

### 7. Audit Log (`/audit`)

- **Page header:** h1 "Auditoría" + secondary "Exportar CSV" button.
- **Filter bar:** Operator (select) · Entity Type (select) · Entity ID (input, mono-sm) · Action (select) · Date range. "Limpiar filtros" ghost button right.
- **Results table:** Timestamp (mono-sm) · Operator · Action (badge) · Entity · Details (truncated with hover for full).
- **Row expand:** inline diff panel — two columns "Antes" / "Después", mono-sm, `surface-sunken` background, additions in `success` background, removals in `accent-soft` background.
- **Sticky filter bar** on scroll.

### 8. Aprobaciones (`/approvals`, if enabled)

- **Page header:** h1 "Aprobaciones pendientes" + count badge in `accent` (e.g., "3").
- **List of pending items** as expandable cards: each card shows entity, requester, timestamp, context fields, and a fixed footer with primary "Aprobar" button + secondary "Rechazar" button.
- **Rejection flow:** clicking Rechazar expands a reason textarea (label uppercase `ink-500`, input with 3px focus ring) and reveals confirm "Confirmar rechazo" destructive button. Cancel collapses the reason field.
- **Approval toast:** success variant, "Aprobado" message, auto-dismiss 4s.

---

## Accessibility & Responsiveness

- All interactive elements MUST have a visible focus state (`accent` outline or 3px `accent` soft ring).
- Color is NEVER the only signal: deudor saldo uses `accent` color AND a leading "−" sign AND bold weight; success uses icon + color.
- Minimum tap target 36×36px. Buttons MUST be 40px on touch breakpoints.
- Sidebar collapses to drawer below 1024px. Tables become horizontally scrollable inside a 100% width container, never break the layout.
- Form inputs MUST have associated `<label>` (not placeholder-only).
- All mono numeric cells use `font-variant-numeric: tabular-nums`.

---

## Tone & Microcopy

- **Spanish (rioplatense neutral), concise, noun-first.**
- Labels: uppercase 12px Inter 600, no period. Example: "ESTADO", "ÚLTIMA CUOTA", "TOTAL COBRADO".
- Messages: human-readable, never codes. "La importación falló" — not "ERR_IMP_001".
- Buttons: verb-first, infinitive. "Importar archivo", "Aprobar", "Rechazar", "Ver cuenta corriente", "Exportar CSV".
- Empty states: short headline + one-line explanation + one primary action. Never wall-of-text.
- Error toasts: "Error · {what happened}. {what to do next}." Example: "Error · No se pudo guardar el pago. Reintentá o contactá al administrador."
- Success confirmations: 1 line, present tense. "Pago registrado."

---

### Requirement: Confirm-and-Wait Import Modal

The Import Status page (`/import`) MUST surface a "Nueva importación" primary action that opens a confirm modal before calling `POST /api/v1/import/trigger`. The modal MUST be styled per the existing Modal token (`shadow-lg`, `radius-lg`, fade + 4px slide-down entrance, 300ms).

The modal content MUST include:
- A short headline (verb-first, infinitive, e.g., "Importar 14 tablas")
- A one-line body explaining expected duration (e.g., "Esta operación puede tardar ~5 minutos")
- A visible countdown (30s → 0s) on the primary action label ("Importar ahora (30s)")
- Footer: secondary "Cancelar" (closes the modal, no request) + primary "Importar ahora" (decrementing countdown)

The countdown is purely client-side. The server's cancel window is enforced independently.

#### Scenario: Admin opens the modal and confirms within 30s

- GIVEN admin is on `/import` and clicks "Nueva importación"
- WHEN the modal opens
- THEN the primary button label MUST show "Importar ahora (30s)"
- AND the count MUST decrement once per second

- WHEN the admin clicks "Importar ahora" at second 12 (countdown shows "18s")
- THEN the client MUST call `POST /api/v1/import/trigger` with `{ domain: "all" }`
- AND the response MUST be 202 with `{ batchId: "<uuid>" }`
- AND the modal MUST close
- AND the page MUST show an active import banner with the returned `batchId`

#### Scenario: Admin cancels

- GIVEN the modal is open with countdown at 22s
- WHEN the admin clicks "Cancelar"
- THEN the modal MUST close
- AND NO request to `/api/v1/import/trigger` MUST be made
- AND no job MUST be enqueued

#### Scenario: Countdown reaches 0 without click

- GIVEN the modal is open and the countdown reaches 0
- WHEN 30 seconds elapse without user interaction
- THEN the modal MUST close automatically
- AND no request MUST be sent
- AND the same behavior as "Cancelar" applies

#### Scenario: Error response from trigger

- GIVEN the admin clicks "Importar ahora" and the server returns 500 (e.g., legacy DB unreachable)
- WHEN the client receives the error
- THEN the modal MUST display an error banner inside the modal panel (not a toast — modal context is preserved)
- AND the "Cancelar" + "Importar ahora" buttons MUST remain enabled so the admin can retry

### Requirement: Trigger Button Honors RBAC

The "Nueva importación" primary action on the Import Status page MUST be visible only to operators with role `ADMIN`. Operators without `ADMIN` MUST see the page (read-only) without the primary action.

#### Scenario: Admin sees the trigger

- GIVEN an operator with role `ADMIN` opens `/import`
- WHEN the page renders
- THEN the "Nueva importación" primary button MUST be visible in the page header (right-aligned per the existing page-header pattern)

#### Scenario: Non-admin does not see the trigger

- GIVEN an operator with role `OPERATOR` opens `/import`
- WHEN the page renders
- THEN the "Nueva importación" button MUST NOT be rendered
- AND the rest of the page (history table, dependency graph) MUST remain readable

### Requirement: Toast / Alert Banner Defaults

The system SHALL render toast notifications via a project wrapper around sonner, mounted once globally inside the root layout, with the following locked visual and behavioural contract:

- Position: `top-right`, 16 px from edges, stacked.
- Variants: `success` / `info` / `error`, each with a leading icon and rich-colour tint.
- Theme: pinned to `light` (no `prefers-color-scheme` follow-through — the design system has no dark mode).
- Close button: visible on every toast.
- Auto-dismiss: success and info dismiss after ~4000 ms; error dismisses after ~6000 ms (NOT sticky).
- ARIA: success and info toasts carry `role="status"`; error toasts carry `role="alert"`.

The wrapper exposes `notify(kind, message, opts)` so call sites never import sonner directly. Defaults are baked into the wrapper; callers SHALL NOT pass `position`, `theme`, or `closeButton`.

(Previously: the prose at `### Toast / Alert Banner` in this spec mandated `5 s for success/info` and `sticky for error until dismissed`. Those durations are superseded by the locked ~4000 ms / ~6000 ms auto-dismiss values above.)

#### Scenario: Success toast renders top-right with `role="status"`

- **WHEN** `notify('success', 'Pago registrado')` fires
- **THEN** the rendered toast is positioned top-right with `role="status"`
- **AND** auto-dismisses after ~4000 ms

#### Scenario: Error toast renders top-right with `role="alert"`

- **WHEN** `notify('error', 'No se pudo guardar el pago')` fires
- **THEN** the rendered toast is positioned top-right with `role="alert"`
- **AND** auto-dismisses after ~6000 ms
- **AND** does NOT require manual dismissal

#### Scenario: Theme pinned to light regardless of OS preference

- **WHEN** the operating system reports `prefers-color-scheme: dark`
- **THEN** the toast SHALL still render with the light palette
- **AND** SHALL NOT switch to a dark variant

#### Scenario: Wrapper is the single entry point

- **WHEN** a caller imports `notify` from `lib/notifications.ts` or `components/ui/Toast.tsx`
- **THEN** the defaults (`top-right`, `light`, `richColors`, `closeButton`) SHALL apply automatically
- **AND** the caller SHALL NOT need to pass them explicitly

## Success Criteria

- [ ] All screens consume design tokens; raw hex values do not appear in component code outside the token files.
- [ ] The Gorriti red `#c1272d` appears in < 5% of total screen real estate per page, except on screens whose primary purpose is action (login, aprobaciones).
- [ ] The escudo is present on exactly 3 contexts: login, top bar, first-run empty states — and nowhere else.
- [ ] All numeric data in tables uses JetBrains Mono with `tabular-nums`.
- [ ] No gradients, no button shadows, no `rounded-full` anywhere in the operator console.
- [ ] Sidebar uses `night-900` background with `accent` left-border on the active item.
- [ ] Page headers are uniform across screens: breadcrumb (12px uppercase) + h1 (28px Inter Display) + right-aligned action.
- [ ] Tables have no zebra striping, sticky header on long lists, and a deudor/a-favor color rule for saldo columns.
- [ ] Focus rings are visible on every interactive element using the 3px `accent-soft` ring.
- [ ] All buttons follow the four-variant system (Primary / Secondary / Ghost / Destructive) — no ad-hoc styles.
- [ ] All copy is in neutral Spanish, verb-first actions, no error codes exposed to operators.
- [ ] Responsive: sidebar becomes drawer below 1024px; tables scroll horizontally; no layout breakage.
- [ ] Motion uses only the three defined durations (150/200/300ms) and the standard easing — no springs or bounces.

---

## Delta — Synced from change `athlos-socio-legajo` (2026-07-07)

> Synced from change `athlos-socio-legajo` (2026-07-07).

This delta updates the Socio Detail page tab list to add the new `Legajo` tab, matching the layout patterns already established for the existing tabs (`Datos`, `Contacto`, `Cuenta`, `Auditoría`).

## ADDED Requirements

### Requirement: Legajo Tab on `/socios/[id]`

The Socio Detail page (`/socios/[id]`) SHALL render a `Legajo` tab in the existing tab list, ordered after `Auditoría`. The tab uses the underline-style pattern defined elsewhere in this spec:

- Inactive: `ink-500` text, no bottom border.
- Active: 2 px `accent` bottom border, `ink-900` text.
- Leading icon: Lucide `FolderOpen`, 16 px, color follows the tab's active/inactive text token.
- Label: "Legajo" in `label` (12 px / 1.4 / +0.02em / 600 / uppercase).

When the tab is active, the panel body SHALL render `<LegajoTab socioId={id} />` which composes three sub-components:

1. `<AttachmentUploadZone>` — a drag-and-drop drop zone + a click-to-pick `<input type="file" multiple={false} accept="image/jpeg,image/png,image/webp,image/gif,application/pdf">`. Drag-over visuals: `border-accent bg-accent-soft`. Client-side validation rejects oversized/disallowed files BEFORE calling the API and surfaces an inline error message ("Archivo excede 10 MB" / "Tipo de archivo no permitido").
2. `<AttachmentGrid>` — a grid of cards. Each card shows: image thumbnail (image MIMEs via `<img src=".../file">`) OR a Lucide `FileText` icon + download link (PDFs — no thumbnail in v1); the original filename; a category badge (`dni | comprobante | foto | contrato | otro`); uploader + upload timestamp; size in KB or MB.
3. `<AttachmentPreviewModal>` — a `<Modal>` (sticky header / scroll body / sticky footer) that renders the image inline (`<img>`) for image MIMEs OR a download `<a download>` link for PDFs.

Empty state (no active attachments): escudo icon (96 px) + "Sin archivos" h3 + "Subí un DNI, comprobante o foto para empezar" body-sm. Matches the precedent set by other empty tabs in this spec.

Delete flow: clicking the trash icon on a card opens a destructive `<Modal>` with the standard confirm pattern. On confirm, the row disappears from the grid; toast feedback fires via the existing `notify()` wrapper (`success` / `error`, per the `athlos-toast-primitivo` change).

#### Scenario: Legajo tab appears in the tab list

- **WHEN** the Socio Detail page renders
- **THEN** a tab labeled "Legajo" with a `FolderOpen` leading icon SHALL be visible in the tab list
- **AND** it SHALL appear after the "Auditoría" tab

#### Scenario: Active Legajo panel renders the tab body

- **WHEN** the operator clicks the Legajo tab
- **THEN** the panel under the tab SHALL render `<LegajoTab socioId={id} />`
- **AND** the active tab indicator SHALL switch to that tab

#### Scenario: Empty state renders shield + copy

- **WHEN** the operator opens the Legajo tab for a socio with no active attachments
- **THEN** an empty state SHALL render with the escudo icon, a "Sin archivos" h3, and the body-sm description
- **AND** the drop zone SHALL still be visible above the empty state so the operator can drop without scrolling

#### Scenario: Drop zone appears with hover affordance

- **WHEN** the operator drags a file over the drop zone
- **THEN** the zone SHALL switch to `border-accent bg-accent-soft`
- **AND** the system SHALL fire `dragover` preventDefault to allow the drop

#### Scenario: Image card shows thumbnail

- **WHEN** the grid renders an active image attachment (jpeg/png/webp/gif)
- **THEN** the card SHALL include an `<img>` whose `src` is the `/file` endpoint
- **AND** the image SHALL load successfully while authenticated

#### Scenario: PDF card shows FileText icon and download link

- **WHEN** the grid renders an active PDF attachment
- **THEN** the card SHALL show a Lucide `FileText` icon and the original filename
- **AND** SHALL include a download `<a href=".../file" download>` link
- **AND** SHALL NOT render an `<img>` thumbnail

#### Scenario: Click on image card opens preview modal

- **WHEN** the operator clicks an image attachment card
- **THEN** an `<AttachmentPreviewModal>` SHALL open
- **AND** the modal body SHALL render the image at full size
- **AND** the modal close button SHALL dismiss the preview

#### Scenario: Click on PDF card opens preview modal with download link

- **WHEN** the operator clicks a PDF attachment card
- **THEN** an `<AttachmentPreviewModal>` SHALL open
- **AND** the modal body SHALL contain a download `<a download>` link with the original filename

#### Scenario: Delete confirmation opens destructive modal

- **WHEN** the operator clicks the trash icon on an attachment card
- **THEN** a confirm `<Modal>` SHALL open with a destructive primary button labeled "Eliminar"
- **AND** on confirm, the `DELETE` API call SHALL fire

#### Scenario: Successful upload shows success toast

- **WHEN** a successful upload resolves
- **THEN** `notify('success', 'Archivo subido')` SHALL fire
- **AND** the new card SHALL appear at the top of the grid

#### Scenario: Oversize file shows inline error and does NOT call the API

- **WHEN** the operator drops a 12 MB file onto the drop zone
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Archivo excede 10 MB") SHALL display
- **AND** NO toast SHALL fire (inline errors are the canonical feedback for client-side validation)

#### Scenario: Disallowed MIME shows inline error and does NOT call the API

- **WHEN** the operator drops a `.txt` file onto the drop zone
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Tipo de archivo no permitido") SHALL display
