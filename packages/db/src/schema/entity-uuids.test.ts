import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { EntityUuid } from './public.ts'

/**
 * TASK-061: entity_uuids migration + Drizzle schema
 *
 * RED phase: integration test that asserts the table shape.
 * The migration 0007_entity_uuids.sql creates the table and the
 * Drizzle schema exports EntityUuid. This test verifies:
 *   - EntityUuid type is correctly inferred with required fields
 *   - Migration file exists with correct DDL
 *
 * GREEN phase: write 0007_entity_uuids.sql + add entityUuids to public.ts
 *
 * Path resolution uses import.meta.url (ESM-safe) so the tests work
 * regardless of where vitest is invoked from (monorepo root vs. package dir).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Test lives at packages/db/src/schema/, so PACKAGE_ROOT is packages/db (2 levels up).
const PACKAGE_ROOT = path.join(__dirname, '..', '..')

describe('entityUuids schema', () => {
  it('EntityUuid type is exported and has required fields', () => {
    // EntityUuid must have sourceTable, sourceKey, entityUuid, createdAt
    type Expected = {
      sourceTable: string
      sourceKey: string
      entityUuid: string
      createdAt: Date
    }
    type _Check = EntityUuid extends Expected ? true : false
    const _typeCheck: _Check = true
    expect(_typeCheck).toBe(true)
  })
})

describe('0007_entity_uuids migration', () => {
  it('migration file creates entity_uuids table with correct columns', async () => {
    // Read the migration file and assert its content
    const fs = await import('node:fs/promises')
    const migrationPath = path.join(PACKAGE_ROOT, 'drizzle/0007_entity_uuids.sql')
    const content = await fs.readFile(migrationPath, 'utf-8')

    // Table creation
    expect(content).toContain('CREATE TABLE "entity_uuids"')
    expect(content).toContain('"source_table"')
    expect(content).toContain('"source_key"')
    expect(content).toContain('"entity_uuid"')
    expect(content).toContain('"created_at"')

    // Column types
    expect(content).toContain('varchar(32)')
    expect(content).toContain('varchar(64)')
    expect(content).toContain('uuid')

    // Composite PK
    expect(content).toContain('PRIMARY KEY ("source_table", "source_key")')

    // Unique constraint on entity_uuid
    expect(content).toContain('UNIQUE')
    expect(content).toContain('"entity_uuid"')
  })
})
