import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { sql } from 'drizzle-orm'

type DuesDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0]
type AutomaticDuesProductionInput = {
  shiftId: string
  settlementId: string
  origin: string
}
type AccountSnapshot = {
  code: string
  name: string
  eligible: boolean
  path: unknown
}

const productionAccounts: Record<string, string> = {
  AUTOMATIC_DUES_PRODUCTION: '4.1.01',
}
const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []

export async function recordAutomaticDuesProductionSource(
  db: DuesDb,
  input: AutomaticDuesProductionInput,
) {
  const accountCode = productionAccounts[input.origin]
  if (!accountCode)
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Automatic production origin is not mapped to an account',
    )

  const account = rows<AccountSnapshot>(
    await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT code,name,parent_code,root_code,active,imputable,0 AS depth
        FROM contabilidad.plan_cuentas WHERE code=${accountCode}
        UNION ALL
        SELECT parent.code,parent.name,parent.parent_code,parent.root_code,parent.active,parent.imputable,ancestors.depth + 1
        FROM contabilidad.plan_cuentas parent
        JOIN ancestors ON ancestors.parent_code=parent.code AND ancestors.root_code=parent.root_code
      )
      SELECT
        (SELECT code FROM ancestors WHERE depth=0) AS code,
        (SELECT name FROM ancestors WHERE depth=0) AS name,
        (SELECT active AND imputable FROM ancestors WHERE depth=0) AS eligible,
        jsonb_agg(jsonb_build_object('code',code,'name',name) ORDER BY depth DESC) AS path
      FROM ancestors
    `),
  )[0]
  if (!account?.eligible)
    throw BusinessError(ErrorCode.CONFLICT, 'Automatic dues production account is unavailable')

  const path = JSON.stringify(account.path)
  const inserted = rows<{ id: string }>(
    await db.execute(sql`
      INSERT INTO tesoreria.dues_cash_sources
        (shift_id,settlement_id,origin,account_code_snapshot,account_name_snapshot,account_path_snapshot)
      VALUES (${input.shiftId},${input.settlementId},${input.origin},${account.code},${account.name},${path}::jsonb)
      ON CONFLICT (settlement_id) DO NOTHING RETURNING id
    `),
  )[0]
  if (inserted) return inserted

  const retained = rows<{ id: string }>(
    await db.execute(sql`
      SELECT id FROM tesoreria.dues_cash_sources
      WHERE settlement_id=${input.settlementId}
        AND shift_id=${input.shiftId}
        AND origin=${input.origin}
        AND account_code_snapshot=${account.code}
        AND account_name_snapshot=${account.name}
        AND account_path_snapshot=${path}::jsonb
      FOR SHARE
    `),
  )[0]
  if (!retained)
    throw BusinessError(ErrorCode.CONFLICT, 'Retained automatic production source is inconsistent')
  return retained
}
