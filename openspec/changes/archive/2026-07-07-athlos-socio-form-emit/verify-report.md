# Verify Report: athlos-socio-form-emit

**Change**: `athlos-socio-form-emit`
**Phase**: verify
**Date**: 2026-07-08
**Main HEAD at run time**: `e9b409c` (PRs #20 and #21 merged)
**Mode**: Standard verify (Strict TDD inferred inactive — verify is post-apply, not the strict-TDD runtime gate; design §11 already covers the per-file test ratio).
**Skill**: `sdd-verify`

---

## 1. Completeness Table

| Artifact | Status | Notes |
|---|---|---|
| `proposal.md` | READ | 173 LoC, 4 sections (Why / What / Approach / Capabilities / Risks / Success). |
| `specs/socio-form-emit/spec.md` (NEW) | READ | 343 LoC, 14 requirements / 38 scenarios. |
| `specs/audit-logger/spec.md` (DELTA) | READ | 49 LoC, 1 ADDED requirement / 4 scenarios. |
| `specs/api-design/spec.md` (DELTA) | READ | 58 LoC, 1 ADDED requirement / 6 scenarios. |
| `specs/ui-design/spec.md` (DELTA) | READ | 71 LoC, 1 ADDED requirement / 7 scenarios. |
| `design.md` | READ | 432 LoC, 14 sections, contracts pinned. |
| `tasks.md` | READ | 316 LoC, 10 phases, 7+3 commits. |
| Backend code (`apps/api/src/modules/socios/forms/` + `routes/socio-forms.ts` + `server.ts`) | SHIPPED | All helpers + service + route registered. |
| Frontend code (`apps/web/src/components/socios/EmitirSolicitudButton.tsx` + `lib/api/forms.ts` + page wiring) | SHIPPED | Button wired with `disabled={!socio.direccion}`. |
| Migration `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` | SHIPPED | Hand-written, idempotent. |
| Drizzle schema widening (`fechaNacimiento: date('fecha_nacimiento')`) | SHIPPED | `packages/db/src/schema/socios.ts:104`. |
| Audit const-map (`SOCIO_FORM_EMITTED`) | SHIPPED | `packages/audit/src/emitter.ts:69`. |
| Dockerfile multi-stage update | SHIPPED | chromium + libs in runner; `PUPPETEER_EXECUTABLE_PATH` env. |

---

## 2. Build / Lint / Test Evidence

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @athlos/api typecheck` | PASS | `tsc --noEmit`, exit 0, no output. |
| `pnpm --filter @athlos/web typecheck` | PASS | `tsc --noEmit`, exit 0, no output. |
| `pnpm --filter @athlos/api lint` | PASS (1 pre-existing warning) | The single warning is `apps/api/src/modules/socios/forms/gastos.test.ts:367:9  no-console` — **pre-existing**, unrelated to PR 8d.1. |
| `pnpm --filter @athlos/web lint` | PASS | exit 0, no output. |
| `pnpm --filter @athlos/api test:run -- src/modules/socios/forms src/routes/socio-forms` | PASS | 50 test files / 445 passed / 2 skipped / 11.33s. New backend tests: `emit-form.test.ts` (8), `filename.test.ts` (13), `pdf-generator.test.ts` (6), `semaphore.test.ts` (6), `template-renderer.test.ts` (12), `socio-forms.test.ts` (6) = **51 new tests**. |
| Web targeted: `pnpm exec vitest run src/lib/api/forms.test.ts src/components/socios/EmitirSolicitudButton.test.tsx 'src/app/(authed)/socios/[id]/page.test.tsx'` | PASS | 3 test files / 33 tests passed / 2.23s. New web tests: `forms.test.ts` (4), `EmitirSolicitudButton.test.tsx` (5), page.test.tsx extended by 3 scenarios (header rendering, OPERADOR visibility, disabled-on-empty-direccion) = **12 new tests** added on top of the prior 21 (3 + 24 = 27 scenarios in the page file). |
| Full web suite (`pnpm --filter @athlos/web test:run`) | PASS | 65 files / 610 tests / 16.72s — matches the "598 baseline + 12 new = 610 tests pass" claim from apply-progress #319. |
| `pnpm --filter @athlos/audit test:run -- src/emitter.test.ts` | PASS (covered by api suite) | `SOCIO_FORM_EMITTED` 4-key metadata scenario at `packages/audit/src/emitter.test.ts:183-216`. |

---

## 3. Spec Compliance Matrix — NEW spec `socio-form-emit` (14 requirements)

### Requirement R1 — PDF endpoint exposed under `/api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`

**Summary**: `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` returns `application/pdf` with body starting `%PDF-`; 404 when socio missing.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/routes/socio-forms.ts:60` registers the route; `:76` sets `Content-Type: application/pdf`; `:78` sends `result.pdf` (Buffer). `apps/api/src/routes/socio-forms.test.ts:135-147` asserts `body.subarray(0, 5).toString('utf8') === '%PDF-'`. `:162-173` asserts 404 + no audit.
- **Test coverage**: `apps/api/src/routes/socio-forms.test.ts` (6 tests) — happy path, 401, sanitization, 404, audit emission, header escape.

### Requirement R2 — JWT authentication required, no role gate

**Summary**: `preHandler: [requireAuth]`; no role gate; 401 on missing token.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/routes/socio-forms.ts:30` defines `const FORM_AUTH = { preHandler: requireAuth() }`. `:62` applies it. `:135-147` of `socio-forms.test.ts` calls the endpoint with `bearer('OPERADOR')` (no ADMIN) and gets 200. `:126-133` of same asserts 401 without JWT.
- **Test coverage**: `apps/api/src/routes/socio-forms.test.ts:126-133` (401) + `:135-147` (OPERADOR role allowed).

### Requirement R3 — Content-Disposition filename sanitized for `apellido`

**Summary**: `inline; filename="solicitud-inscripcion-socio-{N}-{Apellido}.pdf"` with NFD + non-alphanumeric → `_` collapse; ASCII-only.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/filename.ts:21-25` builds the name; `:27-34` strips diacritics + replaces non-alphanumeric with `_` + UPPERCASES. `apps/api/src/routes/socio-forms.ts:77` sets `inline; filename="${escapeFilename(result.filename)}"`. End-to-end test at `socio-forms.test.ts:149-160` asserts `inline; filename="solicitud-inscripcion-socio-9999-O_BRIEN.pdf"` for `apellido="O'Brien"`. `filename.test.ts:25-29` collapses `van  der  Berg` → `VAN_DER_BERG`.
- **Test coverage**: `filename.test.ts` (13 tests) + `socio-forms.test.ts:149-160` end-to-end.

### Requirement R4 — Form layout matches the source `/srv/docs/ficha.docx`

**Summary**: Header with logo + club data; FESCAG at end; A4 with 30mm horizontal + 25mm vertical margins; two absolute-positioned rectangles (`.rect-acta` + `.rect-socio`).

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/solicitud-inscripcion.styles.ts:17-20` `@page { size: A4; margin: 25mm 30mm; }`. `:160-172` defines both rectangles with the pinned coordinates. `:40-46` styles the `.club-logo` floated left. `:127-141` styles `.fescag-section` with `border-top`. `apps/api/src/modules/socios/forms/solicitud-inscripcion.template.ts:38-42` renders the club header with `<img class="club-logo">` + `CLUB ATLETICO GORRITI` + the `ENTIDAD SIN FINES DE LUCRO…` line; `:92-103` renders the FESCAG block with 4 articles; `:113-114` renders the two `<div class="rect-socio">` + `<div class="rect-acta">`.
- **Test coverage**: No dedicated visual test (covered by R14 golden-file test — which itself is MISSING; see Issue 1 below).

### Requirement R5 — Titular fields auto-filled from the socio (with HTML escape)

**Summary**: 8 field map (titular_nombre / dni / numero_socio / fecha_nacimiento / domicilio_calle / domicilio_telefono / email / fecha_emision); HTML-escape every value.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/template-renderer.ts:33-38` substitutes via regex + escapes via `escapeHtml()`; `:45-52` escapes `& < > " '`. `solicitud-inscripcion.template.ts:141-154` builds the variable bag. `emit-form.ts:64-77` injects socio fields. `template-renderer.test.ts:34-42` covers the 5 special chars; `emit-form.test.ts:191-211` covers fecha_nacimiento formatting end-to-end.
- **Test coverage**: `template-renderer.test.ts` (12 tests) + `emit-form.test.ts:175-211` (NULL fecha + DD/MM/YYYY format).

### Requirement R6 — Cadete, Presentante, Acta, and today's date left blank

**Summary**: Cadete block, presentante fields, ACTA Nº rectangle, header "today" date remain blank.

- **Status**: **PASS** (no `{{cadete_*}}` placeholders exist in the template; visual confirmation deferred to R14 golden-file)
- **Evidence**: `solicitud-inscripcion.template.ts:53-55` renders `<span class="dotted-line">&nbsp;</span>` for ACTA Nº. The cadete/presentante blocks are NOT in the template (intentionally omitted per design §4); no `{{cadete_*}}` placeholder exists, so no data leaks in. `header-date` line `:45` shows `SAN SALVADOR DE JUJUY, ....... DE ....................... DE ..........` (static dotted placeholders).
- **Test coverage**: Indirect — `emit-form.test.ts:290-292` asserts the FESCAG block receives the server `today` (DD/MM/YYYY), confirming the FESCAG "today" is auto-filled while the header date remains blank by template structure.

### Requirement R7 — Puppeteer singleton with stable launch args

**Summary**: Singleton browser (held on `buildServer()` decorator), launch args pinned to `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']`, SIGTERM closes the browser.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/pdf-generator.ts:46-50` defines the `DEFAULT_LAUNCH_ARGS` triple. `:55-71` implements singleton init with idempotency guard. `:73-91` opens a page per `generate(html)` call. `apps/api/src/server.ts:236` wires `createPdfGenerator({ maxConcurrent: 3 })` once at boot.
- **Test coverage**: `pdf-generator.test.ts:65-77` asserts launch args; `:78-85` asserts `init()` is idempotent; `:86-97` asserts `close()` shuts down cleanly.

### Requirement R8 — Concurrent `page.pdf()` calls capped at 3 via semaphore

**Summary**: 3 concurrent succeed; 4th waits in FIFO queue; `try/finally` release on error.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/semaphore.ts:22-67` implements the FIFO semaphore with `acquire(fn)` closure-owned release. `:38-45` uses `try/finally`. `:47-55` queues with a waiters array. `pdf-generator.ts:54` instantiates `new Semaphore(maxConcurrent)`; `:78-90` wraps `page.pdf()` in `semaphore.acquire(async () => {...})`. `:86-89` closes the page in `finally`.
- **Test coverage**: `semaphore.test.ts` (6 tests) — 3 succeed + 4th waits + FIFO + finally release on throw + capacity guard + sequential acquire safety. `pdf-generator.test.ts:132+` asserts `maxConcurrent=3` cap + 4th queueing.

### Requirement R9 — `SOCIO_FORM_EMITTED` audit event with exact metadata

**Summary**: One `audit_event` row per emission; `metadata` has exactly `{ socio_id, form_id, sha256, byte_size }`.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/modules/socios/forms/emit-form.ts:124-151` calls `emitAudit` with the 4-key metadata literal; `audit-logger` const-map `packages/audit/src/emitter.ts:69` adds `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'`. `emit-form.test.ts:213-239` asserts `Object.keys(meta!).sort()` equals exactly `['byte_size', 'form_id', 'sha256', 'socio_id']`.
- **Test coverage**: `emit-form.test.ts:213-239` (4-key shape) + `socio-forms.test.ts:175-188` (audit row written end-to-end via standin DB) + `packages/audit/src/emitter.test.ts:183-216` (audit emitter accepts the 4-key shape).

### Requirement R10 — SHA-256 hash of the PDF bytes (in same pass)

**Summary**: 64-char lowercase hex; recomputable from the response body.

- **Status**: **PASS**
- **Evidence**: `emit-form.ts:79` computes `createHash('sha256').update(pdf).digest('hex')` once. `:80` reads `pdf.byteLength` from the same Buffer. `emit-form.test.ts:156-158` asserts `result.sha256` is 64-char hex AND matches an independent `createHash('sha256').update(pdfBuffer).digest('hex')`.
- **Test coverage**: `emit-form.test.ts:156-159` (independent recomputation equality).

### Requirement R11 — `fecha_nacimiento DATE NULL` column on `socios`

**Summary**: Hand-written migration `0030_socio_fecha_nacimiento.sql` (idempotent via `ADD COLUMN IF NOT EXISTS`); Drizzle schema widened.

- **Status**: **PASS**
- **Evidence**: `packages/db/drizzle/0030_socio_fecha_nacimiento.sql:15` `ALTER TABLE "socios"."socios" ADD COLUMN IF NOT EXISTS "fecha_nacimiento" DATE;`. `packages/db/src/schema/socios.ts:104` `fechaNacimiento: date('fecha_nacimiento'),`.
- **Test coverage**: No runtime test for the SQL itself (consistent with the project-wide "drizzle pipeline broken in prod" precedent per handover #253). Idempotency is asserted by the migration file structure (test-side re-run would be a manual docker exec, post-merge).

### Requirement R12 — NULL `fecha_nacimiento` renders blank in the PDF

**Summary**: NULL → dotted placeholder; non-NULL → `DD/MM/YYYY`.

- **Status**: **PASS**
- **Evidence**: `emit-form.ts:99-105` `formatFechaNacimiento(null)` returns `''` (empty string). `emit-form.test.ts:175-196` asserts the HTML passed to puppeteer does NOT contain `{{fecha_nacimiento}}` and does NOT contain the literal `null` when the column is NULL. `:198-211` asserts `15/05/1985` for a non-NULL value.
- **Test coverage**: `emit-form.test.ts:175-211` (NULL + non-NULL branches).

### Requirement R13 — Multi-stage Dockerfile ships chromium in the runner

**Summary**: Builder installs puppeteer but skips postinstall; runner installs `chromium` + `nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1`; env `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`.

- **Status**: **PASS**
- **Evidence**: `Dockerfile:34-47` `apk add --no-cache tini bash postgresql-client curl chromium nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1` in the **runner** stage (stage `FROM node:22-alpine AS runner`). `:89-90` sets `ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"`. Builder stage (`:4-23`) intentionally does NOT include `chromium`.
- **Test coverage**: No runtime test for the Dockerfile (smoke build is out of scope per design §7 risks). The runner env vars match the spec contract.

### Requirement R14 — Golden-file test renders a known socio twice and asserts PDF text

**Summary**: Test calls `emitForm` twice with a known fixture; parses via `pdf-parse`; asserts substrings; proves determinism.

- **Status**: **FAIL** (CRITICAL)
- **Evidence**: `apps/api/src/modules/socios/forms/` directory does NOT contain a `golden-pdf.test.ts` (verified by `find apps/api -name 'golden-pdf*'` → no output). `apps/api/package.json` does NOT include `pdf-parse` in either `dependencies` or `devDependencies` (verified by `grep -E 'puppeteer|pdf-parse'` → only `puppeteer` listed).
- **Test coverage**: NONE.
- **Mitigation in place**: The `emit-form.test.ts` integration covers the SHA-256/byte-size/audit-metadata contract at the unit level (8 tests). The `socio-forms.test.ts` covers the wire-level `Content-Type: application/pdf` + body-starts-with-`%PDF-` contract (6 tests). However, neither asserts the visual layout (FESCAG footer present, two rectangles render, logo embedded, all titular fields appear in the rendered text). A regression that, e.g., silently drops the FESCAG block or moves the `{{titular_nombre}}` substitution outside its dotted-line span would pass all current tests.
- **Required follow-up**: Hotfix PR adding `pdf-parse` as devDep + `golden-pdf.test.ts` rendering a known socio via `pdfGenerator.generate()` + asserting the parsed text contains `CLUB ATLETICO GORRITI`, the titular name, the DNI, the numero_socio, and the FESCAG footer.

---

## 4. Delta Specs Compliance

### DELTA `audit-logger/spec.md` (1 ADDED requirement)

**Summary**: Locks `SOCIO_FORM_EMITTED` action + 4-key metadata `{ socio_id, form_id, sha256, byte_size }`.

- **Status**: **PASS** (with one SUGGESTION — see Issues)
- **Evidence**: `packages/audit/src/emitter.ts:66-70` adds the constant. `packages/audit/src/emitter.test.ts:183-216` covers the 4-key shape assertion. `emit-form.ts:124-151` uses the constant + 4-key metadata literal. The `audit_events.action` column is `text` (no Zod validator exists at the column level — the const-map is the de facto type-level validator). The delta file is correctly placed in `openspec/changes/athlos-socio-form-emit/specs/audit-logger/spec.md` awaiting the archive phase.
- **Test coverage**: `packages/audit/src/emitter.test.ts:183-216` + `emit-form.test.ts:213-239` + `socio-forms.test.ts:175-188`.

### DELTA `api-design/spec.md` (1 ADDED requirement)

**Summary**: Locks `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` returning `application/pdf` + `Content-Disposition: inline; filename="..."`; 404 + 401 handling.

- **Status**: **PASS**
- **Evidence**: `apps/api/src/routes/socio-forms.ts:60-80` registers the exact path + `Content-Type: application/pdf` + `inline; filename="..."` headers. `socio-forms.test.ts:149-160` asserts the sanitized `inline; filename="..."` shape. `:126-133` covers 401; `:162-173` covers 404.
- **Test coverage**: `socio-forms.test.ts` (6 tests).

### DELTA `ui-design/spec.md` (1 ADDED requirement)

**Summary**: "Emitir Solicitud" button in the page header BEFORE the ADMIN group; `Printer` icon; Secondary variant; `window.open(url, '_blank', 'noopener,noreferrer')`; success/info toast; disabled when `direccion` missing.

- **Status**: **PASS** (with one design deviation — see Issue 3)
- **Evidence**: `apps/web/src/components/socios/EmitirSolicitudButton.tsx:51-71` renders the button with `Printer` icon + label "Emitir Solicitud" + the secondary-variant classNames. `:56` `window.open(url, '_blank', 'noopener,noreferrer')`. `:57` fires the toast. `:64` honours the `disabled` prop. `apps/web/src/app/(authed)/socios/[id]/page.tsx:341` wires the button BEFORE the ADMIN group (the ADMIN group at `:345-381` is gated on `isAdmin`); `:347` adds the `1px ink-100` vertical divider.
- **Test coverage**: `apps/web/src/components/socios/EmitirSolicitudButton.test.tsx` (5 tests) + `'apps/web/src/app/(authed)/socios/[id]/page.test.tsx':558-585` (3 new scenarios).

---

## 5. Correctness Table — Spot Checks

| Check | Status | Evidence |
|---|---|---|
| `emit-form.ts` returns `{ pdf, filename, sha256, byteSize }` with exact 4-key audit metadata | PASS | `emit-form.ts:48-53` defines `EmitFormResult`; `:124-151` builds the metadata. |
| `pdf-generator.ts` uses `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']` + 3-slot semaphore | PASS | `pdf-generator.ts:46-50` triple args; `:54` `new Semaphore(maxConcurrent)` with `server.ts:236` `createPdfGenerator({ maxConcurrent: 3 })`. |
| `template-renderer.ts` does `{{var}}` substitution with HTML escape (no extra dep) | PASS | `template-renderer.ts:33-38` regex `\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g`; `:45-52` `escapeHtml`. No external dep imported. |
| `filename.ts` sanitizes apellido (NFD + non-alphanumeric → `_` + UPPERCASE) | PASS | `filename.ts:28-33` normalize('NFD') + diacritic strip + `[^a-zA-Z0-9]+` → `_` + `^_+|_+$` trim + `.toUpperCase()`. |
| `socio-forms.ts` route returns `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."` | PASS | `socio-forms.ts:76-77` sets both headers exactly. |
| `0030_socio_fecha_nacimiento.sql` is idempotent | PASS | `0030_socio_fecha_nacimiento.sql:15` uses `ADD COLUMN IF NOT EXISTS`. |
| `packages/db/src/schema/socios.ts` includes `fechaNacimiento: date('fecha_nacimiento')` | PASS | `packages/db/src/schema/socios.ts:104`. |
| Audit const-map includes `SOCIO_FORM_EMITTED` | PASS | `packages/audit/src/emitter.ts:69` (NB: const-map is in `emitter.ts`, NOT `actions.ts` — the apply phase correctly targeted the right file per the design correction in #313). |
| `Dockerfile` is multi-stage with chromium in the runner stage | PASS | `Dockerfile:4-23` builder; `:26-95` runner with `apk add chromium ... libssl1.1` at `:34-47` and `PUPPETEER_EXECUTABLE_PATH` at `:89`. |
| `EmitirSolicitudButton.tsx` uses `window.open(url, '_blank', 'noopener,noreferrer')` | PASS | `EmitirSolicitudButton.tsx:56` (exact call). |
| Button is wired in header BEFORE the Edit/Dar baja/Reactivar cluster | PASS | `apps/web/src/app/(authed)/socios/[id]/page.tsx:341` renders the button before the `isAdmin ? <>...</> : null` block at `:345-381`. |

---

## 6. Issues

### CRITICAL

**1. Golden-file test (R14) is missing.** The spec explicitly requires a golden-file test that calls `emitForm` twice with a known fixture, parses the PDF via `pdf-parse`, and asserts the rendered text contains the expected substrings (apellido+nombre, dni, numeroSocio, FESCAG footer). The test file `apps/api/src/modules/socios/forms/golden-pdf.test.ts` does NOT exist and the `pdf-parse` devDependency is NOT in `apps/api/package.json`. The visual layout contract — Gorriti club data header, FESCAG block at the end, two absolute-positioned rectangles, all titular field substitutions, embedded base64 logo — has NO end-to-end rendering test. This regression guard was locked in design §11 testing strategy and spec R14. **Action**: hotfix PR adding `pdf-parse` as devDep + `golden-pdf.test.ts` per spec.

### WARNINGS

**2. Zod runtime validator for `AuditAction` does not exist (pre-existing gap, not a regression).** The `audit-logger` delta spec scenario 3 ("Zod schema accepts SOCIO_FORM_EMITTED" + "rejects NOT_A_REAL_ACTION") implies a Zod runtime validator that doesn't exist in the audit package — validation happens purely at the TypeScript const-map level (`AuditAction.SOCIO_FORM_EMITTED` literal narrows the union). The `audit_events.action` column is `text`, no DB-level CHECK constraint. This is the same state as after PR 8c.1 (which added `SOCIO_ATTACHMENT_UPLOADED`/`_DELETED`); the delta spec was written aspirationally. Not blocking for this change.

**3. Toast copy deviation from design §3.4.** Design §3.4 specifies `notify('success', 'Solicitud emitida')` after the new tab opens. The shipped code uses `notify('info', 'Generando PDF…')` instead (`EmitirSolicitudButton.tsx:49,57`). Rationale captured in apply-progress #319: PDF is server-rendered async, so a success-state toast at click-time is misleading; `info` is the accurate signal. This deviates from the design §3.4 spec but matches the orchestrator's intent. **Action**: future follow-up could relax design §3.4 to allow `'info'` for async-emit flows, or could surface a separate success-state via a SSE/poll. Not blocking.

### SUGGESTIONS

**4. Audit-logger delta spec mentions a Zod validator that doesn't exist.** Consider clarifying the delta during archive by replacing "Zod validator" with "TypeScript const-map narrowing" — both are accurate to the shipped state, but the Zod framing is currently unfulfillable.

**5. `socio-forms.test.ts` does NOT cover the `Emitir Solicitud` URL path with `&` query handling.** If a socioId contains characters needing percent-encoding (UUIDs never do, but the route is built on a string param), the test surface doesn't catch it. Low risk — UUIDs are the only input — but a future string-form socio_id would need this coverage.

**6. Dockerfile `chromium` version is unpinned.** `apk add chromium` (Dockerfile:39) follows the rolling `edge/main` of Alpine's package repo. A future Alpine base upgrade could pull a different chromium version, which could shift the rendered text the missing golden test (Issue 1) would otherwise catch. Pre-merge pin of `chromium=130.0.*` is recommended.

---

## 7. Design Coherence Summary

| Design Decision | Implementation | Coherent? |
|---|---|---|
| `EmitFormResult` = `{ pdf, filename, sha256, byteSize }` | `emit-form.ts:48-53` | YES |
| `renderTemplate` pure `{{var}}` + HTML escape | `template-renderer.ts:29-52` | YES |
| `createPdfGenerator({ maxConcurrent: 3 })` | `pdf-generator.ts:52-103` + `server.ts:236` | YES |
| `buildFilename` with NFD + non-alphanumeric → `_` + UPPERCASE | `filename.ts:21-34` | YES |
| Puppeteer args pinned triple | `pdf-generator.ts:46-50` | YES |
| Audit metadata exact 4 keys | `emit-form.ts:138-143` | YES |
| Audit best-effort (no roll-back on throw) | `emit-form.ts:128-150` | YES |
| SOCIO_FORM_EMITTED const-map (in `emitter.ts`, NOT `actions.ts`) | `emitter.ts:69` | YES (apply correctly targeted the right file per #313 correction) |
| Migration 0030 hand-written + `ADD COLUMN IF NOT EXISTS` | `0030_socio_fecha_nacimiento.sql:15` | YES |
| Schema widening `fechaNacimiento: date('fecha_nacimiento')` | `packages/db/src/schema/socios.ts:104` | YES |
| Route 200/401/404 + Content-Disposition | `socio-forms.ts:60-80` + tests | YES |
| Button BEFORE ADMIN group, 1px `ink-100` divider | `page.tsx:341-381` | YES |
| `window.open(url, '_blank', 'noopener,noreferrer')` | `EmitirSolicitudButton.tsx:56` | YES |
| Button disabled when `direccion` missing | `EmitirSolicitudButton.tsx:51-71` + `page.tsx:341` | YES |

**Design deviations**:
- Toast severity (`info` vs `success`) — see Warning 3 above.

---

## 8. Final Verdict

**FAIL** — 1 CRITICAL (R14 golden-file test missing) + 1 WARNING (toast severity) + 3 SUGGESTIONS.

The 14-requirement NEW spec has 13 PASS / 1 FAIL. The 3 DELTA specs all PASS. All static analysis is clean (`pnpm typecheck` + `pnpm lint` exit 0; the only lint warning is a pre-existing `gastos.test.ts:367 no-console`, unrelated to PR 8d.1). All 51 new backend tests + 12 new web tests pass in the targeted runs; full web suite at 610/610.

**Recommended next step**: STOP. Do not archive yet. **Hotfix PR required** to add the golden-file test (R14) before the change can ship to production. After the hotfix merges, re-run `sdd-verify` and then `sdd-archive`.

---

## 9. Risks Carried Forward

- **Pre-existing CI failures** (gastos.test.ts:367 lint no-console, labeler drift, Docker build smoke log_error) — same as PR 8c.1 / 8d.1; documented in PR bodies, unrelated to this verification.
- **0030 migration apply runbook** — must be run post-merge via `docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/drizzle/0030_socio_fecha_nacimiento.sql`. Not applied by this verification.
- **Docker image size** — multi-stage chromium adds ~170 MB; the post-build size delta is not measured by the verification (no `docker build` in the verify phase).
- **Semaphore correctness** — `Semaphore.acquire(fn)` is verified at the unit level (`semaphore.test.ts`) and integration level (`pdf-generator.test.ts`) but NOT under real chromium load. The 3-slot cap is correct under unit conditions; real-world contention (4+ simultaneous operators clicking the button) is unverified in this environment.
- **Audit metadata shape** — exact 4-key shape is pinned by `emit-form.test.ts:230` (`Object.keys(meta!).sort()` equals exactly the 4 keys). Zod runtime validation is absent (see Warning 2).
- **Golden-file test reliability** — Chromium version drift (Risk 6 above) means any future golden test should use substring-based assertions, not exact-byte or position-based assertions, per design §11.

---

## 10. Skill Resolution

**Skill resolution**: `paths-injected`. Verify-report file paths and per-requirement evidence quoted above were derived from direct file inspection of the workspace, not from re-running skills.