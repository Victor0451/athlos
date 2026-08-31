import { expect, it } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { insertAllocation } from './allocations.ts'

const ids = {
  settlement: '00000000-0000-4000-8000-000000000001',
  socio: '00000000-0000-4000-8000-000000000002',
  obligation: '00000000-0000-4000-8000-000000000003',
  allocation: '00000000-0000-4000-8000-000000000004',
}

function sqlText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(sqlText).join('')
  if (!value || typeof value !== 'object') return ''
  const record = value as { queryChunks?: unknown; value?: unknown }
  return sqlText(record.queryChunks) || sqlText(record.value)
}

function setup(outstandingAfterCondonation: string) {
  const execute = async (statement: unknown) => {
    const text = sqlText(statement)
    if (text.includes('FROM tesoreria.dues_settlements WHERE id'))
      return { rows: [{ socioId: ids.socio, amount: '10.00' }] }
    if (text.includes('FROM tesoreria.dues_obligations WHERE id'))
      return { rows: [{ id: ids.obligation, socioId: ids.socio, amount: '10.00' }] }
    if (text.includes('dues_condonation_treatments'))
      return { rows: [{ amount: outstandingAfterCondonation }] }
    if (text.includes('FROM tesoreria.dues_allocations WHERE obligation_id'))
      return { rows: [{ amount: '10.00' }] }
    if (text.includes('settlement_id') && text.includes("kind = 'ALLOCATION'"))
      return { rows: [{ amount: '0.00' }] }
    if (text.includes('INSERT INTO tesoreria.dues_allocations'))
      return {
        rows: [
          {
            id: ids.allocation,
            settlementId: ids.settlement,
            obligationId: ids.obligation,
            kind: 'ALLOCATION',
            amount: '5.00',
            compensatesAllocationId: null,
          },
        ],
      }
    throw new Error(`Unexpected SQL: ${text}`)
  }
  return { execute }
}

const allocationInput = (amountCents: number) => ({
  settlementId: ids.settlement,
  socioId: ids.socio,
  obligationId: ids.obligation,
  amountCents,
})

it('uses condonation treatments in the allocation balance guard', async () => {
  await expect(
    insertAllocation(setup('5.00') as never, allocationInput(500)),
  ).resolves.toMatchObject({
    id: ids.allocation,
  })
  await expect(
    insertAllocation(setup('5.00') as never, allocationInput(501)),
  ).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  await expect(insertAllocation(setup('0.00') as never, allocationInput(1))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
})

it('keeps compensation independent from condonation balance checks', async () => {
  const db = {
    execute: async (statement: unknown) => {
      const text = sqlText(statement)
      if (text.includes('FROM tesoreria.dues_settlements WHERE id'))
        return { rows: [{ socioId: ids.socio, amount: '10.00' }] }
      if (text.includes('FROM tesoreria.dues_obligations WHERE id'))
        return { rows: [{ id: ids.obligation, socioId: ids.socio, amount: '10.00' }] }
      if (text.includes('WHERE id ='))
        return { rows: [{ obligationId: ids.obligation, amount: '5.00' }] }
      if (text.includes('INSERT INTO tesoreria.dues_allocations'))
        return {
          rows: [
            {
              id: ids.allocation,
              settlementId: ids.settlement,
              obligationId: ids.obligation,
              kind: 'COMPENSATION',
              amount: '5.00',
              compensatesAllocationId: ids.allocation,
            },
          ],
        }
      throw new Error(`Unexpected SQL: ${text}`)
    },
  }
  await expect(
    insertAllocation(db as never, {
      ...allocationInput(500),
      kind: 'COMPENSATION',
      compensatesAllocationId: ids.allocation,
    }),
  ).resolves.toMatchObject({ kind: 'COMPENSATION' })
})
