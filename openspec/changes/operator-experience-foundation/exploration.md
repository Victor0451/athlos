# Operator experience foundation — exploration

## Outcome

Establish a clear public entry point and an operator experience that prioritizes actionable club operations while keeping privileged task execution in an administrative area. This is exploration only; no product scope is committed until the questions below are answered.

## Verified Current State

| Area | Evidence | Current behavior |
|---|---|---|
| Public root | `apps/web/src/app/page.tsx:1-10` | `/` is public and renders only “Athlos” plus “initializing”; it is not a landing page and has no sign-in or product journey. |
| Authenticated shell | `apps/web/src/components/AppShell.tsx:32-73` | `(authed)` pages use a client-side refresh gate, then render `Sidebar`, `Topbar`, and scrollable content. |
| Roles and permissions | `packages/auth/src/middleware.ts:91-153`; `apps/web/src/lib/auth.ts:65-70` | Roles are `ADMIN`, `TESORERO`, `OPERADOR`, and `CONSULTA`; server-side role/permission gates are authoritative. The UI also recognizes live `data_steward`. |
| Navigation and profile | `apps/web/src/components/layout/Sidebar.tsx:31-94`; `Topbar.tsx:27-76` | Sidebar filters routes by role/permission; Admin routes are flat entries. The profile area is username, role badge, notifications, and a direct “Salir” button—not a menu. |
| Dashboard | `apps/web/src/app/(authed)/dashboard/page.tsx:72-278`; `apps/web/src/lib/api/operations.ts:6-46` | Only ADMIN fetches the 30-second operational snapshot. It displays DB/schema readiness, master-table freshness/counts, scheduler job health, and up to 10 attention runs. Non-admins see the title but no snapshot-derived operational content. |
| Job operations | `apps/web/src/app/(authed)/admin/scheduler/page.tsx:31-144`; `scheduler/[name]/page.tsx:33-184` | Scheduler is ADMIN-only and supports status, job detail, manual run, and enable/disable. The API enforces ADMIN for operational snapshot and scheduler reads/actions. |
| Settings | `apps/web/src/app/(authed)/admin/settings/page.tsx:34-133` | Settings is ADMIN-only, shows a read-only current operator profile, and has a disabled password-change placeholder despite an existing API endpoint. |
| State and accessibility patterns | `DataTable.tsx:150-200`; `MetricCard.tsx:32-62`; scheduler pages | Reusable loading skeletons, role=status/alert, empty copy, focus rings, and responsive grid utilities exist. The sidebar itself is hidden below `lg`; no drawer trigger exists in the current shell. |
| Tests | `apps/web/src/app/(authed)/dashboard/page.test.tsx`; CodeGraph blast radius | Dashboard snapshot, role visibility, bounded attention rows, and refresh cadence are tested. No covering tests were found for `Sidebar`, `Topbar`, or `AppShell`. |

### Data and safety boundaries

- The snapshot intentionally returns independent readiness, freshness, job-health, and safe attention projections; it excludes raw errors and legacy-share signals (`openspec/specs/operational-snapshot/spec.md`).
- Scheduler execution is consequential: manual runs are ADMIN-only, rate-limited, audited, and enable/disable changes future schedules (`openspec/specs/scheduler-jobs/spec.md`).
- The UI design system is institutional/operator-console oriented. It requires token-only styling, explicit labels, visible focus, no decorative red, no gradients, and a dark drawer below 1024px (`openspec/specs/ui-design/spec.md`).

## UX and IA Problems

1. **Two competing meanings of “home.”** `/` is a vacant public endpoint, while the actual dashboard is `/dashboard`; existing design documentation also describes `/` as Dashboard. Visitors and operators have no coherent entry path.
2. **The dashboard mixes executive awareness with implementation telemetry.** Job names, cron expressions, and individual task runs consume primary dashboard space, yet only ADMIN can see the data. Most roles receive no useful starting point after sign-in.
3. **Task controls are present but not explicitly separated from routine administration.** Scheduler is correctly protected, but it is surfaced alongside operational navigation and duplicated on the dashboard, increasing cognitive load and the risk of treating execution controls as day-to-day work.
4. **The profile affordance is not a profile menu.** Identity, role, notifications, and logout are separate controls; account actions cannot grow without crowding the top bar. Settings is also ADMIN-only even though profile/password actions are naturally personal.
5. **Responsive navigation has a documented-but-unimplemented gap.** The specification requires a drawer below 1024px; the current sidebar is simply hidden below `lg` and Topbar has no menu trigger.

## Affected Areas

- `apps/web/src/app/page.tsx` — public landing page and public-to-authenticated handoff.
- `apps/web/src/components/AppShell.tsx` — authenticated shell, mobile navigation state, and content hierarchy.
- `apps/web/src/components/layout/Sidebar.tsx` — information architecture, role/permission visibility, and Admin grouping.
- `apps/web/src/components/layout/Topbar.tsx` — profile-menu interaction, personal actions, and logout placement.
- `apps/web/src/app/(authed)/dashboard/page.tsx` and `apps/web/src/lib/api/operations.ts` — dashboard prioritization and use of the existing safe snapshot.
- `apps/web/src/app/(authed)/admin/scheduler/**` and `apps/web/src/components/scheduler/**` — privileged job monitoring/execution destination.
- `apps/web/src/app/(authed)/admin/settings/page.tsx` and `apps/web/src/components/admin/OperatorProfile` — account versus system administration boundary.
- `apps/web/src/**/**.test.tsx` — new behavioral coverage; especially absent shell/navigation/profile tests.
- `openspec/specs/web-frontend/spec.md` and `openspec/specs/ui-design/spec.md` — current requirements that conflict with the intended public landing and mobile-navigation direction.

## Approaches

1. **Public landing + role-aware operational home + Admin operations area**
   - Keep `/` public, make it a focused landing page with one primary authenticated conversion path, and retain `/dashboard` as the protected operator home.
   - Make the dashboard role-aware: universal work orientation and actionable domain signals first; ADMIN gets a compact “needs attention” summary linking to Admin operations rather than embedded execution detail.
   - Consolidate scheduler/task monitoring and execution under an explicit Admin “Operations” or “System” grouping; preserve existing server gates.
   - Pros: separates audiences, minimizes API work, preserves safety boundaries, and gives every role a useful starting point.
   - Cons: requires product decisions on dashboard priorities and account/settings access.
   - Effort: Medium to High.

2. **Single authenticated root dashboard**
   - Redirect `/` to `/dashboard` and improve only the authenticated dashboard/navigation.
   - Pros: lower route and visual scope.
   - Cons: does not deliver the requested public landing experience and retains the audience ambiguity.
   - Effort: Medium.

3. **Marketing-first landing plus broad dashboard data expansion**
   - Build a richer public marketing site and add new aggregate APIs for each role’s dashboard.
   - Pros: strongest long-term positioning and potentially tailored dashboards.
   - Cons: risks expanding into unvalidated marketing claims and backend/data-contract work before priorities are known.
   - Effort: High.

## Recommendation

Adopt Approach 1 in two deliberately bounded slices: first, create the public landing, profile-menu foundation, mobile navigation completion, and a role-aware dashboard information hierarchy using existing safe data; second, relocate detailed job/task operations into an explicitly ADMIN-only Admin area and add only the necessary navigation/settings refinements. Do not duplicate execution controls on the operator home. The dashboard should answer “what requires my attention and what can I do next?”, while Admin operations should answer “how is the system executing and how do I intervene safely?”

## Scope Boundaries

### In scope for discovery-led proposal

- A public `/` landing outcome and primary path into authentication.
- Sidebar/topbar/profile information architecture, including the documented mobile drawer gap.
- Dashboard hierarchy and role-aware usefulness based first on existing snapshot/data surfaces.
- Clear ADMIN-only placement of scheduler/job execution and monitoring.
- Loading, error, empty, responsive, focus, and test expectations for touched surfaces.

### Out of scope unless explicitly chosen

- New business-domain workflows, new job execution capabilities, or loosening server-side authorization.
- Exposure of raw errors, scheduler metadata, or unsafe operational data.
- A general marketing CMS, analytics program, or new backend aggregates not justified by a dashboard decision.
- Changing scheduler semantics, rate limits, auditing, or task execution safety controls.
- Implementation, proposal, specification, design, or task planning in this phase.

## Risks

- **Audience ambiguity:** a public landing can become generic marketing rather than a credible club operations entry point without a defined visitor and conversion outcome.
- **Unsafe or noisy dashboard:** surfacing more telemetry does not make an operator more effective; the dashboard must privilege actionability over exhaustiveness.
- **Authorization drift:** navigation changes must not be mistaken for access control; all sensitive routes and actions must retain API enforcement.
- **Scope growth:** landing, shell, profile, dashboard, and Admin IA can exceed the 400-line review budget. With `ask-on-risk`, planning must split work when the forecast is high.
- **Spec reconciliation:** current OpenSpec documentation assigns `/` to dashboard and requires a mobile drawer that the implementation lacks; a later change must deliberately update the contract.
- **Test gap:** shell/sidebar/topbar behavior currently lacks direct coverage, making regression risk higher than the dashboard itself.

## Product Decisions Needed Before Proposal

1. **Public landing:** Who is the primary visitor to `/` (club leadership, staff, prospective clients, or all of them), and what single outcome should the page drive: sign in, request access/demo, or understand Athlos?
2. **Operator dashboard:** For each non-admin and ADMIN, what are the top three decisions or next actions the home must enable during a normal day?
3. **Jobs and task operations:** Should detailed job history, manual execution, and enable/disable live under an ADMIN-only “Operations” area, ADMIN “Settings,” or a distinct Admin section—and is any read-only health summary appropriate for non-admin roles?
4. **Profile menu:** Which actions belong to every operator’s profile menu now: account overview, change password, notification preferences, sign out, or another action? Should personal settings be available to all authenticated roles while system settings remain ADMIN-only?
5. **First slice:** Should the first implementation slice be limited to public landing + shell/profile/mobile navigation + dashboard hierarchy using existing APIs, deferring job relocation and any new data contracts to a second slice?

## Confirmed Product Direction

| Decision | Confirmed direction |
|---|---|
| Public landing | `/` is an internal-club descriptive landing for the private server. It explains Athlos capabilities, objectives, priorities, and system context; it is not a marketing, demo, or lead-generation page. |
| Dashboard | The home should provide quick-glance, module-oriented information that helps each profile decide what to do next. Detailed telemetry is not the default home content. |
| Job operations | Task/job monitoring and intervention belong in `ADMIN → Operations`, within the administrative/configuration area. |
| Profile and settings | Every authenticated role receives a personal profile menu: account overview, password change, notification preferences, and sign out. Personal settings are separate from ADMIN-only system settings. |
| First slice | Landing, shell/profile/mobile navigation, and dashboard hierarchy must use existing APIs. Full task relocation and any new data contracts are deferred to slice two. |

## Recommended Role-Aware Dashboard Model

### Shared frame for every authenticated role

1. **Welcome and orientation** — concise role-aware title, current date, and a short explanation of the operational scope; do not call this public-facing “home.”
2. **My notifications** — retain the existing personal notification bell and offer an in-context “View notifications” link. The existing endpoints are authenticated and recipient-scoped; no new API is needed.
3. **Workspaces** — three or four labeled route cards, not telemetry: `Socios`, `Cuenta corriente`, `Padrones`, plus only the role-allowed administrative/data-steward destination. Each card explains its operational purpose and links to its existing route.
4. **Data awareness, not raw infrastructure** — show a compact freshness/status summary only where the viewer is authorized to receive it; link to the owning module. Do not put job names, cron expressions, run histories, manual triggers, or enable switches on this surface.
5. **States** — use existing skeleton, empty, error, focus, and safe-message patterns. A missing signal must say what is unavailable and keep other cards useful.

### Dashboard matrix

| Profile | Universally useful cards and summaries | Role-specific priority | Actionable links in slice one | Existing data/API surface | Deferred because it needs a new API or product contract |
|---|---|---|---|---|---|
| `ADMIN` | Workspaces, personal notifications, Socios member-state summary, compact system/data freshness state | “Needs attention” list limited to safe, high-level signals: unavailable DB/schema, stale domains, or failed attention runs; it is a link-out summary, not execution UI | `/socios`, `/ctacte`, `/padrones`, `/admin/operations` (new IA destination; existing scheduler route can remain behind it), `/admin/settings`, personal settings | `GET /api/v1/socios?aggregate=1`; existing operational snapshot; authenticated notification APIs | Cross-module business queue, financial totals, a unified approval count, and an aggregate “today” activity feed. Existing snapshot is ADMIN-only but operational, not a business work queue. |
| `TESORERO` | Workspaces, personal notifications, Socios member-state summary if the read endpoint remains available to the role | Financial orientation should be route-led: explain the purpose of Cuenta corriente and surface the most recent/selected-account context only after navigating there | `/ctacte`, `/socios`, `/padrones`, personal settings | Existing per-socio cuenta-corriente API returns a selected socio’s balance and movements; it does **not** return a club-wide financial summary | Club-wide balance, overdue/debtor counts, daily collection, outstanding exceptions, and gasto/ctacte aggregate cards. Gastos is ADMIN-only today. |
| `OPERADOR` | Workspaces, personal notifications, Socios member-state summary if authorized | Fast access to member lookup/data-entry context and current data availability; no financial or system controls | `/socios`, `/ctacte`, `/padrones`, personal settings; data-steward exception/catalog links only when permission is present | Existing Socios list/search and aggregate; authenticated notifications; existing permission-aware sidebar | “My assigned work,” recently changed members, import progress initiated by this operator, or data-quality queues require an assignment/activity API or confirmed ownership model. |
| `CONSULTA` | Workspaces, personal notifications, read-only Socios member-state summary if authorized | Read-only orientation and safe discovery; never imply an action they cannot perform | `/socios`, `/ctacte`, `/padrones`, personal settings | Read routes and operator lookup are specified for any authenticated role; no mutation link should be presented | A tailored reporting snapshot, saved views, exports, or audit summary require explicit read-model and access decisions. |

### Existing-data implementation rules for the first slice

- **Use `getSociosAggregate()` as the only module KPI candidate already shaped for a dashboard.** It returns active, suspended, cancelled, and total member counts in one call. Its authorization must be confirmed against the current route implementation before exposing it to each non-admin role; UI visibility never replaces API enforcement.
- **Keep Cuenta corriente contextual, not aggregate.** The current API needs a socio ID and returns that socio’s balance/movements. It cannot truthfully power club-wide finance cards.
- **Use the operational snapshot only for ADMIN.** It already has bounded, safe readiness/freshness/job/attention data and a 30-second cadence. Reduce it to a small “system needs attention” summary with navigation to `ADMIN → Operations`; retain no execution control on Dashboard.
- **Use personal notifications for every signed-in profile.** They are already scoped to the authenticated recipient and can support a consistent “My notifications” entry point. Notification preferences have storage but no current UI or API contract, so the profile-menu destination can be a clearly scoped placeholder only if the first slice includes no new API.
- **Treat navigation cards as summaries when data is unavailable.** For Padrones and other modules whose aggregate/readiness endpoint was not verified in this exploration, show purpose plus route link—not invented counts or status.

### `ADMIN → Operations` information architecture

The proposed destination is an ADMIN group entry that owns the existing scheduler list/detail routes and later any task/run history. It separates three concerns:

1. **Operations overview** — safe health and attention summary, read-only at first glance.
2. **Scheduled jobs** — existing job list and detail, including manual run and enable/disable behind their existing confirmation, rate-limit, audit, and API role gates.
3. **System settings** — remains ADMIN-only and separate from the all-role personal settings area.

The first slice may rename/re-group navigation and remove detailed scheduler cards from Dashboard, but full route relocation is deferred as confirmed. It must not weaken or duplicate the server-side `requireRole('ADMIN')` gates.

## Landing Content Direction

The landing should be an internal orientation page: what Athlos centralizes for Club Atlético Gorriti, the operational capabilities it supports (member records, account context, rosters/padrones, governed administration), its priorities (traceability, controlled access, reliable information), and the private-server context. The primary interaction is “Iniciar sesión”; it must not contain sales claims, demos, pricing, contact capture, or public operational data.

## Remaining Product Decision

**No blocking product decision remains for proposal creation.** The first-slice scope, dashboard principle, audience, profile boundary, and privileged-operations location are now defined. Proposal work may begin only after the requested exploration review is accepted.

## Ready for Proposal

**Yes, after exploration review.** The proposal should preserve the two-slice boundary and forecast the 400-line review budget before implementation. This exploration phase remains complete; no proposal, specification, design, tasks, or code were created.
