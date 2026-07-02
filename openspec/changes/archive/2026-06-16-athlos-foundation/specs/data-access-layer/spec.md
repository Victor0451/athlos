# Data Access Layer Specification

## Purpose

Define the Data Access Layer (DAL) for Athlos — the contract between the API/service layer and the PostgreSQL database. This spec covers query patterns, schema organization, transaction handling, connection pooling, error translation, and type safety. The DAL is the ONLY layer that talks to PostgreSQL directly. Everything above it (API handlers, business services) MUST go through the DAL.

The DAL uses Drizzle ORM. It spans 5 PostgreSQL schemas (`public`, `socios`, `contabilidad`, `tesoreria`, `deportes`) and must support both Phase 1 (read-only coexistence with legacy) and Phase 2+ (write authority after cutover).

---

## 1. Pattern Choice

### Requirement: Repository Pattern Per Domain

The data access layer MUST follow the Repository pattern, organized by domain (one repository class/module per PostgreSQL schema). Repository methods are the ONLY public API for database access — API handlers, services, and jobs MUST NOT execute Drizzle queries directly.

#### Scenario: A handler needs a socio by ID

- GIVEN the API handler at `GET /api/v1/socios/:id` needs to fetch socio with id=42
- WHEN the handler is executed
- THEN it MUST call `sociosRepository.findById(42)` (or an injected equivalent)
- AND it MUST NOT call `db.select().from(socio).where(eq(socio.id, 42))` directly

#### Scenario: A cross-domain query spans two repositories

- GIVEN a report joins `socios.socio` with `contabilidad.asiento`
- WHEN the report service is executed
- THEN it MUST call a dedicated `reportingRepository` (a cross-domain coordinator) OR orchestrate two repositories inside a single transaction
- AND it MUST NOT reach into both schemas from a single ad-hoc Drizzle call

### Requirement: Service Layer Sits Above Repositories

Repositories MUST contain ONLY data access logic (SQL construction, row-to-entity mapping, schema-aware queries). Business rules, multi-step orchestration, and validation MUST live in a service layer above the repositories. Route handlers MUST call services, not repositories directly (except trivial reads where a service would be ceremony).

#### Scenario: Creating a payment touches cuenta corriente + asiento

- GIVEN a POST `/api/v1/pagos` must insert into `socios.cuenta_corriente` AND `contabilidad.asiento` atomically
- WHEN the route handler is called
- THEN the handler MUST call `pagosService.createPayment(input)` 
- AND `pagosService` MUST call both `cuentaCorrienteRepository` and `asientoRepository` inside a transaction
- AND the route handler MUST NOT contain the transaction or the two repository calls

#### Scenario: A trivial read does not need a service

- GIVEN a `GET /api/v1/tipos-socio` returns a small reference list
- WHEN the handler is called
- THEN calling `tiposSocioRepository.findAll()` directly is acceptable (a service wrapper would be empty ceremony)
- AND the rule of thumb is: a service is required when ≥2 repositories are involved OR business logic is present

### Requirement: Pattern Choice Rationale For Athlos

The Repository pattern is chosen over direct Drizzle queries in route handlers because: (1) Athlos handles **financial data** where consistency, auditability, and error translation are non-negotiable; (2) the 5-schema organization maps naturally to per-schema repositories; (3) transaction boundaries need an explicit owner, and route handlers are the wrong layer for that; (4) Phase 2 cutover will require swapping implementations for testing or migration — repositories give us a clean seam.

The Service layer sits above repositories (not below) because the question "where does business logic go?" needs a single home. A service-free architecture pushes logic into handlers (un-testable) or repositories (mixed concerns). For Athlos's small user base, the cost of an extra layer is low; the cost of business logic scattered across handlers is high.

#### Scenario: A Phase 2 cutover needs a new repository implementation

- GIVEN Phase 2 needs to switch from read-coexistence to write-authority
- WHEN the cutover happens
- THEN repositories SHOULD be replaceable behind an interface (DI-friendly)
- AND API handlers MUST NOT need changes if a repository implementation is swapped

---

## 2. Schema Organization

### Requirement: One Drizzle Schema File Per PostgreSQL Schema

The codebase MUST organize Drizzle table definitions into 5 schema files mirroring the PostgreSQL schemas:

```
src/db/schema/
├── public.ts         # public.* tables
├── socios.ts         # socios.* tables
├── contabilidad.ts   # contabilidad.* tables
├── tesoreria.ts      # tesoreria.* tables
└── deportes.ts       # deportes.* tables
```

A barrel file `src/db/schema/index.ts` MUST re-export all tables. The `drizzle.config.ts` MUST point to the schema directory and include all 5 schemas in its scope.

#### Scenario: A developer adds a new table to contabilidad

- GIVEN a new table `contabilidad.ejercicio` is needed
- WHEN the developer creates it
- THEN the table definition MUST be added to `src/db/schema/contabilidad.ts`
- AND it MUST be re-exported from `src/db/schema/index.ts`
- AND it MUST be added to the `pgSchema('contabilidad')` declaration at the top of the file

### Requirement: Schema-Aware Queries

Every repository MUST scope all queries to its own PostgreSQL schema. Cross-schema joins MUST go through a dedicated coordinator (see `reportingRepository` pattern) and MUST be documented in the repository's docblock.

#### Scenario: sociosRepository never queries contabilidad tables

- GIVEN a developer is implementing `sociosRepository.findById`
- WHEN the implementation is reviewed
- THEN it MUST NOT import or reference any table from `src/db/schema/contabilidad.ts`
- AND it MUST NOT import or reference any table from `tesoreria`, `deportes`, or `public` (except for FK targets like `public.tipo_documento`, which is acceptable and MUST be documented)

#### Scenario: A report joins socio + cuenta corriente + asiento

- GIVEN a reporting endpoint joins three schemas
- WHEN the report query is built
- THEN it MUST live in `reportingRepository` (or a coordinator under `src/db/repositories/reporting/`)
- AND the docblock MUST list the three schemas involved and the join keys

### Requirement: Cross-Schema Joins Are Rare And Documented

Cross-schema joins (queries that touch ≥2 schemas in a single SQL statement) MUST be justified in the repository's docblock with the join key and the reason it cannot be split into per-schema queries. Reports and views are the only legitimate use case; routine CRUD MUST NOT cross schemas.

#### Scenario: A developer proposes a cross-schema join for a CRUD endpoint

- GIVEN a developer wants to add a join from `socios.socio` to `contabilidad.asiento` inside `GET /api/v1/socios/:id`
- WHEN the PR is reviewed
- THEN the review MUST reject the join
- AND suggest fetching the socio first, then calling `asientoRepository.findBySocioId(socioId)` and merging in the service layer

---

## 3. Query Construction

### Requirement: Drizzle Query Builder For All Queries

All queries MUST be constructed using the Drizzle query builder (or the relational query API for joins within a single schema). Raw SQL via `sql` template tags MUST NOT be used except in the documented exception case below.

#### Scenario: A simple SELECT

- GIVEN a repository needs to find all active socios
- WHEN the query is written
- THEN it MUST use `db.select().from(socio).where(eq(socio.activo, true))`
- AND it MUST NOT use `db.execute(sql\`SELECT * FROM socios.socio WHERE activo = true\`)`

#### Scenario: An INSERT with multiple values

- GIVEN a repository needs to insert a new cuenta_corriente record
- WHEN the query is written
- THEN it MUST use `db.insert(cuentaCorriente).values({...}).returning()`
- AND it MUST NOT concatenate values into a raw SQL string

### Requirement: Raw SQL Is The Documented Exception, Not The Default

Raw SQL MAY be used only when (a) the query cannot be expressed in Drizzle's query builder, AND (b) the raw query is wrapped in a Drizzle `sql` tag (parameterized, no string concatenation), AND (c) the call site has a comment citing the reason and an approval reference. Reports with CTEs, recursive queries, window functions, or complex aggregations are the expected use case.

#### Scenario: A report uses a CTE that Drizzle cannot express

- GIVEN a report needs a recursive CTE to compute a saldo acumulado
- WHEN the repository is written
- THEN it MAY use `db.execute(sql\`WITH RECURSIVE ... \`)` with all values parameterized
- AND the call site MUST have a comment: `// raw-sql-approval: <issue-or-doc-link> — recursive CTE not expressible in Drizzle`
- AND the approval MUST be recorded in the repository's docblock

#### Scenario: A raw SQL string is built with concatenation

- GIVEN a developer writes `db.execute(sql\`SELECT * FROM socio WHERE id = ${userInput}\`)`
- WHEN the PR is reviewed
- THEN the review MUST reject it as a SQL injection risk AND a violation of this spec
- AND the developer MUST rewrite it using Drizzle's query builder or a parameterized `sql` tag

### Requirement: No SELECT *

All queries MUST explicitly select the columns they need. `select()` (with no args) is acceptable only when a Drizzle relation API is fetching an entire row type. Production code MUST NOT issue `SELECT *`-style queries through raw SQL.

#### Scenario: A query needs only socio name and number

- GIVEN a dropdown list of socios needs only `id`, `numero`, `apellido`, `nombre`
- WHEN the query is written
- THEN it MUST use `db.select({ id: socio.id, numero: socio.numero, apellido: socio.apellido, nombre: socio.nombre }).from(socio)`
- AND it MUST NOT use `db.select().from(socio)` for a list view

---

## 4. Transaction Handling

### Requirement: Drizzle Transactions For Multi-Statement Writes

Multi-statement writes (any operation that inserts/updates/deletes in ≥2 tables, OR any operation that depends on read-then-write consistency) MUST execute inside a Drizzle transaction using `db.transaction(async (tx) => { ... })`. Single-statement writes MAY run outside a transaction (Drizzle's implicit single-statement behavior is acceptable).

#### Scenario: Creating a payment inserts cuenta_corriente and asiento

- GIVEN `pagosService.createPayment` inserts into `socios.cuenta_corriente` AND `contabilidad.asiento`
- WHEN the service is called
- THEN it MUST open a transaction with `db.transaction(async (tx) => { ... })`
- AND both inserts MUST use the `tx` handle, NOT the outer `db` handle
- AND the transaction MUST commit only after both inserts succeed
- AND if either insert throws, the transaction MUST roll back

#### Scenario: Updating a single socio

- GIVEN `sociosRepository.update(id, fields)` is called
- WHEN the method runs
- THEN a single `db.update(socio).set(fields).where(eq(socio.id, id))` is acceptable
- AND a transaction wrapper is NOT required (single statement, no read-then-write dependency)

### Requirement: Read-Then-Write Operations Require Serializable Or Explicit Locking

Operations that read a value and then write based on it (e.g., "compute next sequence number, then insert with that number") MUST either (a) run inside a transaction with `isolationLevel: 'serializable'`, OR (b) use a PostgreSQL row lock (`SELECT ... FOR UPDATE`) inside the transaction. The classic race condition "two callers read saldo=100, both write saldo=200, final saldo=200 instead of 300" MUST be prevented.

#### Scenario: Incrementing the sequence number

- GIVEN two requests simultaneously call `public.obtener_siguiente_numero('recibo')`
- WHEN both requests run in parallel
- THEN the sequence MUST return unique numbers (e.g., 1001 and 1002, not 1001 twice)
- AND the implementation MUST use `SELECT ... FOR UPDATE` on the `public.secuencia` row OR a SERIAL/sequence object

#### Scenario: Computing socio saldo before writing

- GIVEN a process reads `cuenta_corriente` to compute saldo, then inserts a new movement
- WHEN two processes run in parallel for the same socio
- THEN the second process MUST see the first process's uncommitted write (or wait for it)
- AND isolation MUST be `serializable` OR explicit row locks MUST be used
- AND the final saldo MUST be correct (no lost updates)

### Requirement: Savepoints For Nested Transactions

Drizzle supports nested transactions via savepoints (`tx.transaction(...)` inside a `db.transaction(...)`). Nested transactions MUST be used when a service calls another service that also opens a transaction, and rollback of the inner block MUST NOT affect the outer block unless the outer also rolls back.

#### Scenario: A service calls another service inside a transaction

- GIVEN `pagosService.createPayment` (opens a transaction) calls `auditService.recordEvent` (also opens a transaction)
- WHEN both are called
- THEN the inner audit transaction MUST be a savepoint of the outer payment transaction
- AND if the outer payment rolls back, the audit MUST also be undone
- AND if only the audit fails, the outer transaction MAY choose to roll back (policy decision; default: roll back)

---

## 5. Connection Pooling

### Requirement: Single Shared PostgreSQL Connection Pool

The application MUST use a single `pg.Pool` (or `postgres`/drizzle's underlying pool) created at process startup. Repositories MUST receive a `db` instance (already configured with the pool) via dependency injection. Repositories MUST NOT create their own pools or connections.

#### Scenario: Application startup

- GIVEN the Node.js process starts
- WHEN the application initializes
- THEN exactly ONE pool MUST be created (e.g., `export const pool = new Pool({ connectionString: DATABASE_URL, max: 20 })`)
- AND the Drizzle client MUST be created with this pool: `export const db = drizzle(pool, { schema })`
- AND the `db` instance MUST be passed to repository factories (or imported as a singleton if DI is not in use)

#### Scenario: A request handler needs a transaction

- GIVEN a route handler is called
- WHEN it invokes a service that needs a transaction
- THEN the service MUST call `db.transaction(...)` on the shared instance
- AND it MUST NOT instantiate a new `Pool` or `Client`

### Requirement: Pool Size And Timeouts

The pool MUST be configured with: `max` connections sized for expected concurrency (start: 20), `idleTimeoutMillis` of 30 seconds, `connectionTimeoutMillis` of 5 seconds, and `allowExitOnIdle: false` (keep the process alive while idle in dev). These values MUST be documented in `src/db/pool.ts` and overridable via environment variables (`DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`).

#### Scenario: Default pool configuration

- GIVEN the application starts with no `DB_POOL_*` env vars set
- WHEN the pool is created
- THEN `max` MUST default to 20
- AND `idleTimeoutMillis` MUST default to 30000
- AND `connectionTimeoutMillis` MUST default to 5000

#### Scenario: Pool exhaustion

- GIVEN all 20 connections are in use and a 21st request arrives
- WHEN the 21st request tries to acquire a connection
- THEN it MUST wait up to `connectionTimeoutMillis` (5s) for a free connection
- AND if no connection becomes available, it MUST throw a connection-acquisition error
- AND the error MUST propagate to the API layer as a 500 Internal Server Error (see §6)

### Requirement: Connection Lifecycle

Connections MUST be opened lazily on first use and returned to the pool when released. On process shutdown (SIGTERM/SIGINT), the pool MUST call `pool.end()` to gracefully close all connections, with a 10-second timeout. The shutdown handler MUST be registered at process startup.

#### Scenario: Graceful shutdown

- GIVEN the process receives SIGTERM
- WHEN the shutdown handler runs
- THEN it MUST call `pool.end()`
- AND in-flight requests MUST be allowed to complete (up to 10s)
- AND after 10s, the process MUST exit even if some requests are still pending

#### Scenario: Long-idle pool reuses connections

- GIVEN the pool has been idle for > `idleTimeoutMillis`
- WHEN a new request arrives
- THEN the pool MUST open a new connection (idle ones have been released)
- AND the request MUST NOT fail due to stale connections (PostgreSQL does not aggressively close idle TCP, so this is rare; `pg` handles reconnection transparently)

---

## 6. Error Handling At Data Layer

### Requirement: Drizzle Errors Propagate Up, Translated At The API Edge

The data access layer MUST NOT catch and translate Drizzle/PostgreSQL errors. Errors MUST propagate up to the API layer, where a single error-translation middleware converts them to HTTP responses. The DAL MAY throw domain-specific error types (e.g., `NotFoundError`, `ConcurrencyError`) for cases the API layer needs to distinguish.

#### Scenario: A unique constraint violation occurs

- GIVEN a `POST /api/v1/socios` request with a duplicate `numero_socio`
- WHEN the repository's insert runs
- THEN PostgreSQL MUST throw error code `23505` (unique_violation)
- AND Drizzle MUST propagate it as a `DrizzleQueryError` (or similar)
- AND the error MUST bubble up to the API edge unhandled
- AND the API edge MUST translate it to HTTP 409 Conflict with `{"error":"DUPLICATE_RESOURCE","message":"numero_socio already exists"}`

#### Scenario: A foreign key violation occurs

- GIVEN a `POST /api/v1/cuenta-corriente` request with a non-existent `socio_id`
- WHEN the repository's insert runs
- THEN PostgreSQL MUST throw error code `23503` (foreign_key_violation)
- AND the API edge MUST translate it to HTTP 400 Bad Request with `{"error":"INVALID_REFERENCE","message":"socio_id does not exist"}`

#### Scenario: A connection error occurs

- GIVEN the database is unreachable when a query runs
- WHEN the query is attempted
- THEN the underlying `pg` driver MUST throw a connection error
- AND the API edge MUST translate it to HTTP 500 Internal Server Error with `{"error":"DATABASE_UNAVAILABLE"}`
- AND the request_id MUST be returned for log correlation

### Requirement: PostgreSQL Error Code Mapping

The API edge MUST use the following mapping (PostgreSQL SQLSTATE → HTTP status):

| SQLSTATE | Meaning | HTTP Status | API Error Code |
|----------|---------|-------------|----------------|
| `23505` | unique_violation | 409 Conflict | `DUPLICATE_RESOURCE` |
| `23503` | foreign_key_violation | 400 Bad Request | `INVALID_REFERENCE` |
| `23502` | not_null_violation | 400 Bad Request | `REQUIRED_FIELD_MISSING` |
| `23514` | check_violation | 400 Bad Request | `CONSTRAINT_VIOLATION` |
| `40001` / `40P01` | serialization_failure / deadlock | 409 Conflict | `CONCURRENCY_CONFLICT` |
| Connection errors (no SQLSTATE) | network/timeout | 500 Internal Server Error | `DATABASE_UNAVAILABLE` |
| Other | unexpected | 500 Internal Server Error | `INTERNAL_ERROR` |

#### Scenario: A serialization failure occurs

- GIVEN two transactions conflict under `serializable` isolation
- WHEN one transaction is rolled back by PostgreSQL with SQLSTATE `40001`
- THEN the API edge MUST return HTTP 409 with `{"error":"CONCURRENCY_CONFLICT"}`
- AND the client MAY retry the request

### Requirement: Repositories Throw Domain Errors For Expected Cases

For cases the API layer needs to handle differently from a 500, repositories MUST throw a domain error (e.g., `SocioNotFoundError`). The API edge maps these to 404 Not Found. This is the ONLY case where the DAL may throw a non-Drizzle error.

#### Scenario: A repository looks up a missing socio

- GIVEN `sociosRepository.findById(99999)` is called
- WHEN no row matches
- THEN the repository MUST throw `SocioNotFoundError` (a domain error)
- AND the API edge MUST translate it to HTTP 404 with `{"error":"SOCIO_NOT_FOUND"}`

---

## 7. Type Safety

### Requirement: Drizzle Inferred Types For Query Results

All functions returning query results MUST use Drizzle's inferred types (`InferSelectModel`, `InferInsertModel`, or the array element type from a `db.select()`). Hand-rolled TypeScript interfaces mirroring Drizzle's shape MUST NOT be used. The Drizzle-inferred type IS the contract.

#### Scenario: A repository returns a list of socios

- GIVEN `sociosRepository.findAll()` is implemented
- WHEN the return type is declared
- THEN it MUST be `Promise<Socio[]>` where `Socio = typeof socio.$inferSelect`
- AND it MUST NOT be a hand-written `interface Socio { id: number; numero: string; ... }`

#### Scenario: A repository accepts insert input

- GIVEN `sociosRepository.create(input)` is implemented
- WHEN the input type is declared
- THEN it MUST be `NewSocio = typeof socio.$inferInsert`
- AND the function MUST return `Promise<Socio>` (the full row, post-defaults and post-RETURNING)

### Requirement: Input Validation With Zod At The API Edge

All request payloads MUST be validated with Zod schemas at the API edge (per the Validation spec). Repositories MUST NOT do their own input validation (Zod is enough; re-validating in the DAL is redundant). However, repositories MUST declare their expected input types using Drizzle's `InferInsertModel` so the type system catches mismatches between what the service passes and what the table accepts.

#### Scenario: A service passes invalid input to a repository

- GIVEN `pagosService` calls `cuentaCorrienteRepository.create({ socio_id: "not-a-number", importe: -100 })`
- WHEN TypeScript compiles
- THEN the compiler MUST reject the call (types from `InferInsertModel` enforce `socio_id: number, importe: number`)
- AND the developer MUST fix the service to pass a Zod-validated payload

### Requirement: TypeScript Strict Mode

The codebase MUST compile with `"strict": true` in `tsconfig.json`. The data access layer MUST NOT use `any` to bypass type errors. Type assertions (`as`) are allowed only when narrowing a Drizzle inferred type to a more specific shape AND the assertion is documented.

#### Scenario: A repository uses `as any` to silence an error

- GIVEN a developer writes `const socio = (await db.select().from(socio).where(eq(socio.id, id)))[0] as any`
- WHEN the PR is reviewed
- THEN the review MUST reject the `as any`
- AND the developer MUST use proper narrowing (e.g., `if (!socio) throw new SocioNotFoundError()`)

### Requirement: Schema Types Re-Exported For Application Use

Drizzle's inferred types MUST be re-exported from a single module (`src/db/schema/index.ts` or `src/db/types.ts`) so that the API/service layer imports them by name (`import type { Socio, NewSocio } from '@/db/schema'`). Types MUST NOT be re-derived in service or API code.

#### Scenario: A service needs the Socio type

- GIVEN `pagosService.createPayment` needs the Socio type
- WHEN the service imports it
- THEN it MUST import from `@/db/schema` (or the equivalent types barrel)
- AND it MUST NOT declare a local `interface Socio { ... }`

---

## Success Criteria

- [ ] All 5 PostgreSQL schemas (`public`, `socios`, `contabilidad`, `tesoreria`, `deportes`) have a corresponding Drizzle schema file in `src/db/schema/`
- [ ] Repositories exist per domain and are the ONLY layer that calls Drizzle directly
- [ ] Services sit above repositories and own multi-step orchestration + transactions
- [ ] All queries use the Drizzle query builder; raw SQL is justified and documented at the call site
- [ ] Multi-statement writes run inside `db.transaction(...)`; nested transactions use savepoints
- [ ] Read-then-write operations use `serializable` isolation or `SELECT ... FOR UPDATE`
- [ ] A single shared `pg.Pool` is configured with documented max/idle/connection timeouts
- [ ] Graceful shutdown calls `pool.end()` with a 10s timeout on SIGTERM/SIGINT
- [ ] PostgreSQL error codes (`23505`, `23503`, `23502`, `23514`, `40001`) map to defined HTTP statuses at the API edge
- [ ] Repositories throw domain errors (`SocioNotFoundError`, etc.) for expected 404 cases
- [ ] All function signatures use Drizzle inferred types (`$inferSelect`, `$inferInsert`)
- [ ] Input validation happens at the API edge with Zod; repositories trust their declared types
- [ ] TypeScript strict mode is enabled; no `any` in the data access layer
- [ ] Drizzle inferred types are re-exported from a single barrel for application use
