/**
 * @athlos/db/repositories/permissions — PermissionsRepo
 *
 * Provides hasPermission, grant, revoke for role_permissions table.
 * Used by requirePermission() gate in @athlos/auth to check data_steward
 * and future permission keys at request time.
 *
 * TWO-WRITE-PATH WARNING (design §5):
 *   - Operator events → audit.middleware → emitAudit() → this table
 *     (audit_events rows are written by the audit plugin with operator_id set)
 *   - System events → drift.emitDriftAlert() → direct Drizzle insert
 *     (audit_events rows written directly with operator_id = NULL)
 * Both paths write to audit_events; the middleware path is the one that
 * uses this permissions table (DATA_STEWARD receives drift_alert notifications).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../pool'
import { rolePermissions } from '../schema/operators.js'

export interface PermissionsRepo {
  hasPermission(operatorId: string, key: string): Promise<boolean>
  grant(operatorId: string, key: string, grantedBy: string | null): Promise<void>
  revoke(operatorId: string, key: string): Promise<void>
}

export function makePermissionsRepo(db: Db): PermissionsRepo {
  return {
    async hasPermission(operatorId, key) {
      const [row] = await db
        .select({ x: sql`1` })
        .from(rolePermissions)
        .where(
          and(eq(rolePermissions.operatorId, operatorId), eq(rolePermissions.permissionKey, key)),
        )
        .limit(1)
      return !!row
    },

    async grant(operatorId, key, grantedBy) {
      await db
        .insert(rolePermissions)
        .values({ operatorId, permissionKey: key, grantedBy })
        .onConflictDoNothing()
    },

    async revoke(operatorId, key) {
      await db
        .delete(rolePermissions)
        .where(
          and(eq(rolePermissions.operatorId, operatorId), eq(rolePermissions.permissionKey, key)),
        )
    },
  }
}
