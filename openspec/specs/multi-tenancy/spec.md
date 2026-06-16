# Multi-Tenancy Specification

## Purpose

Defines how Athlos isolates data, operators, and configuration across tenants. For v1, Athlos is **single-tenant** (one club = one deployment), and this spec codifies that decision, the rationale, and the YAGNI boundaries. It also documents the **v2 multi-tenancy path** so future migration does not require architectural rewrites.

**Why this spec exists now**: Multi-tenancy retrofits are among the most expensive changes a system can absorb. Every table, every query, every connection string, and every operator flow must be revisited. By deciding explicitly today, we avoid paying that cost on v1, while keeping the door open without locking the design.

---

## Decisions

| # | Decision | Version | Reversibility |
|---|----------|---------|---------------|
| D1 | Single-tenant deployment | v1 | HIGH (full retrofit) |
| D2 | No `tenant_id` columns in v1 schema | v1 | HIGH (full data migration) |
| D3 | No schema-per-tenant or DB-per-tenant separation in v1 | v1 | HIGH (infra rewrite) |
| D4 | Operators are global to the deployment | v1 | MEDIUM (re-bucketing) |
| D5 | Subdomain strategy (`<club>.athlos.com`) is the recommended v2 URL approach | v2 | LOW |
| D6 | Legacy `PARCODIGO` (6 configurations) maps to a single tenant in v1 | v1 | MEDIUM (re-seeding) |
| D7 | Audit events are tenant-scoped in v2 (tenant_id required) | v2 | LOW |

---

## Requirements

### Requirement: Single-Tenant Deployment (v1)

The system SHALL be deployed as a single-tenant instance where one physical deployment serves exactly one club organization (Club Atlético Gorriti). No tenant resolution SHALL occur in the request path, and no tenant identifier SHALL be stored in any v1 table.

#### Scenario: Deployment serves one club

- GIVEN Athlos v1 is deployed for Club Atlético Gorriti
- WHEN an operator authenticates and makes any API request
- THEN the system MUST NOT perform tenant resolution
- AND the request MUST operate on the single shared data set

#### Scenario: Tenant column absent from v1 schema

- GIVEN the v1 schema is created
- WHEN reviewing any domain table (socios, ctacte, projections, audit_log, configurations)
- THEN no `tenant_id` column SHALL exist
- AND no `tenants` table SHALL exist in the v1 schema

### Requirement: No Multi-Tenant Abstractions in v1 (YAGNI Boundary)

The system MUST NOT introduce multi-tenant abstractions in v1, including but not limited to: tenant context middleware, tenant-scoped connection pools, tenant-aware query builders, or tenant-prefixed URL routes. Adding these abstractions now would impose complexity with no current use.

#### Scenario: No tenant middleware in request pipeline

- GIVEN the HTTP request pipeline is configured
- WHEN a request enters the API
- THEN no tenant resolution middleware SHALL run
- AND the request context SHALL NOT contain a `tenantId` field

#### Scenario: Connection string is single-purpose

- GIVEN a database connection is established
- WHEN the connection string is read
- THEN it MUST NOT contain tenant placeholders
- AND it SHALL point to a single database/schema

### Requirement: Operator Isolation Strategy (v1 Global, v2 Per-Tenant)

In v1, operators SHALL be global to the deployment — one operator account SHALL be able to interact with the single club's data without tenant scoping. In v2, operators SHALL be scoped per tenant, meaning an operator can only access data for tenants to which they are explicitly assigned. Operators MUST NOT be referenced by `operator_id` in any URL path component or other client-controlled input in v1, to avoid coupling operator identity to a routing scheme that v2 will need to redesign.

#### Scenario: v1 operator has full access

- GIVEN operator "OP-001" is authenticated in v1
- WHEN operator "OP-001" queries any socio, payment, or configuration
- THEN the query MUST succeed without any tenant filter
- AND no tenant check SHALL be enforced

#### Scenario: Operator ID not in URL

- GIVEN an API request is made
- WHEN the URL path is inspected
- THEN the path MUST NOT contain `/operators/{operator_id}/` as a routing segment
- AND operator identity MUST be derived from the authenticated session, never the URL

#### Scenario: v2 operator bounded to assigned tenants

- GIVEN Athlos v2 is multi-tenant and operator "OP-001" is assigned to tenant "club-gorriti" only
- WHEN operator "OP-001" authenticates and queries socio data
- THEN the system MUST filter the query by the assigned tenant(s)
- AND queries for non-assigned tenants MUST return empty results or 403, never cross-tenant data

### Requirement: URL Tenant Resolution Strategy (v2 Recommended: Subdomain)

In v2, the system SHALL identify tenants via subdomain (`<club-slug>.athlos.com`), where the `Host` header determines the tenant context for the request. The system MAY support path-based (`/c/<club-slug>/`) or header-based (`X-Tenant-ID`) routing as alternatives, but subdomain is the recommended default.

#### Scenario: Subdomain resolution in v2

- GIVEN DNS resolves `gorriti.athlos.com` to Athlos
- WHEN a request hits `https://gorriti.athlos.com/api/socios`
- THEN the system MUST derive tenant `gorriti` from the `Host` header
- AND apply that tenant to all data access in the request

#### Scenario: Path-based fallback in v2

- GIVEN Athlos v2 is configured to support path-based tenant routing
- WHEN a request hits `https://athlos.com/c/gorriti/api/socios`
- THEN the system MUST derive tenant `gorriti` from the path segment
- AND reject the request with 400 if the segment is missing or malformed

#### Scenario: Header-based fallback in v2

- GIVEN Athlos v2 is configured to support header-based tenant routing
- WHEN a request hits `https://api.athlos.com/api/socios` with header `X-Tenant-ID: gorriti`
- THEN the system MUST derive tenant `gorriti` from the header
- AND reject the request with 400 if the header is missing

#### Scenario: No tenant resolution in v1

- GIVEN Athlos v1 is deployed
- WHEN any request hits the API regardless of `Host` header, path, or `X-Tenant-ID` header
- THEN the system MUST ignore any tenant-like input
- AND serve the single-tenant data set

### Requirement: Configuration Scoping (v1 Global, v2 Per-Tenant)

In v1, the configuration table (`configurations` / `paramet`) SHALL be global to the deployment — a single set of parameter values applies to the entire system. In v2, configurations SHALL be scoped per tenant, allowing each club to override parameter values independently.

#### Scenario: v1 single configuration set

- GIVEN a v1 deployment
- WHEN a configuration value is read (e.g., default currency, membership fee formula)
- THEN exactly one row SHALL be returned for any given config key
- AND the value applies to all data in the deployment

#### Scenario: v2 per-tenant configuration

- GIVEN Athlos v2 with two tenants, "gorriti" and "aldosivi"
- WHEN the system reads a configuration key for tenant "gorriti"
- THEN it MUST return the value configured for "gorriti"
- AND MUST NOT return the value configured for "aldosivi" (or any global fallback, unless explicitly tiered)

### Requirement: Audit Event Tenant Attribution (v2)

In v2, every audit event MUST include a `tenant_id` field, and audit queries MUST be filtered by the requesting operator's assigned tenant(s). In v1, audit events SHALL NOT include tenant attribution (single-tenant by definition). This requirement is forward-looking and does not affect v1 behavior, but it MUST be considered when designing the v1 audit schema so that the `tenant_id` column can be added without breaking changes.

#### Scenario: v1 audit event has no tenant

- GIVEN an audit event is recorded in v1
- WHEN the audit record is stored
- THEN the schema MUST NOT include a `tenant_id` column
- AND no `tenants` foreign key SHALL be referenced

#### Scenario: v2 audit event includes tenant

- GIVEN an audit event is recorded in v2 for tenant "gorriti"
- WHEN the audit record is stored
- THEN it MUST include `tenant_id = "gorriti"`
- AND the value MUST match the tenant context under which the action was performed

#### Scenario: v2 audit query tenant scoping

- GIVEN operator "OP-001" is assigned only to tenant "gorriti"
- WHEN "OP-001" queries the audit log
- THEN results MUST be filtered to events where `tenant_id = "gorriti"`
- AND events for other tenants MUST NOT be visible

### Requirement: Legacy Multi-Company Compatibility (PARCODIGO Mapping)

The legacy Visual FoxPro system supports up to 6 logical configurations per installation, distinguished by the `PARCODIGO` field. In v1, the entire Athlos deployment SHALL import and treat all `PARCODIGO` values as a single tenant — no business logic SHALL branch on `PARCODIGO` in v1. In v2, if migrating to SaaS, each distinct `PARCODIGO` value MAY become a separate tenant, with data segregated by that field.

#### Scenario: v1 imports all PARCODIGO values

- GIVEN legacy contains records across `PARCODIGO` values 1, 2, 3, 4, 5, 6
- WHEN Athlos v1 performs a raw import
- THEN it MUST ingest all records regardless of `PARCODIGO`
- AND the projection layer MUST aggregate them into a single unified data set
- AND no filtering by `PARCODIGO` SHALL be applied at query time

#### Scenario: v2 SaaS splits by PARCODIGO

- GIVEN Athlos v2 is deployed in SaaS mode and the legacy is migrated
- WHEN records with `PARCODIGO = 1` are imported for tenant "tenant-1"
- THEN those records MUST be associated with tenant_id "tenant-1"
- AND queries for tenant "tenant-1" MUST NOT return records with other `PARCODIGO` values
- AND a `PARCODIGO` → `tenant_id` mapping table MUST be defined and used during migration

#### Scenario: PARCODIGO preserved in lineage

- GIVEN any legacy record is imported (v1 or v2)
- WHEN the raw import record is stored
- THEN the original `PARCODIGO` value MUST be preserved in the raw record
- AND MUST be accessible via the lineage system for audit/migration purposes

### Requirement: Re-Evaluation Triggers

This spec MUST be re-evaluated when ANY of the following triggers occur. Re-evaluation is a hard gate — proceeding past these triggers without a new spec version is a non-conformance.

| # | Trigger | Action |
|---|---------|--------|
| T1 | A second club signs up to use Athlos | Open a new SDD change to introduce multi-tenancy |
| T2 | A club explicitly requests multi-company mode (multi-PARCODIGO within one deployment) | Open a new SDD change to introduce logical multi-tenancy within a single deployment |
| T3 | Business decision to migrate to SaaS model | Open a new SDD change covering the full multi-tenancy migration |
| T4 | Schema changes that would be materially harder with `tenant_id` retrofitted (e.g., a new domain with no precedent) | Review this spec before merging the schema change |

#### Scenario: Second club triggers re-spec

- GIVEN Athlos v1 is in production for Club Atlético Gorriti
- WHEN a second club (e.g., Club Aldosivi) expresses interest in using Athlos
- THEN the team MUST NOT onboard them on the existing deployment
- AND a new SDD change MUST be opened to address multi-tenancy
- AND the new change MUST follow the v2 strategy in this spec

#### Scenario: Multi-company request triggers re-spec

- GIVEN Club Atlético Gorriti operates with multiple `PARCODIGO` configurations
- WHEN Gorriti requests that each `PARCODIGO` be a logically isolated environment
- THEN a new SDD change MUST be opened
- AND the change MUST address logical multi-tenancy (not necessarily physical schema-per-tenant)

### Requirement: Multi-Tenancy Strategy Options (v2 Reference)

When v2 multi-tenancy is implemented, the system SHALL choose between three strategies. The decision is deferred to v2, but this requirement records the strategies and their tradeoffs for future reference.

| Strategy | Isolation | Cost | Migration Cost | Recommended For |
|----------|-----------|------|----------------|-----------------|
| **Schema per tenant** (PostgreSQL `SCHEMA`) | Logical, shared DB | Low (1 DB, many schemas) | Medium (data migration + query layer) | Tens of tenants, strict data isolation |
| **DB per tenant** | Physical | High (N DBs, N connection pools) | High (full data replication per tenant) | Few high-value tenants, regulatory isolation |
| **Shared DB with `tenant_id` column** | Application-enforced | Lowest (1 DB, 1 schema) | Lowest (add column, update queries) | Hundreds+ of tenants, SaaS scale |

#### Scenario: Schema-per-tenant strategy

- GIVEN v2 is implemented with schema-per-tenant
- WHEN a request is processed for tenant "gorriti"
- THEN the system MUST set the PostgreSQL `search_path` to `"tenant_gorriti"` for the duration of the request
- AND all queries MUST execute against that schema
- AND schema migration scripts MUST be applied to every tenant schema

#### Scenario: DB-per-tenant strategy

- GIVEN v2 is implemented with DB-per-tenant
- WHEN a request is processed for tenant "gorriti"
- THEN the system MUST select a connection from the connection pool for database `athlos_gorriti`
- AND no cross-database queries SHALL be permitted
- AND database migrations MUST be applied to every tenant database

#### Scenario: Shared DB with tenant_id

- GIVEN v2 is implemented with shared DB + `tenant_id`
- WHEN a request is processed for tenant "gorriti"
- THEN the system MUST inject `tenant_id = 'gorriti'` into every query
- AND every domain table MUST include a `tenant_id` column
- AND a database-level row-security policy (PostgreSQL RLS) SHOULD enforce the filter as a defense in depth

---

## Non-Requirements (Explicitly Out of Scope for v1)

The following are **explicitly NOT** required in v1. Calling them out prevents gold-plating and scope creep.

| Concern | v1 Status | v2 Status |
|---------|-----------|-----------|
| `tenants` table | Not created | Required |
| `tenant_id` column on any table | Not present | Required on every domain table |
| Tenant resolution middleware | Not present | Required (subdomain) |
| Tenant-scoped connection pools | Not present | Required (strategy-dependent) |
| Tenant-prefixed routes | Not present | Required (subdomain) |
| Per-tenant operator assignments | Not present | Required |
| Per-tenant configuration overrides | Not present | Required |
| Per-tenant audit log filtering | Not present | Required |
| Row-level security (PostgreSQL RLS) | Not enabled | Recommended as defense in depth |
| Tenant onboarding flow | Not present | Required (sign-up, provisioning) |
| Cross-tenant data sharing/aggregation | Not present | Out of scope even in v2 |

---

## Cost of Retrofitting

If v1 ships without multi-tenancy and v2 is then requested, the following work is required. This is a **rough order of magnitude** to underscore why we are deferring the decision deliberately.

| Layer | v2 Retrofit Work |
|-------|------------------|
| Schema | Add `tenant_id` to ~30+ domain tables; backfill values; add indexes; add `tenants` master table; possible RLS policies |
| Queries | Update every query (writes, reads, projections) to include tenant filter; potential 1.5–2x dev cost on query-heavy code |
| Connection layer | Add tenant-aware connection routing (schema-per-tenant or DB-per-tenant); connection pool sizing per tenant |
| Auth & operators | Re-bucket operators by tenant; migrate existing global operator accounts; update session model |
| Configurations | Duplicate configurations per tenant OR introduce tenant-keyed config lookups; migrate existing single-set config |
| Audit | Backfill `tenant_id` on historical audit events; add tenant filter to query layer |
| API surface | Possibly change URL strategy (subdomain); update API gateway routing; update CORS, cookies, session scoping |
| Infrastructure | Add per-tenant provisioning automation; per-tenant backup/restore; per-tenant monitoring |
| Frontend | Tenant-aware branding, login flows, error messaging |

**Estimated effort**: 2–4 person-months of careful work for a system of Athlos' size, plus risk of subtle cross-tenant data leaks if any query is missed. This is the cost we are explicitly avoiding in v1.

---

## Migration Path (v1 → v2)

When a re-evaluation trigger fires and v2 multi-tenancy is approved, the recommended migration path is:

1. **Stand up the new `tenants` master table** and seed it with `gorriti` (current deployment) and any incoming clubs.
2. **Choose strategy** (shared-DB + `tenant_id` is recommended for SaaS scale; schema-per-tenant if regulatory isolation is needed).
3. **Add `tenant_id` to every domain table** in a single coordinated migration. Add indexes. Add NOT NULL constraints after backfill.
4. **Backfill `tenant_id` from `PARCODIGO`** using the `PARCODIGO` → `tenant_id` mapping table. For v1, all rows get `tenant_id = "gorriti"`.
5. **Wrap every query in a tenant scope helper** that injects the filter automatically. Add regression tests for cross-tenant isolation.
6. **Introduce tenant resolution middleware** (subdomain preferred). Update API gateway and DNS.
7. **Re-bucket operators by tenant**. Migrate operator accounts. Update session model to carry `tenant_id`.
8. **Duplicate configurations per tenant** (or introduce tenant-keyed lookups).
9. **Add `tenant_id` to audit events** (backfill historical events, enforce on new ones).
10. **Enable PostgreSQL RLS** as a defense-in-depth check.
11. **Decommission the old single-tenant deployment** only after the new deployment is verified end-to-end.

---

## Input/Output Contracts

### Tenant Identifier (v2 only)

```typescript
// v2 only — do not introduce in v1
type TenantId = string; // e.g., "gorriti", "aldosivi"

interface Tenant {
  id: TenantId;
  slug: string;          // URL-safe, e.g., "gorriti"
  display_name: string;  // e.g., "Club Atlético Gorriti"
  status: 'active' | 'suspended' | 'archived';
  created_at: string;    // ISO 8601
  config: Record<string, unknown>; // per-tenant overrides (optional)
}
```

### v2 Query Scope Helper (v2 only)

```typescript
// v2 only — every query flows through this
function scopedTo(tenantId: TenantId): QueryScope {
  return {
    tenantId,
    apply: <T>(query: Query<T>) => query.where('tenant_id', '=', tenantId),
  };
}
```

### v1 Connection String (single-tenant)

```
postgresql://athlos:***@db.athlos.local:5432/athlos
```

No tenant placeholders. No schema prefix. One connection pool, one schema.

---

## Success Criteria

### v1

- [ ] No `tenant_id` column exists in any v1 table
- [ ] No `tenants` table exists in v1
- [ ] No tenant resolution middleware runs in the v1 request pipeline
- [ ] `PARCODIGO` is preserved in raw imports and accessible via lineage
- [ ] All `PARCODIGO` values are aggregated into a single data set in v1
- [ ] Operators are global to the deployment and can be referenced by `operator_id` in sessions (not URLs)
- [ ] Configuration is a single global set per deployment

### v2 (when triggered)

- [ ] `tenants` master table exists and is seeded
- [ ] `tenant_id` column exists on every domain table with index and NOT NULL constraint
- [ ] Every query flows through a tenant-scope helper
- [ ] Tenant resolution is functional via subdomain (and optionally path/header)
- [ ] Operators are scoped per tenant; cross-tenant access is blocked
- [ ] Audit events include `tenant_id` and are filterable by tenant
- [ ] Configurations are per-tenant
- [ ] Cross-tenant data leakage regression test suite exists and passes
- [ ] PostgreSQL RLS enabled as defense in depth (recommended)

### Re-Evaluation Gate

- [ ] This spec is reviewed before any work begins on the re-evaluation triggers (T1, T2, T3, T4)
- [ ] A new SDD change is opened with its own proposal and spec for the multi-tenancy work
- [ ] Migration cost and risk are explicitly acknowledged before greenlight

---

## References

- **Gaps analysis**: Gap #17 in Phase 3 (BAJA) — multi-tenancy decision
- **README**: "posibilidad de migración a SaaS" — forward-looking SaaS signal
- **Legacy**: `PARCODIGO` field with up to 6 configurations per installation
- **Current target**: Club Atlético Gorriti (single club)
- **Related specs**: `audit-logger` (will need `tenant_id` in v2), `user-management-rbac` (operators), `config-environment` (configurations), `data-access-layer` (query layer)
