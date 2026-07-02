# Validation (Zod) Specification

## Purpose

Define the request validation contract for the Athlos API. All incoming HTTP requests MUST be validated with Zod schemas at the API edge, before any route handler executes. Validation errors MUST map to the standard `ApiError` response defined in `error-handling/spec.md` with `error: "VALIDATION_ERROR"`, `status: 400`, and field-level details. This spec covers schema organization, reusable primitives, common patterns, body/query/path validation, response validation strategy, and the error response contract.

---

## 1. Validation Strategy

### Requirement: Zod Is The Single Source Of Validation Truth

The system MUST use [Zod](https://zod.dev) as the validation library for every HTTP request that carries a body, query string, or path parameter. The system MUST NOT validate inputs ad-hoc with `if` checks, manual regex, or any other library.

The TypeScript types consumed by route handlers MUST be inferred from Zod schemas via `z.infer<typeof Schema>`. Hand-written TypeScript interfaces for request payloads are forbidden — they drift from the runtime contract.

#### Scenario: A handler consumes the inferred type

- GIVEN a Zod schema `SocioCreateRequestSchema` is exported from `packages/validation/src/schemas/socio.ts`
- WHEN a route handler declares `const body: SocioCreateRequest = req.body`
- THEN `SocioCreateRequest` MUST be derived as `z.infer<typeof SocioCreateRequestSchema>` (no hand-written duplicate interface)

### Requirement: Validation At The API Edge

Validation MUST happen in a Fastify `preHandler` hook or route-level schema — before the route handler executes. The system MUST NOT defer validation to services, repositories, or DALs.

The `data-access-layer/spec.md` rule is authoritative: repositories MUST NOT re-validate inputs. The TypeScript type system (via Drizzle's `InferInsertModel`) is the only downstream check.

#### Scenario: A service receives invalid input

- GIVEN a route handler is called with an unvalidated `req.body` (validation preHandler bypassed by mistake)
- WHEN the service attempts to insert into the database
- THEN the type system MUST reject the call at compile time
- AND the runtime MUST surface a database constraint error (acceptable: never reachable when validation is wired correctly)

### Requirement: All Three Input Surfaces Are Validated

Every endpoint MUST validate all applicable surfaces:

| Surface | When Required | Schema Suffix |
|---------|--------------|---------------|
| Request body | `POST`, `PUT`, `PATCH` | `RequestSchema` |
| Query parameters | `GET` endpoints with filters/pagination | `QuerySchema` |
| Path parameters | Endpoints with `{id}` or similar | `ParamsSchema` |

#### Scenario: A GET endpoint with pagination and an id path param

- GIVEN endpoint `GET /api/v1/socios/{id}/movimientos?cursor=&limit=`
- WHEN the request arrives
- THEN path params MUST be validated by `SocioIdParamsSchema` (UUID format)
- AND query params MUST be validated by `MovimientosQuerySchema` (cursor string, limit 1-200)
- AND if either fails, the handler MUST NOT execute

---

## 2. Schema Organization

### Requirement: Shared Validation Package

All Zod schemas MUST live in a dedicated package: `packages/validation/`. The package MUST export:

```
packages/validation/
├── src/
│   ├── primitives.ts        # Reusable primitives (uuid, date, email, etc.)
│   ├── pagination.ts        # Cursor + limit query schemas
│   ├── schemas/
│   │   ├── auth.ts          # Login, refresh, logout
│   │   ├── socio.ts         # SocioCreate/Update requests
│   │   ├── operator.ts      # Operator create/update
│   │   ├── approval.ts      # Approval create/decide
│   │   ├── import.ts        # Import trigger
│   │   ├── audit.ts         # Audit query
│   │   ├── account.ts       # Cuenta corriente query
│   │   └── padron.ts        # Padrón query
│   └── index.ts             # Public exports
└── package.json             # Depends on `zod`, `packages/errors`
```

Each per-resource file MUST export its request/query/params schemas AND their inferred TypeScript types.

### Requirement: Per-Resource Files

One file per domain resource, named `{resource}.ts`. Cross-resource reuse is handled by importing from `primitives.ts` or other resource files (no `common.ts` umbrella).

#### Scenario: A new resource needs validation

- GIVEN a future `cuota` resource is added
- WHEN the developer creates `packages/validation/src/schemas/cuota.ts`
- THEN the file MUST export `CuotaCreateRequestSchema`, `CuotaUpdateRequestSchema`, `CuotaQuerySchema` (if list endpoint), and their inferred types

### Requirement: Reusable Primitives

The `primitives.ts` module MUST export reusable Zod schemas that any resource file can import:

| Primitive | Zod Expression | Purpose |
|-----------|---------------|---------|
| `uuidSchema` | `z.string().uuid()` | All `{id}` path params, foreign keys |
| `isoDateSchema` | `z.string().date()` or `z.string().datetime()` | All date fields |
| `isoDateTimeSchema` | `z.string().datetime()` | Timestamps (with time) |
| `emailSchema` | `z.string().email()` | Email fields |
| `positiveIntSchema` | `z.number().int().positive()` | IDs, counts, money when integer |
| `moneySchema` | `z.number().nonnegative().multipleOf(0.01)` | Currency amounts (2 decimals) |
| `nonEmptyStringSchema` | `z.string().min(1)` | Non-empty text |
| `dniSchema` | `z.string().regex(/^\d{7,8}$/)` | Argentine DNI (7-8 digits) |
| `cuitSchema` | `z.string().regex(/^\d{11}$/)` | Argentine CUIT (11 digits) |
| `paginationLimitSchema` | `z.coerce.number().int().min(1).max(200).default(50)` | List page size |
| `cursorSchema` | `z.string().min(1).optional()` | Opaque pagination cursor |
| `roleSchema` | `z.enum(['ADMIN','TESORERO','OPERADOR','CONSULTA'])` | Operator role |
| `socioEstadoSchema` | `z.enum(['activo','inactivo','suspendido'])` | Socio status |
| `movimientoTipoSchema` | `z.enum(['cargo','pago'])` | Cuenta corriente movement type |

#### Scenario: A resource uses primitives

- GIVEN `socio.ts` exports `SocioCreateRequestSchema`
- WHEN the schema declares `numero_socio: positiveIntSchema`
- THEN the field MUST reject negative numbers, zero, and non-integers at runtime

---

## 3. Common Validation Patterns

### Requirement: Required Fields

Fields with no `.optional()` or `.default()` are required. The system MUST use Zod's default behavior — missing required fields produce `code: "invalid_type"` with `message: "Required"`.

#### Scenario: Missing required field

- GIVEN a POST /api/v1/socios with `{"nombre":"Juan"}` (no `apellido`)
- WHEN Zod parses the body
- THEN validation MUST fail with `code: "invalid_type"`, `field: "body.apellido"`, `message: "Required"`

### Requirement: Optional Fields With Defaults

Optional fields MUST be expressed with `.optional()` (no default) or `.default(value)` (with default). The choice is part of the schema contract — handlers MUST NOT need to handle `undefined` for defaulted fields.

| Pattern | Zod | Handler Sees |
|---------|-----|--------------|
| Truly optional (may be omitted or null) | `z.string().optional()` | `string \| undefined` |
| Optional with default | `z.string().default('')` | `string` (always defined) |
| Nullable | `z.string().nullable().optional()` | `string \| null \| undefined` |

#### Scenario: Optional field with default

- GIVEN `direccion: z.string().default('')` in `SocioCreateRequestSchema`
- WHEN the request body omits `direccion`
- THEN `parsed.direccion` MUST be `""` (not `undefined`)

### Requirement: String Length Limits

Every free-form string field MUST declare `.min(1)` (non-empty) and SHOULD declare `.max(N)` (upper bound). Field length limits are a security control (prevents abuse, DoS).

Recommended upper bounds:

| Field Type | Max Length | Rationale |
|------------|-----------|-----------|
| `nombre`, `apellido` | 100 | Human names |
| `direccion` | 200 | Street addresses |
| `email` | 254 | RFC 5321 limit |
| `descripcion` | 500 | Free text |
| `categoria` | 50 | Lookup values |
| `motivo` / `reason` | 500 | Approval reasons |

#### Scenario: Oversized name field

- GIVEN a POST /api/v1/socios with `apellido` of 5000 characters
- WHEN Zod parses
- THEN validation MUST fail with `code: "too_big"`, `field: "body.apellido"`, `message: "String must contain at most 100 character(s)"`

### Requirement: Number Ranges

Numeric fields MUST declare both lower and upper bounds. Currency fields MUST be non-negative and SHOULD enforce `.multipleOf(0.01)` (two-decimal precision).

| Field | Schema |
|-------|--------|
| `numero_socio` | `positiveIntSchema` |
| `monto`, `importe`, `saldo` | `moneySchema` |
| `limit` (pagination) | `paginationLimitSchema` (1-200, default 50) |
| `cantidad_socios` | `z.number().int().nonnegative()` |

#### Scenario: Negative currency amount

- GIVEN a POST /api/v1/pagos with `importe: -100`
- WHEN Zod parses
- THEN validation MUST fail with `code: "too_small"`, `field: "body.importe"`, `message: "Number must be greater than or equal to 0"`

### Requirement: Enum Validation

Finite, well-known value sets MUST be enforced with `z.enum([...])`. The system MUST NOT accept arbitrary strings for fields with a known set of valid values.

#### Scenario: Invalid role on operator create

- GIVEN a POST /api/v1/admin/operators with `{"role":"SUPERADMIN"}`
- WHEN Zod parses
- THEN validation MUST fail with `code: "invalid_enum_value"`, `field: "body.role"`, `message: "Invalid enum value..."`

### Requirement: Date Validation

All date and timestamp fields MUST be ISO 8601 strings, validated with `z.string().date()` (date-only, e.g., `"2024-03-15"`) or `z.string().datetime()` (timestamp, e.g., `"2024-03-15T14:30:00Z"`). The system MUST NOT accept locale-dependent formats (`"15/03/2024"`, `"March 15, 2024"`).

| Field Context | Schema |
|---------------|--------|
| `fecha_alta`, `fecha_nacimiento` (date only) | `isoDateSchema` |
| `as_of`, `created_at`, `expires_at` (timestamp) | `isoDateTimeSchema` |
| `from`, `to` (audit filter range) | `isoDateSchema` |

#### Scenario: Invalid date format on filter

- GIVEN GET /api/v1/audit?from=15/03/2024
- WHEN Zod parses the query
- THEN validation MUST fail with `code: "invalid_string"`, `field: "query.from"`, `message: "Invalid date"`

### Requirement: Custom Refinements

Fields with format rules not expressible by primitives MUST use `.refine()` or `.superRefine()`. The system MUST keep refinements inside the schema definition (declarative) — never in the handler.

#### Scenario: DNI refinement

- GIVEN `dniSchema = z.string().regex(/^\d{7,8}$/, "DNI must be 7-8 digits")`
- WHEN a request sends `dni: "12A45"`
- THEN validation MUST fail with the custom message "DNI must be 7-8 digits"

#### Scenario: Cross-field refinement (date range)

- GIVEN an audit query schema with `from` and `to`
- WHEN a request sends `from=2024-12-01&to=2024-01-01` (reversed range)
- THEN validation MUST fail with a custom refinement on the parent object
- AND the field path MUST point to a meaningful path (e.g., `query.to`)

---

## 4. Request Body Validation

### Requirement: Write Endpoints Declare Body Schemas

Every `POST`, `PUT`, and `PATCH` endpoint MUST export and apply a body schema. The schema name MUST end in `RequestSchema` (e.g., `SocioCreateRequestSchema`).

| Endpoint | Schema | Resource File |
|----------|--------|---------------|
| POST /api/v1/auth/login | `LoginRequestSchema` | `auth.ts` |
| POST /api/v1/auth/refresh | `RefreshRequestSchema` | `auth.ts` |
| POST /api/v1/auth/logout | `LogoutRequestSchema` | `auth.ts` |
| POST /api/v1/socios | `SocioCreateRequestSchema` | `socio.ts` |
| PUT /api/v1/socios/{id} | `SocioUpdateRequestSchema` | `socio.ts` |
| POST /api/v1/admin/operators | `CreateOperatorRequestSchema` | `operator.ts` |
| PUT /api/v1/admin/operators/{id} | `UpdateOperatorRequestSchema` | `operator.ts` |
| POST /api/v1/internal/approval-links | `CreateApprovalLinkRequestSchema` | `approval.ts` |
| POST /api/v1/approval/{token} | `ApprovalDecisionRequestSchema` | `approval.ts` |
| POST /api/v1/import/trigger | `ImportTriggerRequestSchema` | `import.ts` |

#### Scenario: Create socio with valid body

- GIVEN POST /api/v1/socios with valid `SocioCreateRequest` body
- WHEN Zod parses
- THEN `parsed` MUST be typed as `SocioCreateRequest`
- AND the handler MUST receive the typed object
- AND the route MUST proceed to the service layer

#### Scenario: Create socio with invalid body

- GIVEN POST /api/v1/socios with `email: "not-an-email"`
- WHEN Zod parses
- THEN the system MUST throw `BusinessError("VALIDATION_ERROR", "Request body is invalid", mapZodErrors(error))`
- AND the response MUST be 400 with `details: [{ field: "body.email", message: "Invalid email", code: "invalid_string" }]`

### Requirement: Partial Update Schemas

PUT and PATCH bodies MUST allow partial fields. PUT bodies SHOULD be partial (not full replacement) unless explicitly required. Fields that are not being updated MUST be `optional()`.

#### Scenario: Partial update

- GIVEN PUT /api/v1/socios/{id} with `{"telefono":"+5491155555555"}` (only one field)
- WHEN Zod parses
- THEN all other fields MUST be `.optional()` and MUST NOT fail validation
- AND the service MUST update only the `telefono` field

### Requirement: Body Schema Rejects Extra Fields

By default, Zod strips unknown keys. The system SHOULD use `.strict()` for body schemas where extra fields are likely a client bug (e.g., socio create). The system MAY use `.strip()` (default) for PUT/PATCH update schemas where partial fields are expected.

| Mode | Behavior | Use For |
|------|----------|---------|
| `.strict()` | Reject unknown keys with error | Create endpoints, sensitive updates |
| `.strip()` (default) | Silently drop unknown keys | Update endpoints, permissive APIs |
| `.passthrough()` | Keep unknown keys | Never (allows data leakage) |

#### Scenario: Create with extra field

- GIVEN `SocioCreateRequestSchema` uses `.strict()`
- WHEN a POST body includes `{"nombre":"Juan", "isAdmin":true}`
- THEN validation MUST fail with `code: "unrecognized_keys"`, `field: "body"`, `message: "Unrecognized key(s) in object: 'isAdmin'"`

---

## 5. Query Parameter Validation

### Requirement: Pagination Query Schema

Every list endpoint MUST apply `PaginationQuerySchema` (composed from `cursor` + `limit`):

```typescript
export const PaginationQuerySchema = z.object({
  cursor: cursorSchema,
  limit: paginationLimitSchema,
});
```

List endpoints MAY extend it with resource-specific filters via `PaginationQuerySchema.merge(FilterSchema)`.

#### Scenario: List with default pagination

- GIVEN GET /api/v1/socios (no query params)
- WHEN Zod parses
- THEN `parsed.limit` MUST be `50` (default)
- AND `parsed.cursor` MUST be `undefined`
- AND the handler MUST proceed

#### Scenario: List with invalid limit

- GIVEN GET /api/v1/socios?limit=10000
- WHEN Zod parses
- THEN validation MUST fail with `code: "too_big"`, `field: "query.limit"`, `message: "Number must be less than or equal to 200"`

### Requirement: Filter Query Schemas

Filtered list endpoints MUST define a filter schema. Filters MUST be optional (default to "no filter") unless the filter is required by the endpoint contract.

| Endpoint | Filter Fields |
|----------|---------------|
| GET /api/v1/socios | `estado` (enum), `categoria` (string), `search` (string) |
| GET /api/v1/cuenta-corriente/{id} | `from` (date), `to` (date), `tipo` (enum) |
| GET /api/v1/audit | `entity_type`, `entity_id`, `operator_id`, `from`, `to`, `action` |
| GET /api/v1/lineage | `domain`, `legacy_key`, `imported_from`, `imported_to` |
| GET /api/v1/import/status | `job_id` (uuid) |

#### Scenario: Audit filter with invalid date

- GIVEN GET /api/v1/audit?from=2024-13-01
- WHEN Zod parses
- THEN validation MUST fail with `code: "invalid_string"`, `field: "query.from"`, `message: "Invalid date"`

### Requirement: Sort Parameters

Endpoints that support sorting MUST accept a `sort` query parameter constrained to a known enum of sortable fields per resource. The system MUST NOT accept arbitrary field names (prevents SQL injection via sort key).

#### Scenario: Invalid sort field

- GIVEN `SortFieldSchema = z.enum(['fecha','monto','socio_id'])` for cuenta corriente
- WHEN a request sends `?sort=password_hash`
- THEN validation MUST fail with `code: "invalid_enum_value"`, `field: "query.sort"`

### Requirement: Search Parameters

Free-text search parameters MUST enforce a minimum length (typically 2-3 chars) to avoid full-table scans on single-character queries. They SHOULD also enforce a maximum length.

#### Scenario: Short search term

- GIVEN `search: z.string().min(3).max(100).optional()` for socio search
- WHEN a request sends `?search=a`
- THEN validation MUST fail with `code: "too_small"`, `field: "query.search"`, `message: "String must contain at least 3 character(s)"`

---

## 6. Path Parameter Validation

### Requirement: UUID Path Params

All `{id}` path parameters MUST be validated as UUIDs via `uuidSchema`. The system MUST NOT accept arbitrary strings, integers, or legacy keys in path params (legacy keys are query params).

#### Scenario: Invalid UUID in path

- GIVEN GET /api/v1/socios/not-a-uuid
- WHEN Zod parses path params
- THEN validation MUST fail with `code: "invalid_string"`, `field: "params.id"`, `message: "Invalid uuid"`

### Requirement: Custom Format Path Params

Non-UUID path params (e.g., approval tokens, padron slugs) MUST have a dedicated schema:

| Param | Schema | Resource |
|-------|--------|----------|
| `{token}` (approval) | `z.string().min(32).max(128)` | `approval.ts` |
| `{padronId}` | `z.string().regex(/^padron-[a-z0-9-]+$/)` | `padron.ts` |
| `{legacyKey}` (only on read-only lineage endpoints) | `z.string().min(1).max(50)` | `import.ts` |

#### Scenario: Approval token format check

- GIVEN POST /api/v1/approval/abc123 (token too short)
- WHEN Zod parses path params
- THEN validation MUST fail with `code: "too_small"`, `field: "params.token"`, `message: "String must contain at least 32 character(s)"`

---

## 7. Response Validation

### Requirement: Response Validation Is Optional In V1

For v1, response validation SHOULD be used primarily for documentation and type safety — not as a runtime safety net. The system SHOULD NOT enable response validation by default. Individual routes MAY opt in via a `responseSchema` if:

- The endpoint is part of an external contract (integrations depend on it)
- The endpoint has historically had schema drift (defense in depth)
- The endpoint is critical for audit/compliance

#### Scenario: Documentation-only response schema

- GIVEN a route declares `responseSchema: SocioResponseSchema` in its Fastify route options
- WHEN the handler returns a payload
- THEN Zod MAY parse the response for type safety in dev/test
- AND the response MUST be sent as-is to the client (no transformation)

### Requirement: Response Schemas Live In The Same File As Requests

For consistency and discoverability, response schemas MUST be defined in the same resource file as the request schemas (e.g., `socio.ts` exports both `SocioCreateRequestSchema` and `SocioResponseSchema`).

### Requirement: Response Validation Tradeoffs Are Documented

Pros (when used):
- Type safety: handler return type matches schema
- Documentation: schema is the contract
- Drift detection: catches unintended schema changes during refactors

Cons (when used):
- Performance overhead: double validation (Zod parse on input + output per request)
- Maintenance burden: schema updates must be reflected on both sides
- False sense of security: doesn't catch data corruption, only schema mismatch

For v1, the system prioritizes input validation. Response validation is opt-in per route.

#### Scenario: Developer opts in for an external integration endpoint

- GIVEN POST /api/v1/internal/approval-links is consumed by a third-party integration
- WHEN the developer adds `responseSchema: CreateApprovalLinkResponseSchema` to the route
- THEN any drift between the handler return value and the schema MUST be caught at runtime in dev mode
- AND the production deployment MAY disable response validation via a feature flag (per-route config)

---

## 8. Error Response On Validation Failure

### Requirement: Validation Failure Returns 400 With Structured Details

When a Zod schema fails to parse, the system MUST:

1. Return HTTP status `400 Bad Request`
2. Set the response body to:
   ```json
   {
     "error": "VALIDATION_ERROR",
     "message": "Request body is invalid",
     "details": [
       { "field": "body.email", "message": "Invalid email", "code": "invalid_string" }
     ],
     "request_id": "req_<uuid>"
   }
   ```
3. The `message` MAY be resource-specific (e.g., "Request body is invalid", "Query parameters are invalid", "Path parameters are invalid")
4. The `details` array MUST contain one entry per Zod issue
5. The `field` path MUST be prefixed with the surface (`body.`, `query.`, `params.`) for client-side error mapping
6. The `code` MUST be the Zod issue code (e.g., `invalid_type`, `too_small`, `invalid_enum_value`, `unrecognized_keys`)

### Requirement: mapZodErrors Is The Single Mapper

The mapping from `ZodError` to `FieldError[]` MUST go through a single function — `mapZodErrors()` in `packages/errors/src/zod.ts` (already defined in `error-handling/spec.md` and `design.md`). Route handlers MUST NOT implement their own mapping.

```typescript
// Reference (from design.md, packages/errors/src/zod.ts)
export function mapZodErrors(zodError: ZodError): FieldError[] {
  return zodError.issues.map((issue: ZodIssue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}
```

The `packages/validation` package imports this mapper from `packages/errors` and uses it in route-level validation hooks.

#### Scenario: Multiple field errors aggregated

- GIVEN POST /api/v1/socios with `numero_socio: -1` and `email: "bad"` and `dni: "12"`
- WHEN Zod parses
- THEN `details` MUST contain three entries, one per field
- AND all three MUST appear in a single response (not first-error-wins)
- AND the response status MUST be 400 (not 422 — see note in api-design)

### Requirement: Field Path Prefixes Match Input Surface

The mapper MUST prefix the Zod `issue.path` with the surface name so clients can map errors to UI fields:

| Surface | Path Prefix | Example |
|---------|------------|---------|
| Body | `body.` | `body.email` |
| Query | `query.` | `query.limit` |
| Params | `params.` | `params.id` |

The prefix is added by the route's validation hook BEFORE calling `mapZodErrors()`.

#### Scenario: Field path includes surface prefix

- GIVEN a request with both `body.email` invalid and `query.limit` invalid
- WHEN validation runs
- THEN `details[0].field` MUST be `"body.email"`
- AND `details[1].field` MUST be `"query.limit"`
- AND the client MUST be able to differentiate body vs query errors

### Requirement: Sensitive Field Values Never Appear In Errors

Validation error messages MUST NOT echo the user-supplied value verbatim when the value is sensitive (e.g., passwords, tokens). For sensitive fields, the schema MUST use a custom error message that describes the constraint without the value.

#### Scenario: Password validation

- GIVEN `password: z.string().min(12, "Password must be at least 12 characters")` in `LoginRequestSchema`
- WHEN a request sends `{"password":"abc"}`
- THEN `details[0].message` MUST be `"Password must be at least 12 characters"`
- AND `details[0].field` MUST be `"body.password"`
- AND the message MUST NOT contain the literal value `"abc"`

### Requirement: Validation Errors Log At WARN Level

Validation failures MUST be logged at WARN level with the request context (per `error-handling/spec.md` section 4). The system MUST NOT log the full request body — only the field paths and error codes.

#### Scenario: Validation failure logged

- GIVEN a POST /api/v1/socios with invalid body
- WHEN validation fails
- THEN a WARN log entry MUST be emitted with `request_id`, `endpoint`, `method`, `error_code: "VALIDATION_ERROR"`, and `field_errors: [{ field, code }]`
- AND the log entry MUST NOT contain the request body values

---

## 9. Type Exports

### Requirement: Schemas Export Inferred Types

Every schema file MUST export inferred TypeScript types via `z.infer`:

```typescript
// packages/validation/src/schemas/socio.ts
export const SocioCreateRequestSchema = z.object({ ... });
export type SocioCreateRequest = z.infer<typeof SocioCreateRequestSchema>;
```

The system MUST NOT export a hand-written interface that duplicates the schema. TypeScript MUST derive the type from the schema (single source of truth).

#### Scenario: A handler imports the inferred type

- GIVEN `SocioCreateRequest` is exported from `packages/validation/src/schemas/socio.ts`
- WHEN a route handler imports it: `import type { SocioCreateRequest } from '@athlos/validation'`
- THEN the type MUST match the schema's parsed output exactly
- AND a schema change MUST automatically update the type

---

## Success Criteria

- [ ] All request bodies, query params, and path params are validated with Zod schemas at the API edge
- [ ] Schemas live in `packages/validation/src/schemas/{resource}.ts` (one file per resource)
- [ ] Reusable primitives (`uuidSchema`, `emailSchema`, `dniSchema`, etc.) are defined in `primitives.ts` and imported by resource files
- [ ] Required fields produce `code: "invalid_type"` with message "Required"
- [ ] Optional fields use `.optional()` or `.default()` consistently
- [ ] String fields have `.min(1)` and upper bounds defined
- [ ] Currency fields use `moneySchema` (nonnegative, two-decimal)
- [ ] Enums use `z.enum([...])` for finite value sets
- [ ] Dates use ISO 8601 (`z.string().date()` or `z.string().datetime()`)
- [ ] Custom format rules (DNI, CUIT) use `.regex()` or `.refine()`
- [ ] All write endpoints have a `RequestSchema` declared
- [ ] Partial update endpoints mark all fields as `.optional()`
- [ ] Pagination uses `cursor` + `limit` (default 50, max 200)
- [ ] Filter query params are optional with enum/format constraints
- [ ] All `{id}` path params are validated as UUIDs
- [ ] Response validation is opt-in per route (not default in v1)
- [ ] Validation failures return 400 with `error: "VALIDATION_ERROR"` and field-level `details`
- [ ] `mapZodErrors()` is the single mapping function (no inline mapping)
- [ ] Field paths include surface prefix (`body.`, `query.`, `params.`)
- [ ] Multiple field errors appear in a single response
- [ ] Sensitive field values are never echoed in error messages
- [ ] TypeScript types are inferred from schemas via `z.infer` (no hand-written duplicates)
