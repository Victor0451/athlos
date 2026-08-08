# Tasks: Operator Experience Foundation

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated authored changed lines | 970; PR1 90, PR2 230, PR3 150, PR4 250, PR5 250 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 landing → PR2 dashboard foundation → PR3 ADMIN Operations → PR4 personal profile → PR5 mobile shell |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| PR/work unit | Start → finish; merged to main in order | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR1 / U1 Landing | `main` → landing; merge to `main` before PR2 | `pnpm --filter '@athlos/web' test:run -- 'src/app/page.test.tsx'` | dev: `/` has only `/login` primary action | `apps/web/src/app/page.tsx`, test |
| PR2 / U2 Dashboard foundation | PR1 `main` → Socios proof + role cards; merge before PR3 | `pnpm --filter '@athlos/api' test:run -- 'src/routes/socios.test.ts' && pnpm --filter '@athlos/web' test:run -- 'src/app/(authed)/dashboard/page.test.tsx'` | Non-ADMIN cards work; no snapshot request | Socios regression + dashboard/tests |
| PR3 / U3 ADMIN orientation | PR2 `main` → attention + Operations; merge before PR4 | `pnpm --filter '@athlos/web' test:run -- 'src/app/(authed)/dashboard/page.test.tsx' 'src/components/layout/Sidebar.test.tsx'` | ADMIN gets ≤10 scheduler links; no controls | navigation, sidebar, attention/tests |
| PR4 / U4 Personal profile | PR3 `main` → personal routes/menu; merge before PR5 | `pnpm --filter '@athlos/web' test:run -- 'src/app/(authed)/account/page.test.tsx' 'src/app/(authed)/account/password/page.test.tsx' 'src/app/(authed)/account/preferences/page.test.tsx' 'src/components/layout/PersonalMenu.test.tsx'` | Every role retries password and signs out to `/login` | account, PersonalMenu, Topbar/tests |
| PR5 / U5 Mobile shell | PR4 `main` → drawer/filtering; merge to `main` last | `pnpm --filter '@athlos/web' test:run -- 'src/components/layout/MobileDrawer.test.tsx' 'src/components/layout/Topbar.test.tsx' 'src/components/layout/Sidebar.test.tsx'` | <1024px: trap, dismiss, restore trigger focus | AppShell/layout drawer/tests |

## Phase 1: Public and Truthful Data Foundation

- [ ] 1.1 **RED U1:** add `apps/web/src/app/page.test.tsx` for landing, sole primary `/login`, and no metrics/member/scheduler/status; run U1 and observe failure.
- [ ] 1.2 **GREEN/REFACTOR U1:** update `apps/web/src/app/page.tsx` minimally; rerun U1 and browser check.
- [ ] 1.3 **RED U2:** extend `apps/api/src/routes/socios.test.ts`: anonymous aggregate denial; all roles succeed; observe failure.
- [ ] 1.4 **GREEN/REFACTOR U2:** preserve the existing `requireAuth()` aggregate gate; pass API test before consuming it.
- [ ] 1.5 **RED U2:** add dashboard tests for independent loading/empty/error, notifications, aggregate, and no invented totals; observe failure.
- [ ] 1.6 **GREEN/REFACTOR U2:** create `apps/web/src/components/dashboard/{WorkspaceCards,SociosSummary,NotificationSummary}.tsx`; update `app/(authed)/dashboard/page.tsx` and pass U2.

## Phase 2: ADMIN Orientation Without Control Changes

- [ ] 2.1 **RED U3:** test `OperationsAttention`/`lib/navigation.ts`: ADMIN snapshot, fake 30-second refresh, 10 links, Operations, active accent, unchanged `/admin/scheduler` targets.
- [ ] 2.2 **GREEN/REFACTOR U3:** create `components/dashboard/OperationsAttention.tsx`, `lib/navigation.ts`; update `dashboard/page.tsx` and `components/layout/Sidebar.tsx`; non-ADMIN uses `enabled: false`, no controls/relocation.

## Phase 3: Personal Boundary

- [ ] 3.1 **RED U4:** create account/page tests for all roles’ menu actions, excluded ADMIN settings, `getMe`, read-only preferences (no write/editor), password success/retry, and logout-to-`/login`.
- [ ] 3.2 **GREEN/REFACTOR U4:** create `app/(authed)/account/{page.tsx,password/page.tsx,preferences/page.tsx}` and `components/layout/PersonalMenu.tsx`; update `Topbar.tsx` to use it, `lib/api/auth.ts` only as existing contract; retain in-menu `useAuth().logout`.

## Phase 4: Accessible Mobile Shell and Final Gates

- [ ] 4.1 **RED U5:** create `components/layout/{MobileDrawer,Topbar,Sidebar}.test.tsx` for role filtering, labeled controls, inert/scroll lock, Tab cycle, dismissal, and focus restoration; observe failure.
- [ ] 4.2 **GREEN/REFACTOR U5:** create `MobileDrawer.tsx`; update `AppShell.tsx`, `Topbar.tsx`, and `Sidebar.tsx` to share `lib/navigation.ts` and pass U5 checks.
- [ ] 4.3 Run `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; browser-check `/`, dashboard, account, and drawer. No APIs, preference writes, controls, or relocation.
