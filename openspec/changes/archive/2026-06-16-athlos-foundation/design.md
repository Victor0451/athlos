

---

## Auth Login Design

### Decision: Password Hashing — bcrypt with auto-upgrade on login

**Choice**: bcrypt (cost factor 12) for legacy migration. On every successful login, verify against existing hash; if using legacy algorithm or lower cost, rehash with current cost factor.
**Alternatives considered**: argon2 (not available in PostgreSQL natively, requires extension), scrypt (memory-hard but slower for 20 users — no benefit here).
**Rationale**: The spec mandates bcrypt ("bcrypt-hashed password"). Cost factor 12 is the current OWASP recommendation balancing security vs. login latency for a small user base. Auto-upgrade ensures that once migrated, passwords automatically strengthen on next login without forced reset.

### Decision: JWT Structure — Minimal Claims with Permission Granularity

**Choice**: Access token contains `sub` (operator_id UUID), `role` (ADMIN|TESORERO|OPERADOR|CONSULTA), `permissions` ({can_reprint, can_anulate}), `iat`, `exp`. No username, no email, no derived claims.
**Alternatives considered**: Embed full operator object (bloats token, leaks data to any downstream that receives the token), Include permissions as flat array (requires mapping at every gate).
**Rationale**: JWT is signed but NOT encrypted — any downstream service can read claims. Minimal claims reduce blast radius on token exposure. Permissions as object matches the spec's exact shape, enabling direct `hasPermission('can_reprint')` checks in middleware without enum mapping.

### Decision: Token Expiry — 15 min access / 7 day refresh

**Choice**: Access token TTL = 900 seconds (15 min). Refresh token TTL = 7 days. Refresh rotation on every use (new refresh token issued with new access token).
**Alternatives considered**: 1h access token (too long for a club environment where operator sessions are short), longer refresh (30 days — too permissive if token leaks).
**Rationale**: 15 min access forces revalidation at a cadence that catches permission changes (e.g., operator demoted from ADMIN). 7-day refresh aligns with weekly club operations — operators typically log in once per week. Rotation ensures refresh token theft is short-lived.

### Decision: Refresh Token Storage — Hash in DB, revocation via `revoked_at`

**Choice**: Store `SHA-256(token)` in `refresh_tokens.token_hash`. Never store raw token. Set `revoked_at` on logout. Check `expires_at > now() AND revoked_at IS NULL` on refresh.
**Alternatives considered**: Blacklist table (adds join on every refresh), JWT jti with blocklist (requires checking blocklist on every request — defeats stateless design).
**Rationale**: Refresh tokens are opaque to the client — we control them entirely. Hashing the token means a DB breach doesn't expose live refresh tokens. `revoked_at IS NULL` check is a single index scan. This is the standard practice for refresh token revocation.

### Decision: Login Attempt Lockout — 5 attempts / 15 min window, 15 min lock

**Choice**: Track `failed_login_attempts` counter and `locked_until` timestamp in `operators` table. On 5th failure within a 15-minute rolling window, set `locked_until = now() + 15 min`. Reset counter and clear lock on successful login or after lockout expires.
**Alternatives considered**: Pure timestamp list (harder to query), separate `login_attempts` table (unnecessary join).
**Rationale**: The spec defines the behavior exactly. Using columns on the `operators` table avoids a separate table for a simple counter. The rolling window is computed at query time — no background job needed.

### Decision: Legacy Migration — Batch script with conflict skip

**Choice**: One-shot Node.js migration script reading USUARIO.DBF via `xbase` or `dbaf` library. For each record: hash password with bcrypt, insert into `operators` with ON CONFLICT DO NOTHING (skip duplicates), log warnings for conflicts.
**Alternatives considered**: Streaming migration (unnecessary for 20 records), incremental sync (legacy passwords don't change).
**Rationale**: 20 users is a one-time batch. A script is simpler than a service. `ON CONFLICT DO NOTHING` with logging satisfies the "skip and warn" requirement for duplicate usernames. bcrypt hashing happens inline — no plaintext stored after migration.

### Decision: Auth Middleware — Fastify Plugin with `request.operator` injection

**Choice**: `fastify.authPlugin()` that reads `Authorization: Bearer <token>`, verifies JWT signature against `JWT_SECRET`, decodes claims, injects `request.operator = { id, role, permissions }`. Downstream handlers access `request.operator` directly.
**Alternatives considered**: Decorator per route (violates DRY), middleware function per route (verbose call chain).
**Rationale**: Fastify's plugin encapsulation ensures the auth context is request-scoped. `request.operator` is idiomatic Fastify (request decorators). No per-route token parsing boilerplate.

### Decision: RBAC Middleware — Pre-handler hook with role + permission checks

**Choice**: `requireRole(role)` and `requirePermission(permission)` Fastify pre-handler hooks. `requireRole` aborts with 403 if `request.operator.role` not in allowed set. `requirePermission` aborts with 403 if `request.operator.permissions[permission]` is false.
**Alternatives considered**: Decorator-based (obscures the enforcement point), external policy service (over-engineered for 4 roles and 2 permissions).
**Rationale**: Pre-handler hooks are the idiomatic Fastify way to intercept before handler execution. Explicit `requireRole` / `requirePermission` functions make the contract visible at the route definition site. One line per route is clear and auditable.

### Decision: Audit Integration — Login events to `audit_events` with `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_FAILED`

**Choice**: On login success: emit `audit_events` with `action='AUTH_LOGIN'`, `entity_type='operator'`, `entity_id=operator_id`. On failure: emit `action='AUTH_FAILED'` with `entity_id=username` (operator may not exist). On logout: emit `action='AUTH_LOGOUT'`.
**Alternatives considered**: Separate `auth_events` table (fragments audit trail), no failure audit (security blind spot).
**Rationale**: The existing `audit_events` table uses PostgreSQL INSERT-only policy — login events should be there for completeness. Failure events are critical for security auditing (who is probing accounts). Using `entity_id=username` for failed logins when the operator doesn't exist is intentional — we want to capture the attempted username even if it doesn't map to a valid operator.

## Data Flow — Auth Login

```
Client                    API                      DB
  │                         │                       │
  │── POST /api/auth/login ─►                       │
  │                         │── Lookup username ─────►│
  │                         │◄─ operator row ─────────│
  │                         │── Verify bcrypt ───────►│
  │                         │── Check lockout ───────►│
  │                         │── Reset failed_attempts─►│
  │                         │── Insert refresh_token─►│
  │                         │◄─ token_hash id ─────────│
  │◄─ {access, refresh} ────│                       │
  │                         │── Emit AUTH_LOGIN ─────►│
  │                         │                       │
  │                         │                       │
  │── POST /api/auth/refresh ─►                     │
  │                         │── Hash + lookup token─►│
  │                         │── Check not revoked ──►│
  │                         │── Issue new pair ──────►│
  │◄─ {access, refresh} ────│                       │
  │                         │                       │
  │── POST /api/auth/logout ─►                      │
  │                         │── Set revoked_at ─────►│
  │◄─ 200 OK ───────────────│                       │
  │                         │── Emit AUTH_LOGOUT ───►│
```

## File Changes — Auth Login Addition

| File | Action | Description |
|------|--------|-------------|
| `db/schema/operators.sql` | Create | DDL for operators table |
| `db/schema/refresh_tokens.sql` | Create | DDL for refresh_tokens table |
| `db/migrations/0005_operators.sql` | Create | Migration for operators + refresh_tokens |
| `packages/db/src/schema/operators.ts` | Create | Drizzle schema for operators |
| `packages/db/src/schema/refresh_tokens.ts` | Create | Drizzle schema for refresh_tokens |
| `packages/auth/src/password.ts` | Create | bcrypt hash/verify utilities |
| `packages/auth/src/jwt.ts` | Create | JWT sign/verify utilities |
| `packages/auth/src/middleware.ts` | Create | Fastify auth plugin + RBAC hooks |
| `packages/auth/src/login.ts` | Create | Login handler: verify creds, issue tokens |
| `packages/auth/src/refresh.ts` | Create | Refresh handler: rotate tokens |
| `packages/auth/src/logout.ts` | Create | Logout handler: revoke refresh token |
| `packages/auth/src/migrate.ts` | Create | Legacy USUARIO.DBF migration script |
| `apps/api/src/routes/auth.ts` | Create | Fastify auth routes (/login, /refresh, /logout) |
| `apps/api/src/routes/_protected.ts` | Create | Example protected route using RBAC middleware |

## Interfaces / Contracts — Auth Login

### operators Table

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
```

### refresh_tokens Table

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_operator ON refresh_tokens (operator_id);
```

### JWT Payload

```typescript
interface JWTPayload {
  sub: string;              // operator_id (UUID)
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  permissions: {
    can_reprint: boolean;
    can_anulate: boolean;
  };
  iat: number;
  exp: number;
}
```

### Login Handler

```typescript
// POST /api/auth/login
async function login(
  request: FastifyRequest<{ Body: { username: string; password: string } }>,
  reply: FastifyReply
)
```

### Auth Middleware Usage

```typescript
// Example protected route
fastify.post('/api/socios', {
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR')]
}, async (request, reply) => { ... });

// Example permission-gated route
fastify.post('/api/reports/reprint', {
  preHandler: [requirePermission('can_reprint')]
}, async (request, reply) => { ... });
```

## Testing Strategy — Auth Login

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | bcrypt hash consistency | Vitest: same password → same hash (deterministic with salt) |
| Unit | JWT sign/verify roundtrip | Vitest: sign claims → verify → assert claims match |
| Unit | Lockout window computation | Vitest: 4 attempts + 5th within window → assert locked_until set |
| Unit | requireRole rejects unauthorized | Vitest: mock request.operator={role:'CONSULTA'}, assert 403 |
| Unit | requirePermission rejects missing | Vitest: mock request.operator={permissions:{can_reprint:false}}, assert 403 |
| Integration | Login success returns tokens | Testcontainers + Drizzle: insert operator, login, assert access+refresh |
| Integration | Login failure increments counter | Integration test: 5 bad passwords, assert 6th returns 429 |
| Integration | Refresh token revocation | Integration test: logout, assert subsequent refresh fails |
| Integration | Refresh token rotation | Integration test: refresh, assert old token revoked, new token works |
| E2E | Full login → refresh → logout cycle | Playwright: loginWithCreds, refreshSession, logoutSession |

## Migration / Rollback — Auth Login

**Migration**: Run `packages/auth/src/migrate.ts` as a one-time script before API deployment. The script reads USUARIO.DBF, hashes each password, inserts into `operators`. Rollback: `DELETE FROM operators WHERE created_at = now() AND username IN (SELECT USUCLAVE FROM USUARIO.DBF)` — but since `created_at` is set at insert time, use a migration marker table.

**Rollback plan**: If auth-login is rolled back, operators table and refresh_tokens table remain but are unused. No data loss — just stop issuing tokens. To fully remove: drop tables + revoke migrations.

## Open Questions — Auth Login

- [ ] Should `JWT_SECRET` be environment variable or secrets manager (Vault, AWS SM)?
- [ ] Is there a rate limit on `/api/auth/refresh` beyond the refresh token expiry?
- [ ] Should `last_login_at` be updated on every refresh, or only on fresh login?
- [ ] Does the legacy DBF file path change per deployment environment, or is it a fixed path?

---

## Scoped Approval Links Design

### Decision: Token Format — Cryptographically Random 32-byte Hex String

**Choice**: Generate a 32-byte random token via `crypto.randomBytes(32).toString('hex')` (64 characters). Store only the SHA-256 hash in the database. Return the raw token ONCE at creation time to the caller (who passes it to WhatsApp/email).

**Alternatives considered**: JWT as the approval token (too much metadata exposed, not single-use friendly), sequential ID (predictable, guessable).
**Rationale**: 32 bytes of crypto randomness is the standard for unguessable tokens. SHA-256 hash storage means a DB breach doesn't expose live tokens. Raw token shown only at creation = WhatsApp delivery is the only record of it.

### Decision: Single-Use Enforcement — `used_at` Timestamp

**Choice**: Set `used_at = now()` on first use (approve or reject). All reads check `used_at IS NULL AND expires_at > now()`. Once set, the token is consumed.

**Alternatives considered**: Separate `approval_token_uses` table (unnecessary join), token deletion after use (loses audit trail).
**Rationale**: Setting `used_at` preserves the audit record while preventing reuse. One field, one query check, no extra table.

### Decision: Expiry — 48 Hours Default, Configurable Per Action

**Choice**: Default `expires_at = now() + 48 hours`. Each `CreateApprovalLinkRequest` can override with `expires_in_hours`. Short enough for urgent approvals, long enough for async WhatsApp delivery.

**Alternatives considered**: Fixed 24h (too short for async), 7 days (too long for an approval context).
**Rationale**: 48h covers same-day and next-day approval scenarios. Configurable per action allows urgent payments to have shorter windows.

### Decision: Access Scope — Read-Only Entity Preview, No Session

**Choice**: `GET /api/approval/{token}` returns a `context_summary` + `entity_preview` (relevant fields only). No session cookie, no JWT issued. The approver sees ONE entity's context and two buttons (approve/reject). All other API calls return 403.

**Alternatives considered**: Create a temporary session/JWT for the approver (complex, session management overhead), redirect to a full UI (couples to frontend URL structure).
**Rationale**: The approver needs context and a decision button. Nothing else. A read-only response with just the entity preview is the minimal surface area. No session = no state to manage = no security context to leak.

### Decision: Approval Action Executes the Underlying Business Action

**Choice**: `POST /api/approval/{token}` with `decision=approve` does NOT just mark the token as used — it calls the business logic to execute the underlying action (e.g., marks payment order as approved in the `payment_orders` table). The approval token IS the authorization mechanism for the business action.

**Alternatives considered**: Mark token as used and emit event for a separate worker to process (adds async complexity and failure modes).
**Rationale**: Synchronous execution keeps the flow simple: approver approves → action executes → response tells the approver the result. Async workers are premature optimization here.

### Decision: Rejection Requires a Reason

**Choice**: `POST /api/approval/{token}` with `decision=reject` MUST include a `reason` field. Reason is stored in the audit event and associated with the `approval_tokens` record.

**Alternatives considered**: Reject without reason (creates audit gap, no accountability).
**Rationale**: A rejection without explanation defeats the purpose of the approval gate. The reason becomes part of the audit trail and notifies the requester why their action was blocked.

### Decision: Audit Events for All Approval Link Lifecycle Steps

**Choice**: Emit `APPROVAL_LINK_CREATED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED` events to `audit_events` table. `APPROVAL_LINK_CREATED` includes `approver_channel` and `approver_address` (masked: `w***@gmail.com`).

**Alternatives considered**: Separate `approval_events` table (fragments audit trail).
**Rationale**: All security-relevant events belong in `audit_events`. The approval link lifecycle is security-relevant.

### Decision: Link Delivery is Out-of-Band

**Choice**: The API generates the token and returns the full URL. The caller (business logic service) is responsible for sending it via WhatsApp/email using whatever channel integration exists. The approval link service does NOT send messages — it generates and validates tokens.

**Alternatives considered**: Built-in WhatsApp integration (couples to specific provider, out of scope), email sending (same reason).
**Rationale**: Token generation and validation are the core responsibility. Delivery is a separate concern handled by the calling service with its own channel adapter.

### Decision: No Operator Account Required for Approver

**Choice**: The approval link grants access to a specific action context WITHOUT requiring the approver to have an operator account. This is intentional — the gerente may not be an operator of the system.

**Alternatives considered**: Create a temporary operator account for each approver (complex, account management overhead).
**Rationale**: The whole point is to avoid full accounts. The approval link IS the authorization. If the approver later becomes an operator, they get a normal account.

## Data Flow — Scoped Approval Links

```
Requester                    API                  DB                    Approver
    │                         │                    │                        │
    │── POST /internal/       │                    │                        │
    │   approval-links ──────►│                    │                        │
    │                         │── Insert token ───►│                        │
    │◄─ {link: "...",         │◄─ raw token ─────────│                        │
    │    token} ──────────────│                    │                        │
    │                         │                    │                        │
    │── Send WhatsApp ──────────────────────────────────────────────────────►│
    │                         │                    │                        │
    │                         │                    │   GET /api/approval/   │
    │                         │                    │◄─ {entity_preview} ────│
    │                         │                    │                        │
    │                         │                    │   POST /api/approval/  │
    │                         │                    │◄─ {decision:approve}───│
    │                         │── Mark used_at ────►│                        │
    │                         │── Execute action ──►│                        │
    │                         │◄─ success ──────────│                        │
    │◄─ Notification:         │                    │                        │
    │   approved ─────────────│                    │                        │
    │                         │── Emit AUDIT ──────►│                        │
```

## File Changes — Scoped Approval Links Addition

| File | Action | Description |
|------|--------|-------------|
| `db/schema/approval_tokens.sql` | Create | DDL for approval_tokens table |
| `db/migrations/0006_approval_tokens.sql` | Create | Migration for approval_tokens |
| `packages/db/src/schema/approval_tokens.ts` | Create | Drizzle schema for approval_tokens |
| `packages/approval/src/token.ts` | Create | Token generation (randomBytes) + hash utilities |
| `packages/approval/src/service.ts` | Create | Create, validate, consume approval tokens |
| `packages/approval/src/middleware.ts` | Create | Fastify plugin for /api/approval/{token} routes |
| `apps/api/src/routes/approval.ts` | Create | GET + POST /api/approval/{token} |
| `apps/api/src/routes/_internal.ts` | Create | POST /api/internal/approval-links (internal) |
| `apps/api/src/routes/_protected.ts` | Update | Add RBAC for approval action execution |

## Interfaces / Contracts — Scoped Approval Links

### approval_tokens Table

```sql
CREATE TABLE approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  action_id TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  created_by_operator_id UUID NOT NULL REFERENCES operators(id),
  approver_channel TEXT NOT NULL CHECK (approver_channel IN ('whatsapp','email')),
  approver_address TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_tokens_hash ON approval_tokens (token_hash);
CREATE INDEX idx_approval_tokens_action ON approval_tokens (action_type, action_id);
```

### Token Generation

```typescript
// packages/approval/src/token.ts
import { crypto } from 'node:crypto';

function generateApprovalToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}
```

### Approval Service

```typescript
// packages/approval/src/service.ts
interface ApprovalService {
  createToken(req: CreateApprovalLinkRequest): Promise<{ raw: string; link: string; expires_at: Date }>;
  validateToken(raw: string): Promise<ApprovalToken | null>;
  consumeToken(raw: string, decision: 'approve' | 'reject', reason?: string): Promise<void>;
}
```

### Auth Middleware — Approval Link Guard

```typescript
// GET /api/approval/{token} — no JWT required, token is the auth
fastify.get('/api/approval/:token', {
  preHandler: [approvalLinkGuard()]
}, async (request, reply) => { ... });

// POST /api/approval/{token} — approve/reject
fastify.post('/api/approval/:token', {
  preHandler: [approvalLinkGuard()]
}, async (request, reply) => { ... });
```

## Testing Strategy — Scoped Approval Links

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Token generation: random + hash | Vitest: same input → different raw tokens, hash is SHA-256 of raw |
| Unit | Token validation: valid token returns record | Vitest: mock DB, assert validateToken returns record |
| Unit | Token validation: invalid token returns null | Vitest: random string → assert null |
| Unit | Token validation: expired token returns null | Vitest: mock expires_at past → assert null |
| Unit | Token validation: used token returns null | Vitest: mock used_at set → assert null |
| Integration | Full cycle: create → view → approve → token consumed | Testcontainers: create token, GET, POST approve, assert used_at set |
| Integration | Reject with reason | Integration: POST reject with reason, assert reason stored |
| E2E | WhatsApp link flow | Playwright: mock WhatsApp delivery, click link, approve, assert action executed |

## Migration / Rollback — Scoped Approval Links

**Migration**: Run `0006_approval_tokens.sql` migration. No data to migrate — new table.

**Rollback**: If rolled back, `approval_tokens` table remains but unused. `approval_links` table can be dropped safely. Actions that depend on approval links need to be updated to not require them (fallback to no-approval mode).

## Open Questions — Scoped Approval Links

- [ ] Should the approval link URL be a separate domain (e.g., `aprobaciones.gorriti.com`) or same API (`api.gorriti.com/approval/...`)?
- [ ] Should we support multiple approvers per action (e.g., require 2 of 3 managers)?
- [ ] What happens if the underlying action is cancelled/deleted before the approval link is used?
- [ ] Should approval links be revokable by the requester before expiry?
- [ ] Do we need a notification back to the requester when the approver decides?

---

## Error Handling Design

### Decision: Error Code Enumeration — Exhaustive Defined List

**Choice**: All error codes are defined in a single `ErrorCode` enum in `packages/errors/src/codes.ts`. No dynamic or third-party error codes are used in `ApiError.error` fields.

```typescript
// packages/errors/src/codes.ts
export const ErrorCode = {
  // Business errors (4xx)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  APPROVAL_LINK_EXPIRED: 'APPROVAL_LINK_EXPIRED',
  APPROVAL_ALREADY_USED: 'APPROVAL_ALREADY_USED',
  REASON_REQUIRED: 'REASON_REQUIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  // Technical errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];
```

**Alternatives considered**: String union type without object wrapper (less self-documenting, harder to enumerate at runtime), error codes as an external JSON config (unnecessary indirection for 13 codes).
**Rationale**: `as const` object gives TypeScript string literal types, runtime enumeration via `Object.values()`, and IDE autocompletion. Single source of truth — any new error code requires a code change, making the list auditable.

### Decision: request_id Generation — `req_<uuidv4>` via Fastify Request ID Plugin

**Choice**: `request_id` generated at request start using `crypto.randomUUID()`, prefixed with `req_` (format: `req_<uuid>`). Created by a Fastify plugin on `'onRequest'` hook. Propagated via Fastify's request context (`request.id`) and reply headers.

```typescript
// packages/errors/src/request-id.ts
import { FastifyPluginAsync } from 'fastify';

export const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    request.requestId = `req_${crypto.randomUUID()}`;
  });

  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-ID', request.requestId);
  });
};

//packages/errors/src/types.ts
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}
```

**Alternatives considered**: timestamp + random bytes (longer, no entropy benefit over UUID), database sequence (unnecessary round-trip), OpenTelemetry trace ID (adds OTEL dependency before we need it).
**Rationale**: UUIDv4 provides uniqueness across distributed instances. `req_` prefix distinguishes API-generated IDs from upstream trace IDs (which may use other formats). `onRequest` hook is the earliest point in the Fastify lifecycle — the ID is available for all downstream logging.

### Decision: Business/Technical Error Split — Custom `ApiError` Class with `isBusiness` Flag

**Choice**: A single `ApiError` class carries all error data. Subclassing is NOT used. The `isBusiness: boolean` property determines log level and response shape.

```typescript
// packages/errors/src/api-error.ts
import { ErrorCode } from './codes.js';

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isBusiness: boolean;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    isBusiness: boolean,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isBusiness = isBusiness;
    this.details = details;
    this.name = 'ApiError';
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
      request_id: 'SET_BY_HANDLER', // replaced at serialization time
    };
  }
}

// Factory helpers in packages/errors/src/index.ts
export const BusinessError = (code: ErrorCode, message: string, details?: unknown) =>
  new ApiError(code, message, httpStatusFor(code), true, details);

export const TechnicalError = (code: ErrorCode, message: string) =>
  new ApiError(code, message, httpStatusFor(code), false);
```

**Alternatives considered**: Separate `BusinessError` / `TechnicalError` subclasses (class hierarchy adds complexity for a single property difference), error codes as tagged union (verbose, overkill for this project's scale).
**Rationale**: Single class + factory helpers is the minimal abstraction. `isBusiness` flag drives the error handler's behavior: business errors → WARN + no stack, technical errors → ERROR + stack. No instanceof checks needed in the handler.

### Decision: Sensitive Data Redaction — Recursive `redact()` Utility with Field Allowlist

**Choice**: A `redact(obj, fields)` utility traverses an object recursively and replaces matching field values with `'[REDACTED]'`. Sensitive fields are declared per-context (not hardcoded globally), allowing different contexts to redact different fields.

```typescript
// packages/errors/src/redact.ts
const DEFAULT_REDACT = new Set(['password', 'refresh_token', 'access_token', 'Authorization', 'dni']);

export function redact(obj: unknown, fields = DEFAULT_REDACT): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj; // never recurse into bare strings
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, fields));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      redacted[key] = fields.has(key) ? '[REDACTED]' : redact(value, fields);
    }
    return redacted;
  }

  return obj;
}
```

**Alternatives considered**: JSON-stringify + regex replacement (fragile, doesn't handle nested paths), proxy-based auto-redaction (complex, performance overhead), separate redaction per log statement (inconsistent, easy to forget).
**Rationale**: Declarative field names are simple and auditable. Recursive traversal handles nested objects and arrays. Default allowlist covers the spec's requirements. Called once at the boundary before any logging.

### Decision: Zod Validation → ApiError Mapping — Central `mapZodErrors()` Function

**Choice**: Each route's Zod schema validation failure calls a shared `mapZodErrors()` mapper that transforms `ZodError` into `FieldError[]` for the `details` field.

```typescript
// packages/errors/src/zod.ts
import { ZodError, ZodIssue } from 'zod';

export interface FieldError {
  field: string;    // JSON path e.g. "body.numero_socio"
  message: string;  // Human-readable e.g. "Required"
  code?: string;    // Zod code e.g. "invalid_type"
}

export function mapZodErrors(zodError: ZodError): FieldError[] {
  return zodError.issues.map((issue: ZodIssue) => ({
    field: issue.path.join('.'),   // ["body","numero_socio"] → "body.numero_socio"
    message: issue.message,
    code: issue.code,
  }));
}

// Usage in route handler:
const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  throw BusinessError('VALIDATION_ERROR', 'Request body is invalid', mapZodErrors(parsed.error));
}
```

**Alternatives considered**: Inline error mapping per route (duplicates logic, inconsistent messages), Zod custom error map (global, harder to customize per schema).
**Rationale**: `ZodIssue` already contains `path`, `message`, and `code` — the mapping is a direct 1:1 transformation. Single function ensures consistent field paths (`body.field`) across all routes. Zod's `issues` array naturally supports multiple field errors per the spec's scenario.

### Decision: Import Pipeline Error Tracking — `failed_records` Table + Job Status Aggregation

**Choice**: Per-record import errors are inserted into a `failed_records` table keyed to `job_id`. The `import_jobs` table aggregates `errors_count` from this table. Job status is computed as: `'completed'` if `errors_count = 0`, `'partial'` if `errors_count > 0` and `records_imported > 0`, `'failed'` if `records_imported = 0`.

```typescript
// packages/import/src/status.ts
interface ImportJobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  tables_imported: string[];
  records_imported: number;
  errors_count: number;
  started_at: string;
  finished_at: string | null;
  errors: ImportError[];
}

interface ImportError {
  table: string;
  legacy_key: string | null;
  field: string | null;
  error_code: string;
  message: string;
  row_data?: Record<string, unknown>; // always redacted of sensitive fields
}
```

```sql
-- failed_records table
CREATE TABLE failed_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES import_jobs(id),
  table_name TEXT NOT NULL,
  legacy_key TEXT,
  field_name TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  row_data JSONB,  -- redacted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_failed_records_job ON failed_records (job_id);
```

**Alternatives considered**: Errors stored as JSONB array in `import_jobs.errors` (row-level lock contention on high-volume imports, hard to query individually), in-memory array returned via job status endpoint (lost on restart).
**Rationale**: Normalized `failed_records` table handles high-volume inserts (many failed rows) without row bloat. Individual rows are queryable by job, table, or legacy key. Aggregation via `errors_count` is a simple count query — no array manipulation needed.

### Decision: Fastify Error Handler — Global Plugin with `setErrorHandler`

**Choice**: A single `error-handler.ts` plugin registered once at app boot registers `setErrorHandler` and `notFoundHandler`. All error types (business, technical, Fastify validation) flow through this single handler.

```typescript
// packages/errors/src/handler.ts
import { FastifyPluginAsync } from 'fastify';
import { ApiError } from './api-error.js';
import { redact } from './redact.js';

export const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId;

    if (error instanceof ApiError) {
      const logLevel = error.isBusiness ? 'warn' : 'error';
      fastify[logLevel]({
        request_id: requestId,
        operator_id: request.operator?.id ?? null,
        endpoint: request.url,
        method: request.method,
        duration_ms: Date.now() - request.startTime,
        status_code: error.statusCode,
        error_code: error.code,
        message: error.message,
        stack: error.isBusiness ? undefined : error.stack,
      });

      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.isBusiness ? error.message : 'An unexpected error occurred',
        details: error.details,
        request_id: requestId,
      });
    }

    // Fastify built-in validation errors (non-Zod)
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
        request_id: requestId,
      });
    }

    // Unknown error — treat as technical
    fastify.error({
      request_id: requestId,
      operator_id: request.operator?.id ?? null,
      endpoint: request.url,
      method: request.method,
      duration_ms: Date.now() - request.startTime,
      status_code: 500,
      error_code: 'INTERNAL_ERROR',
      message: error.message,
      stack: error.stack,
    });

    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: requestId,
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
      request_id: request.requestId,
    });
  });
};
```

**Alternatives considered**: Per-route `try/catch` (inconsistent, easy to miss), Fastify error hooks (`onError`) only (doesn't handle 404 or validation the same way).
**Rationale**: `setErrorHandler` is the idiomatic Fastify approach — catches all thrown errors including `ApiError` instances and Fastify's built-in validation. Single handler ensures consistent logging, redaction, and response shape. No per-route error boilerplate needed.

### Decision: Logging Library — pino (Fastify Built-in)

**Choice**: Use Fastify's default `pino` logger with JSON output. Configuration via `apps/api/src/server.ts`:

```typescript
// apps/api/src/server.ts
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoDate,
    redact: ['password', 'refresh_token', 'access_token', 'Authorization', 'dni'],
  },
  requestIdRequestBody: false,
});
```

**Alternatives considered**: `winston` (adds a second logger instance alongside Fastify's, double logging configuration), `pino-pretty` (development-only, should not be in production).
**Rationale**: pino is Fastify's built-in and the spec explicitly references it. Using Fastify's logger instance means all `fastify.log.*` calls throughout the app share the same configuration, including the `redact` paths. No extra dependencies.

## Data Flow — Error Handling

```
Request ──► onRequest hook ──► requestId = "req_<uuid>" ──► Route Handler
                                                             │
                          ┌─────────────────────────────────┴──────────────┐
                          │                                              │
                     Zod schema                                      throw ApiError
                     safeParse()                                     (BusinessError /
                      │                                                TechnicalError)
                      ▼                                                        │
               VALIDATION_ERROR ──► mapZodErrors() ──► FieldError[]           │
               ──► BusinessError ──► setErrorHandler ──► reply.status(400)   │
                                                                       │
                                          ┌─────────────────────────────┘
                                          ▼
                               setErrorHandler ──► reply.status(code)
                                          │
                                          ├──► isBusiness? ──► fastify.warn({...})
                                          │                                fastify.error({...})
                                          └──► reply.send({ error, message,
                                              request_id, details? })
```

## File Changes — Error Handling Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/errors/src/codes.ts` | Create | `ErrorCode` enum with all 13 error codes |
| `packages/errors/src/api-error.ts` | Create | `ApiError` class + `BusinessError` / `TechnicalError` factories |
| `packages/errors/src/redact.ts` | Create | `redact()` utility for sensitive data redaction |
| `packages/errors/src/zod.ts` | Create | `mapZodErrors()` Zod → `FieldError[]` mapper |
| `packages/errors/src/request-id.ts` | Create | Fastify plugin for `request_id` generation + `X-Request-ID` header |
| `packages/errors/src/handler.ts` | Create | Global `setErrorHandler` + `setNotFoundHandler` plugin |
| `packages/errors/src/index.ts` | Create | Public exports for all error package modules |
| `packages/errors/package.json` | Create | Package manifest with `ErrorCode` type export |
| `db/schema/failed_records.sql` | Create | DDL for failed_records table |
| `db/migrations/0007_failed_records.sql` | Create | Migration for failed_records |
| `packages/db/src/schema/failed_records.ts` | Create | Drizzle schema for failed_records |
| `apps/api/src/server.ts` | Modify | Register `requestIdPlugin` + `errorHandlerPlugin`, configure pino redaction |

## Interfaces / Contracts — Error Handling

### ApiError (reference implementation)

```typescript
// packages/errors/src/api-error.ts
class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly isBusiness: boolean,
    public readonly details?: unknown
  ) { /* ... */ }
}

// packages/errors/src/codes.ts
const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  APPROVAL_LINK_EXPIRED: 'APPROVAL_LINK_EXPIRED',
  APPROVAL_ALREADY_USED: 'APPROVAL_ALREADY_USED',
  REASON_REQUIRED: 'REASON_REQUIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];
```

### failed_records Table

```sql
CREATE TABLE failed_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES import_jobs(id),
  table_name TEXT NOT NULL,
  legacy_key TEXT,
  field_name TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  row_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_failed_records_job ON failed_records (job_id);
```

## Testing Strategy — Error Handling

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `ApiError.toJSON()` serializes correctly | Vitest: new ApiError → JSON → assert fields |
| Unit | `BusinessError` / `TechnicalError` factories set `isBusiness` correctly | Vitest: assert isBusiness=true / false |
| Unit | `redact()` replaces sensitive fields recursively | Vitest: nested obj with password + dni → assert all `[REDACTED]` |
| Unit | `redact()` preserves non-sensitive fields | Vitest: obj with nombre, apellido → assert unchanged |
| Unit | `mapZodErrors()` transforms Zod issues to FieldError[] | Vitest: Zod error with 2 issues → assert 2 FieldError entries |
| Unit | `mapZodErrors()` joins path with '.' | Vitest: path `['body','email']` → field `"body.email"` |
| Integration | Zod validation failure → 400 + VALIDATION_ERROR + details | Testcontainers: POST with missing field → assert 400 + FieldError[] |
| Integration | BusinessError thrown → 4xx + no stack in response | Integration: throw BusinessError → assert response has no `stack` |
| Integration | Unknown error → 500 + INTERNAL_ERROR + generic message | Integration: throw plain Error → assert 500 + no internal detail leaked |
| Integration | request_id in response header `X-Request-ID` | Integration: GET /health → assert `X-Request-ID` header present |
| Integration | Import job with per-record errors → partial status | Integration: import 100 rows, 2 fail → assert status=partial, errors_count=2 |

## Migration / Rollback — Error Handling

**Migration**: Run `0007_failed_records.sql`. No data to migrate — new table.

**Rollback**: `failed_records` table can be dropped safely. Error handling code (packages/errors) can be removed — remaining code throws plain errors which Fastify's built-in handler catches as 500 `INTERNAL_ERROR`. No breaking change to the API contract.

## Open Questions — Error Handling

- [ ] Should `SERVICE_UNAVAILABLE` trigger a Fastify graceful degradation (return 503 without crashing the process), or is a standard error throw sufficient?
- [ ] Do we need a `RETRY_AFTER` header on `RATE_LIMIT_EXCEEDED` or `ACCOUNT_LOCKED` responses? The spec doesn't specify.
- [ ] Is there a maximum size for the `details` field in error responses (e.g., a VALIDATION_ERROR with 100 field errors)? Should we truncate?

---

## Config/Environment Design

### Decision: Zod Env Schema — Centralized in `packages/config/src/env.ts`

**Choice**: Single Zod schema exports `envSchema` and a singleton `validateEnv()` function. All validation is synchronous. Schema defines each variable's name, type, required/optional, and secret flag. Secrets are marked with `redact: true`.

**Alternatives considered**: Per-package env validation (fragmented, inconsistent), JSON schema (no runtime validation, requires extra tool), env schema in `apps/api` directly (couples API to config structure).
**Rationale**: Centralizing in `packages/config` makes the schema the single source of truth for all environment variables. Zod provides runtime type safety from a compile-time TypeScript type. The `redact` flag on secret fields enables consistent log redaction without scattering field names across the codebase.

### Decision: .env Loading — `dotenv` at Entry Point, Before Any Import

**Choice**: `dotenv` is loaded in `apps/api/src/index.ts` before the Fastify server is instantiated. It loads `.env` (development), `.env.staging` (staging), or nothing (production). Shell environment variables always take precedence over `.env` file values.

**Alternatives considered**: `dotenv-cli` wrapper script (adds external dependency to dev workflow), automatic dotenv loading via `import` side effects (fragile, order-dependent), `dotenv-flow` (Node_ENV-aware but adds complexity).
**Rationale**: Explicit loading at the entry point is transparent and auditable. `dotenv` is the simplest solution that satisfies the spec's requirement. Shell precedence (already-set env vars override `.env`) is `dotenv`'s default behavior and matches the "merge with already-set environment variables" requirement.

### Decision: Startup Validation — Synchronous, Blocking, First Step

**Choice**: `validateEnv()` runs synchronously at module load time (top-level await in `index.ts` before server start). On validation failure, it calls `process.exit(1)` with a generic message — no stack trace, no variable names exposed.

**Alternatives considered**: Async validation on first request (allows server to start before validation — violates fail-fast principle), lazy validation per route (scattered, easy to miss).
**Rationale**: Synchronous blocking validation at startup ensures the process never enters an undefined state. `process.exit(1)` is the correct behavior for fatal startup errors. Generic error messages prevent log injection attacks.

### Decision: Secrets in Production — Environment Variable Injection Only

**Choice**: Production uses environment variables injected by the orchestrator (Docker, Kubernetes). No Docker secrets files, no Vault, no AWS Secrets Manager in v1. All required secrets are validated as non-empty strings at startup.

**Alternatives considered**: Docker secrets (`/run/secrets/`) — requires Swarm mode, adds secret file handling complexity; Kubernetes Secrets — requires K8s setup, secrets mounted as files not env vars; Vault — adds external dependency and initialization complexity for v1.
**Rationale**: The spec says "Docker secrets or env injection" — env injection is simpler and works across all orchestrators. This is not a permanent commitment; the architecture allows swapping in Docker secrets or Vault later without changing the application code. Secrets are validated at startup, not lazily.

### Decision: LEGACY_DB_PATH — Environment Variable + Volume Mount Validation

**Choice**: `LEGACY_DB_PATH` is set as an environment variable. On startup, after env validation, the path is checked for existence and readability via `fs.accessSync(path, fs.constants.R_OK)`. If the check fails, process exits with code 1.

**Alternatives considered**: Only Docker volume mount (path never validated by app — could fail at import time with cryptic error), only environment variable (path could point to non-existent share in dev).
**Rationale**: Both mechanisms are complementary. The environment variable provides flexibility across environments; the runtime check catches misconfiguration immediately rather than failing mid-import. The path is NOT environment-specific per the spec — it's the same path concept but verified per environment.

### Decision: CORS_ORIGINS — Comma-Separated String, Runtime Parsing

**Choice**: `CORS_ORIGINS` is a comma-separated string: `https://app.gorriti.org,https://admin.gorriti.org`. Parsed at runtime by splitting on `,` and trimming whitespace. In development, `http://localhost:*` is expanded to match any localhost port via regex.

**Alternatives considered**: JSON array env var (`'["https://app.gorriti.org"]'`) — requires `JSON.parse`, more error-prone; `CORS_ORIGIN_1`, `CORS_ORIGIN_2` indexed vars — awkward to manage, not in spec.
**Rationale**: Comma-separated is the simplest format that matches the spec's examples. Parsing at runtime is trivial (`String.split`). The `localhost:*` expansion is a development convenience only — explicitly forbidden in production via wildcard rejection.

### Decision: Multiple .env Files — `.env` for Dev, `.env.staging` for Staging

**Choice**: Standard `dotenv` loading with `NODE_ENV`-aware file selection. No `.env.local`, no `.env.development` — just `.env` (dev default) and `.env.staging` (staging). Production uses no `.env` file.

**Alternatives considered**: `.env.local` override pattern (adds file precedence complexity), `.env.development` (verbose, dotenv supports `NODE_ENV` directly).
**Rationale**: `dotenv` natively supports `NODE_ENV` file loading: `.env` for development, `.env.{NODE_ENV}` for other tiers. This is the simplest convention that matches the spec's three-tier model.

### Decision: Config Package Structure — `packages/config/src/env.ts` + `packages/config/package.json`

**Choice**: `packages/config` is a new package containing only environment schema and validation. No other configuration (no feature flags, no app settings). Structure:

```
packages/config/
├── package.json
└── src/
    ├── env.ts         # Zod schema + validateEnv()
    ├── index.ts       # Public exports
    └── types.ts       # Derived TypeScript types from schema
```

**Alternatives considered**: Put config in `packages/shared` (mixes concerns), put config in `apps/api/src/config` (not reusable by other apps like workers).
**Rationale**: A dedicated `packages/config` follows the monorepo convention of extracting shared concerns into packages. It is reusable by API, workers, and CLI tools. Keeping it minimal (env only) prevents scope creep.

## Data Flow — Environment Loading & Validation

```
apps/api/src/index.ts
        │
        ├── dotenv.config() ──► .env / .env.staging / (nothing in prod)
        │                      Shell env vars always take precedence
        │
        ├── validateEnv() ────► Zod schema.parse(process.env)
        │                      │
        │                      ├── Success ──► log "Environment validation passed"
        │                      │               proceed to server.start()
        │                      │
        │                      └── Failure ──► log generic FATAL message
        │                                     process.exit(1)
        │
        ├── LEGACY_DB_PATH ──► fs.accessSync(..., R_OK)
        │                      │
        │                      ├── Success ──► proceed
        │                      │
        │                      └── Failure ──► process.exit(1)
        │
        └── Fastify server.start()
```

## File Changes — Config/Environment Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/config/package.json` | Create | Package manifest with `zod` dependency |
| `packages/config/src/env.ts` | Create | Zod schema + `validateEnv()` |
| `packages/config/src/types.ts` | Create | Derived TypeScript types from schema |
| `packages/config/src/index.ts` | Create | Public exports |
| `apps/api/src/index.ts` | Create | Entry point: dotenv + validateEnv + server start |
| `apps/api/src/server.ts` | Create | Fastify server factory |
| `.env.example` | Create | Template with all required variables + comments |

## Interfaces / Contracts — Config/Environment

### Zod Schema (reference)

```typescript
// packages/config/src/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  LEGACY_DB_PATH: z.string().min(1),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().email(),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().email(),
  CORS_ORIGINS: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

export { envSchema };
export type { Env };
```

### validateEnv() (reference)

```typescript
// packages/config/src/env.ts
import { envSchema } from './env.js';

function validateEnv(): void {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => i.path.join('.')).join(', ');
    console.error('FATAL: Environment validation failed');
    process.exit(1);
  }
  console.info('Environment validation passed');
}
```

### CORS Origin Parsing (reference)

```typescript
// packages/config/src/cors.ts
export function parseCorsOrigins(origins: string, nodeEnv: string): string[] {
  if (nodeEnv === 'production' && origins === '*') {
    console.error('FATAL: Wildcard CORS origin is not allowed in production');
    process.exit(1);
  }

  const parsed = origins.split(',').map(o => o.trim());

  if (nodeEnv === 'development') {
    return parsed.map(o => o === 'http://localhost:*' ? /^http:\/\/localhost:\d+$/ as unknown as string : o);
  }

  return parsed;
}
```

## Testing Strategy — Config/Environment

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Zod schema rejects invalid types | Vitest: `SMTP_PORT='not-a-number'` → assert safeParse fails |
| Unit | Zod schema requires non-empty secrets | Vitest: `JWT_SECRET=''` in production → assert safeParse fails |
| Unit | CORS wildcard rejected in production | Vitest: `CORS_ORIGINS='*', NODE_ENV='production'` → assert parseCorsOrigins exits |
| Unit | CORS localhost expansion in dev | Vitest: `CORS_ORIGINS='http://localhost:*'` → assert parsed array contains regex |
| Unit | Derived types match schema | Vitest: TypeScript type assertion on `z.infer<typeof envSchema>` |
| Integration | .env file loaded correctly | Testcontainers: write `.env`, import index, assert process.env populated |
| Integration | Validation halts startup on missing var | Integration: unset `DATABASE_URL`, start server, assert process.exit(1) called |

## Open Questions — Config/Environment

- [ ] Should `LOG_LEVEL` be a required env var or default to `info`/`error` based on `NODE_ENV`?
- [ ] Do we need a `dotenv` debug mode in development to trace which vars came from where?
- [ ] Should validation errors be logged to a file in production (for debugging), or only to stdout?

---

## Logging Design

### Decision: pino Pretty Writer in Development — Conditional via `NODE_ENV`

**Choice**: In non-production (`NODE_ENV !== 'production'`), wrap `pino` stdout writer with `pino-pretty`. In production, write raw JSON to stdout. The `pino-pretty` package is a dev dependency only — never loaded in production.

```typescript
// apps/api/src/server.ts
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const logger = isProd
  ? pino({
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'athlos-api' },
      timestamp: pino.stdTimeFunctions.isoDate,
      redact: ['password', 'refresh_token', 'access_token', 'Authorization', 'dni'],
      formatters: { level: (label) => ({ level: label }) },
    })
  : pino({
      level: process.env.LOG_LEVEL ?? 'debug',
      base: { service: 'athlos-api' },
      timestamp: pino.stdTimeFunctions.isoDate,
      redact: ['password', 'refresh_token', 'access_token', 'Authorization', 'dni'],
      formatters: { level: (label) => ({ level: label }) },
    }).pretty(); // pino-pretty wraps stdout with human-readable formatting

const fastify = Fastify({ logger });
```

**Alternatives considered**: Always JSON (devs pipe through `pino-pretty` CLI externally — adds friction), pretty-print always (breaks log aggregation in staging).
**Rationale**: The spec requires human-readable output in dev and JSON in prod. `pino-pretty` as a dev-only dependency keeps production lean. The `NODE_ENV` check is the standard Fastify convention for environment-aware behavior.

### Decision: Service Name — `base` Object in pino Configuration

**Choice**: Set `service: 'athlos-api'` in pino's `base` object. This field appears in every log entry automatically — no per-call injection needed.

```typescript
base: { service: 'athlos-api' }
```

**Alternatives considered**: Inject `service` field in every `log.info({ service: 'athlos-api', ... })` call (error-prone, violates DRY), use `pino.ext` or custom serializer (adds complexity).
**Rationale**: `base` is the idiomatic pino way to attach static fields to every log entry. Single configuration point, guaranteed consistency across all `fastify.log.*` calls.

### Decision: Request/Response Logging — Fastify Built-in with Custom Serializers

**Choice**: Fastify's built-in request logging is enabled by default (`logger: true`). Customize with `serializers` to include `operator_id` and ensure `request_id` is logged. Custom `startTime` is captured in the `onRequest` hook for `duration_ms` calculation.

```typescript
// apps/api/src/server.ts
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'athlos-api' },
    timestamp: pino.stdTimeFunctions.isoDate,
    redact: ['password', 'refresh_token', 'access_token', 'Authorization', 'dni'],
    formatters: { level: (label) => ({ level: label }) },
    serializers: {
      req: (request) => ({
        request_id: request.requestId,
        method: request.method,
        url: request.url,
        operator_id: request.operator?.id ?? null,
      }),
      res: (reply) => ({
        status_code: reply.statusCode,
      }),
    },
  },
  requestIdRequestBody: false,
});
```

The `onRequest` hook sets `request.startTime = Date.now()`. The error handler computes `duration_ms: Date.now() - request.startTime`.

**Alternatives considered**: Manual request logging per route (inconsistent, verbose), custom request logging plugin replacing Fastify's (loses Fastify's built-in `req`/`res` lifecycle hooks).
**Rationale**: Fastify's request logging is built on pino and integrates with the logger instance. Custom serializers attach the fields the spec requires without replacing the entire logging infrastructure.

### Decision: Import Batch Logging — Child Loggers with `job_id` Binding

**Choice**: The import pipeline creates a child logger per job via `fastify.log.child({ job_id })`. Each table within the job creates a further child with `table`. Per-record failures use the table-scoped child.

```typescript
// packages/import/src/logger.ts
export function createImportLogger(fastify: FastifyInstance, jobId: string) {
  return fastify.log.child({ job_id: jobId });
}

export function createTableLogger(importLogger: pino.Logger, table: string) {
  return importLogger.child({ table });
}

// Usage in import pipeline:
const importLog = createImportLogger(fastify, jobId);
importLog.info({ event: 'IMPORT_BATCH_STARTED', records_total: 1000 });

const tableLog = createTableLogger(importLog, 'socios');
tableLog.info({ event: 'IMPORT_TABLE_STARTED', records_in_table: 500 });
tableLog.info({ event: 'IMPORT_TABLE_COMPLETED', records_succeeded: 498, records_failed: 2, duration_ms: 1200 });
```

**Alternatives considered**: Single flat logger with `job_id` in every call (caller must remember to pass it, easy to forget), separate logger instance per import (loses Fastify's shared configuration).
**Rationale**: Child loggers inherit the parent's configuration (redact, timestamp, service name) while adding contextual fields. `job_id` and `table` appear in every entry automatically. The import pipeline doesn't need to pass context through every function call.

### Decision: Import Per-Record Error Logging — WARN Level with Redacted `row_data`

**Choice**: Per-record failures log at WARN with `event: 'IMPORT_RECORD_FAILED'`. The `redact()` utility from `packages/errors` is called on `row_data` before inclusion — never log raw sensitive fields.

```typescript
// In import pipeline per-record error handler:
import { redact } from '@athlos/errors';

tableLog.warn({
  event: 'IMPORT_RECORD_FAILED',
  table: 'socios',
  legacy_key: row.legacy_key,
  error_code: 'VALIDATION_ERROR',
  error_message: 'Invalid DNI format',
  row_data: redact(row_data), // sensitive fields stripped
});
```

**Alternatives considered**: Log raw `row_data` and rely on pino's redact (pino redact only handles exact field paths, not recursive), log error without row data (reduces debuggability).
**Rationale**: The spec requires per-record failure logging with redacted row data. The `redact()` utility is already defined in the error handling design — calling it at the logging boundary is consistent and auditable.

### Decision: Error Logging with Stack Trace — `err` Field Serializer

**Choice**: Technical errors (5xx) logged via `fastify.error({ ..., err })` where `err` is the `Error` object. pino's built-in error serializer extracts `message`, `type`, and `stack`. The error handler already handles this pattern.

```typescript
// In error handler (from Error Handling Design):
fastify.error({
  request_id: requestId,
  operator_id: request.operator?.id ?? null,
  endpoint: request.url,
  method: request.method,
  duration_ms: Date.now() - request.startTime,
  status_code: 500,
  error_code: 'INTERNAL_ERROR',
  message: error.message,
  err: error, // pino serializes to { message, stack, type }
});
```

**Alternatives considered**: Embed `stack` as a flat string field (breaks log aggregation query structure), log `err.stack` directly (loses pino's structured error format).
**Rationale**: pino's `err` serializer is the standard way to log errors with stack traces. The serialized output includes `message`, `stack`, and `type` as structured fields — queryable in log aggregation systems. The error handler already uses this pattern.

## Data Flow — Logging

```
Server boot ──► pino configured ──► Fastify logger ready
                    │
                    ├── base: { service: 'athlos-api' }
                    ├── redact: [password, refresh_token, ...]
                    └── level: from LOG_LEVEL env var

Request ──► onRequest hook ──► requestId = "req_<uuid>" ──► startTime set
                                                              │
                                         ┌────────────────────┴────────────────────┐
                                         │                                         │
                                    Route Handler                           throw ApiError
                                         │                                         │
                                         │                          setErrorHandler ──► fastify.warn/error
                                         │                                         │
                                  fastify.log.info                          reply.status(code)
                                  (HTTP lifecycle)                         + { error, message,
                                                                            request_id }
```

## File Changes — Logging Addition

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/server.ts` | Modify | Environment-aware pino config: pretty writer in dev, `base.service`, custom serializers |
| `packages/import/src/logger.ts` | Create | `createImportLogger()` and `createTableLogger()` child logger factories |
| `apps/api/src/routes/import.ts` | Modify | Use import child loggers for batch/table/record events |

## Interfaces / Contracts — Logging

### pino Configuration (reference)

```typescript
// apps/api/src/server.ts — production config
const pinoConfig = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'athlos-api' },
  timestamp: pino.stdTimeFunctions.isoDate,
  redact: ['password', 'refresh_token', 'access_token', 'Authorization', 'dni'],
  formatters: { level: (label) => ({ level: label }) },
};
```

### Import Batch Log Entry (example)

```json
{
  "level": "info",
  "service": "athlos-api",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "event": "IMPORT_BATCH_COMPLETED",
  "status": "partial",
  "tables": [
    { "table": "socios", "records_succeeded": 100, "records_failed": 2 },
    { "table": "CTACTE", "records_succeeded": 5000, "records_failed": 0 }
  ],
  "records_total": 5100,
  "records_succeeded": 5098,
  "records_failed": 2,
  "duration_ms": 45000,
  "time": "2026-06-12T10:30:00.000Z"
}
```

### HTTP Lifecycle Log Entry (example)

```json
{
  "level": "info",
  "service": "athlos-api",
  "request_id": "req_abc123",
  "method": "GET",
  "url": "/api/v1/socios",
  "status_code": 200,
  "duration_ms": 45,
  "operator_id": "uuid-of-operator",
  "time": "2026-06-12T10:30:00.000Z"
}
```

## Testing Strategy — Logging

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Child logger inherits base config | Vitest: `logger.child({job_id})` → assert redact paths inherited |
| Unit | `createImportLogger` adds `job_id` to all entries | Vitest: child.info() → assert log output contains job_id |
| Unit | `redact()` called on row_data before import error log | Vitest: mock row_data with password field → assert `[REDACTED]` in log output |
| Integration | Dev mode: pino-pretty output is human-readable | Integration: `NODE_ENV=development`, log info → assert stdout contains color codes |
| Integration | Prod mode: JSON output is valid JSON per line | Integration: `NODE_ENV=production`, log info → assert each line is `JSON.parse`-able |
| Integration | Import batch logs contain all required fields | Integration: run import batch → assert log contains job_id, event, records_total, status |
| Integration | HTTP request log contains request_id, operator_id | Integration: authenticated GET → assert log entry has both fields |

## Open Questions — Logging

- [ ] Should `pino-pretty` be a CLI tool invoked externally in dev (`pino-pretty | grep ...`), or bundled as a dev dependency that wraps stdout?
- [ ] Do we need a log sampling strategy for high-volume endpoints (e.g., log 1% of health checks)?
- [ ] Should the import completion summary be logged as a single entry with nested `tables[]` array, or as separate per-table entries aggregated by `job_id`?

---

## Deployment/DevOps Design

### Decision: Dockerfile — Multi-Stage Build with Alpine Base

**Choice**: Two-stage build. Stage 1 (`builder`): install all dependencies including devDependencies, compile TypeScript. Stage 2 (`production`): copy only compiled output and production node_modules. Base image: `node:20-alpine`. Production stage uses non-root user (`node` UID 1000).

**Alternatives considered**: Single-stage with `npm ci --omit=dev` (requires careful layer caching to avoid reinstalling on every code change), Debian-based image (larger attack surface, more storage).
**Rationale**: Multi-stage ensures devDependencies (testing libraries, TypeScript) never enter the production image. Alpine keeps the final image minimal (~150MB vs ~900MB for Debian). Non-root user follows container security best practices.

### Decision: devDependencies Handling — Stage 1 Only

**Choice**: `npm ci` in Stage 1 installs all dependencies. Stage 2 copies `node_modules` via `npm ci --omit=dev` or copies from a cached layer. TypeScript compiles to `dist/`.

**Alternatives considered**: `npm install --only=production` in single stage (defeats layer caching — code changes trigger full reinstall), `pnpm` with workspace (adds build complexity).
**Rationale**: The spec requires production image with no devDependencies. Multi-stage is the canonical pattern for this. Layer caching on `package.json` changes means dependencies only reinstall when packages change.

### Decision: Entrypoint Script — Migration Runner with Smart Retry

**Choice**: Custom entrypoint script (`docker-entrypoint.sh`) wraps the Node.js process. On startup, if `RUN_MIGRATIONS=true`, it executes `drizzle migrate` before starting the API. On failure, it exits with code 1. The script handles `DATABASE_URL` parsing for connection retry logic.

```bash
#!/bin/sh
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  npx drizzle migrate --force
  if [ $? -ne 0 ]; then
    echo "FATAL: Migrations failed"
    exit 1
  fi
fi

exec node dist/index.js
```

**Alternatives considered**: Init container pattern (runs migrations in separate container before API starts — adds orchestration complexity), migration as separate docker-compose service (requires shared network and init ordering).
**Rationale**: The spec requires migrations to run on API startup when `RUN_MIGRATIONS=true`. Entrypoint script is the simplest mechanism — no extra service, no init container, no shared network. Exit-on-failure ensures API doesn't start with unapplied migrations.

### Decision: docker-compose.yml — Services: `api`, `db`, Named Volumes

**Choice**: Three services: `api` (Fastify API), `db` (PostgreSQL 16 Alpine), `migrations` (one-shot migration runner). Named volumes for `db_data` and `import_working`. PostgreSQL uses `postgres:16-alpine` image. API waits for `db` health check before starting.

```yaml
version: '3.9'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: athlos
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 30s
      retries: 5

  migrations:
    build: .
    dockerfile: Dockerfile
    command: ["npx", "drizzle", "migrate", "--force"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      RUN_MIGRATIONS: "false"
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  api:
    build: .
    dockerfile: Dockerfile
    command: ["sh", "-c", "docker-entrypoint.sh"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: ${NODE_ENV}
      RUN_MIGRATIONS: ${RUN_MIGRATIONS:-true}
      LEGACY_DB_PATH: ${LEGACY_DB_PATH}
      CORS_ORIGINS: ${CORS_ORIGINS}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM: ${SMTP_FROM}
    volumes:
      - ${LEGACY_DB_PATH}:${LEGACY_DB_PATH}:ro
      - import_working:/import_working
    ports:
      - "3001:3001"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3001/health || exit 1"]
      interval: 5s
      timeout: 30s
      retries: 5

volumes:
  db_data:
  import_working:
```

**Alternatives considered**: Separate `migrate` service that runs and exits (requires `restart: unless-stopped` logic and shared network), `depends_on` with condition `service_completed_successfully` (Docker Compose v2.1 only — not universally available).
**Rationale**: `service_healthy` condition on `db` ensures API only starts when PostgreSQL is ready. `migrations` service is a one-shot runner — fails fast if migrations error. Named volumes prevent data loss on container restart.

### Decision: GitHub Actions CI Pipeline — `.github/workflows/ci.yml`

**Choice**: Single workflow file with jobs: `lint` → `test` → `build` → `push`. Branch-based image tagging: `main` → `latest` + `<git-sha>`, `staging` → `staging`. Uses Docker Buildx for multi-platform builds. Pushes to GHCR (GitHub Container Registry).

```yaml
name: CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io/${{ github.repository_owner }}
  IMAGE_NAME: athlos-api

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: athlos_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 30s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build:
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push'
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
            type=raw,value=staging,enable=${{ github.ref == 'refs/heads/staging' }}
            type=sha,prefix=,format=raw
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  push:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'
    environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Pull image
        run: docker pull ${{ needs.build.outputs.image-tag }}
      - name: Deploy to ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
        run: |
          # kubectl/docker stack deploy commands would go here
          echo "Deploying ${{ needs.build.outputs.image-tag }} to ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}"
```

**Alternatives considered**: Separate `deploy.yml` workflow (decouples build from deploy — but build must complete before deploy), `docker/compose` action for stack deployment (requires Docker on the runner).
**Rationale**: Single workflow keeps CI simple. Branch-based tagging matches the spec. `needs: lint` / `needs: test` creates a proper fail-fast pipeline. Docker Buildx with `cache-from: type=gha` enables fast incremental builds.

### Decision: GitHub Actions Secrets — Required Variables

**Choice**: Secrets stored in GitHub repository settings. Required for production deployment: `POSTGRES_PASSWORD`, `JWT_SECRET`, `DATABASE_URL` (constructed from individual parts). Optional per-environment: `SMTP_*` for email notifications.

| Secret | Required | Description |
|--------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password for runtime |
| `JWT_SECRET` | Yes | JWT signing secret (min 32 chars) |
| `DATABASE_URL` | Yes | Full connection string for production |
| `SMTP_HOST` | No | Email delivery host |
| `SMTP_PORT` | No | Email delivery port |
| `SMTP_USER` | No | Email auth user |
| `SMTP_PASS` | No | Email auth password |
| `SMTP_FROM` | No | From address for transactional email |

**Alternatives considered**: Individual `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` secrets combined into `DATABASE_URL` at runtime (avoids storing the full connection string — but more env var proliferation).
**Rationale**: `DATABASE_URL` as a single secret is the simplest approach for Docker injection. Individual SMTP secrets only needed if email is configured. All other config comes from the compose environment.

### Decision: Image Tagging Strategy — Git SHA + Branch Aliases

**Choice**: Every push to `main` or `staging` produces:
- `ghcr.io/athlos/athlos-api:<git-sha>` (always, unique per commit)
- `ghcr.io/athlos/athlos-api:latest` (main only, points to latest main)
- `ghcr.io/athlos/athlos-api:staging` (staging only, points to latest staging)

**Alternatives considered**: Semantic versioning tags (requires version bump workflow — overhead for v1), branch name tags (can contain slashes, complicates image names).
**Rationale**: Git SHA tag is immutable and traceable — if a deployment fails, you can `docker pull ghcr.io/athlos/athlos-api:abc1234` to rollback exactly. `latest` and `staging` are human-friendly aliases for day-to-day operations.

### Decision: Rollback Strategy — Docker Pull Previous Tag

**Choice**: Rollback procedure: (1) Identify the previous good git SHA from Git history. (2) `docker pull ghcr.io/athlos/athlos-api:<previous-sha>`. (3) Restart the API container with the previous image tag. (4) No database migration rollback needed for code-only rollbacks — migrations are idempotent (using `drizzle migrate --force`).

**Alternatives considered**: Rolling back migrations (risky — data may have been written), separate "rollback" workflow (adds CI complexity without benefit for v1).
**Rationale**: Drizzle migrations are designed to be idempotent and applied incrementally. A code rollback doesn't require migration rollback — the previous migration state is already in the database. `docker pull` is the simplest rollback mechanism.

### Decision: Backup Script — `pg_dump` with gzip, Daily Cron, 7-Day Retention

**Choice**: Backup script at `scripts/backup.sh` executes `pg_dump` with gzip compression. Cron schedule: daily at 02:00 UTC. Retention: 7 daily backups minimum, auto-delete after 30 days. Storage: mounted volume at `/backups` (outside PostgreSQL data volume).

```bash
#!/bin/sh
set -e

BACKUP_DIR=${BACKUP_DIR:-/backups}
DATABASE_URL=${DATABASE_URL}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="athlos_${TIMESTAMP}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "${BACKUP_DIR}/${BACKUP_NAME}"

# Retention: delete backups older than 30 days
find "$BACKUP_DIR" -name "athlos_*.sql.gz" -mtime +30 -delete

echo "Backup complete: ${BACKUP_NAME}"
```

**Alternatives considered**: PostgreSQL WAL archiving (overkill for v1 — requires continuous replication setup), cloud backup service (adds external dependency and cost).
**Rationale**: `pg_dump` is the simplest production backup mechanism for a single-node PostgreSQL setup. gzip compression reduces storage. 30-day retention matches the spec. Volume mount keeps backups outside the container filesystem.

### Decision: Import Volume Mount — Read-Only Host Path

**Choice**: `LEGACY_DB_PATH` is mounted as a read-only volume in the `api` service. The host path is specified via `LEGACY_DB_PATH` environment variable. The `import_working` named volume provides scratch space for import processing.

```yaml
api:
  volumes:
    - ${LEGACY_DB_PATH}:${LEGACY_DB_PATH}:ro
    - import_working:/import_working
```

**Alternatives considered**: Bind mount with `:ro` flag (requires host path to exist at startup — fails if path is wrong), tmpfs mount for working directory (data lost on container restart — not suitable for import processing).
**Rationale**: Read-only mount prevents the import process from accidentally modifying the legacy data. Named volume for working space survives container restarts and can be cleaned independently. `:ro` flag is the Docker mechanism for read-only bind mounts.

## Data Flow — Deployment/DevOps

```
Git Push ──► GitHub Actions ──► lint ──► test ──► build ──► push
                                                        │
                                                        ├──► ghcr.io/athlos/athlos-api:<git-sha>
                                                        ├──► ghcr.io/athlos/athlos-api:latest (main only)
                                                        └──► ghcr.io/athlos/athlos-api:staging (staging only)

docker-compose up ──► db starts ──► db healthy ──► migrations run (one-shot)
                                                        │
                                                        └──► api starts ──► health check ──► healthy
```

## File Changes — Deployment/DevOps Addition

| File | Action | Description |
|------|--------|-------------|
| `Dockerfile` | Create | Multi-stage build: builder + production stages |
| `docker-entrypoint.sh` | Create | Entrypoint script: migration runner + API start |
| `docker-compose.yml` | Create | Services: api, db, migrations; volumes; healthchecks |
| `scripts/backup.sh` | Create | pg_dump backup script with gzip + retention |
| `.github/workflows/ci.yml` | Create | CI/CD pipeline: lint, test, build, push |
| `.env.example` | Update | Add all deployment-related env vars with comments |

## Interfaces / Contracts — Deployment/DevOps

### Dockerfile (reference)

```dockerfile
# Stage 1: builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -u 1000
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
USER appuser
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

### Health Check Endpoint (reference)

```typescript
// apps/api/src/routes/health.ts
fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));
```

## Testing Strategy — Deployment/DevOps

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | `docker build` produces image without error | Bash: `docker build -t test-build . && docker run test-build --version` |
| Integration | `docker-compose up` starts all services | Bash: `docker-compose up -d && docker-compose ps` |
| Integration | Health check returns `healthy` status | Bash: `curl http://localhost:3001/health` after startup |
| Integration | Migration runs on startup when `RUN_MIGRATIONS=true` | Bash: check logs for "Running database migrations..." |
| Integration | DB stays running after migration failure | Bash: kill migrations, assert db still running |
| Integration | Backup script produces valid gzip SQL | Bash: run backup.sh, `gunzip -t <backup file>` |
| Integration | CI pipeline runs all stages on PR | GitHub Actions: push to feature branch, assert all jobs pass |
| Integration | Image tagged correctly on main push | GitHub Actions: assert `latest` and `<sha>` tags exist |
| Integration | Rollback: previous tag still pullable | Bash: `docker pull ghcr.io/athlos/athlos-api:<previous-sha>` |

## Migration / Rollback — Deployment/DevOps

**Migration**: No database migration required — this is pure infrastructure. The backup script and CI pipeline are new additions to the repository.

**Rollback**: If the CI pipeline breaks, revert the GitHub Actions workflow file to the previous commit. If a Docker image is bad, `docker pull ghcr.io/athlos/athlos-api:<previous-sha>` and restart the container. No database changes are involved in deployment rollbacks.

## Open Questions — Deployment/DevOps

- [ ] Should we use Kubernetes for production orchestration, or stick with docker-compose on a single VM?
- [ ] Do we need a separate `backup` service in docker-compose, or run backups via a cron job on the host?
- [ ] Should the staging environment use the same `postgres:16-alpine` image or a separate test database instance?
- [ ] Do we need a `docker-compose.override.yml` for local development that auto-starts the API with `pino-pretty` output?
- [ ] Should we use Docker layer caching in CI via GitHub Actions cache (already in workflow) or a separate registry?

---

## API Security Design

### Decision: Rate Limiting Library — `@fastify/rate-limit`

**Choice**: `@fastify/rate-limit` with a custom `MemoryStore` using a `Map`-based TTL cache. Dual-layer enforcement: per-IP for all requests, per-JWT for authenticated requests.

**Alternatives considered**: `rate-limit-redis` (requires Redis — unnecessary complexity for v1), `express-rate-limit` (wrong framework), custom middleware (reinventing the wheel).
**Rationale**: `@fastify/rate-limit` is the idiomatic Fastify plugin. Custom `MemoryStore` gives us full control over TTL semantics and is trivially replaceable with a Redis store when scale demands. The dual-layer pattern (IP + JWT) is per the spec.

### Decision: Rate Limit Storage — In-Memory Map with TTL for v1

**Choice**: `Map<key, { count, resetAt }>` with rolling window. On every request: check if `resetAt < now()` → reset counter. Increment and check against limit. TTL-based eviction prevents memory growth.

**Alternatives considered**: Redis (adds external dependency before it's needed), `quick-lru` (adds a dependency for a simple Map replacement).
**Rationale**: A `Map` with manual TTL management is zero-dependency and sufficient for a single-instance v1 API. When a second instance is added, swap the `MemoryStore` for a Redis store — same interface, distributed state.

### Decision: Dual-Layer Rate Limit Configuration

**Choice**: Per-IP limit applies to ALL requests. Per-JWT limit applies only to authenticated endpoints (requests with valid JWT). Exempt endpoints bypass both layers.

| Layer | Scope | Limit | Window |
|-------|-------|-------|--------|
| Per-IP | Unauthenticated | 30 req | 1 min |
| Per-IP | Authenticated | 100 req | 1 min |
| Per-JWT | Authenticated | 200 req | 1 min |

**Exempt endpoints**: `GET /health`, `GET /api/v1/approval/{token}`, `POST /api/v1/approval/{token}`.

**Alternatives considered**: Single unified layer (doesn't distinguish IP vs JWT), only per-IP (doesn't protect against token reuse attacks).
**Rationale**: The spec defines three distinct limits. Per-IP for unauthenticated protects against brute force. Per-JWT for authenticated protects against token abuse. Exempt endpoints are intentionally unauthenticated and must not be throttled.

### Decision: Rate Limit Response Shape

**Choice**: HTTP 429 with `Retry-After` header (integer seconds) and JSON body: `{"error":"RATE_LIMIT_EXCEEDED","retry_after":<seconds>}`.

**Alternatives considered**: `X-RateLimit-*` headers (useful for clients but not required by spec), vary-by-IP vs vary-by-JWT differentiation (over-engineered for v1).
**Rationale**: Spec says "Retry-After header (in seconds) and JSON body with error code and time until reset." The `retry_after` value is the delta to the next available window.

### Decision: Helmet Integration — `@fastify/helmet`

**Choice**: `@fastify/helmet` registered as a Fastify plugin. Content-Security-Policy varies by `NODE_ENV`: restrictive `Content-Security-Policy` in production, `Content-Security-Policy-Report-Only` in development.

**Alternatives considered**: Set headers manually in `onSend` hook (loses Helmet's expert-tuned configurations), reverse proxy sets headers (defense in depth requires app-level headers too).
**Rationale**: `@fastify/helmet` is the Fastify-native Helmet wrapper. App-level header setting is required even behind a reverse proxy — defense in depth. CSP report-only in dev allows debugging without enforcement.

### Decision: CORS — `@fastify/cors` with Dynamic Origin from Env

**Choice**: `@fastify/cors` configured with `origin` as a function that parses `CORS_ORIGINS` at runtime. Credentials supported only when origin is in the allowlist (not wildcard). `maxAge: 86400` for preflight caching.

**Alternatives considered**: Static origin array (requires restart to update), wildcard origin with credentials (explicitly forbidden by spec).
**Rationale**: `CORS_ORIGINS` is already defined as a comma-separated env var in the config-environment spec. The parsing logic is centralized in `packages/config/src/cors.ts`. Credentials validation per spec: reject `Access-Control-Allow-Credentials: true` when origin is `*`.

### Decision: Request Body Size Limit — Fastify `body.limit`

**Choice**: `body.limit: '1mb'` passed to Fastify server options. Returns 413 Payload Too Large when exceeded.

**Alternatives considered**: Custom `preHandler` to check `content-length` header (redundant — Fastify handles this natively), separate body parser configuration per route (inconsistent).
**Rationale**: Fastify's built-in body limit is the correct mechanism. Setting it once at the server level applies to all routes uniformly.

### Decision: Header Injection Prevention — Regex Strip on `onRequest`

**Choice**: A Fastify `onRequest` hook strips `\r` and `\n` from all incoming header values. Requests with injection attempts return 400 Bad Request with `{"error":"INVALID_HEADER"}`.

**Alternatives considered**: Reject only on detection (same behavior, just different hook), let downstream handle it (too late — headers may have already been processed).
**Rationale**: Header injection is a CWE-113 vulnerability. Interception at `onRequest` is the earliest possible point. A simple regex replacement is sufficient — the header value may still be useful after sanitization.

### Decision: API Key Storage — SHA-256 Hash in `api_keys` Table

**Choice**: `api_keys` table per spec. Key creation: `crypto.createHash('sha256').update(plainKey).digest('hex')`. Storage: hash only, never plaintext. The raw key is returned once at creation time.

**Alternatives considered**: bcrypt (designed for passwords, unnecessary cost for API keys), Argon2 (same — overkill for high-entropy random keys).
**Rationale**: SHA-256 is the spec requirement. API keys are high-entropy random strings — bcrypt/Argon2 cost factors are designed for low-entropy passwords and are unnecessary overhead here. The hash is one-way and computationally infeasible to reverse for a random key.

### Decision: API Key Validation Middleware — Fastify `preHandler` Hook

**Choice**: `apiKeyGuard()` preHandler hook that reads `X-API-Key` header, hashes it, looks up in `api_keys`, checks `is_active` and `scopes`, and injects `request.apiKey = { serviceName, scopes }`. Scope check: `requestedEndpoint.startsWith(key.scope)` pattern.

**Alternatives considered**: Decorator per route (verbose), global plugin (makes API key mandatory on all routes — not correct for JWT-authenticated routes).
**Rationale**: A dedicated preHandler hook that is applied only to routes that need API key auth is the right granularity. The auth middleware from the auth-login design handles JWT routes separately. API key routes are for external services and bypass JWT entirely.

### Decision: XSS Prevention — Custom JSON Serializer with HTML Encoding

**Choice**: Fastify custom `serializer` function that HTML-encodes all string values before JSON serialization. Uses `fastify-serialize` or manual `escapeHtml` utility wrapping `require('html-escape')`.

**Alternatives considered**: Output encoding at every field (error-prone, easy to forget), disable `script` tag acceptance at input (too restrictive — the field may legitimately contain `<script>` as data).
**Rationale**: The spec says "ALL user-provided data returned in JSON responses MUST be HTML-encoded by the JSON serializer." A custom serializer applied globally ensures every response is automatically sanitized. User-provided data includes any field that could contain `<script>` tags — this is the only correct interception point.

### Decision: Audit Event Actions — `AUTH_FAILURE`, `PERMISSION_DENIED`, `RATE_LIMIT_HIT`, `API_KEY_USED`, `API_KEY_REJECTED`

**Choice**: Security events emitted to `audit_events` table with `action` field set to the event type. Auth failures logged after 3rd attempt within 15-minute window. Permission denials logged on every 403. Rate limit hits logged on every 429.

**Alternatives considered**: Separate `security_events` table (fragments audit trail), log-only for auth failures (insufficient — spec requires audit record).
**Rationale**: The `audit_events` table is already defined in the spec and used for auth-login events. Adding security events here keeps the audit trail unified. The action field differentiates event types.

## Data Flow — API Security

```
Request ──► onRequest hook ──► Header injection check
              │
              ├── 400 INVALID_HEADER ──► reject
              │
              ├── Rate limit check (per-IP) ──► 429 RATE_LIMIT_EXCEEDED
              │                                     │
              │                                     └── audit_events (RATE_LIMIT_HIT)
              │
              ├── JWT auth check (if route protected)
              │     │
              │     ├── Rate limit check (per-JWT) ──► 429 RATE_LIMIT_EXCEEDED
              │     │
              │     └── RBAC / permission check ──► 403 PERMISSION_DENIED
              │                                       │
              │                                       └── audit_events (PERMISSION_DENIED)
              │
              ├── API key check (if route uses apiKeyGuard)
              │     │
              │     ├── Hash + lookup api_keys ──► 401 API_KEY_INVALID
              │     │                               │
              │     │                               └── audit_events (API_KEY_REJECTED)
              │     │
              │     └── Scope check ──► 403 API_KEY_SCOPE_INSUFFICIENT
              │
              ├── Body size check ──► 413 PAYLOAD_TOO_LARGE
              │
              └── Helmet headers set on response
                          │
                          └── JSON serializer ──► HTML-encoded output
```

## File Changes — API Security Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/security/src/rate-limit.ts` | Create | Rate limit plugin + MemoryStore implementation |
| `packages/security/src/helmet.ts` | Create | Helmet Fastify plugin with CSP configuration |
| `packages/security/src/cors.ts` | Create | CORS configuration from CORS_ORIGINS |
| `packages/security/src/api-key.ts` | Create | API key guard + hash/verify utilities |
| `packages/security/src/audit.ts` | Create | Security event audit emitter |
| `packages/security/src/header-injection.ts` | Create | Header sanitization onRequest hook |
| `packages/security/src/serializer.ts` | Create | Custom JSON serializer with HTML encoding |
| `packages/security/src/index.ts` | Create | Public exports |
| `packages/security/package.json` | Create | Package manifest |
| `db/schema/api_keys.sql` | Create | DDL for api_keys table |
| `db/migrations/0008_api_keys.sql` | Create | Migration for api_keys |
| `packages/db/src/schema/api_keys.ts` | Create | Drizzle schema for api_keys |
| `apps/api/src/server.ts` | Modify | Register security plugins, set body.limit |
| `apps/api/src/routes/_api-key.ts` | Create | Example route using apiKeyGuard |

## Interfaces / Contracts — API Security

### MemoryStore (reference)

```typescript
// packages/security/src/rate-limit.ts
interface RateLimitStore {
  get(key: string): { count: number; resetAt: number } | undefined;
  increment(key: string, ttl: number): { count: number; resetAt: number };
  decrement(key: string): void;
}

class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetAt: number }>();

  increment(key: string, ttl: number): { count: number; resetAt: number } {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || existing.resetAt < now) {
      const resetAt = now + ttl;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }
    existing.count++;
    return existing;
  }

  // TTL cleanup: run every 60s, delete expired entries
}
```

### api_keys Table

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);
```

### API Key Guard (usage)

```typescript
// External service route
fastify.get('/api/v1/external/socios', {
  preHandler: [apiKeyGuard('GET /api/v1/socios')]
}, async (request, reply) => { ... });
```

### Helmet Configuration (reference)

```typescript
// packages/security/src/helmet.ts
const cspDirectives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'"],
  'connect-src': ["'self'"],
};

const helmetConfig = {
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? cspDirectives : false,
  contentSecurityPolicyReportOnly: process.env.NODE_ENV !== 'production' ? cspDirectives : false,
  // Other headers always set
};
```

### Security Audit Event (reference)

```typescript
// packages/security/src/audit.ts
interface SecurityAuditEvent {
  action: 'AUTH_FAILURE' | 'PERMISSION_DENIED' | 'RATE_LIMIT_HIT' | 'API_KEY_USED' | 'API_KEY_REJECTED';
  entity_type?: string;
  entity_id?: string;
  operator_id?: string;
  details: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}
```

## Testing Strategy — API Security

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | MemoryStore increments and resets on TTL | Vitest: increment twice within window → count=2, after TTL → count=1 |
| Unit | Per-IP limit: 31st unauthenticated request returns 429 | Vitest: mock IP, call 30 times, assert 31st returns 429 |
| Unit | Per-JWT limit: 201st authenticated request returns 429 | Vitest: mock JWT, call 200 times, assert 201st returns 429 |
| Unit | Exempt endpoints bypass rate limit | Vitest: GET /health after IP limit exceeded → assert 200 |
| Unit | Helmet headers present on all responses | Vitest: GET /health → assert HSTS, X-Frame-Options, etc. in reply headers |
| Unit | CORS: allowed origin returns Access-Control-Allow-Origin | Vitest: mock CORS_ORIGINS, request with valid origin → assert header present |
| Unit | CORS: wildcard origin with credentials rejected | Vitest: CORS_ORIGINS='*', request with credentials → assert no Access-Control-Allow-Credentials |
| Unit | API key hash stored, not plaintext | Vitest: createApiKey() → assert SHA-256 hash stored, raw key returned once |
| Unit | API key scope check: valid scope allows request | Vitest: key scoped to GET /api/v1/socios, request to that → assert allowed |
| Unit | API key scope check: insufficient scope returns 403 | Vitest: key scoped to GET /api/v1/socios, request to POST → assert 403 |
| Unit | HTML serializer encodes `<script>` as `<script>` | Vitest: serialize `{nombre: '<script>'} → assert contains `<script>` |
| Unit | Header injection: `\r\n` stripped from header value | Vitest: request with `X-Forwarded-For: 1.2.3.4\r\nMalicious: value` → assert clean value |
| Integration | 413 returned on 2MB POST body | Integration: POST with large body → assert 413 |
| Integration | Auth failure after 3rd attempt logged | Integration: 4 failed logins → assert audit_events row with AUTH_FAILURE |
| Integration | Permission denial logged with full context | Integration: role=CONSULTA calls POST /api/v1/socios → assert audit_events row |
| E2E | Full security stack: CORS + rate limit + helmet + API key | Playwright: external service calls with valid API key, assert success |

## Migration / Rollback — API Security

**Migration**: Run `0008_api_keys.sql`. New table — no data migration. The `audit_events` table is already defined in the auth-login design.

**Rollback**: `api_keys` table can be dropped safely. Security middleware in `apps/api/src/server.ts` can be removed — remaining endpoints work without API key auth. `audit_events` table remains for auth events.

## Open Questions — API Security

- [ ] Should rate limit counters be persisted across instance restarts (e.g., for zero-downtime deploys)?
- [ ] Do we need an admin endpoint to revoke API keys, or is direct DB manipulation acceptable for v1?
- [ ] Should API key creation be exposed via an internal API, or only via a migration script?
- [ ] Should we log the actual API key value (hashed) on `API_KEY_USED` events for auditability, or is service name sufficient?

---
## User Management and RBAC Design

### Decision: Effective Permission Resolution — Per-Request Query with Delegation Join

**Choice**: Compute effective permissions on each request via a single SQL query that joins `operators` (role defaults + overrides) with `operator_delegations` (active grants). JWT claims stay short-lived; the canonical answer is the DB row. Permissions resolve as: `role_default ⊕ operator_flag ⊕ active_delegation`.
**Alternatives considered**: Materialized view per operator (stale on role change, requires refresh job); PostgreSQL function returning a `SETOF` (adds a new function surface, harder to mock in tests); caching permissions in Redis (new dependency, two-source-of-truth problem).
**Rationale**: 20 operators means query latency is negligible. The query plan uses the partial index `idx_delegations_active` and a single-row PK lookup on `operators.id` — sub-millisecond. DB is the single source of truth, so role changes, deactivations, and revocations take effect on the next request without cache invalidation. The 15-minute access token TTL means we never hold a stale permission claim longer than the spec's stated bound.

```sql
-- packages/auth/src/effective-permissions.ts (shape, not full SQL)
SELECT
  o.id, o.role, o.can_reprint, o.can_anulate, o.is_active,
  bool_or(d.permission = 'can_reprint' AND d.revoked_at IS NULL AND d.expires_at > now()) AS delegated_reprint,
  bool_or(d.permission = 'can_anulate' AND d.revoked_at IS NULL AND d.expires_at > now()) AS delegated_anulate
FROM operators o
LEFT JOIN operator_delegations d ON d.operator_id = o.id
WHERE o.id = $1
GROUP BY o.id;
```

### Decision: Delegation Schema — Explicit `revoked_at` + Partial Active Index

**Choice**: `operator_delegations` table with `granted_by_operator_id`, `granted_at`, `expires_at`, `revoked_at`, `revoked_by_operator_id`, `reason`. Active state is `revoked_at IS NULL AND expires_at > now()` enforced by a **partial index** `WHERE revoked_at IS NULL` for fast "is there a live grant" checks.
**Alternatives considered**: `is_active BOOLEAN` flag (must be flipped by a background job, drift risk); separate `delegation_history` table (denormalized for no benefit); grant = row insert + separate expiry job (two writes, two failure modes).
**Rationale**: `revoked_at` preserves the audit trail without losing the row — the spec requires auditability. The partial index makes "active delegation exists" a cheap index probe. `granted_by` is non-nullable so we always know who granted what (for the revoker-permission check). Background expiry: a 5-minute cron marks `expires_at < now() AND revoked_at IS NULL` rows as still-active-but-expired — but no row mutation is needed; the WHERE clause handles it. Only on revocations or admin overrides do we write `revoked_at`.

### Decision: Operator CRUD Endpoints — `/api/v1/admin/operators` Namespace

**Choice**: Group all admin operator management under `/api/v1/admin/operators`: `POST` (create), `GET` (list, paginated), `GET /:id` (detail), `PATCH /:id` (update), `DELETE /:id` (deactivate), `POST /:id/reset-password`, plus `/api/v1/admin/delegations` for delegation admin views. All routes require `requireRole('ADMIN')`. Password never appears in responses — `toOperatorDTO(row)` strips `password_hash`, `failed_login_attempts`, `locked_until`.
**Alternatives considered**: Flat `/api/v1/operators` (mixes self-service and admin, no clean gate); RESTful sub-resources `/api/v1/admin/operators/:id/permissions` (over-entityizes a 2-flag concern).
**Rationale**: `/admin/` namespace matches the spec's "admin-managed" framing and makes the `requireRole('ADMIN')` gate obvious at the route level. All admin routes share one preHandler — no per-route role check duplication. DTO stripping is centralized in `packages/auth/src/dto.ts` so no response can leak the hash by accident.

### Decision: Password Reset Flow — Admin Returns Temporary Password, Force Change on Next Login

**Choice**: `POST /api/v1/admin/operators/:id/reset-password` generates a 12-char cryptographically random temporary password (`crypto.randomBytes(9).toString('base64url')`), sets `must_change_password=true`, sets `password_updated_at=now()`, revokes all active refresh tokens, and returns the temporary password ONCE in the response. On next login, the user is forced through `POST /api/v1/auth/change-password` (the must_change_password check is in the login handler from auth-login).
**Alternatives considered**: One-time reset link sent to user's email (requires email infra we don't have; legacy users have no email stored); admin sets a known password directly (same flow, but admin must invent a password — random generation is stronger); reset token table (adds a table, equivalent security).
**Rationale**: The spec allows either "one-time temporary password" or "one-time reset link" — the password path is simpler and matches the legacy mental model. The admin delivers the temp password to the user out-of-band (phone, in person). `must_change_password` is checked in login.ts (auth-login) and the change-password handler clears it after success. Token revocation is mandatory so an attacker with the old session can't ride it.

### Decision: Self-Service Endpoints — Auth-Namespace, Operator-Scoped

**Choice**: `GET /api/v1/auth/me` returns the caller's profile (id, username, role, permissions — including active delegations merged in, last_login_at, must_change_password). `GET /api/v1/auth/login-history?limit=&offset=` paginates `operator_login_events` filtered by `operator_id = request.operator.id` — last 30 days, never other operators. `POST /api/v1/auth/change-password` accepts `{current_password, new_password}`, verifies current via bcrypt, checks against the last 10 hashes in `operator_password_history`, rejects reuse, then inserts the new hash and rotates the history window.
**Alternatives considered**: Profile in `/api/v1/operators/me` (consistency with admin namespace, but mixes self with admin — admin routes are gated); no pagination on login history (small N, but spec explicitly requires it).
**Rationale**: All three endpoints share the same gate: any authenticated operator (`requireAuth()` only, no role check). Filtering by `request.operator.id` in the SQL WHERE clause is the enforcement point for "MUST NOT expose other operators' histories" — a missing filter is a security bug, so the service function takes `operatorId` as a required arg, not the request object.

### Decision: Audit Integration — One Hook, All RBAC Events

**Choice**: All RBAC-related events route to `audit_events` with `entity_type='operator'`, `entity_id=operator_id`, and `action` set to the event name. The `permission-denied` preHandler emits a row in the same `setErrorHandler` flow — on `ApiError(INSUFFICIENT_PERMISSIONS)`, the handler inserts the audit row before sending the 403.
**Alternatives considered**: Middleware that writes audit only for 403s (two places to maintain — middleware + handler); separate `rbac_events` table (fragments trail).
**Rationale**: The existing `audit_events` table already holds `AUTH_LOGIN`/`AUTH_FAILED` (auth-login) and `PERMISSION_DENIED` (api-security). Adding `OPERATOR_CREATED`, `OPERATOR_ROLE_CHANGED`, `OPERATOR_DEACTIVATED`, `PASSWORD_RESET_BY_ADMIN`, `PASSWORD_CHANGED`, `DELEGATION_GRANTED`, `DELEGATION_REVOKED`, `PERMISSION_OVERRIDE` keeps the trail unified. The full list: any state-changing operator action plus every 403.

### Decision: Password History — Rolling Window of 10 Hashes

**Choice**: Every successful password set (create, reset, change) inserts the previous hash into `operator_password_history` (then stores the new hash in `operators.password_hash`). On `change-password`, the service `bcrypt.compare`s the new candidate against the last 10 rows for that operator — any match returns `PASSWORD_RECENTLY_USED` (400). After successful change, delete `operator_password_history` rows older than the most recent 10.
**Alternatives considered**: Keep all hashes forever (storage grows unbounded, even at 20 users it's wasteful); check reuse in app code only (works for 20 users but the spec calls for a dedicated table).
**Rationale**: The spec mandates "last 10 hashes" — 10 is the spec's number, not a deviation. Trimming keeps the table small. Storage cost is negligible (10 rows × ~60-byte bcrypt hash per user). The dedicated table also lets us query "has this password been used before" if we later add password rotation policies.

### Decision: Delegation Enforcement — Same Permission Layer, Live Data

**Choice**: Delegations are merged at the same layer as the role-default resolution: the effective-permissions query (Decision 1) returns the operator's effective `can_reprint` / `can_anulate` as `flag OR has_active_delegation`. `requirePermission('can_reprint')` checks the merged value, NOT the JWT claim. This means a delegation granted at 10:00 takes effect on the operator's NEXT request — no token refresh needed.
**Alternatives considered**: Bake delegations into a new JWT at refresh time (up to 15-min delay, adds complexity to refresh); separate `requireDelegatedPermission` hook (two hooks to remember, easy to pick the wrong one).
**Rationale**: The spec says "effective permissions MUST revert immediately" on revoke — only live DB reads satisfy that. The query is fast enough to run on every request. Using the same `requirePermission` hook means route definitions don't need to know whether a permission is role-default, flag, or delegated — they're all the same boolean to the gate.

### Decision: Protected Route Registration Guard — Startup Audit

**Choice**: At app boot, a one-time pass audits the route registry: any route whose `url` matches `^/api/v1/.*` and is NOT in the public allow-list (`/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/approval/*`, `/healthz`) MUST declare at least one `requireRole(...)` or `requirePermission(...)` preHandler. Violations throw at startup.
**Alternatives considered**: Per-route decorator (`@RequireRole('ADMIN')`) enforced at compile time (TS decorators are not idiomatic in this codebase); runtime check on every request (defeats the purpose — route registered without a gate would still serve).
**Rationale**: A startup audit makes "missing gate" a fatal deployment error, not a runtime surprise. The public allow-list is an explicit list — easy to audit, easy to extend. The check runs once during `apps/api/src/server.ts` boot, after all route plugins are registered.

## Data Flow — User Management and RBAC

```
Admin Client           API                DB                    Audit
   │                   │                  │                       │
   │── POST /admin/operators ─►           │                       │
   │                   │── hash(pwd) ─────►│                       │
   │                   │── insert row ────►│                       │
   │                   │── insert hist ───►│                       │
   │◄─ 201 OperatorDTO│                  │                       │
   │                   │── emit OPERATOR_CREATED ────────────────►│
   │                   │                  │                       │
   │── POST /admin/operators/:id/         │                       │
   │        reset-password ─►            │                       │
   │                   │── gen temp pwd ──│                       │
   │                   │── set must_change=true ►                 │
   │                   │── revoke all refresh tokens ►             │
   │◄─ 200 {temp_pwd} │                  │                       │
   │                   │── emit PASSWORD_RESET_BY_ADMIN ─────────►│
   │                   │                  │                       │
   │── Caller hits any gated route ─►     │                       │
   │                   │── effective-perms query ──►              │
   │                   │◄─ role, flag, delegated ───               │
   │                   │── requirePermission('can_x')              │
   │                   │     ├── grant ─► handler runs             │
   │                   │     └── deny ──► throw INSUFFICIENT       │
   │                   │                  │                       │
   │                   │── setErrorHandler ── emit PERMISSION_DENIED ►
   │◄─ 403 + error code│                  │                       │
   │                   │                  │                       │
   │── POST /admin/operators/:id/         │                       │
   │        delegations ─►                │                       │
   │                   │── validate duration ≤ 24h                 │
   │                   │── insert delegation ►                     │
   │                   │── emit DELEGATION_GRANTED ───────────────►│
   │◄─ 201 delegation  │                  │                       │
```

## File Changes — User Management and RBAC

| File | Action | Description |
|------|--------|-------------|
| `db/migrations/0009_user_management.sql` | Create | Adds columns to `operators`, creates `operator_password_history`, `operator_delegations`, `operator_login_events` |
| `packages/db/src/schema/operators.ts` | Modify | Add `must_change_password`, `password_updated_at` |
| `packages/db/src/schema/password_history.ts` | Create | Drizzle schema for `operator_password_history` |
| `packages/db/src/schema/delegations.ts` | Create | Drizzle schema for `operator_delegations` |
| `packages/db/src/schema/login_events.ts` | Create | Drizzle schema for `operator_login_events` |
| `packages/auth/src/effective-permissions.ts` | Create | `getEffectivePermissions(operatorId)` — the canonical resolver |
| `packages/auth/src/dto.ts` | Create | `toOperatorDTO(row)` — strips `password_hash`, `failed_login_attempts`, `locked_until` |
| `packages/auth/src/password-history.ts` | Create | `findRecentHashes()`, `recordPassword()`, `trimHistory()` |
| `packages/auth/src/operators.ts` | Create | `createOperator`, `updateOperator`, `deactivateOperator`, `resetPassword` |
| `packages/auth/src/delegations.ts` | Create | `grantDelegation`, `revokeDelegation`, `listActiveDelegations` |
| `packages/auth/src/self-service.ts` | Create | `getMe`, `getLoginHistory`, `changePassword` |
| `packages/auth/src/route-audit.ts` | Create | Boot-time route registration audit (requireRole/requirePermission presence) |
| `apps/api/src/routes/admin-operators.ts` | Create | `/api/v1/admin/operators/*` routes (ADMIN-gated) |
| `apps/api/src/routes/admin-delegations.ts` | Create | `/api/v1/admin/delegations/*` and revoke-by-id |
| `apps/api/src/routes/auth-me.ts` | Create | `/api/v1/auth/me`, `/api/v1/auth/login-history`, `/api/v1/auth/change-password` |
| `apps/api/src/routes/operator-delegations.ts` | Create | `POST /api/v1/operators/:id/delegations` (TESORERO-gated) |
| `apps/api/src/server.ts` | Modify | Register `routeAuditPlugin()` after all route plugins |
| `packages/errors/src/codes.ts` | Modify | Add 8 new error codes (see below) |

## Interfaces / Contracts — User Management and RBAC

### Schema (Migration 0009)

```sql
-- Operators table extensions
ALTER TABLE operators
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Password history
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

-- Login events
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

### New Error Codes (additions to `packages/errors/src/codes.ts`)

```typescript
USERNAME_TAKEN, INVALID_ROLE, CANNOT_MODIFY_OWN_ROLE, CANNOT_DEACTIVATE_SELF,
CANNOT_ESCALATE_READONLY_ROLE, DELEGATION_MAX_24H, CANNOT_DELEGATE_ADMIN,
PASSWORD_RECENTLY_USED, INVALID_CURRENT_PASSWORD, ACCOUNT_DISABLED
```

### Effective Permissions Service

```typescript
// packages/auth/src/effective-permissions.ts
interface EffectivePermissions {
  operator_id: string;
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  can_reprint: boolean;
  can_anulate: boolean;
  is_active: boolean;
  must_change_password: boolean;
}

async function getEffectivePermissions(operatorId: string): Promise<EffectivePermissions>;
```

### Operator DTO

```typescript
// packages/auth/src/dto.ts
interface OperatorDTO {
  id: string;
  username: string;
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  can_reprint: boolean;
  can_anulate: boolean;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}
// NEVER includes: password_hash, failed_login_attempts, locked_until
```

## Testing Strategy — User Management and RBAC

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `getEffectivePermissions` merges role default + flag + delegation | Vitest: mock DB → return row with `can_reprint=false, delegated_reprint=true` → assert effective `can_reprint=true` |
| Unit | `toOperatorDTO` strips `password_hash` | Vitest: row with all fields → DTO → assert no `password_hash` key |
| Unit | `changePassword` rejects when current bcrypt fails | Vitest: wrong `current_password` → throw `INVALID_CURRENT_PASSWORD` |
| Unit | `changePassword` rejects reuse against last 10 hashes | Vitest: candidate matches row 3 of last 10 → throw `PASSWORD_RECENTLY_USED` |
| Unit | Delegation grant rejects `duration_hours > 24` | Vitest: input 48 → throw `DELEGATION_MAX_24H` |
| Unit | Delegation grant rejects `permission='role'` payload | Vitest: payload `{role:'ADMIN'}` → throw `CANNOT_DELEGATE_ADMIN` |
| Unit | `routeAuditPlugin` throws when a `/api/v1/*` route has no gate | Vitest: register route with no preHandler → assert boot throws |
| Integration | POST `/admin/operators` as ADMIN → 201 + audit row | Testcontainers: login as ADMIN, create operator, assert `OPERATOR_CREATED` in `audit_events` |
| Integration | POST `/admin/operators` as TESORERO → 403 + `PERMISSION_DENIED` audit | Testcontainers: login as TESORERO, assert 403 + audit row |
| Integration | PATCH `/admin/operators/:id` with `can_reprint=true` for CONSULTA → 403 `CANNOT_ESCALATE_READONLY_ROLE` | Testcontainers: setup CONSULTA, call PATCH, assert 403 |
| Integration | Self-update role → 403 `CANNOT_MODIFY_OWN_ROLE` | Testcontainers: ADMIN PATCHes self, assert 403 |
| Integration | Reset password revokes all refresh tokens | Testcontainers: insert 3 refresh tokens, call reset, assert all `revoked_at` set |
| Integration | Change password trims history to 10 rows | Testcontainers: insert 12 history rows, call change, assert oldest 2 deleted |
| Integration | Delegation auto-expires on next request | Testcontainers: grant with `expires_at = now() - 1s`, call gated route, assert 403 |
| Integration | Delegation revoke is immediate | Testcontainers: grant, revoke, call gated route, assert 403 |
| Integration | Login history paginates and is operator-scoped | Testcontainers: insert 35 events for self + 10 for other, GET with limit=10 offset=20, assert 10 of self only |
| E2E | Admin creates operator → temp password delivered → operator logs in → forced change → normal use | Playwright: create, login, assert `must_change_password` flag, change, assert clean session |

## Migration / Rollback — User Management and RBAC

**Migration**: Run `0009_user_management.sql`. New columns on `operators` have safe defaults (`must_change_password=false`). New tables are empty. Existing operators keep working — `must_change_password=false` means no forced change on next login.
**Rollback**: Drop the three new tables; drop the two new columns. The audit events for operator actions remain in `audit_events` (history preserved) but no new events will be written. DTO stripping is a code change — if rolled back, restore `password_hash` in responses (NOT recommended — this is a security downgrade).

## Open Questions — User Management and RBAC

- [ ] Should the temp password in reset-password be returned in the body AND shown in a UI confirmation dialog, or only in the body? (Admin UX concern.)
- [ ] When an operator with active delegations is deactivated, should the delegations auto-revoke, or persist (orphaned, no effect since operator can't log in)?
- [ ] Should `operator_login_events` retain a TTL (e.g., 90 days) for size control, or is it append-only forever?
- [ ] Is the 10-hash history window per-operator or global? (Spec says "last 5" in one scenario but "last 10" in another — we picked 10 from the data model.)
- [ ] Should `GET /api/v1/admin/operators` show only active operators by default, with a query param to include deactivated?
- [ ] Do we need an `unlock` endpoint (admin clears `failed_login_attempts` + `locked_until` early), or does the 15-minute lockout auto-resolve on its own?

---

## Data Access Layer Design

### Decision: Folder Structure — `packages/db` for Schemas + Repos, `packages/services` for Orchestration

**Choice**: Three-tier layout. `packages/db/src/schema/{public,socios,contabilidad,tesoreria,deportes}.ts` (5 Drizzle schema files, one per PG schema, re-exported from `index.ts`). `packages/db/src/repositories/{socios,contabilidad,tesoreria,deportes,reporting}.ts` (per-domain repository modules). `packages/db/src/pool.ts` (single `pg.Pool` + Drizzle client). Cross-domain orchestration lives in `packages/services/` (one package per service: `pagos`, `asientos`, `import`).

**Alternatives considered**: Repositories inside `apps/api/src/` (couples DAL to API), single `packages/db/src/` without subfolders (10+ files in one dir), services co-located with repos (mixed concerns).
**Rationale**: `packages/db` is the only layer that imports `drizzle-orm` — enforced by ESLint `no-restricted-imports`. Repos are pure data access; services own business logic + transactions. Reporting queries cross schemas, so they get their own module under `repositories/reporting.ts` (not under any single domain).

### Decision: Repository Interface — Module-Scoped Functions With Drizzle-Inferred Types

**Choice**: Repositories are **named-export modules**, not classes. Each function takes a `db` handle (or `tx` handle for mutating ops inside a transaction) and returns `Promise<T>` where `T` is a Drizzle inferred type. No abstract base class, no DI container.

```typescript
// packages/db/src/repositories/socios.ts
import { socio } from '../schema/socios.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Socio, NewSocio } from '../schema';

export async function findById(db: NodePgDatabase, id: number): Promise<Socio | null> { ... }
export async function create(db: NodePgDatabase, input: NewSocio): Promise<Socio> { ... }
export async function update(db: NodePgDatabase, id: number, fields: Partial<NewSocio>): Promise<Socio> { ... }
```

**Alternatives considered**: Abstract class with `abstract` methods (over-engineered for 5 repos; TS structural typing makes it ceremony), Zod-validated inputs at the repo boundary (Zod is the API edge's job — re-validation is redundant).
**Rationale**: Functional modules are easier to mock in tests (Vitest `vi.mock`), compose inside transactions (pass `tx` instead of `db`), and align with the spec's "type signatures are the contract" stance. Drizzle inferred types (`typeof socio.$inferSelect` / `$inferInsert`) are the contract.

### Decision: Service Layer — Required When ≥2 Repos OR Business Logic Present

**Choice**: Services live in `packages/services/<domain>/` and own multi-repo transactions + business rules. Trivial single-repo reads (e.g., `tiposSocioRepository.findAll()`) are called directly from route handlers.

```typescript
// packages/services/pagos/src/create-payment.ts
export async function createPayment(db: NodePgDatabase, input: NewPayment) {
  return db.transaction(async (tx) => {
    const cc = await cuentaCorrienteRepo.create(tx, { ... });
    const asiento = await asientoRepo.create(tx, { ... });
    return { cc, asiento };
  });
}
```

**Alternatives considered**: Repos own transactions (couples data access to orchestration), no services — handlers orchestrate (un-testable, scatters logic), services always required (ceremony for trivial reads).
**Rationale**: Spec's rule of thumb — "service required when ≥2 repos OR business logic" — matches the cost/benefit. A `tiposSocio` GET doesn't earn a service; a payment POST absolutely does.

### Decision: Drizzle pgSchema — 5 Schema Declarations, One File Each, Barrel Re-export

**Choice**: Each schema file declares its own `pgSchema` and exports all tables. `schema/index.ts` imports all 5 and re-exports as a single object passed to `drizzle()`.

```typescript
// packages/db/src/schema/socios.ts
import { pgSchema } from 'drizzle-orm/pg-core';
export const sociosSchema = pgSchema('socios');
export const socio = sociosSchema.table('socio', { id: serial('id').primaryKey(), ... });
// ... all other socios.* tables

// packages/db/src/schema/index.ts
export * from './public.js';
export * from './socios.js';
export * from './contabilidad.js';
export * from './tesoreria.js';
export * from './deportes.js';
```

**drizzle.config.ts** `schema: './packages/db/src/schema/*.ts'` and `tablesFilter: ['athlos_*']` (or explicit table list).

**Alternatives considered**: Single `schema.ts` with all 5 `pgSchema` calls (500+ line file, hard to navigate), `pgSchema` per-table (same effect, no semantic gain), `pgSchema` calls duplicated (drift risk).
**Rationale**: One file per PG schema matches the spec's "mirroring the PostgreSQL schemas" rule literally. The barrel re-export gives services a single import path. `drizzle-kit` picks up the schemas automatically via glob.

### Decision: Connection Pool — Single Module, Lazy Export, Injected via Function Arg

**Choice**: `packages/db/src/pool.ts` exports `createDb()` — a factory that builds a `pg.Pool` (env-driven config) and a Drizzle client, returning both. The pool is created **once at process boot** in `apps/api/src/index.ts` and the resulting `db` is passed explicitly to repository functions.

```typescript
// packages/db/src/pool.ts
export function createDb(env: Env) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX ?? 20,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000,
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 5_000,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
```

**Alternatives considered**: Module-level singleton `export const db = drizzle(...)` (fails tests — pool created at import time), DI container (overkill for 5 repos), Fastify decorator (`request.db` per-request — wrong scope; pool is process-wide).
**Rationale**: Factory function + explicit pass-through makes the dependency visible at the call site (testability win) and avoids singleton pitfalls in Vitest's parallel test runs. The `db` instance is shared across all requests (one pool) but the function reference is injected, not globally mutated.

### Decision: Error Translation — DAL Throws, API Edge Translates

**Choice**: Repositories **never catch** Drizzle/PG errors. They throw them up verbatim. The only domain errors the DAL throws are `NotFoundError` (e.g., `SocioNotFoundError`) for cases the API needs to distinguish. The `apps/api/src/middleware/error-translator.ts` (extends the error-handler design) inspects `error.code` / `error.cause.code` (PG `SQLSTATE`) and maps to `ApiError`.

**SQLSTATE mapping** (already in spec §6):

| SQLSTATE | HTTP | ErrorCode |
|----------|------|-----------|
| 23505 | 409 | `DUPLICATE_RESOURCE` |
| 23503 | 400 | `INVALID_REFERENCE` |
| 23502 | 400 | `REQUIRED_FIELD_MISSING` |
| 23514 | 400 | `CONSTRAINT_VIOLATION` |
| 40001 / 40P01 | 409 | `CONCURRENCY_CONFLICT` |
| connection | 500 | `DATABASE_UNAVAILABLE` |

**Alternatives considered**: Catch in repo, translate there (couples DAL to HTTP semantics), translate in service layer (wrong layer — services shouldn't know HTTP), translate in route handler (per-route boilerplate).
**Rationale**: Spec is explicit. The error-translator middleware is a single point of truth; SQLSTATE codes are stable across PG versions. Repos stay pure data access.

### Decision: Transactions — Service Layer Opens, Repos Receive `tx`

**Choice**: `db.transaction(async (tx) => ...)` is opened in the **service**, not the route handler, not the repository. Repos accept a `db | tx` handle (both satisfy the same `PgTransaction`/`NodePgDatabase` interface) — same code runs in or out of a transaction. Nested service calls become savepoints (Drizzle's `tx.transaction(...)`).

**Alternatives considered**: Route handler opens transaction (handlers know business flow — wrong layer), repo opens transaction per call (multi-repo atomicity is the service's job), explicit `begin()` / `commit()` (no rollback safety).
**Rationale**: Spec scenario "creating a payment touches cuenta corriente + asiento" maps to a single `db.transaction` in `pagosService.createPayment`. The repo signature is unchanged between transactional and non-transactional use — Drizzle's `PgTransaction` is structurally compatible with `NodePgDatabase`.

### Decision: Cross-Schema Joins — Forbidden in CRUD, Required to Be Documented in Reports

**Choice**: `sociosRepository` may import from `public` (FK targets like `tipo_documento`) but **must not** import from `contabilidad`, `tesoreria`, or `deportes`. The `reportingRepository` (single coordinator module) owns the only legitimate cross-schema joins; its docblock MUST list the schemas + join keys.

```typescript
// packages/db/src/repositories/reporting.ts
/**
 * CROSS-SCHEMA COORDINATOR
 * Schemas touched: socios (socio, cuenta_corriente), contabilidad (asiento, detalle_asiento)
 * Join keys: cuenta_corriente.connroasie = asiento.connroasie
 * Reason: account statement report — cannot be split into per-schema queries
 *        because the connroasie linkage requires a single SQL statement.
 */
```

**Alternatives considered**: Foreign keys with `references()` across schemas in Drizzle (Drizzle supports it but encourages sprawl), per-request `db.select` orchestration in service (N+1 risk, can't be a single transaction for the read), views in PostgreSQL (acceptable but not in v1).
**Rationale**: Spec scenario "GET /socios/:id joins to contabilidad.asiento" is rejected — fetch socio first, then `asientoRepo.findBySocioId()`. Cross-schema joins are allowed only in the reporting module. The docblock is the audit trail.

### Decision: DAL Testing — Testcontainers + Real PostgreSQL, No Mocks

**Choice**: Integration tests for repos and services use **Testcontainers** spinning up a real `postgres:16-alpine` with all 5 schemas migrated. No in-memory SQLite, no Drizzle mocks. Each test file gets a fresh container (or transactional rollback within a shared container via `SAVEPOINT`).

```typescript
// packages/db/test/setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function createTestDb() {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: './packages/db/migrations' });
  return { db, pool, container };
}
```

**Alternatives considered**: PGlite (in-process PG) — fast but doesn't exercise real WAL/serializable behavior; SQLite + Drizzle SQLite dialect (Drizzle's PG-specific features like `pgSchema` aren't usable); mock `db` (defeats integration coverage).
**Rationale**: Spec scenario "two requests simultaneously call `obtener_siguiente_numero`" requires real serializable behavior — PGlite might mask PG-specific race conditions. Testcontainers is the only way to validate transaction semantics, FK constraints, and SQLSTATE codes against actual PG.

## Data Flow — Data Access Layer

```
Route Handler
     │
     ├── trivial GET ──► repo.findAll(db, ...) ──► SELECT ──► rows ──► Zod response DTO
     │
     └── mutating POST ──► service.create(input)
                                │
                                ├── Zod parse (API edge) ──► validated input
                                │
                                └── db.transaction(async (tx) => {
                                       repoA.create(tx, ...)  ──► INSERT ──► row
                                       repoB.create(tx, ...)  ──► INSERT ──► row
                                       return { a, b }
                                    })
                                            │
                                            ├── COMMIT (both succeed) ──► DTO
                                            │
                                            └── ROLLBACK (any throws) ──► PG error
                                                  │
                                                  └── error-translator middleware
                                                          │
                                                          ├── 23505 ──► 409 DUPLICATE_RESOURCE
                                                          ├── 23503 ──► 400 INVALID_REFERENCE
                                                          ├── 40001 ──► 409 CONCURRENCY_CONFLICT
                                                          └── other  ──► 500 INTERNAL_ERROR
```

## File Changes — Data Access Layer Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/db/package.json` | Create | `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`, `zod` |
| `packages/db/src/schema/public.ts` | Create | `pgSchema('public')` + `usuario`, `parametro`, `secuencia`, `tipo_comprobante`, `tipo_documento`, `seguro` |
| `packages/db/src/schema/socios.ts` | Create | `pgSchema('socios')` + `tipo_socio`, `estado_civil`, `provincia`, `barrio`, `obra_social`, `locacion`, `socio`, `socio_disciplina`, `cuenta_corriente`, `cuenta_corriente_pago` |
| `packages/db/src/schema/contabilidad.ts` | Create | `pgSchema('contabilidad')` + `cuenta`, `asiento`, `detalle_asiento`, `plantilla_asiento`, `plantilla_asiento_linea`, `plan_cuenta_movimiento` |
| `packages/db/src/schema/tesoreria.ts` | Create | `pgSchema('tesoreria')` + `caja`, `movimiento_caja`, `gasto`, `total_cuenta` |
| `packages/db/src/schema/deportes.ts` | Create | `pgSchema('deportes')` + `disciplina`, `escuela`, `jugador`, `pago_escuela`, `pago_socio_resumen` |
| `packages/db/src/schema/index.ts` | Create | Barrel re-export of all 5 schemas + `Soci`/`NewSoci`-style type re-exports |
| `packages/db/src/pool.ts` | Create | `createDb(env)` factory: `pg.Pool` + `drizzle(pool, { schema })` |
| `packages/db/src/errors.ts` | Create | `NotFoundError` (base) + per-domain subclasses (`SocioNotFoundError`, etc.) |
| `packages/db/src/repositories/socios.ts` | Create | `findById`, `findAll`, `create`, `update`, `findByNumeroSocio` |
| `packages/db/src/repositories/contabilidad.ts` | Create | `cuenta`, `asiento`, `detalle_asiento` repos |
| `packages/db/src/repositories/tesoreria.ts` | Create | `caja`, `movimiento_caja`, `gasto` repos |
| `packages/db/src/repositories/deportes.ts` | Create | `disciplina`, `escuela`, `pago_escuela` repos |
| `packages/db/src/repositories/public.ts` | Create | `usuario`, `parametro`, `secuencia`, `tipo_comprobante`, `tipo_documento` repos |
| `packages/db/src/repositories/reporting.ts` | Create | Cross-schema coordinator — docblock required |
| `packages/db/src/repositories/index.ts` | Create | Barrel re-export of all repos |
| `packages/db/drizzle.config.ts` | Create | `drizzle-kit` config: schema glob, migrations folder |
| `packages/db/migrations/` | Create | Generated by `drizzle-kit generate` (committed) |
| `apps/api/src/middleware/error-translator.ts` | Create | Fastify plugin: PG `SQLSTATE` → `ApiError` mapping (extends error-handler design) |
| `apps/api/src/index.ts` | Modify | Call `createDb(env)` once at boot, pass `db` to route factories |
| `apps/api/src/server.ts` | Modify | Register `errorTranslatorPlugin()` |

## Interfaces / Contracts — Data Access Layer

### Drizzle Schema (reference shape)

```typescript
// packages/db/src/schema/socios.ts
import { pgSchema, serial, varchar, integer, date, numeric, boolean } from 'drizzle-orm/pg-core';
import { tipoDocumento } from './public.js'; // FK to public is OK

export const sociosSchema = pgSchema('socios');
export const socio = sociosSchema.table('socio', {
  id: serial('id').primaryKey(),
  numero: varchar('numero', { length: 10 }).notNull().unique(),
  numeroSocio: varchar('numero_socio', { length: 10 }).notNull().unique(),
  apellido: varchar('apellido', { length: 40 }).notNull(),
  nombre: varchar('nombre', { length: 40 }).notNull(),
  tipoDocumentoId: smallint('tipo_documento_id').notNull().references(() => tipoDocumento.id),
  // ...
});

export type Socio = typeof socio.$inferSelect;
export type NewSocio = typeof socio.$inferInsert;
```

### Error Translator (reference)

```typescript
// apps/api/src/middleware/error-translator.ts
const PG_TO_API: Record<string, { status: number; code: ErrorCode }> = {
  '23505': { status: 409, code: 'DUPLICATE_RESOURCE' },
  '23503': { status: 400, code: 'INVALID_REFERENCE' },
  '23502': { status: 400, code: 'REQUIRED_FIELD_MISSING' },
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATION' },
  '40001': { status: 409, code: 'CONCURRENCY_CONFLICT' },
  '40P01': { status: 409, code: 'CONCURRENCY_CONFLICT' },
};
```

## Testing Strategy — Data Access Layer

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Drizzle inferred types match SQL DDL shape | Vitest: assert `typeof socio.numero` is `string`, not `unknown` |
| Unit | `NotFoundError` subclass created with correct name | Vitest: `new SocioNotFoundError(42)` → assert name + `instanceof NotFoundError` |
| Integration | `socioRepo.findById` returns row | Testcontainers: insert row, call findById, assert shape |
| Integration | `socioRepo.create` with duplicate `numero` throws 23505 | Testcontainers: insert once, insert again, assert Drizzle error has `code='23505'` |
| Integration | `pagosService.createPayment` rolls back on second insert failure | Testcontainers: force FK violation on `asiento` insert, assert `cuenta_corriente` has 0 rows |
| Integration | `obtener_siguiente_numero` race: two parallel calls return different numbers | Testcontainers: 2 concurrent `Promise.all` calls → assert both succeed, numbers differ |
| Integration | Serializable isolation prevents lost update on `cuenta_corriente` saldo | Testcontainers: 2 parallel reads-then-writes → assert final saldo is correct (no lost update) |
| Integration | Nested transaction: outer rolls back → inner savepoint also rolled back | Testcontainers: outer insert + inner insert, force outer failure, assert both rows absent |
| Integration | Cross-schema join in `reportingRepo` returns joined data | Testcontainers: insert socio + cuenta_corriente + asiento, call report query, assert joined shape |
| Integration | Error translator: 23505 → 409 + DUPLICATE_RESOURCE | Testcontainers + supertest: POST duplicate socio → assert response shape |
| Integration | `routeAuditPlugin` passes when DAL errors have SQLSTATE codes | Testcontainers: any DAL error → assert response carries mapped `error` code |
| E2E | Full payment flow: POST /pagos → ctacte + asiento + response | Playwright + Testcontainers: login, POST payment, assert 201 + GET cuenta_corriente shows movement |

## Migration / Rollback — Data Access Layer

**Migration**: Run `drizzle-kit generate` to produce the initial migration set from the 5 schema files. The migration creates the 5 PG schemas and all tables. This migration is the foundation of the `athlos-foundation` change — every other change that adds tables (auth, approval, RBAC) builds on top.

**Rollback**: Drop the 5 PG schemas (`DROP SCHEMA socios CASCADE;` etc.). The `packages/db` package can be removed from `apps/api` imports — handlers lose data access, but the API process can still boot. No data recovery path beyond `pg_dump` backup.

## Open Questions — Data Access Layer

- [ ] Should `packages/db` also export Drizzle relations (the `relations()` API) for the relational query API, or stay query-builder-only? (Affects repo ergonomics for within-schema joins.)
- [ ] Do we need a `db` proxy that adds `request_id` to every PG session for log correlation, or is `pg_stat_statements` + log line correlation sufficient?
- [ ] Should the `reportingRepo` use PostgreSQL views (materialized for high-volume reports) instead of runtime joins?
- [ ] For the `pgSchema` declarations — should each schema's tables live in a sub-folder (`schema/socios/{socio.ts, cuenta_corriente.ts, ...}`) for very large schemas, or stay flat per the spec's layout?

---

## Validation (Zod) Design

### Decision: Fastify Integration — Manual `preHandler` Hook with `safeParse`

**Choice**: Each route declares its body/query/params schemas in the route options under `schema:`. A single Fastify `preHandler` hook (`validationPreHandler`) inspects `request.routeOptions.schema`, runs `safeParse` for each present surface (`body`, `querystring`, `params`), and on failure throws `BusinessError('VALIDATION_ERROR', ...)` with the surface-prefixed field errors from `mapZodErrors()`. The hook is registered globally in `apps/api/src/server.ts` so every route gets it for free.

```typescript
// apps/api/src/middleware/validation.ts
import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BusinessError } from '@athlos/errors';
import { mapZodErrors } from '@athlos/errors/zod';

export const validationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('validated', null);

  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const schema = (request.routeOptions as { schema?: Record<string, z.ZodTypeAny> }).schema;
    if (!schema) return;

    const surfaces = [
      { key: 'body', value: request.body, prefix: 'body', message: 'Request body is invalid' },
      { key: 'querystring', value: request.query, prefix: 'query', message: 'Query parameters are invalid' },
      { key: 'params', value: request.params, prefix: 'params', message: 'Path parameters are invalid' },
    ] as const;

    for (const { key, value, prefix, message } of surfaces) {
      const surfaceSchema = schema[key];
      if (!surfaceSchema) continue;
      const result = surfaceSchema.safeParse(value);
      if (!result.success) {
        const details = mapZodErrors(result.error).map((e) => ({
          ...e,
          field: `${prefix}.${e.field}`.replace(/\.$/, ''),
        }));
        throw BusinessError('VALIDATION_ERROR', message, details);
      }
      if (key === 'body') request.body = result.data;
      if (key === 'querystring') Object.assign(request.query, result.data);
      if (key === 'params') Object.assign(request.params, result.data);
    }
  });
};
```

```typescript
// Route usage (consumers)
fastify.post('/api/v1/socios', {
  schema: {
    body: SocioCreateRequestSchema,
  },
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR')],
}, async (request, reply) => {
  const body = request.body as SocioCreateRequest; // already validated + typed
  ...
});
```

**Alternatives considered**: `@fastify/type-provider-zod` (auto-infers types into the Fastify generic — sounds attractive but couples our Zod version to a third-party wrapper, and its error shape is not aligned with our existing `BusinessError` + `mapZodErrors()` pipeline); per-route `try/catch` `safeParse` in each handler (boilerplate explosion — 40+ routes, easy to skip); Fastify's built-in JSON Schema validator (requires a parallel JSON Schema definition for every Zod schema, drift risk, no `z.infer`).

**Rationale**: The error-handling design already standardizes on `BusinessError` + `mapZodErrors()` + the global `setErrorHandler` in `apps/api/src/server.ts`. A manual preHandler hook reuses all of that — one canonical path from Zod failure to HTTP 400. The hook is 30 lines, has zero new dependencies, and gives us full control over the field-path prefixing (`body.email`, `query.limit`) the spec requires. The hook is registered ONCE in `server.ts`; route options only declare `schema:` — no per-route preHandler plumbing.

### Decision: Package Structure — `packages/validation/` with Per-Resource Files

**Choice**: New `packages/validation/` package mirroring the structure the spec dictates. Each resource file exports `*RequestSchema`, `*UpdateRequestSchema`, `*QuerySchema`, `*ParamsSchema` and their inferred types. Cross-resource reuse is through `primitives.ts` and `pagination.ts` only — no `common.ts` umbrella.

```
packages/validation/
├── package.json
├── src/
│   ├── primitives.ts        # Reusable Zod schemas (uuid, dni, money, ...)
│   ├── pagination.ts        # PaginationQuerySchema (cursor + limit)
│   ├── schemas/
│   │   ├── auth.ts          # LoginRequestSchema, RefreshRequestSchema, LogoutRequestSchema
│   │   ├── socio.ts         # SocioCreate/UpdateRequest, SocioIdParams, SocioListQuery
│   │   ├── operator.ts      # Create/UpdateOperatorRequest, OperatorIdParams
│   │   ├── approval.ts      # CreateApprovalLinkRequest, ApprovalDecisionRequest, ApprovalTokenParams
│   │   ├── import.ts        # ImportTriggerRequest, ImportStatusQuery, LineageQuery
│   │   ├── audit.ts         # AuditQuery
│   │   ├── account.ts       # CuentaCorrienteQuery
│   │   └── padron.ts        # PadronParams
│   └── index.ts             # Public exports
```

**Alternatives considered**: Put schemas inside `apps/api/src/schemas/` (couples validation to the API app — workers or other consumers cannot reuse), put schemas inside each service package (`packages/socios/src/schemas.ts`, etc.) (causes N import paths for one logical change, refactoring pain).

**Rationale**: A dedicated `packages/validation` package is the natural home — services and route handlers import from one place, the dependency graph stays acyclic (validation depends on errors, not the reverse), and new resources are added by creating one file. Per the spec, one file per resource keeps the surface area discoverable: a developer adding `POST /api/v1/cuotas` knows to look in `schemas/cuota.ts`.

### Decision: Type Exports — Direct Re-Export, No Build Step

**Choice**: Each resource file uses `export type X = z.infer<typeof XSchema>` and re-exports from `packages/validation/src/index.ts`. Consumers import both the schema and the type from the same module. No code generation, no `.d.ts.ts` dual files.

```typescript
// packages/validation/src/schemas/socio.ts
export const SocioCreateRequestSchema = z.object({
  numero_socio: positiveIntSchema,
  nombre: nonEmptyStringSchema.max(100),
  apellido: nonEmptyStringSchema.max(100),
  dni: dniSchema,
  email: emailSchema.optional(),
  telefono: z.string().max(30).optional(),
  direccion: z.string().max(200).default(''),
  categoria: z.string().max(50).optional(),
});

export type SocioCreateRequest = z.infer<typeof SocioCreateRequestSchema>;
```

```typescript
// packages/validation/src/index.ts
export * from './primitives.js';
export * from './pagination.js';
export * from './schemas/auth.js';
export * from './schemas/socio.js';
export * from './schemas/operator.js';
export * from './schemas/approval.js';
export * from './schemas/import.js';
export * from './schemas/audit.js';
export * from './schemas/account.js';
export * from './schemas/padron.js';
```

**Alternatives considered**: `tsc` build step to emit `.d.ts` (adds complexity, Zod types are already erased at compile time — there is nothing to emit), `zod-to-ts` codegen (extra tool, no benefit over direct `z.infer`), separating type-only and runtime-only export files (`types.ts` vs `schemas.ts`) (forces two imports per consumer).

**Rationale**: Zod schemas are runtime values; `z.infer<typeof X>` is a TypeScript type query — no build step, no codegen, no extra files. Direct re-exports through `index.ts` give consumers a single import path (`@athlos/validation`). A schema change automatically updates the inferred type because they are the same source.

### Decision: Primitives Module — Single Source for Reusable Schemas

**Choice**: `packages/validation/src/primitives.ts` exports all reusable schemas from the spec's table verbatim. Domain files import only what they need.

```typescript
// packages/validation/src/primitives.ts
import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().date();
export const isoDateTimeSchema = z.string().datetime();
export const emailSchema = z.string().email().max(254);
export const positiveIntSchema = z.number().int().positive();
export const moneySchema = z.number().nonnegative().multipleOf(0.01);
export const nonEmptyStringSchema = z.string().min(1);
export const dniSchema = z.string().regex(/^\d{7,8}$/, 'DNI must be 7-8 digits');
export const cuitSchema = z.string().regex(/^\d{11}$/, 'CUIT must be 11 digits');
export const paginationLimitSchema = z.coerce.number().int().min(1).max(200).default(50);
export const cursorSchema = z.string().min(1).optional();

export const roleSchema = z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA']);
export const socioEstadoSchema = z.enum(['activo', 'inactivo', 'suspendido']);
export const movimientoTipoSchema = z.enum(['cargo', 'pago']);
```

**Alternatives considered**: Per-domain primitive files (e.g., `socios-primitives.ts`, `tesoreria-primitives.ts`) (split by domain — harder to find, more files to import from), inlining primitives in each resource file (duplicates the regex, easy to drift).

**Rationale**: A single `primitives.ts` is the natural location — every resource file imports from one place, the regex for DNI is defined once, and the enum for roles lives next to the enum for socio estado. When the spec adds a new primitive (e.g., a new document type), it goes in this file.

### Decision: Pagination Module — Composable Query Schema

**Choice**: `packages/validation/src/pagination.ts` exports `PaginationQuerySchema` and `PaginationQuerySchemaBase` (the bare cursor+limit version). Resource files extend the base when they need filters.

```typescript
// packages/validation/src/pagination.ts
import { z } from 'zod';
import { cursorSchema, paginationLimitSchema } from './primitives.js';

export const PaginationQuerySchemaBase = z.object({
  cursor: cursorSchema,
  limit: paginationLimitSchema,
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchemaBase>;

// Resource extension (in schemas/socio.ts)
export const SocioListQuerySchema = PaginationQuerySchemaBase.extend({
  estado: socioEstadoSchema.optional(),
  categoria: z.string().max(50).optional(),
  search: z.string().min(3).max(100).optional(),
});

export type SocioListQuery = z.infer<typeof SocioListQuerySchema>;
```

**Alternatives considered**: Force every resource to re-declare cursor + limit (duplicates the `paginationLimitSchema` reference 8+ times), use `z.intersection` instead of `extend` (loses the type-level composition Zod provides with `extend`), put pagination inside primitives (couples paginated queries to atomic primitives — `extend` would still work but logically pagination is a query-shape concern, not a primitive).

**Rationale**: `extend` is the Zod-idiomatic way to add fields to an object schema — types compose naturally. A separate `pagination.ts` keeps `primitives.ts` focused on atomic types (UUID, regex, enum) and makes the pagination contract discoverable in one file.

### Decision: Surface Naming Convention — Suffix-Based, Per Spec

**Choice**: Schema names end with one of `RequestSchema` (body), `QuerySchema` (querystring), `ParamsSchema` (path params), `ResponseSchema` (response, opt-in). The validation preHandler hook reads `request.routeOptions.schema` and binds to the matching Fastify route options key (`body`, `querystring`, `params`).

| Surface | Fastify key | Schema suffix | Example |
|---------|------------|---------------|---------|
| Body | `body` | `RequestSchema` | `SocioCreateRequestSchema` |
| Query | `querystring` | `QuerySchema` | `SocioListQuerySchema` |
| Params | `params` | `ParamsSchema` | `SocioIdParamsSchema` |
| Response (opt-in) | `response[200]` | `ResponseSchema` | `SocioResponseSchema` |

**Alternatives considered**: One mega-schema per route that contains `body + query + params` as keys (loses the per-surface type, can't infer each separately), separate route-level files per surface (explodes the file count).

**Rationale**: Suffix-based naming matches the spec's table verbatim. The validation hook iterates over the surface keys, so the binding is mechanical — no convention to remember beyond the suffix. TypeScript can infer each surface type independently (`SocioCreateRequest` vs `SocioListQuery`) from the same file.

### Decision: Strict vs Strip — Per-Surface Convention

**Choice**: Create-body schemas use `.strict()` to reject unknown keys (catches client bugs early). Update-body schemas use the default `.strip()` (silently drops unknown keys — partial updates are inherently permissive). Path and query schemas use the default `.strip()` (Fastify normalizes anyway).

| Surface | Mode | Rationale |
|---------|------|-----------|
| `POST` body | `.strict()` | Extra fields are a client bug — fail loud |
| `PUT`/`PATCH` body | default (`.strip()`) | Partial updates tolerate extra fields |
| `GET` query | default (`.strip()`) | Query strings are noisy; clients add tracking params |
| Path params | default (`.strip()`) | Path params are positional — no "extra" concept |

```typescript
// packages/validation/src/schemas/socio.ts
export const SocioCreateRequestSchema = z.object({ ... }).strict();
export const SocioUpdateRequestSchema = z.object({ ... }).partial(); // .partial() implies .strip() semantics
```

**Alternatives considered**: Always `.strict()` (forces clients to be exact on updates — over-restrictive for partial updates), always default `.strip()` (lets typos like `isAdmin: true` through on create — security risk per spec scenario), `.passthrough()` everywhere (preserves unknown fields — risks data leakage into DB writes).

**Rationale**: The spec mandates `.strict()` for create-body schemas and `.strip()` for update-body schemas. Path and query schemas use `.strip()` because Fastify's `req.query` is already `Record<string, unknown>` shaped — adding `.strict()` would 400 on innocuous query additions. This is the conventional Fastify + Zod pattern.

### Decision: Response Validation — Opt-In via `response[200]` Schema, Dev/Test Only

**Choice**: Response schemas are defined alongside request schemas in the same resource file. The `validationPlugin` preHandler does NOT parse responses (per spec — response validation is opt-in, not default). A separate opt-in mechanism is provided for routes that need it: declare `response: { 200: SocioResponseSchema }` in route options, and a development-only `onSend` hook (`responseValidationPlugin`) parses the response body in dev/test environments only.

```typescript
// apps/api/src/middleware/response-validation.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

export const responseValidationPlugin: FastifyPluginAsync = async (fastify) => {
  if (process.env.NODE_ENV === 'production') return; // dev/test only per spec

  fastify.addHook('onSend', async (request, reply, payload) => {
    const response = (request.routeOptions as { response?: Record<number | string, z.ZodTypeAny> }).response;
    if (!response) return payload;

    const status = reply.statusCode;
    const schema = response[status] ?? response['default'];
    if (!schema) return payload;

    const parsed = JSON.parse(payload as string); // Fastify already stringified
    const result = schema.safeParse(parsed);
    if (!result.success) {
      fastify.warn({
        event: 'RESPONSE_SCHEMA_DRIFT',
        request_id: request.requestId,
        endpoint: request.url,
        issues: result.error.issues,
      });
      // In dev: throw to surface the bug
      if (process.env.NODE_ENV === 'development') {
        throw new Error(`Response schema drift: ${result.error.message}`);
      }
    }
    return payload;
  });
};
```

**Alternatives considered**: Always-on response validation (doubles parse cost per request, no benefit for stable internal contracts), per-route manual validation in handler (verbose, easy to skip), `@fastify/type-provider-zod` `response` schemas (same Zod-version coupling issue as the body integration).

**Rationale**: The spec is explicit — response validation is opt-in, primarily for documentation. Dev-only enforcement gives drift detection during development without production overhead. The `onSend` hook is the latest point Fastify allows intervention before bytes go on the wire — log-only in test mode, throw in dev mode. Production skips the hook entirely (`if NODE_ENV === 'production' return`).

### Decision: Error Messages — English in Defaults, Spanish Overrides Only Where Specified

**Choice**: Zod's default messages are English ("Required", "Invalid email", "String must contain at most 100 character(s)"). The spec mandates Spanish-flavored messages only for Argentine format validators (DNI, CUIT) and sensitive fields (password). All other messages stay in English.

```typescript
export const dniSchema = z.string().regex(/^\d{7,8}$/, 'DNI must be 7-8 digits');
export const cuitSchema = z.string().regex(/^\d{11}$/, 'CUIT must be 11 digits');
export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters');
```

**Alternatives considered**: Spanish for ALL messages (couples error strings to one locale, breaks non-Spanish clients), full i18n with a Zod error map per locale (over-engineered for v1 — Athlos is a single-tenant club system, all operators speak Spanish), English-only for everything (loses the spec's "DNI must be 7-8 digits" specificity).

**Rationale**: Spanish is the working language of the club — operators consume the API errors in Spanish. The spec explicitly calls out Spanish-flavored messages for DNI, CUIT, and password. All other fields use Zod's English defaults for two reasons: (1) `mapZodErrors` is locale-agnostic — the message comes straight from Zod; (2) the field path (`body.email`) is the primary client-side signal, the message is secondary. A future i18n pass can swap the Zod error map without touching route code.

### Decision: Validation Timing — API Edge in `preHandler`, Never in Services

**Choice**: All validation runs in the global `preHandler` hook, BEFORE any service or repository call. Services consume already-validated, typed inputs — they do NOT re-parse. The data-access-layer design's rule ("repositories MUST NOT re-validate") is enforced by type system (Drizzle's `InferInsertModel`) at the boundary.

```typescript
// Route (apps/api/src/routes/socios.ts)
fastify.post('/api/v1/socios', {
  schema: { body: SocioCreateRequestSchema },
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR')],
}, async (request, reply) => {
  // request.body is SocioCreateRequest — already validated
  const socio = await sociosService.create(request.body);
  return reply.status(201).send(socio);
});

// Service (packages/services/src/socios.ts)
async function create(input: SocioCreateRequest): Promise<Socio> {
  // No validation here — type system guarantees shape
  return socioRepo.insert(input); // Drizzle InferInsertModel enforces at compile time
}
```

**Alternatives considered**: Validate in services (defeats the spec — services are the boundary, not the gate; also requires every service to know about validation), validate in repositories (same issue + repositories become un-reusable), validate in middleware AND services (double-parse, no benefit).

**Rationale**: The validation-zod spec is explicit: "Validation MUST happen in a Fastify preHandler hook or route-level schema — before the route handler executes. The system MUST NOT defer validation to services, repositories, or DALs." The hook runs ONCE per request, results are typed, services are blind to validation concerns. The type system (Drizzle `InferInsertModel`) is the downstream backstop — if validation is somehow bypassed, the compiler refuses the call.

### Decision: Surface-Prefixed Field Paths — Prefix Added in `validationPlugin`

**Choice**: `mapZodErrors` (in `packages/errors/src/zod.ts`) returns `field: issue.path.join('.')` (e.g., `email`). The `validationPlugin` preHandler wraps the call to add the surface prefix: `${prefix}.${e.field}` (e.g., `body.email`). The mapper itself stays surface-agnostic so it can be reused for non-HTTP contexts (config validation, import file validation).

```typescript
// mapZodErrors (unchanged from error-handling design)
export function mapZodErrors(zodError: ZodError): FieldError[] {
  return zodError.issues.map((issue: ZodIssue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

// In validationPlugin (prefix applied here)
const details = mapZodErrors(result.error).map((e) => ({
  ...e,
  field: `${prefix}.${e.field}`.replace(/\.$/, ''), // strip trailing dot if path is empty
}));
```

**Alternatives considered**: `mapZodErrors` knows about surfaces (couples the error package to Fastify — wrong layer), each surface has its own mapper (3x duplication, easy to drift), rely on the client to infer the surface from context (brittle — clients must parse the error message).

**Rationale**: Prefixing at the boundary (the validation hook) keeps `mapZodErrors` reusable for config validation (`packages/config/src/env.ts`) and import file validation (`packages/import/src/parser.ts`). The hook is the ONLY place that knows which surface it's validating. The regex `.replace(/\.$/, '')` handles the edge case where `issue.path` is empty (cross-field refinements).

### Decision: Custom Messages on Sensitive Fields — Never Echo Values

**Choice**: Sensitive fields (password, refresh_token, api_key) declare a custom error message that describes the constraint without including the value. Zod's `.min(12, 'Password must be at least 12 characters')` pattern is enforced via a code-review checklist and a test that scans schemas for the pattern.

```typescript
export const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

export const apiKeySchema = z.string()
  .min(32, 'API key must be at least 32 characters')
  .max(128, 'API key must be at most 128 characters');
```

**Alternatives considered**: Custom Zod error map globally (covers all string min/max errors — but loses the ability to customize per-field), rely on pino's `redact` paths (only handles logging — error responses still echo the value), accept the risk (spec explicitly forbids it).

**Rationale**: The spec scenario "Password validation" is explicit: the message MUST NOT contain the literal value `"abc"`. Zod's default messages do not include the value (`"String must contain at least 12 character(s)"`) — but a developer writing a custom `.refine()` might accidentally include `value` in the message. The code-review checklist + a test scanning for `path.join` patterns in `messages` prevents regressions.

## Data Flow — Validation (Zod)

```
Request ──► onRequest hook ──► requestId set
                                       │
                                       ▼
                       validationPlugin preHandler
                                       │
                       ┌───────────────┼───────────────┐
                       │               │               │
                   body.safeParse  query.safeParse  params.safeParse
                       │               │               │
                  ┌────┴────┐     ┌────┴────┐     ┌────┴────┐
                  │success  │     │success  │     │success  │
                  │assign   │     │assign   │     │assign   │
                  │data     │     │data     │     │data     │
                  └────┬────┘     └────┬────┘     └────┬────┘
                       │               │               │
                       └───────────────┼───────────────┘
                                       ▼
                              Route Handler
                              (typed body/query/params)
                                       │
                                       ▼
                              Service (trusts input)
                                       │
                                       ▼
                              Repository (Drizzle type-check)
                                       │
                                       ▼ (failure path: Zod parse)
                              BusinessError('VALIDATION_ERROR',
                                message, mapZodErrors(...) + prefix)
                                       │
                                       ▼
                              setErrorHandler
                                       │
                                       ├──► fastify.warn({request_id,
                                       │       endpoint, error_code,
                                       │       field_errors})
                                       │
                                       └──► reply.status(400).send({
                                              error: 'VALIDATION_ERROR',
                                              message: 'Request body is invalid',
                                              details: [
                                                { field: 'body.email',
                                                  message: 'Invalid email',
                                                  code: 'invalid_string' }
                                              ],
                                              request_id: 'req_<uuid>'
                                            })
```

## File Changes — Validation (Zod) Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/validation/package.json` | Create | Package manifest with `zod` + `@athlos/errors` deps |
| `packages/validation/src/primitives.ts` | Create | All reusable Zod schemas from spec table |
| `packages/validation/src/pagination.ts` | Create | `PaginationQuerySchema` + `PaginationQuerySchemaBase` |
| `packages/validation/src/schemas/auth.ts` | Create | Login/Refresh/Logout request schemas |
| `packages/validation/src/schemas/socio.ts` | Create | SocioCreate/Update request, IdParams, ListQuery, Response |
| `packages/validation/src/schemas/operator.ts` | Create | Create/Update operator request, IdParams |
| `packages/validation/src/schemas/approval.ts` | Create | CreateApprovalLink, ApprovalDecision, TokenParams |
| `packages/validation/src/schemas/import.ts` | Create | ImportTrigger request, StatusQuery, LineageQuery |
| `packages/validation/src/schemas/audit.ts` | Create | AuditQuery with entity_type, from, to, action |
| `packages/validation/src/schemas/account.ts` | Create | CuentaCorrienteQuery with from, to, tipo |
| `packages/validation/src/schemas/padron.ts` | Create | PadronParams |
| `packages/validation/src/index.ts` | Create | Public barrel exports |
| `apps/api/src/middleware/validation.ts` | Create | `validationPlugin` — global preHandler for safeParse + prefix |
| `apps/api/src/middleware/response-validation.ts` | Create | `responseValidationPlugin` — opt-in dev/test onSend hook |
| `apps/api/src/server.ts` | Modify | Register `validationPlugin` + `responseValidationPlugin` |
| `apps/api/src/routes/auth.ts` | Modify | Add `schema:` blocks referencing auth schemas |
| `apps/api/src/routes/socios.ts` | Modify | Add `schema:` blocks referencing socio schemas |
| `apps/api/src/routes/operators.ts` | Modify | Add `schema:` blocks referencing operator schemas |
| `apps/api/src/routes/approval.ts` | Modify | Add `schema:` blocks referencing approval schemas |
| `apps/api/src/routes/import.ts` | Modify | Add `schema:` blocks referencing import schemas |
| `apps/api/src/routes/audit.ts` | Modify | Add `schema:` blocks referencing audit schemas |
| `apps/api/src/routes/cuenta-corriente.ts` | Modify | Add `schema:` blocks referencing account schemas |

## Interfaces / Contracts — Validation (Zod)

### Primitives (reference)

```typescript
// packages/validation/src/primitives.ts
export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().date();
export const isoDateTimeSchema = z.string().datetime();
export const emailSchema = z.string().email().max(254);
export const positiveIntSchema = z.number().int().positive();
export const moneySchema = z.number().nonnegative().multipleOf(0.01);
export const nonEmptyStringSchema = z.string().min(1);
export const dniSchema = z.string().regex(/^\d{7,8}$/, 'DNI must be 7-8 digits');
export const cuitSchema = z.string().regex(/^\d{11}$/, 'CUIT must be 11 digits');
export const paginationLimitSchema = z.coerce.number().int().min(1).max(200).default(50);
export const cursorSchema = z.string().min(1).optional();
export const roleSchema = z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA']);
export const socioEstadoSchema = z.enum(['activo', 'inactivo', 'suspendido']);
export const movimientoTipoSchema = z.enum(['cargo', 'pago']);
```

### Validation PreHandler (reference)

```typescript
// apps/api/src/middleware/validation.ts
export const validationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request) => {
    const schema = (request.routeOptions as any).schema;
    if (!schema) return;
    // ... safeParse loop from decision block above
  });
};
```

### Route Declaration (reference)

```typescript
// apps/api/src/routes/socios.ts
import { SocioCreateRequestSchema, SocioIdParamsSchema, SocioListQuerySchema } from '@athlos/validation';

fastify.post('/api/v1/socios', {
  schema: { body: SocioCreateRequestSchema },
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR')],
}, async (request, reply) => {
  const body = request.body as z.infer<typeof SocioCreateRequestSchema>;
  // ...
});

fastify.get('/api/v1/socios', {
  schema: { querystring: SocioListQuerySchema },
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA')],
}, async (request, reply) => {
  const query = request.query as z.infer<typeof SocioListQuerySchema>;
  // ...
});

fastify.get('/api/v1/socios/:id', {
  schema: { params: SocioIdParamsSchema },
  preHandler: [requireRole('ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA')],
}, async (request, reply) => {
  const { id } = request.params as z.infer<typeof SocioIdParamsSchema>;
  // ...
});
```

## Testing Strategy — Validation (Zod)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `dniSchema` rejects non-digits | Vitest: `safeParse('12A45')` → assert success=false |
| Unit | `dniSchema` accepts valid 7-8 digit DNI | Vitest: `safeParse('12345678')` → assert success=true |
| Unit | `moneySchema` rejects negative amounts | Vitest: `safeParse(-100)` → assert success=false, code=too_small |
| Unit | `moneySchema` rejects 3-decimal amounts | Vitest: `safeParse(1.234)` → assert success=false, code=invalid |
| Unit | `paginationLimitSchema` coerces string to number | Vitest: `safeParse('50')` → assert success=true, data.limit=50 |
| Unit | `paginationLimitSchema` applies default | Vitest: `safeParse({})` → assert data.limit=50 |
| Unit | `paginationLimitSchema` rejects >200 | Vitest: `safeParse({limit: 10000})` → assert success=false |
| Unit | `SocioCreateRequestSchema.strict()` rejects unknown keys | Vitest: parse `{nombre:'Juan', isAdmin:true}` → assert success=false, code=unrecognized_keys |
| Unit | `SocioUpdateRequestSchema.partial()` allows single field | Vitest: parse `{telefono:'+54911...'}` → assert success=true |
| Unit | `roleSchema` rejects unknown role | Vitest: parse `'SUPERADMIN'` → assert success=false, code=invalid_enum_value |
| Unit | `mapZodErrors` joins path with `.` | Vitest: `ZodError(path=['email'])` → field='email' |
| Unit | Sensitive field messages do not contain value | Vitest: parse `{password:'abc'}` → assert message does not include 'abc' |
| Integration | POST with invalid body returns 400 + VALIDATION_ERROR + details | Testcontainers: POST `/api/v1/socios` with `email:'bad'` → assert 400 + details[0].field='body.email' |
| Integration | POST with multiple invalid fields returns ALL errors | Testcontainers: POST with `numero_socio:-1, email:'bad', dni:'12'` → assert details.length===3 |
| Integration | GET with invalid limit returns 400 | Testcontainers: GET `/api/v1/socios?limit=10000` → assert 400 + details[0].field='query.limit' |
| Integration | Path param validation rejects non-UUID | Testcontainers: GET `/api/v1/socios/not-a-uuid` → assert 400 + details[0].field='params.id' |
| Integration | Validation runs BEFORE auth/RBAC | Testcontainers: POST with invalid body + no JWT → assert 400 (not 401) |
| Integration | Strict body schema rejects extra field with isAdmin | Testcontainers: POST `{nombre:'Juan', isAdmin:true}` → assert 400 + code=unrecognized_keys |
| Integration | Response validation logs drift in dev mode | Testcontainers: register response schema, return wrong shape → assert WARN log |
| Integration | Response validation skipped in production | Testcontainers: NODE_ENV=production, return wrong shape → assert no log, no throw |
| E2E | Full create-socio flow: valid body → 201 | Playwright: login, POST valid socio → assert 201, GET → assert present |

## Migration / Rollback — Validation (Zod)

**Migration**: New `packages/validation/` package, two Fastify plugins (`validationPlugin`, `responseValidationPlugin`). No database migration required. Routes add `schema:` blocks incrementally — each route file is updated as the corresponding resource is implemented.

**Rollback**: Remove the two plugins from `apps/api/src/server.ts` registration. Remove `schema:` blocks from route options. Routes fall back to Fastify's default behavior (no validation — `request.body` is `unknown`). No data loss, no breaking change to error contract (routes that throw `BusinessError` for body shape still work, they just receive raw body). To fully remove: delete `packages/validation` and uninstall `@athlos/validation` imports from all route files.

## Open Questions — Validation (Zod)

- [ ] Should `paginationLimitSchema` allow `0` (no results, just metadata) or always require at least 1? Currently min(1) — confirm with product.
- [ ] Should the validation plugin also validate response `400` and `500` shapes (catch handler throws), or only `2xx`? Currently only `2xx` declared in route options.
- [ ] For cross-field refinements (e.g., `from <= to` in audit query), should the field path be `query` (entire query) or `query.to` (the field that "violates" the rule)?
- [ ] Should `ZodEffects` (schemas with `.refine()`) be wrapped in a helper to add a `code` for the refinement failure, or rely on Zod's default `custom` code?
- [ ] For the `search` parameter, should the minimum length be 2 (per spec example) or 3 (per the recommended table)? Spec is inconsistent — pick one.

---

## Testing Setup Design

### Decision: Shared Vitest Preset — `packages/vitest-config` with `defineConfig` Factory

**Choice**: A `packages/vitest-config` package exports a `defineConfig(preset)` factory that returns a Vitest `UserConfig`. Two presets ship out of the box: `node` (for backend packages — `environment: 'node'`, no jsdom) and `dom` (for frontend — `environment: 'jsdom'`). Each package's `vitest.config.ts` does:
```ts
import { defineConfig } from '@athlos/vitest-config';
export default defineConfig({ preset: 'node', coverage: { /* overrides */ } });
```

**Alternatives considered**: Single `vitest.workspace.ts` at repo root with inline configs per project (duplicates coverage thresholds, exclusions, and aliases in every workspace file), Vitest's `vite.config.ts` inheritance (works, but no compile-time check that the preset is correctly applied; the factory approach gives typed returns).

**Rationale**: Centralizing coverage thresholds, exclusions, reporters, and aliases in one preset package prevents drift across 10+ packages. The `preset: 'node' | 'dom'` discriminator is a single line at the call site — explicit and self-documenting. Per-package `vitest.config.ts` becomes 5 lines, not 50.

### Decision: Adapter Interface Pattern — Constructor Injection with Real/Stub Pair Per Integration

**Choice**: Every external integration in `packages/integrations/<name>/` exports:
- `interface XxxAdapter` — the contract
- `RealXxxAdapter` — production implementation
- `StubXxxAdapter` — test implementation, exposed for assertions
- `xxxAdapter(env)` factory — returns Real or Stub based on `NODE_ENV`

Services receive the adapter via constructor:
```ts
class PagoService {
  constructor(private whatsapp: WhatsAppAdapter, private email: EmailAdapter) {}
}
```

DI is hand-rolled in `apps/api/src/container.ts` (a simple `Map<string, unknown>` keyed by symbol), not a framework like `tsyringe` or `inversify`.

**Alternatives considered**: InversifyJS / tsyringe (overkill for ~20 adapters and 4 packages), function-level DI via module-level singletons (test isolation nightmare — no way to swap per test), dependency injection via Fastify decorators (couples adapter lifecycle to HTTP request — wrong granularity for jobs/workers).

**Rationale**: Constructor injection is the standard GoF pattern. Hand-rolled DI keeps the dependency graph visible in one file (`container.ts`) without learning curve. The Real/Stub pair convention makes the test boundary self-documenting — grep for `Stub` finds all test seams. The `xxxAdapter(env)` factory is the single switch point between prod and test wiring.

### Decision: Test Data Builders — `@athlos/test-builders` with Fluent Override API

**Choice**: A dedicated `packages/test-builders/` package exporting one builder per domain entity: `aSocio()`, `aPago()`, `aMovimiento()`, `aOperador()`. Each builder returns an object with chained `.withX(value)` setters and a terminal `.build()` that returns a typed entity. Defaults come from a single `defaults.ts` per entity so builders stay in sync with schema changes (one place to update when a column is added).

```ts
const socio = aSocio()
  .withId(42)
  .withSaldo(1500)
  .withCategoria('ACTIVO')
  .build();
```

**Alternatives considered**: Factory functions (`createSocio(overrides)`) — works but loses IDE autocompletion on available fields; Object Mother pattern (`anActiveSocio()`) — multiplies for state combinations; raw SQL in tests (forbidden by spec); Faker.js with `.build()` chains (random-by-default makes assertions harder, requires `.override()` everywhere).

**Rationale**: Fluent API gives IDE autocomplete on every field via TypeScript inference. Defaults are deterministic — tests are reproducible. One builder per entity scales linearly with entities, not with combinations. A new schema column = one default update, not 10 test rewrites.

### Decision: Testcontainers — Shared Container Per Test File via Global Setup

**Choice**: Vitest global `setup` file (`vitest.global-setup.ts` at repo root) starts a `postgres:16-alpine` Testcontainer using `@testcontainers/postgresql`. The container's `DATABASE_URL` is set on `process.env` BEFORE Vitest loads the workspace. Each test FILE gets the same container (shared across tests in the file); each test inside the file gets a clean schema via `TRUNCATE ... RESTART IDENTITY CASCADE` in `beforeEach`.

Per-file isolation is achieved via `singleFork: true` + per-test transactions OR per-test truncate. We choose **truncate** (spec requirement: no shared connections for cleanup) and tolerate the ~50ms cleanup cost per test.

```ts
// vitest.global-setup.ts
export default async function () {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations(process.env.DATABASE_URL);
  return async () => { await container.stop(); };
}
```

**Alternatives considered**: Per-test container (too slow — 3-5s startup per test × 200 tests = 10+ minutes), per-suite container started in `beforeAll` (works, but no global setup means every test file repeats container boot — 2s × 20 files = 40s overhead), Vitest `pool: 'threads'` with shared container (race conditions on container state).

**Rationale**: Global setup runs ONCE per `vitest` invocation, not per file. Container is reused across all files in the run. Truncate between tests is cheap and matches the spec's explicit "MUST NOT use shared connections for cleanup" requirement. The 5-minute total run budget is achievable because container boot happens once.

### Decision: Coverage Configuration — `@vitest/coverage-v8` with Per-Package and Critical-File Thresholds

**Choice**: Coverage via `@vitest/coverage-v8` (not Istanbul). The shared preset declares:
- **Per-package floor**: 80% lines / 75% branches (enforced)
- **Per-file floor**: 70% lines (enforced)
- **Critical files** (in `coverage.critical.json`): 90% lines (enforced)
- **Exclusions**: `**/*.gen.ts`, `**/migrations/**`, `**/*.test.ts`, `**/*.config.ts`, `vitest.setup.ts`

`coverage.critical.json` lives at repo root:
```json
{
  "files": [
    "packages/auth/src/login.ts",
    "packages/payments/src/create.ts",
    "packages/lineage/src/resolve.ts",
    "packages/drift/src/compare.ts"
  ]
}
```

CI script cross-references coverage output against the manifest and fails the build on a critical file below 90%.

**Alternatives considered**: Istanbul (`nyc`) — slower, requires Babel instrumenter; single global threshold (loses critical-file enforcement); coverage-as-PR-comment only (no fail-fast — needs the report AND a gate).

**Rationale**: V8 is built into Vitest and uses native Node V8 inspector — no transpilation overhead. The two-tier threshold (per-package + per-file + critical override) is what the spec demands. The critical manifest is a single JSON file that's PR-reviewable when a new critical file is added.

### Decision: CI Workflow — `.github/workflows/ci.yml` with Five Sequential Jobs

**Choice**: Single workflow with jobs `lint` → `typecheck` → `test` → `build` → `e2e`, each with `needs:` chaining so failures short-circuit. `test` and `e2e` use a `ubuntu-latest` runner with Docker support (Testcontainers needs it). The `test` job caches `~/.cache/testcontainers/` between runs.

```yaml
jobs:
  lint:    { runs-on: ubuntu-latest, steps: [checkout, setup-node, install, run-lint] }
  typecheck: { needs: lint, steps: [run-tsc-noEmit] }
  test:    { needs: typecheck, services: [docker], steps: [run-vitest-coverage, upload-coverage, comment-coverage] }
  build:   { needs: test, steps: [pnpm-build] }
  e2e:     { needs: build, services: [docker], steps: [playwright-install, run-playwright, upload-traces] }
```

**Alternatives considered**: Matrix strategy per package (slow fan-out — 20+ parallel jobs, hits GitHub concurrency limits), single mega-job with `&&` chains (one failure aborts the rest — loses per-stage artifacts), separate `deploy.yml` workflow (build + deploy split — out of scope for testing-setup).

**Rationale**: Sequential `needs:` is fail-fast by design — typecheck failure skips test (saves 3 minutes). Each job's artifacts (coverage, Playwright traces) are independently downloadable. Docker service on test/e2e is required by Testcontainers' default Docker socket usage.

### Decision: E2E Test Organization — `apps/<app>/e2e/` with Per-Flow Spec Files

**Choice**: Playwright specs live in `apps/web/e2e/` and (future) `apps/admin/e2e/`. Each spec file maps to one user flow from the spec's required-flows table:

| Spec file | Flow |
|-----------|------|
| `auth/login.spec.ts` | Login → dashboard |
| `admin/operator-onboarding.spec.ts` | Create operator → temp password → first login |
| `socios/detail.spec.ts` | Search → detail → cuenta corriente |
| `drift/alert-drilldown.spec.ts` | Drill into drift alert |
| `responsive/mobile.spec.ts` | Mobile viewport degraded UI |

Shared fixtures (login helper, DB seeder) live in `apps/web/e2e/fixtures/`. The `playwright.config.ts` at app root configures `webServer: { command: 'pnpm --filter @athlos/web dev', port: 5173 }` so Playwright auto-starts the dev server.

**Alternatives considered**: Top-level `e2e/` directory (breaks per-app isolation; admin and web have different setup), co-located with components (`src/foo/foo.spec.ts`) — mixes unit and E2E tooling, slow Playwright runs pollute IDE test runner.

**Rationale**: Co-locating with the app keeps E2E config + fixtures + app code in the same package boundary. The spec already enumerates the five required flows — one spec file per flow is 1:1 mapping. `webServer: { command: ... }` is Playwright's official auto-start pattern — no external orchestration.

### Decision: Test Data Builders Location — `packages/test-builders/` with One File Per Entity

**Choice**: `packages/test-builders/src/<entity>.ts` per entity, plus `src/defaults.ts` and `src/index.ts`. The package depends on `@athlos/db` for type imports but is NOT a test-only file (it's published as a normal package and consumed by `devDependencies` of consuming packages).

```
packages/test-builders/
├── package.json
├── src/
│   ├── index.ts          # public exports
│   ├── defaults.ts       # all entity defaults in one place
│   ├── socio.ts          # aSocio() builder
│   ├── pago.ts           # aPago() builder
│   ├── movimiento.ts
│   └── operador.ts
```

**Alternatives considered**: `__builders__` folder per package (duplication when 5 packages need `aSocio`), `test-utils` package (generic name, mixes builders with matchers/helpers), builders as `*.builder.ts` next to source files (pollutes source tree).

**Rationale**: One package = one source of truth. All packages import the same `aSocio()` and get the same defaults — a schema change updates one defaults file, every package's tests see the new field. Living in `packages/` (not `test/`) means it's regular TypeScript, typed against `@athlos/db`, and gets compiled with the rest of the monorepo.

### Decision: Coverage Delta Comment — `vitest-coverage-report-action` GitHub Bot

**Choice**: Use `danyalasoraya/vitest-coverage-report-action@v2` (or `vitest-coverage-report-action` from the community) in the `test` job, configured to comment on PRs with a markdown table showing per-file line/branch deltas vs the base branch. Critical files in the manifest that drop below 90% are highlighted in red.

The action is added as a final step in the `test` job:
```yaml
- name: Coverage Report
  if: github.event_name == 'pull_request'
  uses: danyalasoraya/vitest-coverage-report-action@v2
  with:
    json-summary-path: ./coverage/coverage-summary.json
    threshold: 80
```

**Alternatives considered**: Custom action writing a comment via `gh api` (maintenance burden, re-inventing the wheel), Codecov (external service — costs money, adds account dependency), Coveralls (same as Codecov), no comment (loses per-PR visibility that the spec demands).

**Rationale**: The community action is the standard tool for Vitest → PR comment. It reads V8 JSON output directly (no intermediate format), supports thresholds, and renders as a GitHub-native markdown table. Self-hosted, no external service.

### Decision: Pre-Commit Hooks — Husky + lint-staged (No Test Execution)

**Choice**: Husky pre-commit hook runs `pnpm lint-staged`, which runs ESLint --fix and Prettier on staged files ONLY. Tests are NOT in the pre-commit hook — they run in CI. The hook also runs `pnpm typecheck` for the staged package only (via `tsc --noEmit` scoped with `--filter`).

```json
// .lintstagedrc.json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

**Alternatives considered**: Pre-commit runs `pnpm test` (blocks commits for 2+ minutes when tests are slow — devs bypass with `git commit --no-verify`), pre-push runs tests (better but blocks push, not commit; devs still bypass), no hooks at all (loses the fast lint/format safety net).

**Rationale**: Lint-staged is fast (<2s for typical staged change) and catches 90% of "oops" issues before commit. Tests are slow and flaky-prone at the local level — let CI be the gate. Hook is bypassable (`--no-verify`) for emergencies; the spec doesn't forbid this, and avoiding dev frustration is worth it.

## Data Flow — Test Execution

```
Developer (local)                          CI
    │                                       │
    ├── pnpm test ──► vitest global setup ──┤
    │                    │                  │
    │                    ├── start Testcontainer (postgres:16)
    │                    ├── run migrations
    │                    ├── set DATABASE_URL
    │                    │
    │                    ▼
    │              vitest worker 1 ──► file 1 ──► beforeAll: container ready
    │              vitest worker 2 ──► file 2 ──► beforeEach: TRUNCATE
    │              vitest worker 3 ──► file 3     │
    │                    │                        ├── test: aSocio().build() → repo
    │                    │                        ├── assert query result
    │                    │                        │
    │                    ▼                        ▼
    │              coverage report (V8)    TRUNCATE again
    │                    │                        │
    │                    ▼                        ▼
    │              per-package thresholds    afterAll: container shared
    │              critical-file thresholds  (stops at end of run)
    │                    │
    │                    ▼
    │              coverage-summary.json ──► PR comment
```

## Data Flow — External Adapter Mocking

```
Test (unit)                              Test (integration)
    │                                         │
    ├── new PagoService(                      ├── new PagoService(
    │     new StubWhatsAppAdapter(),          │     new StubWhatsAppAdapter(),
    │     new StubEmailAdapter(),             │     new RealLegacyDbfAdapter('/fixtures'),
    │   )                                     │     new DrizzleRepository(db),
    │                                         │   )
    ├── service.createPago(input)             │
    │                                         ├── TRUNCATE payments;
    ├── assert __whatsappStub.messages[0]     ├── seed fixture via aPago().build()
    │   .body contains approval URL           ├── service.createPago(input)
    │                                         ├── assert __whatsappStub.messages[0]
    │                                         ├── assert db query: 1 row in payments
    │                                         ├── assert no DB deadlock (clean state)
```

## File Changes — Testing Setup Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/vitest-config/package.json` | Create | Package manifest, depends on `vitest`, `@vitest/coverage-v8` |
| `packages/vitest-config/src/index.ts` | Create | `defineConfig({preset, coverage})` factory |
| `packages/vitest-config/src/presets/node.ts` | Create | Node preset: environment, reporters, aliases |
| `packages/vitest-config/src/presets/dom.ts` | Create | DOM preset: jsdom, React Testing Library aliases |
| `vitest.workspace.ts` | Create | Root workspace aggregating all `vitest.config.ts` files |
| `vitest.global-setup.ts` | Create | Testcontainer Postgres 16 boot, env setup |
| `vitest.setup.ts` | Create | TZ=UTC, fake-timers helper, env-var loader |
| `coverage.critical.json` | Create | Manifest of critical files requiring 90% |
| `packages/test-builders/package.json` | Create | Package manifest, depends on `@athlos/db` |
| `packages/test-builders/src/defaults.ts` | Create | All entity defaults in one file |
| `packages/test-builders/src/socio.ts` | Create | `aSocio()` fluent builder |
| `packages/test-builders/src/pago.ts` | Create | `aPago()` fluent builder |
| `packages/test-builders/src/movimiento.ts` | Create | `aMovimiento()` fluent builder |
| `packages/test-builders/src/operador.ts` | Create | `aOperador()` fluent builder |
| `packages/test-builders/src/index.ts` | Create | Public exports |
| `packages/integrations/whatsapp/src/adapter.ts` | Create | `WhatsAppAdapter` interface + `Real/Stub` |
| `packages/integrations/whatsapp/src/stub.ts` | Create | `StubWhatsAppAdapter` with `__whatsappStub.messages` |
| `packages/integrations/whatsapp/src/real.ts` | Create | `RealWhatsAppAdapter` (WhatsApp Business API client) |
| `packages/integrations/whatsapp/src/factory.ts` | Create | `whatsappAdapter(env)` factory |
| `packages/integrations/email/src/{adapter,real,stub,factory}.ts` | Create | Same pattern for email |
| `packages/integrations/legacy-dbf/src/{adapter,real,stub,factory}.ts` | Create | DBF adapter with stub playing fixture files |
| `packages/integrations/clock/src/clock.ts` | Create | `clock.now()` helper + `FakeClock` for tests |
| `fixtures/legacy/CTACTE.dbf` | Create | Pre-recorded DBF fixture (small sample) |
| `fixtures/legacy/SOCIOS.dbf` | Create | Pre-recorded DBF fixture (small sample) |
| `apps/api/src/container.ts` | Create | Hand-rolled DI container wiring Real adapters in prod |
| `apps/web/playwright.config.ts` | Create | Playwright config: webServer, projects, artifacts |
| `apps/web/e2e/auth/login.spec.ts` | Create | Login → dashboard E2E |
| `apps/web/e2e/admin/operator-onboarding.spec.ts` | Create | Operator creation + temp password flow |
| `apps/web/e2e/socios/detail.spec.ts` | Create | Search → detail → cuenta corriente |
| `apps/web/e2e/drift/alert-drilldown.spec.ts` | Create | Drift alert drilldown |
| `apps/web/e2e/responsive/mobile.spec.ts` | Create | Mobile viewport degraded UI |
| `apps/web/e2e/fixtures/login.ts` | Create | Shared `loginAs(role)` helper |
| `.github/workflows/ci.yml` | Create | lint → typecheck → test → build → e2e |
| `.lintstagedrc.json` | Create | ESLint + Prettier on staged files |
| `.husky/pre-commit` | Create | `pnpm lint-staged` hook |
| `package.json` | Modify | Add `test`, `test:e2e`, `test:e2e:ci` scripts |
| `packages/*/vitest.config.ts` | Create | Per-package config extending `@athlos/vitest-config` |

## Interfaces / Contracts — Testing Setup

### Vitest Preset Factory

```ts
// packages/vitest-config/src/index.ts
import { defineConfig as defineVitestConfig } from 'vitest/config';

type Preset = 'node' | 'dom';

interface PresetOptions {
  preset: Preset;
  coverage?: Partial<CoverageConfig>;
}

export function defineConfig(opts: PresetOptions) {
  return defineVitestConfig({
    test: {
      environment: opts.preset === 'dom' ? 'jsdom' : 'node',
      globals: false,
      setupFiles: ['./vitest.setup.ts'],
      globalSetup: ['./vitest.global-setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        thresholds: { lines: 80, branches: 75, perFile: 70 },
        exclude: [
          '**/*.gen.ts',
          '**/migrations/**',
          '**/*.test.ts',
          '**/*.config.ts',
          'vitest.setup.ts',
        ],
        ...opts.coverage,
      },
    },
  });
}
```

### Test Data Builder Pattern

```ts
// packages/test-builders/src/socio.ts
import { defaults } from './defaults.js';
import type { SocioInsert } from '@athlos/db/schema/socios';

export class SocioBuilder {
  private data: SocioInsert = { ...defaults.socio };
  withId(id: number) { this.data.id = id; return this; }
  withSaldo(saldo: number) { this.data.saldo = saldo; return this; }
  withCategoria(c: SocioInsert['categoria']) { this.data.categoria = c; return this; }
  build(): SocioInsert { return { ...this.data }; }
}

export const aSocio = () => new SocioBuilder();
```

### Adapter Interface Pattern

```ts
// packages/integrations/whatsapp/src/adapter.ts
export interface WhatsAppAdapter {
  send(to: string, body: string): Promise<{ messageId: string }>;
}

// packages/integrations/whatsapp/src/stub.ts
export class StubWhatsAppAdapter implements WhatsAppAdapter {
  public readonly __whatsappStub = { messages: [] as Array<{ to: string; body: string; sentAt: Date }> };
  async send(to: string, body: string) {
    this.__whatsappStub.messages.push({ to, body, sentAt: new Date() });
    return { messageId: `stub-${this.__whatsappStub.messages.length}` };
  }
}

// packages/integrations/whatsapp/src/factory.ts
export function whatsappAdapter(env: NodeJS.ProcessEnv): WhatsAppAdapter {
  return env.NODE_ENV === 'test' ? new StubWhatsAppAdapter() : new RealWhatsAppAdapter(env);
}
```

### Global Setup (Testcontainer)

```ts
// vitest.global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export default async function () {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  const db = drizzle(url);
  await migrate(db, { migrationsFolder: './db/migrations' });
  return async () => { await container.stop(); };
}
```

## Testing Strategy — Testing Setup (Meta)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `defineConfig` returns expected Vitest config shape | Vitest: call factory, assert `test.environment`, coverage thresholds |
| Unit | `aSocio()` builder returns sensible defaults | Vitest: build, assert all required fields present |
| Unit | `aSocio().withX().build()` overrides defaults | Vitest: withId(42), assert data.id === 42 |
| Unit | `StubWhatsAppAdapter.send()` records to `__whatsappStub.messages` | Vitest: send, assert array length, assert body match |
| Unit | `whatsappAdapter(env)` returns Stub in test, Real in prod | Vitest: NODE_ENV='test' → Stub; NODE_ENV='production' → Real |
| Unit | `FakeClock` advances time deterministically | Vitest: clock.advance(1000), assert Date.now() increased |
| Integration | Testcontainer Postgres starts in < 30s | Vitest: time global setup, assert < 30000ms |
| Integration | `beforeEach` truncate cleans schema | Vitest: insert, truncate, query, assert 0 rows |
| Integration | Coverage gate fails when line coverage < 80% | Vitest: artificially lower coverage, run `--coverage`, assert exit 1 |
| Integration | Critical file below 90% fails the gate | Vitest: drop critical file coverage, assert CI script exits 1 |
| E2E | Login spec runs against dev server | Playwright: `pnpm test:e2e`, assert login flow passes |
| E2E | Trace + screenshot captured on failure | Playwright: force a failure, assert `test-results/` directory has artifacts |

## Migration / Rollback — Testing Setup

**Migration**: New packages (`packages/vitest-config`, `packages/test-builders`, `packages/integrations/*`) and root config files (`vitest.workspace.ts`, `vitest.global-setup.ts`, `coverage.critical.json`). No database migration. CI workflow added at `.github/workflows/ci.yml` with no impact on existing deployment. Husky installed via `pnpm prepare` once.

**Rollback**: 
- Remove `vitest.config.ts` files → packages lose test config, tests fail to run (no data loss).
- Delete `.github/workflows/ci.yml` → CI reverts to no testing-setup jobs (existing deployment CI is in `deployment-devops` section).
- Uninstall `husky` → no pre-commit hooks (safe — local only, not in CI).
- Delete `packages/test-builders`, `packages/vitest-config`, `packages/integrations/*` → consumers fail to import, but no production code path is broken (production uses Real adapters built into container wiring).

## Open Questions — Testing Setup

- [ ] Should `packages/test-builders` be marked as `private: true` in its `package.json` (preventing accidental publish) or remain a normal internal package? Currently pnpm workspaces handle this — confirm.
- [ ] Should the Testcontainer Postgres 16 image be pinned to a specific patch version (e.g., `postgres:16.4-alpine`) for reproducible builds, or float on `16-alpine`?
- [ ] Do we need a separate `vitest.integration.config.ts` per package to separate unit (fast) and integration (slow with Testcontainer) runs, or is one config with the global setup sufficient?
- [ ] Should the WhatsApp stub's `__whatsappStub` property be exposed for assertion, or should we provide a `getMessages()` accessor to encourage encapsulation? The spec explicitly demands `__whatsappStub.messages` for direct array access.
- [ ] For E2E tests that need authenticated state, should we use Playwright's `storageState` (re-authenticate once, reuse) or login per test (slower but more isolated)?
- [ ] Do we need a `coverage.critical.json` review checklist in `CONTRIBUTING.md` so PRs adding new critical files explain why?
- [ ] Should Testcontainer reuse the existing CI `postgres` service from `deployment-devops` (saves a container) or run a dedicated container for test isolation?

---

## Scheduler/Jobs Design

### Decision: In-Process Scheduler Library — `node-cron` with Custom `JobScheduler` Adapter

**Choice**: Use `node-cron` for cron parsing and tick firing, wrapped behind a `JobScheduler` interface (`packages/scheduler/src/scheduler.ts`). The interface owns the `Map<jobName, ScheduledTask>` registry, the in-memory concurrency guard, and the boot/shutdown lifecycle. `node-cron` is the engine; the interface is the contract.

**Alternatives considered**:
- `croner` — modern, promise-based, smaller footprint, but smaller community and fewer TypeScript typings out of the box. Rejected for ecosystem stability — `node-cron` is the de facto Node cron library with ~5M weekly downloads.
- `setInterval` directly — needs hand-rolled cron parsing, drift compensation, and DST handling. Rejected: rebuilds what `node-cron` already provides.
- BullMQ + Redis — distributed, persistent, retry policies built in. Rejected for v1: spec explicitly says single-node, and the `JobScheduler` interface is the migration path when we add Redis.

**Rationale**: `node-cron` covers the 5 default jobs in v1. The `JobScheduler` interface is the seam for swapping to BullMQ later — call sites (`scheduler.schedule(name, cron, handler)`) stay identical, only the adapter changes. This satisfies the spec's "MAY be swapped to BullMQ + Redis without modifying job definitions" requirement at zero v1 cost.

### Decision: `JobScheduler` Interface — Five Methods, Narrow Surface

**Choice**:

```typescript
// packages/scheduler/src/scheduler.ts
export interface JobScheduler {
  schedule(name: string, cronExpr: string, handler: JobHandler, opts?: JobOptions): void;
  start(): Promise<void>;
  stop(gracefulTimeoutMs?: number): Promise<void>;
  runNow(name: string, metadata?: Record<string, unknown>): Promise<{ job_run_id: string }>;
  list(): JobDefinition[];
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobContext {
  jobRunId: string;
  jobName: string;
  attempt: number;
  triggeredBy: 'scheduler' | 'manual' | 'post-import';
  metadata: Record<string, unknown>;
  log: pino.Logger; // child logger with job_run_id bound
  signal: AbortSignal; // cancelled on shutdown
}
```

**Alternatives considered**: `addHook`/`emit` event bus pattern (loses type safety, leaks implementation), class with per-job methods (less flexible, harder to test).

**Rationale**: Five methods map 1:1 to the spec's scenarios. `runNow` is the bridge for the `POST /api/v1/admin/jobs/{name}/run` endpoint and the post-import trigger. `list()` powers `GET /api/v1/admin/jobs/health` and the history endpoint. The `signal: AbortSignal` in `JobContext` is how shutdown propagates to long-running handlers (e.g., drift detection) — handlers that support cancellation can `ctx.signal.throwIfAborted()` between domain checks.

### Decision: Concurrent Execution Guard — In-Memory `Set<string>` of Running Jobs

**Choice**: The `JobScheduler` keeps `runningJobs: Set<string>` in memory. On tick: if `runningJobs.has(name)` → log `"skipped: previous run still in progress"` and return. Otherwise: add to set, run handler, remove from set in `finally`. This is the FIRST guard; the DB row is the SECOND (durable) guard.

**Alternatives considered**:
- `SELECT ... FOR UPDATE` row lock on `job_runs` (durable across processes, but adds a roundtrip on every tick; overkill for single-node v1).
- In-memory `Map<name, Promise>` (could chain retries, but adds complexity for the "skip and log" semantics the spec requires).
- PostgreSQL advisory lock (`pg_try_advisory_lock(hashtext(name))`) — works across nodes, but spec is single-node.

**Rationale**: The spec is single-node. An in-memory `Set` is O(1) per tick, zero round-trips, and matches the "skip and log" scenario exactly. The DB row state (`status='running'`) is the durable record; on boot, the scheduler reconciles the DB by marking orphaned `running` rows as `failed` (per the boot recovery scenario) — so a fresh process never starts with stale in-memory state. The two guards together give single-node correctness with crash safety.

### Decision: Job Run State Machine — DB-Backed with In-Memory Live Tracking

**Choice**: The `job_runs` table is the source of truth for state. The in-memory `Set` is the live-process view. Every transition writes to the DB:

| Transition | SQL | Where |
|---|---|---|
| Tick → pending | `INSERT INTO job_runs (status='pending', scheduled_at=now())` | tick handler |
| pending → running | `UPDATE job_runs SET status='running', started_at=now() WHERE id=?` | before handler |
| running → succeeded | `UPDATE job_runs SET status='succeeded', finished_at=now() WHERE id=?` | after handler |
| running → failed | `UPDATE job_runs SET status='failed', finished_at=now(), error_message=?, attempt=attempt+1 WHERE id=?` | catch block |
| failed → retry | (handled by retry logic, not direct transition — see below) | retry scheduler |
| failed (attempt=3) → dead_letter | `UPDATE job_runs SET status='dead_letter' WHERE id=?` | after retries exhausted |

`attempt` increments on each retry (capped at 3). Retries do NOT create new `job_runs` rows — they UPDATE the same row's `attempt` and `error_message`. This keeps history clean: one job invocation = one row, one final status.

**Alternatives considered**: New `job_runs` row per retry attempt (one tick = three rows — fragments history, requires aggregation queries), `job_runs` + `job_attempts` normalized table (overkill for 3 attempts max).

**Rationale**: One row per invocation matches how operators think about job history ("the 3pm drift-detection run, not the 3pm first-attempt row"). The `attempt` column preserves retry detail. This decision also makes the `triggered_by` semantics clean: every invocation has exactly one `triggered_by` value (the originating trigger), regardless of internal retries.

### Decision: Retry Policy — Exponential Backoff with Jitter, In-Memory Timer

**Choice**: On handler failure (caught exception), if `attempt < 3`:
1. Update `job_runs` to `failed` with the current `attempt` and error.
2. Compute backoff: `30s` for attempt 1→2, `120s` for 2→3, `600s` for 3 (if 3rd also fails, move to dead_letter instead of scheduling a 4th retry).
3. Apply jitter: `delay * (0.8 + Math.random() * 0.4)` → ±20%.
4. Schedule the retry via `setTimeout` (stored in `pendingRetries: Map<jobRunId, Timeout>` for shutdown cleanup).
5. On retry fire: re-check concurrency guard (might be a new run already), increment `attempt`, re-run handler.

If all 3 attempts fail: status becomes `dead_letter`, `audit_events` row written with `action='JOB_DEAD_LETTER'`, operational alert emitted per the `api-security` spec.

**Alternatives considered**: BullMQ-style retry queue in the DB (job would need a `next_retry_at` column, polling worker — adds infrastructure for v1), exponential backoff without jitter (thundering-herd risk per spec).

**Rationale**: In-memory `setTimeout` is sufficient for single-node v1. The `pendingRetries` map ensures `stop()` can `clearTimeout` all pending retries on shutdown. Jitter is per spec (avoid thundering herd). The `30s / 120s / 600s` sequence matches the spec literally (30s, 2min, 10min).

### Decision: Post-Import Freshness Trigger — Direct Method Call, Not Event Bus

**Choice**: The `import-batch` job handler, on success, calls `scheduler.runNow('freshness-refresh', { domain, import_job_id })` directly. The return value is awaited; the import job is considered complete only after freshness-refresh returns (or its first tick starts, depending on `runNow` semantics — see below).

**Alternatives considered**:
- `EventEmitter` (`scheduler.emit('import.completed', { domain })` and a freshness-refresh listener) — decouples modules, but loses backpressure and the "within 5 seconds" timing guarantee.
- Promise resolved on a shared `Map` (manual pub/sub) — reinventing events poorly.
- A separate "trigger" table polled by the scheduler (decoupled, but adds DB polling for a hot path).

**Rationale**: Direct call is the simplest mechanism that satisfies the spec ("within 5 seconds"). The `runNow` method already enqueues a `job_runs` row with `triggered_by='post-import'`, so the audit trail is preserved without an event bus. The import handler is in the same process as the scheduler — no network hop.

**Return semantics for `runNow`**: returns `{ job_run_id }` immediately (enqueue is synchronous, execution is async). The import handler does NOT await the freshness-refresh completion — it only awaits the enqueue. The spec says "trigger a `freshness-refresh` job run within 5 seconds" — enqueueing the run satisfies this. Awaiting completion would couple import latency to refresh duration (bad).

### Decision: Cron Configuration — Environment Variables with Defaults

**Choice**: Each periodic job has one env var with a default:

| Job | Env var | Default | Type |
|---|---|---|---|
| `drift-detection` | `DRIFT_DETECTION_CRON` | `*/15 * * * *` | required, validated on boot |
| `freshness-refresh` | `FRESHNESS_REFRESH_CRON` | `*/5 * * * *` | required, validated on boot |
| `token-cleanup` | `TOKEN_CLEANUP_CRON` | `0 3 * * *` | required, validated on boot |
| `reconciliation` | `RECONCILIATION_CRON` | `0 2 * * *` | optional (job disabled if unset) |

`import-batch` has no cron — it's manual-only.

Validation: on boot, `node-cron.validate(expr)` is called for each configured expression. Failure → `process.exit(1)` with the offending env var name. `AUDIT_RETENTION_DAYS=90` is also validated on boot (positive integer).

**Alternatives considered**: YAML config file (adds file-loading complexity, requires a path, and env vars are the standard 12-factor mechanism for config that changes per environment), one big `CRON_JOBS` JSON env var (harder to grep, less greppable in logs).

**Rationale**: The spec calls out env vars explicitly (`DRIFT_DETECTION_CRON`, `FRESHNESS_REFRESH_CRON`, `TOKEN_CLEANUP_CRON`, `AUDIT_RETENTION_DAYS`). One env var per job keeps config grep-friendly and per-job overrideable. `node-cron.validate` is a built-in — no extra dependency.

### Decision: Time Zone Handling — `node-cron` Native `timezone` Option, No External `tz` Library

**Choice**: `node-cron` accepts a `timezone` option on each `schedule()` call. For jobs that align to Argentina wall-clock time (e.g., `token-cleanup` at "03:00 Argentina time"), pass `timezone: 'America/Argentina/Buenos_Aires'`. For jobs on a fixed cadence regardless of DST (e.g., `drift-detection` every 15 minutes), no timezone is passed — `node-cron` interprets the cron in the system timezone (UTC in Docker, per deployment design), and the cadence is correct either way.

**Alternatives considered**: `luxon` or `date-fns-tz` (overkill — only need tz string passthrough), `Temporal` API (Node 20+ has it behind a flag — too bleeding-edge), `croner` (mentioned above — has better native tz support, but we picked `node-cron`).

**Rationale**: `node-cron` uses the system's IANA tz database via the `Intl` API. Argentina does NOT observe DST since 2009, so `America/Argentina/Buenos_Aires` is stable (UTC-3 year-round). The deployment design already pins Docker to UTC — the system clock is UTC. For cadence-based jobs (every N minutes), UTC is correct. For wall-clock jobs (daily at 03:00), Argentina tz is correct. Two patterns, both supported natively.

**Validation**: `Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })` is checked at boot to ensure the IANA string is valid in the Node runtime.

### Decision: Job Lifecycle Hooks — Composed via JobHandler Return Value + Scheduler Logging

**Choice**: There are no `onStart`/`onSuccess`/`onFailure`/`onDeadLetter` hooks callable from the outside. Instead, the lifecycle is the handler contract itself:

- **onStart**: the scheduler inserts the `running` row, binds the child logger, calls `handler(ctx)`. The handler does NOT need to do anything for "onStart" — it just runs.
- **onSuccess**: handler returns normally (or returns `JobResult`). Scheduler updates the row to `succeeded`, writes the `metadata`, logs `event: 'JOB_SUCCEEDED'`.
- **onFailure**: handler throws. Scheduler catches, updates row to `failed`, decides retry vs dead_letter.
- **onDeadLetter**: scheduler (after 3rd failure) updates row to `dead_letter`, emits the `JOB_DEAD_LETTER` audit event, emits the operational alert.

Handlers can ALSO emit audit events inside their body (e.g., `drift-detection` emits `DRIFT_DETECTED` on detection). This is the "in-handler audit" pattern, separate from the scheduler's lifecycle audit.

**Alternatives considered**: External `onSuccess(name, result)` callback registration (leaky — handlers become coupled to side effects), event emitter (`scheduler.on('success', ...)` — same coupling), middleware pipeline (overkill for 5 default jobs).

**Rationale**: The handler-returns-value + scheduler-catches pattern is the cleanest composition. There are no "hooks" — just one well-defined contract. The scheduler emits lifecycle audit events automatically (no risk of a handler forgetting to log success). Handlers emit domain events (drift, token cleanup counts, etc.) as needed. Clear separation: scheduler = lifecycle, handler = domain logic.

### Decision: Shutdown Handling — `SIGTERM` → `stop()` with 30s Graceful Window

**Choice**: `apps/api/src/index.ts` registers a `SIGTERM` handler that calls `await scheduler.stop(30_000)`. `stop()` does, in order:

1. Set `shuttingDown = true` flag — blocks new ticks (`schedule()` calls return early).
2. `clearTimeout` all entries in `pendingRetries`.
3. `await Promise.race([allRunningJobs, sleep(30_000)])` — wait for in-flight handlers, max 30s.
4. For any still-running job after timeout: `UPDATE job_runs SET status='failed', error_message='process shutdown', finished_at=now() WHERE status='running'`. This satisfies the spec's "Mark any still-running jobs as `failed` with `error_message='process shutdown'`".
5. Call `node-cron` `stop()` on all tasks (no new ticks).
6. Resolve — the Fastify server's `close()` hook awaits this before exiting.

The `JobContext.signal: AbortSignal` is created with `AbortController` per running job. On timeout, `controller.abort()` is called. Handlers that respect `AbortSignal` (via `ctx.signal.throwIfAborted()` or `ctx.signal.addEventListener('abort', ...)`) can exit early.

**Alternatives considered**: `SIGKILL` after timeout (no graceful window — violates spec), separate "drain" phase for HTTP requests (orthogonal — handled by Fastify's own shutdown), `process.on('beforeExit')` (Node fires this for natural exits, not SIGTERM — wrong hook).

**Rationale**: The spec is explicit: 30s grace, mark `failed` on timeout, await in-flight jobs. The `AbortSignal` pattern is the standard Web API for cancellation and is already used elsewhere in the Node ecosystem. `clearTimeout` on retries prevents late-firing retries from running in a stopped scheduler.

### Decision: Job Run ID Generation — `jr_<uuidv4>`

**Choice**: `job_run_id` exposed in API responses and audit events is a UUIDv4 with `jr_` prefix (matching the `req_` prefix pattern from the error-handling design). The DB column `id` is a bare UUID (FK-friendly, indexable). The `jr_` prefix appears in the JSON response, not in the DB.

**Alternatives considered**: Plain UUID (less greppable, harder to distinguish from operator IDs in logs), `jr_<timestamp>_<random>` (slightly sortable but longer and not strictly monotonic).

**Rationale**: Consistency with the `req_<uuid>` pattern from the existing error-handling design. The `jr_` prefix is a log-grep affordance — operators searching for "what happened to the drift run" can grep `jr_` and find every related log line.

## Data Flow — Scheduler/Jobs

```
   Boot                                                    Cron tick
     │                                                        │
     ▼                                                        ▼
validateEnv() ─── node-cron.validate()  ──►  schedule(name, cron, handler)
     │                                                        │
     ▼                                                        ▼
loadJobDefinitions()                  onTick():
     │                                     │
     ├── drift-detection: */15                ▼
     ├── freshness-refresh: */5          concurrency guard
     ├── token-cleanup: 0 3 * * *           │
     ├── reconciliation: 0 2 * * *          ├── running? ──► log "skipped" ──► return
     └── import-batch: manual-only           │
                                             ▼
                                       INSERT job_runs (pending)
                                             │
                                             ▼
                                       UPDATE job_runs (running)
                                             │
                                             ▼
                                       handler(ctx)
                                             │
                                ┌────────────┴────────────┐
                                │                         │
                          returns normally           throws
                                │                         │
                                ▼                         ▼
                       UPDATE job_runs          UPDATE job_runs
                       (succeeded)              (failed, attempt+1)
                                │                         │
                                ▼                         ▼
                          log JOB_SUCCEEDED      attempt < 3?
                                                     │ yes ─► setTimeout(jitter)
                                                     │ no  ─► UPDATE job_runs
                                                     │         (dead_letter)
                                                     │         audit JOB_DEAD_LETTER
                                                     │         emit alert

Manual trigger (POST /api/v1/admin/jobs/{name}/run):
   API route ──► requireRole('ADMIN') ──► scheduler.runNow(name, {operator_id})
                                          │
                                          ▼
                                     runNow semantics:
                                       1. INSERT job_runs (pending, triggered_by='manual')
                                       2. enqueue handler (do not block)
                                       3. return { job_run_id }

Post-import trigger (inside import-batch handler):
   import handler ──► import returns OK
                          │
                          ▼
                     scheduler.runNow('freshness-refresh', {domain, import_job_id})
                          │
                          ▼
                     enqueue + return job_run_id (import does NOT await completion)
```

## File Changes — Scheduler/Jobs Addition

| File | Action | Description |
|------|--------|-------------|
| `db/schema/job_runs.sql` | Create | DDL for `job_runs` table per spec |
| `db/migrations/0009_job_runs.sql` | Create | Migration for `job_runs` |
| `packages/db/src/schema/job_runs.ts` | Create | Drizzle schema for `job_runs` |
| `packages/scheduler/package.json` | Create | Package manifest with `node-cron` dep |
| `packages/scheduler/src/types.ts` | Create | `JobHandler`, `JobContext`, `JobResult`, `JobDefinition` types |
| `packages/scheduler/src/scheduler.ts` | Create | `InProcessScheduler` class implementing `JobScheduler` |
| `packages/scheduler/src/jobs/drift-detection.ts` | Create | Drift-detection handler (wraps drift-detector package) |
| `packages/scheduler/src/jobs/freshness-refresh.ts` | Create | Freshness-refresh handler (wraps freshness-monitor package) |
| `packages/scheduler/src/jobs/token-cleanup.ts` | Create | Token-cleanup handler (deletes expired tokens + audit retention) |
| `packages/scheduler/src/jobs/reconciliation.ts` | Create | Reconciliation handler (placeholder for v1, enabled via env) |
| `packages/scheduler/src/jobs/import-batch.ts` | Create | Import-batch handler (wraps legacy-import package) |
| `packages/scheduler/src/router.ts` | Create | Fastify routes for `/api/v1/admin/jobs/*` (history, health, runNow) |
| `apps/api/src/index.ts` | Modify | Register scheduler plugin, SIGTERM handler, boot reconciliation |
| `packages/config/src/env.ts` | Modify | Add `DRIFT_DETECTION_CRON`, `FRESHNESS_REFRESH_CRON`, `TOKEN_CLEANUP_CRON`, `RECONCILIATION_CRON`, `AUDIT_RETENTION_DAYS` to Zod schema |
| `apps/api/src/server.ts` | Modify | Register scheduler routes plugin |

## Interfaces / Contracts — Scheduler/Jobs

### `job_runs` Table (per spec, verbatim)

```sql
CREATE TABLE job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
  attempt INT NOT NULL DEFAULT 1,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  triggered_by TEXT NOT NULL DEFAULT 'scheduler' -- 'scheduler' | 'manual' | 'post-import'
);
CREATE INDEX idx_job_runs_job_name_started ON job_runs (job_name, started_at DESC);
CREATE INDEX idx_job_runs_status ON job_runs (status) WHERE status IN ('running','failed','dead_letter');
```

### `JobScheduler` Interface (reference)

```typescript
// packages/scheduler/src/scheduler.ts
import type pino from 'pino';

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobContext {
  jobRunId: string;            // UUID stored in job_runs.id
  jobName: string;
  attempt: number;             // 1..3
  triggeredBy: 'scheduler' | 'manual' | 'post-import';
  metadata: Record<string, unknown>;
  log: pino.Logger;            // child logger with jobRunId bound
  signal: AbortSignal;         // aborted on shutdown timeout
}

export interface JobResult {
  status: 'succeeded';
  metadata?: Record<string, unknown>;  // merged into job_runs.metadata on success
}

export interface JobDefinition {
  name: string;
  cronExpr: string | null;     // null for manual-only (import-batch)
  handler: JobHandler;
  timezone?: string;            // IANA tz, e.g. 'America/Argentina/Buenos_Aires'
  enabled: boolean;             // false if cron env var unset (e.g. reconciliation)
}

export interface JobScheduler {
  schedule(name: string, cronExpr: string, handler: JobHandler, opts?: { timezone?: string }): void;
  start(): Promise<void>;
  stop(gracefulTimeoutMs?: number): Promise<void>;
  runNow(name: string, metadata?: Record<string, unknown>): Promise<{ job_run_id: string }>;
  list(): JobDefinition[];
}
```

### Admin Routes (reference)

```typescript
// packages/scheduler/src/router.ts
fastify.get('/api/v1/admin/jobs/runs', {
  preHandler: [requireRole('ADMIN')],
  schema: { querystring: JobRunsQuerySchema } // job_name, status, start_date, end_date, limit, offset
}, async (request) => {
  return jobRunsRepo.paginate(request.query);
});

fastify.get('/api/v1/admin/jobs/health', {
  preHandler: [requireRole('ADMIN')],
}, async () => {
  return scheduler.list().map(jobToHealth);
});

fastify.post('/api/v1/admin/jobs/:name/run', {
  preHandler: [requireRole('ADMIN')],
}, async (request) => {
  const { name } = request.params;
  if (!scheduler.list().find(j => j.name === name)) {
    throw BusinessError('NOT_FOUND', `Job ${name} is not registered`, { error: 'JOB_NOT_FOUND' });
  }
  return scheduler.runNow(name, { operator_id: request.operator.id });
});
```

### Boot Recovery (reference)

```typescript
// apps/api/src/index.ts
async function bootScheduler() {
  // 1. Reconcile orphaned runs
  await db.execute(sql`
    UPDATE job_runs
    SET status = 'failed',
        finished_at = now(),
        error_message = 'process terminated unexpectedly'
    WHERE status = 'running'
  `);

  // 2. Load and validate cron expressions
  const jobs = loadJobDefinitions();  // reads env vars, defaults
  for (const job of jobs) {
    if (job.cronExpr && !nodeCron.validate(job.cronExpr)) {
      throw new Error(`Invalid cron expression for ${job.name}: ${job.cronExpr}`);
    }
  }

  // 3. Schedule and start
  for (const job of jobs) {
    if (job.enabled && job.cronExpr) {
      scheduler.schedule(job.name, job.cronExpr, job.handler, { timezone: job.timezone });
    }
  }
  await scheduler.start();
}

// SIGTERM handler (registered before server.start())
process.on('SIGTERM', async () => {
  await scheduler.stop(30_000);  // graceful 30s
  await fastify.close();         // then HTTP
});
```

## Testing Strategy — Scheduler/Jobs

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `JobScheduler.schedule()` registers job in internal map | Vitest: schedule('test','*/5 * * * *', handler), assert list() contains it |
| Unit | `runNow()` returns `job_run_id` and inserts `pending` row | Vitest: mock DB, call runNow, assert INSERT + return shape |
| Unit | Concurrency guard skips second tick while first runs | Vitest: handler that hangs, fire two ticks, assert second logged "skipped" |
| Unit | Handler success transitions row to `succeeded` | Vitest: passing handler, await tick, assert row status='succeeded' |
| Unit | Handler failure transitions to `failed` (attempt 1) | Vitest: throwing handler, await tick, assert status='failed', attempt=1 |
| Unit | 3 failed attempts transition to `dead_letter` | Vitest: advance fake clock through 3 retries, assert final status='dead_letter' |
| Unit | Retry backoff: 30s ± jitter, 120s ± jitter, 600s ± jitter | Vitest: fake clock, assert retry fires at expected times within ±20% |
| Unit | Successful retry clears `failed` → `succeeded` (no alert) | Vitest: fail attempt 1, succeed attempt 2, assert no JOB_DEAD_LETTER audit |
| Unit | Boot recovery marks orphaned `running` rows as `failed` | Vitest: insert 'running' row, call boot, assert row updated |
| Unit | SIGTERM stops within 30s, marks in-flight as `failed` | Vitest: long-running handler, send SIGTERM (via process.emit), assert shutdown completes |
| Unit | SIGTERM allows fast handler to complete as `succeeded` | Vitest: 1s handler, SIGTERM, await stop, assert row status='succeeded' |
| Unit | Invalid cron expression in env → boot throws | Vitest: DRIFT_DETECTION_CRON='not-a-cron', call boot, assert throws |
| Unit | `runNow` for unknown job name returns 404 | Vitest: POST /api/v1/admin/jobs/unknown/run, assert 404 + JOB_NOT_FOUND |
| Unit | `GET /api/v1/admin/jobs/runs` requires ADMIN | Vitest: operator role=OPERADOR, assert 403 |
| Unit | `GET /api/v1/admin/jobs/health` marks job `unhealthy` after 2× interval | Vitest: insert last_succeeded=2h ago for 5min job, assert healthy=false |
| Integration | Drift detection runs on cron tick and emits DRIFT_DETECTED audit | Testcontainers + fake clock: advance to tick, assert drift detected, audit row written |
| Integration | Token cleanup deletes only expired + grace period tokens | Testcontainers: insert tokens at various expiry, run job, assert correct ones deleted |
| Integration | Post-import freshness trigger fires within 5s | Testcontainers: complete import, assert freshness-refresh job_runs row created with triggered_by='post-import' |
| Integration | Manual trigger persists with triggered_by='manual' | Testcontainers: POST /run, assert row has triggered_by='manual' |
| Integration | Manual trigger does not shift cron schedule | Testcontainers: trigger at minute 7, advance clock to minute 15, assert scheduled tick fires |
| Integration | Failed drift-detection writes `JOB_DEAD_LETTER` audit after 3 attempts | Testcontainers: throw 3 times, assert audit row with action='JOB_DEAD_LETTER' |
| Integration | `freshness-refresh` cron=NULL still callable via runNow | Testcontainers: unset env, call runNow, assert row inserted |
| E2E | Full lifecycle: schedule → tick → succeed → history visible | Playwright: wait for tick, GET /runs, assert row present with correct fields |
| E2E | Manual drift trigger via admin endpoint | Playwright: login as admin, POST /run, GET /runs, assert manual row present |

## Migration / Rollback — Scheduler/Jobs

**Migration**: Run `0009_job_runs.sql` migration on deployment. New table, no data to backfill. The five default jobs are registered on first boot — no separate "seed" step needed.

**Rollback**: 
- The `job_runs` table can be dropped safely — no other table has a FK to it.
- The scheduler plugin can be unregistered — handlers that try to call `scheduler.runNow` will throw at runtime (visible in logs, no silent data corruption).
- If the scheduler misbehaves in production: setting `*_CRON` to a value like `0 0 31 2 *` (Feb 31 = never) effectively disables any periodic job without code changes. Recovery: revert the env var to the previous value.

## Open Questions — Scheduler/Jobs

- [ ] Should `runNow` return a `job_run_id` even for unknown jobs (so we can audit "admin tried to run unknown-job") or 404 immediately? The spec says 404 — confirm.
- [ ] For the `freshness-refresh` post-import trigger, should we batch multiple consecutive imports (e.g., 3 imports in 10s = 1 refresh) or fire one refresh per import? Spec says one per import; confirm we want the simple semantics.
- [ ] Should `AUDIT_RETENTION_DAYS` cleanup happen inside the `token-cleanup` job (current plan) or as a separate `audit-cleanup` job? Same cadence, different concern.
- [ ] When migrating to BullMQ later, do we keep the `job_runs` table as a history/audit mirror (BullMQ has its own state, but we want the rich history for the admin endpoint) or rely on BullMQ's job state?
- [ ] Should `runNow` for a job with an active run block (return 409) or enqueue a second concurrent invocation (which the concurrency guard will then skip)? Current design: skip and return the new `job_run_id` with status='failed' (the run that was skipped). Confirm.

---

## Monitoring & Observability Design

This section extends the `api-design` (`GET /health`), `logging` (`request_id` correlation), and `deployment-devops` (Docker healthcheck) surfaces with a coherent metrics + health + alerting seam.

### Decision: Metrics Library — `prom-client`

**Choice**: `prom-client` (the de-facto Node.js Prometheus library). Default registry, enabled process collectors (`collectDefaultMetrics()`), and explicit registration of application metrics. No custom exposition format — Prometheus text format only.

**Alternatives considered**: `prom-client-express-middleware` (Express-shaped, wrong framework), custom exposition (reinvents `prom-client`), OpenTelemetry metrics SDK (OTEL is explicitly deferred per spec).

**Rationale**: `prom-client` is the Node.js standard, supports histograms with custom buckets, and integrates cleanly with Fastify via a single response handler. Deferring OTEL is correct — the spec commits to `request_id` as the v1 trace seam.

### Decision: `/metrics` Endpoint — Same Port, No Auth, Reverse-Proxy ACL

**Choice**: Expose `GET /metrics` on the same Fastify instance and port as the rest of the API. No application-level auth. The spec leaves production restriction to the reverse proxy (Caddy/Nginx) — v1 deploys behind a private network ACL.

**Alternatives considered**: Separate admin port (extra process surface, doubles Docker healthcheck complexity), `bearer` token auth (contradicts the spec's "no auth on internal network"), `Basic` auth (operational friction for Prometheus scraper).

**Rationale**: Same port keeps Docker healthcheck, scrape, and runtime uniform. The internal-network boundary is the right place to gate scraping — keeping the app unaware of network topology is a clean separation.

### Decision: Histogram Buckets — Spec Default + Per-Route Override Hook

**Choice**: Default buckets per spec: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]` seconds. Per-route buckets are an opt-in field on the Fastify route options (`routeOptions.config.metricsBuckets`). Default is correct for p50/p95/p99 on a sub-2s API.

**Alternatives considered**: Auto-tune buckets from runtime data (premature for v1, requires baselining we don't have yet), one global bucket set (works — but special endpoints like `imports:run` legitimately need wider buckets).

**Rationale**: p95 across the spec's targets (100ms–500ms for reads) is captured cleanly in the 0.05–0.5s buckets. Endpoints that legitimately exceed (e.g., report generation) can override at route definition.

### Decision: Cardinality Control — `route` Label from `request.routeOptions.url`

**Choice**: Use `request.routeOptions.url` (e.g., `/api/v1/socios/:id`) as the `route` label — never `request.url`. The Fastify route template is set at route registration and is a bounded finite set.

**Alternatives considered**: URL pattern extraction post-hoc (regex on `/api/v1/socios/12345` is fragile and cardinality-prone), skip the `route` label entirely (loses per-endpoint SLO data — defeats the purpose).

**Rationale**: Fastify exposes the matched route template at request lifecycle completion. Bound is the number of registered routes (~30) — safe cardinality.

### Decision: Health Checks — Three Endpoints, Real Probes, Cached Legacy Check

**Choice**:
- `GET /health` — liveness, no dependencies, returns `{status, version, timestamp}` synchronously. The `version` comes from `package.json` at build time.
- `GET /health/ready` — readiness, pings PostgreSQL with a 2s `SELECT 1` timeout, then checks the legacy DBF share with a cached probe. 2s hard ceiling enforced by `Promise.race`.
- `GET /health/startup` — readiness gated by a `server.startupComplete` boolean flipped after the entrypoint's migration step finishes.

The legacy check uses a **30s cache** (`Map<path, { ok, expiresAt }>`). Reading the DBF share on every ready check would saturate the SMB connection and slow probes.

**Alternatives considered**: Real check on every ready hit (DBF share I/O on every probe — slow + may stall), `fs.accessSync` per call (blocks event loop), no cache (correctness on first failure — but inverts the failure mode for steady state).

**Rationale**: Liveness MUST NOT touch dependencies (spec). Readiness MUST reflect current state but is rate-limited by the 2s budget. Startup MUST be cheap and signal only when truly ready. Caching the legacy probe is the trade-off — the staleness window (30s) is well below human reaction time.

### Decision: Metrics Middleware — Custom `onResponse` Hook (Not `@fastify/metrics`)

**Choice**: A custom `onResponse` hook in `apps/api/src/plugins/metrics.ts` records `http_requests_total` and `http_request_duration_seconds` from Fastify's own `request`/`reply` objects. Database pool metrics are sampled by a `setInterval` collector (1s tick) that reads `pool.totalCount`/`pool.idleCount`/`pool.waitingCount`. Query duration is wrapped by a `withQueryTiming()` helper used by the data-access layer.

**Alternatives considered**: `@fastify/metrics` (good plugin, but bundles its own defaults that conflict with our bucket choices and adds a second registry), `prom-client` automatic instrumentation (doesn't exist — must wrap manually anyway).

**Rationale**: ~80 lines of code gives us full control over labels, buckets, and registry lifecycle. The hook runs after Fastify has set `reply.statusCode` and `request.routeOptions.url` — the only correct time to read them.

### Decision: Business Metrics — Event Emission + 30s Gauge Refresh Job

**Choice**: 
- **Counters** (`athlos_imports_total`, `athlos_import_records_total`, `athlos_drift_events_total`) are incremented at the point of action by direct calls to the metrics module — e.g., `metrics.importsTotal.inc({domain, status: 'success'})` inside the import job completion path. No scheduled job.
- **Gauges** (`athlos_active_operators`, `athlos_freshness_seconds`) are refreshed by a `setInterval(30_000)` collector in the metrics plugin that runs a single `SELECT` and sets gauge values. Idempotent and safe to re-run on overlap.

**Alternatives considered**: Scheduled job that increments counters (state drift if process restarts mid-job — counters reset to zero), `cron`-driven gauge refresh (existing scheduler infra, but 30s is too tight for cron granularity — interval is simpler).

**Rationale**: Counters are stream semantics — increment in place. Gauges are point-in-time — refresh on a tick. Mixing the two would force a query on every import just to update a counter.

### Decision: Performance Baselines — Hardcoded Constants in `packages/monitoring/src/baselines.ts`

**Choice**: A single `BASELINES` exported object maps endpoint name → `{p95TargetMs, hardCeilingMs}`. Values are copied verbatim from the spec's table. No config file, no env var. The monitoring plugin exposes them on a `GET /internal/baselines` debug endpoint for load-test scripts.

**Alternatives considered**: YAML config (extra parsing, no advantage for ~8 entries), env vars (operator must override per-deploy — adds footgun, no real need), DB table (overkill for static data).

**Rationale**: Baselines are code-level contracts — they belong with the code. A `load-test.ts` script (v2) reads the same export to assert against targets.

## Data Flow — Monitoring

```
Process boot ──► validateEnv() ──► migrate() ──► startupComplete = true
                                                       │
Request ──► onRequest ──► request_id, startTime        │
            │                                           │
            ├── /health ──► static body, 200            │
            ├── /health/ready ──► pool.query('SELECT 1') + legacy cache
            │                  ──► 200 or 503 (< 2s)
            ├── /health/startup ──► startupComplete? 200 : 503
            └── /metrics ──► registry.metrics() text/plain
                                       │
            onResponse hook ──► histogram.observe(duration)
                           ──► counter.inc({method,route,status_code})
                                       │
            setInterval(30s) ──► SELECT count(*) FROM operators WHERE last_login_at > now() - interval '24h'
                            ──► active_operators.set(value)
                            ──► SELECT max(finished_at) FROM import_jobs ──► freshness_seconds.set(...)
```

## File Changes — Monitoring & Observability Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/monitoring/package.json` | Create | Package manifest with `prom-client` dependency |
| `packages/monitoring/src/registry.ts` | Create | `prom-client` Registry, default metrics, counter/histogram definitions |
| `packages/monitoring/src/health.ts` | Create | Fastify plugin: `/health`, `/health/ready`, `/health/startup` |
| `packages/monitoring/src/metrics-plugin.ts` | Create | Fastify plugin: `/metrics` route + `onResponse` hook + 30s gauge refresh |
| `packages/monitoring/src/db-metrics.ts` | Create | `withQueryTiming()` wrapper + pool gauge collector |
| `packages/monitoring/src/baselines.ts` | Create | `BASELINES` constants + `GET /internal/baselines` handler |
| `packages/monitoring/src/business.ts` | Create | Typed increment helpers: `metrics.importsTotal.inc({domain,status})` etc. |
| `packages/monitoring/src/index.ts` | Create | Public exports |
| `apps/api/src/server.ts` | Modify | Register `healthPlugin`, `metricsPlugin`; wire DB pool reference |
| `packages/data-access/src/query.ts` | Modify | Wrap `pool.query` with `withQueryTiming` for histogram |
| `packages/import/src/job.ts` | Modify | Call `business.recordImportComplete({domain,status})` on finish |
| `packages/drift-detector/src/runner.ts` | Modify | Call `business.recordDriftEvent({domain})` per finding |
| `packages/db/src/pool.ts` | Modify | Expose `pool` for gauge collector registration |

## Interfaces / Contracts — Monitoring & Observability

### Registry & Metric Definitions (reference)

```typescript
// packages/monitoring/src/registry.ts
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // process_cpu, heap, eventloop, etc.

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by method, route, status',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});
```

### Health Plugin (reference)

```typescript
// packages/monitoring/src/health.ts
import { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
).version;

const legacyCache = new Map<string, { ok: boolean; expiresAt: number }>();

async function checkLegacyShare(path: string): Promise<boolean> {
  const cached = legacyCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;
  try {
    await fs.promises.access(path, fs.constants.R_OK);
    legacyCache.set(path, { ok: true, expiresAt: Date.now() + 30_000 });
    return true;
  } catch {
    legacyCache.set(path, { ok: false, expiresAt: Date.now() + 30_000 });
    return false;
  }
}

export const healthPlugin: FastifyPluginAsync<{ pool: Pool; legacyPath: string }> = async (
  fastify,
  { pool, legacyPath }
) => {
  fastify.get('/health', async () => ({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/health/ready', async (_req, reply) => {
    const check = withTimeout(checkReadiness(pool, legacyPath), 2000);
    const result = await check;
    reply.status(result.ok ? 200 : 503).send(result);
  });

  fastify.get('/health/startup', async (_req, reply) => {
    const ok = (fastify as any).startupComplete === true;
    reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'starting' });
  });
};
```

### Metrics Plugin (reference)

```typescript
// packages/monitoring/src/metrics-plugin.ts
export const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    // Skip /health, /health/ready, /health/startup, /metrics — they'd self-scrape
    if (request.url.startsWith('/health') || request.url === '/metrics') return;
    const labels = {
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status_code: String(reply.statusCode),
    };
    const duration = (reply.elapsedTime ?? 0) / 1000; // ms → s
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });
};
```

### Baselines (reference)

```typescript
// packages/monitoring/src/baselines.ts
export const BASELINES = {
  'POST /api/v1/auth/login':           { p95TargetMs: 500,  hardCeilingMs: 2000 },
  'GET /api/v1/socios':                { p95TargetMs: 200,  hardCeilingMs: 1000 },
  'GET /api/v1/socios/:id':            { p95TargetMs: 100,  hardCeilingMs: 500  },
  'GET /api/v1/cuenta-corriente/:id':  { p95TargetMs: 300,  hardCeilingMs: 1500 },
  'GET /api/v1/cuenta-corriente/:id/saldo': { p95TargetMs: 200, hardCeilingMs: 1000 },
  'GET /api/v1/freshness':             { p95TargetMs: 100,  hardCeilingMs: 500  },
  'GET /api/v1/lineage':               { p95TargetMs: 200,  hardCeilingMs: 1000 },
  'import:full_batch':                 { p95TargetMs: 3_600_000, hardCeilingMs: 14_400_000 },
} as const;
```

## Testing Strategy — Monitoring & Observability

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `httpRequestsTotal` increments with correct labels | Vitest: invoke hook, assert counter value |
| Unit | Histogram observation accepts custom buckets from route config | Vitest: register route with `config.metricsBuckets`, assert bucket boundaries |
| Unit | Cardinality control: `request.url` with IDs is NOT used | Vitest: `request.url='/api/v1/socios/abc'` → assert `route='/api/v1/socios/:id'` |
| Unit | `health` liveness never queries dependencies | Vitest: stop DB, call `/health` → 200 |
| Unit | `health/ready` 503 on DB down within 2s | Vitest: kill pool, call endpoint, assert 503 + elapsed < 2100ms |
| Unit | Legacy cache returns stale `ok` within 30s window | Vitest: first call probes, delete share, second call within 30s → still `ok` |
| Unit | `health/startup` returns 503 until flag is set | Vitest: flag unset → 503; set flag → 200 |
| Unit | Health responses contain no PII / no stack | Vitest: assert body has only `status`, `version`, `timestamp` (+ `dependencies` codes) |
| Unit | `registry.metrics()` returns valid Prometheus text format | Vitest: parse output, assert `^# HELP` and `^# TYPE` lines present |
| Unit | DB pool gauges reflect pool state | Vitest: acquire conn, assert `idleCount` decremented; release, assert restored |
| Unit | `withQueryTiming` records duration in `db_query_duration_seconds` | Vitest: mock pool, call wrapper, assert histogram observed |
| Integration | Real Prometheus scrape of `/metrics` yields 200 + parseable | Integration: Testcontainers API, hit `/metrics`, run `prom-client` parser |
| Integration | 30s gauge refresh queries DB | Integration: run plugin, wait 31s, assert `athlos_active_operators` reflects seeded operators |
| E2E | Scrape + record rules work end-to-end | Playwright: scrape `/metrics`, query `athlos_freshness_seconds`, assert reflects time since import |

## Migration / Rollback — Monitoring & Observability

**Migration**: No DDL changes. Add `prom-client` to `packages/monitoring/package.json` and wire the plugin in `apps/api/src/server.ts`. The startup gate uses an existing boolean the entrypoint already sets.

**Rollback**: Unregister `healthPlugin` and `metricsPlugin` from `apps/api/src/server.ts`. Remove the `withQueryTiming` wrapper from the data-access layer (transparent — pure pass-through on the wrapped path). The reverse proxy's scrape config is the only external surface to remove. No data migration; no DB changes.

## Open Questions — Monitoring & Observability

- [ ] Should `/metrics` be disabled in `NODE_ENV=test` (test isolation vs. metric accumulation across test files)?
- [ ] Do we need per-route PII scrubbing in the `route` label (e.g., a route that embeds an operator's email in the URL template)?
- [ ] For the legacy share check, is 30s the right cache TTL, or should it match the spec's 2s readiness budget strictly (cache miss = 2s timeout budget for the I/O)?
- [ ] Should `athlos_drift_events_total` be incremented at finding time or at email-send time (spec says "drift-detector findings" — but email send may fail)?
- [ ] Do we want a `process_legacy_share_check_duration_seconds` histogram to observe the cache effectiveness, or is that a v2 self-observation?
- [ ] When the second instance is added (multi-node), do we migrate `/metrics` to a Prometheus pushgateway, or do the instances get separate scrape targets (the standard approach)?

---

## Notifications Design

> Extends the `packages/integrations/email/` stub (already declared in the testing-setup section, line 3273) and the existing `WhatsAppAdapter` pattern. This section adds the dispatcher, templates, in-app storage, preferences table, API endpoints, and the wiring from drift-detector / legacy-import / auth-login / approval-link.

### Decision: Package Layout — `packages/notifications/` + Reuse of `packages/integrations/email/`

**Choice**: New `packages/notifications/` package owns dispatcher, templates, in-app repo, preferences repo, route handlers. Email transport lives in `packages/integrations/email/` (already planned). WhatsApp adapter already exists per the testing-setup design.

```
packages/notifications/
├── src/
│   ├── dispatcher.ts        # sendNotification(event) — public API
│   ├── channels/
│   │   ├── email.ts         # wraps EmailAdapter (Real/Stub) with 5s timeout
│   │   ├── in_app.ts        # inserts row into notifications table
│   │   └── whatsapp.ts      # wraps WhatsAppAdapter for approval links only
│   ├── templates/
│   │   ├── loader.ts        # reads .txt files, {{var}} interpolation
│   │   └── renderer.ts      # render(eventType, context) → {subject, body}
│   ├── repositories/
│   │   ├── notifications.ts    # CRUD on notifications table
│   │   └── preferences.ts      # CRUD on notification_preferences
│   ├── routes/
│   │   ├── list.ts          # GET /api/notifications
│   │   ├── mark-read.ts     # PATCH /api/notifications/:id/read
│   │   └── register.ts      # Fastify plugin
│   ├── triggers/
│   │   ├── drift.ts         # buildDriftEvent(...) → dispatcher.send(...)
│   │   ├── import.ts        # buildImportEvent(...) → dispatcher.send(...)
│   │   ├── login.ts         # buildLoginNewIpEvent(...) → dispatcher.send(...)
│   │   └── approval.ts      # buildApprovalLinkEvent(...) → dispatcher.send(...)
│   ├── errors.ts            # TemplateNotFoundError
│   └── index.ts             # public exports
├── templates/               # plain text templates, committed to repo
│   ├── drift_alert.txt
│   ├── import_completed.txt
│   ├── import_failed.txt
│   ├── login_new_ip.txt
│   └── approval_link_created.txt
├── package.json
└── vitest.config.ts
```

**Alternatives considered**: Put everything in `packages/integrations/notifications/` (the pattern of `packages/integrations/email/`), but that package is reserved for I/O adapters only. The dispatcher / preferences / API surface is a domain service — `packages/notifications/` is the screaming-architecture home. Inlining dispatcher into each caller (drift, import, login) — rejected: 5 triggers × 3 channels of fan-out + preferences + audit = too much logic to duplicate.

**Rationale**: Matches the existing `packages/services/<domain>` layout (e.g., `packages/import/`, `packages/approval/`). Co-locates the API routes with the dispatcher so a single package owns the full notification slice. Reuses the email adapter contract from the testing-setup design.

### Decision: Template Engine — Plain `{{var}}` Interpolation, No Library

**Choice**: Hand-rolled template loader. Each `.txt` file is read once at startup, cached in a `Map<eventType, string>`. Rendering uses a single regex `/{{\s*(\w+)\s*}}/g` and substitutes values from the context object. No Handlebars, EJS, or mustache — spec forbids them.

```typescript
// packages/notifications/src/templates/renderer.ts
const PLACEHOLDER = /{{\s*(\w+)\s*}}/g;

export function render(template: string, ctx: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => {
    if (!(key in ctx)) throw new TemplateNotFoundError(`Missing variable ${key}`);
    const v = ctx[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  });
}
```

**Alternatives considered**: Handlebars (spec forbids), EJS (overkill for 5 templates), loading templates on every send (file I/O per notification — wasteful for 50 templates/render). Hot-reload via `fs.watch` — rejected: dev-only, complicates the loader for zero production value.

**Rationale**: The spec mandates `{{varName}}` placeholders. A 5-line regex matches the requirement. Templates are read once at boot — no hot-reload, no FS watcher. Missing variables throw `TemplateNotFoundError` (matches the spec's "Missing template fails the send" scenario). No npm dep.

### Decision: SMTP Transport — `nodemailer.createTransport({ pool: true })` at Startup

**Choice**: A single SMTP transport instance is created during the email adapter factory call (one per process, singleton). Configuration uses `nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, pool: true, maxConnections: 3, maxMessages: 100, connectionTimeout: 5_000 })`. The `RealEmailAdapter` wraps this transport.

**Alternatives considered**: `pool: false` (single connection serializes all sends — bad for drift alerts that fan out to N admins in parallel), creating a new transport per send (expensive TLS handshake every time, breaks connection reuse). Verbatim config from spec (no `maxConnections`) — rejected: without pooling, 3 admins notified in parallel = 3 sequential handshakes.

**Rationale**: The spec mandates SMTP via nodemailer but is silent on pooling. `pool: true` with `maxConnections: 3` matches the typical load profile (a drift alert fans out to 2-3 admins; a failed import fans out to 2-3 admins + 1 operator). `connectionTimeout: 5_000` aligns with the spec's 5s per-channel delivery budget. The transport is created exactly once in the factory — no per-send cost.

### Decision: Dispatcher Entry Point — `sendNotification(event)` with Direct Import (No Event Bus)

**Choice**: The dispatcher is a regular TypeScript module exporting `async function sendNotification(event: NotificationEvent): Promise<void>`. Callers (drift-detector, import service, auth-login, approval-link) import the function and call it directly. The dispatcher returns `void` after the audit row is written — it never throws to the caller.

```typescript
// packages/notifications/src/dispatcher.ts
export type NotificationEvent =
  | { type: 'drift_alert'; eventId: string; metadata: { domain: string; count: number; affectedKeys: string[] } }
  | { type: 'import_completed'; eventId: string; operatorId: string; metadata: { domain: string; recordCount: number } }
  | { type: 'import_failed'; eventId: string; operatorId: string; metadata: { domain: string; errorCode: string; errorMessage: string } }
  | { type: 'login_new_ip'; eventId: string; operatorId: string; metadata: { ip: string; userAgent: string; occurredAt: string } }
  | { type: 'approval_link_created'; eventId: string; metadata: { approverAddress: string; approverChannel: 'whatsapp' | 'email'; approvalUrl: string } };

export async function sendNotification(event: NotificationEvent): Promise<void> { /* ... */ }
```

**Alternatives considered**: Event emitter (`emitter.on('drift', ...)`) — adds indirection, no value at this scale (5 event types, 1 listener per type). Message queue (BullMQ, Redis) — explicitly out of scope per spec. Dependency injection of the dispatcher into each caller — overkill; a function import is the simplest contract.

**Rationale**: Direct import keeps the dependency explicit. A single typed `NotificationEvent` union gives compile-time exhaustiveness — adding a new event type forces every `switch` to handle it. The function is async because the spec requires waiting for delivery + audit before returning from the originating request (or at least, allowing the caller to await it). Returning `Promise<void>` (never throwing) satisfies the spec's "MUST NOT throw to the caller" requirement.

### Decision: Sync vs Async Delivery — Caller `await`s, Dispatcher Fans Out In-Parallel with Per-Channel Timeout

**Choice**: `sendNotification` is `async` and the caller MUST `await` it. Inside the dispatcher, channels fan out via `Promise.allSettled` with `AbortController` per network call (email, WhatsApp). Database calls (in-app insert, audit insert) are NOT subject to the 5s timeout — they use the connection pool's natural latency.

```typescript
// pseudocode
async function sendNotification(event: NotificationEvent) {
  if (await isDuplicate(event.eventId)) { await audit('skipped', event); return; }

  const recipients = await resolveRecipients(event);     // 1 DB query
  const channels = await resolveChannels(event, recipients);  // preferences × role

  await Promise.allSettled(channels.map(ch => deliverWithTimeout(ch, 5_000)));
  // deliverWithTimeout catches all errors, writes audit row, never throws
}
```

**Alternatives considered**: `setImmediate` wrapper (fire-and-forget — caller doesn't await; spec mandates "synchronous delivery in the same request" so this violates the spec), `Promise.all` (fails fast on first error — spec requires "continue processing remaining channels").

**Rationale**: The spec mandates synchronous, in-request delivery with a 5s per-channel timeout. `Promise.allSettled` + `AbortController` honors that exactly: every channel gets a fair shot, failures don't short-circuit, and the caller's `await` returns only after all attempts complete. In-app inserts are local DB calls (<50ms typically) and not on the network timeout — the spec explicitly carves them out.

### Decision: Retry Strategy — None; Log and Move On

**Choice**: On any channel failure (SMTP error, timeout, WhatsApp 4xx), the dispatcher catches the error, writes a `failed` audit row, and continues. No retry, no exponential backoff, no dead-letter queue.

**Alternatives considered**: One automatic retry with 1s delay (cheap insurance against transient blips — but spec says "no retry queue, no dead-letter table"), retry-until-success (operationally dangerous — a misconfigured SMTP server would block the request thread for minutes).

**Rationale**: The spec explicitly forbids retry queues and dead-letter tables in v1. The system is small (one club, ~20 operators) and synchronous. A failure is logged to `audit_events` with the error message — operators can be re-notified manually if needed (e.g., re-trigger the import). Adding retries later is a non-breaking change to the dispatcher signature.

### Decision: Trigger Integration — Direct Function Call from Each Caller

**Choice**: Each caller imports `sendNotification` from `@athlos/notifications` and calls it at the appropriate point in its flow. No event bus, no listener registration. The dispatcher module is a leaf in the import graph — callers don't depend on a runtime registry.

| Caller | Trigger Point | Event Built By |
|--------|---------------|----------------|
| `packages/drift-detector` | After drift scan completes, when `findings.length > 0` | `triggers/drift.ts:buildDriftEvent(findings)` |
| `packages/import` | After `import_jobs.status` transitions to `completed` or `failed` | `triggers/import.ts:buildImportEvent(job, operatorId)` |
| `packages/auth` (login) | After successful login when `login_history` lookup returns no prior IP match | `triggers/login.ts:buildLoginNewIpEvent(operator, req.ip)` |
| `packages/auth` (approval) | After `approval_tokens` row is inserted | `triggers/approval.ts:buildApprovalLinkEvent(token, approver)` |

**Alternatives considered**: `EventEmitter` registered at app boot (loose coupling, but adds a hidden call site — testing must mock the emitter), domain events pattern (e.g., `drift:found` → all subscribers) — adds infrastructure for 5 events, no real value when each trigger has exactly one listener (the dispatcher).

**Rationale**: Direct call is the most readable, most testable, most debuggable option. A grep for `sendNotification(` finds every call site. Mocking the dispatcher in tests is one import swap. The 5 callers form a closed set known at design time — there is no future event subscriber that warrants an emitter.

### Decision: Idempotency — `notifications.metadata->>'eventId'` Lookup Before Send

**Choice**: Before any channel attempt, the dispatcher queries `SELECT 1 FROM notifications WHERE metadata->>'eventId' = $1 LIMIT 1`. If a row exists, the event is `skipped` and an audit row is written with `outcome='skipped'`. The unique lookup is the dedup key.

**Alternatives considered**: Unique index on `metadata->>'eventId'` (PostgreSQL would reject the second insert — but then we lose the "audit the skip" path because the insert throws before we can audit). Separate `notification_dedup` table (one more write per event, no benefit over checking the row directly).

**Rationale**: Spec is explicit: "When an `eventId` is provided and a notification with that `eventId` already exists, the dispatcher MUST skip the event." A SELECT-then-act pattern lets us write the `skipped` audit row before returning. The cost (one extra index lookup per dispatch) is negligible at our scale.

## Data Flow — Notifications

```
Drift Detector                Dispatcher                DB                SMTP
     │                            │                     │                  │
     │── sendNotification(        │                     │                  │
     │     driftEvent) ──────────►│                     │                  │
     │                            │── isDuplicate? ────►│                  │
     │                            │◄─ false ─────────────│                  │
     │                            │── resolveRecipients ►│                  │
     │                            │◄─ [admin1,admin2] ───│                  │
     │                            │── resolveChannels ──►│                  │
     │                            │◄─ [{email,admin1},  │                  │
     │                            │     {email,admin2}, │                  │
     │                            │     {in_app,admin1},│                  │
     │                            │     {in_app,admin2}]│                  │
     │                            │                     │                  │
     │                            │── Promise.allSettled:                  │
     │                            │   ├── email(admin1) ──────────────────►│
     │                            │   │   (5s timeout, catch errors)       │
     │                            │   ├── email(admin2) ──────────────────►│
     │                            │   ├── insert in_app(admin1) ─────────►│
     │                            │   ├── insert in_app(admin2) ─────────►│
     │                            │   └── 4× audit_events rows ──────────►│
     │                            │                     │                  │
     │◄─ void (never throws) ─────│                     │                  │
```

## File Changes — Notifications

| File | Action | Description |
|------|--------|-------------|
| `packages/notifications/package.json` | Create | Depends on `@athlos/db`, `@athlos/integrations-email`, `@athlos/integrations-whatsapp`, `nodemailer` |
| `packages/notifications/src/dispatcher.ts` | Create | `sendNotification(event)` — public entry point |
| `packages/notifications/src/channels/email.ts` | Create | Wraps `EmailAdapter` with 5s `AbortController` timeout |
| `packages/notifications/src/channels/in_app.ts` | Create | Inserts row into `notifications` table |
| `packages/notifications/src/channels/whatsapp.ts` | Create | Wraps `WhatsAppAdapter` for `approval_link_created` only |
| `packages/notifications/src/templates/loader.ts` | Create | Reads `templates/*.txt` at startup into `Map<eventType, string>` |
| `packages/notifications/src/templates/renderer.ts` | Create | `{{var}}` regex interpolation |
| `packages/notifications/src/repositories/notifications.ts` | Create | Drizzle queries: `insert`, `listForOperator`, `markRead`, `findByEventId` |
| `packages/notifications/src/repositories/preferences.ts` | Create | Drizzle queries: `seedDefaults`, `listEnabledForOperator` |
| `packages/notifications/src/repositories/audit.ts` | Create | Insert into `audit_events` (per spec) |
| `packages/notifications/src/routes/list.ts` | Create | `GET /api/notifications` + `?unread=true` filter + `unreadCount` |
| `packages/notifications/src/routes/mark-read.ts` | Create | `PATCH /api/notifications/:id/read` (idempotent) |
| `packages/notifications/src/routes/register.ts` | Create | Fastify plugin wires routes under `/api/notifications` |
| `packages/notifications/src/triggers/{drift,import,login,approval}.ts` | Create | `build*Event(...)` factories + thin wrappers around `sendNotification` |
| `packages/notifications/src/errors.ts` | Create | `TemplateNotFoundError`, `DuplicateEventError` |
| `packages/notifications/src/index.ts` | Create | Public exports: `sendNotification`, types, errors |
| `packages/notifications/templates/*.txt` | Create | 5 plain-text templates |
| `db/schema/notifications.sql` | Create | DDL for `notifications` table |
| `db/schema/notification_preferences.sql` | Create | DDL for `notification_preferences` table |
| `db/migrations/0008_notifications.sql` | Create | Migration for both tables |
| `packages/db/src/schema/notifications.ts` | Create | Drizzle schema |
| `packages/db/src/schema/notification_preferences.ts` | Create | Drizzle schema |
| `apps/api/src/container.ts` | Modify | Wire `dispatcher` with Real adapters + DB pool |
| `apps/api/src/server.ts` | Modify | Register `notificationsPlugin` after `authPlugin` |
| `packages/drift-detector/src/scan.ts` | Modify | Call `sendNotification(buildDriftEvent(findings))` on findings > 0 |
| `packages/import/src/service.ts` | Modify | Call `sendNotification(buildImportEvent(...))` on status transition |
| `packages/auth/src/login.ts` | Modify | After `login_history` lookup, call `sendNotification(buildLoginNewIpEvent(...))` |
| `packages/auth/src/approval-link.ts` | Modify | After `approval_tokens` insert, call `sendNotification(buildApprovalLinkEvent(...))` |
| `packages/integrations/email/src/real.ts` | Create | `RealEmailAdapter` with `nodemailer.createTransport({ pool: true })` + `send(to, subject, body, context)` |
| `packages/integrations/email/src/stub.ts` | Create | `StubEmailAdapter` with `__emailStub.messages` array (mirrors `StubWhatsAppAdapter`) |
| `packages/integrations/email/src/factory.ts` | Create | `emailAdapter(env)` → Stub in test, Real in prod; fail-fast on missing SMTP vars |
| `packages/integrations/email/src/adapter.ts` | Create | `EmailAdapter` interface (`send(to, subject, body, context): Promise<{ messageId: string }>`) |
| `packages/integrations/email/package.json` | Create | Deps: `nodemailer` |
| `vitest.setup.ts` (root) | Modify | `process.env.SMTP_HOST = 'localhost'` no-op; `NODE_ENV='test'` already routes to stubs |

## Interfaces / Contracts — Notifications

### `notifications` Table

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('drift_alert','import_completed','import_failed','login_new_ip','approval_link_created')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_notifications_operator_created
  ON notifications (operator_id, created_at DESC);
CREATE INDEX idx_notifications_eventid
  ON notifications ((metadata->>'eventId'))
  WHERE metadata->>'eventId' IS NOT NULL;
```

### `notification_preferences` Table

```sql
CREATE TABLE notification_preferences (
  operator_id UUID NOT NULL REFERENCES operators(id),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','in_app','whatsapp')),
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (operator_id, event_type, channel)
);
CREATE INDEX idx_notif_prefs_operator ON notification_preferences (operator_id);
```

### `EmailAdapter` Interface

```typescript
// packages/integrations/email/src/adapter.ts
export interface EmailAdapter {
  send(to: string, subject: string, body: string, context: Record<string, unknown>): Promise<{ messageId: string }>;
}
```

### `StubEmailAdapter`

```typescript
// packages/integrations/email/src/stub.ts
export class StubEmailAdapter implements EmailAdapter {
  public readonly __emailStub = {
    messages: [] as Array<{ to: string; subject: string; body: string; context: Record<string, unknown>; sentAt: Date }>
  };
  async send(to, subject, body, context) {
    this.__emailStub.messages.push({ to, subject, body, context, sentAt: new Date() });
    return { messageId: `stub-email-${this.__emailStub.messages.length}` };
  }
}
```

### Email Factory

```typescript
// packages/integrations/email/src/factory.ts
import { RealEmailAdapter } from './real.js';
import { StubEmailAdapter } from './stub.js';
import type { EmailAdapter } from './adapter.js';

export function emailAdapter(env: NodeJS.ProcessEnv): EmailAdapter {
  if (env.NODE_ENV === 'test') return new StubEmailAdapter();
  const required = ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','FROM_ADDRESS'];
  for (const k of required) {
    if (!env[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return new RealEmailAdapter({
    host: env.SMTP_HOST!,
    port: Number(env.SMTP_PORT),
    user: env.SMTP_USER!,
    pass: env.SMTP_PASS!,
    from: env.FROM_ADDRESS!,
  });
}
```

### Dispatcher Signature

```typescript
// packages/notifications/src/dispatcher.ts
export type NotificationEvent =
  | { type: 'drift_alert'; eventId: string; metadata: { domain: string; count: number; affectedKeys: string[] } }
  | { type: 'import_completed'; eventId: string; operatorId: string; metadata: { domain: string; recordCount: number } }
  | { type: 'import_failed'; eventId: string; operatorId: string; metadata: { domain: string; errorCode: string; errorMessage: string } }
  | { type: 'login_new_ip'; eventId: string; operatorId: string; metadata: { ip: string; userAgent: string; occurredAt: string } }
  | { type: 'approval_link_created'; eventId: string; metadata: { approverAddress: string; approverChannel: 'whatsapp' | 'email'; approvalUrl: string } };

export async function sendNotification(event: NotificationEvent): Promise<void>;
```

### API Routes

```typescript
// packages/notifications/src/routes/list.ts
// GET /api/notifications?unread=true
// Returns: { rows: Notification[], unreadCount: number }
// Auth: requires operator; filters by request.operator.id

// packages/notifications/src/routes/mark-read.ts
// PATCH /api/notifications/:id/read
// 204 No Content (idempotent). 404 if notification.operator_id !== request.operator.id
```

## Testing Strategy — Notifications

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `render()` substitutes `{{var}}` correctly | Vitest: `render('Drift in {{domain}}: {{count}}', {domain:'ctacte', count:5})` → `'Drift in ctacte: 5'` |
| Unit | `render()` throws on missing key | Vitest: `render('{{x}}', {})` → throws `TemplateNotFoundError` |
| Unit | `loadTemplates()` reads all 5 .txt files at boot | Vitest: seed fixtures dir, call loader, assert 5 keys |
| Unit | `StubEmailAdapter.send()` records to `__emailStub.messages` | Vitest: send, assert array length, fields match |
| Unit | `emailAdapter(env)` returns Stub in test | Vitest: `NODE_ENV='test'` → Stub; with unset SMTP vars |
| Unit | `emailAdapter(env)` throws on missing SMTP var in prod | Vitest: `NODE_ENV='production'`, no `SMTP_HOST` → throws |
| Unit | Dispatcher isDuplicate: returns true on existing eventId | Vitest: seed `notifications.metadata->>eventId`, dispatch, assert no channel call |
| Unit | Dispatcher fans out to N recipients for drift | Vitest: 2 admins with email+in_app, dispatch drift → 2 emails + 2 in-app rows |
| Unit | Dispatcher filters by role (drift = ADMIN only) | Vitest: op1=OPERATOR with email=true for drift_alert → 0 sends |
| Unit | Dispatcher filters by preferences | Vitest: admin1 with email=false for drift_alert → 0 emails, 1 in-app |
| Unit | Dispatcher channel failure does not break call | Vitest: mock `EmailAdapter.send` to throw, dispatch → returns void, in-app row still inserted, audit row `failed` written |
| Unit | Dispatcher 5s timeout aborts hanging send | Vitest: mock adapter that never resolves, dispatch → `SMTP_TIMEOUT` error in audit |
| Unit | Approval link routes to WhatsApp when `approver_channel='whatsapp'` | Vitest: dispatch approval event with channel='whatsapp' → `WhatsAppAdapter.send` called, no email |
| Unit | Approval link routes to email when `approver_channel='email'` | Vitest: dispatch with channel='email' → `RealEmailAdapter` called, no WhatsApp |
| Integration | `GET /api/notifications` returns only auth operator's rows | Testcontainers + Drizzle: seed 2 operators' rows, GET as op1 → op2 rows absent |
| Integration | `GET /api/notifications?unread=true` filters | Integration: seed 3 rows (1 unread), assert 1 returned |
| Integration | `PATCH /api/notifications/:id/read` is idempotent | Integration: PATCH twice → 204 both times, `read_at` unchanged |
| Integration | PATCH on another operator's notification → 404 | Integration: op1 PATCHes op2's notif → 404, op2's row unchanged |
| Integration | Drift-detector end-to-end → email + in-app row | Integration: trigger drift scan, assert `__emailStub.messages.length === 2`, `notifications` row count === 2 |
| Integration | Failed import → ADMINs emailed + triggering op in-app | Integration: op1 triggers import that fails, assert admins receive email, op1 has in-app |
| E2E | Login from new IP triggers email | Playwright: login from mocked IP not in `login_history`, assert email recorded |
| E2E | Approval link end-to-end via WhatsApp | Playwright: create approval link, assert WhatsApp adapter called with rendered URL |

## Migration / Rollback — Notifications

**Migration**: Run `0008_notifications.sql` to create `notifications` + `notification_preferences` tables. Add a one-time seed job that runs after operator migration: for every existing operator, insert default preferences (per the spec's seed rules — admins get all email, non-admins get `login_new_ip` email only, all get in_app for all 5 events, no one gets WhatsApp).

**Rollback**: Drop both tables. Remove `notificationsPlugin` from `apps/api/src/server.ts`. Remove the `sendNotification(...)` calls from drift-detector / import / auth. Existing functionality (drift scanning, import execution, login, approval) continues to work without notifications — the call sites are additive. The `audit_events` table already exists; no DDL needed for audit logging.

## Open Questions — Notifications

- [ ] Should `metadata` be `JSONB` with a schema-validated shape per `event_type`, or free-form JSON? Currently free-form; a Zod schema per event type would catch silent contract breaks at insert time.
- [ ] When the dispatcher times out (5s) on email, is the in-app row still inserted, or should both be in the same `Promise.allSettled` batch (spec scenario says in-app still happens)? Currently in the same batch — confirm interpretation.
- [ ] Should the `notifications` table be partitioned by `created_at` (monthly partitions) for retention? At 20 operators and ~5 events/day, partitioning is unnecessary for years — defer.
- [ ] For `login_new_ip`, the spec says "zero in-app rows" — should the dispatcher still attempt the in-app insert (which becomes a no-op) or skip the channel lookup entirely? Currently skipped via the `resolveChannels` function returning only `email` for `login_new_ip`.
- [ ] `FROM_ADDRESS` is the env var name in the spec, but `config/env.ts` already uses `SMTP_FROM` (line 979 of the existing design). Should we rename the env var to `SMTP_FROM` to match the existing convention, or keep `FROM_ADDRESS` per the spec text?

---

## Caching Design

### Decision: Cache Layers — Three-Layer Model, Server Cache Out of Scope v1

**Choice**: Three explicit cache layers with strict ownership: (1) **Client** — TanStack Query in-memory cache, owned by the browser tab, lifetime until tab close or explicit invalidation; (2) **Server** — NONE in v1 (no Redis, no in-process LRU, no Node-cache); (3) **Database** — PostgreSQL's built-in shared buffer cache + prepared statement cache, implicit, no app config.

**Alternatives considered**: Adding an in-process `node-cache` or `lru-cache` layer for hot read endpoints (introduces a stale-data class of bugs for a club-scale app — 20 operators, not 20k), adding Redis for cross-instance cache sharing (we run a single API instance in v1 — no sharing problem to solve).

**Rationale**: Freshness is the dominant requirement for Athlos. The legacy `SOCSALDO` / `CCTSALDO` corruption problems in the existing dBase system trace to over-eager server-side caching. v1 explicitly forbids server-side caching so a future contributor cannot re-introduce the failure mode by accident. The spec's `MUST NOT` clauses on server cache become architectural guardrails. If a future phase needs server cache, the spec mandates a new capability (`server-cache/spec.md`) — preventing silent scope creep.

### Decision: Client Cache Library — TanStack Query as Single Source of Truth

**Choice**: TanStack Query (React Query) v5 is the ONLY client-side cache for server state. No Redux, Zustand, MobX, SWR, or Apollo. All server reads go through `useQuery` / `useSuspenseQuery`. Components MUST NOT use `useEffect` + `fetch` + `useState` for server data.

**Alternatives considered**: SWR (less mature mutation/invalidation API, weaker TypeScript inference for keyed queries), Apollo Client (overkill — REST API, no GraphQL), Redux Toolkit Query (extra mental model, RTK store duplicates concerns).

**Rationale**: TanStack Query's hierarchical key-based invalidation, `staleTime` / `gcTime` lifecycle, and `refetchOnWindowFocus` are the dominant patterns for React data fetching. Its TypeScript inference on `queryKey` / `queryFn` generics gives end-to-end type safety from key to response shape. A single cache owner means no synchronization bugs between libraries.

### Decision: QueryClient Factory — `createQueryClient()` in `apps/web/src/lib/query-client.ts`

**Choice**: Export a `createQueryClient()` factory that returns a configured `QueryClient` instance with global defaults: `refetchOnWindowFocus: true`, `retry: 3` (with exponential backoff + jitter, see decision below), and sensible default `staleTime` / `gcTime` for resources that have NO per-resource override. `apps/web/src/main.tsx` calls the factory once at bootstrap and passes the result to `<QueryClientProvider>`. Application code MUST NOT construct `new QueryClient()` ad hoc.

```typescript
// apps/web/src/lib/query-client.ts
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Global default; per-resource defaults applied via queryKeys factory
        staleTime: 60_000,             // 1 minute fallback
        gcTime: 5 * 60_000,            // 5 minutes fallback
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Don't retry 4xx; do retry network/5xx
          if (error instanceof ApiError && error.statusCode < 500) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt) =>
          Math.min(4_000, 1_000 * 2 ** attempt) + Math.random() * 250,
      },
      mutations: {
        retry: (failureCount, error) => {
          // Mutations retry ONLY on network failure (not 4xx/5xx)
          if (error instanceof ApiError) return false;
          return failureCount < 1;
        },
      },
    },
  });
}
```

**Alternatives considered**: Module-level singleton (`export const queryClient = new QueryClient()` — makes testing and SSR harder, no way to construct fresh per request), per-component construction (violates spec, scatters config), defining defaults inside `queryKeys.*` factory functions only (works for `staleTime` but not for `refetchOnWindowFocus` which is a top-level default).

**Rationale**: The factory pattern keeps all client cache defaults in ONE file, making the `staleTime` table, retry policy, and focus refetch auditable in one read. The `retry` predicate using `ApiError` shape (already defined in the error handling design) prevents 4xx error storms. Exponential backoff with jitter prevents thundering herd if the API has a transient blip.

### Decision: Per-Resource Stale Time Table — Centralized Constants in `queryKeys.ts`

**Choice**: Per-resource `staleTime` / `gcTime` values are declared as `const` objects in `apps/web/src/lib/query-keys.ts`, co-located with the query key factory functions. Each `queryKeys.*` function returns `{ queryKey, staleTime, gcTime }` rather than a bare key array, so consumers cannot accidentally use a bare key with the wrong default.

```typescript
// apps/web/src/lib/query-keys.ts
export const STALE_TIMES = {
  parametros:      { staleTime: 60 * 60_000,    gcTime: 24 * 60 * 60_000 },
  catalogos:       { staleTime: 60 * 60_000,    gcTime: 24 * 60 * 60_000 },
  sociosList:      { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },
  socioDetail:     { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },
  ctacteSaldo:     { staleTime: 30_000,         gcTime: 5 * 60_000 },
  ctacte1:         { staleTime: 30_000,         gcTime: 5 * 60_000 },
  contable:        { staleTime: 60_000,         gcTime: 10 * 60_000 },
  caja:            { staleTime: 30_000,         gcTime: 5 * 60_000 },
  proyecciones:    { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },
  lineage:         { staleTime: Infinity,       gcTime: 24 * 60 * 60_000 },
  freshness:       { staleTime: 0,              gcTime: 60_000 },
  auditLog:        { staleTime: 0,              gcTime: 5 * 60_000 },
  users:           { staleTime: 60_000,         gcTime: 10 * 60_000 },
  authMe:          { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },
} as const;

export const queryKeys = {
  parametros: () => ({ queryKey: ['parametros'] as const, ...STALE_TIMES.parametros }),
  catalogos: (name: string) => ({ queryKey: ['catalogos', name] as const, ...STALE_TIMES.catalogos }),
  socios: {
    list: (filters?: SocioFilters) => ({
      queryKey: ['socios', 'list', normalizeFilters(filters)] as const,
      ...STALE_TIMES.sociosList,
    }),
    detail: (id: SocioId) => ({ queryKey: ['socios', 'detail', id] as const, ...STALE_TIMES.socioDetail }),
  },
  ctacte: {
    saldo: (socioId: SocioId) => ({ queryKey: ['ctacte', 'saldo', socioId] as const, ...STALE_TIMES.ctacteSaldo }),
  },
  // ... etc.
} as const;
```

**Alternatives considered**: Spread `staleTime` per `useQuery` call at every component (200+ sites, drift inevitable, code review nightmare), store defaults in a separate `stale-times.ts` file separate from key factory (forces two imports per query, splits related concerns), per-resource `QueryClient` instances (TanStack Query does not support this — one client per app).

**Rationale**: Co-locating key shape and stale time in the factory means a refactor (renaming `'socios'` → `'partners'`, changing ctacte `staleTime` from 30s to 1min) is a single-file change. Returning a bundle (not just the key) makes the "right default" the path of least resistance — `useQuery(queryKeys.socios.detail(id))` Just Works, and the per-resource rationale (line 86-92 of the spec) is documented in the file that enforces it.

### Decision: Filter Normalization — Stable Key Ordering via Alphabetical Sort

**Choice**: Filter objects passed to `queryKeys.*.list(...)` are normalized before inclusion in the key: object keys are sorted alphabetically (deep), `Date` instances are converted to ISO strings, arrays are preserved in their given order. The normalized shape is the cache key input.

```typescript
function normalizeFilters<T extends Record<string, unknown>>(filters?: T): T | undefined {
  if (!filters) return undefined;
  return Object.keys(filters)
    .sort()
    .reduce((acc, k) => {
      const v = filters[k];
      acc[k as keyof T] = v instanceof Date ? v.toISOString() : v;
      return acc;
    }, {} as T);
}
```

**Alternatives considered**: Pass filters as-is (cache misses when `{ estado: 'activo' }` vs `{ estado: 'activo' }` happens to have different property order — extremely subtle bug), JSON-stringify the filters (same bug, plus harder to inspect in DevTools), use TanStack Query's `queryKeyHashFn` (works but hides the normalization from the visible key — debuggability cost).

**Rationale**: Same filter object with different property order MUST produce the same cache key (spec line 297-298). Alphabetical sort is the simplest deterministic transform. DevTools still shows the normalized object — the developer can read the key and understand what's cached.

### Decision: Mutation Invalidation — Targeted, Never Global

**Choice**: Every `useMutation` has an `onSuccess` handler that calls `queryClient.invalidateQueries(...)` with the SMALLEST correct key set. `queryClient.invalidateQueries()` (no arguments = global) is FORBIDDEN except for: (a) logout, (b) config reload. Mutation hooks live in `apps/web/src/features/<domain>/mutations.ts` and import `queryClient` from the provider context.

```typescript
// apps/web/src/features/ctacte/mutations.ts
export function useRegistrarPago() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegistrarPagoInput) => api.post('/ctacte/pagos', input),
    onSuccess: (_, { socioId }) => {
      // Targeted: saldo for this socio, movements for this socio
      queryClient.invalidateQueries({ queryKey: ['ctacte', 'saldo', socioId] });
      queryClient.invalidateQueries({ queryKey: ['ctacte1', socioId] });
      queryClient.invalidateQueries({ queryKey: ['ctacte1', 'list', socioId] });
    },
  });
}
```

**Alternatives considered**: A `useApiMutation()` wrapper that auto-invalidates by URL convention (magic — hard to reason about, easy to mis-invalidate), invalidation via the API response header `X-Invalidate-Query-Keys` (server-driven, clever, but couples server to client cache shape — bad layering).

**Rationale**: The spec says invalidation is the frontend's responsibility and MUST be targeted. A per-mutation explicit `invalidateQueries` is auditable in code review: "did the developer list the right keys?" Each mutation file is small, focused, and the invalidation set is right next to the mutation it pairs with.

### Decision: Logout Clears All Cache — `queryClient.clear()`

**Choice**: A dedicated `useLogout()` mutation calls `queryClient.clear()` on success, then `authClient.logout()`. This wipes the entire cache, including any PII cached from the previous user. The next user on the same browser cannot see previous socio data on accidental remounts.

```typescript
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      queryClient.clear();             // wipe ALL cached data
      navigate('/login', { replace: true });
    },
  });
}
```

**Alternatives considered**: `queryClient.removeQueries()` (finer-grained, but easy to miss a sensitive key — `clear()` is the only safe option), per-user cache partitioning (complex, requires auth context to scope keys, v1 doesn't need it).

**Rationale**: The spec mandates that PII MUST be cleared on logout (spec line 393-407). `clear()` is the only operation that guarantees no residue. The cost is the next login re-fetches from scratch — acceptable.

### Decision: Cross-Tab Sync — BroadcastChannel API

**Choice**: A `useCrossTabInvalidation()` hook (mounted once in `App.tsx`) opens a `BroadcastChannel('athlos-cache')` and listens for `{ type: 'invalidate', queryKey: K }` messages. When the local tab mutates a resource, it broadcasts a `queryClient.invalidateQueries(...)` call AND posts a message; the message makes OTHER tabs of the same origin run the same invalidation.

```typescript
// apps/web/src/lib/cross-tab.ts
export function useCrossTabInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return; // Safari < 15.4
    const channel = new BroadcastChannel('athlos-cache');
    channel.onmessage = (event) => {
      if (event.data?.type === 'invalidate') {
        queryClient.invalidateQueries({ queryKey: event.data.queryKey });
      }
    };
    return () => channel.close();
  }, [queryClient]);
}

// Wrapped invalidate that also broadcasts
export function broadcastInvalidate(
  queryClient: QueryClient,
  channel: BroadcastChannel,
  queryKey: QueryKey,
) {
  queryClient.invalidateQueries({ queryKey });
  channel.postMessage({ type: 'invalidate', queryKey });
}
```

**Alternatives considered**: `storage` event on `localStorage` (works cross-tab, but pollutes localStorage with cache-control keys, requires a key namespace reservation, harder to type-safely structure the payload), `window.postMessage` (cross-origin but not the right tool for same-origin tabs), `SharedWorker` (heavier — overkill for invalidation events).

**Rationale**: BroadcastChannel is purpose-built for same-origin cross-tab pub/sub. It has zero setup cost, no localStorage pollution, structured payload (JSON-serializable), and is supported in all evergreen browsers (Chrome 54+, Firefox 38+, Safari 15.4+). Edge case: if a user has the app open in two tabs and mutates in tab A, tab B receives the invalidation broadcast and refetches — keeps the UX consistent without manual refresh.

### Decision: Drift Detection & Import Completion Invalidation — Hook Bridge

**Choice**: A `useDriftInvalidator()` hook subscribes to the freshness API (polling every 30s; v1 has no WebSocket). When `freshness[domain]` transitions from `stale` → `current` OR when a drift event is reported, the hook invalidates the affected keys. A `useImportCompletionInvalidator()` hook does the same for import completion events from the freshness API.

```typescript
export function useDriftInvalidator() {
  const queryClient = useQueryClient();
  const { data: freshness } = useFreshness();
  const prev = usePrevious(freshness);
  useEffect(() => {
    if (!freshness || !prev) return;
    for (const [domain, status] of Object.entries(freshness)) {
      if (prev[domain] === 'stale' && status === 'current') {
        // Drift was fixed; invalidate all queries for this domain
        queryClient.invalidateQueries({ queryKey: [domain] });
        toast.info(`Drift fixed in ${domain.toUpperCase()} — data refreshed`);
      }
    }
  }, [freshness, prev, queryClient]);
}
```

**Alternatives considered**: Server-pushed WebSocket invalidation (premature — requires WS infra, not in v1 spec), polling at the component level (drift logic scattered across features).

**Rationale**: Centralizing drift and import-completion invalidation in two top-level hooks means every screen benefits without duplication. The hooks mount once in `App.tsx` and are invisible to feature code. The `usePrevious` pattern catches transitions; a fresh-fetched `stale → stale` is a no-op.

### Decision: Persistence — In-Memory Only, No `persistQueryClient`

**Choice**: v1 does NOT use `@tanstack/react-query-persist-client` or any localStorage/sessionStorage cache layer. Cache is in-memory only and is lost on full page reload. v1's UX requirement (operators do most work in a single session, browser refresh is rare) does not justify the complexity.

**Alternatives considered**: `persistQueryClient` with localStorage adapter (faster "warm" loads — but cache poisoning risk: stale data persists across logout, a logged-out user reopening the browser could see cached PII; the spec mandates `clear()` on logout but `persistQueryClient` rehydrates BEFORE logout can run on a fresh tab), sessionStorage adapter (lost on tab close, doesn't help the "warm reload" use case meaningfully).

**Rationale**: The spec calls out that sensitive PII MAY be cached in TanStack Query because the cache is per-tab (line 393). `persistQueryClient` would break this invariant — the cache would survive tab close, and a different user opening the same browser would see residual PII until the first mutation cleared the relevant key. The audit-log `staleTime: 0` + `gcTime: 5min` shows the spec already accepts the cost of re-fetching on reload for sensitive data. v1 is single-tab, single-user-per-browser — in-memory is the correct cache lifetime. If a future phase introduces true multi-user-per-browser requirements, re-evaluate.

### Decision: Server-Side Cache Stance — Documented, Configurable Ban

**Choice**: No server-side cache is added in v1. This is enforced by: (1) no cache libraries in `apps/api/package.json` (`node-cache`, `lru-cache`, `ioredis`, `cache-manager` are FORBIDDEN); (2) a `scripts/check-no-server-cache.sh` CI script that greps for these import strings and fails the build if found; (3) a comment block in `apps/api/src/server.ts` at the top of the bootstrap file explaining the v1 stance and pointing to the future `server-cache` capability spec.

```typescript
// apps/api/src/server.ts
// ============================================================================
// V1 CACHING STANCE: This server MUST NOT introduce any in-memory or external
// cache layer. Every read endpoint SHALL query PostgreSQL on every call.
// Freshness > latency. If a future phase needs server-side caching, create
// a new capability spec (server-cache/spec.md) per the caching spec's
// "Future Server Cache Requires Re-spec" requirement. CI enforces this via
// scripts/check-no-server-cache.sh.
// ============================================================================
```

**Alternatives considered**: Soft-ban via code review (insufficient — relies on reviewer attention for every PR, easy to slip in), custom ESLint rule (catches imports but not `Map`-based ad-hoc caches), npm dependency allowlist (overkill, blocks legitimate deps).

**Rationale**: A shell-script CI gate is a 30-line artifact that catches 100% of import-based cache introductions. Combined with a top-of-file comment that explains WHY (so a future contributor understands the constraint isn't arbitrary), the stance is durable across team turnover. The `Map`-based ad-hoc cache case is covered by the spec's "every read SHALL execute its query" requirement — code review handles it.

### Decision: Stale-While-Revalidate — Default Behavior, No Loading Spinner

**Choice**: TanStack Query's default behavior is SWR: when a component mounts with a stale cached entry, the cached data is shown immediately and a background refetch fires. The global `staleTime` defaults ensure that long-stale resources (padrones, parametros) use SWR naturally. Components MUST NOT set `placeholderData: keepPreviousData` artificially — that's for list pagination, not for cache hits.

**Alternatives considered**: Disable SWR globally (`staleTime: 0` everywhere — defeats the purpose of caching), explicit `useSuspenseQuery` everywhere (forces a Suspense boundary per query — heavier pattern, doesn't match the spec's UX requirement of "MUST NOT see a loading spinner for data they already have").

**Rationale**: The spec is explicit (line 331): "The user MUST NOT see a loading spinner for data they already have." TanStack Query's default behavior does this for free as long as `staleTime` is set correctly per resource. No custom code needed.

### Decision: What MUST NOT Be Cached — Three Explicit Exclusions

**Choice**: Three categories are explicitly excluded from the TanStack Query cache:

1. **Auth tokens** (JWT access + refresh) — NEVER stored in TanStack Query, localStorage, or sessionStorage. Tokens live in httpOnly secure cookies (set by `/api/auth/login`) or in-memory. Code review rejects any `queryKey: ['auth', 'token', ...]`.

2. **Approval tokens** — read from URL fragment ONLY at the moment of use, never persisted. The approval page reads `window.location.hash`, posts to `/api/approval/{token}`, and discards.

3. **Saldo (account balance)** — cached in the client (UI displays it), but MUST NEVER be cached server-side. This is the projection-engine contract; the API always recomputes from `raw_ctacte` rows. The query key `['ctacte', 'saldo', socioId]` has `staleTime: 30s` so the client also enforces freshness.

**Alternatives considered**: Allow tokens in `queryClient` (security disaster — XSS exfiltration), allow approval tokens in `sessionStorage` (one-tap convenience, but the spec is explicit: "treated as a security bug"), allow server-side `saldo` cache (the entire reason for the projection-engine refactor — re-introduces legacy `SOCSALDO` corruption).

**Rationale**: Each exclusion has a documented security or correctness consequence. The saldo exclusion ties back to the projection-engine spec — caching balances server-side is the legacy failure mode Athlos exists to prevent. The token exclusions are non-negotiable security constraints. Putting them in the design (not just the spec) makes the rationale visible to anyone reading the design.

## Data Flow — Caching

```
Component Mount
       │
       ▼
useQuery(queryKeys.socios.detail(id))
       │
       ├── Cache HIT, fresh ─────► render cached data
       │                            (staleTime not elapsed)
       │
       ├── Cache HIT, stale ─────► render cached data immediately
       │                            (SWR) ──► background refetch
       │                            ──► re-render on success
       │
       ├── Cache HIT, stale + useMutation invalidates
       │                          ──► mark stale ──► next mount refetches
       │
       └── Cache MISS ──────────► show loading state
                                    ──► fetch ──► cache ──► render

Cross-tab flow:
Tab A mutation succeeds ──► broadcastInvalidate(['ctacte', 'saldo', 123])
                                    │
                                    ├── local: queryClient.invalidateQueries(...)
                                    │
                                    └── BroadcastChannel ──► Tab B
                                                                   │
                                                                   └── onmessage ──► queryClient.invalidateQueries(...)

Drift flow:
Freshness API poll (30s) ──► ['ctacte']: stale → current
                                    │
                                    └── useDriftInvalidator ──► queryClient.invalidateQueries({ queryKey: ['ctacte'] })
                                                                   ──► toast: "Drift fixed in CTACTE"
                                                                   ──► all ctacte queries refetch on next access
```

## File Changes — Caching Addition

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/lib/query-client.ts` | Create | `createQueryClient()` factory with global defaults, retry predicates |
| `apps/web/src/lib/query-keys.ts` | Create | `queryKeys` factory + `STALE_TIMES` constants + `normalizeFilters` |
| `apps/web/src/lib/cross-tab.ts` | Create | `BroadcastChannel` pub/sub + `useCrossTabInvalidation` hook + `broadcastInvalidate` helper |
| `apps/web/src/lib/drift-invalidator.ts` | Create | `useDriftInvalidator` + `useImportCompletionInvalidator` hooks |
| `apps/web/src/main.tsx` | Modify | Call `createQueryClient()`, mount `useCrossTabInvalidation` + `useDriftInvalidator` in `App.tsx` |
| `apps/web/src/App.tsx` | Modify | Wrap tree with `<QueryClientProvider>`, mount global invalidation hooks |
| `apps/web/src/features/auth/useLogout.ts` | Create | Logout mutation with `queryClient.clear()` |
| `apps/web/src/features/ctacte/mutations.ts` | Create | Example mutation hooks (useRegistrarPago, etc.) with targeted invalidation |
| `apps/web/src/features/socios/mutations.ts` | Create | Socio CRUD mutations with targeted invalidation |
| `apps/web/src/features/import/mutations.ts` | Create | Import trigger mutation with broad invalidation (imports affect many domains) |
| `apps/api/src/server.ts` | Modify | Add top-of-file v1 caching stance comment block |
| `scripts/check-no-server-cache.sh` | Create | CI script: greps for forbidden cache imports in `apps/api` |
| `.github/workflows/ci.yml` | Modify | Add step: `bash scripts/check-no-server-cache.sh` |
| `apps/web/src/lib/README.md` | Create | Documents the lib/ module: how to add a new query key, how to override staleTime |

## Interfaces / Contracts — Caching

### `STALE_TIMES` table (reference)

```typescript
// apps/web/src/lib/query-keys.ts
export const STALE_TIMES = {
  parametros:      { staleTime: 60 * 60_000,    gcTime: 24 * 60 * 60_000 }, // 1h / 24h
  catalogos:       { staleTime: 60 * 60_000,    gcTime: 24 * 60 * 60_000 }, // 1h / 24h
  sociosList:      { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },      // 5min / 1h
  socioDetail:     { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },      // 5min / 1h
  ctacteSaldo:     { staleTime: 30_000,         gcTime: 5 * 60_000 },       // 30s / 5min
  ctacte1:         { staleTime: 30_000,         gcTime: 5 * 60_000 },       // 30s / 5min
  contable:        { staleTime: 60_000,         gcTime: 10 * 60_000 },      // 1min / 10min
  caja:            { staleTime: 30_000,         gcTime: 5 * 60_000 },       // 30s / 5min
  proyecciones:    { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },      // 5min / 1h
  lineage:         { staleTime: Infinity,       gcTime: 24 * 60 * 60_000 }, // ∞ / 24h
  freshness:       { staleTime: 0,              gcTime: 60_000 },           // 0 / 1min
  auditLog:        { staleTime: 0,              gcTime: 5 * 60_000 },       // 0 / 5min
  users:           { staleTime: 60_000,         gcTime: 10 * 60_000 },      // 1min / 10min
  authMe:          { staleTime: 5 * 60_000,     gcTime: 60 * 60_000 },      // 5min / 1h
} as const;
```

### `queryKeys` factory (reference)

```typescript
// apps/web/src/lib/query-keys.ts
import type { SocioId, Ejercicio, ISODate } from '@athlos/shared';

export interface SocioFilters { estado?: 'activo' | 'baja'; search?: string; }
export interface CtacteFilters { desde?: ISODate; hasta?: ISODate; }

export const queryKeys = {
  parametros: () => ({ queryKey: ['parametros'] as const, ...STALE_TIMES.parametros }),
  catalogos: (name: string) => ({ queryKey: ['catalogos', name] as const, ...STALE_TIMES.catalogos }),

  socios: {
    list: (filters?: SocioFilters) => ({
      queryKey: ['socios', 'list', normalizeFilters(filters)] as const,
      ...STALE_TIMES.sociosList,
    }),
    detail: (id: SocioId) => ({ queryKey: ['socios', 'detail', id] as const, ...STALE_TIMES.socioDetail }),
  },

  ctacte: {
    saldo: (socioId: SocioId) => ({
      queryKey: ['ctacte', 'saldo', socioId] as const,
      ...STALE_TIMES.ctacteSaldo,
    }),
  },

  ctacte1: {
    list: (socioId: SocioId, filters?: CtacteFilters) => ({
      queryKey: ['ctacte1', 'list', socioId, normalizeFilters(filters)] as const,
      ...STALE_TIMES.ctacte1,
    }),
  },

  contable: {
    list: (ejercicio: Ejercicio) => ({
      queryKey: ['contabl1', 'list', ejercicio] as const,
      ...STALE_TIMES.contable,
    }),
  },

  caja: {
    list: (filters?: { cajaId?: number; desde?: ISODate }) => ({
      queryKey: ['caja', 'list', normalizeFilters(filters)] as const,
      ...STALE_TIMES.caja,
    }),
  },

  proyecciones: {
    byDomain: (domain: string) => ({
      queryKey: ['proyecciones', domain] as const,
      ...STALE_TIMES.proyecciones,
    }),
  },

  lineage: (resource: string, id: string | number) => ({
    queryKey: ['lineage', resource, id] as const,
    ...STALE_TIMES.lineage,
  }),

  freshness: {
    all: () => ({ queryKey: ['freshness'] as const, ...STALE_TIMES.freshness }),
    byDomain: (domain: string) => ({
      queryKey: ['freshness', domain] as const,
      ...STALE_TIMES.freshness,
    }),
  },

  auditLog: (filters?: { usuario?: string; desde?: ISODate }) => ({
    queryKey: ['audit-log', normalizeFilters(filters)] as const,
    ...STALE_TIMES.auditLog,
  }),

  auth: {
    me: () => ({ queryKey: ['auth', 'me'] as const, ...STALE_TIMES.authMe }),
  },

  users: {
    list: (filters?: { rol?: string }) => ({
      queryKey: ['users', 'list', normalizeFilters(filters)] as const,
      ...STALE_TIMES.users,
    }),
  },
} as const;
```

### `createQueryClient` (reference)

```typescript
// apps/web/src/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@athlos/shared';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.statusCode < 500) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt) =>
          Math.min(4_000, 1_000 * 2 ** attempt) + Math.random() * 250,
      },
      mutations: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError) return false;
          return failureCount < 1;
        },
      },
    },
  });
}
```

### CI no-server-cache gate (reference)

```bash
#!/usr/bin/env bash
# scripts/check-no-server-cache.sh
# Fails CI if apps/api imports a cache library (v1 stance: no server-side cache).
set -euo pipefail

FORBIDDEN=('node-cache' 'lru-cache' 'ioredis' 'cache-manager' 'redis' 'memcached')
PATTERN=$(printf '%s\\|' "${FORBIDDEN[@]}" | sed 's/\\|$//')

if grep -rEn "from ['\"](${FORBIDDEN[0]})" apps/api/src/ apps/api/package.json 2>/dev/null; then
  echo "ERROR: Server-side cache library detected in apps/api. v1 forbids this."
  echo "See openspec/changes/athlos-foundation/specs/caching/spec.md §3."
  echo "If a future phase needs server cache, create server-cache/spec.md first."
  exit 1
fi
```

## Testing Strategy — Caching

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `createQueryClient()` returns a `QueryClient` with expected defaults | Vitest: `const qc = createQueryClient(); expect(qc.getDefaultOptions().queries.refetchOnWindowFocus).toBe(true)` |
| Unit | `retry` predicate: 4xx → false, network → true | Vitest: `retry(0, new ApiError('NOT_FOUND','',404,true))` → false; `retry(0, new TypeError('fetch failed'))` → true |
| Unit | `retryDelay` grows exponentially with jitter | Vitest: `retryDelay(0)` between 1000-1250; `retryDelay(2)` between 3500-3750 |
| Unit | `normalizeFilters` sorts keys alphabetically | Vitest: `{ b: 1, a: 2 }` → `{ a: 2, b: 1 }` |
| Unit | `normalizeFilters` converts Date to ISO string | Vitest: `{ d: new Date('2024-01-01') }` → `{ d: '2024-01-01T00:00:00.000Z' }` |
| Unit | `queryKeys.socios.list(filters)` returns same key regardless of property order | Vitest: `queryKeys.socios.list({ a:1, b:2 }).queryKey === queryKeys.socios.list({ b:2, a:1 }).queryKey` |
| Unit | `STALE_TIMES` lookup matches spec table | Vitest: `STALE_TIMES.ctacteSaldo.staleTime === 30_000` |
| Unit | `broadcastInvalidate` posts structured payload | Vitest: mock channel, call helper, assert postMessage called with `{ type:'invalidate', queryKey:[...] }` |
| Unit | `useDriftInvalidator` invalidates on stale→current transition | Vitest: render hook with `useFreshness` mock returning stale then current, assert `invalidateQueries({ queryKey: ['ctacte'] })` called |
| Unit | `useDriftInvalidator` does NOT invalidate on stale→stale | Vitest: render with stale both renders, assert invalidateQueries not called |
| Integration | Mutation `onSuccess` invalidates exact key set | Vitest + Testing Library: render component with mutation, fire mutation, assert `invalidateQueries` called with `['ctacte', 'saldo', 123]` (and ONLY that key) |
| Integration | `useLogout` calls `queryClient.clear()` on success | Testing Library: fire logout, assert cache is empty (`queryClient.getQueryCache().getAll().length === 0`) |
| Integration | Cross-tab invalidation: simulated second tab receives message | Vitest: create two `BroadcastChannel` instances, send message from one, assert receiver's onmessage fires with correct payload |
| Integration | `staleTime: 0` resources refetch on focus (freshness, auditLog) | Testing Library + fake timers: mount, advance timer 1s, simulate focus, assert refetch fired |
| Integration | `staleTime: Infinity` resources (lineage) do NOT refetch on focus | Testing Library: mount lineage query, simulate focus, assert refetch NOT fired |
| Integration | Saldo API endpoint always returns fresh DB value (no server cache) | Testcontainers + integration: hit `/ctacte/saldo?socio=1`, insert row, hit again, assert NEW value (no in-process cache) |
| E2E | Freshness status visible after import | Playwright: trigger import via UI, wait for status to flip, assert UI re-renders with updated data |
| E2E | Two-tab sync: mutation in tab A invalidates tab B | Playwright: open two browser contexts, mutate in A, assert B refetches automatically (no manual refresh) |
| E2E | Logout clears PII: subsequent user sees no cached socio data | Playwright: login as operator A, view socio, logout, login as operator B, navigate to same socio URL, assert fresh fetch (not from cache) |

## Migration / Rollback — Caching

**Migration**: No data migration required — the caching layer is purely client-side code. The `STALE_TIMES` table is a code artifact, not data.

**Rollback**: Remove the `apps/web/src/lib/query-client.ts` and `query-keys.ts` files. Replace `<QueryClientProvider>` in `main.tsx` with a fragment. All `useQuery` calls in feature code become unhooked — they would need to be migrated to `useEffect` + `fetch` (out of scope for the rollback, but the rollback itself is a no-op on the data layer). The `scripts/check-no-server-cache.sh` CI gate can stay in place as a forward-looking constraint.

## Open Questions — Caching

- [ ] Should `gcTime` for `auditLog` be shortened from 5 minutes to 1 minute to reduce PII exposure if a tab is left open idle? Spec line 411 says "5 minutes max" — 1 minute is more conservative.
- [ ] When BroadcastChannel is unavailable (Safari < 15.4, ~0.5% of users as of 2026), is the silent no-op acceptable, or should the app show a "your browser may not stay in sync across tabs" warning? Currently silent no-op.
- [ ] The `queryKeys.ctacte1.list` invalidation is called in two flavors (`['ctacte1', socioId]` and `['ctacte1', 'list', socioId]`) — are both used, or is the bare-`socioId` form dead code that should be removed in a follow-up?
- [ ] Should the drift detector ALSO broadcast a `BroadcastChannel` message so other tabs refetch without waiting for the 30s freshness poll? Currently relies on the polling cadence; broadcasting would be sub-second.
- [ ] `staleTime: Infinity` for lineage is per-resource — should it use a per-batch invalidation key like `['lineage', batchId, resource, id]` so a new import auto-invalidates the old lineage, even if the user never clicks "check lineage after import"?

---

## Offline / PWA Design

### Technical Approach

PWA in v1 is **app-shell only** (HTML/CSS/JS/fonts/icons), not a data cache. Athlos is read-only and cooperative with legacy during Phase 1, so caching API responses would mislead operators with stale projections. The build pipeline emits a hand-written service worker (no Workbox — the spec is narrow enough that Workbox would add ~30 KB gzipped for one strategy we don't use). Update flow is **soft prompt with manual reload** — no `skipWaiting()` on the happy path, only on the security-critical escape hatch. Lighthouse CI runs on every PR against a preview deploy and fails on any metric above its hard limit.

### Architecture Decisions

#### Decision: Service Worker — Hand-Written, Pre-Built, Injected at Build Time

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Hand-written `sw.js`** in `apps/web/public/` | ~3 KB, no deps, full control, no runtime SW generation | ✅ Chosen |
| `next-pwa` / Workbox | Adds ~30 KB gzipped, generates SW at build with manifest of hashed assets — overkill for one strategy + 5 routes | ❌ Rejected |
| Custom SW generated at build by Vite plugin | Best of both worlds but requires a new plugin to maintain; the spec is small enough that hand-writing wins | ❌ Deferred to Phase 2 |

**Rationale**: The SW has exactly three behaviors (precache shell, cache-first static, network-first for `/api/`). Workbox would generate a SW that does the same thing with a larger bundle. The hand-written SW is ~80 lines, easy to audit, and a Phase 2 addition (stale-while-revalidate API cache) is a single new route match + strategy block — no rewrite.

#### Decision: Build Pipeline — SW Lives in `apps/web/public/sw.js`, Copied As-Is

`sw.js` is committed to the repo and copied verbatim to the dist output by the existing Vite build (anything in `public/` is served at the site root). The version stamp in the cache name (`athlos-shell-${APP_VERSION}`) is a build-time constant injected by Vite's `define` — not a runtime read. This means a deploy that changes `__APP_VERSION__` produces a SW with a new cache name, which is the only invalidation signal we need.

**Alternatives considered**: Generate SW from a template at build (premature for v1 — one constant, no manifest of hashed assets to enumerate); load SW from a CDN (defeats the precache, requires extra DNS).

#### Decision: App Shell Precache — HTML Shell, Vite Hashed Assets, Fonts, Icons, Manifest

Precache list at `install` time:

- `/` (HTML shell; SPA fallback)
- `/manifest.webmanifest`
- `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-512-maskable.png`, `/icons/apple-touch-icon-180.png`
- `/fonts/*` (Inter or system-font stack fallback)
- The Vite-emitted hashed JS/CSS bundle paths (enumerated in a build-time manifest injected as a constant)

`next/font` or `@fontsource/inter` is preloaded via `<link rel="preload">` in `index.html` so the SW can fetch them synchronously at install. Total target: < 600 KB gzipped, hard limit 1 MB (per spec).

#### Decision: Update Flow — Soft Prompt + Manual Reload, `skipWaiting()` Only for Security

| Update Type | Mechanism | User Action |
|-------------|-----------|-------------|
| Normal deploy | New SW installs in background, waits for activation, posts `VERSION_UPDATE` message to clients via `postMessage` | UI shows toast: "Hay una nueva versión disponible" with "Actualizar ahora" / "Más tarde" |
| Security-critical deploy | Build embeds `security: 'critical'` in a public manifest (see Risk #1); SW checks this on `install` and calls `self.skipWaiting()` immediately | Toast shows "Actualizar ahora — recomendado por seguridad" with `Cerrar` action disabled; primary action reloads the page |

**Rationale**: The spec's "soft prompt + manual reload" model protects operators mid-action (e.g., mid-form-input) from a surprise reload. The `clients.claim()` strategy on the security path ensures the new SW takes over any open tabs without operator navigation. On the happy path, `clients.claim()` is NOT called — the new SW only takes over on next hard reload, which is the spec's "Background install" scenario.

#### Decision: Install Prompt UX — Platform-Aware Component with `localStorage` Cooldown

A single `<InstallPrompt />` component, rendered inside the layout (not the App root, so it can be excluded in standalone mode via `display-mode: standalone` media query):

1. Listen for `beforeinstallprompt`. Store the `DeferredPrompt` event in React context.
2. Detect iOS via `navigator.userAgent` AND the absence of `beforeinstallprompt` within 3s. If iOS: render "Instalar en iPhone" link → opens a modal with 3-step Share sheet instructions.
3. Detect standalone mode via `window.matchMedia('(display-mode: standalone)').matches`. If standalone: render nothing (or a "Running as installed app" indicator per spec).
4. Cooldown: on dismiss, write `Date.now()` to `localStorage.athlos.pwa.install.dismissed_at`. On render, check `Date.now() - stored < 30 * 24 * 60 * 60 * 1000` and skip rendering.

**iOS-specific path**: iOS Safari does not fire `beforeinstallprompt`, so the component must detect iOS independently and offer the manual Share-sheet flow. The spec calls this out explicitly (scenario: "iOS install instructions").

#### Decision: Lighthouse CI — GitHub Actions Job, Score Gates from Spec

A new job in `.github/workflows/ci.yml` runs `@lhci/cli` against a preview deployment (the existing `push` job already builds and deploys to staging on PR merge — we add a separate `lighthouse` job that runs against the staging URL after deploy, on PR builds). Score gates from spec table:

| Category | Target | Hard Limit | Action |
|----------|--------|-----------|--------|
| Performance | ≥ 90 | ≥ 80 | Block PR if < 80 |
| PWA | 100 | ≥ 90 | Block PR if < 90 |
| Accessibility | ≥ 95 | ≥ 90 | Block PR if < 90 |
| Best Practices | ≥ 95 | ≥ 90 | Block PR if < 90 |
| Bundle (JS gzipped) | < 200 KB | < 300 KB | Hard fail at 300 KB |
| Bundle (CSS gzipped) | < 30 KB | < 50 KB | Hard fail at 50 KB |
| FCP / LCP / TBT / CLS | per spec | per spec | Fail if any over hard limit |

**Bundle guard tool**: `size-limit` (the simpler, smaller alternative to `bundlewatch` — it works as a postbuild step and outputs a Markdown table suitable for PR comments). One `size-limit` config covers the JS and CSS budget, run as a separate `bundle` job before `lighthouse`.

#### Decision: Network Status — React Hook Reading `navigator.onLine` + `online`/`offline` Events

```ts
// apps/web/src/hooks/use-online.ts
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
```

A `<NetworkStatusBanner />` component reads this hook and renders the spec's amber banner. The TanStack Query `retry` predicate (from caching design) already treats `TypeError: Failed to fetch` as retriable, so the existing retry path covers the "best-effort retry" scenario in the spec.

#### Decision: Error Boundary — React `<ErrorBoundary>` Wrapping Route Trees, Distinguishing Network vs Server Errors

A `<RouteErrorBoundary>` wraps each route's content tree. On error:

- If `error instanceof TypeError` (the `Failed to fetch` family) AND `useOnline() === false` → render the full-page "Sin conexión" view per spec (header + sidebar still render, only the data area shows the error + Reintentar button + request_id).
- If `error instanceof ApiError` AND `error.statusCode >= 500` → render a non-blocking toast (data on screen stays, per spec scenario "Network failure on background action" — same UX for 5xx server errors).
- If `error instanceof ApiError` AND `error.statusCode < 500` → render the API's own error message inline (validation errors, 404, 403, etc.) — these are not connectivity issues.

The "no network on first load" case (browser default offline page) is **explicitly out of scope** per spec — the SW will precache the shell on the second visit. The first-visit offline scenario is documented as a known limitation, not a bug.

### Data Flow — Update Notification

```
New build deployed ──► New sw.js served ──► Browser detects byte change
       │
       └──► Old SW (vN) calls install on new SW (vN+1)
                    │
                    ├── if security:critical ──► skipWaiting() + clients.claim()
                    │                              │
                    │                              └──► new SW active immediately
                    │                                    clients receive VERSION_UPDATE via postMessage
                    │
                    └── else ──► new SW installed but waiting
                                  │
                                  ├── clients (open tabs) receive VERSION_UPDATE on next navigation
                                  │     (via controllerchange or postMessage from new SW)
                                  │
                                  └── UI shows toast "Nueva versión disponible"
                                        │
                                        ├── "Actualizar ahora" ──► postMessage { type: 'SKIP_WAITING' }
                                        │                          to new SW ──► new SW calls skipWaiting()
                                        │                          ──► clients.claim() ──► window.location.reload()
                                        │
                                        └── "Más tarde" ──► toast dismissed
                                                            new SW takes over on next hard reload
```

### File Changes — Offline/PWA Addition

| File | Action | Description |
|------|--------|-------------|
| `apps/web/public/sw.js` | Create | Hand-written service worker: install (precache shell), activate (delete old caches), fetch (cache-first static, network-first `/api/`) |
| `apps/web/public/manifest.webmanifest` | Create | PWA manifest with spec fields (name, icons, theme/background color) |
| `apps/web/public/icons/icon-192.png` | Create | 192×192 PNG with `purpose: "any"` |
| `apps/web/public/icons/icon-512.png` | Create | 512×512 PNG with `purpose: "any"` |
| `apps/web/public/icons/icon-512-maskable.png` | Create | 512×512 PNG with `purpose: "maskable"`, safe zone 80% |
| `apps/web/public/icons/apple-touch-icon-180.png` | Create | 180×180 opaque PNG |
| `apps/web/src/main.tsx` | Modify | Register SW via `navigator.serviceWorker.register('/sw.js')` AFTER `load` event (per spec: "registration MUST NOT block first paint") |
| `apps/web/index.html` | Modify | Add `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` |
| `apps/web/src/hooks/use-online.ts` | Create | `useOnline()` hook reading `navigator.onLine` + events |
| `apps/web/src/components/NetworkStatusBanner.tsx` | Create | Amber banner shown on `offline` event, dismisses on `online` |
| `apps/web/src/components/InstallPrompt.tsx` | Create | Platform-aware install banner with iOS Share-sheet modal + 30-day cooldown |
| `apps/web/src/components/RouteErrorBoundary.tsx` | Create | Distinguishes network / 5xx / 4xx errors, renders spec's "Sin conexión" or toast |
| `apps/web/src/hooks/use-sw-messages.ts` | Create | Listens for `postMessage` from SW; emits `VERSION_UPDATE` events to React context |
| `apps/web/src/components/UpdateToast.tsx` | Create | Renders "Hay una nueva versión disponible" with Actualizar/Más tarde |
| `apps/web/vite.config.ts` | Modify | Inject `__APP_VERSION__` and `__SECURITY_LEVEL__` build-time constants; ensure `public/sw.js` is copied verbatim (it already is by default) |
| `apps/web/src/styles/safe-areas.css` | Create | CSS custom properties `--safe-area-top/right/bottom/left` consuming `env(safe-area-inset-*)` |
| `apps/web/src/styles/touch.css` | Create | Global `min-height: 44px; min-width: 44px;` on interactive elements + 8px touch-safe padding |
| `apps/web/src/main.tsx` | Modify | Disable pull-to-refresh on body via `overscroll-behavior: contain` |
| `apps/web/src/sw-version.ts` | Create | Build-time generated file exporting `APP_VERSION` + `SECURITY_LEVEL` for the SW's `install` handler |
| `.github/workflows/ci.yml` | Modify | Add `bundle` job (size-limit) and `lighthouse` job (against preview deploy URL) |
| `apps/web/.size-limit.json` | Create | size-limit config: JS bundle 200 KB target / 300 KB hard, CSS 30 KB / 50 KB |
| `apps/web/lighthouserc.json` | Create | LHCI config: assert assertions, 3 runs median, mobile preset (Moto G Power throttling) |
| `apps/web/src/i18n/es-AR/pwa.json` | Create | All PWA UI strings (banner, toast, iOS modal) in es-AR |
| `apps/web/package.json` | Modify | Add deps: `@lhci/cli` (dev), `size-limit` (dev) |
| `db/schema/app_version.sql` | Create | DDL for `app_version` table (single-row, current server-deployed version) — see Risk #1 |
| `db/migrations/0009_app_version.sql` | Create | Migration for app_version |
| `packages/db/src/schema/app_version.ts` | Create | Drizzle schema for app_version |
| `apps/api/src/routes/version.ts` | Create | `GET /api/v1/version` handler returning `{ version, security, deployed_at }` — see Risk #1 |
| `apps/api/src/server.ts` | Modify | Register `/api/v1/version` route (no auth — per spec "public, no auth") |

### Interfaces / Contracts — Offline/PWA

#### `sw.js` Reference Skeleton

```js
// apps/web/public/sw.js
const VERSION = '__APP_VERSION__';           // injected at build
const SECURITY = '__SECURITY_LEVEL__';       // 'normal' | 'critical'
const CACHE_NAME = `athlos-shell-${VERSION}`;
const SHELL_ASSETS = __SHELL_ASSETS__;       // injected array of hashed paths

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_ASSETS))
      .then(() => {
        if (SECURITY === 'critical') return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API: network-only, never cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    return; // pass through
  }

  // Cross-origin: opaque cache on success, fall through on failure
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        return r;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Same-origin static: cache-first, network fallback, then cache
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return r;
      })
    )
  );
});
```

#### `manifest.webmanifest` (reference)

```json
{
  "name": "Athlos",
  "short_name": "Athlos",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#1e3a5f",
  "lang": "es-AR",
  "dir": "ltr",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

#### `GET /api/v1/version` Response (see Risk #1)

```typescript
interface VersionResponse {
  version: string;       // semver of currently-deployed server build, e.g. "1.2.3"
  security: 'normal' | 'critical';
  deployed_at: string;   // ISO 8601
}
```

### Testing Strategy — Offline/PWA

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `useOnline()` reflects `navigator.onLine` and toggles on `online`/`offline` events | Vitest + jsdom: simulate event, assert state |
| Unit | Install cooldown: dismissed < 30 days ago → no render | Vitest: write timestamp to localStorage, mount, assert banner absent |
| Unit | Install cooldown: dismissed > 30 days ago → render | Vitest: write old timestamp, mount, assert banner present |
| Unit | `RouteErrorBoundary` renders "Sin conexión" for `TypeError` when offline | Vitest + Testing Library: render with `useOnline() === false`, throw `TypeError`, assert full-page error |
| Unit | `RouteErrorBoundary` renders toast for `ApiError` with 5xx | Vitest: throw `ApiError('INTERNAL_ERROR', '', 500, false)`, assert toast, assert data on screen preserved |
| Unit | SW `install` populates cache with `SHELL_ASSETS` | Vitest + mock `caches` API: trigger install, assert `cache.addAll` called with manifest |
| Unit | SW `activate` deletes all caches except `CACHE_NAME` | Vitest: populate `caches.keys()` with `['athlos-shell-v1', 'athlos-shell-v2']`, trigger activate, assert `caches.delete('athlos-shell-v1')` called, NOT v2 |
| Unit | SW `fetch` for `/api/*` passes through (no cache write) | Vitest: mock `caches.open`, dispatch fetch event for `/api/v1/socios`, assert `caches.open` not called |
| Unit | SW `fetch` for static returns cached when present | Vitest: pre-populate cache, dispatch fetch, assert cached response returned without network call |
| Integration | Service worker registers and precaches on first load | Playwright: visit dashboard, wait for SW registration, evaluate `caches.keys()` in browser, assert `athlos-shell-${version}` present with expected entries |
| Integration | Update flow: deploy new build, toast appears | Playwright: load v1, mock a new SW by injecting a new `sw.js` with different cache name, wait for `VERSION_UPDATE` postMessage, assert toast text matches |
| Integration | iOS path: `InstallPrompt` renders Share-sheet modal | Playwright + iOS user agent: visit dashboard, wait 3s, click "Instalar en iPhone", assert 3-step modal visible |
| Integration | LHCI passes against preview deploy with all budgets met | GitHub Actions: run on PR, assert all assertions in `lighthouserc.json` pass |
| Integration | size-limit fails PR when JS bundle exceeds 300 KB | GitHub Actions: inject a large dep, assert `bundle` job fails with "Bundle size limit exceeded" |
| E2E | Operator installs app on Chrome, sees standalone launch | Playwright: dispatch `beforeinstallprompt`, call `prompt()`, wait for `appinstalled`, reload, assert `display-mode: standalone` |
| E2E | Touch target 44×44 on all interactive elements | Playwright + axe-core: scan `/socios` and `/import` pages, assert no `target-size` violations |
| E2E | Safe-area insets render correctly in standalone iOS viewport | Playwright + iPhone 14 viewport: set `viewport-fit: cover`, assert header has `padding-top: env(safe-area-inset-top)` applied |
| E2E | First-visit offline shows browser default page (not a custom fallback) | Playwright: clear cache + service worker, set offline, navigate, assert no app shell rendered (per spec, out of scope) |

### Migration / Rollout — Offline/PWA

**Migration**: No DB schema migration strictly required for the SW itself. If Risk #1 is resolved by adding `GET /api/v1/version`, that requires migration `0009_app_version.sql`. The SW is purely additive — registering a SW on existing v1 installs is non-breaking: existing tabs keep working, the SW activates on next reload. No rollback data loss.

**Rollout**: Phased, canary-style via the existing staging → main branch promotion:

1. Land SW + manifest on `staging`. Operators on staging test install + update flows for one week.
2. Land on `main`. Existing v1 users see the "Nueva versión disponible" toast on next visit (the new SW installs in background).
3. The `security: critical` flag is NOT enabled in v1 — it's a future Phase 2 escape hatch. The `__SECURITY_LEVEL__` constant exists in the build pipeline but is always set to `'normal'` until a future change adds the deployment flag.

**Rollback**: Remove the `navigator.serviceWorker.register()` call from `main.tsx`. Existing v1 tabs that already have the SW registered: the SW continues to serve the cached shell, but new visits won't register it, so the SW eventually becomes irrelevant (cleared on next unregister or browser cache eviction). The manifest, icons, and components can stay (the PWA install prompt just won't show). No data loss.

### Open Questions — Offline/PWA

- [ ] **Risk #1 (CRITICAL)**: The offline-pwa spec references `GET /api/v1/version` for update checks (lines 322, 314), but `api-design/spec.md` does not define this endpoint — only `/health` returns a `version` field in its body. Should we (a) add `GET /api/v1/version` to api-design, (b) reuse `/health` and parse the version from its body, or (c) rely solely on the build-time `__APP_VERSION__` + SW cache name for the update check (no server roundtrip needed since the new SW byte-changes)? Option (c) is simpler and the spec only says "SHOULD" for the server roundtrip. **Blocking — design choice needed before tasks.**
- [ ] Should the `security: critical` flag live in a build-time env var, a runtime API field, or a separate `/api/v1/version.security` field? The spec offers both options ("via build-time flag in the manifest or a `/api/v1/version` endpoint value"). Build-time is simpler; runtime allows incident response without redeploy.
- [ ] For Phase 2's "stale-while-revalidate API cache", should we use Workbox's `staleWhileRevalidate` strategy (requires pulling in Workbox runtime, ~10 KB) or hand-write the strategy in the existing SW (matches the Phase 1 decision)? Hand-written keeps consistency but is a maintenance cost if we add 3+ strategies.
- [ ] The spec mentions Lighthouse CI runs "against a preview deployment" — does the existing GitHub Actions `push` job create a preview URL on PRs, or only on `main`/`staging` push? The current design (deployment-devops) only deploys on main/staging, not on PRs. PR preview URLs require a separate mechanism (Vercel preview, GitHub Actions deploy-to-staging-on-PR, etc.). **Blocking — infrastructure decision needed.**
- [ ] iOS `apple-touch-icon-180.png` MUST be opaque (no transparency) per spec — is the 512×512 maskable icon source PNG opaque, or does it use transparency? If transparent, we need a separate render step or a flat-background version.
- [ ] `clients.claim()` on the security path means a new SW takes over the open tab immediately — but if the tab is mid-mutation (e.g., submitting a payment), should we wait for in-flight requests to complete before reloading? The spec says reload on operator click, but doesn't address in-flight requests.

---

## Multi-Tenancy Design

### Decision: v1 Single-Tenant Implementation — No New Abstractions, No Schema Changes

**Choice**: v1 ships with zero multi-tenancy code. No `tenants` table, no `tenant_id` column on any domain table, no tenant resolution middleware, no tenant-scoped connection pools, no tenant-prefixed URL routes. The codebase is single-tenant by construction. D6 (PARCODIGO → single tenant) is satisfied by importing all legacy `PARCODIGO` values into one unified dataset, with `PARCODIGO` preserved in the raw record for lineage (per the legacy-import design).

**Alternatives considered**:
- Add a `tenants` table stub now (one row, seeded with `gorriti`) — rejected: it would create a "phantom" table that has no enforcement surface in v1, inviting the next developer to start wiring `tenant_id` filters prematurely and fork the codebase into "real" multi-tenant code paths that aren't yet integrated. The spec's non-requirements table explicitly forbids this.
- Add `tenant_id UUID NULL` columns on every domain table now to make the v2 migration "free" — rejected: NULL columns with no constraints are a lie. They give no isolation guarantee, and once they exist, an attacker (or a careless query) cannot tell whether a missing `tenant_id` is "intentionally global" or "bug". Adding the column with NOT NULL after the fact is the v2 migration's job, not v1's.
- Subdomain routing now (e.g., `gorriti.athlos.app`) "to get ahead of it" — rejected: there is no second tenant to route. Adding the middleware now means every operator authenticates against an implicit `gorriti` tenant, which the spec explicitly calls YAGNI.

**Rationale**: The retrofit cost table in the spec (2–4 person-months plus leak risk) is the cost of *missing* multi-tenancy. The cost of *adding it back* via a clean v2 migration is bounded. Shipping v1 with no half-built abstractions keeps the codebase honest: when T1/T2/T3 fires, we can introduce the v2 model without untangling speculative scaffolding. This is the cheapest way to keep the door open without paying to walk through it.

### Decision: Forward-Compatibility Shims — Only `PARCODIGO` Preservation; Nothing Else

**Choice**: The only forward-compatibility shim in v1 is preserving `PARCODIGO` in the raw import record (via the lineage-tracker / legacy-import design). No `operator_id` column is added to any table for tenant-future-proofing. No `tenants` table stub. The audit_logger spec already supports per-event metadata; no v2-only fields are added to the schema.

**Alternatives considered**:
- Add `tenant_id` as a NULL column now to be filled in v2 — rejected (see Decision 1).
- Add a "tenant context" object on `request` that's always `null` in v1 — rejected: it's an abstraction with no consumer. It would tempt middleware authors to write `request.tenant?.id ?? throw...` branches that are never exercised and obscure the v1 data flow.
- Rename existing single-tenant tables to `gorriti_<table>` (e.g., `gorriti_socios`) to "make room" for `aldosivi_socios` — rejected: this is the schema-per-tenant strategy without the multi-tenancy benefit. Even if v2 picks a different strategy (shared DB + `tenant_id`), the rename is wasted churn.

**Rationale**: The spec's v1 non-requirements table is the authoritative "do not add" list. The only piece of v1 work that touches the future of multi-tenancy is the PARCODIGO lineage — which is already a requirement of the legacy-import spec. Every other "shim" would be speculative.

### Decision: URL Strategy — Subdomain (`<slug>.athlos.app`) Confirmed as v2 Default; v1 Path-Based via `Host` Header Ignored

**Choice**: v1 uses a single host (e.g., `app.gorriti.org` or the deployment's primary URL). The Fastify server has no `Host`-based tenant resolution — every request operates on the same dataset. The v2 plan is documented in the spec (subdomain preferred) and in the migration path below, but no v1 code branches on `Host`, `X-Tenant-ID`, or any path prefix.

**Alternatives considered**:
- Path-based v1 (`/c/gorriti/api/...`) to "test" tenant resolution early — rejected: a v1 with `/c/gorriti/` is just v2 with one tenant hardcoded. It's a 6-month head start that will have to be ripped out when the second club signs up and the URL strategy needs to change.
- Subdomain routing in v1 (`gorriti.athlos.app`) — rejected: requires wildcard DNS and TLS certs for a single deployment. The spec explicitly says v2.

**Rationale**: The spec's decision table (D5) is clear: subdomain is the v2 default. v1's job is to ship, not to preview v2. The reverse proxy (nginx/Caddy) in front of the API in v1 simply forwards `Host: app.gorriti.org` to the Fastify process without inspection.

### Decision: PARCODIGO Mapping in v1 — Read, Preserve, Ignore

**Choice**: The legacy-import design ingests all `PARCODIGO` values (1..6) into the unified dataset. The value is stored on the raw record (via the lineage-tracker `legacy_raw_records` table, which is already designed to capture every legacy field). No business logic queries by `PARCODIGO`. No API exposes `PARCODIGO` as a filter. The UI never surfaces it.

**Alternatives considered**:
- Add a `legacy_parcodigo` column to every domain table now, to "ease" the v2 split — rejected: this is `tenant_id` by another name. Same arguments apply.
- Surface `PARCODIGO` in the admin UI "for visibility" — rejected: it's a legacy implementation detail. Operators should not need to know it exists. If they do (e.g., reconciling a specific historical record), they query the lineage system.
- Pre-create the `parcodigo_to_tenant_id` mapping table now (all 6 values → `gorriti`) — rejected: the spec says this table is created at v2 migration time. Creating it in v1 invites a developer to start splitting queries by `PARCODIGO`, which the spec forbids.

**Rationale**: The spec is explicit: "no business logic SHALL branch on `PARCODIGO` in v1." The legacy-import design already does the read + preserve work. Anything beyond that is gold-plating.

### Decision: Re-Evaluation Gate — New SDD Change Required; Documented in This Design and `tasks.md`

**Choice**: The four re-evaluation triggers (T1: second club; T2: multi-company request; T3: SaaS migration decision; T4: schema change that would be harder with `tenant_id` retrofitted) are hard gates. The mechanism for enforcing them is:

1. **This design section** explicitly enumerates the triggers in a "Re-Evaluation Triggers" sub-section below.
2. **A documented checklist item** in the project `README.md` under a "Future Work — Multi-Tenancy" heading, listing T1–T4 with one-line definitions.
3. **An ADR** is NOT created in v1 — the decision is captured in the multi-tenancy spec and this design, which is sufficient for a single-club deployment. When T1/T2/T3 fires, the *new* SDD change will produce its own ADR capturing the chosen v2 strategy.
4. **Code review** is the human-in-the-loop gate. PR descriptions for schema changes must include a "Multi-tenancy impact" line: `Multi-tenancy impact: None | Reviewed against T4 (spec re-eval needed)`. This is added to `CONTRIBUTING.md` (or equivalent) as a review checklist.
5. **No automated lint rule** for "no tenant_id column" — TypeScript types and a database migration that doesn't reference a `tenants` table are stronger guarantees than a linter.

**Alternatives considered**:
- Custom ESLint rule banning the string `tenant_id` — rejected: the v2 spec *will* introduce the string. A lint rule that has to be deleted at the exact moment it becomes relevant is a liability. Naming conventions and explicit code review are better.
- A pre-commit git hook checking for `tenants` table creation — rejected: over-engineering for a 1-developer team. Code review is the right gate.
- Periodic review (e.g., quarterly) — rejected: triggers are event-driven, not time-driven. A "second club signs up" event is the right signal; a calendar reminder isn't.
- ADR-0003: "Defer multi-tenancy to v2" — considered but rejected: the spec already serves this role. ADRs are for decisions the codebase needs to *implement*; the multi-tenancy decision is to *not implement* anything, which the non-requirements table in the spec already captures.

**Rationale**: The spec requires a "hard gate" for re-evaluation. The gate must be (a) visible to anyone touching the code, (b) cheap to maintain, and (c) trigger when an event happens, not on a schedule. The three artifacts — design section, README checklist, code review checklist — satisfy (a) and (b). Event-driven triggers satisfy (c).

### Decision: "No `operator_id` in URL" Enforcement — Code Review + Auth Design Already Aligns

**Choice**: The auth-login design derives operator identity from the JWT (`request.operator.id`), never from the URL path. The user-management-rbac design uses `/api/v1/admin/operators/:id/...` and `/api/v1/operators/:id/delegations` — these are **admin subresources** where `:id` is a *target* operator (a different operator from the caller), not the caller's own id. The RBAC design's auth check uses `request.operator.role` to decide whether the caller can act on `:id`, so the caller's identity is always session-derived, not URL-derived.

This matches the spec's intent: "operator identity MUST be derived from the authenticated session, never the URL." The rule is about the **caller's** identity, not about whether `operator_id` ever appears as a path parameter (it does, as a target id in admin routes).

**Enforcement mechanism**:
- **Code review checklist**: "When adding a new route, confirm the caller's identity is `request.operator.id`, not a path/query/body field." This is added to the review checklist alongside the T4 multi-tenancy impact line.
- **No ESLint rule**: the pattern `request.operator.id === params.id` is *valid* in admin routes (caller must be ADMIN, target is in path). A lint rule would have too many false positives.
- **Integration test**: one test per route family asserts that swapping the JWT subject does NOT swap the operator the route acts on, while swapping the path `:id` DOES (for admin routes). This catches the "I accidentally used `params.id` as the caller's id" bug.

**Alternatives considered**:
- ESLint rule banning `params.id` access in handlers — rejected: false positives in admin routes.
- TypeScript branded type for "subject-of-jwt" vs "target-id-in-path" — considered but rejected: adds ceremony for a rule that's already enforced by code review + a small integration test. A future change can add the branded type if a regression slips through.
- OpenAPI schema linting — out of scope for v1; OpenAPI is referenced in api-security but not yet enforced.

**Rationale**: The pattern is already correctly applied in auth-login and user-management-rbac designs. The risk is a new developer copying a route template and inverting the id source. Code review + a per-route-family integration test is the minimum viable defense.

## Re-Evaluation Triggers — Documentation Cross-Reference

The following triggers from the multi-tenancy spec MUST halt any work that would make v2 multi-tenancy retrofit harder, until a new SDD change is opened:

| # | Trigger | Detection | Action |
|---|---------|-----------|--------|
| T1 | Second club signs up | Sales / business owner | New SDD change: `add-multi-tenancy` |
| T2 | Multi-company request (multi-PARCODIGO isolation) | Product / client request | New SDD change: `add-logical-multi-tenancy` |
| T3 | SaaS migration decision | Executive decision | New SDD change: full multi-tenancy migration |
| T4 | Schema change materially harder with `tenant_id` retrofitted | Code review "Multi-tenancy impact" line | Pause PR; open new SDD change; this spec is reviewed before schema change merges |

T4 is the operational gate for ongoing development. Items T1–T3 are strategic gates for the business.

## Migration Path Documentation Location

The v1→v2 migration steps from the spec (steps 1–11) are recorded in **two places** for v1, plus the eventual v2 change creates its own ADR:

1. **This design section** (above) — the 10-step summary, plus the link back to the spec for full detail. Future developers hitting T4 review this section first.
2. **`openspec/changes/athlos-foundation/design.md` migration path subsection** (this file) — the canonical place. The multi-tenancy spec's own "Migration Path" section is the source of truth; this design references it.
3. **The v2 SDD change** (when opened) will produce its own `proposal.md` + `design.md` that re-derives the migration plan against the actual v1 schema. The 10-step plan in the spec is a sketch, not a contract — the v2 change is the contract.

A standalone `docs/multi-tenancy-migration.md` is **NOT created in v1** — it would duplicate the spec and go stale. The spec is the canonical document; the design references it.

## Data Flow — Multi-Tenancy (v1)

There is no tenant resolution in v1. The data flow is the same as the auth-login + user-management-rbac designs, with the following additions to the mental model:

```
Request ──► onRequest hook ──► requestId set
                                       │
                                       ▼
                            (no tenant middleware)
                                       │
                                       ▼
                            Auth check (JWT) ──► request.operator = { id, role, ... }
                                       │
                                       ▼
                            RBAC check (requireRole / requirePermission)
                                       │
                                       ▼
                            Handler ──► DB query (no tenant_id filter)
                                       │
                                       ▼
                            Response (single shared dataset)
```

For v2, the diagram gains a `tenantResolutionMiddleware` between `onRequest` and `Auth check`, which sets `request.tenant = { id, slug }` from the `Host` header (subdomain strategy). The DB query layer gains a `tenantScope(request.tenant)` filter. This is documented in the spec's v2 sections; v1 code does not implement it.

## File Changes — Multi-Tenancy Addition

| File | Action | Description |
|------|--------|-------------|
| `README.md` | Modify | Add "Future Work — Multi-Tenancy" section enumerating T1–T4 |
| `CONTRIBUTING.md` (or equivalent review checklist) | Modify | Add "Multi-tenancy impact" line to PR template; add "operator identity from session, not URL" check |
| `db/schema/lineage/legacy_raw_records.sql` (already exists) | Verify | Confirm `legacy_raw_records` captures `PARCODIGO` from every legacy record — no change if lineage-tracker design already covers this |
| `db/migrations/*` | No change | No new tables, no new columns |

No new packages, no new routes, no new middleware. The "addition" is documentation + a code-review checklist.

## Interfaces / Contracts — Multi-Tenancy

### v1: No New Interfaces

There are no new types, no new functions, no new exports. The `tenant` concept does not exist in v1 code.

### v2 Reference (Do Not Implement)

The `TenantId`, `Tenant`, and `scopedTo()` types from the spec's Input/Output Contracts section are v2-only. They are included here for the v2 change's reference, but **NOT** added to v1 code:

```typescript
// v2 ONLY — referenced from the multi-tenancy spec, do not add in v1
type TenantId = string;
interface Tenant { id: TenantId; slug: string; display_name: string; status: 'active' | 'suspended' | 'archived'; created_at: string; config: Record<string, unknown>; }
function scopedTo(tenantId: TenantId): QueryScope { /* ... */ }
```

Including these as commented-out stubs would invite premature use. Leaving them out of v1 entirely is the correct signal.

## Testing Strategy — Multi-Tenancy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | No `tenants` table exists in v1 schema | Vitest + Testcontainers: introspect `information_schema.tables`, assert no `tenants` row |
| Unit | No `tenant_id` column on any v1 domain table | Vitest + Testcontainers: introspect `information_schema.columns`, assert no `tenant_id` exists on `socios`, `ctacte`, `projections`, `audit_events`, `configurations`, `operators` |
| Unit | No tenant resolution middleware in request pipeline | Vitest: mock Fastify request, assert no `request.tenant` property is set by any registered plugin |
| Integration | Legacy import ingests all PARCODIGO values into unified dataset | Testcontainers: seed legacy with 6 PARCODIGO values, run import, assert 6 distinct values present in `legacy_raw_records` |
| Integration | Query for socio returns records regardless of PARCODIGO | Testcontainers: import 2 PARCODIGO=1 records and 3 PARCODIGO=2 records, query socio, assert 5 results, no `WHERE parcodigo` filter in the query plan (EXPLAIN) |
| Integration | `Host` header is ignored — `gorriti.athlos.app` and `aldosivi.athlos.app` return the same data | Integration: same request with two Host headers, assert identical response bodies |
| Integration | Caller identity comes from JWT, not path | Integration: per route family (socios, ctacte, projections, admin operators), test that swapping JWT subject changes effective identity, swapping path `:id` changes target (for admin routes) |
| E2E | Smoke: full operator flow unaffected by tenant concept | Playwright: login, query socio, view ctacte, generate report — no tenant prompts or selectors in the UI |

The introspection tests (Unit rows 1–2) are the v1 conformance gate: they fail if a developer accidentally adds a `tenants` table or a `tenant_id` column without going through the T4 re-evaluation process. They are cheap, run in CI, and pin the YAGNI boundary.

## Migration / Rollback — Multi-Tenancy

**Migration**: No schema migration. No new tables. No new columns. The only v1 deliverable is documentation in `README.md` and a PR template line in `CONTRIBUTING.md`.

**Rollback**: N/A — there is nothing to roll back. If the T4 trigger fires and a new SDD change opens, that change owns the v2 migration from a clean v1 baseline. Starting from "no shims" is the ideal starting point for the v2 work; any speculative shim added in v1 would be a hindrance, not a help.

## Open Questions — Multi-Tenancy

- [ ] Does the project have a `CONTRIBUTING.md` (or equivalent PR template) at the repo root, or is code review tracked elsewhere (e.g., GitHub PR template at `.github/PULL_REQUEST_TEMPLATE.md`)? The design assumes the former; if only the latter exists, the "Multi-tenancy impact" line goes in `.github/PULL_REQUEST_TEMPLATE.md`.
- [ ] Should the v1 introspection tests (Unit rows 1–2) be a one-time check (run once at CI setup) or a per-PR check (run on every PR)? Per-PR is stronger but adds 2 migrations/introspections to the test suite. For a 1-developer team, per-PR is fine; for a larger team, gate them behind a "schema-change" label.
- [ ] The spec mentions a `PARCODIGO` → `tenant_id` mapping table for v2 SaaS migration. Should we capture the actual mapping intent now (e.g., "PARCODIGO 1 and 2 = gorriti, 3 = tenant-X") in a doc? **Recommendation: NO** — the mapping is a business decision for the v2 change, and the spec is clear that v1 treats all PARCODIGO values as one tenant. Pre-deciding the v2 split locks in a business choice that hasn't been made.
- [ ] The lineage system preserves `PARCODIGO` per the spec. Is `PARCODIGO` currently included in the `legacy_raw_records` payload by the legacy-import design? **Assumed yes** based on the spec's "preserved in the raw record" requirement, but this is a verification item, not a blocker.
- [ ] When T1 fires (second club signs up), what's the timeline expectation? Is there a service-level expectation that triggers the SDD change within a sprint, or is it open-ended? This is a product/operations question, not a design question — but it affects how aggressively we document the trigger.

---

## API Versioning Design

### Decision: Versioned Plugin Registration — `fastify.register(routes, { prefix: '/api/v1' })` with Version-Agnostic Handlers

**Choice**: Each domain plugin (`sociosRoutes`, `ctacteRoutes`, etc.) is registered once per major version with the version passed as a registration option. Handlers read `request.routeOptions.prefix` or a `request.apiVersion` decorator to be aware of which version served them — they DO NOT branch on the version string internally.

```typescript
// apps/api/src/server.ts
const v1App = async (fastify: FastifyInstance) => {
  await fastify.register(sociosRoutes, { prefix: '/api/v1' });
  await fastify.register(ctacteRoutes, { prefix: '/api/v1' });
  // ...all v1 plugins
};

const v2App = async (fastify: FastifyInstance) => {
  // v2 may use a different projection, schema, or even a totally separate
  // plugin (sociosRoutesV2) — but registered under /api/v2
  await fastify.register(sociosRoutesV2, { prefix: '/api/v2' });
  await fastify.register(ctacteRoutesV2, { prefix: '/api/v2' });
};

await fastify.register(v1App);
if (config.api.v2Enabled) {
  await fastify.register(v2App);
}
```

**Alternatives considered**: Per-route prefix at `fastify.route({ url: '/api/v1/socios' })` (scatters version info across route definitions, hard to enforce consistency), single `currentRoutes` function with internal version switch (couples logic, defeats plugin isolation), content negotiation via `Accept: application/vnd.athlos.v2+json` (spec mandates path-based — rejected).

**Rationale**: Plugin-level prefix is the idiomatic Fastify way. The spec requires (Section E) "The version prefix MUST NOT be hardcoded inside handlers; it MUST be configurable at registration time." Plugin registration satisfies this exactly. v1 and v2 plugins can share handlers via shared service modules (`packages/socios/src/service.ts`) while differing only in the route definitions and request/response schemas. The `if (config.api.v2Enabled)` gate enforces the "max 2 major versions" rule at deploy time.

### Decision: API-Version Response Header — Single `onSend` Hook Reads Request Context

**Choice**: A `versionHeaderPlugin` registered at the app root sets `reply.header('API-Version', request.apiVersion)` in an `onSend` hook. `request.apiVersion` is injected by the same plugin in an `onRequest` hook, derived from the URL path via a single regex match `^\/api\/(v\d+)\/`.

```typescript
// packages/versioning/src/header.ts
export const versionHeaderPlugin: FastifyPluginAsync = async (fastify) => {
  const versionRegex = /^\/api\/(v\d+)\//;

  fastify.decorateRequest('apiVersion', null);

  fastify.addHook('onRequest', async (request) => {
    const match = request.url.match(versionRegex);
    if (match) {
      request.apiVersion = match[1]; // "v1", "v2", etc.
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.apiVersion) {
      reply.header('API-Version', request.apiVersion);
    }
    return payload;
  });
};
```

**Alternatives considered**: Custom response serializer (Fastify's `serializer` option — works, but `onSend` is the right hook for header injection; serializer only touches the body), per-route `preHandler` setting the header (violates DRY across hundreds of routes), reverse proxy injects the header (couples to deployment topology).

**Rationale**: `onRequest` + `onSend` is a 2-hook solution applied once globally. The regex extracts the version before routing happens — works for any future version. The `if (request.apiVersion)` guard exempts `/health` (unversioned) from the header, satisfying the spec's "/health endpoint is unversioned and exempt." This is also the right place to set `Sunset` and `Warning` headers (see next decision).

### Decision: Deprecation Headers — `deprecationRegistry` Lookup in `onSend` Hook

**Choice**: A `deprecationRegistry` is a singleton map keyed by `routeKey = ${method}:${apiVersion}:${path}` (e.g., `"GET:v1:/api/v1/legacy-report"`). Entries contain `{ sunset: Date, migrationGuideUrl: string }`. The `versionHeaderPlugin`'s `onSend` hook looks up the current route's key and conditionally sets three headers.

```typescript
// packages/versioning/src/deprecation.ts
export interface DeprecationEntry {
  sunset: Date;
  migrationGuideUrl: string;
  deprecatedAt: Date;
}

export const deprecationRegistry = new Map<string, DeprecationEntry>();

export const deprecationHeadersPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!request.apiVersion) return payload;

    const routeKey = `${request.method}:${request.apiVersion}:${request.routeOptions.url}`;
    const entry = deprecationRegistry.get(routeKey);
    if (!entry) return payload;

    reply.header('Deprecation', 'true');
    reply.header('Sunset', entry.sunset.toUTCString());
    reply.header('Link', `<${entry.migrationGuideUrl}>; rel="deprecation"`);

    // 30-day final warning (Section I, scenario "Final warning issued")
    const now = Date.now();
    const daysUntilSunset = (entry.sunset.getTime() - now) / (1000 * 60 * 60 * 24);
    if (daysUntilSunset <= 30 && daysUntilSunset > 0) {
      reply.header(
        'Warning',
        `299 - "This endpoint will be removed on ${entry.sunset.toISOString().slice(0, 10)}"`
      );
    }

    return payload;
  });
};
```

**Alternatives considered**: Database table for deprecation entries (runtime fetch on every request — unnecessary overhead for a small static set), per-route `preHandler` to set headers (violates DRY), external config service (over-engineered for a 2-version API).

**Rationale**: The deprecation set is small and changes only at release time. In-memory map is the simplest structure that satisfies the 30-day warning logic. `request.routeOptions.url` is the templated route path (e.g., `/api/v1/socios/:id`), not the actual URL — this is the key for matching registered routes. The `daysUntilSunset <= 30` window is computed at request time, so the warning appears automatically as the sunset date approaches — no cron job or manual flag flip needed.

### Decision: Changelog Source — OpenSpec Specs Parsed by `scripts/generate-changelog.ts`

**Choice**: A Node.js script at `scripts/generate-changelog.ts` walks `openspec/changes/*/specs/*/spec.md` (only merged changes, not in-progress), parses the `## Purpose` and the `### Requirement:` headers, and emits a deterministic `docs/api/changelog.json` plus a static `docs/api/changelog.md` (generated, committed to repo, served at `/api/v1/changelog` and mirrored to the docs site).

```typescript
// scripts/generate-changelog.ts (reference, simplified)
interface ChangelogEntry {
  date: string;          // ISO date of merge
  version: string;       // "v1" or "v2"
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'clarification' | 'correction';
  endpoint: string;      // e.g., "/api/v1/socios/{id}"
  description: string;   // From the requirement header
  migration_guide_url?: string;
  deprecated_at?: string;
  sunset?: string;
}

async function generateChangelog(): Promise<void> {
  const entries: ChangelogEntry[] = [];
  for (const changeDir of await readdir('openspec/changes')) {
    for (const specDir of await readdir(`openspec/changes/${changeDir}/specs`)) {
      const spec = await readFile(`openspec/changes/${changeDir}/specs/${specDir}/spec.md`, 'utf8');
      entries.push(...parseSpec(spec, changeDir));
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  await writeFile('docs/api/changelog.json', JSON.stringify(entries, null, 2));
  await writeFile('docs/api/changelog.md', renderMarkdown(entries));
}
```

**Alternatives considered**: Hand-maintained CHANGELOG.md (drift risk, manual toil), Git history parsing (loses the structured "what endpoint changed" data), third-party changelog generators (over-engineered, opaque).

**Rationale**: OpenSpec specs are the source of truth for API contracts. Deriving the changelog from specs guarantees the changelog and the contract can never disagree. The script runs on every PR (CI step) — if a spec adds an endpoint without a changelog entry, the diff is visible in the PR. The JSON output powers the read API; the MD output powers the static docs site. Both are committed to the repo, so the read API is just a `GET /api/v1/changelog` that serves the committed JSON.

### Decision: Breaking-Change CI Gate — Spec Diff Classifier on PR

**Choice**: A CI step (`scripts/check-breaking-changes.ts`) runs on every PR that modifies `openspec/changes/*/specs/*/spec.md`. It diffs the spec before and after the change, then applies a rule-based classifier:

| Change | Classification |
|--------|----------------|
| New `### Requirement:` under an existing endpoint | non-breaking (added) |
| `### Scenario:` removed from a requirement | **breaking** (scenario removal) |
| Response field removed from a `#### Scenario:` example | **breaking** (field removal) |
| Response field renamed in a `#### Scenario:` example | **breaking** (field rename) |
| Response field type changed in a `#### Scenario:` example | **breaking** (type change) |
| New optional field added to a request body | non-breaking (added) |
| `### Requirement:` with "REMOVED" or "Deprecated" tag | generates deprecation entry, non-blocking |
| Error code value changed | **breaking** (error code change) |

The classifier outputs a PR comment listing detected changes and their classification. A change classified as breaking MUST be in a change folder with a major version bump (e.g., `openspec/changes/athlos-v2/`), and a `proposal.md` justifying the bump. If a breaking change is in a folder whose name does NOT introduce a new major version, the CI gate FAILS the PR.

```typescript
// scripts/check-breaking-changes.ts (reference shape)
interface SpecDiff {
  change: string;            // "athlos-foundation"
  spec: string;              // "api-design"
  type: 'added' | 'changed' | 'removed' | 'renamed';
  classification: 'breaking' | 'non-breaking' | 'deprecation';
  evidence: string;
  path: string;
}
```

**Alternatives considered**: Manual review only (inconsistent, error-prone — humans miss field removals), full AST-based semantic diff (overkill for the structured spec format), external linter (none exists for OpenSpec).

**Rationale**: Rule-based classification works because OpenSpec specs have a predictable structure (`### Requirement:`, `#### Scenario:`). The 8 rules above cover 95%+ of changes. The "fail the PR" gate prevents the most common version-control mistake: shipping a breaking change under the current version. The PR comment also serves as a changelog draft — reviewers see the exact user-facing impact.

### Decision: Version Discovery Endpoint — `GET /api/versions` (Unversioned)

**Choice**: A single unversioned endpoint at `GET /api/versions` (NOT `/api/v1/versions` — discovery must work before the client knows the version) returns the compatibility matrix from a static config in `packages/versioning/src/versions.ts`.

```typescript
// packages/versioning/src/versions.ts
export const supportedVersions = [
  {
    version: 'v1',
    status: 'current' as const,    // 'current' | 'deprecated' | 'sunset'
    release_date: '2026-01-01',
    sunset_date: null,
    migration_guide_url: null,
    base_path: '/api/v1',
  },
  // v2 example (when released):
  // {
  //   version: 'v2',
  //   status: 'current' as const,
  //   release_date: '2026-09-01',
  //   sunset_date: null,
  //   migration_guide_url: null,
  //   base_path: '/api/v2',
  // },
];

export const v1Status: 'current' | 'deprecated' | 'sunset' = 'current';
```

```typescript
// apps/api/src/routes/versions.ts
fastify.get('/api/versions', async () => ({
  versions: supportedVersions.map((v) => ({
    version: v.version,
    status: v.status,
    release_date: v.release_date,
    sunset_date: v.sunset_date,
    migration_guide_url: v.migration_guide_url,
  })),
}));
```

**Alternatives considered**: `GET /api/v1/versions` (requires the client to already know v1 exists — defeats the purpose of discovery), `OPTIONS *` (RFC 8615 server-wide OPTIONS — too generic, doesn't fit the versioned structure), `/.well-known/api-versions` (over-formalized for a single-product API).

**Rationale**: The spec requires the compatibility matrix to be queryable. An unversioned endpoint is the standard pattern: a client can hit `/api/versions` with no prior knowledge and learn which versions exist and their status. The data is static (changes only at release time) — no DB lookup needed. The `status` field maps directly to the spec's "current | deprecated | sunset" enum (Section H).

### Decision: Migration Guide Template — `docs/migrations/{endpoint}.md`

**Choice**: One Markdown file per deprecated endpoint at `docs/migrations/{endpoint-slug}.md`. The file path is the `migration_guide_url` stored in the deprecation registry and emitted in the `Link` header.

```markdown
<!-- docs/migrations/legacy-report.md -->
# Migration: `GET /api/v1/legacy-report`

**Deprecated**: 2026-01-15
**Sunset**: 2026-07-15

## Endpoint being deprecated

`GET /api/v1/legacy-report`

## Replacement

`GET /api/v1/reports/summary` — returns the same data with a stable schema.

## Before

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" \\
  https://api.athlos.example.com/api/v1/legacy-report
\`\`\`

## After

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" \\
  https://api.athlos.example.com/api/v1/reports/summary
\`\`\`

## Sunset date

`2026-07-15` — after this date the endpoint returns 404.
```

**Alternatives considered**: Single monolithic migration guide (one file with all deprecations — hard to link to a specific endpoint, breaks the spec's "The link target for the `Link` response header" requirement), external docs site per endpoint (hosting and discoverability overhead), auto-generated from spec (the spec doesn't have enough context — code examples are human-authored).

**Rationale**: One file per endpoint gives a stable URL per deprecation (per the spec's `Link: rel="deprecation"` requirement). The file path is deterministic from the route — easy to find in the repo. The template enforces the four required elements (endpoint, replacement, example, sunset date) from the spec's "Migration Guide Per Deprecated Endpoint" requirement. A new deprecation in code: add a `deprecationRegistry.set('GET:v1:/api/v1/legacy-report', { sunset, migrationGuideUrl: 'https://docs.athlos.example.com/migrations/legacy-report' })` and create the MD file.

## Data Flow — API Versioning

```
Request ──► onRequest hook (versionHeaderPlugin)
              │
              ├── regex match /^\/api\/(v\d+)\//
              │     │
              │     ├── match: request.apiVersion = "v1"
              │     │
              │     └── no match: request.apiVersion = null (e.g., /health, /api/versions)
              │
              ├── routing
              │
              └── onSend hook
                    │
                    ├── API-Version header (if request.apiVersion)
                    │
                    ├── Deprecation registry lookup by routeKey
                    │     │
                    │     ├── entry found: set Deprecation, Sunset, Link headers
                    │     │
                    │     ├── 30-day warning: add Warning: 299 header
                    │     │
                    │     └── no entry: skip
                    │
                    └── reply sent
```

## File Changes — API Versioning Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/versioning/package.json` | Create | Package manifest |
| `packages/versioning/src/header.ts` | Create | `versionHeaderPlugin` — injects `API-Version` header |
| `packages/versioning/src/deprecation.ts` | Create | `deprecationRegistry` + `deprecationHeadersPlugin` |
| `packages/versioning/src/versions.ts` | Create | Static `supportedVersions` array + status constants |
| `packages/versioning/src/index.ts` | Create | Public exports |
| `apps/api/src/server.ts` | Modify | Register `versionHeaderPlugin` + `deprecationHeadersPlugin` |
| `apps/api/src/routes/versions.ts` | Create | `GET /api/versions` handler |
| `scripts/generate-changelog.ts` | Create | OpenSpec → changelog.json + changelog.md generator |
| `scripts/check-breaking-changes.ts` | Create | PR gate: spec diff → breaking/non-breaking classification |
| `.github/workflows/ci.yml` | Modify | Add `breaking-change-check` job running the classifier |
| `docs/migrations/_template.md` | Create | Migration guide template (copy per endpoint) |
| `docs/api/changelog.json` | Create | Generated changelog (committed) |
| `docs/api/changelog.md` | Create | Generated changelog MD (committed, served at static site) |

## Interfaces / Contracts — API Versioning

### Route Registration Pattern

```typescript
// apps/api/src/server.ts
const fastify = Fastify({ logger: true });

// Plugins registered ONCE per major version
await fastify.register(sociosRoutes, { prefix: '/api/v1' });
await fastify.register(ctacteRoutes, { prefix: '/api/v1' });

// v2 (when released):
// await fastify.register(sociosRoutesV2, { prefix: '/api/v2' });
```

### Version Header Plugin

```typescript
// packages/versioning/src/header.ts
const versionRegex = /^\/api\/(v\d+)\//;
fastify.addHook('onRequest', async (request) => {
  const m = request.url.match(versionRegex);
  if (m) request.apiVersion = m[1];
});
fastify.addHook('onSend', async (request, reply, payload) => {
  if (request.apiVersion) reply.header('API-Version', request.apiVersion);
  return payload;
});
```

### Deprecation Registry

```typescript
// packages/versioning/src/deprecation.ts
interface DeprecationEntry {
  deprecatedAt: Date;
  sunset: Date;
  migrationGuideUrl: string;
}

const deprecationRegistry = new Map<string, DeprecationEntry>();

// Registering a deprecation:
deprecationRegistry.set('GET:v1:/api/v1/legacy-report', {
  deprecatedAt: new Date('2026-01-15'),
  sunset: new Date('2026-07-15'),
  migrationGuideUrl: 'https://docs.athlos.example.com/migrations/legacy-report',
});
```

### Version Discovery Response

```json
{
  "versions": [
    {
      "version": "v1",
      "status": "current",
      "release_date": "2026-01-01",
      "sunset_date": null,
      "migration_guide_url": null
    }
  ]
}
```

### Changelog Entry

```json
{
  "date": "2026-03-15",
  "version": "v1",
  "type": "added",
  "endpoint": "/api/v1/socios/{id}",
  "description": "Added optional categoria field to Socio response"
}
```

## Testing Strategy — API Versioning

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `versionRegex` extracts `v1` from `/api/v1/socios` | Vitest: assert match result |
| Unit | `versionRegex` returns null for `/health` | Vitest: assert no match |
| Unit | `versionRegex` rejects non-numeric `v1a` | Vitest: assert no match |
| Unit | `API-Version` header set on `/api/v1/...` response | Vitest: GET, assert header = `"v1"` |
| Unit | `API-Version` header absent on `/health` | Vitest: GET /health, assert no header |
| Unit | Deprecated route: 3 headers + Warning within 30 days | Vitest: register entry with sunset=now+10days, assert all 4 headers |
| Unit | Warning header absent when sunset > 30 days away | Vitest: sunset=now+60days, assert no Warning |
| Unit | `GET /api/versions` returns supported versions | Vitest: assert 200 + versions array |
| Unit | `breaking-change-check` classifies field removal as breaking | Vitest: diff with field removed → assert classification=breaking |
| Unit | `breaking-change-check` classifies new optional field as non-breaking | Vitest: diff with new field → assert classification=non-breaking |
| Unit | `generate-changelog` parses spec requirements into entries | Vitest: fixture spec.md → assert entries array |
| Integration | `GET /api/v1/socios` returns `API-Version: v1` | Testcontainers: full app, assert header |
| Integration | `GET /api/v3/socios` returns 404 with `NOT_FOUND` | Testcontainers: assert 404 + ApiError shape |
| Integration | Deprecated endpoint 90 days from sunset still functional | Testcontainers: assert 200 + all deprecation headers |
| Integration | v2 routes don't fire v1 handlers | Testcontainers: GET /api/v2/socios → assert v2 handler executed (mock) |
| E2E | Full changelog query flow | Playwright: GET /api/v1/changelog → assert entries |

## Migration / Rollback — API Versioning

**Migration**: No database migration required. The versioning infrastructure is purely runtime (plugins, registry, scripts). `supportedVersions` starts with only v1. v2 is added at release time by editing the static config.

**Rollback**: The deprecation registry is in-memory and re-populated at boot from the version config. If a deprecation is added in error, remove the entry and redeploy — no DB cleanup. The `generate-changelog` script is idempotent and run on every CI build; the changelog files are committed to the repo, so rolling back the script output is a `git revert`. The `breaking-change-check` script is a CI gate only — disabling it in an emergency is a single workflow change.

## Open Questions — API Versioning

- [ ] Should the `API-Version` header include the minor/patch version (e.g., `v1.2.3`) or just the major (`v1`)? The spec says "set to the major version" — this is unambiguous, but do we want a separate `API-Version-Detail` header for the full semver?
- [ ] For the changelog, should `type: "removed"` be a separate entry from `type: "deprecated"` (i.e., on sunset date the deprecation entry becomes a removal entry), or is the `sunset_date` field sufficient to mark the transition?
- [ ] The `breaking-change-check` script's rule-based classifier may miss subtle changes (e.g., a field that becomes `null` in some conditions but not others). Should the script also require a human reviewer to acknowledge the classification, or is the PR comment sufficient?
- [ ] Does the migration guide hosting strategy satisfy the spec's "reachable via the `Link` header" requirement? The design assumes a static docs site at `https://docs.athlos.example.com/migrations/{slug}.md` — what's the actual hosting plan (GitHub Pages, custom domain, etc.)?
- [ ] Should the deprecation registry be persisted to disk (e.g., a JSON config) or is code-level registration acceptable for v1's small surface area?
- [ ] When a new version is released (v2), should v1 endpoints automatically start emitting `Deprecation: true` on day 1, or is that a separate explicit "announce deprecation" action that updates the registry?

---

## Database Migrations Design

### Decision: Migration File Location — `packages/db/migrations/`

**Choice**: Generated `.sql` files live at `packages/db/migrations/`, alongside `meta/_journal.json` and `meta/_snapshot.json`. Schema source remains at `packages/db/src/schema/`. `drizzle.config.ts` lives at `packages/db/drizzle.config.ts` with `schema: './src/schema/*.ts'`, `out: './migrations'`, and `dialect: 'postgresql'`.

**Alternatives considered**: `db/migrations/` at repo root (the data-access-layer section originally referenced both — already-merged sections use `db/migrations/NNNN_*.sql` for files but the data-access-layer section also calls for `packages/db/drizzle.config.ts` with `migrationsFolder: './packages/db/migrations'`). Repo-root `db/migrations/` (fragments migration ownership away from the `packages/db` package; the generator and consumer are co-located in the same package, which is the canonical Drizzle layout).

**Rationale**: The spec mandates `packages/db/migrations/`. Co-locating config, schema, and migration output in the `@athlos/db` package means a single `pnpm --filter @athlos/db generate` command produces and a single `pnpm --filter @athlos/db status` command consumes them. The 13 existing migration references in earlier sections of this design (0005_operators.sql, 0006_approval_tokens.sql, 0007_failed_records.sql, 0008_api_keys.sql, 0008_notifications.sql, 0009_user_management.sql, 0009_job_runs.sql, 0009_app_version.sql) need their paths normalized to `packages/db/migrations/` in the apply phase — that normalization is part of the migration-tooling work item, not a design-time change.

### Decision: Naming Convention — Timestamp-Prefixed `YYYYMMDDHHMMSS_name.sql` with Transition Plan from 4-Digit Sequential

**Choice**: All new migrations use `YYYYMMDDHHMMSS_<purpose>.sql` (14-digit UTC timestamp + snake_case purpose). The 8 pre-existing files in this design's references (0005–0009) are accepted as historical artifacts and RENAMED in a one-time transition commit so the whole set is monotonically sortable and rename-collision-free. `drizzle-kit generate` produces the new format natively — no custom tool needed.

**Alternatives considered**: 4-digit sequential (0001, 0002, …) — short, human-friendly, but caps at 9999 files (irrelevant at this project's scale) and has the same problem as the existing pattern: a developer who generates two PRs in parallel both picking `0042` causes a merge conflict and a rename. 6-digit hex/random suffix (e.g., `0001a3_add_operators`) — collision-resistant but unsearchable in `git log -- migrations/`. Year-month folder layout (`migrations/2026/06/`) — adds path complexity without solving the merge-conflict root cause.

**Rationale**: The spec mandates timestamp prefixing. The format is globally sortable, naturally conflict-free when two devs generate in parallel (timestamps differ by seconds, not by 1), and the timestamp doubles as a creation audit trail. 4-digit sequential was a placeholder used by earlier sections of this design; collapsing to a single convention is a one-time cost, not an ongoing one. The 5 historical files get new timestamps on the date of the tooling transition commit; their `id` in `_journal.json` and the entries in `__drizzle_migrations` are also re-keyed in the same commit (see Migration / Rollback section).

### Decision: Runtime Concurrency — `pg_advisory_lock(<lock_id>)` in a Custom `runMigrations()` Wrapper

**Choice**: A custom `runMigrations(db)` function in `packages/db/src/migrator.ts` wraps `drizzle-orm/node-postgres/migrator`'s `migrate()`. Before reading `__drizzle_migrations`, it executes `SELECT pg_advisory_lock(<LOCK_ID>)` on a dedicated connection. After all migrations complete (or fail), it executes `SELECT pg_advisory_unlock(<LOCK_ID>)` in `finally`. The dedicated connection is held for the lock's lifetime, separate from the migrator's internal connection.

**LOCK_ID**: derived as `hash('athlos-migrations') & 0x7fffffff` (positive int4). Constant exported from `packages/db/src/migrator.ts`. Documented in code as "do not reuse for any other advisory lock."

**Alternatives considered**: Drizzle's built-in `migrate()` with no wrapper (runs the whole migration loop without coordination — two concurrent processes can both decide "I am the migrator" and interleave `INSERT INTO __drizzle_migrations`). Advisory lock per-migration (per-migration lock acquisition triples the round-trips and still doesn't solve the "two runners both think they're the leader" problem). External coordination via Redis SETNX (adds a runtime dependency just for migration sequencing).

**Rationale**: `pg_advisory_lock` is session-scoped and is the standard PostgreSQL idiom for cross-process serialization on a single instance. A dedicated connection guarantees the lock survives the migrator's internal transaction boundaries. The lock is released in `finally` even on crash-induced transaction abort, because advisory locks are tied to the session, not the transaction.

### Decision: Lock-Wait Timeout — 30s Wait, 5min Hard Cap via Two-Layer Defense

**Choice**: Two-layer timeout. (1) `SET LOCAL lock_timeout = '30s'` on the dedicated lock-acquisition connection: PostgreSQL aborts the `pg_advisory_lock` call after 30s with SQLSTATE `55P03` (lock_not_available). (2) An outer wall-clock `Promise.race` of 5min (`MIGRATION_LOCK_TIMEOUT_HARD_MS = 300_000`) wrapping the entire `runMigrations()` call. If the wall clock fires, the process logs `MIGRATION_LOCK_TIMEOUT`, exits with code 75 (`EX_TEMPFAIL`), and the API does NOT start.

**On 30s `lock_timeout`**: the runner aborts cleanly with a clear log line. Operator sees "another instance is mid-migration, aborting." This is the normal case for parallel deploys.

**On 5min hard cap**: only reachable if the lock holder is stuck inside a single statement that ignores `lock_timeout` (none should — but defense in depth). Logs include `pg_stat_activity` snapshot to aid diagnosis.

**Alternatives considered**: Single 5min cap (too long — a stuck migrator holds the lock and the second runner waits 5min before doing anything useful). 30s cap only (crash-induced lock leakage makes the second runner abort indefinitely until the first session is reaped — acceptable for v1 but a 5min safety cap is cheap). Infinite wait with `--force` override (the deployment-devops section already uses `drizzle migrate --force` — adding force-overrides to production migration sequencing is the wrong escape hatch).

**Rationale**: 30s is the canonical "deploy overlap" window (two replicas starting within the orchestrator's rolling-update window). 5min is the upper bound of "something has gone wrong and an operator should be paged." The two-layer defense maps cleanly to the two failure modes: normal contention → 30s abort; pathological hold → 5min abort with diagnostics.

### Decision: Per-Migration Statement Timeout — `SET LOCAL statement_timeout = '30s'`, Per-Migration Override via `--statement-timeout`

**Choice**: Inside the wrapper, for each migration file, open a transaction, execute `SET LOCAL statement_timeout = '30s'` first, then run the migration SQL. The 30s default applies to every statement; data-only backfills that legitimately need longer (e.g., `UPDATE` of millions of rows) declare a per-migration override via a sentinel line in the SQL file:

```sql
-- @athlos:statement-timeout 5min
ALTER TABLE socios ADD COLUMN email TEXT;
UPDATE socios SET email = legacy_email WHERE email IS NULL;
```

The wrapper parses the first comment block of each file for `@athlos:statement-timeout <duration>` and applies `SET LOCAL statement_timeout = '<duration>'` instead of the default. The override is recorded in the migration's `audit_events` entry.

**Alternatives considered**: Per-package default (single global timeout — backfills with millions of rows need a one-off exception and a single global value forces a choice between "fast fail common cases" and "tolerate big backfills"). Environment-variable override only (`STATEMENT_TIMEOUT_MS` for the whole run — too coarse, doesn't let a DDL migration use 30s while a backfill in the same PR uses 5min). Per-migration file with a sidecar metadata file (`*.toml` next to `*.sql` — Drizzle's `generate` doesn't know about sidecars; we don't want hand-edited metadata to drift from the SQL).

**Rationale**: The in-file sentinel is co-located with the SQL it controls, requires no extra tooling, and survives `drizzle-kit generate` rewriting the file (the wrapper reads the sentinel before execution; the generator never strips comments). 30s is generous for DDL (a `CREATE INDEX CONCURRENTLY` on a small table is sub-second) and tight enough to catch runaway DML. The override is opt-in per file, so the 30s default protects the common case.

### Decision: Destructive-Change Gate — `db-destructive` GitHub PR Label, Enforced by CI

**Choice**: A GitHub label `db-destructive` is applied to the PR (manually by the reviewer OR automatically by a labeler rule on path change in `packages/db/migrations/`). The CI workflow `.github/workflows/ci.yml` has a `check-destructive-migrations` job that: (1) diffs `packages/db/migrations/` between the PR head and the merge base, (2) scans the diff for destructive SQL patterns (`DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA)`, `TRUNCATE`, `DELETE\s+FROM\s+\w+\s*;` without `WHERE`, `ALTER\s+TABLE\s+\w+\s+DROP`, `ALTER\s+TYPE\s+\w+\s+RENAME ATTR` on a column with data), (3) if destructive patterns are found AND the `db-destructive` label is NOT present, the job FAILS with a clear error pointing to the offending migration filename. If the label IS present, the job emits a `warning` PR comment listing the detected patterns for reviewer visibility.

**Alternatives considered**: Block destructive migrations entirely at the CI level (forces "forward-only forward-fix" as the ONLY way — too strict for legitimate cases like removing a feature). Manual review checklist in `CONTRIBUTING.md` only (no automated gate, relies on reviewer attention — fails under pressure). Require a separate `db-destructive-approved` label applied by a CODEOWNER (adds a manual bottleneck; the simpler `db-destructive` label is sufficient for v1).

**Rationale**: The spec says destructive changes "SHALL require an explicit PR label `db-destructive`". The CI gate enforces the requirement mechanically — the label is meaningful because its presence is the only thing that lets a destructive migration pass the gate. Manual-only labels get forgotten; the auto-detector (labeler by path) provides a default, and a reviewer can add/remove the label as needed.

### Decision: Pre-Deploy Backup — Conditional `pg_dump` Step in `docker-entrypoint.sh` When `db-destructive` Label Is Present

**Choice**: The production entrypoint script accepts a new env var `BACKUP_BEFORE_MIGRATE` (default `false`). The CI deploy job, after applying labels to the running environment, inspects the merged commit's PR (or a deploy-time manifest file) and sets `BACKUP_BEFORE_MIGRATE=true` when the change includes any migration that touched `packages/db/migrations/` AND the originating PR had the `db-destructive` label. When set, the entrypoint runs `pg_dump --format=custom --no-owner --no-acl --file=/tmp/pre-deploy-<sha>.dump "$DATABASE_URL"` then uploads via `aws s3 cp` (or compatible S3 client) to `s3://${BACKUP_BUCKET}/pre-deploy-<sha>.dump`. If the upload fails, the entrypoint exits with code 1 BEFORE running migrations.

**Decision matrix** (in the entrypoint, ordered):
1. `if [ "$BACKUP_BEFORE_MIGRATE" = "true" ]; then pg_dump ...; if [ $? -ne 0 ]; then exit 1; fi; s3 cp ...; if [ $? -ne 0 ]; then exit 1; fi; fi`
2. `npx drizzle migrate --force` (unchanged from deployment-devops section)
3. `exec node dist/index.js` (unchanged)

**Alternatives considered**: Always backup (wasteful for non-destructive deploys, doubles deploy time on a 100GB database). Per-migration backup (granular but requires parsing migrations at deploy time — not worth the complexity for v1). Backup via a sidecar `backup` service in docker-compose (orchestration overhead; the entrypoint pattern is already established).

**Rationale**: The spec mandates backup "immediately before the deploy" for destructive PRs. The env-var flag is the simplest way to communicate "this deploy is destructive" from CI to the runtime without coupling the entrypoint to GitHub. The deploy job already knows the SHA and the PR labels — passing that context via env is the natural seam.

### Decision: Snapshot Drift Gate — `drizzle-kit check` on Every PR

**Choice**: A CI job `db-drift-check` runs on every PR that touches `packages/db/`. Steps:
1. `pnpm install` (cache hit if `pnpm-lock.yaml` is unchanged)
2. `pnpm --filter @athlos/db generate --dry` (diff only, do NOT write new files)
3. `git diff --exit-code packages/db/migrations/` (FAILS if the dry-run would have produced a new file)
4. `drizzle-kit check` (FAILS if the committed `_snapshot.json` does not match the schema inferred from `src/schema/*.ts`)

The job also runs on a daily cron schedule (catches out-of-band DB changes from manual psql sessions). Cron failures post to a designated Slack channel via the project's existing notification surface.

**Alternatives considered**: `drizzle-kit check` only on PRs (misses manual schema drift between PRs). Pre-commit hook only (no enforcement on `main` — devs can bypass with `--no-verify`). Drift detection via a separate cron comparing `information_schema` to `_snapshot.json` (requires production DB access from CI — adds credential surface).

**Rationale**: `drizzle-kit check` is the canonical Drizzle drift detection. Running it on every PR blocks the most common drift vector (forgetting to commit a generated migration). The cron job catches the rare case of a developer hand-editing the production DB outside the migration pipeline.

### Decision: `status` Subcommand — Read-Only Drift Report Exits Non-Zero on Mismatch

**Choice**: `packages/db` exposes a `status` script in its `package.json`:
```json
"status": "tsx src/status.ts"
```
The script (1) connects with a read-only role (`SELECT`-only, no DDL), (2) runs `drizzle-kit check` against the live database, (3) reads `__drizzle_migrations` via `SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id`, (4) lists the local committed files in `packages/db/migrations/` (excluding `meta/`), (5) computes `applied ∩ local` (OK), `applied − local` (DB has migrations not in the repo — DIVERGENCE), `local − applied` (repo has migrations not applied — PENDING), and (6) exits 0 when applied ⊇ local AND no drift, exits 1 otherwise. Output is human-readable text; JSON output is gated behind `--json` for monitoring scripts.

**Alternatives considered**: Reuse `drizzle-kit check` exit code (the tool doesn't ship a "pending migrations" report — it only checks the schema snapshot, not the migration history). Custom CLI subcommand inside the migrator wrapper (the `status` script is a thin shim around `drizzle-kit check` + a SQL query — promoting it to a subcommand adds CLI surface for a one-off query).

**Rationale**: The spec explicitly defines `pnpm --filter @athlos/db status` as the operator-facing command. A dedicated script keeps the implementation in TypeScript (same language as the rest of the toolchain) and produces a human-friendly report. The `drizzle-kit check` exit code alone is insufficient because it can't tell the operator "you have 2 pending migrations ready to apply" — only the SQL query against `__drizzle_migrations` can do that.

### Decision: Data-Only Backfill Convention — `*_backfill_<purpose>.sql`, Idempotent, DDL-Free

**Choice**: Backfills live in the same `packages/db/migrations/` folder but follow a strict naming suffix `*_backfill_<purpose>.sql` (e.g., `20260612120000_backfill_socios_email.sql`). The wrapper enforces (via lint rule + CI check) that any file matching `*_backfill_*.sql` contains NO DDL keywords outside `CREATE TABLE ... AS SELECT` patterns (and only when explicitly whitelisted). Backfill files MUST use `ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`, or `WHERE <condition>` on every mutating statement. The lint rule is a small Node script invoked from CI that greps the file for `INSERT|UPDATE|DELETE` without the idempotency guard.

**Alternatives considered**: Separate `packages/db/backfills/` folder (fragments the migration ordering — backfills need to apply AFTER the schema they reference, and Drizzle's `drizzle-kit generate` orders by timestamp suffix, not by folder). Inline backfill in the schema migration (forces mixing DDL and DML, violating the spec's "SHALL NOT mix DDL with DML"). No lint rule, trust + review (relies on reviewer discipline for a class of migration that's easy to get wrong).

**Rationale**: A separate suffix but the same folder keeps Drizzle's ordering correct (timestamps are sortable, the suffix is human-readable) and lets the lint rule target the right files. The idempotency requirement is mechanically enforced — "always use ON CONFLICT or WHERE" is checkable in CI without semantic understanding.

### Decision: Migration Transaction Semantics — One Transaction Per File, Failure Rolls Back, API Exits Non-Zero

**Choice**: The wrapper wraps each `.sql` file in a `BEGIN ... COMMIT` transaction. On any statement error inside the transaction, PostgreSQL rolls back the whole file (no partial application), the wrapper logs the failing filename + SQLSTATE + first 200 chars of the failing statement, the `INSERT INTO __drizzle_migrations` does NOT happen, the entrypoint exits with code 1, and the API process never starts. `CREATE INDEX CONCURRENTLY` and other statements that cannot run inside a transaction are prefixed with `-- @athlos:no-transaction` and the wrapper skips `BEGIN/COMMIT` for those files (each statement auto-commits; the wrapper still logs and exits on any error).

**Alternatives considered**: All migrations in one giant transaction (one failure rolls back ALL pending migrations — operator has to re-run from scratch, painful on a 50-migration deploy). Per-statement transaction (loses the "all-or-nothing" property of a migration — partial application is worse than no application). No transaction, just `drizzle migrate` defaults (Drizzle's default DOES wrap each file in a transaction, so this is the baseline — the decision is just to make it explicit and to support the `no-transaction` opt-out for `CONCURRENTLY`).

**Rationale**: The spec is explicit: "Each migration SHALL run in a transaction." The opt-out is needed for the documented cases (`CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM` outside a txn) and is narrowly scoped via the sentinel comment.

## Data Flow — Database Migrations

```
Startup                                                              Steady State
─────────                                                            ────────────

docker-entrypoint.sh                                                Drizzle-orm runtime
   │                                                                      │
   │ 1. read BACKUP_BEFORE_MIGRATE                                         │
   │ 2. if true: pg_dump → s3 cp                                           │
   │ 3. drizzle migrate --force                                            │
   │      │                                                               │
   │      ▼                                                               │
   │  packages/db/src/migrator.ts:runMigrations()                          │
   │      │                                                               │
   │      ├── acquire conn_lock (dedicated)                                │
   │      ├── SET LOCAL lock_timeout = '30s'                               │
   │      ├── SELECT pg_advisory_lock(ATHLOS_LOCK_ID)                      │
   │      │      │                                                        │
   │      │      ├─ granted ──► for each *.sql in migrations/:             │
   │      │      │                     │                                   │
   │      │      │                     ├── parse @athlos:statement-timeout  │
   │      │      │                     ├── BEGIN                           │
   │      │      │                     ├── SET LOCAL statement_timeout      │
   │      │      │                     ├── run sql                         │
   │      │      │                     ├── INSERT __drizzle_migrations     │
   │      │      │                     └── COMMIT                          │
   │      │      │                                                        │
   │      │      └─ timeout (55P03) ──► exit 75, API does not start       │
   │      │                                                               │
   │      ├── SELECT pg_advisory_unlock(...)                               │
   │      ├── release conn_lock                                           │
   │      └── return                                                      │
   │                                                                      │
   ├── 4. exec node dist/index.js (API starts)                            │
   │                                                                      │
   │                                                                      ▼
   │                                                              apps/api route handlers
   │                                                              (no DDL, no advisory locks)
   ▼
 running
```

### CI

```
PR opened / push
   │
   ├── job: db-drift-check
   │     ├── pnpm install (cache)
   │     ├── pnpm --filter @athlos/db generate --dry
   │     ├── git diff --exit-code packages/db/migrations/
   │     └── drizzle-kit check
   │           │
   │           ├─ clean ──► continue
   │           └─ diff ──► fail (block merge)
   │
   ├── job: check-destructive-migrations
   │     ├── diff packages/db/migrations/ vs merge-base
   │     ├── grep for DROP/TRUNCATE/DELETE-FROM patterns
   │     ├── if destructive && !label(db-destructive) ──► fail
   │     └── if destructive && label(db-destructive) ──► warn comment
   │
   └── job: db-migrate-on-ephemeral-pg
         ├── spin up postgres:16 service
         ├── pnpm --filter @athlos/db generate
         ├── npx drizzle migrate
         ├── run schema-introspection tests
         └── cleanup

Daily cron
   │
   └── job: db-drift-check (production snapshot)
         ├── pg_dump --schema-only to /tmp
         ├── drizzle-kit check against the dump
         └── notify on failure
```

## File Changes — Database Migrations Addition

| File | Action | Description |
|------|--------|-------------|
| `packages/db/drizzle.config.ts` | Create | Drizzle Kit config: schema glob, out folder, dialect, dbCredentials |
| `packages/db/src/migrator.ts` | Create | `runMigrations(db, opts)` wrapper: advisory lock, timeouts, per-file transactions, sentinel parsing |
| `packages/db/src/status.ts` | Create | `status(db, { json })` read-only drift + history report |
| `packages/db/src/lock-id.ts` | Create | Exported `ATHLOS_LOCK_ID` constant (derived from `hash('athlos-migrations') & 0x7fffffff`) |
| `packages/db/src/lint-no-ddl-in-backfill.ts` | Create | Node script: scan `*_backfill_*.sql`, fail if DDL keywords present outside whitelist |
| `packages/db/package.json` | Modify | Add scripts: `generate`, `migrate`, `status`, `lint:backfills`, `check` |
| `docker-entrypoint.sh` | Modify | Add `BACKUP_BEFORE_MIGRATE` branch (pg_dump + s3 cp) before the `drizzle migrate` call |
| `.github/workflows/ci.yml` | Modify | Add jobs: `db-drift-check`, `check-destructive-migrations`, `db-migrate-on-ephemeral-pg`; add daily cron |
| `.github/labeler.yml` | Create | Auto-label PRs that touch `packages/db/migrations/**` with `db-destructive` candidate (reviewer removes if not destructive) |
| `packages/db/migrations/` | Modify | Rename historical files `0005_*.sql` … `0009_*.sql` to `20260612HHMMSS_*.sql`; update `meta/_journal.json` IDs; record re-key in transition commit |
| `CONTRIBUTING.md` | Modify | Document: forward-only rollback, `db-destructive` label workflow, `pnpm status` usage |
| `packages/db/README.md` | Create | Migration workflow: generate → review → commit → deploy; backfill conventions; timeouts |

## Interfaces / Contracts — Database Migrations

### `runMigrations()`

```typescript
// packages/db/src/migrator.ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface MigrateOptions {
  /** Path to migrations folder. Default: './packages/db/migrations' */
  migrationsFolder?: string;
  /** Lock-wait timeout in ms. Default: 30_000 */
  lockTimeoutMs?: number;
  /** Hard wall-clock cap in ms. Default: 300_000 (5min) */
  hardTimeoutMs?: number;
  /** Statement timeout in ms (overridable per file via sentinel). Default: 30_000 */
  defaultStatementTimeoutMs?: number;
}

export type MigrateResult =
  | { status: 'applied'; applied: string[]; durationMs: number }
  | { status: 'noop'; pending: string[]; durationMs: number }
  | { status: 'lock_timeout'; durationMs: number }
  | { status: 'hard_timeout'; durationMs: number; snapshot: PgStatActivity[] }
  | { status: 'failed'; failedFile: string; sqlstate: string; message: string };

export async function runMigrations(
  db: NodePgDatabase,
  opts: MigrateOptions = {}
): Promise<MigrateResult>;
```

### Sentinel Comment Format

```sql
-- @athlos:statement-timeout 5min
-- @athlos:no-transaction
-- (one or both, in any order, in the first comment block)
ALTER TABLE socios ADD COLUMN email TEXT;
```

The wrapper parses ONLY the first contiguous comment block at the top of the file. Subsequent comments are treated as SQL comments and ignored.

### `drizzle.config.ts`

```typescript
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: ['athlos_*'],
  strict: true,
  verbose: true,
});
```

### `status` Script Output (text mode)

```
Athlos migration status
  Database:   postgresql://...@db:5432/athlos
  Snapshot:   in sync with packages/db/src/schema/
  Pending:    0
  Applied:    17
  Drifted:    no

  Last applied:
    2026-06-12T14:23:01Z  20260612120000_add_operators.sql        3f9a...c1
    2026-06-12T14:23:01Z  20260612120100_add_approval_tokens.sql  8b2e...d4
    ...
exit 0
```

When drift is detected, the script lists each divergence line and exits 1. JSON mode (`--json`) emits a structured object with the same data for monitoring.

## Testing Strategy — Database Migrations

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `ATHLOS_LOCK_ID` is positive int4 | Vitest: assert `Number.isInteger(id) && id > 0 && id <= 0x7fffffff` |
| Unit | Sentinel parser extracts `statement-timeout` and `no-transaction` | Vitest: fixture SQL with both sentinels → assert parsed object |
| Unit | Sentinel parser ignores sentinels outside the first comment block | Vitest: SQL with sentinel in middle → assert no extraction |
| Unit | Status script computes applied/pending/divergence sets | Vitest: mock DB rows + filesystem listing → assert set ops |
| Unit | Lint script flags DDL in `*_backfill_*.sql` | Vitest: fixture with `ALTER TABLE` in backfill → assert exit 1 |
| Unit | Lint script allows whitelisted `CREATE TABLE AS SELECT` in backfill | Vitest: fixture with `CREATE TABLE foo AS SELECT ...` → assert exit 0 |
| Integration | Advisory lock blocks a second runner | Testcontainers: runner A acquires, runner B times out at 30s with `lock_timeout` |
| Integration | Per-file transaction rolls back on third-statement failure | Testcontainers: SQL with intentional error → assert no rows in `__drizzle_migrations` for that file |
| Integration | `statement_timeout` aborts a slow `UPDATE` | Testcontainers: `pg_sleep(60)` with `SET LOCAL statement_timeout='30s'` → assert 57014 (query_canceled) |
| Integration | `--no-transaction` sentinel skips `BEGIN`/`COMMIT` | Testcontainers: file with `CREATE INDEX CONCURRENTLY` + sentinel → assert index created, no txn in pg_stat_activity |
| Integration | `pg_dump` + restore roundtrip | Testcontainers: dump current DB, drop, restore from dump, assert schema matches |
| Integration | `drizzle-kit check` fails after manual `psql` schema change | Testcontainers: alter a table, run check, assert exit 1 |
| Integration | Status script exits 0 on clean DB, 1 on pending migrations | Testcontainers: empty DB (exit 0 with "Pending: 0" if schema is current) / unapplied migration (exit 1) |
| E2E | Entrypoint with `BACKUP_BEFORE_MIGRATE=true` writes dump to S3 (or local mock) | Docker compose: set env, run entrypoint, assert dump file exists, assert `drizzle migrate` ran after |
| E2E | Entrypoint with `BACKUP_BEFORE_MIGRATE=false` skips dump | Docker compose: set env, run entrypoint, assert no dump file, assert migrate ran |
| E2E | CI gate blocks PR without `db-destructive` label | gh CLI: create PR with destructive migration, no label → assert `db-drift-check` job fails |

## Migration / Rollback — Database Migrations

**Migration** (the tooling itself, not a database migration): The transition from 4-digit sequential to timestamp-prefixed filenames requires a one-time commit that:
1. Renames `0005_operators.sql` → `20260612T120000_operators.sql` (assigning the timestamp of the transition commit, NOT the original creation date — the original date is lost; this is acceptable because the migration is already applied and the `id` in `__drizzle_migrations` is the source of truth for ordering).
2. Re-keys each renamed file's entry in `meta/_journal.json` (the `idx` field) to a monotonic sequence (0, 1, 2, …) starting from the first historical file.
3. Documents the rename in the commit message: `chore(db): rename migrations to timestamp-prefixed format`.
4. Does NOT touch `__drizzle_migrations` — the on-disk filenames are an output artifact; the journal entries are matched by `id` in the table.

The wrapper reads `meta/_journal.json` for the on-disk ordering; the DB records in `__drizzle_migrations` are matched by `hash` for the actual apply. After the transition commit, all NEW migrations are timestamp-prefixed by `drizzle-kit generate`.

**Rollback** (of any deployed migration): The spec is explicit: forward-only. If a deployed migration breaks production, the rollback procedure is:
1. Identify the failing migration filename (e.g., `20260615T103000_add_column_foo.sql`).
2. Author a new migration that undoes the breakage: `ALTER TABLE bar DROP COLUMN foo` is the wrong move if the column is referenced by application code; instead, write a forward-fix migration that re-adds a corrected column, back-fills from a snapshot table, and re-points application code.
3. Do NOT edit the original migration post-merge.
4. The new forward-fix migration is named with a fresh timestamp and is reviewable independently.

**Pre-deploy backup restoration** (when a destructive migration went wrong despite the gate): `pg_dump` dumps were uploaded to `s3://${BACKUP_BUCKET}/pre-deploy-<sha>.dump`. Restoration:
```bash
# 1. Stop API (so no live writes)
docker compose stop api
# 2. Drop and recreate the schema (NOT the whole database — preserve roles, grants, extensions)
PGPASSWORD=$POSTGRES_PASSWORD psql -h db -U $POSTGRES_USER -d athlos \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# 3. Restore from the dump
pg_restore -h db -U $POSTGRES_USER -d athlos --no-owner --no-acl --clean --if-exists \
  s3://${BACKUP_BUCKET}/pre-deploy-<sha>.dump
# 4. Restart API on the PREVIOUS image tag
docker compose up -d api
```

## Open Questions — Database Migrations

- [ ] The spec says the lock-wait timeout is 30s, but the migration lock timeout is 5min. The first is for the `pg_advisory_lock` acquisition; the second is for the total run. Are these two values the right defaults, or should the per-migration default `statement_timeout` (also 30s) be aligned with the lock-wait timeout to make the "30s" meaning unambiguous across the three contexts?
- [ ] The `BACKUP_BEFORE_MIGRATE` flag is set by CI at deploy time. For local dev (`docker compose up`), the flag defaults to `false` — destructive migrations run without a backup. Is that acceptable, or should dev compose files default it to `true` for safety?
- [ ] The destructive-pattern detector uses regex on the migration SQL. Some destructive changes are semantically destructive but syntactically innocuous (e.g., `ALTER TABLE foo ADD CONSTRAINT ... NOT NULL` on a table with existing rows — DDL but causes a full table rewrite). Should the detector also flag these, or is the reviewer expected to catch them?
- [ ] `pg_dump` for a 100GB database can take 10+ minutes, blocking the deploy. Should the entrypoint run the dump asynchronously (in the background) and let migrations proceed in parallel, accepting the window where the DB is un-backed-up but a migration is running? Or is the serial "backup first, then migrate" the right default?
- [ ] The status script uses a read-only role. PostgreSQL doesn't have a built-in read-only role for DDL-impacting queries like `drizzle-kit check`. Does the read-only role need to be created explicitly (with `GRANT SELECT ON ALL TABLES` + `GRANT USAGE ON SCHEMA`), and is the maintenance cost of keeping that role's grants in sync worth the safety?
- [ ] When a developer generates a migration locally and forgets to commit it (only commits the schema change), CI's `drizzle-kit check` will fail. The fix is "regenerate and commit the migration." Is there a way to make `drizzle-kit generate` auto-run as a pre-commit hook, or is that overreach for v1?
- [ ] The transition commit renames historical migrations to timestamp format. After this commit, anyone with a clone that pre-dates the rename will see a confusing diff on pull. Should the rename be coordinated with a `git mv` PR that the whole team reviews, or is "rename in one commit, force the team to re-clone" acceptable for a 1-developer team?

---

## File Storage Design

### Decision: Storage Abstraction — Narrow Five-Method Interface, Stream-Based I/O

**Choice**: A `FileStorage` interface in `packages/storage/src/types.ts` with five methods that all operate on `Readable`/`Writable` Node streams and a typed `FileMetadata` object — never raw `Buffer`s:

| Method | Signature | Purpose |
|---|---|---|
| `put(key, source, meta)` | `(string, Readable, FileMetadata) => Promise<{ size, hash }>` | Write streamed bytes; return computed size + SHA-256 |
| `get(key)` | `(string) => Promise<Readable>` | Open read stream |
| `delete(key)` | `(string) => Promise<void>` | Remove object |
| `exists(key)` | `(string) => Promise<boolean>` | Cheap existence probe |
| `getMetadata(key)` | `(string) => Promise<FileMetadata>` | Read size/mime/hash without streaming bytes |

**Alternatives considered**: `Buffer`-based signatures (loads whole file in memory — breaks the 5 MB cap and the streaming-hash requirement); a single `request(operation, ...)` polymorphic method (loses type safety, hides the operation surface); S3-specific SDK passthrough as the interface (locks v1 to one vendor).

**Rationale**: Streams are the only way to keep memory flat at the 5 MB cap and to compute SHA-256 incrementally during write (spec requirement). The 5-method surface is the minimum that lets the v2 S3 backend be a 1:1 mapping (`put`→`Upload`, `get`→`GetObject`, etc.) without leaking backend concepts. `getMetadata` exists separately from `exists` because metadata read in S3 is a `HeadObject` call, not a list operation — the seam must be backend-honest.

### Decision: Local Backend Layout — Owner-Scoped Sharding, Server-Controlled Keys

**Choice**: `LocalFileStorage` writes to `${STORAGE_LOCAL_ROOT}/{owner_type}/{owner_id}/{file_id}.{ext}`. `storage_key` stored in the `files` table is the path **relative** to `STORAGE_LOCAL_ROOT` (e.g., `socios/42/01HX5K....pdf`). The `file_id` is a server-generated ULID via `ulid` package; `ext` is derived from the **detected** MIME type (`.pdf` for `application/pdf`, `.jpg` for `image/jpeg`, `.png` for `image/png`).

**Alternatives considered**: Flat layout (one directory, 100k+ files inodes + filesystem-listing O(n) — kills backups), hash-based sharding (loses owner locality for backup operators), owner_id-only sharding without `owner_type` (collides across heterogeneous owners).

**Rationale**: Sharding by `(owner_type, owner_id)` matches the composite index in the `files` table — listing a socio's files is one `SELECT` plus a directory read. Backup operators can `tar` a single socio's directory. The `misc/{owner_type}/{owner_id}/` branch from the spec is handled by the same shape (the path component is just driven by the request's `owner_type` field). Server-controlled keys are the spec's path-traversal defense — the client never sees or influences `storage_key`.

### Decision: Upload Handler — `@fastify/multipart` with Bounded Spool, Not Direct Stream

**Choice**: Use `@fastify/multipart` with `limits: { fileSize: STORAGE_MAX_FILE_SIZE_BYTES }`. The handler **does not** stream the request body directly to disk. Instead:
1. Spool the file to a `tmp` path on the same volume via `fs.createWriteStream` (streaming), enforcing the size limit at the multipart level.
2. Once fully written, read the first 4 KB for magic-byte detection (`file-type`).
3. Verify the detected MIME is in the allowlist; otherwise `unlink` the tmp file and return 415.
4. Compute SHA-256 by re-streaming from the tmp file (the original stream is consumed).
5. `fs.rename` tmp → final `storage_key`. Atomic on the same filesystem.

**Alternatives considered**: Stream-to-final-path directly (no magic-byte check possible mid-stream without buffering; can't reject before disk write), in-memory `Buffer` (fails the 5 MB streaming-hash requirement), third-party multipart parser (`busboy` raw — `@fastify/multipart` already wraps it with the right Fastify hooks).

**Rationale**: The two-step spool-then-validate pattern is the only way to satisfy all four constraints simultaneously: (a) bounded memory, (b) magic-byte validation BEFORE the row is committed, (c) SHA-256 over the exact bytes persisted, (d) atomic placement at the final path. The `tmp` file's lifetime is bounded by the request — on handler error, the `finally` block unlinks it. A `tmp → final` rename is atomic on the same filesystem (POSIX guarantee), so a partial upload never appears at the final key.

### Decision: MIME Validation — `file-type` Magic Bytes, Not `Content-Type` Header

**Choice**: Use the `file-type` npm package (8M+ weekly downloads, ESM-native, returns `{ ext, mime }` from the first 4 KB of bytes). The 4 KB buffer comes from the tmp file's first chunk. Mapping `mime → ext` is a small lookup table maintained in the package — no custom logic.

**Alternatives considered**: `mime-types` (extension-driven, not content-driven — the spec explicitly forbids this), custom magic-byte table (reinvents `file-type` poorly, no support for new formats), Apache `mod_mime` style sniffing (server-side, not library-callable).

**Rationale**: `file-type` is the de facto Node library for content-based detection and is what the spec calls out by name. It supports the exact three MIME types in the v1 allowlist. The 4 KB read is a one-shot — no second pass, no streaming. For PDF, magic bytes are at offset 0 (`%PDF-`); for JPEG, the SOI marker is at offset 0; for PNG, the signature is at offset 0. 4 KB gives us margin for any future format where the magic is offset (e.g., OOXML).

### Decision: Integrity Hashing — Streaming SHA-256 via `Transform` Pipe

**Choice**: Pipe the multipart stream through a `crypto.createHash('sha256')` `Transform` (via `stream.pipeline`) into the tmp file. The hash is finalized **after** the full write completes. `content_hash` is populated from the hex digest before the DB `INSERT`. Buffer size: 64 KB (Node default for stream piping).

**Alternatives considered**: `hash-wasm` (faster but WebAssembly, adds WASM runtime overhead), post-write hash via second stream pass (doubles I/O — wasted bandwidth on local FS, breaks on slow S3 in v2).

**Rationale**: Hashing-as-you-write is the spec's literal requirement ("computed incrementally as bytes are written"). `stream.pipeline` ensures backpressure is honored — if the disk stalls, the source pauses; no unbounded buffering. The hash object is constructed in handler scope and `digest('hex')` is called once at end. Memory footprint: one 64 KB chunk buffer + one hash state (~200 bytes). Negligible at 5 MB scale.

### Decision: Authorization — Owner-Scoped Permission Gate, Reuse RBAC Hooks

**Choice**: A new preHandler `requireOwnerAccess('upload'|'read'|'delete')` in `packages/auth/src/owner-guard.ts`. It composes the existing `requireRole` / `requirePermission` hooks from the auth-login design plus a per-request owner check:

| Action | ADMIN | OPERADOR | CONSULTA |
|---|---|---|---|
| upload for socio X | always allowed | allowed iff `operator→socios` includes X | forbidden (role gate) |
| read/list socio X's files | always allowed | allowed iff assigned to X | allowed iff assigned to X |
| delete | always allowed | allowed iff assigned to X | forbidden (role gate) |

The `operator→socios` assignment is read from the `operator_socio_assignments` table defined in the user-management-rbac spec. The preHandler receives `owner_type`, `owner_id`, and `action` in route options and emits a 403 with the standard `INSUFFICIENT_PERMISSIONS` error code (already in `packages/errors/src/codes.ts`).

**Alternatives considered**: Per-route inline check (duplicates the matrix in 5 places, easy to drift), generic policy engine (over-engineered for 4 roles × 3 actions), denormalize assignment into JWT (assignments change — token becomes stale).

**Rationalative**: The matrix from the spec is small enough to live in one preHandler without a table-driven config. Reusing the existing `INSUFFICIENT_PERMISSIONS` error code keeps the API contract identical to the rest of the API. The 403 on `consulta` attempting delete matches the spec's "Role 'consulta' cannot delete files" message verbatim.

### Decision: Quota Enforcement — Pre-Upload SUM Query, Accepted Race

**Choice**: Two `SELECT SUM(size_bytes)` queries run inside a single transaction before writing the tmp file:
1. `SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE owner_type='operator' AND owner_id=$op AND deleted_at IS NULL` → operator quota (1 GB).
2. `SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE owner_type='socio' AND owner_id=$socio AND deleted_at IS NULL` → socio quota (10 MB).

If either sum + incoming `Content-Length` exceeds the quota, return 413 with `error='QUOTA_EXCEEDED'` and the specific quota name in the message. Both queries are `FOR SHARE` locks (PostgreSQL row-level share lock on the `files` table) to prevent two concurrent uploads from both passing the check.

**Alternatives considered**: PostgreSQL trigger that sums on INSERT (adds DDL coupling, harder to test in isolation), `pg_advisory_xact_lock(hashtext('quota:operator:'||$op))` (more complex, same end result), accept the race and over-shoot quota by a few MB (violates the 1 GB / 10 MB hard limits in the spec).

**Rationale**: A `SELECT ... FOR SHARE` on the table is the minimal-correctness lock: it blocks `INSERT`/`UPDATE`/`DELETE` on `files` rows for the duration of the transaction, but allows concurrent reads. The transaction is short (the SUMs only — the actual upload write is outside the lock, the lock is released before `fs.rename`). The race window between SUM and `INSERT` is bounded by transaction duration, not by the 5 MB upload. For 20 operators at 1 GB each, contention is negligible.

### Decision: File Metadata Schema — `files` Table Mirrors Spec Exactly, 4 Indices

**Choice**: Schema mirrors the spec's table column-for-column. `file_id` is `CHAR(26)` (ULID canonical form, fixed width — faster index scans than `TEXT`). `storage_key` is `TEXT NOT NULL` (relative path, backend-portable). `content_hash` is `CHAR(64)` (SHA-256 hex). `owner_id` is `TEXT` (supports both numeric socio IDs and future ULID-based owners like `report`).

Indices:
- `PK (file_id)` — primary key.
- `idx_files_owner (owner_type, owner_id) WHERE deleted_at IS NULL` — partial composite for listing active files per owner.
- `idx_files_uploader (uploaded_by)` — operator-scoped queries (per-operator quota is a SUM over this).
- `idx_files_retention (deleted_at) WHERE deleted_at IS NOT NULL` — partial for the retention job's daily scan.

**Alternatives considered**: UUID PK (loses ULID's time-ordering — listing `ORDER BY uploaded_at DESC` becomes a sort, not an index walk), JSONB metadata column (flexible but loses the explicit column guarantees the spec calls out), unindexed quota columns (forces a full scan per upload).

**Rationale**: The 26-char ULID is sortable lexicographically by creation time — `ORDER BY file_id DESC` gives "newest first" without a sort operation. The partial indices keep index size small: the retention index only contains soft-deleted rows (a small fraction of total). The composite `(owner_type, owner_id)` matches the listing query's WHERE clause exactly.

### Decision: Retention Job — Hook into `scheduler-jobs` as `file-purge` Cron

**Choice**: Register a new job `file-purge` with the existing `JobScheduler` from the scheduler-jobs design. Cron: `0 4 * * *` (4 AM, one hour after `token-cleanup` at 3 AM — no contention). Env: `FILE_PURGE_CRON`, default `0 4 * * *`. The handler:
1. `SELECT file_id, storage_key FROM files WHERE deleted_at < now() - INTERVAL '90 days'` (capped at 1000 rows per run to bound I/O).
2. For each row: `fileStorage.delete(storage_key)`, then `DELETE FROM files WHERE file_id=$1`.
3. Emit `audit_events` row with `action='FILE_PURGE'`, `entity_id=file_id`, `metadata={owner_type, owner_id, soft_deleted_at, hard_deleted_at}`.
4. On error mid-batch: stop the batch, log `error`, leave remaining rows for tomorrow's run (idempotent — tomorrow picks up the same set).

**Alternatives considered**: Hard-delete on `DELETE /api/v1/files/{id}` (violates the 90-day recovery window in the spec), no cron (manual operator action — forgotten, files accumulate), shorter cron (5 min) with empty-tick skip (more DB queries for the same work).

**Rationale**: The scheduler-jobs design is the existing extension point — adding a 6th cron job costs zero new infrastructure. The 1000-row batch cap bounds the worst-case duration (1000 × 5 MB / 200 MB/s = 25s) so the job always completes inside the 30s shutdown window. Idempotency-by-design: re-running the same day is safe because the `DELETE FROM files` removes the row before the next run sees it. A 4 AM tick avoids overlap with `token-cleanup` and gives the 3 AM token job time to finish on slow nights.

### Decision: Path Traversal Defense — Server-Constructed Keys, Sanitized Display Name

**Choice**: Three independent defenses:
1. `original_name` is sanitized server-side: `path.basename(name)` strips directory components; backslashes and forward slashes collapse; if the result is empty or matches a reserved name (`CON`, `PRN`, `..`, etc.), replace with `file_${file_id}.${ext}`.
2. `storage_key` is **never** derived from `original_name`. Construction: `${owner_type}/${owner_id}/${file_id}.${ext}` where `owner_type` is checked against the enum `('socio','report','misc')`, `owner_id` is validated as either a positive integer or ULID regex (`/^[0-9A-HJKMNP-TV-Z]{26}$/`), and `file_id` is a fresh ULID.
3. After construction, `path.resolve(finalKey)` is checked: it MUST start with `STORAGE_LOCAL_ROOT` (defensive — would catch a future refactor that introduces a `..` in the layout). This is the belt-and-suspenders final check.

**Alternatives considered**: Trust the OS to prevent traversal (a single missing `path.normalize()` and you've escaped), sanitize at write time only (defense in depth, but display name in DB still carries the bad bytes), whitelist `original_name` regex (too restrictive — operators have legit Spanish filenames with accents).

**Rationale**: Three layers, each independent. (1) protects the `files.original_name` column from being a vector for XSS in the operator dashboard. (2) is the actual security boundary — even if (1) is bypassed, the on-disk path is server-controlled. (3) is the regression guard — if a future refactor accidentally introduces a `..` in the path template, the `path.resolve` check catches it at the first upload, not in production. `STORAGE_LOCAL_ROOT` is a `path.resolve`d absolute path at boot, so the `startsWith` check is a string compare, not a symlink-following operation.

## Data Flow — File Upload

```
Client           Fastify        Spool              Validator          DB              Storage
  │                │              │                    │                │                │
  │── POST ───────►│              │                    │                │                │
  │  multipart     │── preHandler: requireOwnerAccess(upload) ────────────────────────►│
  │                │              │                    │                │                │
  │                │── TX BEGIN ────────────────────────────────────────►│                │
  │                │── SUM(files WHERE operator)  ──────────────────────►│                │
  │                │── SUM(files WHERE socio)     ──────────────────────►│                │
  │                │── COMMIT (FOR SHARE) ──────────────────────────────►│                │
  │                │              │                    │                │                │
  │                │── multipart saveToStream(tmp) ──►│                 │                │
  │                │   [SHA-256 Transform in pipe]    │                │                │
  │                │              │                    │                │                │
  │                │── read 4KB ──────────────────────►│                │                │
  │                │              │  file-type.detect() │                │                │
  │                │              │  allowlist check    │                │                │
  │                │              │                    │                │                │
  │                │── finalize hash, fs.rename(tmp → final) ───────────────────────────►│
  │                │              │                    │                │                │
  │                │── INSERT files (...)  ────────────────────────────►│                │
  │                │── emit audit (FILE_UPLOAD) ───────────────────────►│                │
  │◄─ 201 {file_id, ...} ─────────│                    │                │                │
```

## File Changes — File Storage Addition

| File | Action | Description |
|---|---|---|
| `db/schema/files.sql` | Create | DDL for `files` table + 4 indices |
| `db/migrations/0008_files.sql` | Create | Migration applying files schema |
| `packages/db/src/schema/files.ts` | Create | Drizzle schema for files table |
| `packages/storage/src/types.ts` | Create | `FileStorage` interface, `FileMetadata`, `StorageKey` types |
| `packages/storage/src/local.ts` | Create | `LocalFileStorage` implementing the interface |
| `packages/storage/src/factory.ts` | Create | Backend selection from `STORAGE_BACKEND` env var |
| `packages/storage/src/mime.ts` | Create | `file-type` wrapper, allowlist map, ext derivation |
| `packages/storage/src/hash.ts` | Create | Streaming SHA-256 `Transform` + finalizer |
| `packages/storage/src/sanitize.ts` | Create | `sanitizeOriginalName()`, `buildStorageKey()`, `assertWithinRoot()` |
| `packages/storage/src/quota.ts` | Create | `checkQuotas(operatorId, socioId, size)` SUM-based check |
| `packages/auth/src/owner-guard.ts` | Create | `requireOwnerAccess(action)` preHandler |
| `packages/scheduler/src/jobs/file-purge.ts` | Create | Retention job handler |
| `apps/api/src/routes/files.ts` | Create | `POST /api/v1/files`, `GET /api/v1/files/{id}`, `DELETE /api/v1/files/{id}` |
| `apps/api/src/routes/socios-files.ts` | Create | `GET /api/v1/socios/{id}/files` (paginated list) |
| `apps/api/src/routes/reports.ts` | Create | `GET /api/v1/reports/{id}/file` (download generated report) |
| `apps/api/src/server.ts` | Modify | Register multipart plugin, file-purge cron, owner-guard |
| `docker-compose.yml` | Modify | Add `storage` named volume, mount at `/app/storage` |
| `scripts/backup.sh` | Modify | Tar storage volume to `/backups/storage-${ts}.tar.gz` |

## Interfaces / Contracts — File Storage

### `FileStorage` Interface

```typescript
// packages/storage/src/types.ts
import { Readable } from 'node:stream';

export interface FileMetadata {
  mime_type: string;
  size_bytes: number;
  content_hash: string;       // hex SHA-256
  original_name: string;
  uploaded_at: Date;
}

export interface PutResult {
  size: number;
  hash: string;               // hex SHA-256 of bytes written
}

export interface FileStorage {
  put(key: string, source: Readable, meta: Partial<FileMetadata>): Promise<PutResult>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<FileMetadata>;
}
```

### `files` Table

```sql
CREATE TABLE files (
  file_id        CHAR(26) PRIMARY KEY,           -- ULID
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key    TEXT NOT NULL,
  content_hash   CHAR(64) NOT NULL,              -- hex SHA-256
  owner_type     TEXT NOT NULL CHECK (owner_type IN ('socio','report','misc')),
  owner_id       TEXT NOT NULL,
  uploaded_by    UUID NOT NULL REFERENCES operators(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID REFERENCES operators(id)
);

CREATE INDEX idx_files_owner_active
  ON files (owner_type, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_uploader ON files (uploaded_by);
CREATE INDEX idx_files_retention
  ON files (deleted_at) WHERE deleted_at IS NOT NULL;
```

### Owner Access PreHandler

```typescript
// packages/auth/src/owner-guard.ts
export function requireOwnerAccess(
  action: 'upload' | 'read' | 'delete',
  ownerTypeExtractor: (req: FastifyRequest) => { owner_type: string; owner_id: string }
): preHandlerHookHandler;
```

### Quota Check

```typescript
// packages/storage/src/quota.ts
export interface QuotaResult {
  ok: boolean;
  operator_used: number;       // bytes
  socio_used: number;          // bytes
  incoming_size: number;
  limit_hit?: 'operator' | 'socio';
}

export async function checkQuotas(
  db: Database,
  operatorId: string,
  socioId: string,
  incomingSize: number
): Promise<QuotaResult>;
```

## Testing Strategy — File Storage

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `LocalFileStorage.put/get/delete` round-trip | Vitest: tmp dir, write 1KB, read back, assert bytes match |
| Unit | `LocalFileStorage.exists` true/false | Vitest: assert true after put, false after delete |
| Unit | `file-type` magic byte detection | Vitest: PDF bytes → `application/pdf`, JPEG bytes → `image/jpeg`, EXE bytes → `application/octet-stream` |
| Unit | `sanitizeOriginalName` strips `../` | Vitest: `"../../etc/passwd"` → `"file_<ulid>"` (rejected as empty after basename) |
| Unit | `sanitizeOriginalName` strips backslashes | Vitest: `"..\\..\\windows\\.."` → sanitized |
| Unit | `buildStorageKey` server-controlled | Vitest: input `{owner_type, owner_id, file_id, ext}` → `socios/42/01HX5K.pdf` |
| Unit | `assertWithinRoot` rejects `..` injection | Vitest: `STORAGE_LOCAL_ROOT=/app/storage`, key `/app/storage/../etc` → throws |
| Unit | `checkQuotas` enforces 1GB operator | Vitest: SUM mock → 999 MB, incoming 2 MB → `{ok: false, limit_hit: 'operator'}` |
| Unit | `checkQuotas` enforces 10 MB socio | Vitest: SUM mock → 9 MB, incoming 2 MB → `{ok: false, limit_hit: 'socio'}` |
| Unit | SHA-256 streaming hash matches one-shot | Vitest: same bytes through Transform vs `crypto.createHash` → equal hex |
| Unit | `requireOwnerAccess` allows admin for any socio | Vitest: role=ADMIN, owner=42 → next() |
| Unit | `requireOwnerAccess` denies operador for unassigned socio | Vitest: role=OPERADOR, no assignment row → 403 |
| Unit | `requireOwnerAccess` denies consulta for delete | Vitest: role=CONSULTA, action=delete → 403 |
| Integration | Full upload: 2 MB PDF → 201 + row + file on disk | Testcontainers: POST multipart, assert 201, assert row, assert file |
| Integration | Quota exceeded returns 413 QUOTA_EXCEEDED | Testcontainers: pre-seed 999 MB, POST 2 MB, assert 413 |
| Integration | Disallowed MIME returns 415 | Testcontainers: POST with .exe, assert 415 |
| Integration | Download streams correct bytes + headers | Testcontainers: upload, GET, assert Content-Type + Content-Disposition + bytes |
| Integration | Soft-delete sets deleted_at, file remains on disk | Testcontainers: DELETE, assert row updated, assert fs.existsSync true |
| Integration | Hard-delete via retention job | Testcontainers: soft-delete, advance time, run file-purge, assert file gone + audit row |
| Integration | Path traversal in original_name sanitized | Testcontainers: upload with `../../etc/passwd`, assert row.original_name safe |
| Integration | Magic-byte spoof rejected | Testcontainers: upload `Content-Type: application/pdf` with EXE bytes, assert 415 |
| E2E | Operator uploads carnet, sees in socio detail page | Playwright: login, navigate to socio 42, upload, assert preview appears |
| E2E | Unauthorized operador gets 403 on download | Playwright: login as operador not assigned to socio, GET file, assert 403 |

## Migration / Rollback — File Storage

**Migration**: Run `0008_files.sql` against the production DB during the standard migration window (no destructive change — new table). After migration, the `storage` volume is created and mounted; the `STORAGE_LOCAL_ROOT` env var is set; the API restarts and the `file-purge` cron registers.

**Rollout order**: (1) deploy migration, (2) create `storage` volume in compose, (3) deploy API with `STORAGE_BACKEND=local`, (4) smoke-test upload + download, (5) wire operator dashboard's upload UI to the new endpoint.

**Rollback**: If file-storage is rolled back, the `files` table and `storage` volume are unused — drop the table and remove the volume mount. The `FileStorage` interface in `packages/storage` is not imported by any other module (auth, socios, etc. are unaffected). Pre-existing PDFs/photos remain in their legacy locations — no data migration was performed on the old system.

## Open Questions — File Storage

- [ ] `STORAGE_LOCAL_ROOT` is a host path. In dev with `docker compose`, should the volume be `named` (data persists across `down`) or `anonymous` (data lost on `down`)? Named is the right answer for parity with prod but slows dev iteration.
- [ ] The retention job is a 6th cron entry on the `JobScheduler`. Should it share a `quota-fair` queue with `token-cleanup` to prevent both running at 4 AM and saturating the DB pool, or are 6 jobs at different times already spread enough?
- [ ] The 1000-row batch cap on the retention job means >1000 expired files take multiple days to purge. For a small club with 20 operators and 5 MB cap, 1 GB max per operator = ~200 files — a single run clears the queue. But if the cap is later raised, should the batch cap scale linearly with `STORAGE_MAX_FILE_SIZE_BYTES`?
- [ ] The spec rejects CSV uploads at the `application/csv` MIME level. Should we additionally reject the `text/csv` MIME that `file-type` may detect for the same content, or trust the `file-type` allowlist to cover both?
- [ ] The owner-access preHandler reads the assignment from the DB on every request. For a hot path (file listing), is the per-request `SELECT` acceptable, or should assignments be cached in the JWT (with a short TTL) as suggested in the user-management-rbac open questions?
- [ ] Backup script tars the storage volume daily. A 20-operator deployment at 1 GB each = 20 GB compressed tarball per day. Should the backup script deduplicate across days (hard-link identical files) or just rotate 30 days of full tarballs as the spec suggests?

---

## UI Style Design — Gorriti Premium

### Decision: Token System — Single `tokens.css` File with CSS Custom Properties

**Choice**: One file at `apps/web/src/styles/tokens.css` declares every design token from the spec (colors, typography, spacing, radius, shadow, motion) as CSS custom properties on `:root`. No tokens in Tailwind config — Tailwind references the variables via `var(--token)`. Imported once in `apps/web/src/app/layout.tsx` before the Tailwind layers.

```css
/* apps/web/src/styles/tokens.css */
:root {
  /* Surfaces */
  --surface:        #ffffff;
  --surface-elevated: #fafafa;
  --surface-sunken:  #f4f4f4;

  /* Ink (text + borders) */
  --ink-900: #0a0a0a;
  --ink-700: #1a1a1a;
  --ink-500: #4a4a4a;
  --ink-300: #9a9a9a;
  --ink-200: #d4d4d4;
  --ink-100: #e8e8e8;

  /* Night (chrome) */
  --night-900: #0a0a0a;
  --night-800: #141414;

  /* Accent (Gorriti red — ≤5% real estate) */
  --accent:        #c1272d;
  --accent-hover:  #9a1f24;
  --accent-soft:   #fdf2f2;
  --accent-foreground: #ffffff;

  /* Status */
  --success: #0d6e3d;
  --warning: #b8741a;
  --danger:  #c1272d;
  --info:    #1a4a7a;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-none: 0px;

  /* Shadows (floating only) */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.08);

  /* Motion */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);

  /* Font families (resolved by @fontsource loaders) */
  --font-display: 'Inter Display', system-ui, sans-serif;
  --font-sans:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, monospace;

  /* Type scale (size / line-height / tracking) */
  --text-display: 40px;  --lh-display: 1.1;  --tr-display: -0.025em;
  --text-h1:      28px;  --lh-h1:      1.2;  --tr-h1:      -0.02em;
  --text-h2:      22px;  --lh-h2:      1.25; --tr-h2:      -0.015em;
  --text-h3:      17px;  --lh-h3:      1.3;  --tr-h3:      -0.01em;
  --text-body-lg: 16px;  --lh-body-lg: 1.55; --tr-body-lg: 0;
  --text-body:    14px;  --lh-body:    1.55; --tr-body:    0;
  --text-body-sm: 13px;  --lh-body-sm: 1.5;  --tr-body-sm: 0;
  --text-label:   12px;  --lh-label:   1.4;  --tr-label:   +0.02em;
  --text-caption: 11px;  --lh-caption: 1.4;  --tr-caption: 0;
  --text-mono-lg: 18px;  --lh-mono-lg: 1.3;  --tr-mono-lg: 0;
  --text-mono-md: 14px;  --lh-mono-md: 1.4;  --tr-mono-md: 0;
  --text-mono-sm: 12px;  --lh-mono-sm: 1.4;  --tr-mono-sm: 0;
}
```

**Alternatives considered**: Tailwind-only `theme.extend.colors` with hex literals (loses single source of truth — same color repeated across palette + bg + ring tokens), CSS-in-JS / vanilla-extract (extra build step, not needed for static tokens), per-component CSS variables (fragments the system).

**Rationale**: CSS custom properties on `:root` are the lightest-weight token system. They cascade naturally, are inspectable in DevTools, and require zero build configuration. Tailwind v4 can read them via `@theme` (preferred) or arbitrary values. A single file is auditable — every color in the system is visible in one place. Hex literals MUST NOT appear in component code outside `tokens.css`.

### Decision: Tailwind Integration — Tailwind v4 with `@theme` Directive

**Choice**: Tailwind v4 (CSS-first config). `apps/web/src/app/globals.css` imports `tokens.css` then declares a `@theme` block that maps every CSS variable to a Tailwind utility namespace. No `tailwind.config.js` colors — Tailwind v4 reads from `@theme`.

```css
/* apps/web/src/app/globals.css */
@import '../styles/tokens.css';

@theme {
  --color-surface:           var(--surface);
  --color-surface-elevated:  var(--surface-elevated);
  --color-surface-sunken:    var(--surface-sunken);
  --color-ink-900: var(--ink-900);
  --color-ink-700: var(--ink-700);
  --color-ink-500: var(--ink-500);
  --color-ink-300: var(--ink-300);
  --color-ink-200: var(--ink-200);
  --color-ink-100: var(--ink-100);
  --color-night-900: var(--night-900);
  --color-night-800: var(--night-800);
  --color-accent:           var(--accent);
  --color-accent-hover:     var(--accent-hover);
  --color-accent-soft:      var(--accent-soft);
  --color-accent-foreground: var(--accent-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger:  var(--danger);
  --color-info:    var(--info);

  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-none: var(--radius-none);

  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);

  --font-display: var(--font-display);
  --font-sans:    var(--font-sans);
  --font-mono:    var(--font-mono);

  --ease-standard: var(--ease-standard);
  --duration-fast: var(--duration-fast);
  --duration-base: var(--duration-base);
  --duration-slow: var(--duration-slow);
}
```

**Alternatives considered**: Tailwind v3 with `tailwind.config.js` `theme.extend` (the v3 way — verbose JS config, doesn't match v4's CSS-first philosophy if v4 is available), StyleX / CSS Modules per component (loses utility ergonomics, more files to maintain).

**Rationale**: Tailwind v4's `@theme` directive turns the token file into the single source of truth for both raw CSS access and utility classes. Changing a token in `tokens.css` propagates to every utility (`bg-accent`, `text-ink-700`, `rounded-md`, etc.) without rebuilding a config object. The spec demands "components MUST consume tokens, not raw hex" — `@theme` enforces this because there is no other path to a Tailwind class.

### Decision: Font Bundling — `@fontsource-variable` with `font-display: swap`

**Choice**: Install `@fontsource-variable/inter` (covers Inter + Inter Display variable axis), `@fontsource-variable/jetbrains-mono`. Import the relevant weight subset CSS in `app/layout.tsx` so Next.js bundles the woff2 files. `font-display: swap` is `@fontsource`'s default — confirmed via the package's `unicode-range` + `font-display: swap` declarations.

```typescript
// apps/web/src/app/layout.tsx
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css'; // (skip if no italic body)
import '@fontsource-variable/jetbrains-mono';
import '../styles/tokens.css';
import './globals.css';
```

**Alternatives considered**: `next/font/google` (fetches from Google CDN at build time — fine for build, but Google recently blocked many regions; an offline build fails), self-hosted woff2 in `public/fonts/` with hand-written `@font-face` (more control, more maintenance — must match Inter Display's variable axes manually), Bunny Fonts (privacy-friendly Google alternative — adds external network dependency for builds).

**Rationale**: `@fontsource-variable` is the de facto self-host standard for Next.js + Tailwind projects. Variable fonts cover Inter Display (one file, all weights 100–900 with no subset duplication). `font-display: swap` prevents FOIT — text renders in the system fallback during load. Self-hosting means no third-party network request and no GDPR concern (operator console handling personal data MUST NOT phone home to Google Fonts).

### Decision: Component Folder Layout — `ui/`, `features/`, `layouts/`

**Choice**: Three sibling folders under `apps/web/src/components/`:

```
apps/web/src/components/
├── ui/         # Base primitives — Button, Input, Card, Table, Badge, Modal, Toast, Tabs, Pagination
├── features/   # Domain composites — SocioTable, CtacteSummary, ImportProgressBanner, AuditDiff
└── layouts/    # App shells — SidebarLayout, AuthLayout, EmptyState
```

`ui/` is reusable across the operator console and contains no business logic. `features/` consumes `ui/` and is named after the domain (e.g., `features/socios/SocioTable.tsx` — it imports `<Table>`, `<Badge>`, `<NumberCell>` from `ui/`). `layouts/` provides the page shells (sidebar shell, auth shell).

**Alternatives considered**: `components/` flat (collapses at 20+ files, hard to enforce primitive/composite split), `modules/{domain}/components/` (Next.js community pattern, but conflates "one module = one feature" with "UI primitives used across features"), atomic design (atoms/molecules/organisms — academic, slow to navigate).

**Rationale**: The three-folder rule maps directly to the spec's primitive/composite distinction. It is the smallest convention that prevents the common failure mode where feature components get re-implemented because the primitive wasn't extracted. Folder names are short and grep-friendly. `ui/` is the only place shadcn/ui is allowed to install to.

### Decision: shadcn/ui Customization — Override Defaults via `components.json` + Initial Templates

**Choice**: Install shadcn/ui (Radix-based primitives) with `components.json` pointing to `apps/web/src/components/ui`. After install, apply three global overrides to match the Gorriti Premium style:

1. **Radius**: `rounded-md` → `6px` (default), `rounded-sm` → `4px`, `rounded-lg` → `8px` — already correct from Tailwind `@theme` mapping. No component edit needed.
2. **Button shadow**: shadcn's `Button` template uses no shadow by default — confirmed clean. Verify on every `shadcn add`.
3. **Card border**: shadcn's `Card` template has no border by default. Edit the installed `card.tsx` to add `border border-ink-100` and REMOVE any `shadow-sm` it ships with. Card MUST NOT have a shadow per spec.

```typescript
// apps/web/src/components/ui/card.tsx (post-shadcn override)
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-ink-100 bg-surface', className)}
      {...props}
    />
  )
);
```

`components.json` config:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils"
  }
}
```

**Alternatives considered**: Build components from scratch without shadcn (re-implementing accessible primitives is a 3-week tax for a 3-day feature), Material UI / Chakra / Mantine (heavy runtime, hard to override deeply, ship with their own token system that fights the spec), Radix UI raw + Tailwind (correct primitives, but no boilerplate = every dialog/menu is hand-written — fine for 3 primitives, painful at 20).

**Rationale**: shadcn/ui is a copy-paste library, not a dependency — every component lives in our repo, editable. We can guarantee no shadows on cards, no rounded-full defaults, and Tailwind token consumption. The Card edit is the only global override needed; everything else (radius, focus ring) is already aligned via `@theme`.

### Decision: `SidebarLayout` Shell — Fixed Sidebar + Top Bar + Scrollable Content

**Choice**: `apps/web/src/components/layouts/SidebarLayout.tsx` renders the three-region shell from the spec layout diagram. The sidebar collapses to a drawer below 1024px (Tailwind `lg` breakpoint). Implementation uses CSS grid for the desktop layout and a `<dialog>`-based drawer for mobile.

```typescript
// apps/web/src/components/layouts/SidebarLayout.tsx
export function SidebarLayout({ children, navItems, breadcrumbs, pageTitle, primaryAction }: SidebarLayoutProps) {
  return (
    <div className="min-h-screen bg-surface text-ink-700">
      <TopBar />
      <div className="grid lg:grid-cols-[240px_1fr]">
        <Sidebar items={navItems} className="hidden lg:block bg-night-900 text-ink-300" />
        <div className="flex flex-col">
          <PageHeader breadcrumbs={breadcrumbs} title={pageTitle} action={primaryAction} />
          <main className="px-8 py-8 max-w-[1400px] w-full mx-auto">{children}</main>
        </div>
      </div>
      <MobileDrawer /> {/* <dialog>, opened by TopBar menu button on <lg */}
    </div>
  );
}
```

Sidebar internals (per spec):
- Default item: `text-[#a0a0a0]`, hover `bg-night-800 text-[#d4d4d4]`, active `bg-[#1a1a1a] text-white border-l-2 border-accent`.
- Section dividers: `1px solid #1a1a1a`.
- Footer: logout button.

Responsive rule: `lg:drawer` — sidebar becomes a `night-900` drawer below `1024px`. NEVER invert to a light drawer (spec prohibition).

**Alternatives considered**: Flexbox layout instead of grid (works, but `grid-cols-[240px_1fr]` is more declarative for the fixed-width sidebar), Vercel's `next-themes` shadcn nav-01 template (over-styled, ships with rounded corners and a search that doesn't fit the spec), headlessui `Dialog` for mobile drawer (Radix Dialog from shadcn is already in the stack — reuse it).

**Rationale**: CSS Grid with `lg:grid-cols-[240px_1fr]` is the cleanest expression of the desktop layout. Mobile drawer reuses Radix Dialog (already pulled in by shadcn) — no new dependency. The sidebar's `night-900` background is applied via a single Tailwind class on `<Sidebar>` — consistent with the spec's "night-900 sidebar, period" rule.

### Decision: `Escudo` Component — Single Logo Wrapper, Three Allowed Contexts

**Choice**: `apps/web/src/components/ui/Escudo.tsx` renders `<img src="/logo.jpg" alt="Club Atlético Gorriti">` with a configurable `size` prop (32, 96, 180). The image is served from `apps/web/public/logo.jpg` — a copy of `openspec/image/logo.jpg` committed at scaffold time. The component is a single file with no variants.

```typescript
// apps/web/src/components/ui/Escudo.tsx
type EscudoSize = 'topbar' | 'empty' | 'login';
const heights = { topbar: 32, empty: 96, login: 180 } as const;

export function Escudo({ size }: { size: EscudoSize }) {
  return (
    <img
      src="/logo.jpg"
      alt="Club Atlético Gorriti"
      width={heights[size]}
      height={heights[size]}
      className="select-none"
    />
  );
}
```

Allowed usage sites (enforced by code review + lint rule, not framework):
1. `app/login/page.tsx` — `size="login"` on the night-900 left panel.
2. `components/layouts/TopBar.tsx` — `size="topbar"` paired with "Athlos · CAG" wordmark.
3. Empty-state components in `features/*/EmptyState.tsx` — `size="empty"`, only when the empty state is a first-run condition (e.g., "Sin socios importados").

ESLint custom rule (or a grep CI check) blocks `<Escudo>` imports from any other file path. Lint config lives at `apps/web/.eslintrc.cjs`.

**Alternatives considered**: `<Escudo>` as an SVG component (the source is a `.jpg` — converting to SVG requires manual vectorization of the red shield + CAG monogram, which is not a UI designer's job in this change), inline `<img>` at each call site (loses the lint-enforced usage constraint), next/image wrapper (overkill for a static decorative asset with no responsive sizes).

**Rationale**: The spec is explicit: "The escudo appears in three places ONLY." A dedicated component makes the constraint auditable. ESLint rule (or a simple `grep -r "Escudo" apps/web/src --include="*.tsx" | grep -v -E "(login|TopBar|EmptyState)\.tsx"`) catches violations in CI. The image lives in `public/` (not `src/`) so Next.js serves it as a static asset without a build step on the image itself.

### Decision: `NumberCell` Primitive — Single Mono Numeric Cell with Tabular Nums

**Choice**: `apps/web/src/components/ui/NumberCell.tsx` is a thin `<span>` that applies mono font + `tabular-nums` + right-alignment. Three sizes (`sm`/`md`/`lg`) map to the spec's `mono-sm`, `mono-md`, `mono-lg` tokens. A `tone` prop handles the deudor/a-favor color rule.

```typescript
// apps/web/src/components/ui/NumberCell.tsx
type NumberCellTone = 'neutral' | 'positive' | 'negative';
type NumberCellSize = 'sm' | 'md' | 'lg';

export function NumberCell({
  value, size = 'md', tone = 'neutral', currency = 'ARS', locale = 'es-AR',
}: {
  value: number;
  size?: NumberCellSize;
  tone?: NumberCellTone;
  currency?: string;
  locale?: string;
}) {
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(value);
  const sizeClass = { sm: 'text-mono-sm', md: 'text-mono-md', lg: 'text-mono-lg' }[size];
  const toneClass = {
    neutral: 'text-ink-700 font-medium',
    positive: 'text-ink-700 font-medium',
    negative: 'text-accent font-semibold',
  }[tone];
  return <span className={cn('font-mono tabular-nums text-right', sizeClass, toneClass)}>{formatted}</span>;
}
```

Every numeric table cell — `Debe`, `Haber`, `Saldo`, KPI counts, dates, IDs, receipt numbers — uses `<NumberCell>`. No table cell EVER uses raw `<span className="font-mono">` — the component is the only path.

**Alternatives considered**: CSS class utility (`.number-cell { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }`) with no component (reusable via className, but loses the tone logic and the formatting centralization), `<td className="text-right font-mono">{formatCurrency(v)}</td>` inline at every call site (works for 5 cells, breaks at 50).

**Rationale**: The cache spec (caching/spec.md) notes that operators live inside tables — and the table spec requires mono + tabular-nums + right-align + deudor color for every numeric cell. A primitive guarantees the rule is enforced. `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` produces `$ 1.234,56` formatting, which is correct for rioplatense Spanish. Centralizing the format here means changing locale (e.g., adding USD) is a one-line prop change.

### Decision: Theme Provider — Light Only, No `next-themes`

**Choice**: No theme provider installed. The `:root` tokens in `tokens.css` define the only theme. No `data-theme` or `dark:` variants in component code. If a future change adds dark mode, it will be a separate feature with its own tokens (`tokens.dark.css`) toggled via a `data-theme="dark"` attribute on `<html>`.

**Alternatives considered**: `next-themes` for future-proofing (adds runtime + a `ThemeProvider` wrapper for a feature that doesn't exist), CSS `@media (prefers-color-scheme: dark)` automatic inversion (would let the OS decide — operators on personal laptops with dark mode preference would see an inverted Gorriti console, breaking brand consistency), separate dark token file shipped from day one (YAGNI — the spec says light only for v1).

**Rationale**: Spec is explicit: "Light only (no dark mode in v1)." Installing `next-themes` for a feature that won't ship is dead code in the bundle. The sidebar is `night-900` regardless of system preference — automatic OS inversion would fight the spec. The `:root` token system is dark-mode-ready in the future (CSS variables + `data-theme` is a one-day refactor) without paying the cost today.

### Decision: Visual Regression — Skip Storybook + Chromatic in v1

**Choice**: No Storybook. No Chromatic. No Playwright visual tests. Manual review of every screen during PR review; a shared "Gorriti Premium" Figma reference (to be produced separately by design) for visual diffing. Visual regressions are caught by reviewer attention, not by automation.

**Alternatives considered**: Storybook + Chromatic (gold standard — visual diffs on every PR, ~$250/mo for the team plan after the free tier, ~2 days of setup per component), Playwright `toHaveScreenshot()` per page (free, but flaky on first-pixel diffs, slow to run, requires a stable test database), Percy (alternative to Chromatic, similar cost).

**Rationale**: v1 is a 20-operator internal tool. Visual regressions are visible to the team within minutes of deploy. The token system already enforces consistency: if `bg-surface` is `var(--surface)` and every Card uses `bg-surface`, regressions in surface color are a one-line cause. Storybook's marginal value is low when the token system is strict. When v2 ships to a public audience, Chromatic becomes worth the cost. The decision is REVERSIBLE — adding Storybook later is additive, not breaking.

### Decision: Accessibility Foundation — Focus Rings + Tap Targets at the Token Layer

**Choice**: Global CSS in `globals.css` (after `@theme`) adds a `*:focus-visible` rule using the spec's 3px `accent-soft` ring. Button component enforces `min-h-[40px]` on touch breakpoints (`md:min-h-[36px]`). No accessibility library — Radix primitives (from shadcn) cover ARIA for free.

```css
/* apps/web/src/app/globals.css (after @theme) */
@layer base {
  *:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    box-shadow: 0 0 0 3px rgba(193, 39, 45, 0.1);
  }
  html, body {
    font-family: var(--font-sans);
    color: var(--ink-700);
    background: var(--surface);
  }
  /* Tabular nums for ALL <td> cells that look numeric */
  table { font-variant-numeric: tabular-nums; }
}
```

**Alternatives considered**: `@axe-core/playwright` in E2E (added later, not a design blocker), `eslint-plugin-jsx-a11y` in lint (standard, will be added in `testing-setup` work — not duplicated here).

**Rationale**: The spec's accessibility rule ("All interactive elements MUST have a visible focus state — 3px accent soft ring") is a one-line CSS rule, not a per-component concern. Centralizing it in `@layer base` means every future interactive element inherits it. Radix primitives (which shadcn wraps) already implement WAI-ARIA patterns correctly — we don't need to know which ARIA roles a Dialog needs to use a Dialog.

## Data Flow — UI Style

```
Browser loads /login
       │
       ▼
Next.js renders <html>
       │
       ├── app/layout.tsx imports:
       │     1. @fontsource-variable/inter + jetbrains-mono (woff2 bundled)
       │     2. styles/tokens.css  ──► :root CSS custom properties
       │     3. app/globals.css   ──► @theme block + @layer base
       │
       ├── Tailwind v4 reads @theme ──► generates utilities (bg-accent, text-ink-700, …)
       │
       ├── Page renders <AuthLayout>
       │     ├── <Escudo size="login" />  (night-900 panel, 180px)
       │     └── <Card>  (uses bg-surface, border-ink-100, no shadow)
       │
       └── /socios renders <SidebarLayout>
             ├── <TopBar> + <Escudo size="topbar" /> + "Athlos · CAG" wordmark
             ├── <Sidebar>  (night-900, accent left border on active item)
             └── <PageHeader>  (breadcrumb + h1 + primary action)
                   └── <main>
                         ├── <NumberCell value={1234.56} tone="negative" />  (mono, tabular-nums, accent red)
                         └── <Table>  (no zebra, sticky header, mono right-aligned numerics)
```

## File Changes — UI Style Addition

| File | Action | Description |
|------|--------|-------------|
| `apps/web/package.json` | Modify | Add `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, shadcn CLI as devDep |
| `apps/web/components.json` | Create | shadcn config: `aliases.ui = @/components/ui`, baseColor neutral, cssVariables true |
| `apps/web/src/styles/tokens.css` | Create | All design tokens as CSS custom properties on `:root` |
| `apps/web/src/app/globals.css` | Create | Imports `tokens.css`, declares `@theme`, sets `@layer base` (focus rings, body font) |
| `apps/web/src/app/layout.tsx` | Modify | Import fontsource CSS, tokens.css, globals.css |
| `apps/web/public/logo.jpg` | Create | Copy of `openspec/image/logo.jpg` — served as static asset |
| `apps/web/src/components/ui/Escudo.tsx` | Create | Logo wrapper with `size: 'topbar' \| 'empty' \| 'login'` |
| `apps/web/src/components/ui/NumberCell.tsx` | Create | Mono numeric cell with `tone` (neutral/positive/negative) and `size` (sm/md/lg) |
| `apps/web/src/components/ui/Button.tsx` | Create | shadcn Button — verify no shadow, no rounded-full, 36/40px heights |
| `apps/web/src/components/ui/Card.tsx` | Create | shadcn Card — override to add `border-ink-100`, REMOVE any shadow |
| `apps/web/src/components/ui/Input.tsx` | Create | shadcn Input — 40px height, 6px radius, accent focus ring (inherited) |
| `apps/web/src/components/ui/Table.tsx` | Create | shadcn Table — no zebra, sticky header, mono right-aligned numeric cells via `NumberCell` |
| `apps/web/src/components/ui/Badge.tsx` | Create | shadcn Badge — 5 variants per spec (default/active/warning/error/info), 4px radius, NEVER rounded-full |
| `apps/web/src/components/ui/Modal.tsx` | Create | shadcn Dialog — 8px radius, shadow-lg, 24px padding, max-w 560px, fade + 4px slide entrance |
| `apps/web/src/components/ui/Toast.tsx` | Create | shadcn Sonner (or Toaster) — top-right, 16px from edges, 5s/4s/sticky durations |
| `apps/web/src/components/ui/Tabs.tsx` | Create | shadcn Tabs — underline style with 2px accent border on active |
| `apps/web/src/components/ui/Pagination.tsx` | Create | Footer pagination, page-size selector 25/50/100, prev/next |
| `apps/web/src/components/layouts/SidebarLayout.tsx` | Create | Grid shell: night-900 sidebar + top bar + main content (max-w 1400px) |
| `apps/web/src/components/layouts/AuthLayout.tsx` | Create | Split 40/60 login shell: night-900 left with `<Escudo size="login">` |
| `apps/web/src/components/layouts/TopBar.tsx` | Create | Night-900, 56px, holds `<Escudo size="topbar">` + search + notif + operator menu |
| `apps/web/src/components/layouts/Sidebar.tsx` | Create | 240px nav, collapses to drawer <lg, accent left border on active item |
| `apps/web/src/components/layouts/PageHeader.tsx` | Create | Breadcrumb (12px uppercase) + h1 (28px Inter Display) + right-aligned action |
| `apps/web/src/components/layouts/EmptyState.tsx` | Create | Centered `<Escudo size="empty">` + headline + body-sm + primary CTA (used by features/) |
| `apps/web/src/lib/utils.ts` | Create | `cn()` className merger (shadcn default — `clsx` + `tailwind-merge`) |
| `apps/web/.eslintrc.cjs` | Modify | Add `no-restricted-imports` rule blocking `Escudo` outside `login/`, `TopBar`, `features/*/EmptyState` |

## Interfaces / Contracts — UI Style

### Token surface (subset)

```typescript
// apps/web/src/lib/tokens.ts (generated type from tokens.css — for editor IntelliSense only)
export const tokens = {
  color: {
    surface: 'var(--surface)',
    accent: 'var(--accent)',
    ink: { 900: 'var(--ink-900)', 700: 'var(--ink-700)', 500: 'var(--ink-500)', 300: 'var(--ink-300)' },
    night: { 900: 'var(--night-900)', 800: 'var(--night-800)' },
  },
  radius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', none: 'var(--radius-none)' },
  shadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' },
  motion: { fast: 'var(--duration-fast)', base: 'var(--duration-base)', slow: 'var(--duration-slow)' },
} as const;
```

### `NumberCell` props (reference)

```typescript
interface NumberCellProps {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'positive' | 'negative';
  currency?: string;     // default 'ARS'
  locale?: string;       // default 'es-AR'
}
```

### `Escudo` props (reference)

```typescript
interface EscudoProps {
  size: 'topbar' | 'empty' | 'login';  // 32 | 96 | 180 px height
}
```

## Testing Strategy — UI Style

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `NumberCell` formats ARS currency per es-AR locale | Vitest + jsdom: render `<NumberCell value={1234.56} />` → assert textContent === `$ 1.234,56` |
| Unit | `NumberCell` applies `tone="negative"` → `text-accent` class | Vitest + Testing Library: render → assert className includes `text-accent` |
| Unit | `NumberCell` size prop maps to correct text class | Vitest: render `size="lg"` → assert className includes `text-mono-lg` |
| Unit | `Escudo` renders correct height per size | Vitest: render `size="login"` → assert `height={180}` attribute |
| Unit | ESLint rule blocks `Escudo` import in forbidden paths | Vitest + eslint API: write import in `app/page.tsx` → assert lint error |
| Integration | SidebarLayout renders sidebar + topbar + main on desktop | Testing Library: render → assert all three regions present |
| Integration | SidebarLayout hides sidebar below lg breakpoint | Testing Library + matchMedia mock: viewport 800px → assert `display: none` |
| Integration | Theme tokens resolve to spec values | Playwright: load `/login` → assert `getComputedStyle(document.documentElement).getPropertyValue('--accent')` === `#c1272d` |
| Visual | Manual: Gorriti red appears in <5% real estate per page | PR review checklist item (no automation v1) |
| E2E | Operator login renders escudo + form | Playwright: navigate `/login` → assert `<img alt="Club Atlético Gorriti">` visible |

## Migration / Rollback — UI Style

**Migration**: No database migration. The UI is a fresh greenfield (`apps/web/` does not exist yet). Deploy order: (1) scaffold `apps/web` with `create-next-app`, (2) install Tailwind v4 + shadcn + fontsource, (3) commit `tokens.css` + `globals.css` first — no components can render correctly without them, (4) commit `ui/` primitives, (5) commit `layouts/`, (6) commit `features/` (later PRs).

**Rollback**: Each component file is independent — `git revert` of a single primitive commit removes only that primitive. The token files (`tokens.css`, `globals.css`) are the foundation; rolling them back breaks every component. Visual regressions in v1 are caught by reviewer attention, not automation — the rollback path is the same as any other code: `git revert <sha>`.

## Open Questions — UI Style

- [ ] Tailwind v4 stable was released in early 2025 — is the team's Next.js (15) version compatible? If we pin Next 14, we should use Tailwind v3.4 with `tailwind.config.js` instead of `@theme`.
- [ ] shadcn `Card` ships without a border by default — after `border-ink-100` is added, will any future shadcn update overwrite the override? (Mitigation: a visual regression smoke test on a known Card render.)
- [ ] `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` produces `$ 1.234,56` — should the currency symbol be `ARS` (ISO code) or `$` (locale default)? Operators may scan for the symbol, not the code.
- [ ] Should the TopBar's `night-900` background be `night-900` (same as sidebar) or a slightly lighter shade to visually separate the two horizontal bars? Spec says both are `night-900` — visual rhythm is the question.
- [ ] The mobile drawer below `1024px` reuses Radix Dialog. Should the drawer be `night-900` (spec rule: "the night-900 sidebar MUST stay dark in both modes") or follow system theme? Spec says dark always — confirm.
- [ ] When the team adds dark mode in a future change, will the `night-900` sidebar stay dark in dark mode (institutional chrome that never inverts), or also flip? Spec doesn't address this scenario yet.

