# API Versioning Specification

## Purpose

This spec defines the full operational policy for versioning the Athlos HTTP API. The `api-design/spec.md` establishes the *what* — `/api/v1/` path-based versioning. This spec defines the *how*: when to bump the major version, what counts as breaking vs. non-breaking, the deprecation lifecycle, version detection, the changelog, and the version compatibility matrix. Together they give API consumers a stable contract and a predictable migration path.

This spec applies to all `/api/v*` endpoints. The `/health` endpoint is unversioned and exempt.

---

## A. Versioning Strategy

### Requirement: Path-Based Major Version

The system MUST expose all API endpoints under a major version segment in the URL path: `/api/v{N}/...`, where `{N}` is a positive integer starting at `1`. Version is part of the URL contract, not a header.

#### Scenario: v1 endpoint reachable

- GIVEN the API is running
- WHEN a client requests `GET /api/v1/socios`
- THEN the v1 handler MUST respond (200 or 401, not 404)

#### Scenario: Unversioned /api path is rejected

- GIVEN the API is running
- WHEN a client requests `GET /api/socios` (no version segment)
- THEN the response MUST be 404 Not Found with `{"error":"NOT_FOUND","message":"Unknown API version","request_id":"..."}`

### Requirement: Major Version Bump Triggers

The system MUST release a new major version (`v2`, `v3`, ...) **only** when a change qualifies as breaking per Section B. Non-breaking changes (Section C) MUST be released under the current major version.

#### Scenario: v1 stays at v1 after non-breaking additions

- GIVEN v1 is the current stable version
- WHEN a new optional field is added to a v1 response (non-breaking per Section C)
- THEN the endpoint MUST continue to live at `/api/v1/...` — not at `/api/v2/...`

#### Scenario: v2 launched only after a breaking change

- GIVEN a field rename is required (breaking per Section B)
- WHEN the team plans the release
- THEN the v1 endpoint MUST be deprecated (Section D) and a new `/api/v2/...` route MUST be introduced
- AND v1 MUST continue to serve the unrenamed field during the deprecation window

### Requirement: v1 Locked Once Stable

The `/api/v1/` contract MUST be considered frozen once the v1 release is tagged. Any subsequent change to v1 routes MUST comply with Section B (breaking) or Section C (non-breaking). Frozen does not mean immutable — it means **every change is classified and reviewed**.

---

## B. What Counts as a Breaking Change

The following changes are breaking. Any one of them REQUIRES a new major version.

### Requirement: Endpoint Removal Is Breaking

Removing an existing endpoint (route + handler) is a breaking change. Clients calling it would receive 404 with no migration path.

#### Scenario: Endpoint removal requires v2

- GIVEN `GET /api/v1/legacy-report` exists
- WHEN the team decides to remove it
- THEN a new endpoint MUST NOT be the same path on `/api/v2/`
- AND the v1 endpoint MUST be deprecated per Section D, not silently deleted

### Requirement: Field Removal From Response Is Breaking

Removing any field from a JSON response body is breaking. Clients that read that field would get `undefined` with no error.

#### Scenario: Removing a response field requires v2

- GIVEN `GET /api/v1/socios/{id}` returns `{ id, nombre, apellido, telefono, ... }`
- WHEN `telefono` is removed from the projection
- THEN this MUST be treated as breaking
- AND `telefono` MUST remain in v1 (or v2 must be cut and v1 must be deprecated)

### Requirement: Field Type Change Is Breaking

Changing the JSON type of a field (e.g., `string` → `number`, `array` → `object`, ISO date string → epoch integer) is breaking. Clients expecting the old type will silently misbehave or throw.

### Requirement: Field Rename Is Breaking

Renaming a field (changing its key) is breaking. Same observable effect as removal + addition, but worse because the new name is unknown to the client.

### Requirement: Removing a Request Field Is Breaking

Removing a field that clients send in request bodies is breaking only if the field is **required**. Removing an optional request field is non-breaking (Section C).

### Requirement: Tightening Validation Is Breaking

A field that accepted `null`, `undefined`, empty string, or was entirely optional, and now rejects those values (returns 400), is a breaking change. The contract narrowed from the client's perspective.

#### Scenario: Optional → required is breaking

- GIVEN `POST /api/v1/socios` accepts `{ nombre, apellido }` with `email` optional
- WHEN v1 is updated to require `email`
- THEN requests without `email` that previously succeeded (201) MUST NOT start returning 400
- AND this change MUST be deferred to `/api/v2/socios`

### Requirement: Changing HTTP Status Code Semantics Is Breaking

Returning a different HTTP status code for the same outcome is breaking. Example: 200 → 204 for "delete success" when clients key off 200. Status code tables in `api-design/spec.md` are part of the contract.

### Requirement: Changing Error Codes Is Breaking

Changing the `error` field of an `ApiError` response is breaking. Clients that branch on the error code (e.g., `if (err.code === "INVALID_CREDENTIALS")`) would silently fail.

#### Scenario: Renaming an error code requires v2

- GIVEN v1 returns `{"error":"INVALID_CREDENTIALS"}` for wrong password
- WHEN the team renames the code to `AUTH_FAILED`
- THEN v1 MUST keep returning `INVALID_CREDENTIALS` for the same outcome
- AND the new code is allowed only on a future major version

### Requirement: Changing Pagination Strategy Is Breaking

Switching from cursor-based pagination to offset/limit, or changing the cursor encoding, is breaking. The `cursor`, `limit`, `has_more`, `next_cursor` contract in `api-design/spec.md` is locked.

---

## C. What Does NOT Count as a Breaking Change

The following changes are non-breaking and MUST ship under the current major version.

### Requirement: Adding a New Endpoint Is Non-Breaking

A new route (path + method) added to v1 is non-breaking. Existing clients ignore it; new clients opt in.

### Requirement: Adding an Optional Response Field Is Non-Breaking

Adding a new key to a JSON response body is non-breaking, as long as existing keys are unchanged. Clients ignore unknown fields by default.

#### Scenario: New response field ships in v1

- GIVEN `GET /api/v1/socios/{id}` returns `{ id, nombre, apellido }`
- WHEN the team adds `categoria` to the response
- THEN the endpoint MUST remain at `/api/v1/...`
- AND existing clients that only read `nombre` MUST NOT break

### Requirement: Adding an Optional Request Field Is Non-Breaking

Adding a new optional field to a request body is non-breaking. Clients that don't send it continue to work.

### Requirement: Loosening Validation Is Non-Breaking

A field that was required becoming optional, or a field rejecting fewer values (e.g., now accepting empty string), is non-breaking. The contract widened from the client's perspective.

### Requirement: Adding a New Error Code Is Non-Breaking

Adding a new value to the `error` enumeration is non-breaking, as long as existing codes for the same outcomes keep returning the same value. Clients should handle unknown codes defensively, but adding them is not a contract violation.

### Requirement: Adding a New Query Parameter Is Non-Breaking

A new optional query parameter is non-breaking. Clients that don't send it continue to work.

### Requirement: Adding a New Optional HTTP Header Is Non-Breaking

Adding a new response header (e.g., `X-RateLimit-Remaining`) is non-breaking. Clients ignore unknown headers.

### Requirement: Performance Improvements Are Non-Breaking

Reducing latency, increasing rate limits, or shrinking payload sizes (without removing fields) is non-breaking.

---

## D. Deprecation Policy

### Requirement: Deprecation Notice Mechanism

When an endpoint, field, or behavior is deprecated, the system MUST communicate deprecation through ALL of the following:

1. The `Deprecation: true` HTTP response header (RFC 8594).
2. The `Sunset: <HTTP-date>` HTTP response header (RFC 8594) indicating the date the endpoint will be removed.
3. The `Link: <docs-url>; rel="deprecation"` header pointing to the migration guide.
4. The API changelog (Section F).

#### Scenario: Deprecated endpoint signals Sunset

- GIVEN `GET /api/v1/legacy-report` is deprecated on 2026-01-15 and will be removed on 2026-07-15
- WHEN a client calls the endpoint on 2026-03-01
- THEN the response MUST include:
  - `Deprecation: true`
  - `Sunset: Wed, 15 Jul 2026 00:00:00 GMT`
  - `Link: <https://docs.athlos.example.com/migrations/legacy-report>; rel="deprecation"`

### Requirement: Minimum Support Window for Deprecated Endpoints

A deprecated v1 endpoint MUST continue to function for at least **6 months** from the deprecation date before it can be removed. This window gives clients time to migrate.

#### Scenario: Removal blocked before sunset

- GIVEN `GET /api/v1/legacy-report` is deprecated with `Sunset: 2026-07-15`
- WHEN a deploy on 2026-05-01 attempts to remove the route
- THEN the removal MUST be rejected (CI check or release gate)
- AND the endpoint MUST continue to respond normally

#### Scenario: Removal allowed after sunset

- GIVEN the sunset date `2026-07-15` has passed
- WHEN the team deploys a release that removes the route
- THEN removal is permitted
- AND the route MUST return 404 (not 500) once removed

### Requirement: Migration Guide Per Deprecated Endpoint

For every deprecated endpoint, the team MUST publish a migration guide that includes:
- The endpoint being deprecated
- The replacement endpoint or behavior
- A code example showing the before/after client call
- The sunset date
- The link target for the `Link` response header

#### Scenario: Migration guide published

- GIVEN `GET /api/v1/legacy-report` is deprecated
- WHEN a client follows the `Link: rel="deprecation"` header
- THEN the page MUST exist and contain the four elements above (endpoint, replacement, example, sunset date)

### Requirement: Backwards-Compatible Behavior During Deprecation

During the deprecation window, the deprecated endpoint MUST continue to behave exactly as it did before — same response shape, same status codes, same error codes. Changing the contract during the deprecation window is itself a breaking change.

---

## E. Version Detection

### Requirement: Path-Based Detection in Fastify

The system MUST register routes under version-prefixed paths (`/api/v1/...`, `/api/v2/...`) and dispatch on the URL path segment. The version is determined by the `v{N}` segment, not by header, query parameter, or content negotiation.

#### Scenario: v1 request dispatched to v1 handler

- GIVEN a v1 route handler is registered for `GET /api/v1/socios`
- WHEN `GET /api/v1/socios` arrives
- THEN the v1 handler MUST execute

#### Scenario: v2 request dispatched to v2 handler

- GIVEN a v2 route handler is registered for `GET /api/v2/socios`
- WHEN `GET /api/v2/socios` arrives
- THEN the v2 handler MUST execute — and the v1 handler MUST NOT execute for the same logical resource

### Requirement: Per-Route Version Tag

Every route registration in code MUST be tagged with its target version (e.g., `fastify.register(sociosRoutes, { prefix: '/api/v1' })`). The version prefix MUST NOT be hardcoded inside handlers; it MUST be configurable at registration time so the same handler can be mounted under `/api/v1` or `/api/v2` in tests.

#### Scenario: Handler is version-agnostic

- GIVEN a `sociosRoutes` plugin exists
- WHEN it is registered with `{ prefix: '/api/v1' }` in production
- AND registered with `{ prefix: '/api/v2' }` in a test harness
- THEN the handler code MUST be identical in both cases — no version branching inside the handler

### Requirement: Unknown Version Returns 404

If a client requests a path under `/api/v{N}/...` where `{N}` is not a registered version, the system MUST return 404 Not Found with the standard `ApiError` shape.

#### Scenario: v3 not yet released

- GIVEN only v1 and v2 are registered
- WHEN a client requests `GET /api/v3/socios`
- THEN the response MUST be 404 with `{"error":"NOT_FOUND","message":"API version v3 is not available","request_id":"..."}`

#### Scenario: Non-numeric version rejected

- GIVEN a client requests `GET /api/v1a/socios`
- WHEN the request is matched against registered routes
- THEN the response MUST be 404 — non-numeric versions MUST NOT match v1

---

## F. API Changelog

### Requirement: Changelog Per-Endpoint, Aggregated Globally

The system MUST maintain an API changelog that records every endpoint-level change. The changelog MUST be queryable:
- **Globally**: a single document listing all changes across all endpoints, in reverse chronological order.
- **Per-endpoint**: a route filter (e.g., `?endpoint=/api/v1/socios`) that returns the change history for that route.

#### Scenario: Global changelog list

- GIVEN three changes have shipped: added `categoria` to `Socio`, deprecated `legacy-report`, bumped v2
- WHEN a client requests `GET /api/v1/changelog`
- THEN the response MUST list all three entries, most recent first, each with `date`, `type` (added|changed|deprecated|removed), `endpoint`, `description`, `migration_guide_url`

#### Scenario: Per-endpoint filter

- GIVEN multiple changes to `/api/v1/socios` over time
- WHEN a client requests `GET /api/v1/changelog?endpoint=/api/v1/socios`
- THEN the response MUST contain only changes affecting that route

### Requirement: Changelog Source — OpenSpec Specs

The changelog MUST be derived from the OpenSpec specs under `openspec/changes/*/specs/*/spec.md`. The `Date`, `type`, and `description` fields come from the change proposal and the spec's MODIFIED/ADDED/REMOVED sections. Manual entries are allowed only when no spec change is involved (e.g., a hotfix to error message wording).

#### Scenario: Change proposal produces a changelog entry

- GIVEN a proposal adds an optional `categoria` field to `Socio` in v1
- WHEN the change is merged
- THEN a changelog entry MUST be auto-generated with `type: "added"`, `endpoint: "/api/v1/socios/{id}"`, `date: <merge date>`, `description: "Added optional categoria field"`

### Requirement: Changelog Publication

The changelog MUST be published at a stable URL:
- **Public read API**: `GET /api/v1/changelog` and `GET /api/v1/changelog?endpoint=...`
- **Static documentation site**: `https://docs.athlos.example.com/changelog`

The read API is the source of truth. The static site is a generated mirror.

### Requirement: Changelog Is Immutable

Once an entry is published, its `date`, `type`, and `endpoint` MUST NOT change. Corrections are published as new entries (with `type: "clarification"` or `type: "correction"`). This guarantees auditability.

---

## G. Client Compatibility

### Requirement: API Stability Promise for v1

The `/api/v1/` contract MUST be considered **stable** from the moment the v1 release tag is cut. Stability means:
- No breaking change ships to v1 (breaking changes go to v2).
- Within v1, only Section C (non-breaking) changes are allowed without notice.
- Section C changes MAY be communicated in the changelog but do not require advance notice.

### Requirement: Breaking Change Communication Window

When a breaking change is planned, the system MUST communicate it to API consumers at least **90 days** before the breaking change ships to the affected major version. Communication channels:
- The `Deprecation: true` and `Sunset:` headers on the affected endpoint (90 days before removal).
- A changelog entry with `type: "deprecated"`.
- An entry on the operator-facing release notes (in-app banner for internal users).
- For external integrators (if any in v1), an email to the registered contact.

#### Scenario: 90-day deprecation notice

- GIVEN a breaking change is planned for 2026-09-01
- WHEN the change is announced
- THEN the affected endpoint MUST start returning `Deprecation: true` and `Sunset: 2026-09-01` no later than 2026-06-03
- AND a changelog entry MUST be published on the same date

### Requirement: External Integrator Registration

If any v1 client is an external integration (third party), the operator MUST be able to register an integration contact (email + webhook URL) in the admin panel. The system MUST use this contact for breaking change notifications.

#### Scenario: External integrator notified

- GIVEN an external integration "Partner App" is registered with `notification_email=ops@partner.example.com`
- WHEN a breaking change is announced for an endpoint that "Partner App" calls
- THEN an email MUST be sent to `ops@partner.example.com` with the migration guide and sunset date

### Requirement: Client Identification Header

Clients MAY identify themselves via the `User-Agent` header. The system MUST log the `User-Agent` on every request and SHOULD surface per-client call volume in the admin dashboard (e.g., "Partner App made 12,345 calls in the last 7 days"). This is for proactive outreach, not for blocking.

---

## H. Version Compatibility Matrix

### Requirement: Initial v1 Commitment

The system MUST support `/api/v1/` from the v1 release date until at least **2027-12-31** (24 months minimum from v1.0.0). Removal of v1 before this date requires an explicit deprecation cycle even if a v2 is shipping.

#### Scenario: v1 supported for 24 months

- GIVEN v1.0.0 is released on 2026-01-01
- WHEN a client calls `/api/v1/socios` on 2027-06-01
- THEN the endpoint MUST still respond (200 or auth failure, not 404)

### Requirement: Overlap Period When a New Major Version Ships

When a new major version (e.g., v2) is released, the previous major version (v1) MUST continue to operate for the full deprecation window (Section D, minimum 6 months from the v2 release date). During this overlap:
- Both v1 and v2 are supported.
- v1 receives only security and critical bug fixes — no new features.
- v2 receives all new development.

#### Scenario: v1 and v2 both supported during overlap

- GIVEN v2.0.0 is released on 2026-09-01
- WHEN a client calls `/api/v1/socios` on 2026-12-01 (3 months into overlap)
- THEN the v1 endpoint MUST still respond normally
- AND a parallel call to `/api/v2/socios` MUST also respond (with the v2 contract)

### Requirement: Compatibility Matrix Documentation

The system MUST publish a compatibility matrix in the documentation (`https://docs.athlos.example.com/api/versions`) showing for each released major version:
- Release date
- Current status: `current` | `deprecated` | `sunset`
- Sunset date (if applicable)
- Migration guide URL (if deprecated)

#### Scenario: Compatibility matrix queryable

- GIVEN v1 was released on 2026-01-01 and v2 on 2026-09-01
- WHEN a client requests the compatibility matrix
- THEN the response MUST show:
  - v1: status `deprecated`, sunset `2027-03-01` (6 months after v2 release), migration guide URL
  - v2: status `current`, no sunset

### Requirement: Maximum of Two Major Versions Coexisting

The system MUST NOT support more than two major versions concurrently. If a v3 is being planned while v1 is still in its deprecation window, the v1 sunset MUST be accelerated to free a slot — or v3 release MUST be delayed. The 2-version cap prevents operational and documentation overhead from growing unbounded.

#### Scenario: v3 blocked while v1 still alive

- GIVEN v1 is deprecated with sunset 2027-03-01 and v2 is current
- WHEN the team proposes v3 with a 2027-02-01 release
- THEN the v3 release MUST be blocked at planning time (release gate)
- AND the team MUST either accelerate v1 sunset to before 2027-02-01 or delay v3 to 2027-03-02

---

## I. Version Header in Responses

### Requirement: API-Version Response Header

The system MUST include the `API-Version` response header on every `/api/v*/...` response, set to the major version that handled the request (e.g., `API-Version: v1`). This lets clients detect which version they hit, especially behind proxies or during migrations.

#### Scenario: Response header present

- GIVEN a client calls `GET /api/v1/socios`
- WHEN the response is returned
- THEN the response MUST include `API-Version: v1`

#### Scenario: Different versions report different headers

- GIVEN v1 and v2 are both registered
- WHEN a client calls `/api/v1/socios` and `/api/v2/socios`
- THEN the first response MUST include `API-Version: v1`
- AND the second response MUST include `API-Version: v2`

### Requirement: Deprecation Headers on Sunset-Approaching Responses

When a deprecated endpoint is within 30 days of its sunset date, the system MUST additionally include a `Warning: 299 - "This endpoint will be removed on <date>"` header (RFC 7234 / RFC 8594 style). This is a final-warning signal distinct from the always-present `Deprecation: true`.

#### Scenario: Final warning issued

- GIVEN an endpoint is deprecated with sunset `2026-07-15`
- WHEN a client calls it on 2026-06-20 (25 days before sunset)
- THEN the response MUST include `Warning: 299 - "This endpoint will be removed on 2026-07-15"`

---

## Success Criteria

- [ ] Every `/api/v*/...` endpoint returns the `API-Version` response header
- [ ] The breaking change classification (Section B) is documented and applied before any v1 route is modified
- [ ] The non-breaking change classification (Section C) is documented and applied before any v1 route is extended
- [ ] A deprecated endpoint returns `Deprecation: true`, `Sunset: <date>`, and `Link: rel="deprecation"` headers
- [ ] Deprecated endpoints remain functional for at least 6 months after deprecation
- [ ] A migration guide is published for every deprecated endpoint, reachable via the `Link` header
- [ ] An unknown version (`/api/v3/...` when only v1 and v2 exist) returns 404 with the standard `ApiError` shape
- [ ] The API changelog is queryable globally and per-endpoint
- [ ] External integrators receive breaking change notification at least 90 days before the change ships
- [ ] A compatibility matrix is published listing each major version's status, release date, and sunset date
- [ ] No more than two major versions coexist at any time
- [ ] v1 is supported for at least 24 months from its initial release
- [ ] Routes are version-prefixed at registration time, not hardcoded in handlers

---

## Cross-References

- `api-design/spec.md` — defines the high-level versioning requirement, base URL structure, error format, status codes, and pagination contract. This spec expands the versioning policy in detail.
- `error-handling/spec.md` — error code enumeration; per Section B, changing an error code is breaking.
- `api-security/spec.md` — applies to all versions; security controls are version-independent.
- `monitoring-observability/spec.md` — health checks and metrics are version-independent.
