import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '@athlos/db'

export type AccountChartFilter = {
  code?: string
  name?: string
  root?: string
  group?: string
  active?: boolean
}

type AccountChartRow = {
  code: string
  name: string
  parentCode: string | null
  parentName: string | null
  rootCode: string
  rootName: string
  pathCodes: string[]
  pathNames: string[]
  active: boolean
  imputable: boolean
}

export type AccountChartItem = {
  code: string
  name: string
  parent: { code: string; name: string } | null
  root: { code: string; name: string }
  path: Array<{ code: string; name: string }>
  active: boolean
  imputable: boolean
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
const search = (column: SQL, value: string) =>
  sql`translate(lower(${column}), 'áéíóúüñ', 'aeiouun') LIKE ${`%${escapeLike(normalized(value))}%`} ESCAPE E'\\\\'`

export async function listAccountChart(db: Db, filter: AccountChartFilter = {}) {
  const conditions: SQL[] = []
  if (filter.code) conditions.push(search(sql`h.code`, filter.code))
  if (filter.name) conditions.push(search(sql`h.name`, filter.name))
  if (filter.root) conditions.push(sql`h.root_code = ${filter.root}`)
  if (filter.group) conditions.push(sql`${filter.group} = ANY(h.path_codes)`)
  if (filter.active !== undefined) conditions.push(sql`h.active = ${filter.active}`)
  const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``
  const result = await db.execute<AccountChartRow>(sql`
    WITH RECURSIVE hierarchy AS (
      SELECT code,name,parent_code,root_code,active,imputable,
        ARRAY[code] AS path_codes,ARRAY[name] AS path_names,name AS root_name
      FROM contabilidad.plan_cuentas WHERE parent_code IS NULL
      UNION ALL
      SELECT child.code,child.name,child.parent_code,child.root_code,child.active,child.imputable,
        parent.path_codes || child.code,parent.path_names || child.name,parent.root_name
      FROM contabilidad.plan_cuentas child
      JOIN hierarchy parent ON child.parent_code = parent.code AND child.root_code = parent.root_code
    )
    SELECT h.code,h.name,h.parent_code AS "parentCode",parent.name AS "parentName",
      h.root_code AS "rootCode",h.root_name AS "rootName",h.path_codes AS "pathCodes",
      h.path_names AS "pathNames",h.active,h.imputable
    FROM hierarchy h LEFT JOIN contabilidad.plan_cuentas parent ON parent.code = h.parent_code
    ${where}
    ORDER BY h.root_code,string_to_array(h.code,'.')::integer[]
  `)
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    parent:
      row.parentCode && row.parentName ? { code: row.parentCode, name: row.parentName } : null,
    root: { code: row.rootCode, name: row.rootName },
    path: row.pathCodes.map((code, index) => ({ code, name: row.pathNames[index]! })),
    active: row.active,
    imputable: row.imputable,
  })) satisfies AccountChartItem[]
}
