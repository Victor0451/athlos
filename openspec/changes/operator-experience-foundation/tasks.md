# Tasks: Operator Experience Foundation

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated authored changed lines | 1,235; U1 90, U2 230, U3a1 296, U3a2 124, U3b 95, U4 250, U5 150 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 U1 → PR2 U2 → PR3 U3a1 telemetry cleanup → PR4 U3a2 ADMIN attention → PR5 U3b Operations navigation → PR6 U4 → PR7 U5 |
| Delivery strategy | ask-on-risk (split approved) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| PR/work unit | Start → finish; merged to main in order | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR1 / U1 Landing | `main` → landing; merge to `main` before PR2 | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` | dev: `/` has only `/login` primary action | `apps/web/src/app/page.tsx`, test |
| PR2 / U2 Dashboard foundation | PR1 `main` → Socios proof + role cards; merge before PR3 | `pnpm --filter '@athlos/api' test:run -- 'src/routes/socios.test.ts' && pnpm --filter '@athlos/web' test:run -- 'src/app/(authed)/dashboard/page.test.tsx'` | Non-ADMIN cards work; no snapshot request | Socios regression + dashboard/tests |
| PR3 / U3a1 telemetry cleanup | PR2 `main` → remove detailed dashboard telemetry; ~296 lines; merge before U3a2 | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' --config vitest.config.mts` | Dashboard retains U2 regions and renders no detailed task telemetry | `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}` |
| PR4 / U3a2 ADMIN attention | U3a1 `main` → bounded ADMIN safe-link region; ~124 lines; minimal page integration | `pnpm --filter '@athlos/web' exec vitest run 'src/app/(authed)/dashboard/page.test.tsx' 'src/components/dashboard/OperationsAttention.test.tsx' --config vitest.config.mts` | ADMIN sees ≤10 safe links with 30-second refresh; non-ADMIN makes zero snapshot requests; no controls | `apps/web/src/components/dashboard/{OperationsAttention.tsx,OperationsAttention.test.tsx}` plus minimal U3a2 page integration |
| PR5 / U3b ADMIN Operations navigation | U3a2 `main` → Operations grouping only; ~95 lines | `pnpm --filter '@athlos/web' exec vitest run 'src/components/layout/Sidebar.test.tsx' --config vitest.config.mts` | ADMIN sees Operations with unchanged `/admin/scheduler` targets and active accent; non-ADMIN sees none | `apps/web/src/lib/navigation.ts`, `apps/web/src/components/layout/{Sidebar.tsx,Sidebar.test.tsx}` |
| PR6 / U4 Personal profile | U3b `main` → personal routes/menu; merge before U5 | `pnpm --filter '@athlos/web' test:run -- 'src/app/(authed)/account/page.test.tsx' 'src/app/(authed)/account/password/page.test.tsx' 'src/app/(authed)/account/preferences/page.test.tsx' 'src/components/layout/PersonalMenu.test.tsx'` | Every role retries password and signs out to `/login` | account, PersonalMenu, Topbar/tests |
| PR7 / U5 Mobile shell | U4 `main` → drawer/filtering; merge to `main` last | `pnpm --filter '@athlos/web' test:run -- 'src/components/layout/MobileDrawer.test.tsx' 'src/components/layout/Topbar.test.tsx' 'src/components/layout/Sidebar.test.tsx'` | <1024px: trap, dismiss, restore trigger focus | AppShell/layout drawer/tests |

## Phase 1: Public and Truthful Data Foundation

- [x] 1.1 **RED U1:** add `apps/web/src/app/page.test.tsx` for landing, sole primary `/login`, and no metrics/member/scheduler/status; run U1 and observe failure.
- [x] 1.2 **GREEN/REFACTOR U1:** update `apps/web/src/app/page.tsx` minimally; rerun U1 and browser check.
- [x] 1.3 **RED U2:** extend `apps/api/src/routes/socios.test.ts`: anonymous aggregate denial; all roles succeed; observe failure.
- [x] 1.4 **GREEN/REFACTOR U2:** preserve the existing `requireAuth()` aggregate gate; pass API test before consuming it.
- [x] 1.5 **RED U2:** add dashboard tests for independent loading/empty/error, notifications, aggregate, and no invented totals; observe failure.
- [x] 1.6 **GREEN/REFACTOR U2:** create `apps/web/src/components/dashboard/{WorkspaceCards,SociosSummary,NotificationSummary}.tsx`; update `app/(authed)/dashboard/page.tsx` and pass U2.

## Phase 2: ADMIN Orientation Without Control Changes

- [x] 2.1 **RED U3a1:** extend `apps/web/src/app/(authed)/dashboard/page.test.tsx` to prove detailed task telemetry is absent while U2 regions remain; run the U3a1 command and observe failure. Depends on U2.
- [x] 2.2 **GREEN/REFACTOR U3a1:** update only `apps/web/src/app/(authed)/dashboard/{page.tsx,page.test.tsx}` to remove rendered detailed telemetry. Pass U3a1; ~296 lines; revert only these two files.
- [x] 2.3 **RED U3a2:** add `apps/web/src/components/dashboard/OperationsAttention.test.tsx` and extend `page.test.tsx` for ADMIN-only ≤10 safe links, fake 30-second refresh, no controls, and zero non-ADMIN snapshot requests. Depends on U3a1 main.
- [x] 2.4 **GREEN/REFACTOR U3a2:** create `OperationsAttention.tsx` and minimally integrate it in `page.tsx`. Pass U3a2; ~124 lines; revert the component/test and only U3a2 page integration.
- [x] 2.5 **RED U3b:** add `apps/web/src/components/layout/Sidebar.test.tsx` for ADMIN Operations grouping, active accent, unchanged `/admin/scheduler` targets, and no non-ADMIN group. Depends on U3a2 main.
- [x] 2.6 **GREEN/REFACTOR U3b:** create `apps/web/src/lib/navigation.ts`; update `Sidebar.tsx` to group existing ADMIN links. Pass U3b; ~95 lines; revert only its three files.

## Phase 3: Personal Boundary

- [ ] 3.1 **RED U4:** create account/page tests for all roles’ menu actions, excluded ADMIN settings, `getMe`, read-only preferences (no write/editor), password success/retry, and logout-to-`/login`.
- [ ] 3.2 **GREEN/REFACTOR U4:** create `app/(authed)/account/{page.tsx,password/page.tsx,preferences/page.tsx}` and `components/layout/PersonalMenu.tsx`; update `Topbar.tsx` to use it, `lib/api/auth.ts` only as existing contract; retain in-menu `useAuth().logout`.

## Phase 4: Accessible Mobile Shell and Final Gates

- [ ] 4.1 **RED U5:** create `components/layout/{MobileDrawer,Topbar,Sidebar}.test.tsx` for role filtering, labeled controls, inert/scroll lock, Tab cycle, dismissal, and focus restoration; observe failure.
- [ ] 4.2 **GREEN/REFACTOR U5:** create `MobileDrawer.tsx`; update `AppShell.tsx`, `Topbar.tsx`, and `Sidebar.tsx` to share `lib/navigation.ts` and pass U5 checks.
- [ ] 4.3 Run `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; browser-check `/`, dashboard, account, and drawer. No APIs, preference writes, controls, or relocation.
