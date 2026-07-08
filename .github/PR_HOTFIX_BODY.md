# test(api): add golden-file test for socio form PDF (R14 hotfix)

Closes the **CRITICAL** finding in `openspec/changes/athlos-socio-form-emit/verify-report.md` §6.1: spec R14 had no implementation and `pdf-parse` was missing from `apps/api/package.json`.

## What

- Adds `pdf-parse@^1.1.1` (+ `@types/pdf-parse@^1.1.5`) to `apps/api/devDependencies`. Production code does NOT import it — it is dev-only for this test.
- New test file `apps/api/src/modules/socios/forms/golden-pdf.test.ts` covers spec R14:
  - **Scenario 1**: `emitForm` renders a known socio fixture; the returned PDF buffer parses via `pdf-parse`; the extracted text contains:
    - `CLUB ATLETICO GORRITI` (or `CLUB ATLÉTICO`)
    - `Juan Pérez` (titular, in either ordering)
    - `12345678` (DNI)
    - `12345` (numeroSocio)
    - `15/05/1990` (fecha_nacimiento in DD/MM/YYYY)
    - `Av. Siempre Viva 742` (direccion)
    - `juan@test.com` (email)
    - `FESCAG` (or `FONDO DE EMERGENCIA SOLIDARIO`)
    - `SOCIO` (label)
  - **Scenario 2**: Two emissions with the same `now()` produce equivalent rendered text (substring-count determinism proxy, not byte-equality).

## Runtime

- The test uses REAL puppeteer (no `vi.mock('puppeteer')`). The full template-renderer -> template HTML -> chromium render -> pdf-parse round-trip runs end-to-end.
- A module-load probe attempts to launch chromium with the production args. If the chrome binary cannot launch (missing shared libraries, no chromium in the runner image, etc.) the entire describe block becomes `describe.skip`. In CI / docker runners where `apk add chromium` ran (see `Dockerfile:34-47`), the tests run and lock the visual contract.
- The socio loader is mocked via `vi.mock('../repository.ts', ...)` -- no DB.
- `emitAudit` is mocked via `vi.mock('@athlos/audit', ...)` to a no-op.
- `pdfGenerator` is the singleton `createPdfGenerator()` matching production wiring.

## Evidence

- Verified locally with `pnpm --filter @athlos/api test:run -- src/modules/socios/forms/golden-pdf.test.ts` (with the runner image's chromium libs available): **2/2 tests pass** -- 1.06s for the substring suite, 3.93s for the determinism proxy.
- `pnpm --filter @athlos/api typecheck` clean.
- `pnpm --filter @athlos/api lint` clean (1 pre-existing `gastos.test.ts:367 no-console` warning, unrelated).
- Full suite: **50 files / 445 passed / 4 skipped** -- no regressions.

## Risks carried forward

- Pre-existing CI failures (same as PR #20 / #21): `gastos.test.ts:367` lint warning, labeler drift, Docker build smoke `log_error`. None introduced by this PR.
- In a CI image WITHOUT chromium installed, the test SKIPS (not fails). The Dockerfile's runner stage installs chromium via `apk add`, so the test runs in any environment that builds the production image.
- `pdf-parse@1.1.4` resolves under `^1.1.1` (closest published patch). The types come from `@types/pdf-parse@1.1.5`. Same major, so the contract is stable.

## LoC

- New test file: 234 LoC (well under the 400-line PR review budget).
- `package.json`: +4 / -1 (`pdf-parse` + `@types/pdf-parse` added).
- `pnpm-lock.yaml`: +26 lines (lock for the two new devDeps + transitive `node-ensure`).
- 1:1 source:test ratio: 1 production file touched (`package.json`), 1 test file added.
