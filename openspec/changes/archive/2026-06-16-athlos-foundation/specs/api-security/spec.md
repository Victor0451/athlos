# API Security Specification

## Purpose

This spec defines security controls for the Athlos API — covering CORS, rate limiting, security headers, input sanitization, API key authentication for external services, and audit logging of security events. All controls apply to `/api/v1/*` endpoints unless otherwise noted.

---

## A. CORS (Cross-Origin Resource Sharing)

### Requirement: Allowed Origins

The system MUST enforce CORS based on the `CORS_ORIGINS` environment variable. This variable MUST be a comma-separated list of allowed origin strings. If `CORS_ORIGINS` is empty or unset, no origins SHALL be allowed.

#### Scenario: Single allowed origin

- GIVEN `CORS_ORIGINS=https://admin.athlos.example.com`
- WHEN a request arrives with `Origin: https://admin.athlos.example.com`
- THEN the response MUST include `Access-Control-Allow-Origin: https://admin.athlos.example.com`

#### Scenario: Multiple allowed origins

- GIVEN `CORS_ORIGINS=https://admin.athlos.example.com,https://consulta.athlos.example.com`
- WHEN a request arrives with `Origin: https://consulta.athlos.example.com`
- THEN the response MUST include `Access-Control-Allow-Origin: https://consulta.athlos.example.com`

#### Scenario: Disallowed origin rejected

- GIVEN `CORS_ORIGINS=https://admin.athlos.example.com`
- WHEN a request arrives with `Origin: https://evil.example.com`
- THEN the response MUST NOT include any `Access-Control-Allow-Origin` header

### Requirement: Allowed Methods and Headers

The system MUST allow the following methods on CORS-preflight: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`. The following request headers MUST be allowed: `Authorization`, `Content-Type`, `X-Request-ID`.

#### Scenario: Preflight request for allowed method

- GIVEN a valid `Origin` header
- WHEN an `OPTIONS` request arrives with `Access-Control-Request-Method: POST`
- THEN the response MUST include `Access-Control-Allow-Methods: GET,POST,PUT,DELETE,PATCH,OPTIONS`

#### Scenario: Preflight request for allowed header

- GIVEN a valid `Origin` header
- WHEN an `OPTIONS` request arrives with `Access-Control-Request-Headers: Authorization,Content-Type`
- THEN the response MUST include `Access-Control-Allow-Headers: Authorization,Content-Type,X-Request-ID`

### Requirement: Credentials Support

The system MAY support credentials (cookies, authorization header forwarding) via CORS. If the client includes `Access-Control-Allow-Credentials: true`, the server MUST validate the origin against `CORS_ORIGINS` before setting `Access-Control-Allow-Credentials: true`.

#### Scenario: Credentials with wildcard origin not allowed

- GIVEN `CORS_ORIGINS=*`
- WHEN a request arrives with `Access-Control-Allow-Credentials: true`
- THEN the response MUST NOT set `Access-Control-Allow-Credentials` to `true`

### Requirement: Preflight Cache Duration

The system SHOULD set `Access-Control-Max-Age` to 86400 (24 hours) to reduce preflight overhead.

---

## B. Rate Limiting

### Requirement: Rate Limit Strategy

The system MUST implement dual-layer rate limiting: per-IP for unauthenticated requests, and per-JWT for authenticated requests. The per-IP limit SHALL apply to all requests; the per-JWT limit SHALL apply only to authenticated endpoints.

#### Scenario: Per-IP limit on login endpoint

- GIVEN no authenticated session
- WHEN 60 requests arrive from IP `192.168.1.100` to `/api/v1/auth/login` within 1 minute
- THEN the 61st request within that window MUST return 429 Too Many Requests

#### Scenario: Per-JWT limit on authenticated endpoint

- GIVEN an authenticated request with JWT identifying operator `operador1`
- WHEN 100 requests arrive with that JWT to any `/api/v1/*` endpoint within 1 minute
- THEN the 101st request within that window MUST return 429 Too Many Requests

### Requirement: Rate Limit Thresholds

The system MUST enforce the following limits:

| Layer | Scope | Limit | Window |
|-------|-------|-------|--------|
| Per-IP | Unauthenticated | 30 requests | 1 minute |
| Per-IP | Authenticated | 100 requests | 1 minute |
| Per-JWT | Authenticated | 200 requests | 1 minute |

#### Scenario: Authenticated request counted per-JWT

- GIVEN an authenticated request with JWT for operator `operador1`
- WHEN that JWT makes 200 requests in 1 minute
- THEN the 201st request MUST return 429

### Requirement: Rate Limit Response

When a rate limit is exceeded, the system MUST return HTTP 429 with a `Retry-After` header (in seconds) and a JSON body containing the error code and time until the limit resets.

#### Scenario: Rate limit exceeded response

- GIVEN IP `192.168.1.100` has exceeded the per-IP limit
- WHEN the next request arrives from that IP
- THEN response MUST be 429 with `Retry-After: <seconds>` header
- AND body MUST be `{"error":"RATE_LIMIT_EXCEEDED","retry_after":<seconds>}`

### Requirement: Endpoints Exempt from Rate Limiting

The following endpoints MUST be exempt from rate limiting: `GET /health`, `GET /api/v1/approval/{token}`, `POST /api/v1/approval/{token}`. These endpoints are intentionally accessible without prior authentication or rate throttling.

#### Scenario: Health check not rate limited

- GIVEN IP `192.168.1.100` has exceeded the per-IP limit
- WHEN `GET /health` is called from that IP
- THEN response MUST be 200 OK (not 429)

#### Scenario: Approval link endpoints not rate limited

- GIVEN IP `192.168.1.100` has exceeded the per-IP limit
- WHEN `GET /api/v1/approval/{token}` is called from that IP
- THEN response MUST be processed normally (not 429)

---

## C. Security Headers (Helmet)

### Requirement: Helmet Middleware

The system MUST use Helmet middleware to set security-critical HTTP headers on all responses. The following headers MUST be set:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |

#### Scenario: Security headers present

- WHEN any response is returned from `/api/v1/*`
- THEN all security headers listed above MUST be present in the response

### Requirement: Content Security Policy

The system SHOULD set a `Content-Security-Policy` header. In production, the CSP MUST be restrictive (default-src 'none', script-src 'self', style-src 'self', img-src 'self', connect-src 'self'). In development, a `Content-Security-Policy-Report-Only` header SHOULD be used instead.

#### Scenario: CSP in production

- GIVEN `NODE_ENV=production`
- WHEN a response is returned
- THEN `Content-Security-Policy` header MUST be present with restrictive policy

#### Scenario: CSP report-only in development

- GIVEN `NODE_ENV=development`
- WHEN a response is returned
- THEN `Content-Security-Policy-Report-Only` header SHOULD be present (not enforced)

---

## D. Input Sanitization

### Requirement: SQL Injection Prevention

The system MUST use Drizzle ORM parameterized queries exclusively. Raw SQL string concatenation MUST NOT be used for any user-provided input. All database queries MUST be reviewed at code review time for correct query construction.

#### Scenario: Parameterized query used

- GIVEN a search endpoint receives `?query=socio123`
- WHEN the handler queries the database
- THEN a parameterized query MUST be used with user input passed as parameters

#### Scenario: Raw SQL concatenation prohibited

- GIVEN a developer attempts to build a query like `db.query(\`SELECT * FROM socios WHERE nombre = '\${userInput}'\`)`
- THEN this code MUST be rejected at code review

### Requirement: XSS Prevention

The system MUST encode output in responses. All user-provided data returned in JSON responses MUST be HTML-encoded by the JSON serializer. The API MUST NOT accept `<script>` tags or similar dangerous content in input fields without sanitization.

#### Scenario: Script tag in input sanitized on output

- GIVEN a socio record contains `<script>alert(1)</script>` in the `nombre` field
- WHEN that socio is returned via API
- THEN the output MUST have `<script>` encoded as `<script>`

### Requirement: Request Body Size Limits

The system MUST enforce a maximum request body size of 1MB for all endpoints. Requests exceeding this limit MUST return 413 Payload Too Large.

#### Scenario: Oversized request body rejected

- GIVEN a POST request with a 2MB JSON body
- WHEN the request arrives at `/api/v1/socios`
- THEN response MUST be 413 with `{"error":"PAYLOAD_TOO_LARGE"}`

### Requirement: Header Injection Prevention

The system MUST strip or reject newline characters (`\n`, `\r`) from all incoming header values. Requests with header injection attempts MUST return 400 Bad Request.

#### Scenario: Header injection attempt rejected

- GIVEN a request with `X-Forwarded-For: 192.168.1.1\r\nMalicious-Header: value`
- WHEN the request is processed
- THEN response MUST be 400 Bad Request with `{"error":"INVALID_HEADER"}`

---

## E. API Keys for External Services

### Requirement: API Key Authentication

The system MAY support API key authentication for external service integrations. If used, API keys MUST be stored as SHA-256 hashes in the database (never in plaintext). Each API key MUST be associated with a service identity and a set of allowed scopes.

#### Scenario: API key passed via header

- GIVEN an external service makes a request with `X-API-Key: <valid-key>`
- WHEN the request is validated
- THEN the key hash MUST be compared (not the plaintext key)
- AND if valid, the request MUST be allowed with the key's associated scopes

#### Scenario: API key not stored in plaintext

- GIVEN an API key `sk_live_abc123` is created for service "legacy-sync"
- WHEN the key is stored
- THEN only the SHA-256 hash of the key SHALL be stored
- AND the plaintext key MUST be shown only once at creation time

### Requirement: API Key Scope Restrictions

Each API key MUST be restricted to specific endpoints and methods. Keys MUST NOT have full API access by default.

#### Scenario: API key with limited scope

- GIVEN an API key for "legacy-sync" is scoped to `GET /api/v1/socios` and `GET /api/v1/freshness`
- WHEN a request is made with that key to `POST /api/v1/socios`
- THEN response MUST be 403 Forbidden with `{"error":"API_KEY_SCOPE_INSUFFICIENT"}`

### Requirement: API Key Storage

API keys for external services MUST be stored in the `api_keys` table:

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
```

---

## F. Audit Logging for Security Events

### Requirement: Authentication Failure Logging

The system MUST log all authentication failures beyond the threshold of 3 failures within any 15-minute window. Each logged event MUST include: timestamp, username attempted, IP address, user agent, and failure reason.

#### Scenario: Auth failure logged after threshold

- GIVEN operator "operador1" has had 3 failed login attempts
- WHEN the 4th failed attempt occurs within 15 minutes
- THEN an audit event MUST be recorded with: action=`AUTH_FAILURE`, username=`operador1`, ip_address, user_agent, reason

### Requirement: Permission Denial Logging

The system MUST log all permission denial events (HTTP 403 responses triggered by RBAC or permission checks). Each logged event MUST include: timestamp, operator_id, IP address, endpoint, action attempted, and required permission.

#### Scenario: Permission denial logged

- GIVEN authenticated operator with role=CONSULTA attempts `POST /api/v1/socios`
- WHEN response is 403 Forbidden
- THEN an audit event MUST be recorded with: action=`PERMISSION_DENIED`, operator_id, ip_address, endpoint=`POST /api/v1/socios`, required_permission=`can_create_socio`

### Requirement: Rate Limit Hit Logging

The system SHOULD log rate limit hits (HTTP 429 responses). Each logged event MUST include: timestamp, IP address (or JWT identity if authenticated), endpoint, limit type (per-IP or per-JWT), and retry-after value.

#### Scenario: Rate limit hit logged

- GIVEN IP `192.168.1.100` exceeds the per-IP rate limit
- WHEN a 429 response is returned
- THEN an audit event SHOULD be recorded with: action=`RATE_LIMIT_HIT`, ip_address, endpoint, limit_type=`per-ip`

### Requirement: Security Event Audit Schema

All security events MUST be stored in the `audit_events` table with the following structure:

```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  operator_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Security event actions: `AUTH_FAILURE`, `PERMISSION_DENIED`, `RATE_LIMIT_HIT`, `API_KEY_USED`, `API_KEY_REJECTED`.

---

## Success Criteria

- [ ] CORS origins are read from `CORS_ORIGINS` env var and enforced on all responses
- [ ] CORS preflight requests are handled correctly with allowed methods/headers
- [ ] Credentials are not sent with wildcard origin
- [ ] Per-IP rate limiting enforced at 30 req/min for unauthenticated, 100 req/min for authenticated
- [ ] Per-JWT rate limiting enforced at 200 req/min for authenticated endpoints
- [ ] Rate limit responses include 429 status, `Retry-After` header, and JSON error body
- [ ] `/health` and `/api/v1/approval/{token}` endpoints are exempt from rate limiting
- [ ] Helmet middleware sets all required security headers on every response
- [ ] CSP header is restrictive in production, report-only in development
- [ ] All database queries use Drizzle ORM parameterized queries (no raw SQL concatenation)
- [ ] Output encoding prevents XSS in JSON responses
- [ ] Request body size is limited to 1MB with 413 response on exceed
- [ ] Header injection attempts are rejected with 400 response
- [ ] API keys are stored as SHA-256 hashes with scope restrictions
- [ ] Authentication failures beyond 3 per 15 minutes are logged
- [ ] Permission denial events (403) are logged with full context
- [ ] Rate limit hits are logged when 429 is returned
- [ ] All security events are stored in `audit_events` table with required fields
