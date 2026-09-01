import { expect, it } from 'vitest'
import { getDebt, selectFullOutstanding } from './allocations.ts'

const ids = {
  socio: '00000000-0000-4000-8000-000000000001',
  obligation: '00000000-0000-4000-8000-000000000002',
}

function sqlText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(sqlText).join('')
  if (!value || typeof value !== 'object') return ''
  const record = value as { queryChunks?: unknown; value?: unknown }
  return sqlText(record.queryChunks) || sqlText(record.value)
}

it('selects full outstanding amounts after condonation treatments', async () => {
  const statements: string[] = []
  const db = {
    execute: async (statement: unknown) => {
      statements.push(sqlText(statement))
      return {
        rows: [{ id: ids.obligation, socioId: ids.socio, currency: 'ARS', outstanding: '5.00' }],
      }
    },
  }

  await expect(
    selectFullOutstanding(db as never, { socioId: ids.socio, obligationIds: [ids.obligation] }),
  ).resolves.toMatchObject({ totalCents: 500 })
  expect(statements[0]).toContain('dues_condonation_treatments')
})

it('includes condonation treatments in debt projections', async () => {
  const statements: string[] = []
  const db = {
    execute: async (statement: unknown) => {
      const text = sqlText(statement)
      statements.push(text)
      if (text.includes('SELECT EXISTS')) return { rows: [{ exists: true }] }
      return {
        rows: [
          {
            id: ids.obligation,
            periodStart: '2025-01-01',
            periodEnd: '2025-01-31',
            amount: '10.00',
            outstanding: '5.00',
            currency: 'ARS',
            components: [],
            allocations: [],
          },
        ],
      }
    },
  }

  await expect(getDebt(db as never, ids.socio)).resolves.toMatchObject({ totalCents: 500 })
  expect(statements).toHaveLength(2)
  expect(statements[1]).toContain('dues_condonation_treatments')
})
