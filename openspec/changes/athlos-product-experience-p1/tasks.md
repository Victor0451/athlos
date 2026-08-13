# Tasks: Athlos Product Experience P1

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | S1 287; S2 300; S3 400; S4 370; S5 273; S6 250–400; total 1,880–2,030 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 → PR5 → PR6, each merges to `main` before the next |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal / dependency | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| S1 / PR1 | SMTP/config; base | `pnpm --filter @athlos/api exec vitest run src/container.test.ts` | Staging SMTP receipt | email/config/container |
| S2 / PR2 | Contact API; S1 | `pnpm --filter @athlos/api exec vitest run src/routes/implementation-contact.test.ts` | `fastify.inject` cases | contact route/service |
| S3 / PR3 | Landing/form; S2 | `pnpm --filter @athlos/web exec vitest run src/app/page.test.tsx` | Stubbed browser submit | landing/root page |
| S4 / PR4 | Aggregate/RBAC; base | `pnpm --filter @athlos/api exec vitest run src/modules/club-status src/routes/club-status.test.ts` | PostgreSQL CTACTE fixture | club-status module/route |
| S5 / PR5 | Dashboard UI; S4 | `pnpm --filter @athlos/web exec vitest run src/components/dashboard/ClubStatusDashboard.test.tsx src/app/'(authed)'/dashboard/page.test.tsx` | RTL only; browser proof deferred to S6 | 273-line dashboard client/component/page scope |
| S6 / PR6 | Browser proof; S5 | `pnpm --filter @athlos/web exec playwright test` | Chromium landing/dashboard at 320/768/1024/1440 | Playwright config, browser fixtures/tests, CI job only |

## Phase 1: SMTP/config foundation (S1 / PR1)

- [x] 1.1 **RED:** add `packages/integrations/email/*.test.ts` and `apps/api/src/container.test.ts` for acknowledgement, fabricated ID, timeout, `outbox`, and recipient rejection.
- [x] 1.2 **GREEN:** update `packages/integrations/email/{real,stub,types}.ts`, `package.json`, config schema, and `apps/api/src/container.ts` for nodemailer/recipient DI.
- [x] 1.3 Update `.env.example`; run checks; deploy the exact S1 candidate; obtain one candidate-valid BETA SMTP acknowledgement; record sanitized runtime invariants. Revert S1.

> Historical pre-deployment decision: PR1 preparation may proceed. Task 1.3 remained pending; the candidate-valid SMTP receipt was deferred until deployment of the exact S1 candidate.
>
> Bounded attempts (2026-08-10T21:07:08Z): (1) focused code/tests and checks passed; (2) a read-only candidate/BETA source-fingerprint comparison proved that deployed BETA contains older S1 code/config (six of seven fingerprints differ), so it cannot provide candidate-valid SMTP acknowledgement. No configuration was read or mutated, and no email was sent.
>
> Historical first post-deployment harness attempt (2026-08-11T15:35:29Z): the `tsx -e` probe received top-level `await`, exited before invoking the deployed adapter, produced empty stdout, and had stderr redirected away. This was a harness/process-capture defect; it is retained as non-evidence and was not retried as a provider diagnosis.
>
> Final S1 evidence: PR #252 merged to `main` as `f8381b7`; promotion PR #254 merged to `beta` as `d690f4d`; BETA release `v0.6.0-beta.5` workflow run `31505767901` succeeded. At `2026-08-11T18:08:06Z`, exactly one corrected deployed-adapter `sendMail` call was accepted and returned a real non-synthetic message ID; its raw value was not recorded. API/web health and readiness passed, migration status was clean, and container IDs/restart counts were unchanged. Raw credentials, addresses, and content were not recorded.

## Phase 2: Public contact API/security (S2 / PR2)

- [x] 2.1 **RED:** create `apps/api/src/routes/implementation-contact.test.ts` for method, limits, fields, origin, honeypot, 429, recipient, redaction, and SMTP.
- [x] 2.2 **GREEN:** add `apps/api/src/routes/implementation-contact.ts`; register in `apps/api/src/server.ts` with audit exemption, limits, sanitization, generic failures, and no persistence.
- [x] 2.3 Document endpoint/config; prove abuse has no delivery. Revert S2 only.

## Phase 3: Product landing/contact UI (S3 / PR3)

- [x] 3.1 **RED:** add consolidated behavioral coverage in `apps/web/src/app/page.test.tsx` (4 tests) for fields/privacy, `/login`, errors, and auth replacement.
- [x] 3.2 **GREEN:** create `apps/web/src/components/landing/{ProductLanding,ImplementationContactForm,RootAuthHandoff}.tsx`; update `app/page.tsx` and `lib/api/implementation-contact.ts`.
- [x] 3.3 Verify keyboard/320px/no private data; document form behavior. Revert S3 only.

## Phase 4: Club-status aggregate/RBAC (S4 / PR4)

- [x] 4.1 **RED:** add `apps/api/src/modules/club-status/*.test.ts` and route tests for DST, annulments, signs, roles, omissions, and stability.
- [x] 4.2 **GREEN:** create `apps/api/src/modules/club-status/{types,repository,service}.ts` and `routes/club-status.ts`; register projection and Buenos Aires bounds.
- [x] 4.3 Run PostgreSQL/injection evidence; document unavailable policy. Revert S4 only.

## Phase 5: Role-aware dashboard/responsive UI (S5 / PR5)

- [x] 5.1 **RED:** add `apps/web/src/components/dashboard/ClubStatusDashboard.test.tsx` RTL/axe-equivalent tests for request, omissions, states, focus, and drawer-compatible containment.
- [x] 5.2 **GREEN:** add `apps/web/src/lib/api/club-status.ts` and `components/dashboard/ClubStatusDashboard.tsx`; update dashboard page with Socios cards/period control.
- [x] 5.3 **Completion gate:** closed by S6 browser evidence verifying the S5 surface at all mandated viewports; no viewport proof was claimed from RTL. Revert S5 only.

## Phase 6: Browser harness and viewport/accessibility proof (S6 / PR6)

- [x] 6.1 **RED:** add failing `apps/web/e2e/{landing,dashboard}.spec.ts` checks for page overflow, clipped/overlapping structural regions, period controls, drawer focus/keyboard, and basic accessibility at 320/768/1024/1440; exclude screenshots/goldens.
- [x] 6.2 **GREEN:** add minimal Chromium `playwright.config.ts`, `apps/web/e2e/fixtures/authenticated-dashboard.ts`, and `apps/web/package.json` scripts; start the web app through deterministic safe route/API mocking and test-only local-storage auth state.
- [x] 6.3 **Evidence:** update `.github/workflows/test.yml` to run `pnpm --filter @athlos/web exec playwright test`, install Chromium, upload trace/video/report only on failure, and record the command, browser version, viewport results, 2–5 minute CI target, and independent rollback in apply progress.

## Protection

- [x] Do not stage, edit, or revert `openspec/changes/operator-experience-foundation/{tasks.md,apply-progress.md}`; preserve their existing local modifications.

## Completion Routing

- Final SDD verification runs only after S5.3 and all S6 tasks are complete. S6 is a separate, independently revertible PR6 under 400 lines; its non-goal is screenshot/golden visual regression.
