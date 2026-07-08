# Exploration: `athlos-socio-form-emit`

## Goal

Emit a server-rendered PDF of the Club Atlético Gorriti membership form
(`/srv/docs/ficha.docx`) for any given socio, on demand, from
`/socios/[id]`. The form is a multi-page legal-style document with header,
member identity block, group-family block, signature lines, and the FESCAG
(Fondo de Emergencia Solidario) regulation appended verbatim. Auto-filled
fields are limited to the titular block (nombre, DNI, fecha nac, domicilio,
email, número socio); the cadete block, presentante fields, and signature
lines stay blank for handwritten completion at the club.

The product decisions below are LOCKED (per the orchestrator prompt). This
exploration reconciles the locked decisions against the actual codebase
(`/srv/docs/ficha.docx`, `packages/db`, `apps/api`, `apps/web`) so the
propose phase can scope work without re-litigating decisions, and flags
the two non-obvious gaps the locked decisions leave open.

## Current State

What exists today that this change will land on top of:

| Artefact | Status | Notes |
|---|---|---|
| `/srv/docs/ficha.docx` | source form | Single source-of-truth file. 7551-byte PNG logo (`word/media/image1.png`, 106×114). Text content extracted via Python regex in this exploration. |
| `apps/api/package.json` | puppeteer ABSENT | No `puppeteer` dependency. Adding it pulls chromium (~170 MB) into `node_modules`. |
| `Dockerfile` | no chromium | Multi-stage `node:22-alpine`. Runner stage installs `tini`, `bash`, `postgresql-client`, `curl`, `tsx`. No chromium, no `nss`, no `atk` libs. |
| `@fastify/multipart` | registered | Already wired in `server.ts` (PR 8c.1) with `limits: { fileSize: 10MB, files: 1 }`. Form route does NOT need it — returns a PDF stream, not a multipart parse. |
| `audit_events.metadata` | jsonb available | Confirmed in `packages/db/src/schema/public.ts:59`. `emitAudit()` already accepts a `metadata?: Record<string, unknown>` field (added in PR 8c.1). |
| `AuditAction` const-map | widening pattern proven | `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED` were added in PR 8c.1 — same pattern applies for `SOCIO_FORM_EMITTED`. |
| `AuditQueryFilters` | does NOT return metadata | `queryAudit` in `packages/audit/src/query.ts` does not select `metadata` — this is acceptable for v1 (timeline doesn't render form-emit metadata yet). The metadata persists in the table regardless; a follow-up widening can surface it. |
| `getSocio(id)` client wrapper | ready | `apps/web/src/lib/api/socios.ts:115` returns `Socio`. The button on `/socios/[id]` will trigger a separate `window.open(formUrl)` (or fetch+blob) — no new client query. |
| `/socios/[id]/page.tsx` header | ready for the button | Header has the circular back-button, name+badge, and the ADMIN action cluster. The new "Emitir Solicitud" button slots into the action cluster and is gated to ANY authenticated operator (not ADMIN-only). |
| `notify()` toast helper | wired | All 7 mutations on `/socios/[id]` already use it (archived `athlos-toast-primitivo`). |
| `<Modal>` primitive | ready | Available for confirmation modal if needed; v1 may use a direct `window.open()` instead and skip the modal. |

## Locked product decisions (do NOT re-litigate)

| # | Decision | Frozen value | Source-of-truth file |
|---|----------|--------------|----------------------|
| 1 | Output format | PDF descargable, server-side rendered | (this exploration) |
| 2 | PDF tool | `puppeteer` (npm), chromium downloaded into image | (this exploration) |
| 3 | Logo | Reuse `word/media/image1.png` from the .docx, inline base64-encoded in HTML | (this exploration) |
| 4 | Form content | FULL original: header + body + FESCAG | (this exploration) |
| 5 | Auto-filled fields | TITULAR only: nombre, DNI, fecha nac, domicilio, email, número socio. Cadete + presentante left blank. | (this exploration) |
| 6 | UI | "Emitir Solicitud" button in `/socios/[id]` header | `apps/web/src/app/(authed)/socios/[id]/page.tsx` |
| 7 | Audit | `SOCIO_FORM_EMITTED` with `metadata: { socio_id, form_id, sha256, byte_size }` | `packages/audit/src/emitter.ts` (extend const-map) |
| 8 | Auth | Any authenticated operator (no ADMIN gate) | (this exploration) |
| 9 | Form id | `solicitud-inscripcion` | (this exploration) |

## Reconciliation against the codebase (the interesting part)

### A. The .docx actually has 2 floating rectangles, not 4

The orchestrator prompt stated "4 rectangles in the .docx → `position:
absolute` in HTML". Inspection of `word/document.xml` via the Python
`zipfile` + regex extraction shows:

- **2 `<v:rect>` shapes** (also rendered as DrawingML `<w:drawing>` shapes —
  Word dual-encodes them; same shape, two representations). Both are
  textboxes containing form-fillable text:
  - `Rectángulo 1` — `ACTA Nª: .................`
  - `Rectángulo 2` — `SOCIO Nº: ...............`
- **1 PNG logo** (`word/media/image1.png`, 7551 bytes, 106×114 px,
  referenced from `word/header1.xml` via VML `<v:imagedata>` inside an OLE
  wrapper `<o:OLEObject>` → `embeddings/oleObject1.bin`).
- **No other floating shapes.** Tables, paragraphs, and signature lines are
  normal flow content, not absolute-positioned.

**The locked design treats both rectangles the same way**: they sit in the
top-right of the form (Word's `margin-left: 383.15pt; margin-top: 11pt;
width: 126pt; height: 27pt`) and both contain "...." blanks. In our HTML
emission, both will render as absolute-positioned bordered text boxes at
those coordinates, filled with the same `numero_socio` value (the ACTA box
stays blank in v1 since we have no acta column — see decision gap below).

**Recommendation**: call this out as a discrepancy in the proposal. Either
drop one rectangle or treat both as the same field. v1 simplification:
render both rectangles; fill the SOCIO Nº box with `numero_socio`; leave
the ACTA box blank with the `.................` placeholder text intact.
A future iteration can add an `acta` column and fill both.

### B. Field map — DB column → form field

The form has ~30 fill-in tokens (blank "...." lines, textboxes, table
cells). Mapping them to the `socios` schema (`packages/db/src/schema/
socios.ts:87-111`):

| Form location | Form label | DB column | Notes |
|---|---|---|---|
| Top right (Rectángulo 2) | `SOCIO Nº: ...............` | `numeroSocio` (text) | filled |
| Top right (Rectángulo 1) | `ACTA Nª: .................` | — (no column) | BLANK in v1 |
| Body paragraph | `El / La que suscribe...........................` | `apellido + ", " + nombre` | filled |
| Body paragraph | `D.N.I. Nº...........................` | `dni` (text) | filled |
| Body paragraph | `FECHA DE NACIMIENTO........./......../..........` | **NO DB COLUMN** | BLANK (see gap below) |
| Body paragraph | `como SOCIO:...............................` | `numeroSocio` | filled |
| Address table | `CALLE:` (DOMICILIO PARTICULAR) | `direccion` (text, full string) | filled — entire address goes here, leaving Nº + BARRIO blank |
| Address table | `Nº:` (DOMICILIO PARTICULAR) | — | BLANK (DB has no split columns) |
| Address table | `BARRIO` (DOMICILIO PARTICULAR) | — | BLANK |
| Address table | `TELEF:` (DOMICILIO PARTICULAR) | `telefono` (text) | filled |
| Address table | DOMICILIO LABORALES block | — | ALL BLANK (DB has no work-address fields) |
| Address table | `EMP. PUBLICO / EMP. PRIVADO / PROFESIONAL / INDEPEN.` (OTROS) | — | ALL BLANK |
| Address table | `CORREO ELECTRONICO DEL TITULAR` | `email` (text) | filled |
| Body block | GRUPO FAMILIAR table (rows) | — | BLANK (no family data in DB) |
| Body block | `YO PADRE / MADRE.............. D.N.I. Nº......` (CADETE autorizante) | — | BLANK |
| Body block | `HIJO/A............... DNI N°: .................` | — | BLANK |
| Body block | `A INSCRIBIRSE COMO SOCIO CADETE` | — | text-only block, stays static |
| Signature lines | `FIRMA SOLICITANTE` | — | BLANK (handwritten at club) |
| Signature lines | `FIRMA PADRE/ MADRE` | — | BLANK |
| Signature lines | `SOCIO PRESENTANTE Nº: ........` ×2 | — | BLANK (no presentante data in DB) |
| Page 2+ | FESCAG regulation text (ART. 1..10) | — | STATIC TEXT (no fill) |
| Page 2+ | `El / La que suscribe ... DNI Nº ...` (FESCAG acceptance) | `apellido + ", " + nombre` + `dni` | filled — same identity as titular |
| Page 2+ | `San Salvador de Jujuy, --/--/2026` | server `today` (formatted DD/MM/YYYY) | filled with emission date |
| Page 3 | `ACTA DE CONFORMIDAD` block (Aclaración, Firma) | — | BLANK |
| Page 3-4 | `FICHA DEL JUGADOR / A` block | — | BLANK (form is generic; some socio fields could go here in v2) |
| Page 3-4 | father/mother names + data | — | BLANK |
| Page 4 | father/mother signatures + DNI | — | BLANK |

**Net auto-filled tokens**: ~7 (nombre, apellido, dni, numeroSocio, direccion, telefono, email) + 1 server-side (today's date).

**Non-obvious gap (decision required)**: locked decision #5 says "fecha
nac" is auto-filled, but the `socios` table has NO `fechaNacimiento`
column. The schema has `fechaAlta` (date the socio joined) — semantically
different from date of birth. Three options:

| Option | Effort | Risk |
|---|---|---|
| A. Leave BLANK with `..../..../......` placeholder | 0 LoC | Locked decision #5 not fully honoured. |
| B. Fill with `fechaAlta` (semantically wrong but visible) | 0 LoC | Misleading; operator sees "fecha de nacimiento" populated with their join date. Reject. |
| C. Add `fechaNacimiento` column to `socios` schema + migration + form edit surface | 80-150 LoC + migration | Out of scope for this change; opens a data-quality discussion. |

**Recommendation**: **Option A** for v1 — leave BLANK. Flag in the
proposal so the user can override (e.g., if the operator historically
captured birth dates in `categoria` or notes, surface that, but don't
auto-fill).

### C. Template engine — simple `{{var}}` vs handlebars

Two viable options:

| Option | Pros | Cons | Effort |
|---|---|---|---|
| Simple regex `{{token}}` substitution (no dep) | 0 bytes dep; trivial to test; matches the locked decision that no template logic exists (no loops, no conditionals). | Hand-rolled; needs HTML-escape helper. | **Low** |
| `handlebars` (~50 KB runtime) | Standard syntax; partials; helpers; future-proof for v2 multi-form. | New transitive dep; overkill for ~30 tokens and no logic. | Medium |

**Recommendation**: **simple regex substitution**. The form has ~30
tokens and zero template logic (no loops, no conditionals, no nesting).
A small pure function `renderTemplate(html: string, vars: Record<string,
string>): string` that does `html.replace(/\{\{(\w+)\}\}/g, (_, k) =>
escapeHtml(vars[k] ?? ''))` is ~10 LoC, fully unit-testable, and adds
zero runtime weight.

### D. Logo encoding — inline base64 vs file

Two viable options:

| Option | Pros | Cons | Effort |
|---|---|---|---|
| Inline base64 data URI in `<img src="data:image/png;base64,...">` | Single string, deterministic; puppeteer renders with zero network/disk dependency; works in any container layout. | ~10 KB bloat in the HTML string; base64 increases byte size 33% (7.5 KB → 10 KB). | **Low** |
| File path → puppeteer loads via `file://` or `page.goto('file:///...')` | Smaller HTML; reuses OS file cache. | Requires the PNG to be in the image at a known path; needs Dockerfile COPY; puppeteer must run with `--allow-file-access-from-files` or similar; brittle on Alpine paths. | Medium |

**Recommendation**: **inline base64**. The 10 KB cost is trivial against
the HTML template size (≈30 KB) and eliminates a class of "logo missing"
failures. The PNG is committed to the repo as
`apps/api/src/modules/forms/assets/gorriti-logo.png`; a tiny
`buildLogoDataUri()` helper at module init reads + base64-encodes once at
boot. Source-of-truth: `/srv/docs/ficha.docx::word/media/image1.png` (sha256
prefix `ea7a4e33…`, 7551 bytes, 106×114).

### E. Floating rectangles — CSS approach

Both shapes are at Word coordinates `margin-left: 383.15pt; margin-top: 11pt;
width: 126pt; height: 27pt` (within the printable area of an A4 page).
Converting to CSS (print units):

```css
.print-page {
  position: relative;
  width: 210mm;     /* A4 width */
  height: 297mm;    /* A4 height */
  margin: 0;
  padding: 0;
}
.print-page .rect-acta,
.print-page .rect-socio {
  position: absolute;
  /* 1pt = 0.3528mm (approx 1/72 inch → mm); puppeteer honors CSS print
     units, so we can express in mm directly. 383.15pt ≈ 135.1mm. */
  left: 135mm;
  top: 4mm;          /* 11pt ≈ 3.9mm */
  width: 44.5mm;     /* 126pt ≈ 44.5mm */
  height: 9.5mm;     /* 27pt ≈ 9.5mm */
  border: 1px solid #000;
  background: #fff;
  font-family: Arial, sans-serif;
  font-size: 11pt;
  padding: 2px 4px;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
}
```

The two rectangles share the same `.rect-socio` style (same coords,
same dims). The body content sits BELOW the rectangles as a normal flow
block; puppeteer's `page.pdf({ format: 'A4', printBackground: true })`
honors absolute positioning.

**Verification**: a one-shot test renders the template with `{{socio_numero}}`
set to a known string, captures the PDF bytes, and asserts the resulting
PDF is well-formed (parse header `%PDF-1.x`) + size is > 10 KB (form is
multi-page).

### F. Audit metadata — exact keys

Per locked decision #7, the `metadata` JSONB on the `audit_events` row
emitted by this route MUST contain exactly:

```json
{
  "socio_id": "<uuid>",
  "form_id": "solicitud-inscripcion",
  "sha256": "<64-char-hex>",
  "byte_size": <positive integer>
}
```

- `sha256` = SHA-256 of the PDF bytes (computed via `crypto.createHash('sha256')` BEFORE `reply.send(buffer)`). Stored so a future "verify emitted form against audit log" tool can reproduce the byte-exact PDF.
- `byte_size` = `Buffer.byteLength(pdfBuffer)` — denormalised into metadata so the query interface can show "Form emitted (47 KB)" without re-reading the file (which isn't stored).
- **NOT stored on disk in v1**: the PDF is ephemeral. If the operator
  needs the PDF again, they re-click "Emitir Solicitud" and a new audit
  row is appended (within the 10s idempotency bucket, identical inputs
  dedupe to one row).

### G. Puppeteer Dockerfile integration

The current `Dockerfile` (lines 1-70) is a 2-stage `node:22-alpine` build.
Adding puppeteer requires:

1. **Builder stage (no change)**: `pnpm install` will pull `puppeteer` from
   the workspace. We DO NOT want the chromium download to happen here
   (wastes builder space; we install chromium via `apk` in the runner).
   Set `PUPPETEER_SKIP_DOWNLOAD=true` as a build-time env to suppress the
   postinstall hook.

2. **Runner stage additions**:

   ```dockerfile
   FROM node:22-alpine AS runner
   RUN apk add --no-cache \
       tini bash postgresql-client curl \
       chromium nss freetype harfbuzz \
       ttf-freefont \
       # Chromium runtime deps on Alpine (the canonical list)
       cairo pango libintl libssl1.1
   ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
       PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
       PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"
   ```

   `apk add chromium` adds ~170 MB to the runner image — a known cost of
   the locked decision #2 (puppeteer + npm chromium). The current
   `athlos-api:latest` image is ~400 MB; post-change ≈ 570 MB. The
   `PUPPETEER_EXECUTABLE_PATH` env tells puppeteer to launch the system
   chromium, NOT its bundled one (which we never downloaded anyway).

3. **Cold-start warmup**: the route handler responds 200 even on the very
   first request, but the first `page.pdf()` after process start takes
   1.5-2.5s for chromium to init. Mitigation: `puppeteer.launch()` once at
   `buildServer()` time and hold the browser instance on the Fastify
   container. Tests use `quietLogger: true` + a stub browser.

4. **Disposal**: a SIGTERM hook closes the browser cleanly so chromium
   doesn't leak file descriptors across restarts.

**Final image size impact**: ~+170 MB. Acceptable per locked decision #2.

### H. Route shape

```typescript
// apps/api/src/routes/socios-forms.ts  (NEW)
fastify.get<{ Params: { socioId: string } }>(
  '/api/v1/socios/:socioId/forms/solicitud-inscripcion',
  { preHandler: requireAuth() },                 // any auth, no role gate
  async (request, reply) => {
    // 1. Load socio + verify exists
    // 2. Read logo bytes + base64-encode (cached at boot)
    // 3. Build HTML: template.replace(/\{\{(\w+)\}\}/g, ...)
    // 4. Launch-or-reuse puppeteer page
    // 5. await page.setContent(html, { waitUntil: 'networkidle0' })
    // 6. const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, ... })
    // 7. await page.close()  // returns browser to pool
    // 8. emit audit (best-effort)
    // 9. reply
    //      .header('Content-Type', 'application/pdf')
    //      .header('Content-Disposition', `inline; filename="solicitud-inscripcion_${socio.numero_socio}.pdf"`)
    //      .send(pdfBuffer)
  }
)
```

Auth gate: `requireAuth()` (no role required, matching locked decision #8
and the notes/attachments precedent). The `request.operator.sub` is
captured for the audit event.

**Filename**: `solicitud-inscripcion_<numero_socio>.pdf` — uses the
human-readable socio number (e.g., `solicitud-inscripcion_00123.pdf`)
not the UUID; matches what an operator would expect when they save the
file.

**Idempotency**: the existing `emitAudit` 10s-bucket SHA-256 dedup
applies. Two clicks within 10s on the same socio collapse to one audit
row. Two clicks > 10s apart = two audit rows.

### I. UI placement

Locked decision #6 places the button in the `/socios/[id]` header
action cluster. Two viable spots:

| Spot | Pros | Cons |
|---|---|---|
| Header action cluster (next to Editar / Dar baja) | Visible on page entry; matches existing buttons; admin-aware cluster pattern. | The cluster is currently `isAdmin`-gated; we'd need to break the gate. |
| Next to the back-button (left of name) | Always visible regardless of role; cleaner separation of "view" vs "admin" actions. | New layout location. |

**Recommendation**: **header action cluster**, but split the cluster
into two groups: an "always visible" group (Emitir Solicitud) and an
"ADMIN only" group (Editar / Dar baja / Reactivar). The cluster already
has a `flex shrink-0 items-center gap-2` wrapper — adding a sibling
button before the `{isAdmin ? ... : null}` block keeps the diff small.

**Click behaviour**: `onClick={() => window.open(formUrl, '_blank',
'noopener,noreferrer')}`. No modal needed; v1 is "open in new tab,
download from there". A future v2 can add a `<Modal>` preview with the
embedded `<embed src={...} type="application/pdf">`.

### J. Non-obvious decisions (summary)

1. **PDF is NOT persisted to disk** — re-emission on demand. Audit row
   carries the SHA-256 + byte_size so verifiability is preserved without
   the storage cost.
2. **Logo bytes are read once at boot** (not per-request). The PNG is
   committed to the repo; no runtime I/O.
3. **Puppeteer browser is a singleton** — `puppeteer.launch()` once in
   `buildServer()`, hold on `fastify.decorate('puppeteer', browser)`.
   `page` instances are created per-request and `.close()`d on the
   reply's `onResponse` hook to prevent leaks.
4. **HTML escaping** — every `{{token}}` substitution runs through
   `escapeHtml()` to defend against socio names with `<`, `>`, `&`.
5. **The 2 .docx rectangles** (not 4 as the prompt stated) are rendered
   as absolute-positioned text boxes at the same coordinates; one gets
   `numero_socio`, the other stays with `.................` placeholder.
6. **Form text is preserved verbatim** — typos ("FESCAG",
   "EMEMERGENCIA", "FEMTENINO") stay in the output. This is a legal
   club document; we are NOT a spell-checker.
7. **FESCAG identity block** at the bottom of page 2 IS auto-filled with
   the same titular identity (nombre + DNI), per the .docx structure —
   it's a second signature acceptance, not a different person.

## Affected Areas

### Backend (`apps/api`)

- `apps/api/package.json` — add `puppeteer: "^23.x"` (latest stable).
- `Dockerfile` — add chromium to runner stage, set
  `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH`.
- `apps/api/src/server.ts` — register `sociosFormsRoutes` after
  `socioAttachmentsRoutes` (line ~219). Decorate `app.puppeteer` with the
  launched browser instance. SIGTERM hook closes the browser.
- `apps/api/src/modules/forms/` — NEW folder:
  - `templates/solicitud-inscripcion.ts` — exports the HTML template
    string with `{{tokens}}`.
  - `assets/gorriti-logo.png` — extracted from `/srv/docs/ficha.docx`,
    7551 bytes.
  - `renderer.ts` — pure `renderTemplate(html, vars)` + HTML escape.
  - `puppeteer-pool.ts` — `getPage()` / `releasePage(page)` helpers.
  - `service.ts` — `emitForm(socioId): Promise<Buffer>` orchestrates
    load-socio → render → pdf → audit.
- `apps/api/src/routes/socios-forms.ts` — NEW. The single GET route.
- `packages/audit/src/emitter.ts` — extend the `AuditAction` const-map
  with `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'`. Type-level widening
  is automatic (the const-map pattern).

### Frontend (`apps/web`)

- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — add the
  "Emitir Solicitud" button in the header action cluster (split into
  "always" + "ADMIN" groups).
- `apps/web/src/lib/api/socios.ts` — add `getSocioFormUrl(id: string): string`
  helper that returns the absolute URL for `window.open`.
- No new components / no new tests for the form template (server-side).

### Cross-cutting

- `openspec/specs/audit-logger/spec.md` — delta appended: new
  `SOCIO_FORM_EMITTED` action in the `AuditAction` union, with required
  metadata keys `{ socio_id, form_id, sha256, byte_size }`.
- `openspec/specs/api-design/spec.md` — delta appended: new endpoint
  `GET /api/v1/socios/:id/forms/solicitud-inscripcion`, returning
  `application/pdf` with `Content-Disposition: inline; filename=...`.
- `apps/api/.env.production.example` — add `PUPPETEER_EXECUTABLE_PATH=
  /usr/bin/chromium-browser` (operational note for deploy).

## Approaches considered

### A1: Render PDF in the browser (client-side)

Use a JS PDF library (`jspdf`, `pdfmake`) on the web client. No server
round-trip; no puppeteer; no Dockerfile changes.

- Pros: zero backend work; no chromium; ~500 KB client-side bundle.
- Cons: source-of-truth HTML is duplicated (client template + server
  template); typo fixes have to ship to clients; the audit row can't be
  emitted server-side without a separate POST round-trip; the PDF bytes
  that the audit row hashes are client-controlled (operator can tamper
  with the rendering); logo handling requires a fetch to the logo asset;
  mobile browsers handle large PDFs poorly.
- Effort: Low (frontend-only).
- **REJECTED** — locked decision #2 explicitly says puppeteer; integrity
  of the SHA-256 in the audit row depends on server-side rendering.

### A2: Headless Chromium via Playwright instead of Puppeteer

Same browser, different Node binding.

- Pros: Playwright has better Docker support (`playwright install` is a
  first-class command) and multi-browser parity.
- Cons: One more dep; locked decision #2 says puppeteer.
- Effort: Medium.
- **REJECTED** — locked decision #2.

### A3: puppeteer-core (no bundled chromium) + system chromium in Docker

Same locked decision, smaller `node_modules` (no chromium binary shipped
in the npm package — we install it via `apk` instead).

- Pros: smaller `node_modules` (~20 MB vs ~170 MB); the same binary on
  host + container.
- Cons: `puppeteer-core` is the API-only package; we must point at
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`. Identical
  behaviour for our use case (one `puppeteer.launch({ executablePath })`).
- Effort: Low (substitute dep).
- **RECOMMENDED** as a sub-decision of locked decision #2. Use
  `puppeteer-core` (not `puppeteer`) and ship chromium via `apk`. Same
  final behaviour, less duplication.

### Recommendation

**Approach A3**: `puppeteer-core` + system chromium via Alpine `apk`.
The template engine is simple regex (decision C). The logo is inline
base64 (decision D). The HTML template is committed to the repo as a
single TypeScript string (decision H). The audit row carries the
SHA-256 + byte_size (decision F). The route returns the PDF binary with
`Content-Type: application/pdf` + `Content-Disposition: inline` (decision
H).

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **Image size bloat.** Adding chromium via `apk` adds ~170 MB to the runner image. Pull latency + rebuild time go up. | Medium | Document in `apps/api/.env.production.example`; multi-stage build keeps chromium out of intermediate layers. Future iteration could swap to `@sparticuz/chromium` (a 50 MB Lambda-targeted build) — defer. |
| R2 | **Cold-start latency.** First `page.pdf()` after process restart takes 1.5-2.5s for chromium to init. Operator's first click after a deploy feels slow. | Medium | `puppeteer.launch()` once at `buildServer()` time. Add a warmup call (open + close a dummy page) at boot to amortize the init cost. |
| R3 | **Memory pressure.** Each `page.pdf()` allocates ~50 MB. 10 concurrent operators → ~500 MB resident. Single-node deploy may OOM. | Medium | Cap concurrent pages with a semaphore (`p-queue` or hand-rolled mutex). Default cap: 3 pages. Requests beyond the cap wait; `reply` does NOT 503 (form is best-effort, not user-blocking). |
| R4 | **`/dev/shm` size on Alpine.** Chromium uses `/dev/shm` for shared memory; default 64 MB on Alpine is too small. | High | Launch with `args: ['--disable-dev-shm-usage']` (PUPPETEER_ARGS). Documented in Dockerfile. |
| R5 | **Puppeteer types are loose.** The library's `.d.ts` uses `any` in several places; strict-mode would reject. | Low | Wrap all puppeteer calls behind a typed `renderer.ts` module boundary. Type the return as `Buffer` and the input HTML as `string` at the boundary. |
| R6 | **PDF text fidelity.** Rendering the form via chromium may shift the dotted lines or break a signature-line break. | Medium | Golden-file test: render a known socio, parse the PDF text via `pdf-parse` (or `pdfjs-dist`), assert the titular block contains the expected substrings. |
| R7 | **The .docx has 2 rectangles, not 4** — the prompt stated 4; this exploration flags it. | Low | Both rectangles are at the same coords in the .docx; we render both with the SOCIO Nº field; the ACTA box stays blank with `.................`. Decision to revisit at propose. |
| R8 | **Form date vs DB date mismatch.** `fecha_nac` is on the form but not in the `socios` table. | Medium | Leave BLANK with `..../..../......` for v1 (this exploration's recommendation). Add to propose as an OPEN QUESTION to confirm with the user before locking. |
| R9 | **Helmet plugin + chromium.** The helmet plugin sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` by default; puppeteer can fail to launch under stricter policies. | Low | The helmet config in `apps/api/src/plugins/helmet.ts` is project-tuned — verify by inspection that it doesn't add COOP/COEP, OR add the route to the helmet exemption list (mirroring how `/metrics` is exempted). |
| R10 | **Audit metadata not surfaced in AuditTab.** `queryAudit` in `packages/audit/src/query.ts:80-91` does not select the `metadata` column. The form-emit row will be visible in the timeline but its `byte_size` won't be rendered. | Low | Out of scope for v1. A follow-up change widens the audit query to include metadata. The metadata persists correctly in the DB regardless. |

## Open questions to raise at propose

1. **Rectangles count**: confirm with user that 2 (not 4) is the correct
   count and that both rectangles get the same `numero_socio` value
   (ACTA box stays blank).
2. **`fechaNacimiento`**: confirm that v1 leaves it BLANK. If a future
   column is needed, that becomes a separate schema change.
3. **Filename**: confirm `solicitud-inscripcion_<numero_socio>.pdf`
   matches operator expectations (alternative:
   `solicitud_<apellido>_<nombre>_<dni>.pdf`).
4. **Browser-vs-Download UX**: v1 opens in a new tab via
   `window.open(url, '_blank')`. Confirm a direct download
   (`Content-Disposition: attachment`) is NOT desired.

## Ready for Proposal

**YES.** All locked decisions reconcile against the codebase with two
documented gaps (rectangles count + `fechaNacimiento`) that the propose
phase will surface as open questions. The implementation can proceed as
two stacked PRs:

- **PR A (backend, ~600-900 LoC)**: Dockerfile + puppeteer-core +
  audit const-map extension + template + renderer + service + route +
  tests. **HIGH** LoC; recommend `size:exception` per the SDD workload
  guard.
- **PR B (frontend, ~50-100 LoC)**: button + api wrapper + tests. Well
  within the 400-line budget.

The propose phase should call out the chained/stacked PR delivery and
flag the two open questions above to the user before locking scope.