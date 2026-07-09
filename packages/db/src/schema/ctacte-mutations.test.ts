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
})
