# Tasks: Negotiated Dues Settlement

## Review Workload Forecast

| Field                   | Value                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Estimated changed lines | 2,080–2,625 authored additions + deletions across eight work units; generated migration snapshots excluded from this count but included in delivery identity |
| 400-line budget risk    | High                                                                                                                                                         |
| Chained PRs recommended | Yes                                                                                                                                                          |
| Suggested split         | PR 1A → PR 1B → PR 1C → PR 2 → PR 3 → PR 4A → PR 4B → PR 5                                                                                                   |
| Delivery strategy       | ask-on-risk                                                                                                                                                  |
| Chain strategy          | stacked-to-main                                                                                                                                              |

| Work unit / PR                       | Estimated authored lines | Review risk | Delivery gate                                                |
| ------------------------------------ | -----------------------: | ----------- | ------------------------------------------------------------ |
| 1A — persistence and migration       |                  300–360 | Medium      | Measure trigger/migration diff before apply                  |
| 1B — agreement domain mutations      |                  340–395 | High        | **ask-on-risk gate**: pause if measured forecast exceeds 400 |
| 1C — agreement read routes and audit |                  280–350 | Medium      | Focused API/audit review                                     |
| 2 — typed Web client                 |                  190–260 | Low         | Standard focused review                                      |
| 3 — create/view Collections workflow |                  340–400 | High        | **ask-on-risk gate**: pause if measured forecast exceeds 400 |
| 4A — revision UI and lineage         |                  250–330 | Medium      | Focused Web review                                           |
| 4B — community-work evidence UI      |                  300–380 | Medium–High | Measure API/UI boundary before apply                         |
| 5 — BETA rollout configuration       |                   80–150 | Low         | Config and operational review                                |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Delivery Plan

Use stacked-to-main chained PRs in deployment order. Each PR starts from freshly updated `main` after its predecessor merges, contains its tests and documentation/rollback evidence, and remains independently reviewable. Before applying 1B or 3 (and any unit whose measured authored additions + deletions exceed 400), stop under `ask-on-risk`; do not accept an oversized diff without an explicit delivery decision. Generated migration snapshots do not count against the authored-line budget, but must be present in the immutable delivery identity.

Strict TDD is mandatory: record RED failure, implement minimum GREEN, triangulate boundary cases, then refactor only while green. Confirmed commands: `pnpm --filter @athlos/api test:run`, `pnpm --filter @athlos/web test:run`, `pnpm --filter @athlos/db test:run`, `pnpm typecheck`, and `pnpm lint`.

## Work Units

### 1A. Persist versioned negotiated terms and agreement-linked community work

- [x] Implemented persistence and migration work unit 1A.

**Scope:** Add the additive persistence representation and migration while preserving legacy monetary rows, lifecycle constraints, and Collections-only settlement boundaries.

- **Depends on:** None. **Independently mergeable:** Yes; deploy with flags false.
- **RED:** Add failing cases in `packages/db/src/schema/dues.test.ts` and focused PostgreSQL agreement integration coverage in `apps/api/src/modules/dues/settlements.postgres.integration.test.ts` asserting: legacy `SIMPLE`/`INSTALLMENT` remains readable; negotiated v1 narrative-only terms validate without a category; unsupported kind/version and malformed bounded terms fail; optional `dues_community_work.agreement_id` must match the same socio/obligation; no allocation is created by agreement persistence.
- **GREEN:** Update `packages/db/src/schema/dues-agreements.ts`; add `packages/db/drizzle/0058_dues_open_agreements.sql`; register `packages/db/drizzle/meta/_journal.json` and generated migration snapshot metadata if required. Add `NEGOTIATED`, `terms_version`, discriminator-aware trigger validation, immutability protection, and nullable restricted community-work FK without changing active-unique/revision constraints or introducing `CTActe`/Treasury effects.
- **TRIANGULATE / REFACTOR:** Cover zero/max commitments, invalid UUID/date/money/evidence bounds, legacy trigger behavior, and same-versus-cross-obligation agreement linkage; simplify shared fixtures without weakening SQL assertions.
- **Verify:** `pnpm --filter @athlos/db test:run`; focused API PostgreSQL integration test command; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Revert application/schema references only after flags are false; retain additive migration and all created history—never down-migrate or delete financial/audit records.
- **Commit intent:** `feat(db): support versioned negotiated dues agreements`

### 1B. Implement versioned agreement decoding, mutation, and immutable revisions

- [x] Implemented agreement domain mutation work unit 1B.

**Scope:** Implement negotiated create/revise behavior with explicit claim outcomes while retaining legacy monetary behavior and no debt movement.

- **Depends on:** 1A. **Independently mergeable:** Yes after 1A; API remains feature-gated by absent Web entry points.
- **RED:** Add failing tests in `apps/api/src/modules/dues/agreements.test.ts` and focused replay/concurrency cases in `apps/api/src/modules/dues/settlements.postgres.integration.test.ts` for negotiated narrative-only creation, decoder rejection of malformed/unsupported persisted data, `created` versus `replayed`, fingerprint mismatch, ADMIN/TESORERO enforcement, competing/stale create or revise conflict, successor lineage, legacy read/reschedule compatibility, and unchanged debt/settlement/allocation history.
- **GREEN:** Update `apps/api/src/modules/dues/agreements.ts` with the versioned representation union, `decodeAgreementTerms`, negotiated create/revise service methods, explicit mutation result, locking/transactional successor creation, and retained legacy `reschedule` compatibility alias. Reject cross-representation revisions during BETA.
- **TRIANGULATE / REFACTOR:** Prove legacy schedule limits remain unchanged; prove negotiated structured amounts are commitments rather than allocations; prove replay emits no additional writes/audit; extract shared decoding/claim helpers only after tests pass.
- **Verify:** `pnpm --filter @athlos/api test:run`; focused PostgreSQL integration suite; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Revert the negotiated service/decoder path while preserving legacy decoder and additive rows; disable agreement flags before rolling back consumers.
- **Commit intent:** `feat(dues): add negotiated agreement lifecycle`
- **Gate:** **ask-on-risk before apply**. If measured authored diff exceeds 400 lines, pause for an explicit delivery decision; do not merge an exception implicitly.

### 1C. Expose lineage routes and complete agreement audit records

- [x] Implemented lineage routes and agreement audit work unit 1C.

**Scope:** Add read/revision HTTP contracts and atomic, redacted audit detail for negotiated agreements.

- **Depends on:** 1B. **Independently mergeable:** Yes; API contracts are additive.
- **RED:** Add failing cases in `apps/api/src/routes/agreements-routes.test.ts` for lineage read ordering, strict create union, idempotency keys, revision status/replay fields, and authorization; add `apps/api/src/routes/audit.test.ts` cases for actor/authority/request/reason/terms/predecessor-successor completeness, redacted projections, rollback on audit failure, and no audit on reject/replay.
- **GREEN:** Update `apps/api/src/routes/dues.ts`, route test files, and the applicable audit projection files (`packages/audit/src/query.ts`, `apps/api/src/routes/audit.ts`) only where allowlisting/redaction requires it. Add `GET /api/v1/dues/obligations/:obligationId/agreements`, negotiated revision route, legacy reschedule alias preservation, DTO fields, and transaction-bound audit payloads.
- **TRIANGULATE / REFACTOR:** Assert malformed persisted terms become partial/unavailable rather than complete DTOs, route/body fingerprint differences conflict, and audit emission failure rolls back agreement changes.
- **Verify:** `pnpm --filter @athlos/api test:run`; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Revert only added routes/DTO and audit projection fields; retain immutable audit and agreement records.
- **Commit intent:** `feat(dues): expose agreement lineage and audit details`

### 2. Add a typed, defensive Web dues client

- [x] Implemented typed defensive Web dues client work unit 2.

**Scope:** Provide client types/operations and normalized errors needed by the feature without rendering the workflow yet.

- **Depends on:** 1C. **Independently mergeable:** Yes; no new UI entry point.
- **RED:** Add failing cases in `apps/web/src/lib/api/dues.test.ts` covering negotiated/legacy DTO decoding, malformed 2xx as `partial_data`, status/network mappings, idempotency headers, create/read/revise/community-work operations, and replay preservation.
- **GREEN:** Update `apps/web/src/lib/api/dues.ts` with versioned terms and agreement lineage types, input/result types, bounded runtime decoders, `getObligationAgreements`, create/revise/community-work functions, and `DuesOperationErrorKind` mapping.
- **TRIANGULATE / REFACTOR:** Test each normalized error kind and a malformed nested terms/evidence response; share request/header helpers without losing action-specific fingerprint inputs.
- **Verify:** `pnpm --filter @athlos/web test:run`; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Revert the additive client exports only; no server or financial state is changed.
- **Commit intent:** `feat(web): add typed negotiated dues client`

### 3. Deliver feature-gated Spanish agreement create/view workflow

- [x] Implement feature-gated Spanish agreement create/view workflow work unit 3.

**Scope:** Add the obligation-level Spanish create/view workflow, explicit UX states, and feature configuration while preserving existing payment/reversal controls.

- **Depends on:** 2. **Independently mergeable:** Yes after the API/client chain; inactive unless both Collections and agreement flags are enabled.
- **RED:** Add failing tests in `apps/web/src/app/(authed)/layout.test.tsx`, `apps/web/src/app/(authed)/collections/page.test.tsx`, and new colocated `AgreementActions.test.tsx`/`AgreementForm.test.tsx` for dual flag gating, open-obligation-only entry point, Spanish narrative/reason validation, loading/permission/conflict/success/replay/partial-data states, preserved drafts, alert/status accessibility, and the explicit “agreement does not reduce debt” guidance.
- **GREEN:** Update `apps/web/src/lib/features.tsx`, `apps/web/src/app/(authed)/layout.tsx`, `apps/web/src/app/(authed)/collections/page.tsx`, and `DebtPanel.tsx`; add `AgreementActions.tsx` and `AgreementForm.tsx` alongside their tests. Keep API calls/idempotency/stale refresh in the page container and presentation in components. Render Spanish copy only; do not add Treasury tender/cash/close/reconciliation or `CTActe` controls/requests.
- **TRIANGULATE / REFACTOR:** Cover flag-off, closed obligation, malformed lineage, active-agreement conflict refresh, replay announcement, and unchanged monetary settlement/reversal rendering; extract presentation only if the measured slice remains within budget.
- **Verify:** `pnpm --filter @athlos/web test:run`; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Disable `DUES_AGREEMENTS_ENABLED` and/or `NATIVE_COLLECTIONS_WEB_ENABLED`, then revert new Web components/config plumbing; existing Collections journeys remain intact.
- **Commit intent:** `feat(collections): add negotiated agreement workflow`
- **Gate:** **ask-on-risk before apply**. At or above the measured 400-line boundary, pause for an explicit delivery decision and split further rather than silently exceeding the budget.

### 4A. Add negotiated revision UI and immutable history

- [x] Implement negotiated revision UI and immutable history work unit 4A.

**Scope:** Let operators revise active negotiated agreements, view all prior revisions, and recover from stale drafts.

- **Depends on:** 3. **Independently mergeable:** Yes; only adds actions to the gated workflow.
- **RED:** Add failing tests in colocated `AgreementActions.test.tsx` and `apps/web/src/app/(authed)/collections/page.test.tsx` for immutable ascending revision history, revision reason/terms validation, update success, stale-conflict lineage/debt refresh, abandoned idempotency draft, explicit resubmit, and no editing of prior revisions.
- **GREEN:** Extend `AgreementActions.tsx`, `AgreementForm.tsx`, and the Collections page/container tests to call the typed revise operation, manage revision-specific idempotency drafts, render Spanish lineage/status copy, and retain existing create behavior.
- **TRIANGULATE / REFACTOR:** Exercise empty/long history and refresh failure/permission/replay states; consolidate shared form state while preserving conflict drafts.
- **Verify:** `pnpm --filter @athlos/web test:run`; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Revert revision controls/history rendering without affecting read/create or immutable server history.
- **Commit intent:** `feat(collections): revise negotiated agreements`

### 4B. Record accepted community-work evidence and refresh debt once

- [x] Implement community-work evidence UI and debt refresh work unit 4B.

**Scope:** Add the separate accepted-work UI flow tied to the active agreement and existing non-cash settlement transaction.

- **Depends on:** 4A. **Independently mergeable:** Yes; gated workflow extension.
- **RED:** Add failing tests in new `CommunityWorkForm.test.tsx`, Collections page tests, and `apps/api/src/modules/dues/community-work.test.ts` for evidence/reason/positive-value validation, agreement linkage, ADMIN/TESORERO permission, over-allocation/stale conflict, exact replay, one allocation/audit set, confirmed-only success, and post-confirmation debt refresh.
- **GREEN:** Add `CommunityWorkForm.tsx` and tests; wire it through `AgreementActions.tsx` and `collections/page.tsx` to `createCommunityWorkEvidence`. Update `apps/api/src/modules/dues/community-work.ts` and focused route/integration tests only as needed for optional `agreement_id`, transaction audit evidence, and replay result. Keep it `NON_CASH`; create no cash/tender/CTActe side effects.
- **TRIANGULATE / REFACTOR:** Prove an unfulfilled agreement commitment leaves debt unchanged; prove API failure/replay never duplicates allocation/audit and evidence draft survives; reduce duplicated conflict-refresh code.
- **Verify:** `pnpm --filter @athlos/api test:run`; `pnpm --filter @athlos/web test:run`; focused PostgreSQL integration suite; `pnpm typecheck`; `pnpm lint`.
- **Rollback boundary:** Disable agreement/Web flags and revert evidence UI wiring; retain completed non-cash settlements, allocations, evidence, and audit history.
- **Commit intent:** `feat(collections): record community-work settlement evidence`

### 5. Enable and validate the BETA flag set

- [x] Implement and validate the complete BETA flag rollout work unit 5.

**Scope:** Configure the complete BETA rollout, validate safe defaults, and document smoke-check and rollback operations.

- **Depends on:** 4B. **Independently mergeable:** Yes only after all functional slices have merged and passed smoke checks.
- **RED:** Add failing configuration/compose validation tests targeting `docker-compose.beta.yml`, `packages/config/src/schema.ts`, and the repository’s BETA config validation location: reject partial four-flag BETA sets and assert non-BETA schema/example defaults remain `false`.
- **GREEN:** Update `docker-compose.beta.yml` and the concrete BETA deployment validation/config test files; add operator rollout/rollback notes in `openspec/changes/dues-negotiated-settlement/` or the established operations documentation path. Enable all four required flags together only in BETA after smoke checks: `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_ASSESSMENT_ENABLED`, `DUES_AGREEMENTS_ENABLED`, `DUES_CASH_ENABLED`.
- **TRIANGULATE / REFACTOR:** Test each missing flag and disabled agreement/Web rollback path; document that rollback disables entry points but never removes or rewrites financial/audit history.
- **Verify:** focused config/compose validation command; `pnpm --filter @athlos/web test:runtime-feature-flags`; `pnpm typecheck`; `pnpm lint`; BETA smoke check for agreement save, community-work confirmation/debt refresh, existing monetary settlement/reversal, and absence of Treasury/`CTActe` effects.
- **Rollback boundary:** Disable the BETA feature flags as a complete operational rollback; preserve schema and all historical records.
- **Commit intent:** `chore(beta): enable negotiated dues workflow`

## Dependency and Mergeability Summary

```text
1A → 1B → 1C → 2 → 3 → 4A → 4B → 5
```

Every unit is an independently mergeable stacked-to-main PR after its predecessor. Units 1A–4B are additive and deploy safely with the new Web flags false; unit 5 is the only BETA enablement step and must follow successful focused verification and smoke checks. No work unit may introduce `CTActe` linkage, Treasury cash/tender behavior, implicit debt reduction, or changes to existing pricing, assessment, monetary settlement, reversal, cash, or closing flows.
