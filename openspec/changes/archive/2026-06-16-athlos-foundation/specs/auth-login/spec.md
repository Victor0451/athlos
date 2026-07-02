# Auth Login Specification

## Purpose

Operator authentication system for Athlos. Provides secure login, JWT session management, legacy user migration, and role-based access control for Club Atlético Gorriti operators.

## Requirements

### Requirement: Operator Login

The system MUST authenticate operators using username and password, returning JWT access and refresh tokens on success.

#### Scenario: Successful login

- GIVEN operator exists with username="operador1" and password="correct-password"
- WHEN POST /api/auth/login is called with {"username":"operador1","password":"correct-password"}
- THEN response MUST contain: access_token (JWT), refresh_token, expires_in, operator_id, role, permissions

#### Scenario: Failed login — wrong password

- GIVEN operator exists with username="operador1" and password="correct-password"
- WHEN POST /api/auth/login is called with {"username":"operador1","password":"wrong-password"}
- THEN response MUST return 401 Unauthorized with {"error":"INVALID_CREDENTIALS"}

#### Scenario: Failed login — unknown user

- GIVEN no operator exists with username="unknown"
- WHEN POST /api/auth/login is called with {"username":"unknown","password":"any-password"}
- THEN response MUST return 401 Unauthorized with {"error":"INVALID_CREDENTIALS"}

### Requirement: JWT Session Management

The system MUST issue JWT access tokens (15 min TTL) and refresh tokens (7 day TTL). Refresh tokens MUST be stored in the database and revocable.

#### Scenario: Access token structure

- GIVEN successful login for operator with role=TESORERO and permissions={can_reprint:true,can_anulate:false}
- WHEN access_token is decoded
- THEN token MUST contain claims: sub=operator_id, role="TESORERO", permissions={can_reprint:true,can_anulate:false}, iat, exp

#### Scenario: Token refresh

- GIVEN valid refresh_token for operator
- WHEN POST /api/auth/refresh is called with {"refresh_token":"<valid-token>"}
- THEN response MUST contain new access_token and new refresh_token

#### Scenario: Expired access token rejected

- GIVEN an access_token with exp in the past
- WHEN any protected API endpoint is called with that token
- THEN response MUST return 401 Unauthorized with {"error":"TOKEN_EXPIRED"}

#### Scenario: Refresh token revocation

- GIVEN a refresh_token was issued to operator
- WHEN POST /api/auth/logout is called with that refresh_token
- THEN that refresh_token MUST be invalidated and subsequent /api/auth/refresh with it MUST fail

### Requirement: Legacy User Migration

The system MUST migrate all 20 users from USUARIO.DBF, mapping legacy roles and permissions to the new model. Legacy plaintext passwords MUST be hashed using bcrypt before storage.

#### Scenario: Legacy user migration

- GIVEN USUARIO.DBF contains 20 users with fields: USUCLAVE (username), USUCONTR (password, plaintext), USUTIPO (role: ADMIN/TESORERO/OPERADOR/CONSULTA), USUREIMPRE (can reprint flag), USUANULACI (can anulate flag)
- WHEN migration runs
- THEN each user MUST be created in the operators table with: username, bcrypt-hashed password, role, permissions={can_reprint:USUREIMPRE,can_anulate:USUANULACI}

#### Scenario: Duplicate username prevention

- GIVEN USUARIO.DBF contains a user with USUCLAVE="admin"
- AND an operator with username="admin" already exists in Athlos
- WHEN migration attempts to create the legacy user
- THEN migration MUST skip that user and log a warning

### Requirement: Role-Based Access Control

The system MUST enforce four roles: ADMIN (full access), TESORERO (financial operations), OPERADOR (data entry), CONSULTA (read-only). Each role has distinct permission boundaries.

#### Scenario: Admin has full access

- GIVEN authenticated operator with role=ADMIN
- WHEN any API endpoint is called
- THEN request MUST be allowed

#### Scenario: Consulta is read-only

- GIVEN authenticated operator with role=CONSULTA
- WHEN POST /api/socios is called to create a socio
- THEN response MUST return 403 Forbidden with {"error":"INSUFFICIENT_PERMISSIONS"}

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

### Requirement: Login Attempt Limits

The system MUST enforce login attempt limits: maximum 5 failed attempts within 15 minutes, then account lockout for 15 minutes.

#### Scenario: Account lockout after 5 failed attempts

- GIVEN operator "operador1" has had 5 failed login attempts within the last 15 minutes
- WHEN POST /api/auth/login is called with correct credentials
- THEN response MUST return 429 Too Many Requests with {"error":"ACCOUNT_LOCKED","locked_until":"<timestamp>"}

#### Scenario: Lockout resets after 15 minutes

- GIVEN operator "operador1" is locked due to failed attempts
- WHEN 15 minutes pass and POST /api/auth/login is called with correct credentials
- THEN login MUST succeed and lockout state MUST be cleared

## Input/Output Contracts

### Login Endpoint

```typescript
// POST /api/auth/login
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  access_token: string;      // JWT, 15 min TTL
  refresh_token: string;    // opaque, 7 day TTL
  expires_in: number;       // seconds
  operator_id: string;
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  permissions: {
    can_reprint: boolean;
    can_anulate: boolean;
  };
}
```

### Refresh Endpoint

```typescript
// POST /api/auth/refresh
interface RefreshRequest {
  refresh_token: string;
}

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
```

### Logout Endpoint

```typescript
// POST /api/auth/logout
interface LogoutRequest {
  refresh_token: string;
}
```

### JWT Claims Structure

```typescript
interface JWTPayload {
  sub: string;              // operator_id
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  permissions: {
    can_reprint: boolean;
    can_anulate: boolean;
  };
  iat: number;              // issued at (Unix timestamp)
  exp: number;              // expiration (Unix timestamp)
}
```

### Operators Table Schema

```sql
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','TESORERO','OPERADOR','CONSULTA')),
  can_reprint BOOLEAN NOT NULL DEFAULT false,
  can_anulate BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Role and Permission Model

| Role | Description | Default Permissions |
|------|-------------|---------------------|
| ADMIN | Full system access | can_reprint: true, can_anulate: true |
| TESORERO | Financial operations | can_reprint: true, can_anulate: true |
| OPERADOR | Data entry | can_reprint: false, can_anulate: false |
| CONSULTA | Read-only | can_reprint: false, can_anulate: false |

## Success Criteria

- [ ] Operators can login with username/password and receive JWT tokens
- [ ] Access tokens expire after 15 minutes
- [ ] Refresh tokens can be used to obtain new access tokens
- [ ] Refresh tokens are revocable via logout
- [ ] All 20 legacy users migrated from USUARIO.DBF with hashed passwords
- [ ] Role-based access control enforced on all protected endpoints
- [ ] can_reprint and can_anulate permissions enforced at endpoint level
- [ ] Login attempts limited to 5 per 15 minutes per operator
- [ ] Locked accounts unlock after 15 minute cooldown

---

## Scoped Approval Links

### Purpose

Certain high-risk actions require a second person (gerente, supervisor) to authorize before execution. Instead of granting that person a full user account, the system generates a **scoped approval link** — a time-limited, single-use token sent via WhatsApp or email. The approver clicks the link, views the action context, and approves or rejects. No persistent session is created.

### Requirement: Approval Link Generation

The system MUST be able to generate a scoped approval link for any action that requires authorization. The link MUST contain a cryptographically random token and MUST be deliverable via external channel (WhatsApp, email).

#### Scenario: Generate approval link for payment order

- GIVEN operator "vlongo" (TESORERO) creates a payment order for $150,000 that exceeds the auto-approve threshold
- WHEN the system generates an approval link for this payment order
- THEN a link MUST be created with a unique token valid for 48 hours
- AND the link MUST be sent to the configured approver(s) via WhatsApp

#### Scenario: Approval link token structure

- GIVEN an approval link was generated for payment order #1234
- WHEN the token is inspected
- THEN it MUST be a random 32-byte hex string (64 characters)
- AND it MUST be stored as a SHA-256 hash in the database
- AND it MUST NOT be stored in plaintext

### Requirement: Approval Link Access

The system MUST allow access to the approval context via the link token without requiring a full login session. The access MUST be read-only for the specific action context.

#### Scenario: Approver opens approval link

- GIVEN an approval link was generated for payment order #1234
- AND the token is valid and not expired
- WHEN the approver navigates to GET /api/approval/{token}
- THEN response MUST contain: action summary, entity details, created_by, created_at, expires_at
- AND the approver MUST be able to see the context needed to make a decision

#### Scenario: Expired approval link rejected

- GIVEN an approval link has passed its expiry time
- WHEN GET /api/approval/{token} is called
- THEN response MUST return 410 Gone with {"error":"APPROVAL_LINK_EXPIRED"}

#### Scenario: Already-used approval link rejected

- GIVEN an approval link was already used (approved or rejected)
- WHEN GET /api/approval/{token} is called
- THEN response MUST return 410 Gone with {"error":"APPROVAL_ALREADY_USED"}

### Requirement: Approval Action

The system MUST allow the approver to approve or reject the action via the link. The action MUST be executed or cancelled based on the approver's decision.

#### Scenario: Approver approves via link

- GIVEN an approval link for payment order #1234 is valid and unused
- WHEN POST /api/approval/{token} is called with {"decision":"approve"}
- THEN payment order #1234 MUST be marked as approved
- AND the approval token MUST be marked as used
- AND an audit event MUST be recorded

#### Scenario: Approver rejects via link

- GIVEN an approval link for payment order #1234 is valid and unused
- WHEN POST /api/approval/{token} is called with {"decision":"reject","reason":"Monto incorrecto"}
- THEN payment order #1234 MUST be marked as rejected
- AND the approval token MUST be marked as used
- AND an audit event MUST be recorded

### Requirement: Approval Token Lifecycle

The system MUST enforce single-use and expiry on approval tokens.

#### Scenario: Token is single-use

- GIVEN an approval link token exists in the database
- WHEN the token is used for the first time (approve or reject)
- THEN the `used_at` field MUST be set to the current timestamp
- AND subsequent requests with the same token MUST return 410 Gone

#### Scenario: Token expiry enforced

- GIVEN an approval link token with `expires_at` in the past
- WHEN any request is made with that token
- THEN response MUST return 410 Gone

### Requirement: Approval Link Audit Trail

The system MUST record all approval link events in the audit log.

#### Scenario: Approval link created

- GIVEN an approval link is generated for payment order #1234
- THEN an audit event MUST be recorded with: action=`APPROVAL_LINK_CREATED`, entity_type=`payment_order`, entity_id=`1234`, operator_id=`vlongo`

#### Scenario: Approval link used (approve)

- GIVEN a valid approval link for payment order #1234
- WHEN POST /api/approval/{token} is called with {"decision":"approve"}
- THEN an audit event MUST be recorded with: action=`APPROVAL_GRANTED`, entity_type=`payment_order`, entity_id=`1234`

#### Scenario: Approval link used (reject)

- GIVEN a valid approval link for payment order #1234
- WHEN POST /api/approval/{token} is called with {"decision":"reject","reason":"Monto incorrecto"}
- THEN an audit event MUST be recorded with: action=`APPROVAL_REJECTED`, entity_type=`payment_order`, entity_id=`1234`, details=`reason`

### Requirement: Approval Link Scope Enforcement

The system MUST ensure the approver can only view and act on the specific action referenced by the token. No other data is accessible via the approval link.

#### Scenario: Approver cannot access other entities via approval link

- GIVEN an approval link for payment order #1234
- WHEN the approver attempts to access GET /api/socios via the same session
- THEN response MUST return 403 Forbidden

### Input/Output Contracts

#### Generate Approval Link (internal API)

```typescript
// POST /api/internal/approval-links
interface CreateApprovalLinkRequest {
  action_type: string;       // e.g., 'payment_order', 'credit_note', 'socio_baja'
  action_id: string;        // ID of the entity requiring approval
  approver_channels: Array<{
    channel: 'whatsapp' | 'email';
    address: string;
  }>;
  expires_in_hours?: number; // default 48
  context_summary: string;  // short description for the approver
}

interface CreateApprovalLinkResponse {
  token: string;             // the raw token (only returned here, never again)
  link: string;              // full URL to present to approver
  expires_at: string;        // ISO timestamp
}
```

#### View Approval Context

```typescript
// GET /api/approval/{token}
interface ApprovalContextResponse {
  action_type: string;
  action_id: string;
  context_summary: string;
  entity_preview: Record<string, unknown>; // relevant fields of the entity
  created_by: {
    operator_id: string;
    username: string;
    role: string;
  };
  created_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}
```

#### Submit Approval Decision

```typescript
// POST /api/approval/{token}
interface ApprovalDecisionRequest {
  decision: 'approve' | 'reject';
  reason?: string;           // required on reject
}

interface ApprovalDecisionResponse {
  decision: 'approved' | 'rejected';
  action_type: string;
  action_id: string;
  decided_at: string;
}
```

### Approval Tokens Table Schema

```sql
CREATE TABLE approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  action_id TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  created_by_operator_id UUID NOT NULL REFERENCES operators(id),
  approver_channel TEXT NOT NULL,  -- 'whatsapp' or 'email'
  approver_address TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_tokens_hash ON approval_tokens (token_hash);
CREATE INDEX idx_approval_tokens_action ON approval_tokens (action_type, action_id);
```

### Success Criteria — Scoped Approval Links

- [ ] Any action can trigger approval link generation via internal API
- [ ] Approval links are delivered via configured channel (WhatsApp/email)
- [ ] Links contain a cryptographically random 64-char hex token
- [ ] Tokens are stored as SHA-256 hash only (no plaintext)
- [ ] Approvers can view action context without a full login session
- [ ] Approvers can approve or reject via the link
- [ ] Tokens are single-use (first use consumes the token)
- [ ] Tokens expire after configured duration (default 48h)
- [ ] Expired or used tokens return 410 Gone
- [ ] All approval link events are recorded in audit_events
- [ ] Approvers cannot access any other part of the system via the approval link
