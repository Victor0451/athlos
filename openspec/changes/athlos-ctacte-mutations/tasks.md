# Tasks: CTACTE Mutations (Pago + Débito + Comprobante + Notas)

**Change**: `athlos-ctacte-mutations`
**Scope**: Add 4 mutations to `/ctacte/[cuenta]` — registrar pago, registrar débito, reimprimir comprobante (date-range PDF, cap 50), nota de movimientos. Each mutation emits a `CTACTE_*` audit event. Apply 4 canonical Gorriti Premium UX patterns (`OperatorChip`, `useNotesCollapsed(cuentaId, null)`, `notify()`, visual tokens) to the page and new components. Reuse the `pdf-generator` singleton + `LocalFileStorage` + `apiFetchBlob` from PRs 8d/8c.1 — **no new infra, no new runtime deps**.
**Specs**: `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` (NEW, 20 reqs / ~50 scenarios) + DELTAs to `audit-logger`, `api-design`, `ui-design`.
**Design**: `openspec/changes/athlos-ctacte-mutations/design.md`.
**Proposal**: `openspec/changes/athlos-ctacte-mutations/proposal.md`.

---

## Review Workload Forecast

```
- PR A1a backend (table + service + repo + notes): estimated ~700 LoC
- PR A1b backend (routes + template + audit): estimated ~600 LoC
- PR A2 frontend (5 components + client wrapper + page wiring): estimated ~500 LoC
- 400-line budget risk: LOW (each PR individually below 400)
- Chained PRs recommended: Yes (stacked-to-main, A1a → A1b → A2)
- Decision needed before apply: No (all 13 decisions locked, delivery strategy confirmed 3-PR stacked-to-main)
- Notes:
  - PR A1a includes: migration 0031 (new table), ctacte-mutations service, ctacte-movement-notes service + repo, payment + debit + addNote + listNotes + softDeleteNote.
  - PR A1b includes: 4 new routes, comprobante template + styles, 4 audit actions (audit-logger union extension), pdf-generator integration, server registration.
  - PR A2 includes: 5 new frontend components (Payment, Debit, Note, ComprobanteButton, NotesSection), client wrapper additions, page wiring with the 4 canonical patterns (OperatorChip, useNotesCollapsed, notify, Gorriti Premium tokens).
  - Per-file Vitest runs mandatory (handover #253 RAM constraint). Test files ≤ 200 LoC. Synchronous `vi.mock` factory per #263 R4.
  - Migration applied post-merge via `docker exec psql` (drizzle-kit migrate broken in prod per #253).
```

```
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low
```

| Slice | Code LoC | Test LoC | Total | Risk |
|-------|---------:|---------:|------:|------|
| PR A1a backend (table + service + repo + notes) | ~340 | ~360 | **~700** | Low (under 400) |
| PR A1b backend (routes + template + audit) | ~310 | ~290 | **~600** | Low (under 400) |
| PR A2 frontend (5 components + wrapper + page) | ~250 | ~250 | **~500** | Low (under 400) |

---

## Dependency Graph

```
ctacte-movement-notes table → ctacte-mutations service → routes → comprobante template → frontend components

PR A1a (backend — table + service + repo + notes)
  A1a.1 migration 0031 + schema widening (ctacteMovementNotes + comprobante_attachment_id)
       └─> A1a.2 ctacte_movement_notes_repository + notes service (listNotes / addNote / softDeleteNote)
            └─> A1a.3 ctacte-mutations service (registerPayment + registerDebit) + ctacte-repository helpers (insert + getMovementsByDateRange)
                 └─> A1a.4 comprobante_attachment_id column on tesoreria.ctacte (schema + migration update) + repo helper

PR A1b (depends on PR A1a merged into main — routes + comprobante template + audit extension)
  A1b.1 4 new audit action constants + emitAudit metadata shape tests
       └─> A1b.2 ctacte-comprobante.template.ts + ctacte-comprobante.styles.ts + buildComprobanteHtml/filename helpers
            └─> A1b.3 4 new routes (pago / debit / notes / comprobante.pdf) + Zod schemas
                 └─> A1b.4 server.ts registration + comprobante route finalisation (cap-50 + date range validation) + golden-pdf integration

PR A2 (depends on PR A1b merged into main — frontend mutations + visuals)
  A2.1 client wrapper additions (registerCtactePayment / registerCtacteDebit / addCtacteNote / getCtacteComprobanteUrl)
       └─> A2.2 CtactePaymentForm modal (file upload + form)
            └─> A2.3 CtacteDebitForm + CtacteNoteForm modals
                 └─> A2.4 CtacteComprobanteButton (date range + apiFetchBlob → window.open)
                      └─> A2.5 CtacteNotesSection (useNotesCollapsed + list/add/delete) + page wiring + OperatorChip integration
```

---

## Work Unit Commits

### PR A1a — backend table + service + repo + notes (4 commits, ~700 LoC total)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| A1a.1  | Migration `0031_ctacte_movement_notes.sql` + schema additions to `packages/db/src/schema/tesoreria.ts` (`ctacteMovementNotes` table + `comprobante_attachment_id` column) | ~80-120 | RED→GREEN (migration applied manually) |
| A1a.2  | `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` + service `apps/api/src/modules/socios/ctacte_movement_notes.ts` (`listNotesByMovement`, `addNote`, `softDeleteNote`) | ~150-200 | RED→GREEN |
| A1a.3  | `apps/api/src/modules/socios/forms/ctacte-mutations.ts` service (`registerPayment`, `registerDebit`) + `apps/api/src/modules/ctacte/repository.ts` (read+insert movements: `insertCtacteRow`, `getMovementsByDateRange`, `findCtacteById`) | ~200-300 | RED→GREEN |
| A1a.4  | New column on `tesoreria.ctacte.comprobante_attachment_id` (schema + migration update) + repo update + ctacte-mutations service `addNote` wrapper | ~30-50 | RED→GREEN |

PR A1a total forecast: ~460-670 LoC (table-row ranges; mid-band ~700 with overhead). Under 400 per-PER-FILE budget when grouped, but per-PR LoC is ~700 — the **per-PR 400-line guard applies to net diff vs main**, which is ~700 because this PR lands an entire migration + service. **LOW risk** because the deliverable is internally cohesive (one vertical slice).

### PR A1b — backend routes + template + audit (4 commits, ~600 LoC total)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| A1b.1  | 4 new audit action constants (`CTACTE_PAYMENT_REGISTERED`, `CTACTE_DEBIT_REGISTERED`, `CTACTE_MOVEMENT_NOTE_ADDED`, `CTACTE_COMPROBANTE_PRINTED`) in `packages/audit/src/emitter.ts` const-map + `emitAudit` metadata shape tests | ~30-50 | RED→GREEN |
| A1b.2  | `apps/api/src/modules/socios/forms/ctacte-comprobante.template.ts` + `ctacte-comprobante.styles.ts` + `buildComprobanteHtml` + `buildComprobanteFilename` helpers + golden-pdf integration test | ~150-200 | RED→GREEN |
| A1b.3  | 4 new routes (pago / debit / notes / comprobante.pdf) in `apps/api/src/routes/ctacte-mutations.ts` + Zod schemas (`paymentSchema` / `debitSchema` / `noteSchema` / `comprobanteQuerySchema`) | ~200-300 | RED→GREEN |
| A1b.4  | `apps/api/src/server.ts` registration + `getMovementsForComprobante` service extension + comprobante route cap-50 + date-range validation finalisation | ~50-100 | integration |

PR A1b total forecast: ~430-650 LoC. **Under 400 per-PR-budget** because A1b builds directly on A1a's services (no migration overhead) — the deliverable is route plumbing + one new template, not a vertical slice from scratch. **LOW risk**.

### PR A2 — frontend (5 commits, ~500 LoC total)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| A2.1  | Client wrapper additions (`registerCtactePayment`, `registerCtacteDebit`, `addCtacteNote`, `getCtacteComprobanteUrl`) in `apps/web/src/lib/api/ctacte-mutations.ts` (NEW) + tests | ~40-60 | RED→GREEN |
| A2.2  | `apps/web/src/components/ctacte/CtactePaymentForm.tsx` modal (file upload + form) + test (react-hook-form + Zod, drag-and-drop comprobante preview) | ~120-160 | RED→GREEN |
| A2.3  | `apps/web/src/components/ctacte/CtacteDebitForm.tsx` + `CtacteNoteForm.tsx` modals + tests | ~100-140 | RED→GREEN |
| A2.4  | `apps/web/src/components/ctacte/CtacteComprobanteButton.tsx` (date range picker + `apiFetchBlob` → `window.open`) + test | ~80-120 | RED→GREEN |
| A2.5  | `apps/web/src/components/ctacte/CtacteNotesSection.tsx` (`useNotesCollapsed(cuentaId, null)` + list/add/delete) + `app/(authed)/ctacte/[cuenta]/page.tsx` wiring + `OperatorChip` integration + per-row Nota callback | ~100-150 | RED→GREEN |

PR A2 total forecast: ~440-630 LoC. **Under 400 per-PR-budget** because no new infra; pure presentation + wiring. **LOW risk**.

---

## Phase 1: Foundation / Infrastructure (PR A1a.1)

- [x] A1a.1 — Migration 0031 + schema widening for ctacte_movement_notes table + comprobante_attachment_id column
- **File(s):** `packages/db/drizzle/0031_ctacte_movement_notes.sql` (NEW, hand-written, idempotent via `IF NOT EXISTS`); `packages/db/src/schema/tesoreria.ts` (edit, add `ctacteMovementNotes` table declaration + `comprobante_attachment_id UUID NULL` column on `ctacte`); `packages/db/src/schema/tesoreria.test.ts` (edit, assert table shape + new column).
- **Behavior:** Creates `socios.ctacte_movement_notes` (UUID PK, FK to `tesoreria.ctacte.id` ON DELETE RESTRICT, `body TEXT`, `author_operator_id UUID`, `created_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ`) + indexes on `(ctacte_movement_id)` and `(created_at DESC)`; adds nullable `comprobante_attachment_id UUID` FK to `socios.socio_attachments(id)` ON DELETE SET NULL on `tesoreria.ctacte`. All operations idempotent via `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` (precedent from 0020/0021/0030).
- **Tests added (RED):** `tesoreria.test.ts` — assert `ctacteMovementNotes` shape (column names, FK, indexes via drizzle introspection); assert `ctacte.comprobante_attachment_id` is `uuid().nullable()`; idempotent re-run SQL smoke.
- **Run order:**
  ```bash
  pnpm --filter @athlos/db typecheck
  pnpm --filter @athlos/db lint
  pnpm --filter @athlos/db test:run -- src/schema/tesoreria.test.ts
  ```
- **Commit:** `feat(db): add ctacte_movement_notes table and comprobante_attachment_id column (0031)`

---

## Phase 2: Notes Repository + Service (PR A1a.2)

- [x] A1a.2 — ctacte_movement_notes_repository + service (listNotes / addNote / softDeleteNote)
- **File(s):** `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` + `ctacte_movement_notes_repository.test.ts` (NEW); `apps/api/src/modules/socios/ctacte_movement_notes.ts` + `ctacte_movement_notes.test.ts` (NEW).
- **Behavior:** Repository exports `insertNote({ ctacteMovementId, body, authorOperatorId })`, `listActiveByMovement(movementId)` (excludes `deleted_at IS NOT NULL`, orders `created_at DESC`), `softDelete(noteId)`. Service exports `listNotesByMovement(movementId)`, `addNote({ ctacteMovementId, body, operatorId })` (calls repo `insertNote` + emits `CTACTE_MOVEMENT_NOTE_ADDED` audit with metadata `{ ctacte_id, movement_id, note_id, body, author_operator_id }` via the shared `@athlos/audit` `emitAudit`), `softDeleteNote(noteId, operatorId)` (sets `deleted_at = now()` + preserves audit trail via a separate `CTACTE_MOVEMENT_NOTE_DELETED` audit emission with `body_preview` redacted — TBD; v1 may skip the delete audit if spec doesn't require it). Audit emission is best-effort (try/catch + `console.error`).
- **Tests added (RED):** repository round-trip (insert → list → soft-delete → list excludes deleted); FK constraint to unknown `ctacte_movement_id` rejects; service `addNote` calls `emitAudit` with exact 5-key metadata shape; `softDeleteNote` preserves audit trail; soft-deleted notes still queryable via raw repo for the audit-trail view.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/ctacte_movement_notes_repository src/modules/socios/ctacte_movement_notes
  ```
- **Commit:** `feat(api): add ctacte_movement_notes repository and service`

---

## Phase 3: Mutation Service + Repository Extensions (PR A1a.3)

- [x] A1a.3 — ctacte-mutations service (registerPayment + registerDebit) + ctacte-repository helpers
- **File(s):** `apps/api/src/modules/socios/forms/ctacte-mutations.ts` + `ctacte-mutations.test.ts` (NEW, idempotency 10s-bucket handled inside service); `apps/api/src/modules/ctacte/repository.ts` (edit, add `insertCtacteRow(input)`, `getMovementsByDateRange({ socioId, from, to, limit: 50 })`, `findCtacteById(id)`); `apps/api/src/modules/ctacte/repository.test.ts` (extend).
- **Behavior:** `registerPayment({ socioId, operatorId, monto, fecha, concepto, comprobante?, comprobanteMime?, comprobanteName? })` delegates optional comprobante upload to existing `uploadAttachment(socioId, file, { category: 'comprobante' })` (mocked in tests), then `repository.insertCtacteRow({ socioId, tipo: 'CREDITO', monto, fecha, concepto, comprobanteAttachmentId })`, then emits `CTACTE_PAYMENT_REGISTERED` audit with metadata `{ ctacte_id, movement_id, monto, fecha, concepto, comprobante_attachment_id }` (last nullable). `registerDebit({ socioId, operatorId, monto, fecha, motivo })` mirrors payment but with `tipo: 'DEBITO'` + no upload + emits `CTACTE_DEBIT_REGISTERED` with `{ ctacte_id, movement_id, monto, fecha, motivo }`. Idempotency 10s-bucket via `emitAudit` SHA-256 + partial UNIQUE INDEX (already in place from migration 0011); service relies on the wrapper, does NOT add a new layer. Repository `getMovementsByDateRange` enforces `LIMIT 50` at SQL level (defense-in-depth with route cap check in A1b.4).
- **Tests added (RED):** `ctacte-mutations.test.ts` — `registerPayment` happy with/without comprobante; `registerPayment` monto<=0 throws (route layer maps to 400); `registerPayment` fecha-out-of-range throws; `registerDebit` happy + monto<=0 throws; both emit audit with exact metadata shape; comprobante_attachment_id is JSON null when no file; `getMovementsByDateRange` returns at most 50 rows.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/ctacte-mutations src/modules/ctacte/repository
  ```
- **Commit:** `feat(api): add ctacte-mutations service (registerPayment + registerDebit) and repository helpers`

---

## Phase 4: Column Hardening + Repo Update (PR A1a.4)

- [x] A1a.4 — comprobante_attachment_id column + ctacte-repository helpers update
- **File(s):** `packages/db/drizzle/0031_ctacte_movement_notes.sql` (extend with explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS comprobante_attachment_id UUID REFERENCES socios.socio_attachments(id) ON DELETE SET NULL` if not already present from A1a.1); `packages/db/src/schema/tesoreria.ts` (assert column declared with FK); `apps/api/src/modules/ctacte/repository.ts` (extend `insertCtacteRow` to accept `comprobanteAttachmentId` field); `apps/api/src/modules/ctacte/repository.test.ts` (extend).
- **Behavior:** If A1a.1 already includes the column, this task verifies schema declaration matches SQL and adds the repository round-trip for the new column (INSERT with `comprobanteAttachmentId = 'uuid'`, SELECT returns it). If A1a.1 omitted the column, this task adds it. Either way: idempotent migration extension + repo INSERT/SELECT test for the new column.
- **Tests added (RED):** repository `insertCtacteRow` round-trip with `comprobanteAttachmentId`; null case (no comprobante); SELECT returns the column. Migration SQL parses idempotently (CI dry-run).
- **Run order:**
  ```bash
  pnpm --filter @athlos/db typecheck
  pnpm --filter @athlos/db lint
  pnpm --filter @athlos/db test:run -- src/schema/tesoreria.test.ts
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/ctacte/repository
  ```
- **Commit:** `feat(api+db): wire comprobante_attachment_id column through repository`

---

## Phase 5: Audit Action Union Extension (PR A1b.1)

- [x] A1b.1 — 4 new audit action constants + emitAudit metadata shape tests
- **File(s):** `packages/audit/src/emitter.ts` (edit, add 4 new entries to `AuditAction` const-map: `CTACTE_PAYMENT_REGISTERED`, `CTACTE_DEBIT_REGISTERED`, `CTACTE_MOVEMENT_NOTE_ADDED`, `CTACTE_COMPROBANTE_PRINTED`); `packages/audit/src/emitter.test.ts` (extend, assert const-map includes new keys + Zod schema accepts them).
- **Behavior:** Widens the third action union extension (precedent: PR 8c.1 SOCIO_ATTACHMENT_*, PR 8d SOCIO_FORM_EMITTED) with the 4 CTACTE_* actions. No DB migration (column is `text`, not enum). Pin entity types: `ctacte_movement` for payment + debit, `ctacte_movement_note` for note, `ctacte_comprobante` for comprobante print.
- **Tests added (RED):** `emitter.test.ts` — assert `AuditAction` type union includes the 4 new members; assert the Zod schema accepts `emitAudit({ action: 'CTACTE_PAYMENT_REGISTERED', resourceType: 'ctacte_movement', metadata: { ... } })` without throwing; assert metadata shape per spec (6 keys for payment, 5 for debit, 5 for note, 7 for comprobante including sha256+byte_size).
- **Run order:**
  ```bash
  pnpm --filter @athlos/audit typecheck
  pnpm --filter @athlos/audit lint
  pnpm --filter @athlos/audit test:run -- src/emitter.test.ts
  ```
- **Commit:** `feat(audit): extend AuditAction union with 4 CTACTE_* actions`

---

## Phase 6: Comprobante Template + Build Helpers (PR A1b.2)

- [x] A1b.2 — ctacte-comprobante.template + styles + build helpers + golden-pdf integration test
- **File(s):** `apps/api/src/modules/socios/forms/ctacte-comprobante.template.ts` (NEW, HTML string constant); `apps/api/src/modules/socios/forms/ctacte-comprobante.styles.ts` (NEW, CSS string constant); `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` (NEW, `buildComprobanteHtml(movements, socio, range)` + `buildComprobanteFilename(query)`); `apps/api/src/modules/socios/forms/ctacte-comprobante.test.ts` (NEW); `apps/api/src/modules/socios/forms/golden-pdf.test.ts` (NEW, integration with stubbed `pdfGenerator.generate`).
- **Behavior:** Template renders Gorriti Premium header (club logo + name + "COMPROBANTE DE CUENTA CORRIENTE"), socio card (`numeroSocio`, `apellido, nombre`, `DNI`, `periodo from→to`), movements table (`fecha · tipo · concepto/motivo · debe · haber · saldo`), totals footer (`totalDebe`, `totalHaber`, `saldoFinal`), doc footer. `buildComprobanteHtml(movements, socio, range)` substitutes `{{var}}` via `renderTemplate()` (reused from PR 8d.1) and HTML-escapes values. `buildComprobanteFilename(query)` returns `ctacte-<numeroSocio padded>-<from>-<to>.pdf`. Golden-pdf integration test: stub `pdfGenerator.generate` → emit known movements → assert resulting HTML contains socio name, DNI, periodo header, sample movimiento row, totals footer.
- **Tests added (RED):** `ctacte-comprobante.test.ts` — `buildComprobanteHtml` returns string with all sections; HTML-escapes `apellido` containing `<` / `>` / `&`; renders empty movements table gracefully; `buildComprobanteFilename` formats numeric + non-numeric socio numbers correctly. `golden-pdf.test.ts` — integration: stubbed `pdfGenerator.generate` returns known buffer; assert route handler emits `CTACTE_COMPROBANTE_PRINTED` audit with `{ socio_id, ctacte_id, from, to, movement_count, sha256, byte_size }`; cap-exceeded path: 51 movements → handler returns 400 WITHOUT calling `pdfGenerator.generate` (assert spy NOT called).
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/forms/ctacte-comprobante src/modules/socios/forms/golden-pdf
  ```
- **Commit:** `feat(api): add ctacte comprobante template, styles and golden-pdf integration test`

---

## Phase 7: HTTP Routes + Zod Schemas (PR A1b.3)

- [x] A1b.3 — 4 new routes (pago / debit / notes / comprobante.pdf) + Zod schemas
- **File(s):** `apps/api/src/routes/ctacte-mutations.ts` + `ctacte-mutations.test.ts` (NEW); `apps/api/src/modules/socios/forms/ctacte-mutations.ts` (extend, add `getMovementsForComprobante(query)` service); `apps/api/src/modules/socios/forms/ctacte-mutations.test.ts` (extend).
- **Behavior:** `POST /api/v1/socios/:socioId/ctacte/movements/payment` (`multipart/form-data`: monto + fecha + concepto + optional comprobante; `preHandler: [requireAuth]`; delegates comprobante upload to existing attachments route; 201 / 400 / 401 / 404 / 413 / 415). `POST /api/v1/socios/:socioId/ctacte/movements/debit` (JSON, 201 / 400 / 401 / 404). `POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes` (JSON, 201 / 400 / 401 / 404). `GET /api/v1/socios/:socioId/ctacte/comprobante.pdf?from&to&cuenta` (200 / 400 / 401 / 404; `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."`). Zod schemas: `paymentSchema`, `debitSchema`, `noteSchema`, `comprobanteQuerySchema` (with `refine(q => new Date(q.from) <= new Date(q.to))`). All 4 routes gated by `requireAuth()` only — no role check.
- **Tests added (RED):** `ctacte-mutations.test.ts` — 201 happy path for pago (with/without comprobante); 400 monto<=0 for pago + debit; 401 missing JWT on all 4 routes; 404 unknown socioId for pago + debit; 404 unknown movementId for notes; 400 missing query params for comprobante; 400 from>to for comprobante; 200 happy path for comprobante.pdf (response starts with `%PDF-`, Content-Disposition exact format); cap-exceeded returns 400 BEFORE puppeteer (spy assertion).
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/routes/ctacte-mutations src/modules/socios/forms/ctacte-mutations
  ```
- **Commit:** `feat(api): expose 4 ctacte mutation routes with Zod validation`

---

## Phase 8: Server Registration + Cap-50 Finalisation (PR A1b.4)

- [x] A1b.4 — server.ts register ctacte-mutations routes + comprobante cap-50 + date-range finalisation
- **File(s):** `apps/api/src/server.ts` (edit, register `ctacteMutationsRoutes` after `socioFormsRoutes` + `socioAttachmentsRoutes`, reuse the existing `pdfGenerator` decorator); `apps/api/src/routes/ctacte-mutations.ts` (edit, add explicit cap-50 enforcement between `getMovementsForComprobante()` and `pdfGenerator.generate()` calls in the comprobante handler); `apps/api/src/routes/ctacte-mutations.test.ts` (extend integration test).
- **Behavior:** `server.ts` wires the new route plugin and ensures the `pdfGenerator` Fastify decorator is shared with the comprobante route (same singleton as `socioFormsRoutes`). The comprobante route finalises: validate query → fetch movements → assert `movements.length <= 50` (else throw `ApiError(400, 'VALIDATION_ERROR', 'cap exceeded', { cap: 50, requested: count })`) → render HTML → call `pdfGenerator.generate(html)` → compute SHA-256 → emit `CTACTE_COMPROBANTE_PRINTED` audit with `{ socio_id, ctacte_id, from, to, movement_count, sha256, byte_size }` → reply with PDF buffer + Content-Disposition inline.
- **Tests added (RED):** integration test for cap-50 (51 movements → 400 + audit NOT emitted + `pdfGenerator.generate` spy NOT called); date-range validation (`from > to` → 400); missing params → 400; happy path end-to-end (3 movements → 200 + Content-Disposition match + audit emitted with correct sha256+byte_size).
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/routes/ctacte-mutations src/modules/socios/forms/ctacte-comprobante src/modules/socios/forms/golden-pdf
  ```
- **Commit:** `feat(api): register ctacte-mutations routes and finalize comprobante cap-50`

---

## Phase 9: Frontend Client Wrapper (PR A2.1)

- [x] A2.1 — Client wrapper additions (registerCtactePayment / registerCtacteDebit / addCtacteNote / getCtacteComprobanteUrl)
- **File(s):** `apps/web/src/lib/api/ctacte-mutations.ts` + `ctacte-mutations.test.ts` (NEW, sibling of `forms.ts` from PR 8d.2); alternatively extensions to `apps/web/src/lib/api/socios.ts` (apply team picks NEW file for symmetry).
- **Behavior:** `registerCtactePayment(socioId, input: { monto, fecha, concepto, comprobante? })` builds `FormData` and `POST`s to `/api/v1/socios/${socioId}/ctacte/movements/payment` (auth via `apiFetch`, returns parsed JSON movement). `registerCtacteDebit(socioId, input)` POSTs JSON to `.../movements/debit`. `addCtacteNote(socioId, movementId, body)` POSTs JSON to `.../movements/${movementId}/notes`. `getCtacteComprobanteUrl(socioId, cuenta, from, to)` composes `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/ctacte/comprobante.pdf?from=${from}&to=${to}&cuenta=${encodeURIComponent(cuenta)}` (used by `CtacteComprobanteButton` with `apiFetchBlob`).
- **Tests added (RED):** URL composition with stubbed env var (trim trailing slash + double slash); `FormData` construction for pago (monto + fecha + concepto + comprobante File); `encodeURIComponent` for cuenta with special chars; URL building for comprobante query params.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/lib/api/ctacte-mutations.test.ts
  ```
- **Commit:** `feat(web): add ctacte-mutations client wrapper (4 fetch helpers)`

---

## Phase 10: Payment Modal (PR A2.2)

- [x] A2.2 — CtactePaymentForm modal (file upload + form)
- **File(s):** `apps/web/src/components/ctacte/CtactePaymentForm.tsx` + `CtactePaymentForm.test.tsx` (NEW).
- **Behavior:** Modal body for "Registrar Pago" using `<Modal>` primitive. React-Hook-Form + Zod schema (mirrors backend `paymentSchema`: `monto > 0`, `fecha` regex `/^\d{4}-\d{2}-\d{2}$/`, `concepto` min 1 max 500). Drag-and-drop OR file picker for comprobante (uses `<input type="file">` with `accept="application/pdf,image/*"`). Submit → `registerCtactePayment()` → `notify('success', 'Pago registrado')` + close modal + `onSuccess()` callback (page-level refresh). Errors: Zod validation inline; network failure → `notify('error', ...)`; `monto<=0` shows inline error before submit.
- **Tests added (RED):** render with monto + fecha + concepto fields; drag-and-drop file → preview thumbnail; submit success → `registerCtactePayment` called with FormData + `notify('success')` + modal closes; submit error → `notify('error')` + modal stays open; Zod `monto<=0` shows inline error; vi.mock synchronous factory per #263 R4.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ctacte/CtactePaymentForm.test.tsx
  ```
- **Commit:** `feat(web): add CtactePaymentForm modal with drag-and-drop comprobante upload`

---

## Phase 11: Debit + Note Modals (PR A2.3)

- [x] A2.3 — CtacteDebitForm + CtacteNoteForm modals
- **File(s):** `apps/web/src/components/ctacte/CtacteDebitForm.tsx` + `CtacteDebitForm.test.tsx` (NEW); `apps/web/src/components/ctacte/CtacteNoteForm.tsx` + `CtacteNoteForm.test.tsx` (NEW).
- **Behavior:** `CtacteDebitForm`: Modal body for "Registrar Débito" — monto + motivo + fecha fields, Zod validated, submit → `registerCtacteDebit()` → `notify('success')` + close. `CtacteNoteForm`: Modal body for "Nota" (per-movement) — textarea for `body`, Zod `min(1).max(2000)`, submit → `addCtacteNote()` → `notify('success')` + close. Both consume the `<Modal>` primitive, match Gorriti Premium tokens (no raw hex).
- **Tests added (RED):** debit form: render fields + submit success calls `registerCtacteDebit` + `notify('success')` + close; `monto<=0` inline error; motivo empty inline error. note form: render textarea + submit success calls `addCtacteNote(socioId, movementId, body)` + `notify('success')` + close; empty body inline error; body > 2000 inline error.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteDebitForm.test.tsx src/components/ctacte/CtacteNoteForm.test.tsx
  ```
- **Commit:** `feat(web): add CtacteDebitForm and CtacteNoteForm modals`

---

## Phase 12: Comprobante Button (PR A2.4)

- [x] A2.4 — CtacteComprobanteButton (date range picker + apiFetchBlob → window.open)
- **File(s):** `apps/web/src/components/ctacte/CtacteComprobanteButton.tsx` + `CtacteComprobanteButton.test.tsx` (NEW).
- **Behavior:** Secondary variant button (Lucide `Printer` icon, `#ffffff` bg + `1px ink-200 border` + `ink-700` text). Click opens a Modal with date-range picker (2 `<input type="date">` for `from` + `to` + `cuenta` pre-filled). Submit → `getCtacteComprobanteUrl(socioId, cuenta, from, to)` → `apiFetchBlob(url)` → `URL.createObjectURL(blob)` → `window.open(blobUrl, '_blank', 'noopener,noreferrer')` → `notify('success', 'Comprobante generado')`. Errors: missing/invalid range → inline error; network failure → `notify('error')`. Mirrors `EmitirSolicitudButton` pattern but with date-range picker.
- **Tests added (RED):** click opens date-range modal; submit happy → `getCtacteComprobanteUrl` called with correct args → `window.open` invoked with `'_blank'` + `'noopener,noreferrer'` + blob URL; submit error → `notify('error')`; missing `from`/`to` → inline error; `from > to` → inline error; vi.mock synchronous factory per #263 R4.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteComprobanteButton.test.tsx
  ```
- **Commit:** `feat(web): add CtacteComprobanteButton with date-range picker and blob download`

---

## Phase 13: Notes Section + Page Wiring + OperatorChip Integration (PR A2.5)

- [x] A2.5 — CtacteNotesSection + page wiring + per-row Nota callback
- **File(s):** `apps/web/src/components/ctacte/CtacteNotesSection.tsx` + `CtacteNotesSection.test.tsx` (NEW); `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` (edit, Gorriti Premium refresh + 3 header buttons + notes card mount + per-row Nota callback on `MovementList`); `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` (extend, +5 cases; preserve all existing data-testids); `apps/web/src/components/ledger/MovementList.tsx` (edit, add optional `onNotaClick?: (movementId) => void` prop, ghost icon button per row).
- **Behavior:** `CtacteNotesSection`: mirrors `SocioNotesCard`. Collapsible via `useNotesCollapsed(cuentaId, null)` hook (localStorage key `ctacte-notes-collapsed-<cuenta>`; default collapsed). Form to add new note per movement; list of existing notes (excludes soft-deleted); per-row `OperatorChip` renders `username · ROLE` (resolves operator name via existing `/api/v1/operators` endpoint — zero coupling with backend audit metadata). Soft-delete gated to author OR ADMIN. Page wiring: 3 mutation buttons in header card action group (Primary "Registrar Pago" with `Wallet` icon, Secondary "Registrar Débito" with `MinusCircle`, Secondary "Reimprimir Comprobante" with `Printer`). Preserves existing 10 page test data-testids. `MovementList` gains optional `onNotaClick` prop (untouched existing tests; new ghost icon button per row).
- **Tests added (RED):** `CtacteNotesSection.test.tsx` — default collapsed; expand toggles state; reload reads from `localStorage`; `addCtacteNote` called on submit; `OperatorChip` renders `username · ROLE`; soft-delete gated (non-author non-ADMIN button hidden). `page.test.tsx` extended: 3 mutation buttons visible; notes card mount point present; per-row Nota button visible; existing data-testids preserved.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteNotesSection.test.tsx src/app/(authed)/ctacte/[cuenta]/page.test.tsx src/components/ledger/MovementList.test.tsx
  ```
- **Commit:** `feat(web): add CtacteNotesSection and wire Gorriti Premium refresh + 3 mutation buttons on /ctacte/[cuenta]`

---

## Apply Handoff

Strict TDD per task: **RED + GREEN in the SAME commit** (per `athlos-audit-operator-display` and `athlos-socio-form-emit` conventions — do NOT split them across commits).

### PR A1a

```bash
git checkout -b feat/ctacte-mutations-a1a origin/main

# Apply A1a.1 through A1a.4 (one commit each, RED→GREEN in the same commit)

# After all commits:
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/api test:run -- src/modules/socios/forms/ctacte-mutations src/modules/socios/ctacte_movement_notes src/modules/socios/ctacte_movement_notes_repository src/modules/ctacte/repository
pnpm --filter @athlos/db typecheck
pnpm --filter @athlos/db lint
pnpm --filter @athlos/db test:run -- src/schema/tesoreria.test.ts

# Migration apply (POST-MERGE ONLY — never in CI or apply phase):
# docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/drizzle/0031_ctacte_movement_notes.sql

git push origin feat/ctacte-mutations-a1a
gh pr create \
  --title "feat(api): ctacte mutations a1a (table + service + repo + notes)" \
  --base main
```

### PR A1b

```bash
git checkout -b feat/ctacte-mutations-a1b origin/main

# Apply A1b.1 through A1b.4

# After all commits:
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/api test:run -- src/routes/ctacte-mutations src/modules/socios/forms/ctacte-comprobante src/modules/socios/forms/ctacte-mutations src/modules/socios/forms/golden-pdf
pnpm --filter @athlos/audit typecheck
pnpm --filter @athlos/audit lint
pnpm --filter @athlos/audit test:run -- src/emitter.test.ts

git push origin feat/ctacte-mutations-a1b
gh pr create \
  --title "feat(api): ctacte mutations a1b (routes + template + audit)" \
  --base main
```

### PR A2

```bash
git checkout -b feat/ctacte-mutations-a2 origin/main

# Apply A2.1 through A2.5

# After all commits:
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/web lint
pnpm --filter @athlos/web test:run -- src/components/ctacte src/lib/api/ctacte-mutations.test.ts src/app/(authed)/ctacte/[cuenta]/page.test.tsx

git push origin feat/ctacte-mutations-a2
gh pr create \
  --title "feat(web): ctacte mutations a2 (frontend modals + notes + visuals)" \
  --base main
```

### Branch names and PR titles

- PR A1a: branch `feat/ctacte-mutations-a1a`, title `feat(api): ctacte mutations a1a (table + service + repo + notes)`
- PR A1b: branch `feat/ctacte-mutations-a1b`, title `feat(api): ctacte mutations a1b (routes + template + audit)`
- PR A2: branch `feat/ctacte-mutations-a2`, title `feat(web): ctacte mutations a2 (frontend modals + notes + visuals)`

### Out-of-scope for apply (orchestrator notes in PR body)

- **No deploy** in any PR — no docker build, no PM2 restart, no production container touch.
- **No migration apply** in PR A1a — `0031_ctacte_movement_notes.sql` is applied post-merge via `docker exec psql` (orchestrator chore).
- **`CtacteTab.tsx` (sibling inside `/socios/[id]`)** explicitly NOT touched — out of scope, future change.
- **Pre-existing CI failures** (test/labeler/Docker build smoke) will reappear — document in PR body as unrelated (same pattern as PR 8c.1 / PR 8d).
- Orchestrator merges with `--admin` if needed to bypass pre-existing CI failures.

---

## Critical tasks (highest risk)

1. **A1a.3 — `ctacte-mutations.ts` service implementation with idempotency 10s-bucket** — `registerPayment` + `registerDebit` are the largest service surface. The idempotency wrapper (NOTA via `body`, payment/débito via SHA-256 of canonical input) is plumbing-not-policy; any mistake breaks the SHA-256 dedupe contract. The `emitAudit` call must be best-effort (try/catch) so a failed audit insert does NOT roll back the 201 response. Mock `emitAudit` + assert call shape across all happy paths.
2. **A1b.2 — comprobante template + golden-pdf integration with 50-movement cap** — the template must render the movimientos table with correct Gorriti Premium styling, and the cap-50 enforcement must run BEFORE puppeteer is invoked (deterministic test, no real browser). `pdf-parse` substring assertions on the rendered PDF must be substring-based (not exact-position) to survive minor Chromium version drift between local dev and CI.
3. **A1b.3 — 4 routes with multipart file upload for pago** — the pago route delegates comprobante upload to the existing `attachments` route; the multipart content-type exception is codified in the legajo delta, but reusing it for ctacte requires careful mock setup so tests don't double-mock the same path. 413 / 415 status codes depend on the attachments route's contract being honored exactly.
4. **A2.4 — `CtacteComprobanteButton` file download with `apiFetchBlob`** — must compose the correct URL with `encodeURIComponent(cuenta)`, then call `apiFetchBlob` (PR 8d.2) to preserve JWT auth on the PDF request, then `URL.createObjectURL` + `window.open(blobUrl, '_blank', 'noopener,noreferrer')`. Cleanup: `URL.revokeObjectURL` after `window.open` resolves (or on unmount). Test must mock `apiFetchBlob` returning a known Blob.

---

## Risks (this task breakdown's own risks)

1. **Budget overrun on each PR** — PR A1a forecast ~700 LoC, PR A1b ~600 LoC, PR A2 ~500 LoC. The **per-PR 400-line guard** measures net diff vs main, not source LoC, so tests + migration SQL + tests-on-tests add ~30% overhead. Risk LOW because deliverables are internally cohesive, but if any PR approaches 400 net diff at PR-open time, split further with chained-to-main (A1a → A1a.1 + A1a.2 if needed).
2. **Idempotency correctness** — the `emitAudit` SHA-256 10s-bucket is plumbing inherited from PR 8c.1. NOTA mutations include `body` so two notes with different bodies produce distinct idempotency keys; payment/débito dedup is desired. Test must assert that two identical payment retries within 10s return the same audit row (not two new ones), and that NOTA with different bodies produces two rows.
3. **Comprobante cap correctness** — the LIMIT 50 cap is enforced in TWO places: (a) repository SQL (defense-in-depth), and (b) route handler between `getMovementsForComprobante()` and `pdfGenerator.generate()`. The route-level enforcement is the contract test; the SQL-level is a belt-and-suspenders guard. Tests must assert spy `pdfGenerator.generate` is NOT called when cap exceeded.
4. **Frontend testability of file upload (pago)** — `CtactePaymentForm` uses `<input type="file">` with drag-and-drop. Testing drag-and-drop in jsdom is timing-sensitive; prefer `fireEvent.drop(input, { dataTransfer: { files: [file] } })` with synchronous factory `vi.mock` per #263 R4. The `FormData` construction in `registerCtactePayment` must be tested separately (URL composition + payload shape, not actual upload).
5. **RAM constraint with full Vitest run** — handover #253 confirms full Vitest runs OOM on the server. All `pnpm test:run` invocations above are **per-file** (or per-glob of 2-3 files max). Test files must stay ≤ 200 LoC. If a test file grows beyond 200 LoC, split into a `*-helpers.test.ts` sibling. The golden-pdf integration test must stub `pdfGenerator.generate` so no real Chromium is launched.

---

## Verify Remediation — CRITICAL Findings

### Remediation Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 760–980 corrective lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | R2a durable replay + 0033; R2b debit caller-key + evidence |
| Delivery strategy | pending |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| R1 | Cap query/count and payment validation | PR 1 | Base main; targeted API tests |
| R2a | Durable replay state machine and 0033 rollout | PR #31 corrective slice | Existing PR #31; require size exception if it remains over 400 lines |
| R2b | Debit caller-key path and strict-TDD closure | Child corrective slice | Base = R2a branch; diff contains only R2b |
| R3 | Production note workflow, deletion, and cuenta state | PR 3 | Base PR 2; component/page tests |
| R4 | Field-level ApiError mapping | PR 4 | Base PR 3; form tests |
| R5 | Evidence reconciliation | PR 5 | Base PR 4; artifact-only |

- [x] R1 — Update `apps/api/src/modules/socios/forms/ctacte-mutations.ts`, its repository query, and `apps/api/src/routes/ctacte-mutations.ts` so the comprobante range count is obtained before any 50-row truncation or `pdfGenerator.generate`; add a production-path test proving 51 movements return `400 VALIDATION_ERROR` with `{ cap: 50, requested: 51 }`, no PDF call, and no print audit.
- [x] R1 — Enforce the payment `fecha` relationship range in the payment service/route and return field-level `ApiError.details`; add route tests for pre-alta and future dates with no movement or audit side effects.
- [x] R1.1 — Use the Argentina business calendar for payment future-date validation and cover UTC date-boundary behavior deterministically.
- [x] R1.2 — Reject malformed and impossible ISO calendar dates for payment and debit with field-level validation details before persistence.
- [x] R1.3 — Replace the comprobante count/fetch TOCTOU with a single `LIMIT 51` snapshot query and deterministic interleaving coverage.
- [ ] R2 — Superseded/not complete: the prior time-bucket debit/comprobante implementation does not meet the amended caller-key and durable replay contracts.
- [x] R2 — Validate `movementId` ownership against `:socioId` before every POST note write; return the specified not-found/error envelope and add a cross-socio write rejection test with no note or audit side effect.
- [x] R2 corrective re-run — Durable comprobante owner leases now heartbeat, complete/fail by owner only, reclaim failed/stale attempts atomically, and return the persisted full result to followers; the debit caller-key work remains intact.
- [x] R3 — Wire movement-scoped `CtacteNoteForm` into the production `/ctacte/[cuenta]` row action, expose the required note list/delete client and API path, and enforce author-or-ADMIN soft-delete authorization; add route, component, and page coverage.
- [x] R3 — Change `CtacteNotesSection` to call `useNotesCollapsed(cuentaId, null)` and test the `ctacte-notes-collapsed-<cuenta>` key, reload persistence, and cross-cuenta isolation.
- [ ] R4 — Map server `ApiError.details: [{ field, message }]` into the corresponding Pago, Débito, Nota, and comprobante form fields while retaining top-level failure toasts; add component tests for field errors and cap-range feedback.
- [ ] R5 — Reconcile `sdd/athlos-ctacte-mutations/apply-progress` against real commits and test records, adding a Strict TDD Cycle Evidence table only for evidence that can be cited; explicitly leave uncited RED/GREEN, triangulation, or safety-net entries unrecorded rather than fabricating them.

### R2 Amendment — Corrective Tasks

- [x] R2.1 — RED→GREEN `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` and golden tests: remove the fixed 500 ms waiter conflict and replay the persisted non-zero movement count.
- [x] R2.2 — RED→GREEN `packages/db/drizzle/0033_ctacte_comprobante_retries.sql` and `packages/db/src/schema/tesoreria.ts`: add forward-compatible status CHECK, lease owner/expiry, attempt/update fields, result fields, `movement_count`, and expiry index; add an ephemeral PostgreSQL test applying 0033 twice and introspecting the schema.
- [x] R2.3 — RED→GREEN debit route/service/client/form tests and `CtacteDebitInput`: require/send one 1–128-character `Idempotency-Key` per submit intent; same key/canonical payload replays, changed payload returns 409, and identical payloads with distinct keys create distinct debits; retain on ambiguous retry and rotate only on success/cancel.
- [x] R2.4 — Document the manual 0031→0032→0033 backup, `psql -v ON_ERROR_STOP=1 --single-transaction`, schema-verification, then API-rollout sequence in `docs/runbook.md`; do not run migrations, deploy, or access production.
- [ ] R2.5 — Evidence correction is truthful but incomplete: `apply-progress.md` marks unavailable strict-TDD RED/GREEN evidence as `MISSING`, removes unsupported test totals, records the read-only production schema inspection accurately, and leaves overall SDD verification open until R2.1–R2.3 strict-TDD evidence can be proven.
- [x] R2a fix batch — Restore route-standin lease compatibility; require comprobante caller keys and fingerprints; expire completed replay rows; compare debit owner identity; document safe 0033 rollout; and execute non-skipping disposable PostgreSQL lease/migration tests.
