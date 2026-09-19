import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { contabilidadSchema, planCuentas } from './contabilidad.ts'

describe('account chart schema bindings', () => {
  it('exports the read-only plan_cuentas catalog with its stable hierarchy fields', () => {
    const config = getTableConfig(planCuentas)

    expect(contabilidadSchema.schemaName).toBe('contabilidad')
    expect(config.name).toBe('plan_cuentas')
    expect(config.columns.map((column) => column.name)).toEqual([
      'code',
      'name',
      'parent_code',
      'root_code',
      'active',
      'imputable',
    ])
    expect(config.columns.find((column) => column.name === 'code')).toMatchObject({ primary: true })
    expect(config.columns.find((column) => column.name === 'parent_code')).toMatchObject({
      notNull: false,
    })
    expect(config.uniqueConstraints).toHaveLength(1)
    expect(config.uniqueConstraints.map((constraint) => constraint.getName())).toEqual([
      'plan_cuentas_parent_root_unique',
    ])
    expect(config.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
      'code',
      'root_code',
    ])
    expect(config.foreignKeys).toHaveLength(1)
    expect(config.foreignKeys[0]?.getName()).toBe('plan_cuentas_parent_fk')
    expect(config.foreignKeys[0]?.reference()).toMatchObject({
      name: 'plan_cuentas_parent_fk',
      columns: [
        expect.objectContaining({ name: 'parent_code' }),
        expect.objectContaining({ name: 'root_code' }),
      ],
      foreignColumns: [
        expect.objectContaining({ name: 'code' }),
        expect.objectContaining({ name: 'root_code' }),
      ],
    })
    expect(config.foreignKeys[0]).toMatchObject({ onDelete: 'restrict' })
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      'plan_cuentas_root_code_check',
      'plan_cuentas_root_hierarchy_check',
      'plan_cuentas_imputable_active_check',
    ])
  })
})
