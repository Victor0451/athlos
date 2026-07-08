# Tasks: Socio Form Emit (PDF inscripción)

**Change**: `athlos-socio-form-emit`
**Scope**: Server-render `solicitud-inscripcion` PDF from `/socios/[id]` using puppeteer; emit `SOCIO_FORM_EMITTED` audit with SHA-256; add `fecha_nacimiento DATE NULL` to `socios`; ship chromium in Dockerfile runner stage; add "Emitir Solicitud" button to socio detail header.
**Spec**: `openspec/changes/athlos-socio-form-emit/specs/socio-form-emit/spec.md` (NEW, 14 reqs / ~38 scenarios) + DELTAs to `audit-logger`, `api-design`, `ui-design`.
**Design**: `openspec/changes/athlos-socio-form-emit/design.md`.
**Proposal**: `openspec/changes/athlos-socio-form-emit/proposal.md`.

---

## Review Workload Forecast

```
- PR A backend estimated changed lines: ~750 (design forecast 700-800)
- PR B frontend estimated changed lines: ~100 (design forecast 80-120)
- 400-line budget risk: HIGH (PR A exceeds)
- Chained PRs recommended: Yes (split PR A further if needed)
- Decision needed before apply: Yes — user must choose between size:exception for PR A OR chained split
- Notes: chained option: split PR A into A1 (template + filename + semaphore + migration + audit const, ~400 LoC) + A2 (pdf-generator + emit-form + route + Dockerfile + integration, ~300 LoC). Stacking: stacked-to-main (project default).
```

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

| Slice | Code LoC | Test LoC | Total | Risk |
|-------|---------:|---------:|------:|------|
| PR A backend | ~360 | ~390 | **~750** | HIGH (over budget) |
| PR B frontend | ~50 | ~50 | **~100** | Low |

---

## Dependency Graph

```
PR A (backend)
  A.1 migration 0030 + schema fechaNacimiento + audit SOCIO_FORM_EMITTED const
    └─> A.2 semaphore.ts + template-renderer.ts + filename.ts  (pure helpers, no puppeteer yet)
         └─> A.3 solicitud-inscripcion.template.ts + solicitud-inscripcion.styles.ts + logo.ts  (string constants)
              └─> A.4 pdf-generator.ts  (puppeteer wrapper + semaphore consumer)
                   └─> A.5 emit-form.ts  (load socio + render + generate + audit + SHA-256)
                        └─> A.6 socio-forms.ts route + server.ts registration
                             └─> A.7 Dockerfile multi-stage + final verification (golden-pdf + integration)

PR B (depends on PR A merged into main)
  B.1 lib/api/forms.ts  (client URL helper)
    └─> B.2 EmitirSolicitudButton.tsx  (Printer icon + window.open + notify toast)
         └─> B.3 /socios/[id]/page.tsx wiring  (split action cluster: "always" + "ADMIN" groups)
```

---

## Work Unit Commits

### PR A — backend (7 commits, ~830-1180 LoC total)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| A.1    | Migration SQL `0030_socio_fecha_nacimiento.sql` + schema widening (`fechaNacimiento: date('fecha_nacimiento')`) + audit action constant `SOCIO_FORM_EMITTED` in `packages/audit/src/emitter.ts` const-map + tests | ~80-120 | RED→GREEN (migration applied manually) |
| A.2    | `semaphore.ts` + `template-renderer.ts` + `filename.ts` + tests (pure functions, no puppeteer) | ~150-200 | RED→GREEN |
| A.3    | `solicitud-inscripcion.template.ts` + `solicitud-inscripcion.styles.ts` + `logo.ts` (string constants, no tests — verified by golden-pdf in A.7) | ~250-350 | integration |
| A.4    | `pdf-generator.ts` (puppeteer singleton wrapper + semaphore consumer + `--disable-dev-shm-usage`) + tests (mock puppeteer) | ~100-150 | RED→GREEN |
| A.5    | `emit-form.ts` service (load socio + render + generate + SHA-256 + audit) + tests | ~150-200 | RED→GREEN |
| A.6    | `socio-forms.ts` route (`GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`) + server.ts registration + tests (200/401/404 + Content-Disposition) | ~80-120 | RED→GREEN |
| A.7    | Multi-stage Dockerfile update (chromium + libs + env vars) + `package.json` (`puppeteer` + `pdf-parse` devDep) + golden-pdf integration test (`pdf-parse` substring assertions) | ~20-40 | integration smoke |

PR A total forecast: ~830-1180 LoC. **Will exceed 400.** Either `size:exception` (orchestrator asks user) OR split into A1+A2 if user prefers chained.

### PR B — frontend (3 commits, ~80-140 LoC total)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| B.1    | Client wrapper `forms.ts` (`getSocioFormUrl`) + tests | ~30-50 | RED→GREEN |
| B.2    | `EmitirSolicitudButton` component (Printer icon + window.open + notify toast + disabled when `direccion` missing) + tests | ~40-70 | RED→GREEN |
| B.3    | Page wiring in `apps/web/src/app/(authed)/socios/[id]/page.tsx` (split action cluster into "always" + "ADMIN" groups with `ink-100` divider) + tests | ~10-20 | test-extend |

PR B total forecast: ~80-140 LoC. **Under 400, no decision needed.**

---

## Phase 1: Foundation / Infrastructure (PR A.1)

### Task A.1 — Migration + schema + audit action constant
- **File(s):** `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` (NEW); `packages/db/src/schema/socios.ts` (edit, add `fechaNacimiento: date('fecha_nacimiento')`); `packages/audit/src/emitter.ts` (edit, add `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'` to `AuditAction` const-map); `packages/audit/src/emitter.test.ts` (edit, assert const-map includes new key).
- **Behavior:** Adds nullable `fecha_nacimiento DATE` column to `socios` (idempotent via `ADD COLUMN IF NOT EXISTS`); widens Drizzle schema so TypeScript compiles; extends audit action const-map so `emitAudit({ action: 'SOCIO_FORM_EMITTED' })` is type-safe.
- **Tests added (RED):** `audit-emitter.test.ts` — assert `AuditAction` includes `'SOCIO_FORM_EMITTED'`; type-level test compiles.
- **Run order:**
  ```bash
  pnpm --filter @athlos/db typecheck
  pnpm --filter @athlos/audit typecheck
  pnpm --filter @athlos/audit lint
  pnpm --filter @athlos/audit test:run -- src/emitter.test.ts
  ```
- **Commit:** `feat(db+audit): add fecha_nacimiento column and SOCIO_FORM_EMITTED action`

---

## Phase 2: Pure Helpers (PR A.2)

### Task A.2 — Semaphore + template renderer + filename builder
- **File(s):** `apps/api/src/modules/socios/forms/semaphore.ts` + `semaphore.test.ts` (NEW); `apps/api/src/modules/socios/forms/template-renderer.ts` + `template-renderer.test.ts` (NEW); `apps/api/src/modules/socios/forms/filename.ts` + `filename.test.ts` (NEW).
- **Behavior:** Hand-rolled FIFO semaphore (counter + queue of resolvers; `acquire(fn)` runs `fn` and releases in `finally`); pure `{{var}}` substitution helper with HTML escape; `buildFilename(socio)` returning `solicitud-inscripcion-socio-{N}-{Apellido-sanitized}.pdf` (NFD strip + non-alphanumeric → `_` + UPPERCASE).
- **Tests added (RED):** `semaphore.test.ts` — 3 concurrent tasks succeed, 4th waits, FIFO order, `finally` release on throw, counter resets; `template-renderer.test.ts` — substitution + HTML escape (`<`, `>`, `&`, `"`) + missing variable → `''` + idempotency; `filename.test.ts` — `Pérez` → `PEREZ`, `O'Brien` → `O_BRIEN`, `García López` → `GARCIA_LOPEZ`, empty → `''`, only-special-chars → `''`, UPPERCASE pass.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/semaphore src/modules/socios/forms/template-renderer src/modules/socios/forms/filename
  ```
- **Commit:** `feat(api): add semaphore, template-renderer and filename helpers for forms`

---

## Phase 3: Template Constants (PR A.3)

### Task A.3 — Template + styles + logo string constants
- **File(s):** `apps/api/src/modules/socios/forms/solicitud-inscripcion.template.ts` (NEW); `apps/api/src/modules/socios/forms/solicitud-inscripcion.styles.ts` (NEW); `apps/api/src/modules/socios/forms/logo.ts` (NEW, exports base64 PNG from `word/media/image1.png`).
- **Behavior:** Exports TypeScript string constants for HTML template (header with logo + club data, body with titular fields, FESCAG section at end), CSS (A4 @page + `.rect-acta` + `.rect-socio` rectangles at the pinned coordinates), and base64-encoded logo. `{{var}}` placeholders only; no runtime logic. **No unit tests** — visual correctness is asserted by the golden-file test in A.7.
- **Tests added (RED):** none (integration coverage in A.7).
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  ```
- **Commit:** `feat(api): add solicitud-inscripcion HTML template, CSS and logo constants`

---

## Phase 4: Puppeteer Wrapper (PR A.4)

### Task A.4 — PDF generator (puppeteer singleton + semaphore consumer)
- **File(s):** `apps/api/src/modules/socios/forms/pdf-generator.ts` + `pdf-generator.test.ts` (NEW).
- **Behavior:** `createPdfGenerator({ maxConcurrent: 3 })` returns `{ init, generate, close }`; singleton Browser (launched once, idempotent init); `generate(html)` acquires semaphore, opens page, `setContent(html, { waitUntil: 'networkidle0' })`, `page.pdf({ format: 'A4', printBackground: true })`, closes page in `finally`. Launch args pinned: `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']`.
- **Tests added (RED):** mock puppeteer; assert `setContent` + `page.pdf({ format: 'A4', printBackground: true })` called with correct args; `page.close()` in `finally` even on error; init idempotency (init called twice → one launch); semaphore integration: 4th concurrent generate waits.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/pdf-generator
  ```
- **Commit:** `feat(api): add pdf-generator (puppeteer singleton + semaphore wrapper)`

---

## Phase 5: Service Orchestration (PR A.5)

### Task A.5 — emit-form service (load socio + render + generate + audit + SHA-256)
- **File(s):** `apps/api/src/modules/socios/forms/emit-form.ts` + `emit-form.test.ts` (NEW).
- **Behavior:** `emitForm({ socioId, operatorId })` loads socio via repository, sanitizes filename, renders template via `renderTemplate()` with HTML-escaped values, calls `pdfGenerator.generate(html)`, computes SHA-256 via `crypto.createHash('sha256')`, emits `SOCIO_FORM_EMITTED` audit with exact 4-key metadata `{ socio_id, form_id, sha256, byte_size }`, returns `{ pdf, filename, sha256, byteSize }`. Failed audit emission is `console.error`'d and swallowed — the PDF response still returns 200.
- **Tests added (RED):** mock repository + template + pdf-generator + emitAudit; assert full orchestration order; assert audit metadata shape (exactly 4 keys, sha256 is 64-char lowercase hex, byte_size is positive int matching `Buffer.byteLength(pdf)`); best-effort: throw from emitAudit → still returns result.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/emit-form
  ```
- **Commit:** `feat(api): add emit-form service with audit emission and SHA-256`

---

## Phase 6: HTTP Route (PR A.6)

### Task A.6 — `socio-forms` route + server registration
- **File(s):** `apps/api/src/routes/socio-forms.ts` + `socio-forms.test.ts` (NEW); `apps/api/src/server.ts` (edit, register `socioFormsRoutes` + decorate singleton pdf generator + SIGTERM close hook).
- **Behavior:** `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` with `preHandler: [requireAuth]` (no role gate); returns `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."` (exact quoted double-quote shape); 404 `SOCIO_NOT_FOUND` when socio missing; 401 missing JWT. Filename from `buildFilename(socio)` end-to-end.
- **Tests added (RED):** 200 happy path (response body starts with `%PDF-`, Content-Disposition matches exact pattern with sanitized apellido for `O'Brien` → `O_Brien`); 401 missing JWT; 404 unknown socioId (no audit emitted on 404).
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/routes/socio-forms
  ```
- **Commit:** `feat(api): expose GET /socios/:id/forms/solicitud-inscripcion.pdf route`

---

## Phase 7: Docker + Golden Verification (PR A.7)

### Task A.7 — Dockerfile multi-stage + puppeteer deps + golden-pdf integration test
- **File(s):** `Dockerfile` (edit, multi-stage: builder `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`, runner `apk add chromium nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1`, env `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`); `apps/api/package.json` (add `puppeteer` runtime dep + `pdf-parse` devDep); `apps/api/src/modules/socios/forms/golden-pdf.test.ts` (NEW).
- **Behavior:** Multi-stage build keeps chromium out of the builder; runner ships system chromium with required libs; golden-file test calls `emitForm()` twice with the same fixture and asserts parsed PDF text (via `pdf-parse`) contains expected substrings (`apellido + ", " + nombre`, `dni`, `numeroSocio`, FESCAG footer). Determinism check: same input → same rendered text.
- **Tests added (RED):** `golden-pdf.test.ts` — two emissions with same input produce equivalent substring counts for required fields; assertions cover FESCAG footer.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/golden-pdf
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms src/routes/socio-forms
  ```
- **Commit:** `chore(docker+api): ship chromium in runner and add golden-pdf test`

---

## Phase 8: Frontend Client Wrapper (PR B.1)

### Task B.1 — Client URL helper `forms.ts`
- **File(s):** `apps/web/src/lib/api/forms.ts` + `forms.test.ts` (NEW).
- **Behavior:** Pure URL composition: `getSocioFormUrl(socioId)` returns `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/solicitud-inscripcion.pdf`. No fetch, no body.
- **Tests added (RED):** assert URL composition with stubbed env var; assert trailing-slash and double-slash trimming; assert socioId interpolation.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/lib/api/forms.test.ts
  ```
- **Commit:** `feat(web): add forms client wrapper with socio form URL helper`

---

## Phase 9: Frontend Button (PR B.2)

### Task B.2 — `EmitirSolicitudButton` component
- **File(s):** `apps/web/src/components/socios/EmitirSolicitudButton.tsx` + `EmitirSolicitudButton.test.tsx` (NEW).
- **Behavior:** Stateless button using `lucide-react` `Printer` icon + Secondary variant (`#ffffff` bg, `1px #d4d4d4` border, `ink-700` text). On click: `window.open(url, '_blank', 'noopener,noreferrer')` where `url = getSocioFormUrl(socioId)`, then `notify('success', 'Solicitud emitida')` from the `athlos-toast-primitivo` wrapper. Disabled when `socio.direccion` is missing (per ui-design delta R7).
- **Tests added (RED):** click handler calls `window.open` with exact URL + `'_blank'` + `'noopener,noreferrer'`; toast called on success; disabled state when `direccion` is empty; vi.mock synchronous factory per design R4 of audit-operator-display.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/EmitirSolicitudButton.test.tsx
  ```
- **Commit:** `feat(web): add EmitirSolicitudButton component with window.open + toast`

---

## Phase 10: Frontend Page Wiring (PR B.3)

### Task B.3 — Wire button in `/socios/[id]/page.tsx`
- **File(s):** `apps/web/src/app/(authed)/socios/[id]/page.tsx` (edit); `apps/web/src/app/(authed)/socios/[id]/page.test.tsx` (extend existing tests if any).
- **Behavior:** Add `EmitirSolicitudButton` to the page header action cluster BEFORE the ADMIN group (always visible to any authenticated operator). Split action cluster into two groups separated by a 1px `ink-100` divider: "always" group (Emitir Solicitud) and "ADMIN" group (Editar, Dar baja, Reactivar). Mirror pattern from `athlos-audit-operator-display` (UI delta R7: button disabled when `direccion` missing).
- **Tests added (RED):** assert button renders in header; assert button appears BEFORE the ADMIN divider; assert disabled prop when `direccion` is empty.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/app/(authed)/socios/[id]/page.test.tsx
  ```
- **Commit:** `feat(web): wire Emitir Solicitud button in /socios/[id] header`

---

## Apply Handoff

Strict TDD per task: **RED + GREEN in the SAME commit** (per audit-operator-display convention — do NOT split them across commits).

### PR A

```bash
git checkout -b feat/socio-form-a origin/main

# Apply A.1 through A.7 (one commit each, RED→GREEN in the same commit)

# After all commits:
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/api test:run -- src/modules/socios/forms src/routes/socio-forms

# Migration apply (POST-MERGE ONLY — never in CI or apply phase):
# docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/drizzle/0030_socio_fecha_nacimiento.sql

git push origin feat/socio-form-a
gh pr create \
  --title "feat(api): socio form emit (solicitud-inscripcion) with puppeteer (PR 8d.1)" \
  --base main
```

### PR B

```bash
git checkout -b feat/socio-form-b origin/main

# Apply B.1, B.2, B.3

# After all commits:
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/web lint
pnpm --filter @athlos/web test:run -- src/components/socios/EmitirSolicitudButton.test.tsx src/lib/api/forms.test.ts

git push origin feat/socio-form-b
gh pr create \
  --title "feat(web): Emitir Solicitud button in /socios/[id] (PR 8d.2)" \
  --base main
```

### Branch names and PR titles

- PR A: branch `feat/socio-form-a`, title `feat(api): socio form emit (solicitud-inscripcion) with puppeteer (PR 8d.1)`
- PR B: branch `feat/socio-form-b`, title `feat(web): Emitir Solicitud button in /socios/[id] (PR 8d.2)`

### Out-of-scope for apply (orchestrator notes in PR body)

- **No deploy** in either PR — no docker build, no PM2 restart, no production container touch.
- **No migration apply** in PR A — `0030_socio_fecha_nacimiento.sql` is applied post-merge via `docker exec psql` (orchestrator chore).
- **Pre-existing CI failures** (test/labeler/Docker build smoke) will reappear — document in PR body as unrelated (same pattern as PR 8c.1).
- Orchestrator merges with `--admin` if needed to bypass pre-existing CI failures.

---

## Critical tasks (highest risk)

- **A.5 — `emit-form.ts` service** — full integration: load socio + render + generate + SHA-256 + audit. Largest test surface; best-effort audit emission must NOT roll back the PDF response. Most likely place for a subtle bug (e.g., double-read of buffer breaking the SHA-256 in-pass guarantee).
- **A.4 — `pdf-generator.ts`** — puppeteer wrapper + semaphore integration. Concurrency correctness depends on `try/finally` page close + semaphore slot release. Test must drive 4 concurrent generate calls to assert FIFO + cap-at-3.
- **A.6 — `socio-forms.ts` route + Content-Disposition header** — must be exact (quoted double-quote, ASCII-only, `inline; filename="..."`) for the `window.open` UX to land a sensible filename in the browser. Sanitization end-to-end (`O'Brien` → `O_Brien`) lives here.

---

## Risks (this task breakdown's own risks)

1. **Budget overrun on PR A** — forecast ~830-1180 LoC, well over the 400-line budget. Forecast HIGH; chained option (split into A1+A2) OR `size:exception` offered.
2. **Chained-vs-exception decision is unresolved** — orchestrator must surface this to the user before `sdd-apply`. Default is `size:exception` for PR A (single PR, maintainer approval) per the design's recommendation.
3. **Semaphore test reliability** — driving 4 concurrent tasks with `await Promise.all` is timing-sensitive. Use real timers (no fake timers) and assert via shared state, not wall-clock.
4. **Chromium version pinning for golden-file stability** — Alpine `chromium` package version may drift; rendered text could shift between local dev and CI. Golden-file assertions must be substring-based (not exact-position) so they survive minor layout shifts.
5. **Pre-existing CI failures will reappear** — same pattern as PR 8c.1; orchestrator documents in PR body and merges with `--admin`.