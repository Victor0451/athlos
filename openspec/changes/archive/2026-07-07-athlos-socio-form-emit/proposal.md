# Proposal: Socio Form Emit (PDF inscripción)

## Why

Operators need to print a Club Atlético Gorriti membership inscription request for a socio. Today: they handwrite the data or copy-paste into a separate Word file (`/srv/docs/ficha.docx`). This change generates the PDF directly from the socio detail page, pre-filled with the titular's data from the DB, ready to print.

## What changes

- New dep: `puppeteer` (npm) — adds Alpine chromium ~+170 MB to the image.
- Migration `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` (hand-written) adds `fecha_nacimiento DATE` to `socios` (NULL allowed). The Drizzle pipeline is broken in prod (PR 8b.4 precedent); apply via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0030_*.sql`.
- Schema update: `packages/db/src/schema/socios.ts` adds `fechaNacimiento: date('fecha_nacimiento')` (no Drizzle generate; the hand-written migration is source of truth).
- New module `apps/api/src/modules/socios/forms/` with:
  - `solicitud-inscripcion.template.html` (string literal in TS, `{{var}}` placeholders)
  - `solicitud-inscripcion.styles.css` (string literal in TS, A4 page setup, `@media print`, absolute-positioned rectangles)
  - `template-renderer.ts` (small `{{var}}` substitution helper with HTML escape)
  - `pdf-generator.ts` (puppeteer wrapper with semaphore + `--disable-dev-shm-usage`)
  - `emit-form.ts` (service: load socio, render, generate PDF, emit audit)
  - `assets/gorriti-logo.ts` (base64 string constant — 7551 B PNG from `word/media/image1.png`)
- New route `apps/api/src/routes/socio-forms.ts` (1 endpoint).
- New audit action `SOCIO_FORM_EMITTED` in `packages/audit/src/emitter.ts` (const-map extension only; `metadata` field already wired by PR 8c.1).
- New endpoint registration in `apps/api/src/server.ts` (route + singleton browser + SIGTERM close hook).
- Frontend: new `forms.ts` client wrapper + `EmitirSolicitudButton` component in `apps/web/src/components/socios/`.
- Frontend: wire the button in `apps/web/src/app/(authed)/socios/[id]/page.tsx` header (split the action cluster into "always" + "ADMIN" groups).
- Dockerfile: multi-stage update (add chromium + nss + freetype + harfbuzz + ttf-freefont + cairo + pango + libintl to runner stage; set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`).
- Repository edit: `apps/api/src/modules/socios/repository.ts` (the `findById` query uses `select *` — no edit needed; `fechaNacimiento` is returned automatically once the schema widens).

## Scope

**In:**
- `apps/api/src/modules/socios/forms/` (NEW module)
- `apps/api/src/routes/socio-forms.ts` (NEW)
- `apps/api/src/server.ts` (edit, register new route + decorate singleton browser)
- `apps/api/package.json` (add `puppeteer`)
- `Dockerfile` (edit, multi-stage for chromium)
- `packages/db/src/schema/socios.ts` (edit, add `fechaNacimiento`)
- `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` (NEW, hand-written)
- `packages/audit/src/emitter.ts` (edit, add `SOCIO_FORM_EMITTED` to const-map)
- `apps/web/src/components/socios/EmitirSolicitudButton.tsx` (NEW)
- `apps/web/src/lib/api/forms.ts` (NEW client wrapper)
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` (edit, wire the button)
- Tests at every new file (1:1 source:test ratio)

**Out:**
- Backfilling `fecha_nacimiento` for existing socios (deferred to a follow-up if needed; column is NULL allowed).
- No other forms (this change ships `solicitud-inscripcion` only; the architecture supports more later — second drop in the same module folder).
- No `<iframe>` embedded PDF preview (just `window.open` in a new tab).
- No PDF caching (each emission generates fresh; audit row carries the SHA-256 for verifiability).
- No CSRF protection beyond the existing auth (PDF endpoint is GET, but audit IS emitted).
- No audit-tab surfacing of the form-emit `metadata` (the column persists; rendering lives in a follow-up).

## Approach

**Backend route shape:**
```ts
fastify.get<{ Params: { id: string } }>(
  '/api/v1/socios/:id/forms/solicitud-inscripcion.pdf',
  { preHandler: [requireAuth] },
  async (req, reply) => {
    const result = await emitForm({
      socioId: req.params.id,
      operatorId: req.user.sub,
    });
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${result.filename}"`)
      .send(result.pdf);
  }
);
```

**Service (high-level):**
1. Load the socio from the DB (the `findById` helper already returns all columns).
2. Sanitize `apellido` for the filename (strip diacritics + non-alphanumeric → `_`).
3. Render the template (`replace(/\{\{(\w+)\}\}/g, …)` with HTML-escape per token).
4. Acquire semaphore (cap 3 concurrent `page.pdf()` calls).
5. `page.setContent(html)`, `page.pdf({ format: 'A4', printBackground: true })`.
6. Compute SHA-256 of the PDF bytes (`crypto.createHash('sha256')`).
7. Emit `SOCIO_FORM_EMITTED` audit event with exact metadata.
8. Release semaphore; close the page.
9. Return `{ pdf, filename }`.

**Puppeteer singleton + semaphore:**
- One `puppeteer.launch()` at `buildServer()` time, held on a Fastify decorator. SIGTERM hook closes the browser.
- Hand-rolled semaphore (no extra dep) limits concurrent `page.pdf()` to 3. Excess requests queue.
- `args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']` (Alpine-friendly).

**Audit metadata (exact keys):**
```ts
{
  socio_id: string,         // UUID
  form_id: 'solicitud-inscripcion',
  sha256: string,           // 64-char hex of the PDF bytes
  byte_size: number,        // Buffer.byteLength(pdf)
}
```

**Field map (DB column → form token):**
- `numeroSocio` → `{{numero_socio}}` (Rectángulo 2 SOCIO Nº + body "como SOCIO:…"). Rectángulo 1 ACTA Nº stays blank (`.................`).
- `apellido + ", " + nombre` → `{{titular_nombre}}` (body "El / La que suscribe…" + FESCAG acceptance).
- `dni` → `{{dni}}` (body "D.N.I. Nº…" + FESCAG acceptance).
- `fechaNacimiento` (string `YYYY-MM-DD` or empty) → `{{fecha_nacimiento}}` (body "FECHA DE NACIMIENTO…/…/…"). Renders blank if the column is NULL.
- `direccion` → `{{domicilio_calle}}` (CALLE field only; Nº + BARRIO blank — DB has no split).
- `telefono` → `{{domicilio_telefono}}` (TELEF field).
- `email` → `{{email}}` (CORREO ELECTRONICO DEL TITULAR).
- Server `today` formatted `DD/MM/YYYY` → `{{fecha_emision}}` (FESCAG "San Salvador de Jujuy, …").
- **BLANK (no DB column)**: ACTA Nº, DOMICILIO LABORALES, OTROS checkboxes, GRUPO FAMILIAR, CADETE block, PADRE/MADRE autorizante, SOCIO PRESENTANTE ×2, all signature lines.

## Capabilities

**New:** `socio-form-emit` — read-only PDF generation endpoint backed by the dormant `file-storage` PDF path (realised for the first time in this change).

**Modified at spec level:**
- `audit-logger/spec.md` — delta: `SOCIO_FORM_EMITTED` action + exact metadata shape `{ socio_id, form_id, sha256, byte_size }`.
- `api-design/spec.md` — delta: new endpoint `GET /api/v1/socios/:id/forms/solicitud-inscripcion.pdf` returning `application/pdf` with `Content-Disposition: inline; filename=...`.
- `ui-design/spec.md` — minor delta: new "Emitir Solicitud" button in the socio detail header (always-visible group, distinct from the ADMIN cluster).

## User-visible behaviour

- Operator opens `/socios/[id]`.
- Sees new button "Emitir Solicitud" in the page header (next to Edit/Dar baja/Reactivar; visible to ANY authenticated operator).
- Clicks the button.
- A new browser tab opens with the PDF pre-filled.
- The PDF shows the header with the Gorriti club data + logo, the body with the titular's data, and the FESCAG reglamento at the end.
- The PDF filename is `solicitud-inscripcion-socio-12345-Perez.pdf` (sanitized: `apellido` with diacritics stripped + non-alphanumeric replaced by `_`).
- Operator clicks the browser's print button (or Ctrl+P) and prints to paper or to a PDF printer.
- A toast confirms the emission (via the existing `notify()` helper from `athlos-toast-primitivo`).
- Audit event `SOCIO_FORM_EMITTED` recorded with the exact metadata.

## Risks & mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | **Chromium binary size (+170 MB)** | Multi-stage build keeps chromium out of intermediate layers; image goes from ~400 MB to ~570 MB. Documented in PR body. |
| R2 | **`/dev/shm` too small on Alpine (64 MB)** | Launch with `--disable-dev-shm-usage` (PUPPETEER_ARGS). |
| R3 | **Memory pressure** (10 concurrent `page.pdf()` ≈ 500 MB) | Hand-rolled semaphore caps at 3 concurrent pages; excess queue. |
| R4 | **PDF text fidelity** (chrome print pipeline can shift dotted lines) | Golden-file test: render a known socio fixture, parse PDF text via `pdf-parse` substring assertions. |
| R5 | **Missing `fechaNacimiento` for existing socios** | Column is NULL allowed; field renders blank with `..../..../......` placeholder. |
| R6 | **Pre-existing CI failures** (test/labeler/Docker build smoke) | Unrelated; document in PR body as out of scope (same pattern as PR 8c.1). |
| R7 | **Filename special characters in `apellido`** | Sanitize via diacritics strip + replace non-alphanumeric with `_`. |
| R8 | **Helmet COOP/COEP** may break puppeteer | Verify by inspection (project-tuned helmet); add the route to the exemption list mirroring `/metrics` if needed. |
| R9 | **Audit metadata not surfaced in AuditTab** | Out of scope for v1; metadata persists in the table regardless. A follow-up widens `queryAudit` to return `metadata`. |
| R10 | **The .docx has 2 rectangles, not 4** (exploration noted) | Both render at the same CSS coords; SOCIO Nº gets `numero_socio`, ACTA Nº stays blank with `.................`. |

## Rollback plan

Additive. Reverting removes the puppeteer dep + the new module + the route + the button. The migration `0030_socio_fecha_nacimiento.sql` is reversible via `ALTER TABLE socios DROP COLUMN fecha_nacimiento`. No file storage pollution (PDFs are ephemeral, never written to disk). No audit pollution: `SOCIO_FORM_EMITTED` rows persist in `audit_events` but become orphaned and harmless (the `metadata` JSONB is opaque to other queries).

## Dependencies

New: `puppeteer` (npm, latest stable). All else existing (`@athlos/audit`, `@athlos/db`, `@fastify/*`, React, `notify()` toast from `athlos-toast-primitivo`, `Modal` from `athlos-toast-primitivo`).

## Open questions

None. See `sdd/athlos-socio-form-emit/explore` (#312) for the question trail. The two documented gaps (rectangles count + `fechaNacimiento` discrepancy) and the two UX questions (filename + window.open vs download) have been resolved by the locked decisions in the orchestrator prompt.

## Success criteria

- [ ] Endpoint `GET /api/v1/socios/:id/forms/solicitud-inscripcion.pdf` returns a valid PDF (Content-Type `application/pdf`, Content-Disposition `inline; filename=…`, body starts with `%PDF-`).
- [ ] PDF matches the original .docx layout (header with logo, body, FESCAG).
- [ ] Auto-filled titular fields: nombre, apellido, dni, numeroSocio, fechaNacimiento (if not NULL), direccion, telefono, email.
- [ ] Cadete + presentante + acta + signature lines left blank.
- [ ] Filename is `solicitud-inscripcion-socio-{N}-{Apellido}.pdf` with sanitized apellido (diacritics stripped, non-alphanumeric → `_`).
- [ ] `window.open(url, '_blank', 'noopener,noreferrer')` opens the PDF in a new tab.
- [ ] Toast `notify('success', '…')` on success.
- [ ] Audit event `SOCIO_FORM_EMITTED` emitted with exact metadata `{ socio_id, form_id, sha256, byte_size }`.
- [ ] Concurrent emissions capped at 3 via semaphore.
- [ ] Chromium launches with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`.
- [ ] Migration `0030_socio_fecha_nacimiento.sql` applied via `docker exec psql`.
- [ ] Dockerfile multi-stage keeps chromium out of the builder stage; `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` set in the runner.
- [ ] 1:1 source:test file ratio for all new files.
- [ ] `pnpm typecheck` + `pnpm lint` clean; full web + API test suites pass.
- [ ] Spec deltas for `audit-logger`, `api-design`, and `ui-design` committed.
- [ ] Pre-existing CI failures documented as unrelated in the PR body.
