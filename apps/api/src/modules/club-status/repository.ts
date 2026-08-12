import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import type { ClubStatusRepository, DateWindow, FinanceAggregate } from './types.ts'

const money = (value: unknown) => Number(value).toFixed(2)

export function createClubStatusRepository(db: Db): ClubStatusRepository {
  return {
    async finance(window: DateWindow): Promise<FinanceAggregate> {
      const result = (await db.execute(
        sql`SELECT COALESCE(SUM(debe::numeric), 0) AS debits, COALESCE(SUM(haber::numeric), 0) AS credits FROM tesoreria.ctacte WHERE anulado = false AND fecha >= ${window.from} AND fecha < ${window.until}`,
      )) as unknown as { rows: Array<{ debits: unknown; credits: unknown }> }
      const row = result.rows[0] ?? { debits: 0, credits: 0 },
        debits = money(row.debits),
        credits = money(row.credits)
      return { debits, credits, net: money(Number(debits) - Number(credits)) }
    },
    async activeMembership() {
      const result = (await db.execute(
        sql`SELECT COUNT(*) AS value FROM socios.socios WHERE estado = 'activo'`,
      )) as unknown as { rows: Array<{ value: unknown }> }
      return Number(result.rows[0]?.value ?? 0)
    },
  }
}
