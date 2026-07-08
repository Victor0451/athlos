> Synced from change `athlos-socio-form-emit` (2026-07-07).

# Socio Form Emit Specification

## Purpose

Server-side generation of the Club Atlético Gorriti membership inscription form (`solicitud-inscripcion`) as a downloadable PDF, pre-filled with the titular's data from the `socios` table, and exposed from the Socio Detail page via a single `GET` endpoint. The form mirrors the layout of the source `/srv/docs/ficha.docx` (header with logo + club data, 40+ field body, FESCAG regulation at the end) and uses headless Chromium (puppeteer) to render the HTML to A4. Cadete, presentante, acta, and signature fields are left blank for handwritten completion at the club. Each successful emission records an immutable `audit_event` with the PDF's SHA-256 hash and byte size so the bytes can be verified against the audit log in the future. This is the first realization of the dormant `file-storage` spec for the `solicitud-inscripcion` PDF resource.

## Requirements

### Requirement: PDF Endpoint Exposed Under `/api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`

The system SHALL expose `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` returning the form for the given socio. The response Content-Type SHALL be `application/pdf` and the response body SHALL be a well-formed PDF that begins with the literal header `%PDF-`. The endpoint SHALL be registered exactly once in the Fastify app and SHALL live under the `/api/v1` version prefix.

#### Scenario: Happy path returns 200 with a valid PDF

- **WHEN** an authenticated operator calls `GET /api/v1/socios/<socioId>/forms/solicitud-inscripcion.pdf` for a socio that exists and has all titular fields populated
- **THEN** the response status SHALL be `200 OK`
- **AND** the `Content-Type` header SHALL be `application/pdf`
- **AND** the response body SHALL begin with the bytes `25 50 44 46 2D` (`%PDF-`)
- **AND** the response body SHALL be at least 10 KB (multi-page form with logo + body + FESCAG)

#### Scenario: Socio not found returns 404

- **WHEN** an authenticated operator calls the endpoint with a `:socioId` that does not exist in the `socios` table
- **THEN** the response status SHALL be `404 NOT_FOUND`
- **AND** the response body SHALL conform to the `ApiError` envelope with `error: "SOCIO_NOT_FOUND"`
- **AND** NO audit event SHALL be emitted

### Requirement: JWT Authentication Required, No Role Gate

The system SHALL require a valid JWT access token on the form endpoint via the `Authorization: Bearer <token>` header. There SHALL be no role gate — any authenticated operator may emit the form for any socio, matching the precedent set by the `/api/v1/socios/:id/notes` and `/api/v1/socios/:id/attachments/*` routes. Requests missing a valid token SHALL be rejected with `401 UNAUTHORIZED`.

#### Scenario: Missing Authorization header returns 401

- **WHEN** a request is made without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** NO puppeteer page SHALL be opened
- **AND** NO audit event SHALL be emitted

#### Scenario: Any authenticated operator may emit (no role gate)

- **WHEN** an operator with role `OPERADOR` and a valid JWT calls the endpoint
- **THEN** the response status SHALL be `200 OK`
- **AND** the PDF SHALL be returned

### Requirement: Content-Disposition Filename Sanitized for `apellido`

The system SHALL set a `Content-Disposition: inline; filename="solicitud-inscripcion-socio-{N}-{Apellido}.pdf"` response header, where `{N}` is the socio's `numero_socio` (zero-padded to the canonical width the operator sees in the UI) and `{Apellido}` is the socio's `apellido` passed through a sanitization function that (a) strips diacritics (NFD normalize + remove combining marks), (b) replaces any character that is not `[A-Za-z0-9]` with `_`, and (c) collapses runs of `_` to a single `_`. The filename MUST be quoted with double quotes and MUST be ASCII-only.

#### Scenario: Filename for an ASCII apellido

- **WHEN** the endpoint is called for a socio with `numero_socio = 12345` and `apellido = "Perez"`
- **THEN** the `Content-Disposition` header SHALL equal `inline; filename="solicitud-inscripcion-socio-12345-Perez.pdf"`

#### Scenario: Diacritics in apellido are stripped

- **WHEN** the endpoint is called for a socio with `apellido = "Pérez"`
- **THEN** the filename SHALL contain `Perez` (not `Pérez` or `P_rez`)
- **AND** the filename SHALL be valid ASCII

#### Scenario: Apostrophes and other punctuation collapse to underscore

- **WHEN** the endpoint is called for a socio with `apellido = "O'Brien"`
- **THEN** the filename SHALL contain `O_Brien`

#### Scenario: Runs of non-alphanumeric characters collapse to a single underscore

- **WHEN** the endpoint is called for a socio with `apellido = "van  der  Berg"` (multiple spaces)
- **THEN** the filename SHALL contain `van_der_Berg` (single underscore between words, no double underscore)

### Requirement: Form Layout Matches the Source `/srv/docs/ficha.docx`

The system SHALL render the form layout to mirror the source document: (a) a header block containing the Gorriti club data and the official escudo, with the logo positioned top-left, (b) a body block with the titular identity, address, contact, group-family, cadete, presentante, and signature sections, and (c) the FESCAG regulation text appended verbatim at the end. The page setup SHALL be A4 (210mm × 297mm) with 30mm horizontal and 25mm vertical margins. The two floating rectangles from the source `.docx` (Rectángulo 1 = `ACTA Nº` blank, Rectángulo 2 = `SOCIO Nº`) SHALL be rendered as absolutely-positioned bordered text boxes at the source coordinates.

#### Scenario: Form has the Gorriti escudo and club data in the header

- **WHEN** the PDF is parsed via `pdf-parse` and the text of the first page is extracted
- **THEN** the first page SHALL contain the literal text "CLUB ATLETICO GORRITI" (or the canonical header wording from the .docx)
- **AND** the PDF SHALL embed an image (the logo, base64-decoded from the inline data URI)

#### Scenario: FESCAG regulation appears at the end of the document

- **WHEN** the PDF is parsed via `pdf-parse` and the text of the last page is extracted
- **THEN** the last page SHALL contain the literal text "FESCAG"
- **AND** the last page SHALL contain at least one of the FESCAG article headings (e.g., "ART. 1" or "ARTICULO 1")

#### Scenario: Two rectangles render at the same coordinates

- **WHEN** the rendered HTML is inspected via the headless browser DOM (test-only)
- **THEN** exactly two elements with class `rect-acta` and `rect-socio` SHALL exist
- **AND** both SHALL carry `position: absolute` with the same `left` / `top` / `width` / `height` values

### Requirement: Titular Fields Auto-Filled From the Socio

The system SHALL auto-fill the titular fields of the form from the socio record as follows:

| Form token | DB column | Notes |
|---|---|---|
| `{{titular_nombre}}` | `apellido + ", " + nombre` | Body identity line + FESCAG acceptance |
| `{{dni}}` | `dni` | Body DNI line + FESCAG acceptance |
| `{{numero_socio}}` | `numero_socio` | Rectángulo 2 (SOCIO Nº) + body "como SOCIO:…" line |
| `{{fecha_nacimiento}}` | `fecha_nacimiento` (DATE, may be NULL) | Body "FECHA DE NACIMIENTO…" line — blank if NULL |
| `{{domicilio_calle}}` | `direccion` | CALLE field of DOMICILIO PARTICULAR (full string) |
| `{{domicilio_telefono}}` | `telefono` | TELEF field of DOMICILIO PARTICULAR |
| `{{email}}` | `email` | CORREO ELECTRONICO DEL TITULAR |
| `{{fecha_emision}}` | server `today` formatted `DD/MM/YYYY` | FESCAG "San Salvador de Jujuy, …" line |

The `{{var}}` substitution helper SHALL HTML-escape every value before injection. Address fields with no column (Nº, BARRIO, DOMICILIO LABORALES, OTROS checkboxes) SHALL render blank with the original dotted-line placeholders intact.

#### Scenario: All titular fields populate when present

- **WHEN** a socio has `nombre = "Juan"`, `apellido = "Pérez"`, `dni = "12345678"`, `numero_socio = 12345`, `fecha_nacimiento = "1990-04-15"`, `direccion = "Av. Forestal 1500"`, `telefono = "388-1234567"`, `email = "juan@example.com"`
- **THEN** the rendered PDF text SHALL contain `Pérez, Juan`
- **AND** SHALL contain `12345678`
- **AND** SHALL contain `12345`
- **AND** SHALL contain `15/04/1990`
- **AND** SHALL contain `Av. Forestal 1500`
- **AND** SHALL contain `388-1234567`
- **AND** SHALL contain `juan@example.com`

#### Scenario: HTML special characters in values are escaped

- **WHEN** a socio has `nombre = "<script>"` and `apellido = "Smith & Jones"`
- **THEN** the rendered HTML SHALL contain `&lt;script&gt;` and `Smith &amp; Jones`
- **AND** the rendered PDF SHALL display `<script>` and `Smith & Jones` as literal text (not as markup)

#### Scenario: Address fields with no column render blank with dotted placeholder

- **WHEN** a socio has `direccion = "Av. Forestal 1500"` but no split columns for `Nº` or `BARRIO` exist
- **THEN** the `Nº` field SHALL render the original `....` dotted placeholder
- **AND** the `BARRIO` field SHALL render the original `....` dotted placeholder
- **AND** the entire `direccion` string SHALL appear in the `CALLE` field

### Requirement: Cadete, Presentante, Acta, and Today's Date Left Blank

The system SHALL render the cadete block (autorizante + cadete + signature lines), the presentante fields (`SOCIO PRESENTANTE Nº: …` × 2), the `ACTA Nº` rectangle, and the operator's "today" date in the form header as blank (original `…` placeholders intact) so the operator can fill them by hand at the club.

#### Scenario: Cadete block is blank

- **WHEN** the PDF is parsed via `pdf-parse`
- **THEN** the cadete section SHALL contain only dotted placeholders and NO socio data
- **AND** the cadete autorizante line ("YO PADRE / MADRE…") SHALL be empty

#### Scenario: Presentante fields are blank

- **WHEN** the PDF is parsed via `pdf-parse`
- **THEN** the two `SOCIO PRESENTANTE Nº: …` lines SHALL be empty
- **AND** the presentante signature lines SHALL be empty

#### Scenario: ACTA Nº rectangle is blank

- **WHEN** the rendered HTML is inspected via the headless browser DOM
- **THEN** the element with class `rect-acta` SHALL NOT contain the `numero_socio` value
- **AND** it SHALL contain the dotted placeholder `.................`

#### Scenario: Today's date in the header is left blank for handwritten completion

- **WHEN** the PDF is rendered at any time
- **THEN** the FESCAG "San Salvador de Jujuy, …" line SHALL contain the server `today` formatted as `DD/MM/YYYY`
- **AND** the standalone date field in the form's top header (separate from the FESCAG acceptance block) SHALL render as blank dotted placeholders

### Requirement: Puppeteer Singleton With Stable Launch Args

The system SHALL use puppeteer with a single browser instance reused across requests. The browser SHALL be launched once at `buildServer()` time and held on a Fastify decorator. The launch arguments SHALL be exactly `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']` so the binary is compatible with the Alpine-based Docker runner. A SIGTERM/SIGINT hook SHALL close the browser cleanly so chromium does not leak file descriptors across restarts.

#### Scenario: Browser instance is reused across requests

- **WHEN** two sequential requests are made to the form endpoint
- **THEN** both requests SHALL use the same browser instance (verified via a shared `process.pid` / browser WS endpoint)
- **AND** a `new Browser()` SHALL NOT be created per request

#### Scenario: Launch args are pinned to the Alpine-friendly triple

- **WHEN** the puppeteer browser is launched
- **THEN** the launch args SHALL contain exactly `--disable-dev-shm-usage`, `--no-sandbox`, and `--disable-setuid-sandbox`
- **AND** no other args SHALL be added by the application

#### Scenario: SIGTERM closes the browser

- **WHEN** the process receives `SIGTERM`
- **THEN** the puppeteer browser SHALL be closed before the process exits
- **AND** no chromium child process SHALL remain

### Requirement: Concurrent `page.pdf()` Calls Capped at 3 via Semaphore

The system SHALL cap the number of concurrent `page.pdf()` calls at 3 via a hand-rolled semaphore. Requests beyond the cap SHALL wait in a queue and SHALL be served in FIFO order. The 11th concurrent request SHALL NOT OOM the process; the cap exists to bound resident memory at ~150 MB for in-flight pages (3 × ~50 MB).

#### Scenario: Three concurrent requests are served in parallel

- **WHEN** three requests arrive within 100 ms of each other
- **THEN** all three SHALL enter the `page.pdf()` stage simultaneously
- **AND** all three SHALL complete with `200 OK`

#### Scenario: Fourth request waits for a slot

- **WHEN** four requests arrive within 100 ms
- **THEN** the first three SHALL enter the `page.pdf()` stage
- **AND** the fourth SHALL wait (in a queue) until one of the first three completes
- **AND** the fourth SHALL then acquire a slot and proceed
- **AND** the fourth SHALL complete with `200 OK` (NOT `503`)

#### Scenario: Semaphore releases on error

- **WHEN** a `page.pdf()` call throws (e.g., chromium crashes)
- **THEN** the semaphore slot SHALL be released via `try/finally`
- **AND** the next queued request SHALL proceed

### Requirement: `SOCIO_FORM_EMITTED` Audit Event With Exact Metadata

The system SHALL emit exactly one `audit_event` row per successful PDF emission, via `emitAudit()` from `@athlos/audit/emitter`, with `action = "SOCIO_FORM_EMITTED"`, `entity_type = "socio"`, `entity_id = <socioId>`, `operator_id = <caller.sub>`, and `metadata` containing exactly the four keys:

| Key | Type | Value |
|---|---|---|
| `socio_id` | string (UUID) | The socio whose form was emitted |
| `form_id` | string literal | `"solicitud-inscripcion"` |
| `sha256` | string (64-char hex) | SHA-256 of the PDF bytes |
| `byte_size` | number (positive int) | `Buffer.byteLength(pdfBuffer)` |

Audit emission is best-effort — a failed `emitAudit()` insert MUST NOT roll back the PDF response (the operator has the PDF; the audit is an integrity record).

#### Scenario: Audit row is created with exact metadata on successful emission

- **WHEN** a successful PDF emission completes for `socioId = "uuid-..."`
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_FORM_EMITTED"` and `entity_id = "uuid-..."`
- **AND** `metadata` SHALL be a JSON object containing exactly the keys `socio_id`, `form_id`, `sha256`, `byte_size` (no more, no less)
- **AND** `metadata.socio_id` SHALL equal `"uuid-..."`
- **AND** `metadata.form_id` SHALL equal `"solicitud-inscripcion"`
- **AND** `metadata.sha256` SHALL be a 64-character hex string
- **AND** `metadata.byte_size` SHALL be a positive integer equal to `Buffer.byteLength(pdfBuffer)`

#### Scenario: SHA-256 is computed in the same pass as the response

- **WHEN** the PDF is generated
- **THEN** the SHA-256 of the bytes sent to the response SHALL equal `metadata.sha256` byte-for-byte
- **AND** recomputing SHA-256 over the response body (test-side) SHALL yield the same hash

#### Scenario: Failed audit emission does not roll back the response

- **WHEN** the PDF is generated successfully but the `emitAudit()` call throws
- **THEN** the API response SHALL still be `200 OK` with the PDF bytes
- **AND** a single warning log line SHALL mention the failed audit emission

### Requirement: SHA-256 Hash of the PDF Bytes

The system SHALL compute the SHA-256 hash of the PDF buffer in the same pass as the response (no double-read of the buffer). The hash SHALL be a 64-character lowercase hex string persisted into the audit `metadata.sha256` key.

#### Scenario: Hash format is 64-char lowercase hex

- **WHEN** the PDF is generated
- **THEN** `metadata.sha256` SHALL match the regex `^[0-9a-f]{64}$`
- **AND** recomputing SHA-256 over the buffer SHALL yield the identical value

#### Scenario: Hash is recomputable from the response body

- **WHEN** a test client downloads the response body and computes `crypto.createHash('sha256').update(body).digest('hex')`
- **THEN** the result SHALL equal the `metadata.sha256` value in the corresponding audit row

### Requirement: `fecha_nacimiento DATE NULL` Column on `socios`

The system SHALL add a `fecha_nacimiento` column to the `socios` table as `DATE` with NULL allowed. The column SHALL be added via the hand-written migration `packages/db/drizzle/0030_socio_fecha_nacimiento.sql`, applied via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0030_*.sql` (the Drizzle pipeline is broken in prod; the SQL file is the source of truth, not a Drizzle generate). The Drizzle schema definition at `packages/db/src/schema/socios.ts` SHALL also declare `fechaNacimiento: date('fecha_nacimiento')` so the TypeScript layer compiles.

#### Scenario: Migration applies idempotently

- **WHEN** `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` is applied twice to the same database
- **THEN** the second application SHALL be a no-op (the migration uses `ADD COLUMN IF NOT EXISTS` semantics)
- **AND** the column `socios.fecha_nacimiento` SHALL exist with type `DATE`
- **AND** existing rows SHALL retain `fecha_nacimiento = NULL`

#### Scenario: Column is nullable in the schema

- **WHEN** a new socio is inserted via the Drizzle ORM with no `fechaNacimiento` value
- **THEN** the insert SHALL succeed
- **AND** the resulting row SHALL have `fecha_nacimiento IS NULL`

### Requirement: `fecha_nacimiento` NULL Renders Blank in the PDF

The system SHALL render the `FECHA DE NACIMIENTO` field in the PDF as blank (the original `..../..../......` placeholder) when the socio's `fecha_nacimiento` column is `NULL`. When the column is non-NULL, the field SHALL render the date in `DD/MM/YYYY` format.

#### Scenario: NULL fecha_nacimiento renders blank

- **WHEN** the endpoint is called for a socio whose `fecha_nacimiento` column is `NULL`
- **THEN** the rendered PDF text SHALL contain the dotted placeholder pattern `..../..../......` at the `FECHA DE NACIMIENTO` position
- **AND** SHALL NOT contain any date string at that position

#### Scenario: Non-NULL fecha_nacimiento renders DD/MM/YYYY

- **WHEN** the endpoint is called for a socio whose `fecha_nacimiento` column is `1990-04-15`
- **THEN** the rendered PDF text SHALL contain `15/04/1990` at the `FECHA DE NACIMIENTO` position

### Requirement: Multi-Stage `Dockerfile` Ships Chromium in the Runner

The system SHALL ship a multi-stage `Dockerfile` that (a) installs `puppeteer` (npm) in the builder stage, (b) copies only the `node_modules/.pnpm/puppeteer*` artifacts plus the chromium binary to the runner stage, and (c) installs the system libraries chromium needs via `apk add --no-cache chromium nss freetype harfbuzz ttf-freefont cairo pango libintl libssl1.1` in the runner stage. The runner SHALL set the env vars `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` so the API uses the system chromium, not the npm-bundled one.

#### Scenario: Builder stage does not run chromium postinstall

- **WHEN** the builder stage runs `pnpm install`
- **THEN** the puppeteer postinstall script SHALL be skipped (`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` is set)
- **AND** the chromium binary SHALL NOT be downloaded into `node_modules`

#### Scenario: Runner stage ships chromium and the runtime libs

- **WHEN** the runner image is built
- **THEN** `/usr/bin/chromium-browser` SHALL exist and be executable
- **AND** the `apk` packages listed above SHALL be installed

#### Scenario: Runtime env vars are set in the runner

- **WHEN** the API container starts
- **THEN** `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` SHALL equal `true`
- **AND** `PUPPETEER_EXECUTABLE_PATH` SHALL equal `/usr/bin/chromium-browser`

### Requirement: Golden-File Test Renders a Known Socio Twice and Asserts PDF Text

The system SHALL ship a golden-file test that (a) calls the emit service twice for a known socio fixture, (b) parses the resulting PDF bytes via `pdf-parse`, and (c) asserts the extracted text contains the expected substrings (socio name, DNI, numeroSocio, formatted fecha_nacimiento if present). The test SHALL pass deterministically — same input → same rendered text — so visual regressions are caught by CI.

#### Scenario: Two emissions with the same input produce equivalent text

- **WHEN** the emit service is called twice with the same socio fixture
- **THEN** both PDFs SHALL parse to text containing the socio's name, DNI, and numeroSocio
- **AND** the substring count for each expected field SHALL match between the two emissions

#### Scenario: Golden-file assertions cover the required fields

- **WHEN** the golden-file test runs
- **THEN** the assertions SHALL cover at minimum: `apellido + ", " + nombre`, `dni`, `numero_socio`, and the FESCAG footer text
- **AND** the test SHALL fail if any required field is missing from the rendered text

## Success Criteria

- [ ] Endpoint `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` returns a valid PDF (Content-Type `application/pdf`, body starts with `%PDF-`) for the happy path.
- [ ] All titular fields (`nombre`, `apellido`, `dni`, `numeroSocio`, `fechaNacimiento`, `direccion`, `telefono`, `email`) auto-fill from the socio record.
- [ ] Cadete, presentante, ACTA Nº, and the header "today" date render blank with dotted placeholders.
- [ ] Filename is `solicitud-inscripcion-socio-{N}-{Apellido}.pdf` with `apellido` sanitized (diacritics stripped, non-alphanumeric → `_`).
- [ ] JWT required; no role gate; missing token → 401.
- [ ] `Content-Disposition: inline; filename="..."` with the sanitized filename.
- [ ] Puppeteer browser is a singleton with the three Alpine-friendly launch args.
- [ ] Semaphore caps concurrent `page.pdf()` calls at 3; the 4th request waits.
- [ ] `SOCIO_FORM_EMITTED` audit event emitted with exact metadata `{ socio_id, form_id, sha256, byte_size }`.
- [ ] SHA-256 of the PDF bytes is computed in the same pass as the response and persisted into the audit row.
- [ ] `fecha_nacimiento` column is `DATE NULL` on `socios`; NULL values render blank in the PDF.
- [ ] Multi-stage `Dockerfile` ships chromium in the runner via `apk` and sets `PUPPETEER_EXECUTABLE_PATH`.
- [ ] Golden-file test asserts the rendered PDF text contains the expected substrings (name, DNI, numeroSocio, FESCAG footer).
- [ ] Migration `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` is hand-written and applied via `docker exec psql`.
- [ ] 1:1 source:test file ratio for all new files; `pnpm typecheck` + `pnpm lint` clean; full web + API test suites pass.
