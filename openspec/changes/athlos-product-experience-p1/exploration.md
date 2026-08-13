## Exploration: athlos-product-experience-p1

### Current State
The public root is a single Gorriti-specific screen (`apps/web/src/app/page.tsx`) with only a login link; it exposes no member data, but it is not product-oriented and uses unsupported `night-950`, `primary-*`, and `slate-*` tokens. There is no public contact endpoint or form.

The authenticated dashboard is already separated from the public route and correctly composes workspace, member summary, notifications, and an ADMIN-only operational snapshot. It remains a set of generic cards: `WorkspaceCards` is navigation-led, `SociosSummary` exposes current counts, and `OperationsAttention` exposes scheduler work. The snapshot endpoint is ADMIN-only and returns readiness, freshness, jobs, and attention; it cannot power the requested role-aware institutional dashboard.

Socios is the strongest canonical interaction source: server-filtered/paginated data tables, URL-backed filters, compact status tabs, labelled controls, inline loading/error/empty states, token-based borders, mono numeric data, responsive grids, and role-gated actions. Its components mostly follow the intended language, although several older components retain shadow or rounded/pill patterns that P1 should not propagate.

RBAC is enforced server-side with `requireRole` and `requirePermission`; the client carries ADMIN, TESORERO, OPERADOR, and CONSULTA plus fine-grained permissions. Existing financial reads are per-member CTACTE endpoints available to every authenticated role. There is no global, period-scoped financial aggregate/trend API, nor a global workload/activity projection suitable for OPERADOR and CONSULTA views.

Email has a typed adapter, environment schema, DI container, notification channel, and SMTP-shaped configuration. However, `createRealEmail` is a placeholder that returns a synthetic message ID rather than sending mail; the notification dispatcher also assumes known internal recipients and event types. Therefore the contact delivery requirement is not currently deliverable through the existing implementation.

### Affected Areas
- `apps/web/src/app/page.tsx` — replace the Gorriti-only private-system landing with a public Athlos product landing and embedded contact flow; retain public-data isolation.
- `apps/web/src/app/(authed)/dashboard/page.tsx` and `apps/web/src/components/dashboard/*` — replace navigation-first dashboard composition with context, role-aware summary, period activity, and explicit states.
- `apps/web/src/components/tables/DataTable.tsx`, `apps/web/src/components/ui/Badge.tsx`, `apps/web/src/app/(authed)/socios/page.tsx` — canonical interaction and visual references; reuse patterns rather than duplicating table, feedback, and control behaviour.
- `apps/web/src/lib/navigation.ts`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/layout/Sidebar.tsx` — preserve role-aware navigation and keep technical operations ADMIN/special-permission only.
- `apps/api/src/routes/admin/operations.ts`, `apps/api/src/services/operational-snapshot.ts` — existing ADMIN-only technical snapshot must remain segregated from the new club-status projection.
- `apps/api/src/routes/ctacte.ts`, `apps/api/src/modules/ctacte/service.ts`, `apps/api/src/modules/ctacte/repository.ts` — current data source for financial facts, but only at a single socio scope; a new aggregate query/projection is required.
- `apps/api/src/container.ts`, `packages/config/src/schema.ts`, `packages/integrations/email/src/*`, `packages/notifications/src/*` — contact endpoint delivery, recipient configuration, real SMTP transport, timeout/failure behaviour, and test seam.
- `openspec/specs/ui-design/spec.md`, `openspec/specs/web-frontend/spec.md`, `openspec/specs/auth-login/spec.md`, `openspec/specs/api-security/spec.md` — canonical visual, RBAC, and public-endpoint security contracts needing delta specifications.

### Approaches
1. **Dedicated public contact route plus dashboard aggregate endpoint** — Add a public, strictly validated contact endpoint that calls the email adapter, and add a purpose-built authenticated club-status endpoint with role-specific projections and a constrained period parameter.
   - Pros: server-enforced privacy/RBAC; minimal public payload; efficient database aggregation; explicit loading/error semantics; keeps technical snapshot private.
   - Cons: requires real SMTP implementation, recipient configuration, abuse controls, aggregate query design, and route/API tests.
   - Effort: High.

2. **Client-side aggregation from existing member and CTACTE endpoints** — Build the landing form separately but assemble dashboard metrics by fetching existing endpoints and computing totals in the browser.
   - Pros: lower initial API surface change.
   - Cons: impossible to obtain club-wide finance efficiently or safely; leaks more data to clients; existing CTACTE reads are per-socio and shared with CONSULTA; cannot faithfully implement role-specific financial visibility or trends.
   - Effort: Medium, but not viable.

3. **Reuse the ADMIN operational snapshot for all roles** — Expand `/api/v1/admin/operations/snapshot` and hide individual widgets client-side.
   - Pros: one endpoint and existing polling hook.
   - Cons: violates least privilege by making technical state the dashboard contract; couples business status to scheduler/readiness; client-side hiding is not authorization; does not solve financial aggregates.
   - Effort: Medium, but not viable.

### Recommendation
Use Approach 1, delivered as chained work units under the 400-line review budget:

1. **Public contact foundation:** landing information architecture and embedded accessible form; a dedicated unauthenticated API contract; recipient set only through server configuration (never a browser-provided destination); Zod limits, honeypot, rate limit, CSRF/origin strategy, generic success/failure messages, and no persistence of submission content unless explicitly required.
2. **Delivery hardening:** replace the current synthetic real-email adapter with a tested SMTP transport; configure sender and implementation-contact recipient separately; ensure escaped/text-safe templates, bounded timeouts, structured redacted logging, and a failure path that does not disclose infrastructure details.
3. **Club-status read model:** add a server-side endpoint accepting only `current-month`, `last-60-days`, and `last-90-days`. Return stable current-state membership/data/system facts separately from period-bound activity/finance. Enforce ADMIN/TESORERO financial amount/trend fields on the server; return non-monetary workload counts for OPERADOR and a basic institutional summary for CONSULTA. Keep technical operations behind current ADMIN/special permissions.
4. **Dashboard and landing composition:** rebuild with the Socios hierarchy: context first, then summary, then workflow. Use neutral/bordered surfaces, dark institutional chrome, restrained red, display/body/mono roles, compact radii, responsive grid-to-stack behaviour, and explicit skeleton, empty, unavailable, and retry states. Do not add decorative navigation cards, false-zero values, gradients, glass effects, or private public content.

The dashboard needs a product metric matrix before implementation: exact definition/source/period behaviour for membership, data freshness, system health, workload, activity, cash-in/cash-out/net, and trend baseline. Finance must use authoritative query semantics (timezone, cancelled/reversed treatment, sign convention, and currency), not inferred client totals.

### Risks
- The real email adapter currently does not send email. A contact form without this repair would claim success while silently dropping leads.
- A public endpoint is an abuse surface. Recipient addresses must be server-configured; add rate limiting, bot mitigation, input/length limits, output escaping, log redaction, and a privacy notice/retention decision. Do not reuse approval-token exemptions.
- No global finance/workload aggregate exists. Building from per-member CTACTE APIs would be slow, inaccurate, and could disclose financial data to unauthorized roles.
- Existing CTACTE reads permit CONSULTA. The new dashboard endpoint must omit monetary fields server-side rather than depending on client composition.
- Period semantics require an agreed timezone and treatment of annulled/reversed movements. Without these, trends and month totals can be misleading.
- The existing UI specification contains some legacy patterns that conflict with the locked P1 direction (shadowed cards, `rounded-full` status/monogram, and pill-like filters). Socios should guide hierarchy and states, not be copied mechanically.
- Current worktree changes in `openspec/changes/operator-experience-foundation/{tasks.md,apply-progress.md}` are unrelated and must remain untouched.

### Ready for Proposal
Yes — the locked product decisions are sufficient for a proposal. The proposal should make the dedicated public contact route, real SMTP delivery, server-authorized club-status aggregate, role projection matrix, and privacy/abuse controls explicit scope. It should forecast chained PRs because the combined API, email, dashboard, and landing work will exceed 400 changed lines.
