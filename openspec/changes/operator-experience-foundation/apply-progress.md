# Apply Progress: Operator Experience Foundation

## Accepted Completion

- [x] 1.1–1.6 U1/U2 remain accepted.
- [x] 2.1–2.2 U3a1 telemetry cleanup remains accepted at its 360-line cap.
- [x] 2.3–2.4 U3a2 ADMIN attention remains accepted at its 180-line cap.
- [x] 2.5–2.6 U3b Operations navigation remains accepted at 136 delivery lines.
- [x] 3.1–3.2 U4 personal boundary is complete.
- [x] 4.1–4.2 U5 accessible mobile shell is complete.
- [x] 4.3 final verification is complete: merged-main CI and local lint provide the required final evidence.

## Retained Prior Work Evidence

| Unit | Focused test result | Runtime harness | Rollback boundary |
|---|---|---|---|
| U1 landing | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` exited 0; requested test passed 2/2 (workspace ran 85 files / 732 tests). | Next dev plus headless Chromium: `GET / 200`, rendered private purpose and sole `/login` action. | `apps/web/src/app/page.tsx`, `apps/web/src/app/page.test.tsx` |
| U2 dashboard foundation | API Socios Vitest exited 0: 1 file / 15 tests; dashboard Vitest exited 0: 1 file / 13 tests. | N/A — no authenticated browser credentials; injection and RTL prove role access and non-ADMIN zero snapshot requests. | Socios route/test stand-in, dashboard page/test, and U2 dashboard components. |
| U3a1 telemetry cleanup | Dashboard Vitest exited 0: 1 file / 8 tests. | Dashboard retains U2 regions and renders no detailed task telemetry. | `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}` |
| U3a2 ADMIN attention | Dashboard and OperationsAttention Vitest exited 0: 2 files / 12 tests. | RTL proves ADMIN render/refetch and zero non-ADMIN snapshot requests. | `apps/web/src/components/dashboard/{OperationsAttention.tsx,OperationsAttention.test.tsx}` plus U3a2 page integration. |
| U3b Operations navigation | Sidebar Vitest exited 0: 1 file / 8 tests. | RTL proves ADMIN Operations grouping, scheduler route identity, active state, and non-ADMIN absence. | `apps/web/src/lib/navigation.ts`, `apps/web/src/components/layout/Sidebar.tsx`, and `Sidebar.test.tsx` |

## Retained TDD and Chain State

- U3a1 met its 360-line cap (16 additions, 344 deletions); U3a2 met its 180-line cap (172 additions, 7 deletions); U3b completed at 136 delivery lines.
- Delivery strategy remains `ask-on-risk (split approved)` with `stacked-to-main`; U4 follows U3b and U5 remains deferred.
- The earlier combined-U3 and isolated-U3a attempts were reset and do not complete tasks; their detailed telemetry removal cannot be retained, including hidden CSS, without violating the dashboard contract.
- U3a1 RED proved an ADMIN snapshot request, then GREEN covered ADMIN immediate/30-second and all non-ADMIN zero-request paths. U3a2 covered bounded safe links and no controls. U3b covered grouping, scheduler targets, active state, and non-ADMIN absence.

## U4 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' exec vitest run 'src/components/layout/PersonalMenu.test.tsx' 'src/components/layout/Topbar.test.tsx' --config vitest.config.mts` exited 0: 2 files / 11 tests passed. |
| Runtime harness command/scenario and exact result | N/A — browser automation and authenticated credentials are unavailable. RTL exercised all four roles, logout-to-`/login`, profile loading, read-only preferences, and password rejection/retry. |
| Full suite | `pnpm test:run` reached `@athlos/db` and exited 1 only because `ATHLOS_TEST_DATABASE_URL` is unset; web passed 87 files / 742 tests. |
| Typecheck | `pnpm --filter '@athlos/web' typecheck` exited 0. |
| Prettier | Targeted `prettier --check` exited 0. |
| Diff check / cap | `git diff --check` exited 0. Source plus tests: 293 additions/deletions, below the 400-line cap. |
| Rollback boundary | `apps/web/src/app/(authed)/account/**`, `apps/web/src/components/layout/PersonalMenu.{tsx,test.tsx}`, and U4-related `Topbar` edits/tests. |

## U4 TDD Cycle Evidence

| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 3.1 | Component integration | `Topbar.test.tsx`: 1 file / 5 tests passed | `PersonalMenu.test.tsx` failed to resolve the absent personal menu. | N/A — RED-only task | Four role cases plus account, preference, rejected retry, and success cases. | N/A — test task. |
| 3.2 | Component integration | Reused Topbar baseline | Reused 3.1 failure | 2 files / 11 tests passed | All roles, no ADMIN settings, `getMe`, no preference editor, password retry, and logout redirect. | Kept the existing auth API contract unchanged and made Topbar delegate personal actions. |

## U5 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter '@athlos/web' exec vitest run 'src/components/AppShell.test.tsx' 'src/components/layout/MobileDrawer.test.tsx' 'src/components/layout/Topbar.test.tsx' 'src/components/layout/Sidebar.test.tsx' --config vitest.config.mts` exited 0: 4 files / 19 tests passed. |
| Runtime harness command/scenario and exact result | N/A — local authenticated browser automation is unavailable. RTL covered drawer opening focus, Tab/Shift+Tab wrapping, Escape, overlay, navigation dismissal, trigger restoration, inert background, scroll lock, and role-filtered links. |
| Full web suite | Within local `pnpm test:run`, `@athlos/web` exited 0: 88 files / 745 tests passed. |
| Local monorepo suite | Local `pnpm test:run` exited 1 at `@athlos/db`: seven integration suites require unset `ATHLOS_TEST_DATABASE_URL`; all preceding web tests passed. |
| Local quality gates | `pnpm typecheck`, `pnpm lint`, and `pnpm build` each exited 0; targeted Prettier and `git diff --check` also exited 0. |
| PR #239 head CI | PR head `728d54844d0d703e406e48d6d11e52e1b9537442` passed: full `pnpm test:run` with Postgres, `pnpm typecheck`, API build, Docker build smoke, drift check, and backup Bats gates. The workflow does not expose a `pnpm lint` step. |
| Merge-commit CI | Main merge commit `d32ef80e5777bee94766bb337c81cf6a562aeafa` run [`31345263242`](https://github.com/Victor0451/athlos/actions/runs/31345263242) completed successfully: repository `pnpm test:run` with Postgres, `pnpm typecheck`, API build, Docker build smoke, drift check, backup Bats, ShellCheck, deploy-workflow contract checks, and actionlint all passed. |
| Merged-source lint | `pnpm --filter '@athlos/web' lint` exited 0 locally against the exact merged U5 source. The CI workflow has no standalone lint step. |
| Diff check / cap | Source plus tests: 230 additions and 4 deletions, 234 total changed lines, below the 400-line cap. |
| Rollback boundary | `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/layout/{MobileDrawer,Topbar}.{tsx,test.tsx}`, and `Topbar.test.tsx`; revert together to remove only the mobile drawer. |

## U5 TDD Cycle Evidence

| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 4.1 | Component integration | `Topbar.test.tsx` + `Sidebar.test.tsx`: 2 files / 13 tests passed | `MobileDrawer.test.tsx` failed to resolve absent `MobileDrawer.tsx`. A new Topbar labeled-trigger test then failed because the trigger was absent. | N/A — RED-only task | Drawer test covers non-ADMIN filtering/inert lock and focus cycle plus Escape/overlay/navigation close. | Test-only task. |
| 4.2 | Component integration | Reused 13-test baseline | Reused 4.1 failures | 4 files / 19 tests passed. | Open focus, Shift+Tab and Tab wrap, three close paths, trigger state, and desktop Sidebar regression all pass. | Shared `visibleNavigation` preserves Sidebar/mobile filtering. |

## Status

All tasks (1.1–4.3) are complete. PR #239 merged to `main` as `d32ef80e5777bee94766bb337c81cf6a562aeafa`; no application code was edited in this artifact-only continuation. Merged-main CI run `31345263242` and the merged-source web lint close the final verification gate. Browser automation remains unavailable locally, with focused RTL accessibility evidence retained as the functional proof. No commit, push, or PR was created.
