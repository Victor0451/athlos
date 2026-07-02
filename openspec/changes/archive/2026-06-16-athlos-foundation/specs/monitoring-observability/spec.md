# Monitoring & Observability Specification

## Purpose

Define the observability surface for Athlos API in v1: health check endpoints (liveness, readiness, startup), Prometheus-compatible metrics, log-based tracing via `request_id`, and the alert delivery hooks that the drift-detector and other jobs rely on. Distributed tracing (OpenTelemetry), APM, and dedicated alerting infrastructure are explicitly deferred — v1 ships a minimal-but-coherent surface that does NOT block operations.

This spec complements `api-design` (basic `GET /health` shape), `logging` (request_id correlation), `drift-detector` (email alert channel), and `deployment-devops` (Docker healthcheck).

---

## 1. Health Check Endpoints

### Requirement: GET /health — Liveness

The system MUST expose `GET /health` as a **liveness** probe. It MUST return `200 OK` with `{"status":"ok","version":"<semver>","timestamp":"<ISO>"}` as long as the Node.js event loop is responsive.

- GIVEN the API process is running and the event loop responds within 1s
- WHEN `GET /health` is called
- THEN response MUST be 200 with the liveness body
- AND the response MUST NOT depend on DB, legacy DBF, or any external system

### Requirement: GET /health/ready — Readiness

The system MUST expose `GET /health/ready` as a **readiness** probe. It MUST return `200 OK` with `{"status":"ok","dependencies":{"db":"ok","legacy":"ok"}}` only when every required dependency is reachable; otherwise it MUST return `503 Service Unavailable` with the failing dependency flagged.

- GIVEN PostgreSQL is reachable AND legacy DBF share is reachable
- WHEN `GET /health/ready` is called
- THEN response MUST be 200 with both dependencies `"ok"`

- GIVEN PostgreSQL is unreachable (connection times out within 2s)
- WHEN `GET /health/ready` is called
- THEN response MUST be 503 with `{"status":"degraded","dependencies":{"db":"error","legacy":"ok"}}`
- AND the endpoint MUST NOT block longer than 2s

### Requirement: GET /health/startup — Startup Probe

The system MUST expose `GET /health/startup` as a **startup** probe. It MUST return `200 OK` only after the Fastify server has finished binding the port AND database migrations (if `RUN_MIGRATIONS=true`) have completed; otherwise it MUST return `503`.

- GIVEN the API process has just started and migrations are still running
- WHEN `GET /health/startup` is called
- THEN response MUST be 503 with `{"status":"starting"}` until migrations complete
- AND MUST return 200 once startup is fully complete

### Requirement: Health Endpoints Are Unauthenticated

All three health endpoints MUST be reachable without authentication, MUST NOT be prefixed with `/api/v1`, and MUST NOT be logged at INFO (they would flood the log stream) — log them at DEBUG.

### Requirement: No Sensitive Data in Health Responses

Health responses MUST NOT leak credentials, connection strings, stack traces, or hostnames. Dependency error messages MUST be limited to a short code (e.g., `"timeout"`, `"unreachable"`).

---

## 2. Metrics

### Requirement: Prometheus-Compatible /metrics Endpoint

The system MUST expose `GET /metrics` returning Prometheus text exposition format (`Content-Type: text/plain; version=0.0.4`). The endpoint MUST require no authentication on the internal network but SHOULD be restricted at the reverse proxy in production.

### Requirement: HTTP Request Metrics

The system MUST emit, per endpoint and HTTP method:

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | counter | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | histogram (buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5) | `method`, `route`, `status_code` |

Buckets are chosen so p50/p95/p99 are computable via `histogram_quantile`. The `route` label MUST be the route template (e.g., `/api/v1/socios/:id`), never the raw path with IDs (cardinality control).

### Requirement: Process Metrics

The system MUST emit default Node.js process metrics: `process_cpu_seconds_total`, `process_resident_memory_bytes`, `process_start_time_seconds`, `nodejs_eventloop_lag_seconds`, `nodejs_active_handles_total`, `nodejs_heap_size_used_bytes`.

### Requirement: Database Metrics

The system MUST emit PostgreSQL pool metrics via `pg.Pool`:

| Metric | Type | Source |
|--------|------|--------|
| `db_pool_total_count` | gauge | `pool.totalCount` |
| `db_pool_idle_count` | gauge | `pool.idleCount` |
| `db_pool_waiting_count` | gauge | `pool.waitingCount` |
| `db_query_duration_seconds` | histogram | per-query timing wrapper |

### Requirement: Business Metrics

The system MUST emit the following gauges/counters, refreshed on a 30s interval or on event:

| Metric | Type | Source |
|--------|------|--------|
| `athlos_active_operators` | gauge | operators with `last_login_at` within 24h |
| `athlos_imports_total` | counter (labels: `domain`, `status`) | import job completion |
| `athlos_import_records_total` | counter (labels: `domain`) | per-record import success |
| `athlos_drift_events_total` | counter (labels: `domain`) | drift-detector findings |
| `athlos_freshness_seconds` | gauge (labels: `domain`) | seconds since last successful import |

### Requirement: No JSON Metrics Format in v1

In v1 the system MUST expose Prometheus format only. A JSON `/metrics.json` endpoint is deferred — Prometheus is the de-facto standard, scrapers are ubiquitous, and a second format doubles maintenance cost.

---

## 3. Logging as Observability

### Requirement: Structured JSON Logs

This requirement is already defined in the `logging` spec (pino + JSON to stdout, base fields including `request_id`, `timestamp`, `level`, `service`). The monitoring spec ADDS no new logging requirements; it treats logs as the primary debugging surface in v1.

### Requirement: Request ID Correlation

Every request MUST be tagged with a `request_id` (`req_<ulid>`) generated at the edge. The same `request_id` MUST appear in:
- All log lines emitted while processing the request
- The `X-Request-Id` response header (echoed for client debugging)
- Any error response body (`request_id` field per `api-design`)

The `request_id` is the v1 substitute for OpenTelemetry `trace_id` and `span_id` — it gives end-to-end correlation across logs without requiring a tracing SDK.

### Requirement: Log Aggregation Interface (Documented, Not Implemented)

The system MUST NOT integrate with any log aggregation backend in v1 (no Loki, no Datadog, no CloudWatch agent). However, the JSON shape and `service: "athlos-api"` field (per `logging` spec) MUST remain stable so a future aggregator (Loki/Datadog) can ingest stdout with zero code changes.

---

## 4. Alerting

### Requirement: Drift Detection Email Alert (Existing)

The drift-detector spec already mandates email alerts on drift. This spec does not redefine that behavior. Alert transport: SMTP via `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (per `config-environment`).

### Requirement: v1 Alert Hooks Only — No Alerting Infrastructure

In v1 the system MUST NOT run Prometheus Alertmanager, PagerDuty, or any other dedicated alerting platform. The following hooks are defined as **seams** for v2:

| Future Alert | Trigger | v1 Behavior |
|--------------|---------|-------------|
| API error rate spike | 5xx rate > 5% over 5m | Computed metric, no alert |
| Database down | `db_query_duration_seconds` p99 > 5s OR `db_pool_waiting_count` > 0 for 60s | Metric emitted, log ERROR, no email |
| Drift detected | drift-detector finding | Email sent (existing) |
| Health check failing | `/health/ready` returns 503 for 3 consecutive checks | Metric `up{job="athlos-api"}` exposed for external scraper |

These hooks are documented, not implemented, in v1.

---

## 5. Distributed Tracing

### Requirement: No OpenTelemetry in v1

The system MUST NOT integrate OpenTelemetry SDK, Jaeger, or any tracing backend in v1. The `request_id` field in every log line provides sufficient correlation for v1's operational needs.

### Requirement: Tracing Seam

If v2 introduces OpenTelemetry, the integration point is the Fastify request hook that already generates `request_id`. The hook MUST be the single place where trace context is established. Operators MUST NOT add ad-hoc `request_id` generation elsewhere.

---

## 6. Performance Baselines

### Requirement: Latency Targets (p95)

The following p95 latency targets MUST hold for a healthy production instance (single node, local DB, warm caches). Baselines inform alerting thresholds and SLO reviews — they are not hard pass/fail gates in v1.

| Endpoint | p95 Target | Hard Ceiling |
|----------|-----------|--------------|
| `POST /api/v1/auth/login` | 500ms | 2s |
| `GET /api/v1/socios` (list, 50 rows) | 200ms | 1s |
| `GET /api/v1/socios/:id` | 100ms | 500ms |
| `GET /api/v1/cuenta-corriente/:id` (list, 50 rows) | 300ms | 1.5s |
| `GET /api/v1/cuenta-corriente/:id/saldo` | 200ms | 1s |
| `GET /api/v1/freshness` | 100ms | 500ms |
| `GET /api/v1/lineage` | 200ms | 1s |
| Full import batch (all 14 tables) | 60min | 4h |

- GIVEN the production load profile (≤ 10 concurrent operators)
- WHEN latency is measured over a 24h window
- THEN p95 MUST be within the target column for ≥ 95% of endpoints measured
- AND no endpoint's p95 MUST exceed the hard ceiling

### Requirement: Baseline Measurement Procedure

The system SHOULD provide a load-test script (`scripts/load-test.ts` or similar) that exercises each endpoint above with realistic payloads and reports p50/p95/p99 against the targets. This script is a v2 deliverable; v1 baselines are validated manually with `k6` or equivalent.

---

## Scenarios

### Scenario: Liveness during dependency outage

- GIVEN PostgreSQL is down
- WHEN an orchestrator (Docker, k8s) calls `GET /health`
- THEN response MUST be 200 (the process is alive)
- AND the orchestrator MUST NOT restart the container based on `/health` alone

### Scenario: Readiness during dependency outage

- GIVEN PostgreSQL is down
- WHEN the load balancer calls `GET /health/ready`
- THEN response MUST be 503
- AND the load balancer MUST stop routing traffic to this instance until readiness recovers

### Scenario: Startup probe during migrations

- GIVEN the API container started 10s ago and migrations are still running
- WHEN k8s calls `GET /health/startup`
- THEN response MUST be 503
- AND k8s MUST NOT kill the pod (startupProbe failures don't trigger restart)

### Scenario: Metrics scrape

- GIVEN Prometheus scraper hits `GET /metrics` every 15s
- WHEN a `GET /api/v1/socios` request completes in 87ms
- THEN `/metrics` MUST include `http_request_duration_seconds_bucket{le="0.1",method="GET",route="/api/v1/socios",status_code="200"}` incremented by 1

### Scenario: Request correlation across logs

- GIVEN an operator calls `GET /api/v1/socios/abc` and the handler emits 3 log lines
- WHEN all 3 log lines are inspected
- THEN all 3 MUST share the same `request_id`
- AND the response header `X-Request-Id` MUST echo the same value

### Scenario: Drift alert email

- GIVEN drift-detector finds 5 modified CTACTE records
- WHEN the reconciliation job completes
- THEN a `DRIFT_DETECTED` email MUST be sent via SMTP (per drift-detector spec)
- AND the metric `athlos_drift_events_total{domain="CTACTE"}` MUST be incremented by 5

---

## Success Criteria

- [ ] `GET /health` returns 200 with `{status,version,timestamp}` regardless of dependency state
- [ ] `GET /health/ready` returns 200 only when all dependencies are healthy, 503 otherwise within 2s
- [ ] `GET /health/startup` returns 200 only after full startup completes
- [ ] All three health endpoints are unauthenticated, outside `/api/v1`, and logged at DEBUG
- [ ] `GET /metrics` exposes Prometheus text format with HTTP, process, DB pool, and business metrics
- [ ] HTTP request metrics use route templates (not raw paths) to control cardinality
- [ ] No PII, credentials, or stack traces appear in health or metrics responses
- [ ] `request_id` is generated once at the edge and propagates to all logs, error bodies, and response headers
- [ ] v1 ships no OpenTelemetry, no APM agent, no alertmanager — only hooks and seams for v2
- [ ] Performance baselines are documented and validated in a load test (v2 deliverable; manual in v1)
- [ ] Drift alert email path is unchanged from the drift-detector spec
