# Apply Progress: Operator Experience Foundation

## Completed Tasks

- [x] 1.1 **RED U1:** Add the public landing behavioral test.
- [x] 1.2 **GREEN/REFACTOR U1:** Implement and verify the public landing.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 0: 85 files / 732 tests passed. The workspace Vitest configuration ran the full web suite rather than only the requested file; `src/app/page.test.tsx` passed 2/2. |
| Runtime harness command/scenario and exact result | `pnpm --filter '@athlos/web' exec next dev --port 3100` plus headless Chromium at `http://127.0.0.1:3100/`: Next returned `GET / 200`; rendered DOM contained `Athlos para Club Atlético Gorriti`, `Iniciar sesión`, and `href="/login"`. |
| Rollback boundary | Revert `apps/web/src/app/page.tsx` and `apps/web/src/app/page.test.tsx`; no API, auth, dashboard, scheduler, or navigation behavior changes. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `apps/web/src/app/page.test.tsx` | Component integration | N/A (new test file) | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 1: page test 0/2; 730 existing tests passed | N/A — RED-only task | Two scenarios: institutional/private purpose and sole `/login` action with no operational data | N/A — test was already minimal and formatted |
| 1.2 | `apps/web/src/app/page.test.tsx` | Component integration | N/A (new landing behavior) | Reused task 1.1's failing 0/2 landing test | Same command exited 0: 85 files / 732 tests passed, including landing 2/2 | The two user-visible scenarios require distinct outputs and prevent a static placeholder or extra action | Prettier check passed; rerun after formatting passed 85 files / 732 tests |

## Validation

- `pnpm --filter '@athlos/web' typecheck` exited 0.
- `pnpm exec prettier --check apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx openspec/changes/operator-experience-foundation/tasks.md` exited 0.
- The initial dependency installation was blocked only by Puppeteer's missing cached Chrome executable; `PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile` completed successfully before runtime verification.

## Workload / PR Boundary

- Mode: stacked PR slice
- Chain strategy: stacked-to-main
- Current work unit: PR1 / U1 Landing
- Boundary: `main` baseline through only the public `/` landing and its behavioral test; U2+ remains untouched.
- Authored changed lines: 94 additions + 6 deletions = 100, within the 150-line runtime cap and 400-line review budget.

## Remaining Tasks

- [ ] 1.3–4.3 remain pending.
