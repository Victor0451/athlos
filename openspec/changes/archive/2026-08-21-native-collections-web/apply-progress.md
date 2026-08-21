# Apply Progress: Native Collections Web

## Slice

- **Change:** `native-collections-web`
- **Scope:** Slice 4, tasks 4.1–4.3 complete; Slice 1–3 history retained below
- **Mode:** Strict TDD with pnpm/Vitest
- **Delivery:** auto-chain, stacked-to-main
- **Implementation attempt token:** `sha256:ce897905ebcc2d25a1c85052104bdaf3011bec777e82c967e79c2086efefea02` preserved from the proven Engram evidence; no additional implementation attempt acquired or settled
- **Gatekeeper corrective retry token:** `sha256:401b3ee0d37c22ed385aef15d8e2ac68822d44f6ebfe46b2a3e100df11c80273`; artifact-only correction, no native attempt acquired or settled
- **Flags:** `DUES_ASSESSMENT_ENABLED` and Collections Web remain off by default; CTACTE projection, cash, and reconciliation remain absent

## Completed Tasks

- [x] **1.1 RED** — Added navigation/direct-access, labelled-landmark, typed-client, and idempotency RED coverage.
- [x] **1.2 GREEN** — Added the typed dues read/generation client, metadata-only retry-key store, minimal guarded workspace, capability wiring, and default-off rollout.
- [x] **1.3 REFACTOR** — Extracted `CollectionStatus`, retained behavior coverage, and added focused browser verification for disabled/enabled/denied and keyboard focus recovery.
- [x] **2.1 RED** — Extended API route and Web coverage for ADMIN pricing, non-ADMIN denial, overlap-draft retention, pricing states, generation outcomes, and conflict/replay coverage through the existing contracts.
- [x] **2.2 GREEN** — Added accessible pricing and monthly-generation panels, typed pricing adapters, stable price keys, stable retry metadata, ADMIN-only pricing controls, and ADMIN/TESORERO generation.
- [x] **2.3 REFACTOR** — Added announced states, responsive narrow-layout checks, role verification, and explicit absence of CTACTE controls/requests.
- [x] **3.1 RED** — Added API debt allow-list, authorization, unavailable/not-found, and RTL no-debt/error/labelled-card coverage before production changes.
- [x] **3.2 GREEN** — Added the evidence-backed debt detail DTO/read route, typed client, Socios-selected debt cards, component/benefit explanation, and settlement/allocation history without raw audit or authorization data.
- [x] **3.3 REFACTOR** — Added recoverable error focus, responsive debt-card assertions, denial coverage, and narrow-layout no-horizontal-loss Playwright coverage; flags remain off.
- [x] **4.1 RED** — Added service, route, PostgreSQL, client, and RTL coverage for unique explicit allocations, stale conflicts, non-empty reasons, compensation-only append behavior, duplicate races, draft retention, review, focus, and retry-key rotation.
- [x] **4.2 GREEN** — Added typed monetary settlement/reversal clients and explicit accessible dialogs. A 409 refetches debt/history, abandons the conflicted key, retains the draft, requires explicit review, and retries with a new key.
- [x] **4.3 REFACTOR** — Added focused settlement/reversal/replay, keyboard, narrow/mobile, no-cash/no-reconciliation, flags-off, role, and no-horizontal-loss verification.

## TDD Cycle Evidence

| Task | Test files / layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 1.1 | `collections/page.test.tsx`, `collections-idempotency.test.ts`, `api/dues.test.ts` / RTL + unit | 92 files / 771 tests passed before edits | Written first; initial run failed on the three missing production imports | Final focused run passed | Navigation gates, direct denial, landmarks, same/changed retry drafts, clearing, query and idempotency header | Existing behavior retained after status extraction |
| 1.2 | Same files / RTL + unit | Existing-file safety net passed | 1.1 RED tests preceded implementation | Final focused run passed | Enabled/disabled/role branches and two client contract paths | API and guard code formatted and typechecked |
| 1.3 | Page/status tests + Playwright | Focused regression passed | N/A — pure status-component extraction; prior behavioral assertions were the approval coverage | Browser scenarios passed | Default-off, enabled ADMIN, enabled unauthorized, and keyboard focus restoration | `CollectionStatus` extracted without behavior change |
| 2.1 | `apps/api/src/routes/dues-routes.test.ts`, `collections/page.test.tsx`, `lib/api/dues.test.ts` / Fastify + RTL + unit | API route/service baseline: 2 files / 16 tests; Web baseline: 3 files / 7 tests | Web tests initially failed on missing pricing/generation panels and client pricing adapters; an initial status-bearing API assertion also failed before the final existing-contract decision | Focused API and Web suites passed after the minimal panel/client implementation | Pricing conflict retention, empty/unavailable/success states, created/replayed/zero/conflict UI states, ADMIN denial, and generation wire calls | Kept the native generation wire response unchanged; replay state is derived from the retained stable key and zero state from the returned obligation list |
| 2.2 | Pricing/generation panels + typed dues client / RTL + unit | 2.1 safety net passed | 2.1 RED preceded production additions | API 17/17 and Web 17/17 passed | Base/Sport fields, effective dates, stable list keys, ADMIN pricing, and ADMIN/TESORERO generation | Shared price action handling and compact field mapping removed duplicate branches |
| 2.3 | Page tests + Playwright / RTL + E2E | Focused regression passed | N/A — verification/refactor task; prior matrix assertions were the approval coverage | Default-off E2E 1 passed/3 skipped; enabled E2E 3 passed/1 skipped | Announced alerts/statuses, role denial, narrow layout, keyboard focus, and no CTACTE/projection/reconciliation request | Prettier, ESLint, and typechecks passed without behavior changes |
| 3.1 | `settlements.test.ts`, `settlement-routes.test.ts`, `dues.test.ts`, `DebtPanel.test.tsx` / Fastify + unit + RTL | API 2 files / 13 tests; Web 2 files / 15 tests passed before edits | API and Web RED runs failed on missing allow-list/read/client/panel behavior before implementation | Final focused API 17/17 and Web 19/19 passed | Safe DTO fields, finance-role denial, unknown socio, unavailable read, no-debt, error alert, labelled cards, history | Approval coverage retained while status focus and responsive card semantics were tightened |
| 3.2 | Debt repository/service/route, typed client, page/panel / unit + Fastify + RTL | 3.1 safety net passed | 3.1 RED preceded production additions | Focused API 17/17 and Web 19/19 passed | Components, benefits, original/outstanding amounts, status, currency, allocation links, reversal eligibility, Socios selection | Explicit DTO mapping excludes audit/authorization snapshots and unrelated member fields |
| 3.3 | Debt panel + Collections Playwright / RTL + E2E | Focused regression passed | N/A — refactor/verification task; prior behavior assertions were the approval coverage | Focused Web 19/19; enabled E2E 4 passed/1 skipped; default-off E2E 1 passed/4 skipped | Denied route, announced alert focus, labelled controls/cards, 320px viewport, no horizontal overflow, no CTACTE/cash/reconciliation text | Prettier, ESLint, typechecks, and `git diff --check` passed |
| 4.1 | API 17/17; Web 19/19 before edits | New Web imports failed; API contract tests were added before implementation | API 22/22; Web 27/27 | Multi-obligation exactness, stale 409, reason, compensation, replay/key rotation | Focused assertions retained |
| 4.2 | 4.1 RED passed | Client/dialog symbols absent | Web/API focused runs passed | 409 draft retention/review, stable headers, compensation result | Typed contracts and action orchestration kept bounded |
| 4.3 | Focused regression passed | Approval coverage for existing panels | E2E and static checks passed | PostgreSQL race/append tests, replay, role denial, keyboard, 320px | No cash/reconciliation/CTACTE surface added |

## Prior Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused API Vitest | `pnpm --filter @athlos/api exec vitest run src/routes/dues-routes.test.ts src/modules/dues/service.test.ts` → 2 files, 17 tests passed |
| Focused Web Vitest | `pnpm --filter @athlos/web exec vitest run 'src/app/(authed)/collections/page.test.tsx' src/lib/api/dues.test.ts src/lib/collections-idempotency.test.ts` → 3 files, 17 tests passed |
| Web full Vitest | `pnpm --filter @athlos/web test:run` → 95 files, 788 tests passed |
| Typecheck | `pnpm --filter @athlos/web typecheck && pnpm --filter @athlos/api typecheck` → passed |
| Lint | `pnpm --filter @athlos/web lint && pnpm --filter @athlos/api lint` → passed |
| Runtime harness, flags off | `pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts` → 1 passed, 3 skipped |
| Runtime harness, flag on | `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts` → 3 passed, 1 skipped; ADMIN and TESORERO flows verified |
| Formatting / cleanup | Targeted Prettier check and `git diff --check` passed; unrelated generated `apps/web/next-env.d.ts` was restored |
| Aggregate runner | `pnpm test:run` reached the Web suite successfully (95 files / 788 tests), then stopped in `@athlos/db` because `ATHLOS_TEST_DATABASE_URL` is not configured; unrelated PostgreSQL integration failures were not changed |
| Rollback boundary | Disable `DUES_ASSESSMENT_ENABLED`; revert only Slice 2 pricing/generation panels, page orchestration, typed pricing helpers/tests, route regression tests, and Slice 2 E2E assertions. Preserve Slice 1 gates/retry primitives and all native ledger/API authority. |

## Slice 3 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused API Vitest | `pnpm --filter @athlos/api exec vitest run src/modules/dues/settlements.test.ts src/routes/settlement-routes.test.ts` → 2 files, 17 tests passed |
| Focused Web Vitest | `pnpm --filter @athlos/web exec vitest run 'src/components/collections/DebtPanel.test.tsx' 'src/app/(authed)/collections/page.test.tsx' src/lib/api/dues.test.ts` → 3 files, 19 tests passed |
| Typecheck and lint | `pnpm --filter @athlos/api typecheck && pnpm --filter @athlos/web typecheck && pnpm --filter @athlos/api lint && pnpm --filter @athlos/web lint` → passed |
| Formatting and whitespace | Targeted Prettier check plus `git diff --check` → passed |
| Runtime harness, flags off | `pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts` → 1 passed, 4 skipped |
| Runtime harness, flags on | `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts` → 4 passed, 1 skipped; selected debt cards and 320px no-overflow path verified |
| Full-suite disposition | Web/API full Vitest attempts exceeded the 120s command budget; API output also showed unrelated PostgreSQL lease tests require `ATHLOS_TEST_DATABASE_URL`. Slice proof is the focused API/Web suites and Playwright harness above. |
| Rollback boundary | Revert only the Slice 3 safe debt read DTO/mappers, route/client adapter, `DebtPanel`, page Socios/debt orchestration, and Slice 3 tests/E2E. Preserve Slice 1–2 gates, pricing/generation, retry metadata, native ledger, and all Slice 4 mutations. |

## Slice 3 Bounded Evidence

- **Authored Slice 3 snapshot:** 397 additions/deletions counted against the Slice 2 apply snapshot; within the `<=400` changed-line work-unit boundary. Count excludes prior Slice 1–2 working-tree changes and OpenSpec/Engram artifact bodies.
- **Scope guard:** no settlement allocation, reversal, cash, CTACTE, reconciliation, ledger mutation, or Slice 4 behavior was added.
- **Evidence revision:** `d6b708f1025645d09b37c382800d28b7dba09f2c16cf219793ad75232a1ba467`
- **Revision input:** `native-collections-web|slice-3|strict-tdd|tasks=3.1,3.2,3.3|api-focused=2-files-17-tests-passed|web-focused=3-files-19-tests-passed|typecheck=api-web-passed|lint=api-web-passed|e2e-default=1-passed-4-skipped|e2e-enabled=4-passed-1-skipped|format=passed|changed_lines=397|scope=debt-read-only-no-allocation-reversal-cash-ctacte`

## Bounded Evidence

- **Authored Slice 2 snapshot:** 360 additions/deletions counted against the Slice 1 apply snapshot; within the 400-line boundary.
- **Excluded from the count:** prior Slice 1 implementation, OpenSpec artifact bodies, and pre-existing untracked `.pi/` / unrelated change artifacts.
- **Scope guard:** no debt DTO/UI, settlement allocation, reversal, cash, reconciliation, CTACTE projection/dual-write, or later-slice behavior was added.
- **Evidence revision:** `4442ca9c555f51a011914ec6f16b99b8fa51c40543826ee3a90c71a1c32626a1`
- **Revision input:** `native-collections-web|slice-2|strict-tdd|tasks=2.1,2.2,2.3|api-focused=2-files-17-tests-passed|web-focused=3-files-17-tests-passed|web-full=95-files-788-tests-passed|typecheck=api-web-passed|lint=api-web-passed|e2e-default=1-passed-3-skipped|e2e-enabled=3-passed-1-skipped|format=passed|aggregate=web-passed-db-blocked-missing-ATHLOS_TEST_DATABASE_URL|changed_lines=360|scope=pricing-generation-only-no-debt-allocation-reversal-cash-ctacte`

## Verification Note

The aggregate runner is infrastructure-blocked only by the missing PostgreSQL test URL. Focused API/Web tests, typechecks, lint, formatting, and both flag-off/flag-on browser harnesses passed for this slice.

## Slice 4 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused API Vitest | `pnpm --filter @athlos/api exec vitest run src/modules/dues/settlements.test.ts src/routes/settlement-routes.test.ts` → 2 files, 22 tests passed |
| Focused Web Vitest | `pnpm --filter @athlos/web exec vitest run src/components/collections/SettlementActions.test.tsx src/lib/api/dues.test.ts src/lib/collections-idempotency.test.ts src/components/collections/DebtPanel.test.tsx 'src/app/(authed)/collections/page.test.tsx'` → 5 files, 27 tests passed |
| Focused PostgreSQL Vitest | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos pnpm --filter @athlos/api exec vitest run src/modules/dues/settlements.postgres.integration.test.ts -t 'allocates only|persists exactly|serializes different-key allocations|reverses by compensation|maps concurrent different-key duplicate reversals' --testTimeout=20000` → 5 passed, 10 skipped |
| Typecheck | API and Web `tsc --noEmit` passed |
| Lint | API and Web ESLint passed |
| Normalization | Targeted Prettier check and `git diff --check` passed |
| Runtime flags off | `pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts` → 1 passed, 5 skipped |
| Runtime flags on, Slice 4 | `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1 --grep 'records an allocation'` → 1 passed |
| Runtime flags on, role/mobile regressions | `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1 --grep 'enabled ADMIN can navigate|enabled TESORERO|enabled unauthorized|selected debt'` → 4 passed |
| Full PostgreSQL disposition | Full file reached 13/15 before two failures: one unrelated pre-existing agreement/work expectation failure and one corrected test-date issue; mapped Slice 4 tests passed with the focused command above. |
| Rollback boundary | Revert only `SettlementActions`, Slice 4 dues client/page wiring, Slice 4 tests/E2E, and the Slice 4 task metadata/progress. Preserve Slice 1–3 gates, pricing/generation/debt read paths, native ledger data, flags, and all unrelated working-tree changes. |

## Slice 4 Bounded Evidence

- **Authored Slice 4 delta:** 342 additions/deletions against the pre-Slice-4 working-tree snapshot; within the `<=400` review boundary.
- **Scope guard:** no cash shift/close/tender/reconciliation, CTACTE UI/projection/dual-write, implicit allocation, ledger mutation/deletion, or authorization semantics were added.
- **Evidence revision:** `sha256:161dbf587d64d9f0b5ba92ed62dcec7fd441c6212b2ff5ab3be7bfe9db633f6b`
- **Revision input:** `native-collections-web|slice-4|strict-tdd|tasks=4.1,4.2,4.3|api-focused=2-files-22-tests-passed|web-focused=5-files-27-tests-passed|postgres-focused=5-passed-10-skipped-timeout=20s|typecheck=api-web-passed|lint=api-web-passed|e2e-default=1-passed-5-skipped|e2e-enabled-slice4=1-passed|e2e-enabled-role-mobile=4-passed|format=passed|changed_lines=342|scope=explicit-allocation-reversal-only-no-cash-reconciliation-ctacte|attempt=sha256:ce897905ebcc2d25a1c85052104bdaf3011bec777e82c967e79c2086efefea02`

## Artifact Correction Evidence

- **Correction scope:** OpenSpec task checkboxes and cumulative apply-progress only; no production code or tests changed, and no tests rerun.
- **Changed lines:** `<=100` authored artifact-correction lines.
- **Evidence revision:** `sha256:1dcfcedbd687cb44035451f13b115e7eb6aa5b6d5835fc576dbbd51da1fc85c9`
- **Revision input:** `native-collections-web|artifact-correction|tasks=4.1,4.2,4.3|openspec=tasks.md+apply-progress.md|engram=consistent|implementation-evidence=sha256:161dbf587d64d9f0b5ba92ed62dcec7fd441c6212b2ff5ab3be7bfe9db633f6b|changed_lines<=100|no-production-or-tests|no-tests-rerun|native-attempt=sha256:401b3ee0d37c22ed385aef15d8e2ac68822d44f6ebfe46b2a3e100df11c80273`

## Slice 4 Verification Note

The Slice 4 evidence above is cumulative and already proven in Engram. The aggregate PostgreSQL run includes the unrelated pre-existing agreement/work expectation failure; the mapped Slice 4 PostgreSQL tests passed independently. Flags remain off by default, and no cash, reconciliation, or CTACTE surface was added.

## Bounded Remediation Evidence

- **Authorization:** Single maintainer-authorized remediation for the failed verification blockers; no native attempt was acquired or settled.
- **Native attempt token:** `sha256:e0ffbe9bd5f93c5193f52495f94483d7a8829e6d00a5b8567ff76f662310566d`
- **Remediates evidence revision:** `sha256:d92b6f7890cec58070d6021bfe11838f520cb3141030ea2adc28cac8796d3689`
- **New evidence revision:** `sha256:97e1c8a9e35c37c577094f0b6e94576ad90067e2a221e346358ba5eac755aa36`
- **Changed lines:** 4 authored remediation lines (two assertion replacements); the final worktree diff also contains the pre-existing three-line allocation test addition from the implementation attempt. The remediation remains within the `<=100` line budget.
- **Allocation causality:** The database persisted the submitted allocation set correctly, but `created_at, id` orders UUID-backed rows by the timestamp/UUID tie-breaker rather than request order. The assertion now checks exact cardinality and membership, so it proves both obligations and amounts without inventing an ordering contract.
- **Agreement/community-work causality:** The agreement/work test predates the Web debt DTO. Community work correctly creates a non-cash `ALLOCATION`, leaves cash income unchanged, and reduces outstanding debt to zero. The current safe debt contract intentionally retains the paid obligation and allocation history for explanation/reversal, so the fixture now expects `PAID` history with zero total instead of an empty list; no regression is hidden.
- **Strict TDD:** The pre-correction safety run reproduced the agreement expectation failure; the row-order test reproduced the nondeterministic contract through its prior failed evidence. The corrected mapped scenarios then passed 2/2 in the focused GREEN run.
- **Exact post-correction checks:** Full PostgreSQL integration `15/15` passed; mapped PostgreSQL selection `5 passed, 10 skipped`; API lint passed; `git diff --check` passed.
- **Enabled Playwright:** `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1` completed the full enabled coverage with `5 passed, 1 skipped` in `1.5m`. The bounded harness started Next in `6.6s`; the post-run process and port checks found no matching Next/Playwright process or listener. Serializing workers changed scheduling only and did not weaken coverage.
- **Scope guard:** No production code, feature defaults, CTACTE projection, cash, reconciliation, authorization semantics, ledger data, or failed `verify-report.md` was changed.

```yaml
schema: gentle-ai.remediation-evidence/v1
outcome: passed
attempt_token: sha256:e0ffbe9bd5f93c5193f52495f94483d7a8829e6d00a5b8567ff76f662310566d
remediates_evidence_revision: sha256:d92b6f7890cec58070d6021bfe11838f520cb3141030ea2adc28cac8796d3689
evidence_revision: sha256:97e1c8a9e35c37c577094f0b6e94576ad90067e2a221e346358ba5eac755aa36
changed_lines: 4
full_postgresql: 15/15 passed
mapped_postgresql: 5 passed, 10 skipped
playwright_enabled: 5 passed, 1 skipped, workers=1, cleanup=clean
scope: test-contract-and-harness-only
```

## Second Bounded E2E Remediation Evidence

- **Authorization:** Second maintainer-authorized E2E remediation only; native attempt was not acquired or settled.
- **Attempt token:** `sha256:0db22ef447c8dc8d1738d5858bd25b348493d9d4c5e0e6ef0d80aa94b386256`
- **Remediates evidence revision:** `sha256:a4d39bbbfc348d365c494ce2caa55e3ca97d59d8a8dd751863d91a51b3e94fad`
- **New evidence revision:** `sha256:42be8719fe8ef4483585a421c1de2d234159fca4a52b8d4ece882371a6f49a1a`
- **Changed lines:** 14 authored remediation lines across the E2E spec and shared Playwright fixture; within the `<=100` line budget.
- **Exact causality:** The narrow debt and mobile allocation/reversal journeys omitted the initial `GET /api/v1/dues/prices?period=2026-08` interception, so Next forwarded it to an unavailable API and the existing browser-console guard observed HTTP 500 errors. The fixture now fulfills that request with an empty pricing list before navigation. `/socios` already redirected through the client auth gate, but had no runtime coverage; the new E2E scenario asserts `/login?from=%2Fsocios` with a cold-compile-safe timeout.
- **Strict TDD:** Existing failure reproduced first; the new runtime coverage and missing fixture helper were written before the helper implementation (RED); the focused corrected run passed 3/3 (GREEN); Prettier normalization and `git diff --check` passed.
- **Exact checks:** `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1` → 6 passed, 1 skipped, exit 0. Focused `--grep 'unauthenticated|selected debt|records an allocation'` → 3 passed, exit 0.
- **Scope guard:** E2E fixture/harness only; no production code, console/network assertions, feature defaults, ledger behavior, or `verify-report.md` changed. Verification remains failed and requires a fresh verify phase.

```yaml
schema: gentle-ai.remediation-evidence/v1
outcome: passed
attempt_token: sha256:0db22ef447c8dc8d1738d5858bd25b348493d9d4c5e0e6ef0d80aa94b386256
remediates_evidence_revision: sha256:a4d39bbbfc348d365c494ce2caa55e3ca97d59d8a8dd751863d91a51b3e94fad
evidence_revision: sha256:42be8719fe8ef4483585a421c1de2d234159fca4a52b8d4ece882371a6f49a1a
changed_lines: 14
playwright_enabled: 6 passed, 1 skipped, workers=1, exit 0
focused_playwright: 3 passed, workers=1, exit 0
normalization: prettier check passed; git diff --check passed
native_attempt: not acquired or settled
verification_disposition: verify-report remains fail; fresh sdd-verify required
scope: e2e-fixture-harness-only
```
