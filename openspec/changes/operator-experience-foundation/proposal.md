# Proposal: Operator Experience Foundation

## Intent

Replace the empty root and ADMIN dashboard with an internal landing, truthful role orientation, and complete personal/mobile navigation without weakening authorization.

## User and Business Outcomes

- Visitors understand Athlos's private purpose and reach sign-in.
- Operators quickly identify permitted workspaces and personal actions.
- ADMIN sees safe attention signals without mixing routine work with execution controls.

## Scope

### First Slice

- Make `/` a descriptive Club Atlético Gorriti private-server landing with **Iniciar sesión** as its sole primary action.
- Make `/dashboard` role-aware using recipient-scoped notifications, authorized Socios aggregates, and the ADMIN-only bounded snapshot. Use route cards instead of invented totals.
- Give every role personal account overview, password change, notification-preferences entry, and sign-out actions. Preferences remain read-only until contracted.
- Complete the accessible mobile drawer and permission-aware navigation.
- Group existing ADMIN task/job links under administrative **Operations** without moving scheduler routes.

### Non-Goals / Slice Two

- No full job-route relocation, new aggregates/contracts, preference editing, execution capability, or scheduler semantic change.
- Slice two will relocate job surfaces fully and add only separately specified data contracts.
- No marketing, lead capture, public operational data, or authorization relaxation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-frontend`: public root, role-aware dashboard, personal menu, mobile shell, and administrative Operations grouping.
- `ui-design`: `/` becomes the internal landing and `/dashboard` the operator home; responsive and navigation contracts are reconciled.

## Approach and Authorization

Reuse current auth/session, permission filtering, state patterns, and API clients. UI visibility is not access control. Snapshot and scheduler APIs stay ADMIN-only; manual runs and enable/disable retain confirmation, rate limits, auditing, and `requireRole('ADMIN')`. Personal profile and notifications remain authenticated and operator-scoped.

## Affected Areas

| Area | Impact |
|---|---|
| `apps/web/src/app/page.tsx` | Internal landing |
| `apps/web/src/app/(authed)/dashboard/**` | Role-aware home |
| `apps/web/src/components/{AppShell,layout/**}` | Personal/mobile/Admin IA |
| `openspec/specs/{web-frontend,ui-design}/spec.md` | Contract deltas |

## Risks

| Risk | Mitigation |
|---|---|
| Authorization or misleading data | Preserve API gates; render only verified authorized data |
| Shell regressions | Specify states, focus, and responsive behavior |
| **400-line review-budget overrun** | **Ask-on-risk**: forecast before apply and request approval to chain reviewable slices if risk is high |

## Rollback Plan

Revert first-slice UI and spec deltas together; existing APIs and scheduler routes remain unchanged.

## Dependencies

- Existing auth, Socios, notifications, snapshot, and scheduler contracts.

## Success Criteria

- [ ] `/` explains the private system and leads primarily to sign-in.
- [ ] Each role sees only truthful, authorized dashboard/navigation choices.
- [ ] Personal actions and mobile navigation work for every role.
- [ ] ADMIN Operations preserves all existing server-side safety controls.
