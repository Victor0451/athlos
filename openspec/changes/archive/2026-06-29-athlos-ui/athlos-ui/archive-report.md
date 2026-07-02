# SDD Archive Report — athlos-ui (Slice 8)

**Change**: athlos-ui
**Archived**: 2026-06-29
**Tag range**: v0.5.11 → v0.5.18
**Artifact store**: both (engram + openspec)

---

## 1. Summary

Slice 8 delivered the first operator-facing web console for Athlos, replacing `psql`/`curl` workflows for ADMIN, TESORERO, OPERADOR, and CONSULTA roles. The user-facing web app (`apps/web/`) is now usable from the browser against the deployed Fastify API v0.5.18, surfacing 16,383 socios, 200,945 ctacte movements, padrones, scheduler administration, and an approvals queue with honest STUB copy for the deferred executor.

**Final state**: v0.5.18 (tag → main HEAD `4758726`) · 8 chained PRs · ~13,000 LoC across 87 files · 332/332 tests passing (1 skipped) · 49 sub-commits across all slices · 0 Co-Authored-By trailers · 0 size:exceptions after 8a.1.

Three new capabilities were shipped: `web-frontend` (operator console end-to-end), `auth-cookies` (refresh-token transport contract, backend deferred), and `scheduler-ui` (ADMIN job grid + detail + trigger + enable/disable). All three are now in the source of truth.

---

## 2. PR-by-PR Timeline

| Tag | PR | Sub-commits | Cumulative LoC | Cumulative Tests | Notable |
|-----|----|-------------|----------------|-------------------|---------|
| v0.5.11 | 8a.1 Auth foundation | 4 | ~350 | 70 | Memory-only JWT + httpOnly refresh cookie contract + first-party proxy + `refreshInFlight` |
| v0.5.12 | 8a.2 Protected shell | 3 | ~750 | 127 | AppShell + Sidebar (role-gated) + Topbar + `(authed)/layout.tsx` |
| v0.5.13 | 8a.3 Dashboard | 2 | ~1,100 | 183 | 4 metric cards + auto-refresh 30s + API health strip |
| v0.5.14 | 8b.1 Socios | 5 | ~1,500 | 210 | List + detail `[id]` + DataTable + `Intl.NumberFormat('es-AR')` |
| v0.5.15 | 8b.2 Ctacte | 7 | ~1,900 | 241 | List + detail `[cuenta]` + 200,945 movements + CSV export |
| v0.5.16 | 8b.3 Padrones | 6 | ~2,400 | 276 | List + detail `[id]` by disciplina + ejercicio |
| v0.5.17 | 8c.1 Scheduler admin | 14 | ~4,700 | 253 | 6-job grid + detail + `setEnabled` + run history + trigger-now |
| v0.5.18 | 8c.2 Approvals + settings | 9 | ~7,000 | 332 | ApprovalCard + OperatorProfile + `useParams()` + STUB-aware copy |

**Totals**: 8 PRs · 49 sub-commits · ~7,000 cumulative LoC delta vs main · 332 tests passing

---

## 3. Capabilities Shipped

| Capability | Domain | Requirements | Scenarios | Status |
|------------|--------|-------------|-----------|--------|
| `web-frontend` | Operator console | 6 | 17 | ✅ Complete |
| `auth-cookies` | Refresh token transport | 3 | 8 | ✅ Contract shipped (backend deferred) |
| `scheduler-ui` | ADMIN scheduler surface | 4 | 10 | ✅ Complete |

**Requirement breakdown**:

- **web-frontend**: Operator Login/Logout (4 scenarios) · Silent Token Refresh (2 scenarios) · Protected Routing (1 scenario) · AppShell Layout (4 scenarios) · Dashboard Cards (3 scenarios) · Design System + Deferred Features (3 scenarios)
- **auth-cookies**: Refresh Cookie Transport Contract (4 scenarios) · First-Party Auth Proxy Routes (3 scenarios) · Backend Implementation Deferred (2 scenarios)
- **scheduler-ui**: Scheduler Job List (3 scenarios) · Job Detail Page (5 scenarios) · Disabled Job Visual Treatment (1 scenario) · Cross-Slice Disabled Feature Placeholders (1 scenario)

---

## 4. Verification Results

| Check | Result |
|-------|--------|
| Test suite | **332/332 passing** (1 skipped) |
| typecheck | **Clean** |
| lint | **Clean** |
| `pnpm build` | **Succeeds** |
| Git state | `main` HEAD `4758726` = v0.5.18 merge commit |
| PRs merged | **8 chained PRs** → main |
| Co-Authored-By trailers | **0** (orchestrator stripped via `filter-branch`) |
| size:exceptions | **0** after 8a.1 (all subsequent PRs split ≤400 LoC) |
| CRITICAL issues | **0** |

---

## 5. LESSONs Captured

### From apply sub-agent (obs #2634)

1. **TRUST UX, not specs**: The brief's API paths were wrong (8b.2, 8b.3). Verify against `apps/api/src/routes/*.ts` before launching.
2. **`useParams()` over Promise pattern**: All detail pages (`/socios/[id]`, `/ctacte/[cuenta]`, `/padrones/[id]`, `/admin/scheduler/[name]`) work in jsdom tests without a `Suspense` wrapper.
3. **`Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`**: Required for ctacte display. Centralize in `lib/format.ts`.
4. **Splitting pattern**: "production, then tests in separate commits" applied pair-wise (api + api tests; component + component tests; page + page tests). Each commit ≤400 LoC.

### From orchestrator (engram #2531)

5. **stale remote tag pattern**: When shipping a tag that was previously used and left behind, orchestrator must `git push origin --delete TAG && git push --force origin TAG`. Occurred at v0.5.11, v0.5.12, v0.5.13.
6. **Post-apply checklist**: After final PR merge + tag, orchestrator runs `sdd-archive` to formally close the slice.
7. **Co-Authored-By removal**: `filter-branch` or `git filter-repo` strips AI trailers from commit history before merge to main.

### New LESSONs from Slice 8

8. **N-way split pattern scales**: 8a.2 (3 sub-PRs) · 8a.3 (4) · 8b.1 (5) · 8b.2 (7) · 8b.3 (6) · 8c.1 (14) · 8c.2 (9). Largest split was 14-way for ~2,348 LoC (8c.1). Each kept ≤400 LoC per the forecast review budget.
9. **9-way split for 2,317 LoC** (8c.2): The full 8c.2 surface area was ~685 LoC estimated. Aggressive 9-way split kept each sub-PR at ≤338 LoC. Pattern is production-first, then tests — pairs of related files (api + api tests; component + component tests; page + page tests).
10. **Full test suite verification catches cross-PR regressions** (8a.3 LESSON): `pnpm test:run` (not `pnpm --filter @athlos/web test`) must be used — it catches regressions across the full monorepo that per-package runs miss.
11. **Spec vs codebase mismatch** (recurring 8b.2 + 8b.3): brief's API paths were wrong. VERIFY against `apps/api/src/routes/*.ts` before launching. Brief is always secondary to actual route definitions.
12. **STUB-aware copy**: When the approval executor is a backend STUB, the UI must render honest copy ("Aprobación registrada — la ejecución real queda pendiente") rather than misleading success messages. Test explicitly asserts the misleading copy is NOT present.
13. **`setEnabled` interface preserved for BullMQ migration** (E5+): The scheduler detail page's enable/disable toggle calls `PATCH /api/v1/scheduler/jobs/{name}` with `{ enabled: bool }`. The `setEnabled` interface in the BullMQ migration plan must match this contract.

---

## 6. Out of Scope (Deferred to Phase 9+)

| Item | Reason |
|------|--------|
| Caja/Gastos domains | Separate domain work; UI shows "Próximamente" |
| 7 backend gaps (Caja/Gastos read, file storage, receipt reprint, change-password, `/api/v1/disciplinas`, executor, etc.) | Backend slices; UI surfaces exist as placeholders |
| Cookie-based refresh | Requires `auth-cookies` backend slice (contract shipped in Slice 8) |
| Mobile-first responsive design | Not in Slice 8 scope |
| PWA install prompt | App-shell SW shipped; install prompt deferred |
| E2E Playwright tests | Slice 10b |

---

## 7. Files Archived

The following OpenSpec artifacts are moved to `openspec/changes/archive/2026-06-29-athlos-ui/`:

| Artifact | Path in archive |
|----------|----------------|
| Exploration | `exploration.md` |
| Proposal | `proposal.md` |
| Delta specs | `specs/web-frontend/spec.md` · `specs/auth-cookies/spec.md` · `specs/scheduler-ui/spec.md` |
| Design | `design.md` |

**Note**: `tasks.md` was not persisted as an OpenSpec artifact; task completion evidence is recorded in Engram obs #2634. `verify-report.md` was not separately produced; verification evidence is embedded in Engram obs #2634.

---

## 8. Operator Console Functional Status

| Route | Feature | Status |
|-------|---------|--------|
| `/login` | Auth flow (JWT memory-only + silent refresh + httpOnly cookie) | ✅ Working |
| `/dashboard` | 4 cards (API Health + Master Counts + Scheduler Status + Recent Runs) + 30s auto-refresh | ✅ Working |
| `/socios` | Paginated list across 16,383 records | ✅ Working |
| `/socios/[id]` | Socio detail | ✅ Working |
| `/ctacte` | List with account filter | ✅ Working |
| `/ctacte/[cuenta]` | Account detail + 200,945 movements + CSV export | ✅ Working |
| `/padrones` | List by disciplina + ejercicio | ✅ Working |
| `/padrones/[id]` | Padron detail | ✅ Working |
| `/admin/scheduler` | 6-job grid | ✅ Working |
| `/admin/scheduler/[name]` | Job detail + trigger-now + enable/disable + run history | ✅ Working |
| `/admin/approvals` | Approvals queue (Próximamente placeholder + deep-link form) | ✅ URL valid, copy honest |
| `/admin/approvals/[token]` | Approval detail + approve/reject (STUB executor) | ✅ Working with honest STUB copy |
| `/admin/settings` | Operator profile + change-password (Próximamente) | ✅ URL valid |

**Deferred surfaces** (all render "Próximamente — disponible en una próxima versión"):

- Caja/Gastos sidebar items (not routed in Slice 8)
- Approval executor (backend STUB; decision recorded but action not applied)

---

## 9. Phase 9 (E3+ Scope) Unlocked

The following work is now unblocked or remains outstanding:

| Item | Dependency | Notes |
|------|-----------|-------|
| Cross-table analytics endpoints | API gaps | Enables dashboard "Master Counts" enrichment |
| BullMQ migration (E5+) | `setEnabled` interface preserved | `PATCH /api/v1/scheduler/jobs/{name}` contract stable |
| N16 gastos FK to ctacte | Caja/Gastos domain | Enables ctacte → gastos cross-navigation |
| Backend `auth-cookies` slice | UI contract shipped (Slice 8) | Switches from body-based to httpOnly cookie refresh |
| Approvals executor | Replace STUB | `recordApprovalDecision` → actual ctacte.anulate application |
| Backend gaps | Caja/Gastos, file storage, receipt reprint, change-password, `/api/v1/disciplinas`, executor | 7 separate items |
| Mobile/responsive design | — | Sidebar drawer pattern in design.md §AppShell |
| E2E Playwright tests | Slice 10b | Full browser smoke tests |

---

## Observation IDs for Traceability

| Artifact | Engram Observation ID |
|----------|---------------------|
| Proposal | — (OpenSpec only) |
| Design | — (OpenSpec only) |
| web-frontend spec | — (OpenSpec only) |
| auth-cookies spec | — (OpenSpec only) |
| scheduler-ui spec | — (OpenSpec only) |
| Tasks + verify evidence | **#2634** |
| Orchestrator post-apply checklist | **#2531** |
| Archive report | **This document** |

---

*SDD Cycle Complete — Slice 8 archived 2026-06-29*
