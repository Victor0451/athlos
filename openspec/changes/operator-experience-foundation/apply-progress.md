# Apply Progress: Operator Experience Foundation

## Completed Tasks

- [x] 1.1 **RED U1:** Add the public landing behavioral test.
- [x] 1.2 **GREEN/REFACTOR U1:** Implement and verify the public landing.
- [x] 1.3 **RED U2:** Prove anonymous aggregate denial and authenticated role access.
- [x] 1.4 **GREEN/REFACTOR U2:** Support the existing aggregate query in the API stand-in.
- [x] 1.5 **RED U2:** Add dashboard behavior tests.
- [x] 1.6 **GREEN/REFACTOR U2:** Add truthful workspace, Socios, and notification regions.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 0: 85 files / 732 tests passed. The workspace Vitest configuration ran the full web suite rather than only the requested file; `src/app/page.test.tsx` passed 2/2. |
| Runtime harness command/scenario and exact result | `pnpm --filter '@athlos/web' exec next dev --port 3100` plus headless Chromium at `http://127.0.0.1:3100/`: Next returned `GET / 200`; rendered DOM contained `Athlos para Club Atlético Gorriti`, `Iniciar sesión`, and `href="/login"`. |
| Rollback boundary | Revert `apps/web/src/app/page.tsx` and `apps/web/src/app/page.test.tsx`; no API, auth, dashboard, scheduler, or navigation behavior changes. |

### PR2 / U2 Dashboard Foundation

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/api' exec vitest run src/routes/socios.test.ts --config vitest.config.ts` exited 0: 1 file / 15 tests. `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' --config vitest.config.mts` exited 0: 1 file / 13 tests. |
| Runtime harness command/scenario and exact result | N/A — no authenticated browser harness or credentials were supplied. The Fastify injection test exercises the aggregate route and the RTL integration test proves `TESORERO`, `OPERADOR`, and `CONSULTA` retain usable cards while making zero snapshot requests. |
| Rollback boundary | Revert `apps/api/src/routes/socios.test.ts`, `apps/api/src/test-standins/db.ts`, `apps/web/src/app/(authed)/dashboard/page.tsx`, `apps/web/src/app/(authed)/dashboard/page.test.tsx`, and `apps/web/src/components/dashboard/*`; API contracts and U3 Operations stay unchanged. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `apps/web/src/app/page.test.tsx` | Component integration | N/A (new test file) | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 1: page test 0/2; 730 existing tests passed | N/A — RED-only task | Two scenarios: institutional/private purpose and sole `/login` action with no operational data | N/A — test was already minimal and formatted |
| 1.2 | `apps/web/src/app/page.test.tsx` | Component integration | N/A (new landing behavior) | Reused task 1.1's failing 0/2 landing test | Same command exited 0: 85 files / 732 tests passed, including landing 2/2 | The two user-visible scenarios require distinct outputs and prevent a static placeholder or extra action | Prettier check passed; rerun after formatting passed 85 files / 732 tests |
| 1.3 | `apps/api/src/routes/socios.test.ts` | HTTP integration | 10/10 API tests passed | Added tests first; 4 authenticated aggregate cases failed 500 while anonymous denial passed | N/A — RED-only task | Anonymous plus ADMIN/TESORERO/OPERADOR/CONSULTA are distinct authorization paths | N/A — test task |
| 1.4 | `apps/api/src/routes/socios.test.ts` | HTTP integration | 10/10 API tests passed | Reused 1.3's 4 failing aggregate cases | API focused command exited 0: 15/15 | Empty aggregate verifies all four count buckets without inventing data | Stand-in gained only grouped Socios count support; focused API test remained green |
| 1.5 | `apps/web/src/app/(authed)/dashboard/page.test.tsx` | Component integration | 8/8 dashboard tests passed | Added tests first; 5 scenarios failed because U2 regions did not exist | N/A — RED-only task | Tests cover three non-ADMIN roles plus independent loading/empty and safe-error paths | N/A — test task |
| 1.6 | `apps/web/src/app/(authed)/dashboard/page.test.tsx` | Component integration | 8/8 dashboard tests passed | Reused 1.5's failing scenarios | Web focused command exited 0: 13/13 | Real aggregate, notification, loading, empty, and error outcomes prevent static or coupled regions | Prettier check and focused rerun passed |

## Validation

- `pnpm --filter '@athlos/web' typecheck` exited 0.
- `pnpm --filter '@athlos/api' typecheck` exited 0.
- `pnpm exec prettier --check` for all U2 files exited 0.
- `pnpm exec prettier --check apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx openspec/changes/operator-experience-foundation/tasks.md` exited 0.
- The initial dependency installation was blocked only by Puppeteer's missing cached Chrome executable; `PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile` completed successfully before runtime verification.

## Workload / PR Boundary

- Mode: stacked PR slice
- Chain strategy: stacked-to-main
- Current work unit: PR2 / U2 Dashboard foundation
- Boundary: merged PR1 `main` through aggregate authorization proof and all-role dashboard foundation; U3 Operations remains untouched.
- Authored changed lines: 222 additions + 0 deletions before OpenSpec progress artifacts; within the 320-line attempt cap and 400-line review budget.

## Remaining Tasks

- [ ] 2.1–4.3 remain pending.
