# Auth Cookies Specification

## Purpose

Defines the transport contract for the Athlos refresh token as an httpOnly cookie, plus the Next.js first-party proxy routes that ensure the cookie stays first-party relative to the browser. The backend cookie behavior is owned by a separate backend slice (deferred); this spec is the **contract** that the web client consumes and that the backend implementation MUST satisfy.

---

## Requirements

### Requirement: Refresh Cookie Transport Contract

The system SHALL transport the refresh token as an httpOnly cookie named `athlos_refresh`, set and consumed by the Fastify API. The web client SHALL never read or write this cookie directly — all interactions flow through the API or the Next.js first-party proxy.

#### Scenario: Cookie set on successful login

- GIVEN a successful `POST /api/v1/auth/login` response
- WHEN the API responds 200 with login body
- THEN the API SHALL set a `Set-Cookie` header with name `athlos_refresh`, value `<opaque-refresh-token>`, `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age=604800` (7 days)

#### Scenario: Cookie read on refresh

- GIVEN a browser request to `POST /api/v1/auth/refresh`
- WHEN the request includes a valid `athlos_refresh` cookie
- THEN the API SHALL read the refresh token from the cookie (NOT from request body)
- AND SHALL respond 200 with a new access token + new refresh cookie

#### Scenario: Cookie cleared on logout

- GIVEN a browser request to `POST /api/v1/auth/logout`
- WHEN the API responds 200
- THEN the API SHALL set `Set-Cookie: athlos_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
- AND the browser SHALL drop the cookie

#### Scenario: CORS credentials enabled

- GIVEN the web origin is in the API's CORS allowlist
- WHEN the web client makes a cross-origin request
- THEN the API SHALL include `Access-Control-Allow-Credentials: true`
- AND the browser SHALL allow the refresh cookie to be sent

### Requirement: First-Party Auth Proxy Routes

The system SHALL expose Next.js API routes under `/api/auth/*` that proxy auth requests to the Fastify API so the refresh cookie stays first-party relative to the browser origin. The web client SHALL call these proxy routes — not the Fastify API directly — for login, refresh, and logout.

#### Scenario: Login proxy route

- GIVEN the web client calls `POST /api/auth/login` from browser code
- WHEN the Next.js route handler runs
- THEN it SHALL forward the request body to `${API_BASE_URL}/api/v1/auth/login`
- AND SHALL forward the response body and the `Set-Cookie` header back to the browser
- AND the cookie SHALL be set on the web origin (first-party)

#### Scenario: Refresh proxy route

- GIVEN the web client calls `POST /api/auth/refresh` from browser code
- WHEN the Next.js route handler runs
- THEN it SHALL forward the request to `${API_BASE_URL}/api/v1/auth/refresh` (cookie passes through)
- AND SHALL forward the new `Set-Cookie` header back to the browser

#### Scenario: Logout proxy route

- GIVEN the web client calls `POST /api/auth/logout` from browser code
- WHEN the Next.js route handler runs
- THEN it SHALL forward the request to `${API_BASE_URL}/api/v1/auth/logout` (cookie passes through)
- AND SHALL forward the clearing `Set-Cookie` header back to the browser
- AND the browser SHALL drop the `athlos_refresh` cookie

### Requirement: Backend Implementation Deferred

The backend behavior described in this spec (setting/reading/clearing the cookie + CORS credentials) is **owned by a separate backend slice**. The web client code in this PR depends ONLY on the contract. If the backend slice slips, PR 8a.1 SHALL ship with body-based refresh as a fallback and SHALL migrate to cookie transport in PR 8a.2.

#### Scenario: Backend slice not yet shipped

- GIVEN the backend slice for cookie transport has not landed
- WHEN PR 8a.1 ships
- THEN the web client SHALL send the refresh token in the request body (`{ refresh_token: ... }`)
- AND the Fastify API SHALL accept body-based refresh (existing behavior)

#### Scenario: Backend slice shipped, migration

- GIVEN the backend cookie slice lands
- WHEN PR 8a.2 lands
- THEN the web client SHALL migrate to cookie-only refresh
- AND the proxy routes SHALL drop the body-based fallback

---

## Success Criteria

- **auth-cookies NEW**: Documented contract — refresh cookie is set on login, read on refresh, cleared on logout, with `HttpOnly + Secure + SameSite=Lax` flags. Next.js first-party proxy routes forward `Set-Cookie` headers unchanged so the cookie persists across reloads.