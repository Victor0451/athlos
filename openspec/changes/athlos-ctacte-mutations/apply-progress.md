# Apply Progress — athlos-ctacte-mutations PR #31 corrective batch

**Mode**: Strict TDD
**Branch**: `fix/ctacte-mutations-r2`
**Scope**: Only replay reclaim identity, comprobante blob header delivery, CI PostgreSQL wiring, evidence reconciliation, and payment idempotency operator isolation.

## Final implementation commit

- `b403e7c fix(ctacte): guard replay reclaim identity`
- `9f000fb fix(ctacte): isolate payment idempotency retries`

## TDD Cycle Evidence

| Task | Test file / layer | Safety net | RED | GREEN | Triangulation / refactor |
|---|---|---|---|---|---|
| Guard failed/stale lease reclaim by fingerprint | `ctacte-comprobante.lease.test.ts` / deterministic replica; `ctacte-comprobante.postgres.integration.test.ts` / PostgreSQL integration | `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.lease.test.ts` exited 0, 2/2 | Same deterministic command exited 1, 1 failed / 2 passed: changed fingerprint reclaimed as `owner`; `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` exited 1, 1 failed / 3 passed with the same defect | Deterministic command exited 0, 3/3; PostgreSQL command exited 0, 4/4 | Failed and stale rows both return `conflict` for a changed fingerprint. SQL reclaim now predicates on `request_fingerprint`; test standin mirrors bound SQL arguments. |
| Deliver comprobante `Idempotency-Key` through authenticated blob helper | `apps/web/src/lib/api.test.ts` / integration-level client | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteComprobanteButton.test.tsx` exited 0, 7/7; `pnpm --filter @athlos/web typecheck` exited 1 because `apiFetchBlob` accepted one argument | `pnpm --filter @athlos/web test:run src/lib/api.test.ts` exited 1, 1 failed / 9 passed: expected `idempotency-key` but received `null` | Same command exited 0, 10/10; `pnpm --filter @athlos/web typecheck` exited 0 | The client test asserts both `Authorization` and `Idempotency-Key` on the actual `fetch` request. `apiFetchBlob` accepts caller headers and preserves cookies. |
| Require real PostgreSQL tests in PR CI | `.github/workflows/test.yml` / CI configuration | N/A — workflow-only change | N/A — existing PostgreSQL tests already fail loudly without `ATHLOS_TEST_DATABASE_URL` | CI `test` job supplies `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5432/athlos` to its existing isolated `postgres:16-alpine` service | The workflow keeps its existing service and sets no production URL. The PostgreSQL lease and migration tests throw when the variable is absent, so they cannot silently skip. |
| Reject cross-operator payment retry | `ctacte-mutations.registerPayment.test.ts` / unit | Baseline `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` exited 0, 9/9 | At pre-change `63ef57c`, the same command exited 1, 1 failed / 9 passed: a different operator with the same key and canonical payment payload resolved instead of rejecting | At `9f000fb`, the command exited 0, 10/10; `pnpm --filter @athlos/api typecheck` exited 0 | Same operator/key/canonical payload still replays; changed monto, date, concept, or attachment conflicts. Minimal refactor: payment retry comparison now requires `idempotencyOperatorId` to match, consistent with debit. |

## Final targeted validation

- `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` — 37/37 passed.
- `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/db test:run src/ctacte-comprobante-retries.integration.test.ts` — 2/2 passed.
- `pnpm --filter @athlos/api typecheck` — passed.
- `pnpm --filter @athlos/web typecheck` — passed.
- `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` — 10/10 passed at `9f000fb`.
- `pnpm --filter @athlos/api typecheck` — passed at `9f000fb`.

## Evidence boundary

This file records only commands executed for `b403e7c`. Earlier R2 entries are intentionally not repeated because their exact commits, commands, and counts were not re-executed in this batch. No production database, migration, deployment, or production container was used.
