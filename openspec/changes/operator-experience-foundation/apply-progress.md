# Apply Progress: Operator Experience Foundation

## Accepted Completion

- [x] 1.1 **RED U1:** public landing behavioral test completed.
- [x] 1.2 **GREEN/REFACTOR U1:** public landing completed and verified.
- [x] 1.3 **RED U2:** anonymous aggregate denial and authenticated role access completed.
- [x] 1.4 **GREEN/REFACTOR U2:** existing aggregate query support completed.
- [x] 1.5 **RED U2:** dashboard behavioral tests completed.
- [x] 1.6 **GREEN/REFACTOR U2:** truthful workspace, Socios, and notification regions completed.

### U1/U2 Retained Evidence

| Unit | Focused test result | Runtime harness | Rollback boundary |
|---|---|---|---|
| U1 landing | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 0; requested test passed 2/2 (workspace ran 85 files / 732 tests). | Next dev plus headless Chromium: `GET / 200`, rendered private purpose and sole `/login` action. | `apps/web/src/app/page.tsx`, `apps/web/src/app/page.test.tsx` |
| U2 dashboard foundation | API Socios Vitest exited 0: 1 file / 15 tests; dashboard Vitest exited 0: 1 file / 13 tests. | N/A — no authenticated browser credentials; injection and RTL prove role access and non-ADMIN zero snapshot requests. | Socios route/test stand-in, dashboard page/test, and U2 dashboard components. |

## Historical U3 Attempts and Reset

- **Attempt 1 — combined U3:** ADMIN dashboard attention and ADMIN Operations navigation were combined. It was not accepted and native reset completed. Its RED/test/code evidence is historical only; it completes no U3 task.
- **First maintainer rescope:** replaced combined U3 with U3a dashboard attention/simplification, then U3b navigation.
- **Attempt 2 — isolated U3a:** its focused suite exited 0 (2 files / 12 tests), but delivery was not accepted. The candidate was 467 changed lines (181 additions, 286 deletions), with the four U3a files at 124 additions and 276 deletions, exceeding the immutable 220-line attempt cap. It was reset; GREEN evidence is not a completion mark.
- Detailed dashboard telemetry removal alone deletes 240 lines from `apps/web/src/app/(authed)/dashboard/page.tsx`; retaining it, including CSS-hidden, violates Dashboard Cards and is not an accounting workaround.

## Second Maintainer-Approved Rescope

| Unit | Dependency and scope | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR3 / U3a1 telemetry cleanup (~296 lines) | U2 on `main`; dashboard page/test only; remove detailed telemetry and retain U2 regions. | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' --config vitest.config.mts` | Dashboard retains U2 regions and renders no detailed task telemetry. | `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}` |
| PR4 / U3a2 ADMIN attention (~124 lines) | U3a1 on `main`; `OperationsAttention` source/test plus minimal page integration. | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' 'src/components/dashboard/OperationsAttention.test.tsx' --config vitest.config.mts` | ADMIN has ≤10 safe links and 30-second refresh; non-ADMIN sends zero requests; no controls. | `OperationsAttention.{tsx,test.tsx}` and only its page integration. |
| PR5 / U3b navigation (~95 lines) | U3a2 on `main`; next work unit. | `pnpm --filter '@athlos/web' exec vitest run 'src/components/layout/Sidebar.test.tsx' --config vitest.config.mts` | ADMIN Operations targets/active state; non-ADMIN has no group. | `navigation.ts`, `Sidebar.tsx`, `Sidebar.test.tsx` |

## Current Completion State

- [x] 1.1–1.6 U1/U2 remain accepted.
- [x] 2.1–2.2 U3a1 telemetry cleanup is accepted: dashboard page/test changes total 360 lines (16 additions, 344 deletions), meeting the 360-line cap.
- [x] 2.3–2.4 U3a2 ADMIN attention is complete: the bounded safe-link region refreshes every 30 seconds for ADMIN only, makes zero non-ADMIN snapshot requests, and exposes no controls or raw-error output.
- [x] 2.5–2.6 U3b navigation is complete: ADMIN links are grouped under Operations through the shared navigation model; scheduler targets and active accent remain unchanged, and non-ADMIN has no Operations group.
- [ ] 3.1–4.3 U4/U5 remain pending.

## Workload / Chain Boundary

- Delivery strategy: ask-on-risk (split approved)
- Chain strategy: stacked-to-main
- U3a1, PR4/U3a2, and PR5/U3b are complete; U4 follows U3b.
- This rescope records U3a1, U3a2, and U3b delivery success; U4/U5 remain incomplete.

## U3a1 Telemetry Cleanup Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' --config vitest.config.mts` exited 0: 1 file / 8 tests passed. |
| Runtime harness command/scenario and exact result | N/A — this page-only RTL integration verifies ADMIN and non-ADMIN rendering/request boundaries; no authenticated browser credentials were supplied. |
| Rollback boundary | Revert `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}`; U2 cards remain independent and U3a2/U3b stay deferred. |
| Runtime token / cap | `sha256:ffc7c065007666b97e68c23f52215c9fbbb6ad326577970ab1244973049a9aa1`; dashboard page/test changes total 360 lines (16 additions, 344 deletions), meeting the 360-line cap. |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `apps/web/src/app/(authed)/dashboard/page.test.tsx` | Component integration | 1 file / 10 tests passed | Focused command exited 1: ADMIN snapshot was called once | N/A — RED-only task | ADMIN proves no snapshot or telemetry; non-ADMIN proves no snapshot while U2 regions remain | N/A — test task |
| 2.2 | `apps/web/src/app/(authed)/dashboard/page.test.tsx` | Component integration | Reused 1 file / 10 tests | Reused 2.1 failure | Focused command exited 0: 1 file / 8 tests passed | ADMIN immediate and 30-second paths plus the table-driven TESORERO/OPERADOR/CONSULTA paths prove zero snapshot requests while retaining U2 cards | Removed the redundant standalone OPERADOR duplicate and its local timer reset; retained the shared setup documentation; focused test, typecheck, and Prettier remained green |

### U3a2 ADMIN Attention Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' 'src/components/dashboard/OperationsAttention.test.tsx' --config vitest.config.mts` exited 0: 2 files / 12 tests passed. |
| Runtime harness command/scenario and exact result | N/A — authenticated browser credentials were not supplied; RTL proves ADMIN render/refetch and zero non-ADMIN snapshot requests. |
| Typecheck | `pnpm --filter '@athlos/web' typecheck` exited 0. |
| Prettier | `pnpm exec prettier --check 'apps/web/src/app/(authed)/dashboard/page.tsx' 'apps/web/src/app/(authed)/dashboard/page.test.tsx' 'apps/web/src/components/dashboard/OperationsAttention.tsx' 'apps/web/src/components/dashboard/OperationsAttention.test.tsx' 'openspec/changes/operator-experience-foundation/tasks.md'` exited 0. |
| Diff check / cap | `git diff --check` exited 0. U3a2 implementation files total 170 additions + 5 deletions = 175 changed lines; with the two U3a2 task-checkbox lines, the worktree total is 172 additions + 7 deletions = 179, within the 180-line cap. |
| Rollback boundary | `apps/web/src/components/dashboard/{OperationsAttention.tsx,OperationsAttention.test.tsx}` plus U3a2 changes in `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}`; task-checkbox lines are independently revertible. |
| Runtime token | `sha256:89b89b7c2e043b0efcf6b17f71a362864a2cc565ae164c06a0f35046322b0dea` |

### Validation

- `pnpm --filter '@athlos/web' typecheck` exited 0.
- `pnpm exec prettier --check "apps/web/src/app/(authed)/dashboard/page.tsx" "apps/web/src/app/(authed)/dashboard/page.test.tsx"` exited 0.
- U3a2 `OperationsAttention` source/test and minimal page integration are complete; its 2.3–2.4 task checkboxes are checked.
- U3a1 and U3a2 focused suites, typecheck, Prettier, and `git diff --check` passed. No deviation from the U3a1/U3a2 design; their 360-line and 180-line caps are met.

### U3b Operations Navigation Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' exec vitest run 'src/components/layout/Sidebar.test.tsx' --config vitest.config.mts` exited 0: 1 file / 8 tests passed. |
| Runtime harness command/scenario and exact result | N/A — no authenticated browser credentials were supplied; RTL proves ADMIN Operations grouping, scheduler route identity, active state, and non-ADMIN absence. |
| Typecheck | `pnpm --filter '@athlos/web' typecheck` exited 0. |
| Prettier | `pnpm exec prettier --check "apps/web/src/lib/navigation.ts" "apps/web/src/components/layout/Sidebar.tsx" "apps/web/src/components/layout/Sidebar.test.tsx"` exited 0. |
| Diff check / cap | `git diff --check` exited 0. U3b implementation files total 81 additions + 51 deletions = 132 changed lines; the two task-checkbox lines bring the U3b delivery total to 136, 14 below the 150-line cap. |
| Rollback boundary | Revert `apps/web/src/lib/navigation.ts`, `apps/web/src/components/layout/Sidebar.tsx`, and `apps/web/src/components/layout/Sidebar.test.tsx`; revert the two U3b task-checkbox lines independently. |
| Runtime token | `sha256:530006fd06e5f563ed8917116657b769236f5e32cb9bf60fbd7452d9ade2474f` |

### U3b TDD Cycle Evidence

| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 2.5 | Component integration | 1 file / 8 tests passed | Operations landmark absent | N/A — RED-only task | ADMIN and CONSULTA permission paths | N/A — test task |
| 2.6 | Component integration | Reused baseline | Reused 2.5 failure | 1 file / 8 tests passed | Group, scheduler route identity, active state, and non-ADMIN absence | Removed the reusable list abstraction; the shared `navigation.ts` model remains the single permission source. |
