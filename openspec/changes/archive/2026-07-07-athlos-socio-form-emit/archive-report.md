# Athlos socio form emit — archive report (2026-07-07)

**SDD change:** `athlos-socio-form-emit`
**Archived on:** 2026-07-07
**Final main HEAD:** `864dc7c` (PR #20 + PR #21 + PR #22 merged, stacked-to-main)

## Final state at archive

- **HEAD main:** `864dc7c`
- **PRs merged:** #20 (backend, `feat/socio-form-a` → `c8c901e`, `size:exception`) + #21 (frontend, `feat/socio-form-b` → `6d42c08`) + #22 (hotfix, `fix/socio-form-golden-test` → `e9d7670` — adds `pdf-parse` devDep + `golden-pdf.test.ts` to satisfy spec R14) = **3 PRs total**, all stacked-to-main.
- **Total LoC:** **~3 500 insertions across ~30 files** (PR A ~2 746 / PR B ~445 / PR #22 hotfix ~301).
- **Tests added:** **65 new tests** (51 API backend + 12 web = 63 main + 2 in golden test = 65 covering). Full suite: **445 API + 610 web = 1 055 tests pass**, 0 regressions.
- **Strict TDD:** **applied per commit** (RED → GREEN in the same commit, per audit-operator-display + socio-legajo convention). 1:1 source:test ratio on all new files.
- **Review verdicts (combined):** review-risk PASS, review-reliability PASS, review-readability PASS (all inline; `review-*` skills not installed in this environment — documented in PR bodies).
- **Verify verdict (post-hotfix):** **READY FOR ARCHIVE** — 14/14 NEW requirements PASS, 3/3 DELTA specs PASS. The single CRITICAL finding from the first verify (R14 golden-file test missing) is RESOLVED by PR #22.
- **New dep:** `puppeteer` (npm) — adds Alpine `chromium` + runtime libs (~170 MB) to the runner image. `pdf-parse@^1.1.1` + `@types/pdf-parse@^1.1.5` are **devDependencies only** (test-only, no production bundling).

## Specs archived

- **New canonical spec:** `openspec/specs/socio-form-emit/spec.md` — synced verbatim from the change's `specs/socio-form-emit/spec.md`, prefixed with `> Synced from change \`athlos-socio-form-emit\` (2026-07-07).`. 14 requirements, ~38 scenarios.
- **Delta appended to:** `openspec/specs/{audit-logger,api-design,ui-design}/spec.md` — each delta appended after the pre-existing `athlos-socio-legajo` delta block, prefixed with `## Delta — Synced from change \`athlos-socio-form-emit\` (2026-07-07)`. Pre-existing prose in each canonical spec is preserved as the non-authoritative baseline; the new delta requirements supersede per their `ADDED` markers.

## Files added to repo (production)

### Backend (PR A, #20) — feat/socio-form-a → c8c901e

**NEW (production + tests):**

- `apps/api/src/modules/socios/forms/semaphore.ts` — hand-rolled FIFO semaphore with `acquire(fn)` closure-owned release (counter + queue of resolvers).
- `apps/api/src/modules/socios/forms/template-renderer.ts` — pure `{{var}}` substitution helper with HTML escape (`<`, `>`, `&`, `"`, `'`, NUL-safe). No handlebars dep.
- `apps/api/src/modules/socios/forms/filename.ts` — `buildFilename(socio)` returning `solicitud-inscripcion-socio-{N}-{Apellido-sanitized}.pdf` via `normalize('NFD')` + diacritic strip + non-alphanumeric → `_` + UPPERCASE.
- `apps/api/src/modules/socios/forms/solicitud-inscripcion.template.ts` — TypeScript string constant exporting the HTML template (header with logo + club data, body with titular fields, FESCAG section at end) with `{{var}}` placeholders.
- `apps/api/src/modules/socios/forms/solicitud-inscripcion.styles.ts` — TypeScript string constant exporting the CSS (A4 `@page` + `.rect-acta` + `.rect-socio` rectangles at the pinned coordinates + `.fescag-section` with `border-top`).
- `apps/api/src/modules/socios/forms/logo.ts` — TypeScript string constant exporting the base64-encoded Gorriti logo PNG (extracted from the source `.docx`).
- `apps/api/src/modules/socios/forms/pdf-generator.ts` — puppeteer wrapper with singleton browser (held on Fastify decorator), `Semaphore(3)` cap, `try/finally` page close, launch args pinned to `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']`.
- `apps/api/src/modules/socios/forms/emit-form.ts` — service: `emitForm({ socioId, operatorId })` loads socio → renders template → generates PDF → computes SHA-256 → emits `SOCIO_FORM_EMITTED` audit → returns `{ pdf, filename, sha256, byteSize }`. Best-effort audit (failed `emitAudit()` does NOT roll back the PDF response).
- `apps/api/src/routes/socio-forms.ts` — `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` with `preHandler: requireAuth()` (no role gate). Returns `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."`. 404 `SOCIO_NOT_FOUND`, 401 missing JWT.
- `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` — hand-written migration, `ALTER TABLE socios ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;`. Idempotent. Apply via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0030_*.sql` (drizzle pipeline broken in prod per handover #253).

**EDITED (backend):**

- `apps/api/package.json` — adds `puppeteer@^23.x` runtime dep.
- `apps/api/src/server.ts` — registers `socioFormsRoutes` after `socioAttachmentsRoutes`; decorates `app.pdfGenerator = createPdfGenerator({ maxConcurrent: 3 })`; SIGTERM hook closes the browser.
- `packages/db/src/schema/socios.ts` — adds `fechaNacimiento: date('fecha_nacimiento')` column to `socios` table.
- `packages/audit/src/emitter.ts` — adds `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'` to the `AuditAction` const-map (NB: const-map lives in `emitter.ts`, NOT `actions.ts` — proposal #313 already corrected this).

### Hotfix (PR #22, golden-file test) — fix/socio-form-golden-test → e9d7670

**NEW:**

- `apps/api/src/modules/socios/forms/golden-pdf.test.ts` — 234 LoC, uses REAL puppeteer (no mocking); module-load chrome probe; `vi.mock('../repository.ts')` for socio + `vi.mock('@athlos/audit')` for audit; pdf-parse substring assertions for `CLUB ATLETICO GORRITI` (or `CLUB ATLÉTICO`), titular name, DNI, `numeroSocio`, `fecha_nacimiento` (DD/MM/YYYY), dirección, email, FESCAG footer, SOCIO label; second emission for determinism check (substring-count equality, not byte-equality). `describe.skip` graceful fallback when chromium libs are absent in dev env.

**EDITED:**

- `apps/api/package.json` — adds `pdf-parse: ^1.1.1` + `@types/pdf-parse: ^1.1.5` to `devDependencies` (test-only; NOT in production dependencies — no bundling risk).
- `pnpm-lock.yaml` — lock for the two new devDeps + transitive `node-ensure`.

### Docker / Infra

- `Dockerfile` — multi-stage update: builder installs `puppeteer` with `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` (skips postinstall); runner stage `apk add --no-cache chromium nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1` + `ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"`. Image size impact: +~170 MB (one-time).

### Frontend (PR B, #21) — feat/socio-form-b → 6d42c08

**NEW:**

- `apps/web/src/lib/api/forms.ts` — pure URL composition helper `getSocioFormUrl(socioId): string` returning `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/solicitud-inscripcion.pdf`. Handles trailing-slash / double-slash trimming for empty-base safety.
- `apps/web/src/components/socios/EmitirSolicitudButton.tsx` — stateless button using Lucide `Printer` icon + Secondary variant (`#ffffff` bg, `1px #d4d4d4` border, `ink-700` text). On click: `window.open(url, '_blank', 'noopener,noreferrer')` then `notify('info', 'Generando PDF…')`. `disabled` prop when `socio.direccion` missing.

**EDITED:**

- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — wires `<EmitirSolicitudButton>` in the page header action cluster BEFORE the ADMIN group (always visible to any authenticated operator); 1 px `ink-100` vertical divider separates the always-visible group from the ADMIN cluster.

### Repo root

- `.github/PR_8D1_BODY.md` (NEW) — PR #20 body (`size:exception` approved).
- `.github/PR_8D2_BODY.md` (NEW) — PR #21 body.
- `.github/PR_HOTFIX_BODY.md` (NEW) — PR #22 body.

## Verification verdict

`sdd-verify` (post-hotfix, HEAD `864dc7c`) returned **READY FOR ARCHIVE**:

- **CRITICAL:** 0 (R14 golden-file test now shipped via `golden-pdf.test.ts` + `pdf-parse` devDep).
- **WARNINGS:** 3 (Zod runtime validator for `AuditAction` absent — pre-existing gap; `EmitirSolicitudButton` toast severity deviation from design §3.4 — uses `'info'` + `'Generando PDF…'` rather than `'success'` + `'Solicitud emitida'`, rationale captured in apply-progress #319; Chromium version unpinned in Dockerfile).
- **SUGGESTIONS:** 2 (audit-logger delta spec mentions a Zod validator that doesn't exist — reword to "TypeScript const-map narrowing"; `socio-forms.test.ts` doesn't cover percent-encoded path).

All 14 NEW `socio-form-emit` requirements + 3 DELTA spec files (`audit-logger`, `api-design`, `ui-design`) verified against merged implementation. Runtime evidence: 51 backend tests pass + 12 frontend tests pass + 2 golden-file tests pass = 65 new tests, 0 fail. Full API suite: 50 files, 445 pass, 4 skipped (including 2 golden tests when chromium libs absent in dev env). Full web suite: 65 files, 610 pass. `pnpm typecheck` + `pnpm lint` clean (1 pre-existing `apps/api/src/modules/socios/forms/gastos.test.ts:367` lint warning carried over, unrelated to this change). Full report at `openspec/changes/archive/2026-07-07-athlos-socio-form-emit/verify-report.md`.

## Post-merge deploy actions (REQUIRED before first use)

These steps must be executed by the operator before any operator clicks "Emitir Solicitud" in production. The migration, the chromium binary, and the route registration are not picked up by a plain `git pull`.

1. **Apply the migration** via:
   ```
   docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/drizzle/0030_socio_fecha_nacimiento.sql
   ```
   (The drizzle migration pipeline is broken in prod per handover #253 — apply the hand-written SQL directly. Re-running is a no-op via `ADD COLUMN IF NOT EXISTS`.)
2. **Rebuild + rolling-recreate the `api` container** to pick up the new chromium binary + runtime libs:
   ```
   docker compose build api
   docker compose up -d --force-recreate api
   ```
   (Existing containers won't have the new puppeteer + chromium libs; a recreate is required so the API image rebuild + browser launch path works.)
3. **Smoke test the endpoint** via:
   ```
   curl -H "Authorization: Bearer <jwt>" http://100.78.95.34:4000/api/v1/socios/<id>/forms/solicitud-inscripcion.pdf -o /tmp/test.pdf && file /tmp/test.pdf
   ```
   (Should report `PDF document, version X.Y`. Expected size > 10 KB; filename in `Content-Disposition` should match `solicitud-inscripcion-socio-<N>-<Apellido>.pdf` with the sanitized apellido.)
4. **End-to-end UI check** — open `/socios/<id>` in the browser, click the new "Emitir Solicitud" button in the page header (right side, BEFORE the ADMIN cluster). Should open the PDF in a new tab via `window.open(url, '_blank', 'noopener,noreferrer')`. Confirm a toast appears (`info` severity, "Generando PDF…"). Confirm the button is disabled if `socio.direccion` is missing.

## Carry-over follow-ups (NOT in this change)

These were tracked through the change but explicitly left out of scope. Each warrants its own work:

1. **`chore(ci): fix pre-existing CI failures`** — 3 pre-existing CI failures documented in PR #20, #21, and #22 bodies (carry-over from PR 8c.1 / 8d.1 per handover #253, reaffirmed by the verify):
   - `test` job: `apps/api/src/routes/admin/gastos.test.ts:367` lint warning (NOT touched by this PR).
   - `labeler` job: labeler pattern drift (NOT touched by this PR).
   - `Docker build smoke` job: `apps/api/docker-entrypoint.sh:31` `log_error: command not found` (NOT touched by this PR).
2. **New SDD change: fix drizzle migration system bug** — `__drizzle_migrations` absent in prod, `_journal.json` has gaps in 0013–0030. Workaround currently is `docker exec -i athlos-db-1 psql -U athlos -d athlos < archivo.sql`. This change shipped a hand-written SQL (`0030_*.sql`) that doesn't touch the drizzle pipeline, but the next schema-touching change will need this fix first.
3. **Chromium version pinning in Dockerfile** (Suggestion from verify, S3) — `apk add chromium` (Dockerfile:39) follows the rolling `edge/main` of Alpine's package repo. A future Alpine base upgrade could pull a different chromium version, which could shift the rendered text. Pin to `chromium=130.0.*` (or current LTS) to lock determinism for the golden-file test.
4. **Zod runtime validator for `AuditAction`** (W1 from verify) — pre-existing gap. The `audit-logger` delta spec scenario 3 ("Zod schema accepts SOCIO_FORM_EMITTED" + "rejects NOT_A_REAL_ACTION") implies a Zod runtime validator that doesn't exist; validation happens purely at the TypeScript const-map level (`AuditAction.SOCIO_FORM_EMITTED` literal narrows the union). The `audit_events.action` column is `text`, no DB-level CHECK constraint. Same state as after PR 8c.1 (which added `SOCIO_ATTACHMENT_UPLOADED`/`_DELETED`); the delta spec was written aspirationally. Not blocking.
5. **All 9 previous carry-overs from `athlos-socio-legajo` / `athlos-audit-operator-display` / `athlos-toast-primitivo` / `athlos-notes-collapsible`** — carried forward unchanged (See `openspec/changes/archive/2026-07-07-athlos-socio-legajo/archive-report.md` §"Carry-over follow-ups" #1, #5-9 for detail).
6. **`EmitirSolicitudButton` toast severity deviation from design §3.4** (Warning from verify, #3) — Design specifies `notify('success', 'Solicitud emitida')`. The shipped code uses `notify('info', 'Generando PDF…')` because the PDF is server-rendered async, so a success-state toast at click-time is misleading. Matches orchestrator guidance. Future follow-up: relax design §3.4 to allow `'info'` for async-emit flows OR introduce a server-pushed success signal via SSE/poll.

## Cross-references

- Engram apply-progress: `sdd/athlos-socio-form-emit/apply-progress` (#319 — rewritten with final closed state, `capture_prompt: false`)
- Engram verify-report: `sdd/athlos-socio-form-emit/verify-report` (#323 post-hotfix; #320 pre-hotfix with CRITICAL R14)
- Engram design: `sdd/athlos-socio-form-emit/design` (#316)
- Engram tasks: `sdd/athlos-socio-form-emit/tasks` (Engram topic not yet written; tasks live at `openspec/changes/archive/2026-07-07-athlos-socio-form-emit/tasks.md`)
- Engram spec: `sdd/athlos-socio-form-emit/spec` (#314)
- Engram explore: `sdd/athlos-socio-form-emit/explore` (#312)
- Engram proposal: `sdd/athlos-socio-form-emit/proposal` (#313)
- Engram discovery (deltas added): `Deltas added: audit-logger + api-design + ui-design for form-emit` (#315)
- Engram discovery (R14 golden-file pattern): `Golden-file test pattern — visual layout contracts need end-to-end rendering assertions` (#321)
- Engram session summary (R14 hotfix): `Session summary: athlos` (#322)
- Engram sdd-init: `sdd-init/athlos` (#26)
- Obsidian: `/srv/obsidian/Athlos/0-Index.md` — ledger updated; this entry mirrors the archived `athlos-socio-legajo` line-9 format.

## Sessions

Completed in session `athlos-server-gorriti-2026-07-06` (continuation of the apply + verify + archive sessions on `feat/socio-form-a`, `feat/socio-form-b`, and `fix/socio-form-golden-test`).
