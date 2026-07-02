# Caching Specification

## Purpose

Defines the caching strategy for Athlos across all layers — client (TanStack Query), server (in-process), and database (PostgreSQL built-in). Establishes stale times, invalidation triggers, cache key conventions, stale-while-revalidate behavior, and what MUST NOT be cached. v1 deliberately keeps caching simple: no Redis, no server-side app cache, no distributed cache. Freshness is the dominant requirement; cache is a UX optimization, not a correctness mechanism.

---

## 1. Cache Strategy by Layer

### Requirement: Three-Layer Cache Model

Athlos SHALL use a three-layer cache model. Each layer has a distinct owner, lifetime, and invalidation path. A MUST NOT exist at one layer SHALL NOT be reintroduced at another without a design decision.

| Layer | Technology | Owner | Lifetime | v1 Status |
|-------|-----------|-------|----------|-----------|
| Client (browser) | TanStack Query in-memory cache | Browser tab | Until tab close or explicit invalidation | Required |
| Server (Node process) | None (no Redis, no LRU) | — | — | Out of scope v1 |
| Database (PostgreSQL) | Built-in shared buffer cache + query planner cache | Postgres | Process lifetime | Implicit, no config needed |

#### Scenario: Client cache serves repeat reads

- GIVEN the UI has fetched `/api/v1/socios/123` once via TanStack Query
- WHEN the user navigates to the detail view again within the stale time
- THEN no network request is issued
- AND the cached response is returned immediately

#### Scenario: No server-side cache in v1

- GIVEN a read endpoint `/api/v1/ctacte/saldo?socio=123` is hit twice
- WHEN the second request arrives
- THEN the server hits PostgreSQL on every call (no in-process cache, no Redis lookup)

#### Scenario: PostgreSQL caches query plans

- GIVEN the same parameterized query runs many times
- WHEN PostgreSQL parses and plans the query
- THEN the plan is cached server-side by Postgres
- AND subsequent executions skip parse+plan phases (implicit, no app config)

### Requirement: v1 Scope Excludes Distributed Cache

The system MUST NOT introduce Redis, Memcached, or any external cache service in v1. If server-side caching becomes necessary in a future phase, it SHALL be re-specced as a new capability (`server-cache` or similar).

#### Scenario: No Redis dependency in v1

- GIVEN v1 is being deployed
- WHEN the deployment manifest is reviewed
- THEN no Redis pod, sidecar, or managed service is required
- AND the system runs on Postgres + Node + browser only

---

## 2. Client-Side Cache (TanStack Query)

### Requirement: TanStack Query as Single Source of Client Cache

The frontend MUST use TanStack Query (React Query) as the single client-side cache layer. The system SHALL NOT introduce Redux, Zustand, MobX, SWR, or other data-fetching/caching libraries to duplicate server state.

#### Scenario: All server reads go through TanStack Query

- GIVEN a React component needs data from `/api/v1/socios`
- WHEN the component mounts
- THEN the fetch is performed via `useQuery({ queryKey: ['socios'], queryFn: ... })`
- AND the result is cached and shared across all subscribers to the same key

#### Scenario: No duplicate state library for server data

- GIVEN a developer is adding a new screen that reads projections
- WHEN the implementation is reviewed
- THEN it uses `useQuery` or `useSuspenseQuery` — not `useEffect` + `fetch` + `useState`

### Requirement: Default Stale Time per Resource Type

The system SHALL configure `staleTime` per resource type based on how often the underlying data changes. Defaults are encoded in a central `queryClient.ts` factory and overridable per query.

| Resource | staleTime | gcTime | Rationale |
|----------|-----------|--------|-----------|
| `parametros` | 1 hour | 24 hours | Configuration; changes rarely, only on param.dbf import |
| `catalogos` (tipocomp, SECUENCI) | 1 hour | 24 hours | Reference data; rarely changes |
| `socios` (list) | 5 minutes | 1 hour | Changes during member onboarding, infrequent |
| `socio` (single) | 5 minutes | 1 hour | Same as list |
| `ctacte` (cuenta corriente) | 30 seconds | 5 minutes | Frequently updated by legacy; balance must feel live |
| `ctacte1` (movimientos) | 30 seconds | 5 minutes | Same domain as ctacte |
| `contable` / `contabl1` | 1 minute | 10 minutes | Accounting lines; changes daily but not second-by-second |
| `caja` (cash movements) | 30 seconds | 5 minutes | Daily operations; freshness matters |
| `proyecciones` (projections) | 5 minutes | 1 hour | Rebuilt from raw; changes after imports |
| `lineage` (per record) | Infinity | 24 hours | Lineage is immutable per import batch |
| `freshness` (sync status) | 0 (always stale) | 1 minute | MUST refetch on focus; operators rely on real-time status |
| `audit-log` | 0 (always stale) | 5 minutes | MUST always be fresh; audit events are append-only |
| `users` (admin) | 1 minute | 10 minutes | Rarely changes, but roles must be current |
| `auth/me` (current user) | 5 minutes | 1 hour | Profile data; changes infrequently |

#### Scenario: Stale config triggers background refetch

- GIVEN `parametros` was fetched 30 minutes ago
- AND staleTime is 1 hour
- WHEN a component subscribes to the query
- THEN no refetch occurs (still fresh)

#### Scenario: Stale ctacte triggers background refetch

- GIVEN `ctacte/saldo?socio=123` was fetched 1 minute ago
- AND staleTime is 30 seconds
- WHEN the user focuses the tab or remounts the component
- THEN a background refetch is triggered automatically

#### Scenario: Freshness status always refetches on focus

- GIVEN the freshness indicator was last fetched 10 seconds ago
- AND staleTime is 0 (always stale)
- WHEN the user returns to the tab
- THEN a refetch is triggered immediately on focus

### Requirement: QueryClient Factory with Sensible Defaults

The frontend MUST export a `createQueryClient()` factory that configures the defaults above. Application bootstrap SHALL use the factory and never construct `new QueryClient()` ad hoc.

#### Scenario: Factory used at app entry

- GIVEN the app starts in `main.tsx`
- WHEN the `QueryClientProvider` is mounted
- THEN `createQueryClient()` is called and its return value is passed to the provider
- AND individual `useQuery` calls inherit the defaults unless they override `staleTime` explicitly

#### Scenario: Per-query override for critical data

- GIVEN a screen displays the current account balance
- WHEN the component uses `useQuery({ queryKey: ['ctacte','saldo',socioId], staleTime: 0 })`
- THEN that specific query refetches on every mount/focus regardless of the global default

### Requirement: Background Refetch on Window Focus

TanStack Query's `refetchOnWindowFocus` MUST be enabled globally and SHALL default to `true`. This ensures operators see fresh data when returning to the tab without manual refresh.

#### Scenario: Window focus triggers refetch

- GIVEN the user has been away from the tab for 2 minutes
- AND multiple queries are in stale state
- WHEN the user focuses the tab
- THEN all stale queries refetch in the background
- AND the UI updates without a full page reload

### Requirement: Retry with Exponential Backoff

The frontend MUST configure TanStack Query retry with exponential backoff: 3 attempts, 1s → 2s → 4s, with jitter. Mutations SHOULD retry once on network failure only.

#### Scenario: Transient network failure

- GIVEN a query fails with `NetworkError`
- WHEN the first attempt fails
- THEN the query waits ~1s and retries
- AND if it fails again, waits ~2s
- AND if it fails a third time, surfaces the error to the UI

#### Scenario: 4xx errors are not retried

- GIVEN a query fails with HTTP 404
- WHEN the response is received
- THEN no retry is attempted
- AND the error is surfaced immediately to the UI

---

## 3. Server-Side Cache

### Requirement: No Application-Level Server Cache in v1

The backend MUST NOT implement any in-memory LRU, response cache, or query result cache. Every read endpoint SHALL execute its query against PostgreSQL on every call. v1 prioritizes data freshness and simplicity over latency optimization.

#### Scenario: Every read hits the database

- GIVEN an endpoint `/api/v1/socios/123` is called 100 times in a loop
- WHEN each request is processed
- THEN each request executes a SELECT against PostgreSQL
- AND no in-process map or cache short-circuits the call

#### Scenario: Projections are not cached server-side

- GIVEN a projection is recomputed on every request
- WHEN the projection engine runs
- THEN it queries raw tables and aggregates in memory
- AND does not write or read from any cache layer

### Requirement: Future Server Cache Requires Re-spec

If a future phase introduces server-side caching, that capability SHALL be added as a new domain spec (e.g., `server-cache/spec.md`) with explicit invalidation rules. The MUST NOT clauses in this spec apply until that capability is formally added.

#### Scenario: Latency pressure prompts re-spec

- GIVEN p95 read latency for `ctacte/saldo` exceeds 200ms in v2
- WHEN the team considers adding Redis
- THEN a new proposal + spec + design is created
- AND the v1 caching spec is updated with a MODIFIED requirement, not silently extended

---

## 4. Cache Invalidation Triggers

### Requirement: Mutation Triggers Targeted Invalidation

When a mutation succeeds, the frontend MUST invalidate the smallest set of TanStack Query keys that could be affected. Global invalidation (`queryClient.invalidateQueries()`) SHALL NOT be used except in exceptional cases (e.g., logout, config reload).

#### Scenario: Creating a socio invalidates list

- GIVEN a mutation `POST /api/v1/socios` succeeds
- WHEN the `onSuccess` handler runs
- THEN `queryClient.invalidateQueries({ queryKey: ['socios'] })` is called
- AND the detail query for the new socio is prefetched
- AND unrelated queries (e.g., `ctacte`, `audit-log`) are NOT invalidated

#### Scenario: Recording a payment invalidates balance and movements

- GIVEN a mutation `POST /api/v1/ctacte/pagos` succeeds
- WHEN the `onSuccess` handler runs
- THEN `['ctacte', 'saldo', socioId]` is invalidated
- AND `['ctacte1', socioId]` is invalidated
- AND `['ctacte1', 'list', socioId]` is invalidated
- AND unrelated queries are NOT invalidated

#### Scenario: Logout invalidates everything

- GIVEN the user clicks "logout"
- WHEN the logout mutation succeeds
- THEN `queryClient.clear()` is called
- AND the next render shows the login screen with no stale data from the previous user

### Requirement: Import Completion Invalidates Projections

When the UI observes an import completion (via polling, websocket, or freshness status update), the frontend SHALL invalidate all projection-related queries. Since v1 has no server-side projection cache, this invalidation only affects the client cache.

#### Scenario: Import completion refreshes affected views

- GIVEN the freshness status for `socios` updates from `stale` to `current`
- WHEN the freshness status hook detects the change
- THEN `['socios']` and `['socios', socioId]` queries are invalidated
- AND `['proyecciones', 'socios']` is invalidated
- AND `['freshness']` is invalidated to update the indicator

### Requirement: Drift Detection Invalidation

When a drift-detector job reports drift for a domain, the affected client queries SHALL be invalidated so the next render shows the corrected data. Drift alerts SHOULD prompt the user to refresh manually.

#### Scenario: Drift detected in CTACTE

- GIVEN a drift report for `ctacte` is received (via API or websocket)
- WHEN the drift handler runs
- THEN all `['ctacte', ...]` queries are invalidated
- AND a non-blocking toast informs the operator: "Drift detected in CTACTE — data refreshed"

### Requirement: Stale Time Is the Default Invalidation Mechanism

For data that changes passively (legacy writes, background imports, other users), the per-resource `staleTime` is the primary invalidation mechanism. After staleTime elapses, the next focus/mount triggers a refetch. Explicit invalidation is required only for data the current user just mutated.

#### Scenario: Passive invalidation via stale time

- GIVEN `socio/123` was fetched 10 minutes ago (staleTime 5 minutes)
- AND no mutation has occurred
- WHEN the user remounts the detail view
- THEN TanStack Query refetches in the background
- AND the UI shows the latest data without explicit invalidation

---

## 5. Cache Key Conventions

### Requirement: Hierarchical Query Key Structure

The system SHALL use a hierarchical `queryKey` array of the form `[resource, scope?, ...params]`. Keys MUST be deterministic — same input MUST produce same key. Keys MUST NOT include user-controlled untrusted data without sanitization (to prevent cache poisoning via key collisions).

| Resource | Query Key Pattern | Example |
|----------|-------------------|---------|
| Socio list | `['socios', 'list', filters?]` | `['socios', 'list', { estado: 'activo' }]` |
| Socio detail | `['socios', 'detail', id]` | `['socios', 'detail', 123]` |
| Cuenta corriente saldo | `['ctacte', 'saldo', socioId]` | `['ctacte', 'saldo', 123]` |
| Movimientos (CTACTE1) list | `['ctacte1', 'list', socioId, filters?]` | `['ctacte1', 'list', 123, { desde: '2024-01-01' }]` |
| Contable lines | `['contabl1', 'list', filters?]` | `['contabl1', 'list', { ejercicio: 2024 }]` |
| Projections | `['proyecciones', domain]` | `['proyecciones', 'socios']` |
| Lineage | `['lineage', resource, id]` | `['lineage', 'socio', 123]` |
| Freshness | `['freshness', domain?]` | `['freshness']` or `['freshness', 'ctacte']` |
| Audit log | `['audit-log', filters?]` | `['audit-log', { usuario: 5, desde: '2024-06-01' }]` |
| Auth current user | `['auth', 'me']` | `['auth', 'me']` |
| Users (admin) | `['users', 'list', filters?]` | `['users', 'list', { rol: 'admin' }]` |
| Parametros | `['parametros']` | `['parametros']` |

#### Scenario: Stable key for parameterized query

- GIVEN a developer writes `useQuery({ queryKey: ['socios', 'detail', socioId], ... })`
- WHEN `socioId` is 123
- THEN the cache key is `['socios', 'detail', 123]`
- AND a different `socioId` produces a different key, isolating the cache entry

#### Scenario: Filter objects in keys must be serializable

- GIVEN a list query accepts filters `{ estado: 'activo', page: 2 }`
- WHEN the filter object is included in the query key
- THEN the object's keys are inserted in a stable order (e.g., alphabetical) to avoid cache misses from key ordering
- AND the filter object is shallow (no nested arrays, no functions, no Dates serialized as anything but ISO strings)

#### Scenario: Invalidation by prefix

- GIVEN a mutation affects all `ctacte` queries for socio 123
- WHEN the developer calls `queryClient.invalidateQueries({ queryKey: ['ctacte', 'saldo', 123] })`
- THEN only the `['ctacte', 'saldo', 123]` key is invalidated
- AND `queryClient.invalidateQueries({ queryKey: ['ctacte'] })` would invalidate ALL ctacte keys (broader blast radius; use only when justified)

### Requirement: Query Key Factory Pattern

The frontend MUST centralize query key construction in a `queryKeys` factory module. Components SHALL NOT build query keys as inline string concatenation.

#### Scenario: Factory function used

- GIVEN a developer needs the key for socio detail
- WHEN the component is implemented
- THEN it imports `queryKeys.socios.detail(id)` and uses the return value
- AND renames or refactors can be done in one place

#### Scenario: No inline key construction

- GIVEN a code review
- WHEN the reviewer inspects a `useQuery` call
- THEN the queryKey is a call to a `queryKeys` factory function
- AND NOT a hardcoded `['socios', 'detail', id]` literal in the component

---

## 6. Stale-While-Revalidate Strategy

### Requirement: Stale-While-Revalidate for Slow-Changing Data

For slow-changing reference data (padrones list, catalogos, parametros), the frontend MUST use stale-while-revalidate: serve the cached value immediately, refetch in the background, update when the new data arrives. The user MUST NOT see a loading spinner for data they already have.

#### Scenario: Stale-while-revalidate on padrones list

- GIVEN the padrones list was fetched 3 hours ago (staleTime 1 hour, so stale)
- WHEN the user opens the padrones screen
- THEN the cached list is rendered immediately
- AND a background refetch starts without a loading indicator
- AND when the refetch completes, the UI updates seamlessly if the data changed

### Requirement: Short Stale Time for Frequently-Changing Data

For frequently-changing data (cuenta corriente saldo, caja movements, audit log), the frontend MUST use short stale times (0 to 30 seconds) so users see near-real-time values. SWR is still used, but the window is tight.

#### Scenario: Cuenta corriente shows fresh balance

- GIVEN the user's balance was fetched 20 seconds ago (staleTime 30s, still fresh)
- AND another operator recorded a payment 5 seconds ago
- WHEN the current user focuses the cuenta corriente view
- AND 30 seconds have elapsed since the last fetch
- THEN a background refetch fires
- AND the new balance is reflected within 1-2 seconds

### Requirement: Audit Log Never Uses Long Stale Time

The audit log MUST have `staleTime: 0` (always stale) and SHOULD be refetched on every mount. Audit events are append-only and operators MUST see the latest entries.

#### Scenario: Audit log refreshes on view

- GIVEN an operator opens the audit log screen
- WHEN the component mounts
- THEN a fresh fetch is issued
- AND the latest events are displayed immediately (no stale-while-revalidate)

### Requirement: Lineage Is Effectively Immutable per Batch

Lineage data for a given raw record is immutable until the next import. The frontend SHOULD set `staleTime: Infinity` for lineage queries keyed by `(resource, id)`. Invalidation SHALL occur only when the operator triggers a "check lineage after import" action.

#### Scenario: Lineage does not refetch passively

- GIVEN lineage for `socio/123` was fetched
- WHEN the user navigates away and back 1 hour later
- THEN no refetch is issued (staleTime: Infinity)
- AND the lineage shown is from the last import batch

---

## 7. What MUST NOT Be Cached

### Requirement: Auth Tokens Never Cached in TanStack Query

Authentication tokens (JWT access token, refresh token) MUST NOT be stored in TanStack Query, React state, localStorage, or sessionStorage. Tokens SHALL be stored in httpOnly secure cookies (set by the server) or in-memory only. TanStack Query MUST NOT be used to cache anything under `['auth', 'token', ...]` or similar keys.

#### Scenario: No token in query cache

- GIVEN a developer is tempted to cache the JWT for convenience
- WHEN the code is reviewed
- THEN the review rejects the implementation
- AND the token is read from the httpOnly cookie or in-memory store only

### Requirement: Sensitive PII Permitted in Client Cache (Session-Scoped)

Sensitive personal data (DNI, CUIT, address, phone, email, payment amounts) MAY be cached in TanStack Query because the cache is per-tab and per-user (other users on the same browser do not share state in v1). However, the cache MUST be cleared on logout via `queryClient.clear()`.

#### Scenario: DNI cached for display

- GIVEN a socio detail screen needs to display the DNI
- WHEN the query `['socios', 'detail', id]` is fetched
- THEN the DNI is included in the response and cached
- AND the value persists in the tab until logout

#### Scenario: Cache cleared on logout

- GIVEN a user logs out
- WHEN the logout mutation succeeds
- THEN `queryClient.clear()` is called
- AND a subsequent user on the same browser cannot see the previous user's socio details by remounting the component (the cache is empty)

### Requirement: Audit Log Always Fresh (No Long Cache)

The audit log endpoint MUST NOT be cached beyond `staleTime: 0`. Audit events are sensitive compliance data; operators MUST always see the latest entries. The `gcTime` (garbage collection time) for audit queries SHOULD be short (5 minutes max) to limit memory exposure.

#### Scenario: Audit log refetches on focus

- GIVEN the audit log screen was last viewed 30 seconds ago
- WHEN the user returns to the tab
- THEN a refetch is triggered immediately
- AND the operator sees events from the last 30 seconds that may have been added

### Requirement: Saldo Never Cached Server-Side

Saldo (account balance) MUST NOT be cached in any server-side cache. The saldo SHALL be recalculated from raw CTACTE records on every request. This requirement is consistent with the projection-engine spec and prevents the legacy `SOCSALDO` / `CCTSALDO` cache-corruption risk.

#### Scenario: Saldo recalculated on every call

- GIVEN a request to `/api/v1/ctacte/saldo?socio=123`
- WHEN the server processes the request
- THEN it queries `SUM(...) FROM raw_ctacte WHERE socio_id = 123`
- AND does NOT read from any cached `saldo` column or precomputed balance

### Requirement: Approval Tokens Never Cached

Approval tokens (used in the auth-approval-link flow) MUST NOT be cached client-side or server-side beyond their declared TTL. The token SHALL be treated as a one-time secret. Caching an approval token in TanStack Query, localStorage, or any other store SHALL be treated as a security bug.

#### Scenario: Approval token is not persisted

- GIVEN a user opens an approval link
- WHEN the frontend processes the token
- THEN the token is read from the URL fragment only
- AND is not stored in TanStack Query, localStorage, or sessionStorage
- AND is not logged in any client-side log

---

## Success Criteria

- [ ] All server reads go through TanStack Query; no parallel state library for server data
- [ ] `createQueryClient()` factory is the single source of query defaults
- [ ] Per-resource `staleTime` table is implemented and documented
- [ ] Window focus refetch is enabled globally
- [ ] No server-side cache (Redis, LRU) exists in v1
- [ ] Mutations invalidate the smallest correct set of keys
- [ ] Drift and import-completion events trigger targeted invalidation
- [ ] `queryKeys` factory exists and is used by all queries
- [ ] Auth tokens are never cached in TanStack Query or browser storage
- [ ] Saldo is always recomputed from raw CTACTE (no server cache)
- [ ] Audit log uses `staleTime: 0`
- [ ] Lineage uses `staleTime: Infinity` (or batch-scoped)
- [ ] Sensitive PII is cleared on logout via `queryClient.clear()`
- [ ] Approval tokens are never persisted client-side
