# Delta for `ui-design`

## ADDED Requirements

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