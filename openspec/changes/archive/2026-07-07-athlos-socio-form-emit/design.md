# Design: Socio Form Emit (PDF inscripción)

**Change**: `athlos-socio-form-emit` | **Phase**: design | **Date**: 2026-07-08
**Spec sources**: `specs/socio-form-emit` (NEW, 14 reqs), `specs/audit-logger` (DELTA, 1 ADDED), `specs/api-design` (DELTA, 1 ADDED), `specs/ui-design` (DELTA, 1 ADDED).
**Stack context**: pnpm 9.15 / TypeScript 5.7 strict / Fastify 5.2 / Drizzle 0.36 / Vitest 2.1 / Next 16 / React 19 / Fastify puppeteer @ 23.x. Strict TDD, 1:1 source:test.
**Style precedent**: archived `athlos-socio-legajo/design.md` (multi-section architecture, contract-first, ASCII data-flow).

---

## 1. Goal + non-goals

Server-render the Club Atlético Gorriti membership inscription form (`/srv/docs/ficha.docx`) as a downloadable PDF from `/socios/[id]`, pre-filled with the titular's data from the `socios` table. The PDF mirrors the .docx layout (header with logo + club data, 40+ field body, FESCAG regulation at the end) and uses headless Chromium (puppeteer) to render HTML to A4. Cadete + presentante + ACTA Nº + signature lines are left blank for handwritten completion at the club. Each successful emission records an immutable `audit_event` carrying the PDF's SHA-256 hash and byte size.

**Non-goals**:
- No backfilling `fecha_nacimiento` for existing socios (column is NULL allowed; v1 renders blank).
- No other forms beyond `solicitud-inscripcion` (the module folder is structured to accept more later).
- No `<iframe>` embedded PDF preview — `window.open(url, '_blank', 'noopener,noreferrer')` only.
- No PDF caching (each emission is fresh; the audit row carries the SHA-256 for verifiability).
- No CSRF protection beyond the existing JWT auth (the endpoint is GET, but the audit row IS emitted).

## 2. Architecture overview

```
   Browser tab                    Fastify                         Chromium headless
       │   click "Emitir           │                                    │
       │   Solicitud"              │                                    │
       │   window.open(url)        │                                    │
       ├──────────────────────────►│ GET /api/v1/socios/:id/forms/      │
       │                           │   solicitud-inscripcion.pdf        │
       │                           │   preHandler: requireAuth()        │
       │                           │                                    │
       │                           │  ┌──────────────────────────────┐  │
       │                           │  │ apps/api/.../forms/emit-form │  │
       │                           │  │   1. socioRepo.findById       │  │
       │                           │  │   2. filename.ts              │  │
       │                           │  │   3. renderTemplate(...)      │  │
       │                           │  │   4. semaphore.acquire(       │──┼──────► page.pdf(A4)
       │                           │  │        page.setContent(html)  │  │       (50 MB resident)
       │                           │  │        page.pdf({...}))       │  │
       │                           │  │   5. crypto.createHash(sha256)│  │
       │                           │  │   6. emitAudit(metadata)      │  │
       │                           │  │   7. semaphore.release        │  │
       │                           │  └──────────────────────────────┘  │
       │                           │                                    │
       │   Content-Type:           │  ┌──────────────────────────────┐  │
       │   application/pdf         │  │ puppeteer singleton          │  │
       │   Content-Disposition:    │  │   launched once at boot      │  │
       │   inline; filename="..."  │  │   SIGTERM closes             │  │
       │◄──────────────────────────│  └──────────────────────────────┘  │
```

**Module structure** — NEW `apps/api/src/modules/socios/forms/`:

| File | Role |
|---|---|
| `template-renderer.ts` | Pure `{{var}}` substitution helper with HTML-escape (no extra dep) |
| `pdf-generator.ts` | Puppeteer wrapper with singleton browser + `Semaphore(3)` + `try/finally` release |
| `semaphore.ts` | Hand-rolled FIFO semaphore (counter + queue of resolvers). NO exposed `acquire/release`; `acquire(fn)` runs `fn` and releases in `finally` |
| `filename.ts` | `buildFilename(socio)` returning `solicitud-inscripcion-socio-{N}-{Apellido}.pdf` (sanitized via NFD + non-alphanumeric → `_`) |
| `emit-form.ts` | Service: `loadSocioForForm()` → render → generate → audit. Returns `EmitFormResult` |
| `solicitud-inscripcion.template.ts` | TypeScript string constant exporting the HTML template with `{{var}}` placeholders |
| `solicitud-inscripcion.styles.ts` | TypeScript string constant exporting the CSS (A4 @page + body + `.rect-*` classes) |
| `logo.ts` | TypeScript string constant exporting the base64-encoded PNG (extracted from the .docx at build time, baked into the source) |

**Route** — NEW `apps/api/src/routes/socio-forms.ts`:
- 1 endpoint: `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`
- `preHandler: requireAuth()` (any authenticated operator; no role gate — mirrors `/notes` + `/attachments` precedent)
- Returns `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."`
- 404 SOCIO_NOT_FOUND when the socio row is absent
- 401 UNAUTHORIZED when the JWT is missing

**Audit** — extend `packages/audit/src/emitter.ts` (NB: the const-map lives here, NOT in `actions.ts` — the proposal already corrected this):
- Add `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'` to the `AuditAction` const-map.
- Use the existing `emitAudit()` (from PR 8c.1, already supports `metadata?: Record<string, unknown>`).
- Best-effort: failed audit emission MUST NOT roll back the PDF response.

**Migration** — NEW `packages/db/drizzle/0030_socio_fecha_nacimiento.sql`:
- Hand-written DDL (drizzle pipeline broken in prod per handover #253).
- Apply via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0030_*.sql`.
- Idempotent via `ADD COLUMN IF NOT EXISTS`.

**Schema** — `packages/db/src/schema/socios.ts`:
- Add `fechaNacimiento: date('fecha_nacimiento')` to the `socios` table (Drizzle widening, no `generate`).

**Repository** — `apps/api/src/modules/socios/repository.ts`:
- `findById()` uses `db.select().from(socios)` (no explicit column list) → once the schema widens, `fechaNacimiento` is returned automatically. **No edit needed.**

**Frontend** — NEW `apps/web/src/components/socios/EmitirSolicitudButton.tsx`:
- Stateless button using `lucide-react` `Printer` icon + Secondary variant (`#ffffff` bg, `1px #d4d4d4` border, `ink-700` text — matches Editar/Dar baja).
- On click: `window.open(url, '_blank', 'noopener,noreferrer')` where `url = ${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/solicitud-inscripcion.pdf`.
- After window.open: `notify('success', 'Solicitud emitida')` via the existing wrapper from `athlos-toast-primitivo`.
- Disabled when `socio.direccion` is missing (per ui-design delta R7).

**Client wrapper** — NEW `apps/web/src/lib/api/forms.ts`:
- Pure URL composition helper: `getSocioFormUrl(socioId: string): string` — no fetch, no body.

**Dockerfile** — multi-stage update:
- Builder stage: install `puppeteer` via pnpm; builder does NOT run chromium (skip postinstall via `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`).
- Runner stage: `apk add --no-cache chromium nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1`; env vars `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` + `PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"`.
- Image size impact: +~170 MB (one-time).

## 3. Contracts (TypeScript — source of truth for apply)

```ts
// apps/api/src/modules/socios/forms/emit-form.ts
export interface EmitFormResult {
  pdf: Buffer;
  filename: string;
  sha256: string;
  byteSize: number;
}

export async function emitForm(params: {
  socioId: string;
  operatorId: string;
}): Promise<EmitFormResult>;

// apps/api/src/modules/socios/forms/template-renderer.ts
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string;

// apps/api/src/modules/socios/forms/pdf-generator.ts
export interface PdfGenerator {
  init(): Promise<void>;          // launches browser (idempotent)
  generate(html: string): Promise<Buffer>;  // acquires semaphore, renders, returns
  close(): Promise<void>;
}

export function createPdfGenerator(opts: { maxConcurrent?: number }): PdfGenerator;

// apps/api/src/modules/socios/forms/filename.ts
export function buildFilename(socio: {
  numeroSocio: string | number;
  apellido: string;
}): string;  // returns 'solicitud-inscripcion-socio-{N}-{Apellido-sanitized}.pdf'

// apps/api/src/modules/socios/forms/socio-loader.ts (or repository extension)
export async function loadSocioForForm(socioId: string): Promise<{
  id: string;
  numeroSocio: string;
  nombre: string;
  apellido: string;
  dni: string;
  fechaNacimiento: string | null;  // ISO date string or null
  domicilioCalle: string;
  domicilioNumero: string;
  domicilioBarrio: string;
  telefono: string;
  email: string;
}>;
```

## 4. Template HTML structure — pin exactly

The template is a single TypeScript string constant. `{{var}}` placeholders are substituted by `renderTemplate()`. Layout:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Solicitud de Inscripción</title>
  <style>/* {{styles}} */</style>
</head>
<body>
  <header class="club-header">
    <img class="club-logo" src="data:image/png;base64,{{logoBase64}}" alt="Logo">
    <p class="club-name">CLUB ATLETICO GORRITI</p>
    <p class="club-data">ENTIDAD SIN FINES DE LUCRO FUNDADA EL 10 DE NOVIEMBRE DE 1937...</p>
  </header>

  <main>
    <p class="header-date">SAN SALVADOR DE JUJUY, ...... DE ............... DE ...........</p>

    <div class="numero-fields">
      <div class="field-block">
        <span class="field-label">SOCIO Nº:</span>
        <span class="field-value">{{numeroSocio}}</span>
      </div>
      <div class="field-block">
        <span class="field-label">ACTA Nª:</span>
        <span class="field-value">&nbsp;</span>
      </div>
    </div>

    <p class="destinatario">A LOS SRES. DE LA Nº COMISION DIRECTIVA DEL CLUB ATLETICO GORRITI</p>

    <p class="intro">SU / DESPACHO EL / LA que suscribe ...........................................................................</p>

    <p class="identificacion">
      D.N.I. Nº <span class="dotted-line">{{dni}}</span>
      FECHA DE NACIMIENTO <span class="dotted-line">{{fechaNacimiento}}</span>
    </p>

    <p>...resto de los campos auto-filleados o en blanco...</p>

    <p>FECHA: <span class="dotted-line">&nbsp;</span></p>

    <!-- Sección cadete + presentante (en blanco) -->

    <!-- FESCAG reglamento al final -->
  </main>
</body>
</html>
```

## 5. CSS structure — pin exactly

```css
@page {
  size: A4;
  margin: 25mm 30mm;
}

body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.3; }

.club-header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 8mm; }
.club-logo { float: left; width: 25mm; height: 25mm; margin-right: 3mm; }
.club-name { font-weight: bold; font-size: 12pt; margin: 0; }
.club-data { font-size: 8pt; margin: 2mm 0 0 0; }

.header-date { text-align: right; margin-top: 5mm; }
.numero-fields { display: flex; justify-content: space-between; margin: 5mm 0; }
.field-label { font-weight: bold; }
.dotted-line {
  display: inline-block;
  min-width: 60mm;
  border-bottom: 1px dotted #000;
  text-align: center;
}

.fescag-section {
  margin-top: 15mm;
  padding-top: 5mm;
  border-top: 1px solid #000;
  font-size: 9pt;
  text-align: justify;
}

.rect-acta, .rect-socio { /* The 2 floating rectangles for visual separators */
  position: absolute;
  border: 1px solid #000;
}
.rect-acta { top: 50mm; right: 30mm; width: 60mm; height: 8mm; }
.rect-socio { top: 50mm; left: 30mm; width: 60mm; height: 8mm; }
```

## 6. Puppeteer singleton + semaphore — pin shape

```ts
import puppeteer, { Browser } from 'puppeteer';

let browser: Browser | null = null;
let initPromise: Promise<void> | null = null;

const semaphore = new Semaphore(3);

class PdfGenerator {
  async init(): Promise<void> {
    if (browser) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
      });
    })();
    return initPromise;
  }

  async generate(html: string): Promise<Buffer> {
    await this.init();
    if (!browser) throw new Error('puppeteer not initialized');
    return semaphore.acquire(async () => {
      const page = await browser!.newPage();
      try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        return await page.pdf({ format: 'A4', printBackground: true });
      } finally {
        await page.close();
      }
    });
  }

  async close(): Promise<void> {
    if (browser) {
      await browser.close();
      browser = null;
    }
  }
}
```

The `Semaphore` implementation uses a queue of resolvers + a counter. `acquire(fn)` runs `fn` when a slot is available and releases the slot in `finally`. NO manual `acquire()` / `release()` exposed — the closure owns the lifecycle so a `try/finally` leak is impossible.

## 7. Audit metadata — pin exactly

```ts
{
  socio_id: string,         // UUID
  form_id: 'solicitud-inscripcion',
  sha256: string,           // hex (lowercase, 64 chars)
  byte_size: number,        // bytes (integer)
}
```

`emitAudit()` call shape:
```ts
await emitAudit(db, {
  operatorId: params.operatorId,
  action: 'SOCIO_FORM_EMITTED',
  entityType: 'socio',
  entityId: params.socioId,
  oldValue: null,
  newValue: null,
  sourceIp: null,
  payload: { socioId: params.socioId, sha256: result.sha256, byteSize: result.byteSize },
  metadata: {
    socio_id: params.socioId,
    form_id: 'solicitud-inscripcion',
    sha256: result.sha256,
    byte_size: result.byteSize,
  },
});
```

Wrapped in `try/catch` — a throw becomes a `console.error` and the PDF still returns 200.

## 8. Filename sanitization — pin exactly

```ts
function sanitizeApellido(apellido: string): string {
  return apellido
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, '_')                    // non-alphanumeric → _
    .replace(/^_|_$/g, '')                             // trim _
    .toUpperCase();
}
```

Examples:
- `Pérez` → `PEREZ`
- `O'Brien` → `O_BRIEN`
- `García López` → `GARCIA_LOPEZ`

## 9. Migration SQL — pin exactly

```sql
-- packages/db/drizzle/0030_socio_fecha_nacimiento.sql
ALTER TABLE socios ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
```

## 10. File diff list (source of truth for apply)

**NEW (production + tests):**
- `apps/api/src/modules/socios/forms/template-renderer.ts` + `template-renderer.test.ts`
- `apps/api/src/modules/socios/forms/pdf-generator.ts` + `pdf-generator.test.ts`
- `apps/api/src/modules/socios/forms/semaphore.ts` + `semaphore.test.ts`
- `apps/api/src/modules/socios/forms/filename.ts` + `filename.test.ts`
- `apps/api/src/modules/socios/forms/emit-form.ts` + `emit-form.test.ts`
- `apps/api/src/modules/socios/forms/solicitud-inscripcion.template.ts`
- `apps/api/src/modules/socios/forms/solicitud-inscripcion.styles.ts`
- `apps/api/src/modules/socios/forms/logo.ts`
- `apps/api/src/routes/socio-forms.ts` + `socio-forms.test.ts`
- `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` (hand-written)
- `apps/web/src/components/socios/EmitirSolicitudButton.tsx` + `EmitirSolicitudButton.test.tsx`
- `apps/web/src/lib/api/forms.ts` + `forms.test.ts`

**EDITED:**
- `apps/api/package.json` (add `puppeteer`)
- `Dockerfile` (multi-stage update — chromium + libs + env vars)
- `apps/api/src/server.ts` (register `socioFormsRoutes`)
- `apps/api/src/modules/socios/repository.ts` — **no edit needed** (uses `select()` → `fechaNacimiento` returned automatically once schema widens)
- `packages/db/src/schema/socios.ts` (add `fechaNacimiento: date('fecha_nacimiento')`)
- `packages/audit/src/emitter.ts` (add `SOCIO_FORM_EMITTED` to `AuditAction` const-map) — NB: this is the actual file; the original task brief said `actions.ts` but the const-map lives in `emitter.ts` per the proposal #313 correction
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` (wire the button in the header action cluster BEFORE the ADMIN group)

## 11. Testing strategy

| Layer | File | What to test |
|---|---|---|
| Unit | `template-renderer.test.ts` | `{{var}}` substitution; missing variable → `''`; HTML escape (`<`, `>`, `&`, `"`); idempotency (no token left unsubstituted) |
| Unit | `filename.test.ts` | Sanitization edge cases: `Pérez` → `PEREZ`; `O'Brien` → `O_BRIEN`; `García López` → `GARCIA_LOPEZ`; empty → `''`; only-special-chars → `''`; uppercase pass |
| Unit | `semaphore.test.ts` | 3 concurrent tasks succeed; 4th waits; release in `finally` on error; FIFO order; counter resets on close |
| Unit | `pdf-generator.test.ts` | Mock puppeteer; assert `setContent(html, { waitUntil: 'networkidle0' })` + `page.pdf({ format: 'A4', printBackground: true })`; assert `page.close()` in `finally` even on error; init idempotency |
| Integration | `emit-form.test.ts` (service) | Full flow with mocked deps: load socio → render → generate → audit; audit row carries exact 4 metadata keys + 64-char hex sha256 + positive int byte_size; best-effort: failed audit still returns result |
| Integration | `socio-forms.test.ts` (route) | 200 + `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."`; 401 missing JWT; 404 unknown socioId; filename sanitization end-to-end |
| Component | `EmitirSolicitudButton.test.tsx` | Click handler calls `window.open` with exact URL + `'_blank'` + `'noopener,noreferrer'`; disabled when `direccion` missing; toast on success |
| Unit | `forms.test.ts` (client) | `getSocioFormUrl(socioId)` returns exact URL with API base |
| **Golden-file** | `golden-pdf.test.ts` (in `forms/`) | Emit a known socio fixture → parse PDF via `pdf-parse` → assert substrings (`apellido + ", " + nombre`, `dni`, `numeroSocio`, FESCAG footer); second emission with same input produces equivalent text (proves determinism) |

**Note on `pdf-parse`**: must be a dev dependency (it's a runtime dep of the test only, never imported by production code). Add as `devDependencies` in `apps/api/package.json`.

## 12. PR shape

**Total ~800-1200 LoC across 2 PRs.**

### PR A — backend (single PR, 700-800 LoC, likely `size:exception`)

| Commit | Scope | ~LoC |
|---|---|---|
| A.1 | Migration `0030_socio_fecha_nacimiento.sql` + schema widening (`fechaNacimiento` column) | 40 |
| A.2 | `AuditAction` const-map extension (`SOCIO_FORM_EMITTED`) | 20 |
| A.3 | `semaphore.ts` + `template-renderer.ts` + `filename.ts` + tests (pure helpers, no puppeteer yet) | 150 |
| A.4 | `solicitud-inscripcion.template.ts` + `solicitud-inscripcion.styles.ts` + `logo.ts` (string constants) | 200 |
| A.5 | `pdf-generator.ts` + tests (mocked puppeteer) | 100 |
| A.6 | `emit-form.ts` + tests (orchestration + audit emission) | 150 |
| A.7 | `socio-forms.ts` route + tests (200/401/404 + Content-Disposition) | 100 |
| A.8 | Dockerfile multi-stage update + `package.json` puppeteer dep | 30 |
| A.9 | Golden-file test (`pdf-parse` substring assertions) | 80 |

**Likely needs `size:exception`** at the upper end of the budget; recommend **NOT splitting** because the 9 commits are tightly coupled (the golden-file test only runs once all of A.4–A.7 are merged). Alternative: split into A1+A2+A3+A8 (deps + helpers + schema, 250 LoC, review-friendly) + A4+A5+A6+A7+A9 (render + generate + route + golden, 630 LoC, `size:exception`).

### PR B — frontend (single PR, 80-120 LoC)

| Commit | Scope | ~LoC |
|---|---|---|
| B.1 | `lib/api/forms.ts` + `forms.test.ts` (URL helper) | 20 |
| B.2 | `EmitirSolicitudButton.tsx` + `EmitirSolicitudButton.test.tsx` | 60 |
| B.3 | Wire button in `page.tsx` header (split action cluster into "always" + "ADMIN" groups; 1 px `ink-100` divider) | 30 |

**No chained PRs.** Single PR within the 400-line budget.

## 13. Rollback plan

Additive. Reverting removes the new module + route + button. The migration `0030_socio_fecha_nacimiento.sql` is reversible via `ALTER TABLE socios DROP COLUMN fecha_nacimiento`. No audit pollution: `SOCIO_FORM_EMITTED` rows persist in `audit_events` but become orphaned and harmless (the `metadata` JSONB is opaque to other queries).

## 14. Open questions

None. The 4 open questions surfaced at explore (#312) — rectangles count (locked: 2 not 4), `fechaNacimiento` (locked: add column via migration 0030), filename (locked: `solicitud-inscripcion-socio-{N}-{Apellido}.pdf`), UX (locked: `window.open` in new tab) — are all resolved by the orchestrator's locked decisions and codified in the proposal (#313), spec (#314), and deltas (#315). Apply phase has zero ambiguity.