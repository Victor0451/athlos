import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Ctacte, CtacteMovementNote } from './index.ts'

/**
 * PR A1a (athlos-ctacte-mutations) — schema shape assertions for
 * the new `socios.ctacte_movement_notes` table and the new
 * `tesoreria.ctacte.comprobante_attachment_id` column.
 *
 * The migration file is the source of truth for production. The
 * Drizzle schema must mirror the SQL columns so application code
 * typechecks against the expected shape.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..', '..')

describe('ctacte_movement_notes schema', () => {
  it('CtacteMovementNote type has the expected required columns', () => {
    // The schema must mirror the SQL columns so type narrowing on
    // service / repository code matches the production rows.
    type Expected = {
      id: string
      ctacteMovementId: string
      body: string
      authorOperatorId: string
      createdAt: Date
      deletedAt: Date | null
      idempotencyKey: string | null
    }
    type _Check = CtacteMovementNote extends Expected ? true : false
    const _typeCheck: _Check = true
    expect(_typeCheck).toBe(true)
  })
})

describe('ctacte schema — comprobante_attachment_id column', () => {
  it('Ctacte type gains the comprobanteAttachmentId nullable column', () => {
    // The pago without-comprobante path stores NULL here; the SQL
    // column must be nullable so the type matches.
    type CheckNullable = Ctacte extends { comprobanteAttachmentId: string | null } ? true : false
    const _nullableCheck: CheckNullable = true
    expect(_nullableCheck).toBe(true)
  })
})

describe('0031_ctacte_movement_notes migration', () => {
  it('migration file creates the ctacte_movement_notes table', async () => {
    const fs = await import('node:fs/promises')
    const migrationPath = path.join(PACKAGE_ROOT, 'drizzle/0031_ctacte_movement_notes.sql')
    const content = await fs.readFile(migrationPath, 'utf-8')

    // Table creation in the right schema, idempotent.
    expect(content).toContain('CREATE TABLE IF NOT EXISTS "socios"."ctacte_movement_notes"')
    expect(content).toContain('"ctacte_movement_id" uuid NOT NULL')
    expect(content).toContain('"body" text NOT NULL')
    expect(content).toContain('"author_operator_id" uuid NOT NULL')
    expect(content).toContain('"created_at" timestamp with time zone NOT NULL DEFAULT now()')
    expect(content).toContain('"deleted_at" timestamp with time zone')
    // Indexes (both required).
    expect(content).toContain('idx_ctacte_movement_notes_movement')
    expect(content).toContain('idx_ctacte_movement_notes_created')
    // Column addition (idempotent).
    expect(content).toContain('ADD COLUMN IF NOT EXISTS "comprobante_attachment_id" uuid')
    expect(content).toContain('REFERENCES "socios"."socio_attachments"("id")')
  })

  it('migration file declares the idempotency_key column + UNIQUE partial index (R3)', async () => {
    const fs = await import('node:fs/promises')
    const migrationPath = path.join(PACKAGE_ROOT, 'drizzle/0031_ctacte_movement_notes.sql')
    const content = await fs.readFile(migrationPath, 'utf-8')
    expect(content).toContain('ADD COLUMN IF NOT EXISTS "idempotency_key" text')
    expect(content).toContain('ctacte_movement_notes_idempotency_key_unique')
    expect(content).toMatch(/WHERE\s+"idempotency_key"\s+IS\s+NOT\s+NULL/)
  })
})

describe('0034_ctacte_movement_notes_idempotency_key_full_unique migration', () => {
  it('migration file replaces the partial unique index with a full unique index (R3 fix #1)', async () => {
    const fs = await import('node:fs/promises')
    const migrationPath = path.join(
      PACKAGE_ROOT,
      'drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql',
    )
    const content = await fs.readFile(migrationPath, 'utf-8')
    // Forward-only conversion: drop the partial index, recreate as full.
    expect(content).toContain(
      'DROP INDEX IF EXISTS "socios"."ctacte_movement_notes_idempotency_key_unique"',
    )
    // The new CREATE must NOT carry a WHERE clause — partial would
    // re-break ON CONFLICT inference.
    expect(content).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_movement_notes_idempotency_key_unique"[\s\S]+ON "socios"\."ctacte_movement_notes" \("idempotency_key"\);/,
    )
    // And the new CREATE statement itself MUST NOT carry a partial
    // predicate — full index required for bare-column ON CONFLICT
    // inference in PostgreSQL.
    const newCreate = content.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_movement_notes_idempotency_key_unique"[\s\S]+?;/,
    )
    expect(newCreate).not.toBeNull()
    expect(newCreate![0]).not.toMatch(/WHERE/)
  })

  it('schema declaration mirrors the migration (full unique index, no partial predicate)', async () => {
    // The Drizzle schema MUST NOT keep a `.where(sql\`... IS NOT NULL\`)`
    // predicate on the idempotency key unique index — doing so would
    // tell Drizzle to generate a partial index that PostgreSQL cannot
    // match against bare `ON CONFLICT (idempotency_key)`.
    const fs = await import('node:fs/promises')
    const schemaPath = path.join(PACKAGE_ROOT, 'src/schema/socios.ts')
    const content = await fs.readFile(schemaPath, 'utf-8')
    expect(content).toContain('idempotencyKeyUnique')
    // The unique index declaration MUST NOT carry a `.where(` clause.
    const idxDecl = content.match(/idempotencyKeyUnique[^)]+\)/)
    expect(idxDecl).not.toBeNull()
    expect(idxDecl![0]).not.toMatch(/\.where\(/)
    // The full declaration's chain must still terminate in `.on(table.idempotencyKey)`
    // and bind to the same index name as the migration 0031 + 0034.
    expect(content).toMatch(
      /uniqueIndex\(['"]ctacte_movement_notes_idempotency_key_unique['"]\)[\s\S]*?\.on\([\s\S]*?table\.idempotencyKey[\s\S]*?\),?\s*\)/,
    )
  })
})
