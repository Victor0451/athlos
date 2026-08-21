```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3ff8b88ba8dbdb1c72cebedff8dd14fbe5cc3d664eb53c7dd29e0eaa56c84af7
verdict: pass
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 17/17
test_command: DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1
test_exit_code: 0
test_output_hash: sha256:34ba0849ffdfe9a449a931b72b1ef183008d2a484e3a6e3e5f0900f5f65b2cc2
build_command: pnpm --filter @athlos/api typecheck && pnpm --filter @athlos/web typecheck && pnpm --filter @athlos/api lint && pnpm --filter @athlos/web lint && pnpm exec prettier --check apps/api/src/modules/dues/allocations.ts apps/api/src/modules/dues/settlements.ts apps/api/src/modules/dues/settlements.postgres.integration.test.ts apps/api/src/modules/dues/settlements.test.ts apps/api/src/routes/dues-routes.test.ts apps/api/src/routes/dues.ts apps/api/src/routes/settlement-routes.test.ts apps/web/e2e/collections.spec.ts apps/web/e2e/fixtures/authenticated-dashboard.ts apps/web/src/app/(authed)/collections apps/web/src/components/collections apps/web/src/lib/api/dues.ts apps/web/src/lib/api/dues.test.ts apps/web/src/lib/collections-idempotency.ts apps/web/src/lib/collections-idempotency.test.ts openspec/changes/native-collections-web && git diff --check
build_exit_code: 0
build_output_hash: sha256:cbd78779a5d56a09181c072b2003a5c40edf11098d37f67a36bc2b5e927bbbaf
```

# Final post-remediation verification: native-collections-web

Verdict: **PASS.** All 10 requirements and 17 scenarios have fresh passing runtime coverage. The full PostgreSQL integration, focused API/Web, enabled serial Playwright (including `/socios` redirect), and quality gates all passed.

## Scope and completeness

| Item | Result |
|---|---|
| Artifact stores read | OpenSpec and Engram: proposal, combined delta specs, design, tasks, cumulative apply-progress, prior failed verify-report, and both remediation records. |
| Strict TDD | Active; apply-progress contains the cumulative TDD cycle evidence for 12/12 tasks. Referenced tests exist and the fresh runs are green. |
| Tasks | 12/12 complete. |
| Supersedes | Failed evidence `sha256:a4d39bbbfc348d365c494ce2caa55e3ca97d59d8a8dd751863d91a51b3e94fad`; remediations `sha256:97e1c8a9e35c37c577094f0b6e94576ad90067e2a221e346358ba5eac755aa36` and `sha256:42be8719fe8ef4483585a421c1de2d234159fca4a52b8d4ece882371a6f49a1a`. |
| Attempt | Supplied token `sha256:92080806d9ec5abc58c85e4f7d2b23e2b49988a92950acedb662ed45a06ee04c` was not acquired or settled. |

## Fresh execution evidence

| Check | Command | Result | Output SHA-256 |
|---|---|---|---|
| Full PostgreSQL integration | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos pnpm --filter @athlos/api exec vitest run src/modules/dues/settlements.postgres.integration.test.ts --testTimeout=20000` | 1 file, 15/15 tests passed, exit 0 | `sha256:798ecc95da9cd93a5e070fc84fc8cf55372d2fc6e000aaf24a27170e6354c4e8` |
| Focused API | `pnpm --filter @athlos/api exec vitest run src/routes/dues-routes.test.ts src/modules/dues/settlements.test.ts src/routes/settlement-routes.test.ts` | 3 files, 35/35 tests passed, exit 0 | `sha256:e2564b8165d437a40dee0d08d504995f11981fa2789280f76436f9556c60c717` |
| Focused Web | `5-file Vitest selection (collections RTL/client)` | 5 files, 27/27 tests passed, exit 0 | `sha256:c17a60f41c8a122b56287a2246cbdc72b93981c5bbc5a8558227b97d2d1233f1` |
| Enabled serial Playwright | `DUES_ASSESSMENT_ENABLED=true pnpm --filter @athlos/web exec playwright test e2e/collections.spec.ts --workers=1` | 6 passed, 1 skipped, exit 0; includes unauthenticated `/socios` redirect | `sha256:34ba0849ffdfe9a449a931b72b1ef183008d2a484e3a6e3e5f0900f5f65b2cc2` |
| Typecheck, lint, format, whitespace | API and Web typecheck; API and Web lint; targeted Prettier check; `git diff --check` | all passed, exit 0 | `sha256:cbd78779a5d56a09181c072b2003a5c40edf11098d37f67a36bc2b5e927bbbaf` |

## Spec compliance matrix

| Requirement | Scenario | Covering fresh runtime evidence | Result |
|---|---|---|---|
| Workspace states and rollout | Replayed result | Focused Web 27/27 | COMPLIANT |
| Workspace states and rollout | Projection absent | Enabled TESORERO E2E | COMPLIANT |
| Accessible responsive operation | Keyboard error recovery | SettlementActions RTL + enabled ADMIN E2E | COMPLIANT |
| Accessible responsive operation | Narrow allocation review | Enabled narrow/mobile E2E | COMPLIANT |
| First-slice scope boundary | Out-of-scope cash request | SettlementActions RTL + enabled ADMIN E2E | COMPLIANT |
| Capability navigation | Enabled authorized navigation | Enabled ADMIN E2E | COMPLIANT |
| Capability navigation | Disabled or unauthorized navigation | Focused Web + enabled unauthorized E2E | COMPLIANT |
| Protected routing | Unauthenticated `/socios` redirect | Enabled serial E2E `unauthenticated user is redirected from Socios` | COMPLIANT |
| Protected routing | Direct Collections denial | Focused Web + enabled unauthorized E2E | COMPLIANT |
| ADMIN pricing administration | Overlapping price retained | Focused Web 27/27 | COMPLIANT |
| ADMIN pricing administration | Non-ADMIN denial | Focused API 35/35 | COMPLIANT |
| Idempotent monthly generation | Ambiguous retry | Focused Web 27/27 | COMPLIANT |
| Safe debt explanation | Authorized detail | Focused API + Web | COMPLIANT |
| Safe debt explanation | Non-authorized read | Focused API 35/35 | COMPLIANT |
| Explicit settlement allocation | Partial multi-obligation settlement | Full PostgreSQL 15/15 | COMPLIANT |
| Explicit settlement allocation | Concurrent over-allocation | Full PostgreSQL 15/15 | COMPLIANT |
| Append-only reversal | Already reversed allocation | Full PostgreSQL 15/15 | COMPLIANT |

## Correctness and scope boundaries

- The live debt read service allow-lists financial explanation and reversal eligibility without raw audit or authorization evidence.
- Settlement allocation requires positive unique allocations, blocks over-allocation, and appends only compensations for reversals.
- No current implementation changes were made by verification. No CTACTE, cash, tender, close, reconciliation, implicit allocation, ledger mutation/deletion, or authorization-semantics scope expansion was observed.

## TDD compliance

| Check | Result | Details |
|---|---|---|
| Evidence reported | PASS | Cumulative apply-progress has TDD cycle evidence for all 12 tasks. |
| RED tests exist | PASS | Referenced API, Web, PostgreSQL and E2E test files exist. |
| GREEN confirmed | PASS | 77 focused/integration tests and 6 enabled E2E cases passed fresh. |
| Triangulation | PASS | Unit/route, RTL/client, PostgreSQL, and E2E cover critical financial and UI interactions. |
| Safety net | PASS | Historical pre-edit safety-net evidence is recorded for each task. |
| Assertion quality | PASS | Reviewed changed tests: no tautology, orphan assertion, ghost loop, or smoke-only assertion was found. |

## Attempt evidence

```yaml
outcome: passed
attempt_token: sha256:92080806d9ec5abc58c85e4f7d2b23e2b49988a92950acedb662ed45a06ee04c
new_evidence_revision: sha256:3ff8b88ba8dbdb1c72cebedff8dd14fbe5cc3d664eb53c7dd29e0eaa56c84af7
test_exit_code: 0
build_exit_code: 0
cleanup: no Next/Playwright process or port 3101 listener remained; no process was killed.
changed_lines: verification implementation = 0; observed candidate tracked diff = 267 additions + 20 deletions, plus untracked candidate files.
```

## Archive readiness

Ready for the native settlement/archive gate. This report is a refreshed immutable preimage that supersedes the prior failed evidence.
