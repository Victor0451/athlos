# Design: Socio Legajo (per-socio attachments)

**Change**: `athlos-socio-legajo` | **Phase**: design | **Date**: 2026-07-07
**Spec sources**: `specs/socio-attachments` (NEW, 14 reqs), `specs/file-storage` (DELTA, 6 ADDED + 1 MODIFIED), `specs/api-design` (DELTA, 2 MODIFIED), `specs/audit-logger` (DELTA, 1 ADDED + 1 MODIFIED), `specs/ui-design` (DELTA, 1 ADDED).
**Stack context**: pnpm 9.15 / TypeScript 5.7 strict / Fastify 5.2 / Drizzle 0.36 / Vitest 2.1 / Next 16 / React 19. Strict TDD, 1:1 source:test.

---

## 1. Goal + non-goals

Realise the dormant `file-storage` spec for the first time, scoped to a new "Legajo" tab on `/socios/[id]`. Operators drag-drop or pick images (JPEG/PNG/WEBP/GIF) or PDFs (≤ 10 MB), see them in a thumbnail grid (PDFs get an icon + download link), preview / soft-delete with audit trail. Quota: 100 active files OR 500 MB per socio. **Non-goals**: no PDF first-page thumbnail, no image resize, no `/ctacte` or `/padrones` attachments, no admin-only delete, no generic `POST /api/v1/files` (deferred), no per-operator quota.

## 2. Architecture overview

```
                                          ┌──────────────────────────────────┐
 POST /api/v1/socios/:id/attachments  ───► │ @fastify/multipart (10MB, 1 file)│
                                          └────────────┬─────────────────────┘
                                                       │ stream
                          ┌────────────────────────────▼──────────────────┐
                          │ apps/api/src/modules/socios/attachments.ts     │
                          │   • quota tx (FOR SHARE) → saveStream → insert │
                          │   • softDelete → audit (best-effort)           │
                          └──┬─────────────────────┬──────────────────┬───┘
                             │                     │                  │
                  ┌──────────▼────────┐ ┌───────────▼────┐  ┌─────────▼─────────┐
                  │ LocalFileStorage  │ │ socioAttachments│  │ @athlos/audit     │
                  │ (atomic rename +  │ │  (Drizzle)     │  │  (emitAudit with  │
                  │  streaming SHA256)│ └────────────────┘  │   metadata)       │
                  └─────────┬─────────┘                     └───────────────────┘
                            │ /app/storage/socios/<socio>/<aid>.<ext>  (named volume)
```

**Storage layer (`LocalFileStorage`)** — NEW module `apps/api/src/modules/file-storage/`:
- Class methods: `saveStream(stream, opts): { storagePath, sha256, sizeBytes }`, `readStream(path)`, `unlink(path)`.
- Atomic-rename: write to `<base>/.tmp/<random-uuid>`, then `rename()` to final path.
- SHA-256 inline over 64 KB chunks (`createHash('sha256')` + `stream.pipeline`).
- Magic-byte validator: pure function `validateMagic(declared, fullBuffer): boolean`.
- Env: `UPLOADS_DIR` (default `/app/storage`), `MAX_FILE_SIZE_BYTES` (default `10485760`).

**DB layer (`socioAttachments`)** — extend `packages/db/src/schema/socios.ts`:
- UUID PK (NOT ULID — codebase consistency per spec delta R1).
- FKs: `socio_id` → `socios.id` (RESTRICT), `uploaded_by` → `operators.id` (loose — see notes.ts precedent for cross-schema).
- `category` pgEnum `attachment_category('dni'|'comprobante'|'foto'|'contrato'|'otro')`.
- `deleted_at` tstz nullable (soft delete).
- Indexes: `(socio_id, deleted_at)`, `(socio_id, category)`, `(storage_sha256)`, `(uploaded_at desc)`.

**Routes** — NEW `apps/api/src/routes/socios-attachments.ts`. 5 routes under `/api/v1/socios/:socioId/attachments/*`. `multipart` plugin registered in `server.ts` between `auditPlugin` and route plugins (per design R4).

**Service + repository** — `apps/api/src/modules/socios/attachments.ts` + `attachments-repository.ts`:
- Service: socio existence check → quota tx (FOR SHARE) → saveStream → INSERT row → audit emit (best-effort).
- Repository: `listBySocio(db, socioId, opts)`, `findById`, `insert`, `softDelete` (sets `deleted_at` + `deleted_by`).

**Audit extension** — `packages/audit/src/emitter.ts`:
- Add `metadata?: Record<string, unknown>` to `AuditRecord`; persist into existing `audit_events.metadata` jsonb column.
- Add two action constants: `SOCIO_ATTACHMENT_UPLOADED`, `SOCIO_ATTACHMENT_DELETED`.
- Add two new cases to `AuditTab.tsx` `actionLabel()` + `ActionIcon()` (FolderOpen icon, matching Legajo tab).

**Migration** — `packages/db/migrations/0021_socio_attachments.sql` (hand-written, see spec for DDL). Deploy runbook: `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0021_socio_attachments.sql` (drizzle migrate is broken in prod per handover #253).

**Docker** — `docker-compose.yml`: add `volumes: { storage: {} }` top-level; add `volumes: - storage:/app/storage` to `api` service.

**Frontend** — `apps/web/src/components/socios/LegajoTab.tsx` + 3 sub-components. Mirrors `AuditTab.tsx` shape. Uses existing `<Modal>` (preview + delete confirm) + `notify()` from `athlos-toast-primitivo`.

## 3. Contracts (TypeScript — source of truth for apply)

```ts
// apps/api/src/modules/file-storage/local-file-storage.ts
export class LocalFileStorage {
  constructor(opts: { baseDir: string; maxBytes: number });
  saveStream(stream: Readable, opts: { mimeType: string }): Promise<{
    storagePath: string;  // e.g. "socios/<socioId>/<aid>.pdf"
    sha256: string;       // 64 hex chars
    sizeBytes: number;
  }>;
  readStream(storagePath: string): Readable;
  unlink(storagePath: string): Promise<void>;
}

// apps/api/src/modules/file-storage/magic-byte.ts
export function validateMagic(declared: string, buffer: Buffer): boolean;
export type AllowedMime =
  | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

// packages/db/src/schema/socios.ts (add to existing file)
export const attachmentCategory = pgEnum('attachment_category',
  ['dni', 'comprobante', 'foto', 'contrato', 'otro']);

export const socioAttachments = sociosSchema.table('socio_attachments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  socioId:     uuid('socio_id').notNull().references(() => socios.id, { onDelete: 'restrict' }),
  filename:    text('filename').notNull(),                          // server-sanitized, ≤ 255
  description: text('description'),                                  // nullable, ≤ 500
  category:    attachmentCategory('category').notNull(),
  mimeType:    text('mime_type').notNull(),                          // post magic-byte detection
  sizeBytes:   bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath:   text('storage_path').notNull(),                     // <base>/socios/<id>/<aid>.<ext>
  storageSha256: text('storage_sha256').notNull(),                   // 64 hex chars
  uploadedBy:  uuid('uploaded_by').notNull(),                       // loose FK → operators (cross-schema)
  uploadedAt:  timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   uuid('deleted_by'),
}, (t) => ({
  socioActiveIdx:   index('socio_attachments_socio_active_idx').on(t.socioId, t.deletedAt),
  socioCategoryIdx: index('socio_attachments_socio_category_idx').on(t.socioId, t.category),
  storageShaIdx:    index('socio_attachments_storage_sha_idx').on(t.storageSha256),
  uploadedAtIdx:    index('socio_attachments_uploaded_at_idx').on(t.uploadedAt),
}));

export type SocioAttachment      = typeof socioAttachments.$inferSelect;
export type NewSocioAttachment   = typeof socioAttachments.$inferInsert;
export type AttachmentCategory   = (typeof attachmentCategory.enumValues)[number];

// apps/api/src/modules/socios/attachments.ts
export class QuotaError extends Error { readonly cap: 'files' | 'bytes'; readonly limit: number; readonly current: number; }

export async function uploadAttachment(params: {
  socioId: string;
  operatorId: string;
  fileStream: Readable;
  declaredMimeType: string;
  filename: string;
  description?: string;
  category: AttachmentCategory;
}): Promise<SocioAttachment>;

export async function listAttachments(params: {
  socioId: string;
  category?: AttachmentCategory;
}): Promise<SocioAttachment[]>;

export async function getAttachment(id: string): Promise<SocioAttachment | null>;

export async function streamAttachment(id: string): Promise<{ row: SocioAttachment; stream: Readable } | null>;

export async function softDeleteAttachment(params: { id: string; operatorId: string }): Promise<void>;

// packages/audit/src/emitter.ts (extend — keep existing fields)
export interface AuditRecord {
  operatorId: string | null;
  action: string;            // widens to include 'SOCIO_ATTACHMENT_UPLOADED' | 'SOCIO_ATTACHMENT_DELETED'
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  sourceIp: string | null;
  payload: unknown;          // unchanged — used for idempotencyKey
  metadata?: Record<string, unknown>;  // NEW — persisted to audit_events.metadata jsonb
}
```

## 4. Route shape — pin exactly

```ts
// apps/api/src/routes/socios-attachments.ts
import multipart from '@fastify/multipart'

const ATTACHMENT_AUTH = { preHandler: requireAuth() }

export const socioAttachmentsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // POST upload (multipart, single file, 10 MB cap)
  fastify.post<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/attachments',
    { ...ATTACHMENT_AUTH, preHandler: [...ATTACHMENT_AUTH.preHandler, uploadPreHandler] },
    async (request, reply) => {
      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'VALIDATION_ERROR' })
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const meta   = throwIfInvalid(attachmentMetaSchema, file.fields, 'fields')
      const row    = await uploadAttachment({
        socioId: params.socioId, operatorId: request.operator!.sub,
        fileStream: file.file, declaredMimeType: file.mimetype,
        filename: file.filename, description: meta.description, category: meta.category,
      })
      return reply.code(201).send(toAttachmentDTO(row))
    },
  )

  // GET list (?category= optional)
  fastify.get<{ Params: { socioId: string }; Querystring: { category?: AttachmentCategory } }>(
    '/api/v1/socios/:socioId/attachments',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const q      = request.query
      const items  = await listAttachments({ socioId: params.socioId, ...(q.category ? { category: q.category } : {}) })
      return reply.code(200).send({ items: items.map(toAttachmentDTO) })
    },
  )

  // GET single metadata
  fastify.get<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const row    = await getAttachment(params.attachmentId)
      if (!row || row.deletedAt) return reply.code(404).send()
      return reply.code(200).send(toAttachmentDTO(row))
    },
  )

  // GET file stream
  fastify.get<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId/file',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const found  = await streamAttachment(params.attachmentId)
      if (!found || found.row.deletedAt) return reply.code(404).send()
      reply.header('Content-Type', found.row.mimeType)
      reply.header('Content-Disposition', `inline; filename="${found.row.filename}"`)
      return reply.send(found.stream)
    },
  )

  // DELETE soft
  fastify.delete<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      await softDeleteAttachment({ id: params.attachmentId, operatorId: request.operator!.sub })
      return reply.code(204).send()
    },
  )
  done()
}
```

Multipart plugin registered in `apps/api/src/server.ts` between `auditPlugin` (line 172) and route registration:

```ts
// server.ts — insert after auditPlugin register (line 172)
import multipart from '@fastify/multipart'
import { getEnvNumber } from '@athlos/config'
await app.register(multipart, {
  limits: { fileSize: getEnvNumber(container.env, 'STORAGE_MAX_FILE_SIZE_BYTES', 10 * 1024 * 1024), files: 1 },
})
```

## 5. Magic-byte table — pin exactly

```ts
// apps/api/src/modules/file-storage/magic-byte.ts
const MAGIC_BYTES: Record<string, { first: Buffer; tail?: Buffer; webpAt8?: Buffer }> = {
  'image/jpeg':     { first: Buffer.from([0xff, 0xd8, 0xff]) },
  'image/png':      { first: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  'image/gif':      { first: Buffer.from([0x47, 0x49, 0x46, 0x38]) },     // 'GIF8' — also assert '7a' or '8a' at offset 4
  'image/webp':     { first: Buffer.from([0x52, 0x49, 0x46, 0x46]), webpAt8: Buffer.from([0x57, 0x45, 0x42, 0x50]) }, // 'RIFF'…'WEBP'
  'application/pdf':{ first: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), tail: Buffer.from([0x25, 0x25, 0x45, 0x4f, 0x46]) }, // '%PDF-' + '%%EOF' in last 1024B
}

export function validateMagic(declared: string, buffer: Buffer): boolean {
  const spec = MAGIC_BYTES[declared]; if (!spec) return false
  if (!buffer.subarray(0, spec.first.length).equals(spec.first)) return false
  if (declared === 'image/gif') {
    const v = buffer[4]; if (v !== 0x37 /* '7' */ && v !== 0x38 /* '8' */) return false
    if (buffer[5] !== 0x61 /* 'a' */) return false
  }
  if (declared === 'image/webp' && spec.webpAt8 && !buffer.subarray(8, 12).equals(spec.webpAt8)) return false
  if (declared === 'application/pdf' && spec.tail) {
    const tail = buffer.subarray(Math.max(0, buffer.length - 1024))
    if (tail.indexOf(spec.tail) === -1) return false
  }
  return true
}
```

## 6. Quota transaction — pin shape

```ts
// apps/api/src/modules/socios/attachments.ts
import { sql } from 'drizzle-orm'

await db.transaction(async (tx) => {
  const [{ count, sum }] = await tx.execute(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::bigint AS sum
    FROM socio_attachments
    WHERE socio_id = ${socioId} AND deleted_at IS NULL
    FOR SHARE
  `)
  if (count >= 100) throw new QuotaError('files', 100, count)
  if (sum + sizeBytes > 500 * 1024 * 1024) throw new QuotaError('bytes', 524288000, Number(sum))
  const storageResult = await fileStorage.saveStream(fileStream, { mimeType: declaredMimeType })
  // …validate magic against sniffed buffer (readStream the temp), rollback if mismatch…
  await tx.insert(socioAttachments).values({ ... })
})
```

`QuotaError` is caught at the route layer and mapped to `400 VALIDATION_ERROR` with `details: { cap, limit, current }`. The `FOR SHARE` lock blocks concurrent uploads from racing past the cap (concurrent test must drive two parallel `uploadAttachment` calls; one wins, the other rejects with `QuotaError`).

## 7. Audit metadata shape — pin exactly

```ts
// Both SOCIO_ATTACHMENT_UPLOADED and SOCIO_ATTACHMENT_DELETED:
const auditMetadata = {
  attachment_id: row.id,        // UUID string
  filename:      row.filename,  // original filename
  category:      row.category,  // 'dni' | 'comprobante' | 'foto' | 'contrato' | 'otro'
  size_bytes:    row.sizeBytes, // number, NOT stringified
}
await emitAudit(db, {
  operatorId: operatorId, action: 'SOCIO_ATTACHMENT_UPLOADED',
  entityType: 'socio_attachment', entityId: row.id,
  oldValue: null, newValue: { id: row.id, category: row.category, size_bytes: row.sizeBytes },
  sourceIp, payload: { id: row.id, filename: row.filename, size_bytes: row.sizeBytes },
  metadata: auditMetadata,  // ← NEW
})
```

Tests assert: `audit_events.metadata` is a JSON object containing exactly the four keys above with correct values (test fixture in `attachments.test.ts`).

## 8. UI contracts

**`LegajoTab`** (`apps/web/src/components/socios/LegajoTab.tsx`):
- Props: `{ socioId: string }`.
- Internal state: `useQuery(['socio-attachments', socioId], () => listAttachments(socioId), { staleTime: 30_000 })`.
- Renders: `<AttachmentUpload socioId onUploadComplete={refetch} />` + grid of `<AttachmentCard>` or inline empty state (matches `audit-tab-empty` shape — `Pin` icon + "Sin archivos" + body-sm).
- Mutation: `useMutation` for delete + `notify('success'|'error', msg)`.

**`AttachmentUpload`** (`apps/web/src/components/socios/AttachmentUpload.tsx`):
- Props: `{ socioId: string; onUploadComplete: () => void }`.
- Client-side validates MIME + size (10 MB) BEFORE the API call. Inline error message on rejection.
- Drop zone `border-accent bg-accent-soft` on dragover (per design D in ui-design delta).
- Uses `useMutation` with `FormData`; sends `POST /api/v1/socios/<id>/attachments`.

**`AttachmentCard`** (`apps/web/src/components/socios/AttachmentCard.tsx`):
- Props: `{ attachment: SocioAttachment; onPreview: () => void; onDelete: () => void }`.
- Image MIMEs: `<img src="…/file" loading="lazy">` thumbnail.
- PDF: Lucide `FileText` icon + filename + download link.
- Trash icon → opens delete confirm `<Modal role="alertdialog">`.

**`AttachmentPreviewModal`** (`apps/web/src/components/socios/AttachmentPreviewModal.tsx`):
- Props: `{ attachment: SocioAttachment | null; onClose: () => void }`.
- Reuses `<Modal size="2xl">`. Image: inline `<img>`. PDF: download `<a download>` link.

**Client wrapper** (`apps/web/src/lib/api/attachments.ts`):
- `listAttachments(socioId: string): Promise<SocioAttachment[]>` — wraps `apiFetch<{ items: SocioAttachment[] }>('/api/v1/socios/<id>/attachments')`.
- `uploadAttachment(socioId, file: File, opts: { category: AttachmentCategory; description?: string }): Promise<SocioAttachment>` — builds `FormData`, calls `apiFetch` with multipart body.
- `deleteAttachment(socioId, attachmentId): Promise<void>`.
- `attachmentFileUrl(socioId, attachmentId): string` — for `<img src>` / `<a href>`.

`apiFetch` extended in `apps/web/src/lib/api.ts` (3-line diff): when `body instanceof FormData`, skip the JSON content-type and pass the FormData through (browser sets the boundary).

## 9. File diff list (source of truth for apply)

**NEW (production):**
- `apps/api/src/modules/file-storage/local-file-storage.ts` + `local-file-storage.test.ts`
- `apps/api/src/modules/file-storage/magic-byte.ts` + `magic-byte.test.ts`
- `apps/api/src/modules/file-storage/index.ts` (barrel)
- `apps/api/src/modules/socios/attachments.ts` + `attachments.test.ts`
- `apps/api/src/modules/socios/attachments-repository.ts` + `attachments-repository.test.ts`
- `apps/api/src/routes/socios-attachments.ts` + `socios-attachments.test.ts`
- `apps/web/src/components/socios/LegajoTab.tsx` + `LegajoTab.test.tsx`
- `apps/web/src/components/socios/AttachmentUpload.tsx` + `AttachmentUpload.test.tsx`
- `apps/web/src/components/socios/AttachmentCard.tsx` + `AttachmentCard.test.tsx`
- `apps/web/src/components/socios/AttachmentPreviewModal.tsx` + `AttachmentPreviewModal.test.tsx`
- `apps/web/src/lib/api/attachments.ts` + `attachments.test.ts`
- `packages/db/migrations/0021_socio_attachments.sql`

**EDITED:**
- `apps/api/src/server.ts` — register `@fastify/multipart` + `socioAttachmentsRoutes`.
- `packages/db/src/schema/socios.ts` — add `socioAttachments` table + `attachmentCategory` enum.
- `packages/audit/src/emitter.ts` — add `metadata` field to `AuditRecord` + persist in INSERT.
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — add `legajo` tab + `<LegajoTab>` mount + `FolderOpen` icon.
- `apps/web/src/lib/api.ts` — 3-line `FormData` branch.
- `apps/web/src/components/socios/AuditTab.tsx` — 2 new `actionLabel`/`ActionIcon` cases (FolderOpen).
- `docker-compose.yml` — top-level `volumes: { storage: {} }` + `volumes: - storage:/app/storage` on `api`.
- `apps/api/.env.production.example` — `UPLOADS_DIR`, `MAX_FILE_SIZE_BYTES`.

## 10. Testing strategy

| Layer | File | What to test |
|---|---|---|
| Unit | `local-file-storage.test.ts` | atomic rename, SHA-256 correctness, unlink, stream back-pressure |
| Unit | `magic-byte.test.ts` | each MIME accepts valid buffer; rejects invalid; WEBP offset 8; PDF trailer in last 1024B; GIF `7a/8a` byte at offset 4 |
| Integration | `attachments.test.ts` (service) | happy path; quota `count`; quota `bytes`; FOR SHARE race (2 parallel); magic-byte rejection + rollback (file unlinked + row deleted); soft delete + audit row exists |
| Integration | `attachments-repository.test.ts` | list by socio + `?category=`; get by id; soft delete sets `deleted_at`/`deleted_by` |
| Integration | `socios-attachments.test.ts` (route) | 5 routes end-to-end with JWT auth, multipart, 401 missing JWT, 415 bad MIME, 413 oversize, 400 quota |
| Component | `LegajoTab.test.tsx` | renders grid, empty state, opens preview modal, delete confirm |
| Component | `AttachmentUpload.test.tsx` | drag-drop fires mutation, picker fires mutation, oversize shows inline error, bad MIME shows inline error |
| Component | `AttachmentCard.test.tsx` | image → `<img>` thumbnail, PDF → `FileText` icon + `<a download>` |
| Component | `AttachmentPreviewModal.test.tsx` | opens/closes; image embed; PDF download link |
| Unit | `attachments.test.ts` (client) | list wraps `apiFetch`; upload builds `FormData`; delete returns void |

Test factory form: **synchronous** `vi.mock` per D8 in toast-primitivo design #287 + handover #253. Test fixtures use `os.tmpdir()` for storage base; tests `afterEach` clean `.tmp/` + `socios/<socioId>/` directories.

## 11. Rollback plan

Additive within each PR. Migration `0021_socio_attachments.sql` reversible via `ALTER TABLE socios.socio_attachments DROP COLUMN …` (the soft-delete column makes rollback cheap). Docker volume removal orphans uploaded files (recoverable from the host's docker volume if needed). Each PR independently revertible.

## 12. PR shape

**Total ~1 000-1 400 LoC across 2 PRs, both stacked-to-main (A first).**

### PR A — backend (1 PR, 600-800 LoC, `size:exception` likely)

| Commit | Scope | LoC |
|---|---|---|
| A.1 | Migration `0021_socio_attachments.sql` + `socioAttachments` schema + `attachmentCategory` enum | ~80 |
| A.2 | `LocalFileStorage` + `magic-byte` + tests | ~250 |
| A.3 | Audit emitter `metadata` extension + 2 new actions in `AuditAction` union (`audit-logger/spec.md`) | ~50 |
| A.4 | `attachments.ts` service + `attachments-repository.ts` + tests (quota tx, FOR SHARE race) | ~250 |
| A.5 | `socios-attachments.ts` routes + tests (5 routes end-to-end) | ~150 |
| A.6 | Multipart plugin register in `server.ts` + Docker volume + `.env.production.example` | ~30 |

**Likely needs `size:exception` at 600-800 LoC** — recommend split into A1+A2+A3 (400-500 LoC, "storage layer + schema + audit ext") and A4+A5+A6 (400-500 LoC, "service + routes + deploy chore") if the single-PR review budget is too tight.

### PR B — frontend (1 PR, 400-600 LoC, `size:exception` likely)

| Commit | Scope | LoC |
|---|---|---|
| B.1 | `lib/api/attachments.ts` + `apiFetch` `FormData` branch + tests | ~80 |
| B.2 | `AttachmentUpload` + `AttachmentCard` + tests | ~200 |
| B.3 | `AttachmentPreviewModal` + `LegajoTab` + tests | ~250 |
| B.4 | Tab wiring in `page.tsx` + 2 new AuditTab action cases | ~50 |

**Likely needs `size:exception` at 400-600 LoC** — or split into B1+B2 (200-300) and B3+B4 (250-350).

## 13. Open questions

None. All locked product decisions, storage contract, magic-byte table, quota transaction, audit metadata shape, and PR shape are settled by proposal #298 + spec #299 + exploration #296 + this design.
