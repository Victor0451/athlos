import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, pgSchema, text, unique } from 'drizzle-orm/pg-core'

/** Read-only accounting chart catalog; chart administration is intentionally deferred. */
export const contabilidadSchema = pgSchema('contabilidad')

export const planCuentas = contabilidadSchema.table(
  'plan_cuentas',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    parentCode: text('parent_code'),
    rootCode: text('root_code').notNull(),
    active: boolean('active').notNull(),
    imputable: boolean('imputable').notNull(),
  },
  (table) => ({
    parentRootUnique: unique('plan_cuentas_parent_root_unique').on(table.code, table.rootCode),
    parentForeignKey: foreignKey({
      name: 'plan_cuentas_parent_fk',
      columns: [table.parentCode, table.rootCode],
      foreignColumns: [table.code, table.rootCode],
    }).onDelete('restrict'),
    rootCodeCheck: check(
      'plan_cuentas_root_code_check',
      sql`${table.rootCode} IN ('1', '2', '3', '4', '5')`,
    ),
    rootHierarchyCheck: check(
      'plan_cuentas_root_hierarchy_check',
      sql`(${table.parentCode} IS NULL AND ${table.code} = ${table.rootCode} AND ${table.imputable} = false)
        OR (${table.parentCode} IS NOT NULL AND ${table.code} <> ${table.rootCode})`,
    ),
    imputableActiveCheck: check(
      'plan_cuentas_imputable_active_check',
      sql`${table.imputable} = false OR ${table.active} = true`,
    ),
  }),
)

export type PlanCuenta = typeof planCuentas.$inferSelect
export type NewPlanCuenta = typeof planCuentas.$inferInsert
