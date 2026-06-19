# Delta for auth-login

This change adds 4 new scenarios under the existing `Permission Enforcement` requirement in `auth-login`. No requirement text changes, no new requirements, no new capabilities, no removed or renamed requirements.

The new scenarios cover the `pnpm ops:grant-data-steward` CLI introduced by this change: username resolution via the new `OperatorsRepo.findByUsername()`, idempotency (re-uses `PermissionsRepo.grant()` which has `ON CONFLICT DO NOTHING`), unknown-username failure, `--json` output shape validated by Zod, and `--from-env` mode reading the `DATA_STEWARD_OPERATOR_IDS` environment variable.

The bucketization of `granted` vs `alreadyGranted` for the `--json` output is achieved by pre-checking `PermissionsRepo.hasPermission(operatorId, 'data_steward')` before calling `PermissionsRepo.grant()`. This is necessary because `PermissionsRepo.grant()` returns `Promise<void>` (no `RETURNING` clause), so the script cannot distinguish "newly inserted" from "ON CONFLICT skipped" from the repo call alone. No repository signature change is introduced.

The audit emission uses `emitAudit(db, { operatorId: null, action: 'permission.granted', entityType: 'role_permission', entityId: <operator-uuid>, payload: { permissionKey: 'data_steward', grantedBy: null } })` from `@athlos/audit/emitter`. The 10-second SHA-256 bucket dedup behavior of `emitAudit` (documented at `packages/audit/src/emitter.ts`) is acceptable for this runbook use case (single-shot invocations separated by ≥10s).

## MODIFIED Requirements

### Requirement: Permission Enforcement

The system MUST enforce granular permissions: can_reprint (allows reprinting receipts/reports) and can_anulate (allows voiding transactions).

#### Scenario: can_reprint permission check

- GIVEN authenticated operator with role=OPERADOR and can_reprint=false
- WHEN POST /api/reports/reprint is called
- THEN response MUST return 403 Forbidden with {"error":"MISSING_PERMISSION:can_reprint"}

#### Scenario: can_anulate permission check

- GIVEN authenticated operator with role=TESORERO and can_anulate=true
- WHEN POST /api/transactions/123/anular is called
- THEN request MUST be allowed

#### Scenario: Operator grants data_steward via CLI

- GIVEN operator `<username>` exists in the `operators` table with `isActive = true`
- AND `<username>` does NOT currently hold the `data_steward` permission
- WHEN an operator runs `pnpm ops:grant-data-steward --username <username>`
- THEN the script SHALL resolve `<username>` to `operatorId` via `OperatorsRepo.findByUsername('<username>')`
- AND SHALL call `PermissionsRepo.grant(operatorId, 'data_steward', null)`
- AND SHALL emit exactly one `permission.granted` audit row via `emitAudit(db, { operatorId: null, action: 'permission.granted', entityType: 'role_permission', entityId: operatorId, payload: { permissionKey: 'data_steward', grantedBy: null } })`
- AND SHALL exit 0

#### Scenario: CLI grant is idempotent on re-run

- GIVEN operator `<username>` already holds the `data_steward` permission (granted by a prior invocation)
- WHEN an operator runs `pnpm ops:grant-data-steward --username <username>`
- THEN `PermissionsRepo.grant()` SHALL be called without error (the underlying `ON CONFLICT DO NOTHING` absorbs the duplicate-key conflict)
- AND the script SHALL pre-check `PermissionsRepo.hasPermission(operatorId, 'data_steward')` and bucket the operator in `alreadyGranted` (not `granted`) in the `--json` output
- AND the `role_permissions` table SHALL NOT receive a duplicate row
- AND the script SHALL NOT emit a new `permission.granted` audit row when the audit's 10-second SHA-256 idempotency bucket matches the prior emission
- AND the script SHALL exit 0

#### Scenario: CLI exits 1 on unknown username

- GIVEN no operator with username `<unknown>` exists in the `operators` table
- WHEN an operator runs `pnpm ops:grant-data-steward --username <unknown>`
- THEN the script SHALL exit 1
- AND SHALL print a clear error to stderr identifying the missing username (`operator not found: <unknown>` or equivalent)
- AND SHALL NOT call `PermissionsRepo.grant()`
- AND SHALL NOT emit any audit row

#### Scenario: CLI --json output shape is Zod-validated

- GIVEN any successful or idempotent grant invocation (one or more `--username` flags)
- WHEN the operator runs `pnpm ops:grant-data-steward --username <u1> --username <u2> --json`
- THEN the script SHALL emit a single JSON object on stdout
- AND the JSON object SHALL match exactly the Zod schema in `packages/db/src/scripts/grant-data-steward.schema.ts` with three fields: `granted: string[]` (UUIDs newly granted), `alreadyGranted: string[]` (UUIDs that already held the permission), `auditIds: string[]` (audit row IDs for the grants in this invocation)
- AND the script SHALL exit 0