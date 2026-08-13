# Apply Progress: Athlos Product Experience P1

## S1 / PR1: SMTP/config foundation

**Status:** Complete. Task 1.3 is complete after deployment and verification of the exact S1 candidate. The historical pre-deployment candidate mismatch and first post-deployment harness defect remain recorded below; the final corrected proof is recorded in the completion section.

### Completed Tasks

- [x] 1.1 RED tests for SMTP acknowledgement, fabricated identifiers, timeout, instance-owned stub outboxes, and startup recipient validation.
- [x] 1.2 GREEN nodemailer transport, five-second bounded delivery, acknowledgement validation, config schema, and container wiring.
- [x] 1.3 `.env.example` and automated checks complete; exact S1 candidate deployed; one candidate-valid BETA SMTP acknowledgement and sanitized runtime invariants recorded below.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `packages/integrations/email/src/{real,stub}.test.ts`, `apps/api/src/container.test.ts` | Unit | `packages/notifications/src/dispatcher.test.ts`: 17/17 | 6 failures across 7 email tests; 2 recipient-validation failures | 10/10 focused tests passed | Acknowledged, fabricated/missing ID, timeout; missing/invalid recipient; isolated outboxes | Cleared the transport timeout timer after every send |
| 1.2 | Same focused tests | Unit | Same baseline | Tests written before production changes | 10/10 focused tests passed | Same contract branches | Transport injection retained only as an instance seam |
| 1.3 pre-deployment | N/A | Runtime/config | N/A | N/A | `.env.example` updated and format/type checks passed; focused code/tests passed in the first bounded attempt | Read-only candidate/BETA comparison at `2026-08-10T21:07:08Z` proved deployed BETA contains older code/config (6/7 S1 fingerprints differ); no email was sent because BETA could not prove this candidate | N/A |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Bounded attempt 1: focused code/tests | Passed: `pnpm exec vitest run packages/integrations/email/src/real.test.ts packages/integrations/email/src/stub.test.ts` → 2 files, 7 passed; `pnpm --filter @athlos/api exec vitest run src/container.test.ts` → 1 file, 3 passed; compatibility safety net `pnpm --filter @athlos/notifications exec vitest run src/dispatcher.test.ts` → 1 file, 17 passed. Typecheck and Prettier checks also passed. |
| Bounded attempt 2: BETA candidate comparison | Read-only SSH fingerprint check at `2026-08-10T21:07:08Z` compared the candidate and BETA hashes for `packages/integrations/email/src/{real,stub,types,index}.ts`, `packages/config/src/schema.ts`, `apps/api/src/container.ts`, and `.env.example`; 6/7 differ (`index.ts` matches), proving deployed BETA contains older code/config. Candidate-valid execution is impossible against this BETA state; no configuration was read or mutated, and no email was sent. |
| Rollback boundary | Revert `.env.example`, `packages/integrations/email/`, `packages/config/src/schema.ts`, `apps/api/src/container.ts`, `pnpm-lock.yaml`, and `apps/api/src/container.test.ts`; no route or persistence behavior was added. |

### Final S1 Completion Evidence

| Evidence | Result |
|---|---|
| Main merge | PR #252 merged to `main` as `f8381b7`. |
| BETA promotion | Promotion PR #254 merged to `beta` as `d690f4d`. |
| BETA release | `v0.6.0-beta.5`; workflow run `31505767901` succeeded. |
| Corrected deployed-adapter proof | At `2026-08-11T18:08:06Z`, exactly one corrected deployed-adapter `sendMail` call was accepted and returned a real non-synthetic message ID; its raw value was not recorded. |
| Runtime invariants | API/web health and readiness passed; migration status was clean; container IDs and restart counts were unchanged. |
| Sensitive-data handling | Raw credentials, addresses, and content were not recorded. |

### Historical Post-Deployment Harness Evidence

- The first post-deployment attempt at `2026-08-11T15:35:29Z` passed top-level `await` to `tsx -e`; it exited before invoking the deployed adapter, produced empty stdout, and redirected stderr away. This was a harness/process-capture defect, not provider evidence.
- The corrected proof used an async IIFE and was the only subsequent `sendMail` call. Its acknowledgement was retained only as a sanitized accepted/non-synthetic classification.

### Checks

- `pnpm --filter @athlos/integrations-email typecheck && pnpm --filter @athlos/config typecheck && pnpm --filter @athlos/api typecheck` → passed.
- `pnpm exec prettier --check apps/api/src/container.ts apps/api/src/container.test.ts packages/config/src/schema.ts packages/integrations/email/package.json packages/integrations/email/src/real.ts packages/integrations/email/src/real.test.ts packages/integrations/email/src/stub.ts packages/integrations/email/src/stub.test.ts packages/integrations/email/src/types.ts` → passed.

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S1 / PR1 only. S2 through S5 are out of scope.
- Review impact: 287 authored additions and deletions, within the 400-line budget.

### Remaining S1 Work

- None. No further SMTP attempts are authorized or needed for this verification.

## PR #252 CI Fixture Remediation

**Native attempt token:** `sha256:8e1d863e71fa96fe30890c384eda4c320f5026c7193a614816d85f3eadef84c3`

### Scope and Result

- Added the non-sensitive `test-recipient@example.test` recipient only to the three production-mode server fixtures that now exercise required recipient validation.
- Production validation and application behavior remain unchanged. The historical statement that task 1.3 was pending applies to the pre-deployment state; final S1 completion is recorded above.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net / RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| PR #252 deterministic CI fixture correction | `apps/api/src/plugins.test.ts`, `apps/api/src/server.test.ts` | Integration | `pnpm --filter @athlos/api exec vitest run src/plugins.test.ts src/server.test.ts` failed: 3 failed, 20 passed; each failure required `IMPLEMENTATION_CONTACT_RECIPIENT` in a production fixture | Same command passed: 2 files, 23 passed | Three production fixtures exercise the corrected startup boundary; non-production fixtures remain unchanged | None needed; fixture-only correction |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/api exec vitest run src/plugins.test.ts src/server.test.ts` → passed: 2 files, 23 tests. |
| Runtime harness | `fastify.inject` production bootstrap paths in the focused tests → passed; no external SMTP transport or delivery was invoked. |
| API typecheck | `pnpm --filter @athlos/api typecheck` → passed. |
| Check-only formatting and diff | `pnpm exec prettier --check apps/api/src/plugins.test.ts apps/api/src/server.test.ts` and `git diff --check` → passed. |
| CI-equivalent suite | `pnpm test:run` reached `@athlos/db` and failed only because `ATHLOS_TEST_DATABASE_URL` is unset for seven PostgreSQL integration suites; the web suite passed 89 files / 748 tests before that expected environment gate. |
| Rollback boundary | Revert only `apps/api/src/plugins.test.ts` and `apps/api/src/server.test.ts`; this removes the fixture recipients without changing production validation or runtime behavior. |

## S2 / PR2: Public contact API/security

**Status:** Complete. The public POST route validates only approved fields, uses the server-validated recipient, and sends only after the injected email adapter acknowledges. It creates no application, database, or audit record.

### Completed Tasks

- [x] 2.1 RED Fastify-injection tests for method, approved fields, numeric limits, origin, credentials, honeypot, IP throttling, recipient, redaction, SMTP failure, and no delivery on abuse.
- [x] 2.2 GREEN contact route registration with route-audit exemption, 8 KiB body cap, per-IP 3/15-minute limit, origin/Fetch Metadata boundary, HTML escaping, generic failures, and no persistence.
- [x] 2.3 Endpoint/config documentation in the route contract; abuse tests prove no email delivery. The existing `.env.example` documents the server-only recipient.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `apps/api/src/routes/implementation-contact.test.ts` | Integration | `src/server.test.ts`: 10/10 | 8 tests failed with route 404 before registration | 8/8 focused tests passed | Valid/invalid fields; allowed/disallowed origin; SMTP ack/failure; three/fourth IP requests | Sequential throttle injection avoids a test-harness concurrency race |
| 2.2 | Same | Integration | `src/server.test.ts`: 10/10 | Route tests first exposed 413 and 429 incorrectly mapped to 500 | 8/8 focused tests passed after preserving safe Fastify error semantics | Body-limit and dedicated limiter errors prove no delivery | Extracted bounded field schema, escape helper, and allowed-origin helper |
| 2.3 | Same | Integration | N/A (documentation only) | Existing abuse scenarios were RED before the route | 8/8 focused tests passed | Honeypot, origin, credential, malformed body, and throttled attempts retain empty outboxes | Route contract documents recipient/config and privacy boundary |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/api exec vitest run src/routes/implementation-contact.test.ts` → passed: 1 file, 8 tests. |
| Safety-net test command | `pnpm --filter @athlos/api exec vitest run src/server.test.ts` → passed: 1 file, 10 tests. |
| Runtime harness | Fastify `app.inject` exercised POST, validation, origin, cookie rejection, honeypot, configured recipient, SMTP failure, 8 KiB limit, and the fourth request from one IP → passed; injected `StubEmail` outboxes prove abuse does not deliver and no external email was sent. |
| API checks | `pnpm --filter @athlos/api typecheck` and `pnpm --filter @athlos/api build` → passed. |
| Check-only formatting and diff | `pnpm exec prettier --check apps/api/src/routes/implementation-contact.ts apps/api/src/routes/implementation-contact.test.ts apps/api/src/plugins/error-handler.ts apps/api/src/server.ts` and `git diff --check` → passed. |
| Rollback boundary | Revert `apps/api/src/routes/implementation-contact.{ts,test.ts}`, its `server.ts` registration, and the safe 413/429 mapping in `plugins/error-handler.ts`; this removes S2 without touching S1 SMTP/config or S3 UI. |

### Security and Privacy Evidence

- Route is POST-only, `skipRouteAudit`, unauthenticated, and rejects cookies; it removes the credentialed CORS response header while the global CORS allowlist remains unchanged.
- Payloads are strict, bounded, CRLF-safe for single-line fields, HTML-escaped for email, and recipient selection uses only `IMPLEMENTATION_CONTACT_RECIPIENT`.
- The route neither calls database/audit APIs nor logs body, contact, recipient, or SMTP values; SMTP failures return only the generic retry response.

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S2 / PR2 only, dependent on completed S1 / PR1; S3 through S5 are out of scope.
- Review impact: 300 authored code additions before SDD evidence, within the 400-line budget.

## S3 / PR3: Product landing/contact UI

**Status:** Complete. The public root now presents Athlos first, uses Gorriti only as the current edition proof, and offers a credential-free embedded inquiry workflow with a hydrated local-auth handoff. The consolidated behavioral coverage is `apps/web/src/app/page.test.tsx` (4 tests); no landing-component test files are claimed.

### Completed Tasks

- [x] 3.1 RED landing/form tests for positioning, approved fields, privacy, login, validation, submit states, duplicate protection, keyboard focus, and authenticated replacement.
- [x] 3.2 GREEN landing, form, minimal credential-free API client, and `/dashboard` auth handoff.
- [x] 3.3 Focused accessibility/privacy/public-boundary verification and documented form behavior.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `apps/web/src/app/page.test.tsx` (consolidated; 4 tests) | Integration | Existing root test: 2/2 | 4/4 failed before implementation (missing edition, form, and handoff) | 4/4 passed | Anonymous/authenticated; local/API validation; success/429/503 | Fixed optional-field omission and API validation details |
| 3.2 | `apps/web/src/app/page.test.tsx` (same consolidated suite) | Integration | Same | Tests existed before components/client | 4/4 passed | Submitted payload excludes blank optional values; requests omit credentials | Kept client minimal and isolated |
| 3.3 | `apps/web/src/app/page.test.tsx` (same consolidated suite) | Integration | Same | Keyboard/status assertions were introduced before final UI behavior | 4/4 passed | Focus, field errors, success, rate limit, and unavailable retry all exercised | Compact token-only layout retained |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` → passed: 1 file, 4 tests. |
| Runtime harness | RTL user-event exercised native keyboard focus, validation, duplicate-submit lock, mocked success, 429, and 503 browser submission states; no real email was sent. |
| Web checks | `pnpm --filter @athlos/web typecheck` and `pnpm --filter @athlos/web build` → passed. |
| Check-only formatting and diff | Prettier check and `git diff --check` passed. |
| Rollback boundary | Revert `apps/web/src/app/page.tsx`, `page.test.tsx`, `components/landing/`, and `lib/api/implementation-contact.ts`; S1/S2 API and all dashboard work remain intact. |

### Public Boundary and Accessibility Evidence

- The payload contains only the five required and two optional public fields; blank optional fields are omitted, the honeypot is hidden and removed from tab order, and `credentials: 'omit'` prevents session credentials.
- Privacy copy states both application/database non-persistence and manual recipient-mailbox deletion retention. The landing contains no member, operator, financial, private metrics, or operational data.
- Labels, inline non-color error/status text, focus-visible rings, 44px minimum controls, and `overflow-x-hidden` with contained grid surfaces support the 320px public form; structural breakpoints retain containment at 768/1024/1440px.

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S3 / PR3 only, based on merged S2 / PR2; S4 and S5 are out of scope.
- Review impact: recorded from exact final diff before handoff; no API contract correction was required.

### Next Recommended Slice

- S4 / PR4: Club-status aggregate/RBAC. S4 and S5 remain pending.

## S3 False-Success Correction Attempt

**Native attempt token:** `sha256:09b4b9ac2ce9e8ffb2dafd4395a564cf3aab990bcca0b2888fc3e815c3a83472`

**Status:** Blocked before RED. Strict TDD safety-net execution of the existing focused page suite failed before any correction test or production code was changed.

| Evidence | Result |
|---|---|
| Safety-net command | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` → failed: 1 file, 2 passed, 2 failed. |
| Pre-existing failures | The success test timed out after 10 seconds; the retry test retained the previous rate-limit alert instead of rendering unavailable. |
| Correction scope | The proven client defect remains: any 2xx response is cast to `{ status: 'sent' }`, so API honeypot `202 { status: 'received' }` can render sent confirmation. No source/test correction was made because strict TDD forbids proceeding past a failing safety net. |
| Rollback boundary | This evidence section alone is removable; no product, API, dashboard, or protected operator-experience behavior changed. |

Task completion and S4 routing remain unchanged.

## S3 False-Success Correction — Final Attempt

**Native attempt token:** `sha256:7b81384fc3561b8e893c1ada779f750b827699818f07eb23dababb6ae85b49f8`

**Status:** Complete. The credential-free client now parses the response body and treats a submission as sent only when both `response.ok` and `body.status === 'sent'`. A honeypot-style `202 { status: 'received' }` now rejects through the existing generic unavailable/retry path.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| S3 false-success correction | `apps/web/src/lib/api/implementation-contact.test.ts` | Unit | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` → 1 file, 4 passed | New direct test failed: 1 failed (`202/received` resolved instead of rejecting), 1 passed (`200/sent`) | Direct client regression passed: 1 file, 2 passed | `202/received` rejects; `200/sent` resolves | Compressed existing S3 source/tests without removing form, privacy, accessibility, or contract assertions; 398 exact source/test changed lines |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/web exec vitest run src/lib/api/implementation-contact.test.ts` → passed: 1 file, 2 tests. |
| Page regression | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` → passed: 1 file, 4 tests. |
| Runtime harness | N/A for direct parsing: the S2 Fastify route owns the backend boundary; the direct unit invokes the real browser client with mocked fetch responses. RTL still exercised the browser-form flow in the 4/4 page suite. |
| Web checks | `pnpm --filter @athlos/web typecheck` and `pnpm --filter @athlos/web build` → passed. |
| Formatting and diff | Check-only Prettier and `git diff --check` → passed. |
| Rollback boundary | Revert `apps/web/src/lib/api/implementation-contact.{ts,test.ts}` plus the documented S3 compaction in `page.test.tsx` and `components/landing/ImplementationContactForm.tsx`; S1/S2, dashboard work, and protected operator-experience files remain intact. |

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- This is the final bounded S3 correction attempt; S4 / PR4 routing remains next, and S5 remains pending.
- Exact S3 source/test accounting: 398 additions plus deletions, within the 400-line cap.

## S3 Honeypot Forwarding Correction

**Native attempt token:** `sha256:8018198671e19646c07a9752b3cc3b6b6b46524fa467b916305579084f7fc48e`

**Status:** Complete. The client payload now includes the hidden `website` form value as a safely normalized optional string; the server-owned honeypot behavior and the hidden, removed-from-tab-order control remain unchanged.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| S3 honeypot forwarding | `apps/web/src/app/page.test.tsx` | Integration | Client 2/2 and page 4/4 passed | Filled `website` expectation failed: received payload omitted it (1 failed, 3 passed) | Client 2/2 and page 4/4 passed | Filled honeypot and normal page submissions exercise distinct DOM values | None needed; exact two source-line addition retained |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused client test | `pnpm --filter @athlos/web exec vitest run src/lib/api/implementation-contact.test.ts` → passed: 1 file, 2 tests. |
| Focused page test | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` → passed: 1 file, 4 tests. |
| Runtime harness | RTL user-event filled the hidden named input and observed the real form submission payload through the mocked browser client; no email or API route was invoked. |
| Web checks | `pnpm --filter @athlos/web typecheck` and `pnpm --filter @athlos/web build` → passed. |
| Formatting and diff | Check-only Prettier and `git diff --check` → passed. |
| Exact accounting | S3 source/test: 355 additions + 45 deletions = 400 changed lines; hard cap satisfied. |
| Rollback boundary | Revert the `website` type/payload lines in `apps/web/src/lib/api/implementation-contact.ts` and `components/landing/ImplementationContactForm.tsx`, plus the compacted assertion in `apps/web/src/app/page.test.tsx`. |

### Routing

- S4 / PR4: Club-status aggregate/RBAC remains next. S5 remains pending.

## S4 / PR4: Club-status aggregate/RBAC

**Status:** Complete. The authenticated read route calculates Buenos Aires date windows server-side, aggregates only non-annulled CTACTE entries, and omits unauthorized fields before JSON serialization.

### Completed Tasks

- [x] 4.1 RED service, route, and isolated PostgreSQL tests for period boundaries, ledger signs, annulments, authentication, projections, and current-state stability.
- [x] 4.2 GREEN isolated club-status types/repository/service, route, and server registration.
- [x] 4.3 Fastify injection and isolated-schema PostgreSQL evidence; unresolved policy metrics remain machine-readable unavailable values.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `apps/api/src/modules/club-status/service.test.ts`, `routes/club-status.test.ts`, `repository.postgres.integration.test.ts` | Unit, integration, PostgreSQL | New files | Two focused suites failed to load absent `service.ts` and `club-status.ts` | 2 files, 5 tests passed | Default/three valid/invalid periods; Buenos Aires date edges; ADMIN/TESORERO vs OPERADOR/CONSULTA; stable current state | Formatted pure date-window/projection functions after green |
| 4.2 | Same | Unit/integration | 5/5 focused | Production modules absent | 5/5 focused passed | Financial and non-financial role paths execute different repository access | None beyond extraction into repository/service/types |
| 4.3 | `repository.postgres.integration.test.ts` | PostgreSQL integration | Focused unit/route 5/5 | Repository module absent | 1 isolated PostgreSQL test passed | Debit, credit, annulment, and active membership rows use one disposable schema | Teardown always closes its dedicated pool |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/api exec vitest run src/modules/club-status/service.test.ts src/routes/club-status.test.ts` → passed: 2 files, 5 tests. |
| PostgreSQL runtime harness | `ATHLOS_TEST_DATABASE_URL=<local isolated PostgreSQL fixture> pnpm --filter @athlos/api exec vitest run src/modules/club-status/repository.postgres.integration.test.ts` → passed: 1 file, 1 test. It created and dropped only a randomized `club_status_*` schema. |
| API checks | `pnpm --filter @athlos/api typecheck` and `pnpm --filter @athlos/api build` → passed. |
| Formatting/diff | Check-only Prettier and `git diff --check` → passed. |
| Unavailable policy | No trend, debt, delinquency predicate, activity source, data-quality definition, system-state source, or currency is invented. Unsupported authorized/current-state metrics use machine-readable `unavailable` codes; unauthorized finance is absent. |
| Rollback boundary | Revert `apps/api/src/modules/club-status/`, `apps/api/src/routes/club-status.{ts,test.ts}`, and the two server registration lines. No operations, scheduler, evidence, stewardship, schema, or S5 UI behavior is involved. |

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S4 / PR4 only, based on merged S3 / PR3; S5 remains out of scope.
- Exact S4 code/test accounting: 370 additions + 0 deletions = 370 changed lines, below the 400-line cap.

### Superseded Routing

- S5 implementation is now complete through 5.2. Its browser proof is intentionally routed to the independent S6 / PR6 harness slice; do not reopen the 273-line S5 implementation scope.

## S5 / PR5: Role-aware dashboard UI

**Status:** Complete. Tasks 5.1 and 5.2 were dashboard-only at 273 changed source/test lines; task 5.3 is now closed by the separately approved S6 / PR6 browser-harness evidence.

### Completed Tasks

- [x] 5.1 RED RTL coverage for the default request, all allowed periods, server-field omission, explicit real zero, unavailable/empty/error/retry states, keyboard focus, textual status, and existing mobile-drawer container compatibility.
- [x] 5.2 GREEN authenticated `club-status` API client, status component, and dashboard composition.
- [x] 5.3 Closed after S6 / PR6 proved browser-backed 320/768/1024/1440 viewport/accessibility evidence; no claim was made from RTL alone.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 | `apps/web/src/components/dashboard/ClubStatusDashboard.test.tsx` | RTL integration | `dashboard/page.test.tsx`: 8/8 | Failed to resolve absent component module | 7/7 focused passed | Default/60/90 periods; finance present/absent; explicit zero/unavailable/error/empty paths | Removed duplicate unavailable output and isolated page test composition seam |
| 5.2 | Same | RTL integration | Same | Tests existed before client/component/page code | 7/7 focused passed | Server-projected finance only renders when present; period fetch retains current content | Minimal client and local state; no client authorization or aggregation |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `pnpm --filter @athlos/web exec vitest run src/components/dashboard/ClubStatusDashboard.test.tsx src/app/(authed)/dashboard/page.test.tsx` → 2 files, 15 tests passed. |
| Runtime harness | RTL exercises the real component with mocked authenticated client responses; S6 now adds browser-backed viewport and keyboard evidence, so 5.3 is complete. |
| Web checks | `pnpm --filter @athlos/web typecheck` and `pnpm --filter @athlos/web build` → passed. |
| Formatting/diff | Prettier check and `git diff --check` → passed. |
| Rollback boundary | Revert `apps/web/src/lib/api/club-status.ts`, `apps/web/src/components/dashboard/ClubStatusDashboard.{tsx,test.tsx}`, and the two dashboard page/test composition edits; no S1-S4 API/auth or protected operator-experience files are touched. |

### Routing

- S6 / PR6 is the approved independent test-infrastructure slice: minimal Playwright Chromium harness, deterministic safe authenticated dashboard setup/mocking, landing/dashboard structural checks, and CI failure artifacts. It is forecast at 250–400 lines and 2–5 CI minutes; screenshot/golden visual regression is out of scope.
- Final verification was blocked until S5.3 closed from S6 evidence; S5 implementation scope and its 273-line accounting remain unchanged.

### Design and State Evidence

- One authenticated `apiFetch` request defaults to `period=current-month`; only period changes issue another request, while prior current-state content remains rendered during the request.
- Finance cards render only when the server field exists. Explicit string `0.00` is rendered as zero; absent or unavailable metrics render no zero card. OPERADOR workload and CONSULTA institutional unavailable status use server codes only.
- The surface has no scheduler/evidence execution controls and remains separate from existing ADMIN operations, workspace, notification, and Socios regions.
- The layout uses `min-w-0`, responsive grid breakpoints, neutral token borders, dark existing shell chrome, compact radii, labelled 44px select, visible focus utilities, and textual `role=status` feedback. This is structural RTL evidence only, not browser viewport evidence.

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S5 / PR5 only, based on merged S4 / PR4. No commit, push, PR, deploy, final verify, RDD, or protected operator-experience edit was performed.
- Exact S5 source/test accounting: 273 additions + 0 deletions = 273 changed lines, within the hard 400-line cap.

## S6 / PR6: Playwright Chromium viewport harness

**Status:** Complete. The minimal browser harness proves the public landing and authenticated dashboard at 320, 768, 1024, and 1440 CSS pixels without screenshot or golden regression. Browser-backed evidence closes S5.3.

### Completed Tasks

- [x] 6.1 RED browser specs cover page overflow, contained regions, structural overlap, period controls, drawer focus/keyboard behavior, labels, status text, and visible focus at all mandated viewports.
- [x] 6.2 GREEN Playwright Chromium configuration, deterministic test-only local-storage auth, route/API mocks, and web startup are implemented; production authentication is unchanged.
- [x] 6.3 CI runs the focused Playwright command after installing Chromium and uploads report, trace, and video artifacts only when the job fails.
- [x] 5.3 S5 completion gate closed from the browser evidence below; RTL alone was not used as viewport proof.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 | `apps/web/e2e/{landing,dashboard}.spec.ts` | E2E Chromium | Existing S5 focused suite: 2 files / 15 tests passed | Initial Playwright command failed before execution because the runner was absent; specs were written before harness/config implementation | Final harness run: 2 files / 9 tests passed | Four landing and four dashboard viewports plus a separate mobile drawer focus cycle | Extracted auth/API routes and containment helpers into the shared fixture; no screenshots/goldens |
| 6.2 | `apps/web/e2e/fixtures/authenticated-dashboard.ts`, `apps/web/playwright.config.ts` | E2E infrastructure | N/A (new files) | Specs referenced the new fixture/config boundary before implementation | `pnpm --filter @athlos/web exec playwright test` passed: 9 tests | Anonymous landing and authenticated dashboard use separate fixture paths; period change and drawer keyboard paths exercise distinct behavior | Kept auth test state and API responses local to the fixture; no production bypass |
| 6.3 | `.github/workflows/test.yml`, `apps/web/package.json` | CI/runtime | N/A (new CI/script wiring) | Workflow command and artifact contract were added before final execution | Local command passed; CI workflow installs Chromium and uploads artifacts only after failure | Landing/dashboard suites run in one Chromium project with failure-only report, trace, and video retention | Package lock updated for `@playwright/test`; no screenshot tooling added |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/web exec playwright test` → passed: 2 files / 9 tests; Chromium 151.0.7922.34 (Playwright 1.62.1) executed the local run. |
| Runtime harness command/scenario and exact result | Playwright started Next.js on `127.0.0.1:3101`; landing and dashboard scenarios passed at 320/768/1024/1440; period control changed to `last-90-days`; drawer Escape and Tab/Shift+Tab focus restoration passed. |
| Supporting web checks | `pnpm --filter @athlos/web typecheck` → passed; focused S5 RTL safety net → 2 files / 15 tests passed; targeted Prettier check → passed; `git diff --check` → passed. |
| CI artifact policy | `.github/workflows/test.yml` installs Chromium, runs the same Playwright command, and uses `if: failure()` for `playwright-report/` and `test-results/`; screenshots/goldens are not configured. |
| CI target | The harness is a single Chromium project with 9 deterministic mocked tests; local execution completed in approximately 1.4 minutes after startup, below the 2–5 minute target. |
| Rollback boundary | Revert `.github/workflows/test.yml`, `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/playwright.config.ts`, and `apps/web/e2e/`; this removes only S6 browser infrastructure and leaves S1–S5 product behavior intact. |

### Browser Evidence Closing S5.3

- Landing assertions passed at 320/768/1024/1440: required hero/form content, public privacy text, labels, visible login focus, page-level overflow, contained regions, and no overlapping primary regions.
- Dashboard assertions passed at 320/768/1024/1440: server-shaped club status, period control, current update status, empty notification state, page-level overflow, contained app content/status regions, no overlapping status cards, and period-control focus.
- Mobile drawer assertions passed at 320: open dialog, initial close-button focus, Tab/Shift+Tab cycle, Escape close, and trigger focus restoration.
- The run emitted an existing AppShell hydration warning because local-storage auth is client-hydrated after the server loading shell; all nine browser assertions passed and no production auth bypass was introduced.

### Workload Boundary

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`.
- Current slice: S6 / PR6 only, based on completed S5; no commit, push, PR, RDD, review/receipt flow, or protected operator-experience edit was performed.
- Exact S6 authored accounting against HEAD: 293 additions plus 5 deletions = 298 changed lines; protected pre-existing operator-experience edits, generated `apps/web/next-env.d.ts`, and SDD evidence artifacts are excluded. The current local fixture/config/spec source is 234 lines, plus 15 CI/package additions and 44 lockfile additions with 5 lockfile deletions.

### Routing

- S6 and S5.3 are complete. The earlier routing to `sdd-verify` is superseded by the completed `verify-report.md` evidence.

## P1 final verification warning remediation: AppShell hydration

**Status:** Complete for the approved hydration-only remediation. The database provisioning warning remains environment-only, and the unavailable coverage dependency remains outside scope. Historical S1–S6 facts above are unchanged.

### TDD Cycle Evidence

| Work unit | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| AppShell hydration gate | `apps/web/src/components/AppShell.test.tsx` | RTL/React hydration | Existing AppShell suite: 3/3 | Added server/first-client markup and post-mount authenticated assertions; the pre-gate run emitted the proven React hydration mismatch | AppShell suite: 5/5 passed | Authenticated client starts with identical loading markup, then renders shell content after mount; unauthenticated refresh/redirect paths remain covered | Wrapped hydration cleanup in `act`; kept auth storage and fixture state semantics unchanged |
| Browser console fail-fast | `apps/web/e2e/fixtures/authenticated-dashboard.ts` | Playwright Chromium | Existing S6 browser suite: 9/9 | Existing browser run recorded the AppShell hydration console error before the guard | Playwright suite: 9/9 passed with the guard active | Anonymous landing and authenticated dashboard paths, including all four viewports, share the same error guard | Reused the shared fixture and retained failure-only Playwright artifacts |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused AppShell tests | `pnpm --filter @athlos/web exec vitest run src/components/AppShell.test.tsx` → passed: 1 file, 5 tests. |
| Existing 15 RTL safety tests | `pnpm --filter @athlos/web exec vitest run src/components/dashboard/ClubStatusDashboard.test.tsx 'src/app/(authed)/dashboard/page.test.tsx'` → passed: 2 files, 15 tests. |
| Runtime browser harness | `pnpm --filter @athlos/web exec playwright test` → passed: 9 tests at 320, 768, 1024, and 1440 CSS pixels, including the 320px drawer focus cycle; the shared console-error guard reported no browser console errors. |
| Web typecheck/build | `pnpm --filter @athlos/web typecheck && pnpm --filter @athlos/web build` → passed. |
| Check-only formatting/diff | `pnpm format:check && git diff --check` → passed. |
| Database and coverage boundary | No database provisioning or coverage dependency installation was attempted; both remain outside this candidate remediation. |
| Exact remediation accounting | 90 authored changed lines: `AppShell.tsx` 7, `AppShell.test.tsx` 61, and the shared Playwright fixture 22 (21 additions + 1 deletion); under the 400-line budget. Existing S1–S6 candidate lines and SDD evidence are excluded. |
| Rollback boundary | Revert only the hydration gate and its two AppShell regression tests in `apps/web/src/components/AppShell.tsx` and `apps/web/src/components/AppShell.test.tsx`, plus the console-error guard in `apps/web/e2e/fixtures/authenticated-dashboard.ts`; auth storage, fixture injection, S1–S6 product behavior, and protected operator-experience edits remain intact. |

### Verification Routing

- The candidate-caused hydration warning is remediated by a client hydration gate: server and first client render the loading shell, then authenticated content appears after mount.
- The Playwright fixture now fails tests on any browser `console.error`, making future hydration regressions browser evidence failures rather than warnings.
- Database provisioning and the missing `@vitest/coverage-v8` dependency were not changed or reclassified.

## Narrow final-verification remediation: generated Next file and grant test reproduction

**Status:** Complete for the authorized narrow remediation. The generated Next environment file is ignored by Prettier and restored exactly to the repository baseline. The reported grant-data-steward timeout defect did not reproduce under individually targeted or focused-file execution, so no production or grant-test code change was made.

### Generated-file policy evidence

| Evidence | Result |
|---|---|
| Durable formatting fix | Added `apps/web/next-env.d.ts` to the root `.prettierignore`; the existing format script order was not changed. |
| Build/regeneration cycle | `pnpm --filter @athlos/web build` → passed after 20.8s compilation, TypeScript, page generation, and route finalization; Next regenerated `apps/web/next-env.d.ts`. |
| Baseline restoration | Restored `apps/web/next-env.d.ts` exactly to `git show HEAD:apps/web/next-env.d.ts`; final diff has no generated-file content change. |
| Formatting | `pnpm format:check` after the build and restoration → passed: all matched files use Prettier code style. |

### Grant timeout reproduction evidence

The prior verify report named two `grant-data-steward.test.ts` timeouts but did not preserve test names, stack traces, or a timeout artifact. All ten tests were therefore run individually by exact test name first, followed by the focused file command. Every identified test passed; no timeout reproduced.

| Reproduction stage | Exact command/result |
|---|---|
| Individual tests | `pnpm --filter @athlos/db exec vitest run src/scripts/grant-data-steward.test.ts -t <exact test name> --reporter verbose` for each of the 10 tests → each command exited 0 with `Test Files 1 passed (1)`, `Tests 1 passed | 9 skipped (10)` (the null-operator case also passed with the same result). |
| Focused file | `pnpm --filter @athlos/db exec vitest run src/scripts/grant-data-steward.test.ts --reporter verbose` → exit 0; `Test Files 1 passed (1)`, `Tests 10 passed (10)`, duration 4.15s. |
| Environment boundary | No `ATHLOS_TEST_DATABASE_URL` was supplied or required; the tests used their mocked `Db` override. |
| Causality decision | Neither unguarded `main()` on import nor duplicate Pool ownership was proven causal for the reported mocked-test timeouts. No speculative change was made to `grant-data-steward.ts` or its test. |

### TDD and accounting boundary

| Item | Result |
|---|---|
| Strict TDD RED/GREEN/REFACTOR | Not entered: reproduction produced no failing test and therefore supplied no causal defect to fix. |
| Narrow remediation authored accounting | 1 addition to `.prettierignore`; 0 final changed lines in generated `apps/web/next-env.d.ts`; 0 changes to grant production/test code. Evidence-artifact edits are excluded from implementation-line accounting. |
| Focused typecheck | `pnpm --filter @athlos/web typecheck` → passed; `pnpm --filter @athlos/db typecheck` → passed. |
| Diff validation | `git diff --check` → passed. |
| Runtime harness | `pnpm --filter @athlos/web build` is the applicable regeneration harness and passed; grant tests are mocked unit tests with no external runtime boundary. |
| Rollback boundary | Remove the single `.prettierignore` entry and restore the appended evidence sections; generated `next-env.d.ts`, grant code/tests, protected operator-experience edits, and S1-S6 product work remain unchanged. |

### Current routing

- The original final verify failure remains honestly recorded: the full recursive suite was not rerun in this narrow remediation, and the prior report's seven PostgreSQL environment-limited suites remain unresolved here.
- The generated-file formatting blocker is remediated locally and the grant timeout blocker is not reproducible with the available evidence. The earlier request for fresh final SDD verification is superseded by the completed `verify-report.md`, which retains the PostgreSQL environment warnings; no archive success is claimed.
