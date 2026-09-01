import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { approvalTokens } from './approval-tokens.ts'
import { duesCondonationExecutions, duesCondonationTreatments } from './dues.ts'

const columnNames = (config: ReturnType<typeof getTableConfig>) =>
  config.columns.map((column) => column.name)
const constraintNames = (config: ReturnType<typeof getTableConfig>) => ({
  checks: config.checks.map((constraint) => constraint.name),
  indexes: config.indexes.map((constraint) => constraint.config.name),
  uniques: config.uniqueConstraints.map((constraint) => constraint.name),
})
const approvalTokenForeignKey = (config: ReturnType<typeof getTableConfig>) =>
  config.foreignKeys.find(
    (foreignKey) => foreignKey.reference().foreignColumns[0] === approvalTokens.id,
  )

describe('dues condonation schema bindings', () => {
  it('exports execution and treatment bindings for migration 0064', () => {
    const execution = getTableConfig(duesCondonationExecutions)
    const treatment = getTableConfig(duesCondonationTreatments)

    expect(execution.name).toBe('dues_condonation_executions')
    expect(columnNames(execution)).toEqual([
      'execution_id',
      'approval_token_id',
      'socio_id',
      'actor_id',
      'currency',
      'total_amount',
      'approved_snapshot',
      'reason',
      'evidence',
      'created_at',
    ])
    expect(execution.columns.find((column) => column.name === 'execution_id')).toMatchObject({
      primary: true,
    })
    expect(execution.columns.find((column) => column.name === 'approval_token_id')).toMatchObject({
      isUnique: true,
    })
    expect(approvalTokenForeignKey(execution)).toMatchObject({
      onDelete: 'restrict',
    })
    expect(constraintNames(execution)).toEqual({
      checks: [
        'dues_condonation_executions_total_check',
        'dues_condonation_executions_currency_check',
      ],
      indexes: [],
      uniques: [],
    })

    expect(treatment.name).toBe('dues_condonation_treatments')
    expect(columnNames(treatment)).toEqual([
      'id',
      'execution_id',
      'approval_token_id',
      'socio_id',
      'obligation_id',
      'actor_id',
      'amount',
      'currency',
      'approved_snapshot',
      'reason',
      'evidence',
      'created_at',
    ])
    expect(treatment.columns.find((column) => column.name === 'id')).toMatchObject({
      primary: true,
    })
    expect(approvalTokenForeignKey(treatment)).toMatchObject({
      onDelete: 'restrict',
    })
    expect(constraintNames(treatment)).toEqual({
      checks: [
        'dues_condonation_treatments_amount_check',
        'dues_condonation_treatments_currency_check',
      ],
      indexes: [
        'dues_condonation_treatments_execution_obligation_unique',
        'dues_condonation_treatments_obligation_idx',
      ],
      uniques: [],
    })
  })
})
