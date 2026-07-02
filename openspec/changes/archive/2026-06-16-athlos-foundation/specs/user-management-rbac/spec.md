# User Management and RBAC Specification

## Purpose

Defines how Athlos manages operator accounts, assigns roles, and enforces role-based access control (RBAC) across the system. This spec extends the authentication contract from `auth-login` with the operator lifecycle, the complete role/permission matrix, delegation flows, and self-service operations. It is the single source of truth for "who can do what" in Athlos.

## Scope

- Operator CRUD lifecycle (admin-managed) and self-service profile operations.
- The complete role and permission matrix.
- Permission enforcement architecture (Fastify `preHandler` hooks).
- Temporary role/permission delegation between operators.
- Audit logging of all permission denials and administrative changes.

## Permission Model

### Requirement: Role Catalog

The system MUST support exactly four roles: `ADMIN`, `TESORERO`, `OPERADOR`, `CONSULTA`. The role value MUST be one of these four strings, enforced by a database `CHECK` constraint and validated at the application boundary.

#### Scenario: Invalid role rejected at creation

- GIVEN an authenticated ADMIN operator
- WHEN POST /api/operators is called with `{"role":"SUPERUSER"}`
- THEN response MUST return 400 Bad Request with `{"error":"INVALID_ROLE"}`

#### Scenario: Role catalog is closed

- GIVEN the operators table schema
- WHEN a migration attempts to insert `role='AUXILIAR'`
- THEN the database MUST reject the insert with a constraint violation

### Requirement: Role-Default Permission Matrix

The system MUST apply the following default permissions on operator creation, and MUST resolve effective permissions as `role_defaults ⊕ operator_overrides` (granular flags override the role default).

| Role | can_reprint | can_anulate | Read all domains | Write financial | Manage operators |
|------|-------------|-------------|------------------|-----------------|------------------|
| ADMIN | true | true | yes | yes | yes |
| TESORERO | true | true | yes | yes | no |
| OPERADOR | false | false | yes | no | yes (data masters only) |
| CONSULTA | false | false | yes | no | no |

#### Scenario: Tesorero with overridden can_anulate=false

- GIVEN operator "ana" with role=TESORERO and `can_anulate=false` (admin override)
- WHEN POST /api/transactions/123/anular is called by "ana"
- THEN response MUST return 403 Forbidden with `{"error":"MISSING_PERMISSION:can_anulate"}`
- AND the denial MUST be recorded in `audit_events`

#### Scenario: Admin can override granular permissions on any operator

- GIVEN operator "ana" with role=TESORERO
- WHEN PATCH /api/operators/{ana.id} is called by an ADMIN with `{"can_anulate":true}`
- THEN "ana"'s effective `can_anulate` MUST be true
- AND the change MUST be recorded in `audit_events` as `PERMISSION_OVERRIDE`

### Requirement: Granular Permission Flags

The system MUST enforce exactly two granular boolean flags on each operator: `can_reprint` and `can_anulate`. No additional granular flags SHALL be added without a spec change. The flags override the role default but SHALL NOT escalate a CONSULTA into a writer.

#### Scenario: Consulta cannot be escalated via granular flags

- GIVEN operator "luis" with role=CONSULTA
- WHEN PATCH /api/operators/{luis.id} is called with `{"can_reprint":true,"can_anulate":true}`
- THEN response MUST return 403 Forbidden with `{"error":"CANNOT_ESCALATE_READONLY_ROLE"}`

## Operator Lifecycle

### Requirement: Operator Creation

The system MUST allow only authenticated ADMIN operators to create new operators via `POST /api/operators`. The endpoint MUST require: `username`, `password`, `role`. Granular permissions default to the role defaults defined above and MAY be overridden in the same request.

#### Scenario: Admin creates OPERADOR

- GIVEN authenticated ADMIN operator
- WHEN POST /api/operators is called with `{"username":"pepe","password":"Temp123!","role":"OPERADOR"}`
- THEN response MUST return 201 Created with the new operator (password_hash NOT included)
- AND the new operator's `can_reprint` and `can_anulate` MUST default to false

#### Scenario: Non-admin cannot create operators

- GIVEN authenticated TESORERO operator
- WHEN POST /api/operators is called
- THEN response MUST return 403 Forbidden with `{"error":"INSUFFICIENT_PERMISSIONS"}`

#### Scenario: Duplicate username rejected

- GIVEN operator "ana" already exists with username="ana"
- WHEN POST /api/operators is called with `username="ana"`
- THEN response MUST return 409 Conflict with `{"error":"USERNAME_TAKEN"}`

### Requirement: Operator Update

The system MUST allow only ADMIN operators to update operator records via `PATCH /api/operators/{id}`. The endpoint MUST allow updating: `role`, `can_reprint`, `can_anulate`, `is_active`. Operators MUST NOT be able to update their own role or granular permissions.

#### Scenario: Admin updates operator role

- GIVEN operator "pepe" with role=OPERADOR
- WHEN PATCH /api/operators/{pepe.id} is called by ADMIN with `{"role":"TESORERO"}`
- THEN response MUST return 200 OK with updated operator
- AND the change MUST be recorded in `audit_events` as `OPERATOR_ROLE_CHANGED`

#### Scenario: Self-update of role forbidden

- GIVEN authenticated operator "vlongo" with role=ADMIN
- WHEN PATCH /api/operators/{vlongo.id} is called with `{"role":"CONSULTA"}`
- THEN response MUST return 403 Forbidden with `{"error":"CANNOT_MODIFY_OWN_ROLE"}`

### Requirement: Operator Deactivation

The system MUST allow only ADMIN operators to deactivate operators via `DELETE /api/operators/{id}`. Deactivation is soft-delete: `is_active=false`. The system MUST revoke all active refresh tokens for the deactivated operator and MUST prevent login. Self-deactivation SHALL be forbidden.

#### Scenario: Admin deactivates operator

- GIVEN operator "pepe" with role=OPERADOR and 2 active refresh tokens
- WHEN DELETE /api/operators/{pepe.id} is called by ADMIN
- THEN response MUST return 204 No Content
- AND `operators.is_active` for "pepe" MUST be false
- AND both refresh tokens MUST be revoked
- AND any subsequent POST /api/auth/login by "pepe" MUST return 401 with `{"error":"ACCOUNT_DISABLED"}`

#### Scenario: Self-deactivation forbidden

- GIVEN authenticated operator "vlongo" with role=ADMIN
- WHEN DELETE /api/operators/{vlongo.id} is called
- THEN response MUST return 403 Forbidden with `{"error":"CANNOT_DEACTIVATE_SELF"}`

### Requirement: Admin-Initiated Password Reset

The system MUST allow only ADMIN operators to reset another operator's password via `POST /api/operators/{id}/reset-password`. The endpoint MUST return a one-time temporary password (or a one-time reset link), MUST force a password change on next login, and MUST revoke all active refresh tokens for that operator.

#### Scenario: Admin resets operator password

- GIVEN operator "pepe" with active session
- WHEN POST /api/operators/{pepe.id}/reset-password is called by ADMIN
- THEN response MUST return 200 OK with a temporary password
- AND all of "pepe"'s refresh tokens MUST be revoked
- AND `operators.must_change_password` for "pepe" MUST be true
- AND the action MUST be recorded in `audit_events` as `PASSWORD_RESET_BY_ADMIN`

#### Scenario: Non-admin cannot reset passwords

- GIVEN authenticated TESORERO operator
- WHEN POST /api/operators/{pepe.id}/reset-password is called
- THEN response MUST return 403 Forbidden

### Requirement: Self-Service Password Change

The system MUST allow any authenticated operator to change their own password via `POST /api/auth/change-password`. The endpoint MUST require current password and SHALL NOT accept a recent-password reuse (last 5).

#### Scenario: Operator changes own password

- GIVEN authenticated operator "pepe" with current password="Temp123!"
- WHEN POST /api/auth/change-password is called with `{"current_password":"Temp123!","new_password":"NewPass456!"}`
- THEN response MUST return 200 OK
- AND the new password_hash MUST be stored
- AND the action MUST be recorded in `audit_events`

#### Scenario: Wrong current password rejected

- GIVEN authenticated operator "pepe"
- WHEN POST /api/auth/change-password is called with `{"current_password":"wrong","new_password":"NewPass456!"}`
- THEN response MUST return 401 Unauthorized with `{"error":"INVALID_CURRENT_PASSWORD"}`

#### Scenario: Password reuse rejected

- GIVEN operator "pepe" previously used passwords P1, P2, P3, P4, P5
- WHEN POST /api/auth/change-password is called with `new_password="P3"`
- THEN response MUST return 400 Bad Request with `{"error":"PASSWORD_RECENTLY_USED"}`

## Permission Enforcement

### Requirement: Enforcement Layer

The system MUST enforce all role and permission checks in Fastify `preHandler` hooks, NOT in route handlers or service layers. The hooks MUST be: `requireRole(...allowedRoles)` and `requirePermission('can_reprint' | 'can_anulate')`. Every protected route MUST declare at least one of these hooks.

#### Scenario: Protected route without preHandler rejected at registration

- GIVEN a route module is loaded
- WHEN the route handler does not declare `preHandler: [requireRole(...)]` and the route is not in the public allow-list (`/api/auth/login`, `/api/auth/refresh`, `/api/approval/*`, `/healthz`)
- THEN the route registration MUST throw an error at startup

#### Scenario: Permission denial returns 403

- GIVEN authenticated operator with role=CONSULTA
- WHEN POST /api/socios is called
- THEN response MUST return 403 Forbidden with `{"error":"INSUFFICIENT_PERMISSIONS","required":"role:ADMIN|TESORERO|OPERADOR","actual":"CONSULTA"}`

### Requirement: Audit Logging of Denials

The system MUST record every permission denial in `audit_events` with: `event_type='PERMISSION_DENIED'`, `operator_id`, `method`, `path`, `required_role_or_permission`, `timestamp`. The denial log MUST be queryable by operator and time range.

#### Scenario: Denial logged

- GIVEN authenticated operator with role=CONSULTA
- WHEN POST /api/socios is called and returns 403
- THEN a row MUST be inserted in `audit_events` with `event_type='PERMISSION_DENIED'`, `operator_id=<caller>`, `path='/api/socios'`, `required='role:ADMIN|TESORERO|OPERADOR'`

## Role Delegation

### Requirement: Temporary Permission Grant

The system MUST allow a TESORERO to temporarily grant `can_reprint` to a specific OPERADOR for a bounded duration (max 24 hours) via `POST /api/operators/{id}/delegations`. The grant MUST auto-expire and MUST be auditable. ADMIN grants SHALL NOT be delegable.

#### Scenario: Tesorero grants can_reprint to operador

- GIVEN authenticated TESORERO "ana" and target OPERADOR "pepe"
- WHEN POST /api/operators/{pepe.id}/delegations is called with `{"permission":"can_reprint","duration_hours":4}`
- THEN response MUST return 201 Created
- AND "pepe"'s effective `can_reprint` MUST be true for the next 4 hours
- AND the grant MUST be recorded in `audit_events` as `DELEGATION_GRANTED`

#### Scenario: Delegation auto-expires

- GIVEN a delegation granted at 10:00 with duration_hours=4
- WHEN the system clock reaches 14:00
- THEN the delegation MUST be marked expired
- AND "pepe"'s effective `can_reprint` MUST revert to the role default (false)

#### Scenario: Delegation duration capped at 24 hours

- GIVEN authenticated TESORERO
- WHEN POST /api/operators/{pepe.id}/delegations is called with `duration_hours:48`
- THEN response MUST return 400 Bad Request with `{"error":"DELEGATION_MAX_24H"}`

#### Scenario: Cannot delegate ADMIN role

- GIVEN authenticated TESORERO
- WHEN POST /api/operators/{pepe.id}/delegations is called with `{"role":"ADMIN"}`
- THEN response MUST return 400 Bad Request with `{"error":"CANNOT_DELEGATE_ADMIN"}`

### Requirement: Delegation Revocation

The system MUST allow the granting TESORERO or any ADMIN to revoke a delegation before its expiry via `DELETE /api/delegations/{id}`.

#### Scenario: Granter revokes own delegation

- GIVEN TESORERO "ana" granted a delegation to "pepe"
- WHEN DELETE /api/delegations/{delegation_id} is called by "ana"
- THEN the delegation MUST be marked revoked
- AND "pepe"'s effective permissions MUST revert immediately

## Operator Self-Service

### Requirement: View Own Profile

The system MUST allow any authenticated operator to view their own profile via `GET /api/auth/me`. The response MUST include: `id`, `username`, `role`, `permissions`, `last_login_at`, `must_change_password`. The password hash MUST NOT be returned.

#### Scenario: Operator fetches own profile

- GIVEN authenticated operator "pepe"
- WHEN GET /api/auth/me is called
- THEN response MUST return 200 OK with the fields above
- AND the response MUST NOT contain `password_hash`

### Requirement: View Own Login History

The system MUST allow any authenticated operator to view their own login history via `GET /api/auth/login-history` (last 30 days). Each entry MUST include: `timestamp`, `ip_address`, `user_agent`, `success`. The endpoint MUST be paginated and MUST NOT expose other operators' histories.

#### Scenario: Operator fetches login history

- GIVEN operator "pepe" with 3 logins in the last 30 days (2 successful, 1 failed)
- WHEN GET /api/auth/login-history is called
- THEN response MUST return a paginated list of those 3 events
- AND the response MUST NOT contain other operators' events

#### Scenario: Failed login visible in own history

- GIVEN operator "pepe" had a failed login at 09:15
- WHEN GET /api/auth/login-history is called
- THEN the response MUST include that attempt with `success=false`

## Input/Output Contracts

### Create Operator

```typescript
// POST /api/operators
interface CreateOperatorRequest {
  username: string;        // 3-50 chars, [a-z0-9._-]
  password: string;        // min 10 chars, mixed case + digit + symbol
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  can_reprint?: boolean;   // optional override
  can_anulate?: boolean;   // optional override
}
```

### Create Delegation

```typescript
// POST /api/operators/{id}/delegations
interface CreateDelegationRequest {
  permission: 'can_reprint' | 'can_anulate';
  duration_hours: number;  // 1-24
  reason?: string;         // optional, recorded in audit
}
```

## Data Model Extensions

```sql
-- Extensions to operators table (defined in auth-login spec)
ALTER TABLE operators
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Password history (for reuse prevention)
CREATE TABLE operator_password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_history_operator ON operator_password_history (operator_id, created_at DESC);

-- Delegations
CREATE TABLE operator_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  granted_by_operator_id UUID NOT NULL REFERENCES operators(id),
  permission TEXT NOT NULL CHECK (permission IN ('can_reprint','can_anulate')),
  reason TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_operator_id UUID REFERENCES operators(id)
);
CREATE INDEX idx_delegations_operator ON operator_delegations (operator_id, expires_at);
CREATE INDEX idx_delegations_active ON operator_delegations (operator_id) WHERE revoked_at IS NULL;

-- Login history (extends refresh_tokens area; lightweight event log)
CREATE TABLE operator_login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_events_operator ON operator_login_events (operator_id, created_at DESC);
```

## Success Criteria

- [ ] Only ADMIN can create, update, deactivate, or reset passwords for operators
- [ ] Self-update of role and self-deactivation are forbidden
- [ ] All protected routes declare a `requireRole` or `requirePermission` preHandler hook
- [ ] Every 403 response is recorded in `audit_events` with full context
- [ ] TESORERO can grant `can_reprint` or `can_anulate` to an OPERADOR for max 24 hours
- [ ] Delegations auto-expire and can be revoked early
- [ ] CONSULTA role cannot be escalated via granular flag overrides
- [ ] Operators can view and update their own profile and login history
- [ ] Password history prevents reuse of the last 5 passwords
- [ ] Admin-initiated password reset revokes all active sessions

---

## Delta Notes

This spec is a **NEW domain** added under `athlos-foundation`. It depends on the `operators` table and JWT claim shape defined in `auth-login/spec.md`. No existing requirements are modified — the auth-login RBAC contract is referenced and extended (operator lifecycle, self-service, delegation) without changing the token structure or the public role/permission catalog.
