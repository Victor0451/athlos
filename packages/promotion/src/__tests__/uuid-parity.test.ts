/**
 * uuid-parity.test.ts — Hash parity test for E3 N14 closure.
 *
 * CRITICAL GATE: This test verifies that TypeScript `deterministicUuid()`
 * and PostgreSQL `promotion_deterministic_uuid()` produce byte-for-byte
 * identical UUIDs for the same natural key input.
 *
 * Migration 0018 MUST NOT be applied if this test fails — a mismatch would
 * silently corrupt cross-run idempotency for ~571k rows.
 *
 * Run AFTER migration 0017 is applied (so the SQL function exists in DB),
 * BEFORE migration 0018 is applied (so no legacy_id is populated yet).
 */
import { describe, it, expect } from 'vitest'
import { deterministicUuid } from '../transform-helpers.ts'

// 5 known inputs spanning edge cases (per design §4.1):
// 1. ctacte: 0-CCTCUENTA sentinel edge case (FK-blocked)
// 2. ctacte: real socio 5343
// 3. ctacte1: real pagonro 179440
// 4. all-zero edge case
// 5. future date + max values
const PARITY_INPUTS: Array<{ input: string; label: string }> = [
  { input: '0|2016-10-24|9895|9|1', label: 'ctacte: 0-CCTCUENTA sentinel' },
  { input: '5343|2015-04-07|86846|4|1', label: 'ctacte: real socio 5343' },
  { input: '179440|4|1|1|5343', label: 'ctacte1: pagonro|pagosec|pagotal|pagofam|cuenta' },
  { input: '0|0|0|0|0', label: 'all-zero edge case' },
  { input: '999999|2099-12-31|999999999|12|9', label: 'future date + max values' },
]

describe('uuid-parity (CRITICAL GATE — E3 N14 closure)', () => {
  it.each(PARITY_INPUTS)(
    'input %s (%s) — TypeScript deterministicUuid() === PostgreSQL promotion_deterministic_uuid()',
    async ({ input, label }) => {
      // Step 1: Compute expected UUID via TypeScript (reference implementation)
      const tsHash = deterministicUuid(input)

      // Step 2: Fetch from PostgreSQL via psql
      // This requires migration 0017 to be applied (the SQL function must exist)
      const { execSync } = await import('node:child_process')
      const pgResult = execSync(
        `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -t -A -c "SELECT promotion_deterministic_uuid('${input.replace(/'/g, "''")}');"`,
        { encoding: 'utf-8' },
      ).trim()

      const pgHash = pgResult

      // Step 3: Assert byte-for-byte equality
      expect(pgHash, `[${label}] PostgreSQL output is undefined or empty`).toBeDefined()
      expect(pgHash, `[${label}] PostgreSQL output is empty`).not.toBe('')
      expect(pgHash.length, `[${label}] PostgreSQL output length should be 36 (UUID format)`).toBe(
        36,
      )
      expect(tsHash.length, `[${label}] TypeScript output length should be 36 (UUID format)`).toBe(
        36,
      )
      expect(
        pgHash,
        `[${label}] TypeScript !== PostgreSQL\nInput: ${input}\nTypeScript: ${tsHash}\nPostgreSQL: ${pgHash}`,
      ).toBe(tsHash)
    },
  )
})
