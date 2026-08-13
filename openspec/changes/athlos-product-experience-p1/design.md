# Design: Athlos Product Experience P1

## Technical Approach

Add independent public inquiry (`web -> POST /api/v1/implementation-contact -> Email`) and authenticated status (`web -> GET /api/v1/club-status -> service -> repository`) flows. Reuse Fastify registration, `AppContainer` overrides, Zod config, `apiFetch`, the authenticated shell, and Socios cards; do not call or modify ADMIN operations.

## Architecture Decisions

| Decision | Choice and rationale | Rejected tradeoff |
|---|---|---|
| Contact boundary | `ImplementationContactForm` owns validation/submission state; `ProductLanding` owns copy/layout; `page.tsx` composes them. Server validation is authoritative. | Server actions bypass API security/plugin conventions. |
| Delivery | Keep `createEmail`/`AppContainer.email` as DI seams and use nodemailer in the real adapter. Tests retain/inject `StubEmail` and assert its instance-owned `stub.outbox`, matching `StubWhatsApp.messages`. | Route nodemailer or globals couple tests to transport/process state. |
| Status projection | Repository returns one internal model; service applies period logic and serializes a role-specific DTO. | Client filtering risks authorization leakage. |
| Unknown metrics | Emit authorized `unavailable` codes; omit unauthorized fields. | Zero/null conflates unknown, empty, and real zero. |

## Data Flow and Contracts

`POST /api/v1/implementation-contact` is public (`skipRouteAudit`), POST-only, credential-free, limited to 8 KiB and 3 requests/IP/15 minutes. Zod allows only `name(120)`, `organization(160)`, `role(100)`, `email(254)`, `primaryProblem(500)`, optional `phone(40)`, `message(2000)`, and hidden `website(120)`. Normalize CRLF, reject controls/newlines in single-line fields, escape HTML, and generate subjects server-side. Require an allowed `Origin`; absent Origin requires `Sec-Fetch-Site: same-origin`. Honeypot returns generic 202 without delivery; invalid origin 403; throttling 429 with `Retry-After`; validation returns field errors; SMTP rejection/timeout returns redacted 503; only acknowledged SMTP returns `200 {status:"sent"}`. Logs contain request id, outcome, and limit metadata only. No application/database/audit persistence occurs. The notice states Athlos does not persist inquiries and the recipient mailbox retains them until manual deletion.

`IMPLEMENTATION_CONTACT_RECIPIENT` is a server-only, single-mailbox Zod value. Outside tests, `validateEnv` rejects missing or invalid values during `buildContainer`, aborting registration/listen before the route accepts traffic. Payloads cannot select recipients. Nodemailer `sendMail` has a five-second timeout and returns only its acknowledged `messageId`; fabricated/pending IDs fail.

`GET /api/v1/club-status?period=` uses `requireAuth`; periods are `current-month` (default), `last-60-days`, and `last-90-days`. `container.clock` calculates Buenos Aires local-date, half-open boundaries: month start/next month start, or today minus 59/89 days through tomorrow.

DTOs include `period`, `generatedAt`, `membership.active`, and `freshness[{domain,status,lastImportAt}]`. ADMIN/TESORERO receive `finance.{debits,credits,net}` from in-range, non-annulled CTACTE decimal sums (`debe`, `haber`, `debe-haber`); currency appears only when authoritative. Their `unavailable` may include `finance.trend`, `debt.total`, `delinquency.count`, `activity.count`, `dataQuality.issueCount`, or `currency`. OPERADOR receives no finance and unavailable regularization workload until policy-backed; CONSULTA receives common institutional status only. Membership, delinquency, data-quality, system-state, and freshness/current-import queries receive no period bounds and remain stable across period changes for unchanged sources. Only finance and period activity vary. Unresolved semantics remain omitted with machine-readable `unavailable` codes—never guessed, null-coerced, or rendered zero. No individual rows, scheduler/jobs, readiness, evidence resolution, stewardship, or operation links enter this route.

## UI Composition

`/` server-renders the public landing with hero, Gorriti proof, capabilities, contact form, and secondary `/login`. Auth lives in browser `localStorage`, so `RootAuthHandoff` checks the existing auth module after hydration: authenticated operators get `router.replace('/dashboard')`; otherwise the landing remains. Middleware must not guess browser auth. Thus authenticated `/` resolves through protected `/dashboard` while visitors retain public `/`. `ClubStatusDashboard` makes one request and adds period control using Socios `MetricCard`/`StatusBadge` patterns. Render distinct loading, error, unavailable, empty, and zero states; absent fields create no cards. Preserve AppShell/MobileDrawer below 1024px, labels, inline errors, visible focus, 44px targets, live regions, non-color status text, and containment at 320/768/1024/1440px.

## File Changes

Create `apps/api/src/modules/club-status/{repository,service,types}.ts`, `routes/{club-status,implementation-contact}.ts`, and web API/components under `lib/api/` and `components/{landing,dashboard}/`; modify `server.ts`, `container.ts`, config/env examples, email package, root/dashboard pages, and focused tests. No schema migration.

## Testing Strategy

Unit tests cover validation/sanitization, recipient startup rejection, period/DST boundaries, decimal/annulment aggregation, four-role snapshots, every current-state category across periods, unavailable omission, SMTP acknowledgement/timeout, and instance-owned outbox assertions. Fastify injection covers method/auth, route-audit escape, origin/Fetch Metadata, honeypot, IP limit, redaction, recipient immutability, SMTP failure, escalation, and period stability. Root tests prove anonymous landing and hydrated-auth dashboard replacement. PostgreSQL proves CTACTE sums; RTL/axe and viewport E2E prove accessibility/containment. Staging SMTP must reach the configured mailbox.

## Threat Matrix

| Boundary | Applicability | Design response / RED tests |
|---|---|---|
| Documentation-like paths | N/A: no executable classification | None |
| Git repository selection | N/A: no VCS integration | None |
| Commit state | N/A: no VCS integration | None |
| Push state | N/A: no VCS integration | None |
| PR commands | N/A: no PR automation | None |

## Migration / Rollout

No migration. Auto-chain five autonomous, sub-400-line slices: (1) nodemailer/config/DI/stub, (2) contact API/security, (3) landing/form, (4) status repository/service/RBAC, (5) dashboard/responsive accessibility. Deploy config before contact; smoke-test and roll back slices independently, disabling contact first. No persisted inquiry or finance data needs reversal.

## Open Questions

None; unresolved metrics are unavailable, not blockers.
