/**
 * @athlos/db/repositories/operators — OperatorsRepo
 *
 * Provides findByUsername for the data-steward grant CLI.
 * Used by grant-data-steward.ts to resolve usernames to operator IDs.
 */
import { eq } from 'drizzle-orm'
import type { Db } from '../pool'
import { operators } from '../schema/operators.js'

export interface OperatorsRepo {
  findByUsername(username: string): Promise<typeof operators.$inferSelect | null>
}

export function makeOperatorsRepo(db: Db): OperatorsRepo {
  return {
    async findByUsername(username: string) {
      const [row] = await db
        .select()
        .from(operators)
        .where(eq(operators.username, username))
        .limit(1)
      return row ?? null
    },
  }
}
