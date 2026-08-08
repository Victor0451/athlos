# Design: Operator Experience Foundation

## Technical Approach

Implement slice one in web shell/protected home. Keep `AppShell` as auth boundary, centralize permission-aware navigation, and isolate `/dashboard` TanStack Query regions. Reuse APIs; no backend contract or scheduler move.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Shared vs duplicated navigation | One model prevents visibility/target drift | Add `lib/navigation.ts`; both shells filter by `CurrentUser` |
| Query cache vs global store | TanStack Query already owns server state | Queries own remote state; local state owns drawer, menu, and forms; auth stays `useAuth` |
| Personal routes vs ADMIN settings | Extra routes preserve the personal/system boundary | Add `/account`, `/account/password`, `/account/preferences`; retain `/admin/settings` |
| Use Socios aggregate now vs omit totals | Existing route is authenticated but lacked explicit role-matrix evidence | Use only after a RED API regression proves anonymous denial and all four authenticated roles succeed |

## Component and Route Architecture

- `app/page.tsx`: server-rendered institutional landing; only primary link is `/login`.
- `AppShell` renders `Sidebar`, `Topbar`, and `MobileDrawer`. `Topbar` owns labeled drawer and `PersonalMenu` triggers.
- `navigation.ts` defines common workspace links and ADMIN `Operations`; scheduler targets remain `/admin/scheduler` and `/admin/scheduler/[name]`.
- `/dashboard` composes `WorkspaceCards`, `SociosSummary`, `NotificationSummary`, and ADMIN-only `OperationsAttention`. Each region owns loading/empty/alert output so failures do not disable route cards.
- `PersonalMenu` gives every role account overview, password change, read-only notification preferences, and sign-out. Sign-out remains in-menu, calls existing `useAuth().logout`, and redirects to `/login`. Personal pages compose `AccountOverview` (`getMe`), `PasswordChangeForm` (`changePassword`), and static `NotificationPreferences`, which claims no persisted values and issues no writes.

```text
useAuth.user -> navigation filter -> Sidebar/MobileDrawer/WorkspaceCards
             -> all roles: GET /auth/me, /notifications, /socios?aggregate=1
             -> ADMIN only: GET /admin/operations/snapshot (30 s)
PasswordChangeForm -> POST /auth/change-password -> inline success/safe error
PersonalMenu sign-out -> useAuth.logout -> clear session -> /login
```

## Role and Authorization Matrix

| Surface/API | ADMIN | TESORERO | OPERADOR | CONSULTA | Server boundary |
|---|---:|---:|---:|---:|---|
| Dashboard, Socios, Ctacte, Padrones cards | Yes | Yes | Yes | Yes | Existing route gates |
| Socios aggregate | Yes | Yes | Yes | Yes | `GET /api/v1/socios?aggregate=1` is inside `requireAuth()` |
| Own notifications/profile/password/sign-out | Yes | Yes | Yes | Yes | `requireAuth()`; notifications use `recipientId = operator.sub`; logout always clears locally |
| Operations links/snapshot | Yes | No | No | No | Snapshot and scheduler retain `requireRole('ADMIN')` |
| Data-steward links | Yes | Permission | Permission | Permission | Existing `data_steward` gate |

Visibility orients; servers authorize. Non-ADMIN uses `enabled: false` and makes zero snapshot requests. ADMIN attention remains server-bounded to 10 links without controls.

## Focus and Keyboard Contract

Below `lg` (1024px), the drawer records its trigger, locks scroll, makes app content inert, focuses its first control, and traps Tab/Shift+Tab. Escape, overlay, or navigation closes it and restores trigger focus; the overlay intercepts pointers. Personal menu similarly restores focus after Escape, outside activation, or selection and supports Arrow/Home/End. Triggers expose `aria-expanded`/`aria-controls`; regions are named.

## File Changes

| Area | Action |
|---|---|
| `app/page.tsx`, `app/(authed)/dashboard/page.tsx` and tests | Modify |
| `lib/navigation.ts`, `components/dashboard/**` and tests | Create |
| `components/AppShell.tsx`, `components/layout/{Sidebar,Topbar,MobileDrawer,PersonalMenu}.tsx` and tests | Modify/Create |
| `app/(authed)/account/{page.tsx,password/page.tsx,preferences/page.tsx}` and tests | Create |
| `apps/api/src/routes/socios.test.ts` | Modify/extend existing test with authorization regression only |

## Strict TDD and Work Units

Each unit starts with failing Vitest/RTL tests, then minimal code and refactor: (1) landing; (2) Socios authorization proof and common dashboard regions; (3) ADMIN attention and unchanged Operations targets; (4) personal routes, password outcomes/retry, and sign-out placement for all roles; (5) desktop/mobile filtering, focus trap, dismissal, navigation close, and restoration. Personal-menu tests assert every role retains sign-out, invokes existing logout, clears the session, and reaches `/login`. Use `user-event`, fake timers for the 30-second refresh, mocked `apiFetch` at component boundaries, and API injection tests for gates. Run focused web tests, API tests for unit 2, then web typecheck/lint/build. Each unit includes tests and remains independently revertible; forecast against 400 authored changed lines and ask before apply if chaining is needed.

## Threat Matrix

| Boundary | Applicability | Design response / RED tests |
|---|---|---|
| Documentation-like paths | N/A: no execution classification | None |
| Git repository selection | N/A: no VCS commands | None |
| Commit state | N/A: no commit automation | None |
| Push state | N/A: no push automation | None |
| PR commands | N/A: no PR automation | None |

## Rollout and Rollback

No migration or feature flag. Roll out and roll back web files with matching tests per unit; the authorization proof may remain. Never remove personal-menu sign-out independently during rollout or rollback: preserve existing logout and its `/login` redirect. Existing APIs, ADMIN gates, and scheduler URLs stay untouched.

## Open Questions

None.
