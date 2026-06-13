# Testing Setup Specification

## Purpose

Define the testing strategy, tooling, and operational rules for Athlos — the foundation every feature spec relies on for verification. This spec covers the test pyramid, runners, coverage, mocking patterns, CI integration, and how external dependencies (legacy DBF, WhatsApp, email, clock) are simulated. It is the contract that `data-access-layer`, `api-design`, `ui-design`, and every other capability spec extend with their domain-specific test scenarios.

The Athlos stack uses **Vitest** (unit + integration), **Playwright** (E2E), and **Testcontainers** (real PostgreSQL 16 for integration). The runtime is Node.js 20 + TypeScript 5, packaged as a pnpm monorepo.

---

## A. Test Strategy

### Requirement: Test Pyramid With Fixed Ratio

The test suite MUST follow a 70 / 25 / 5 ratio: **70% unit, 25% integration, 5% E2E**, measured by test count per push. A pull request that pushes the suite outside the ratio by more than ±10 percentage points SHOULD be split or justified in the PR description.

#### Scenario: A pure function is added

- GIVEN a new pure utility (e.g. `redactSensitiveFields`)
- WHEN the test is written
- THEN it MUST be a Vitest unit test with no I/O
- AND the test count delta increases the unit bucket

#### Scenario: A repository method touches the database

- GIVEN a new method on `sociosRepository`
- WHEN the test is written
- THEN it MUST be a Vitest integration test using a Testcontainers PostgreSQL container
- AND it MUST NOT use mocks of the database

### Requirement: Strict TDD — Red, Green, Refactor

The team MUST follow strict TDD: a failing test is written BEFORE production code, and a task is not "done" until the test passes and the production code is refactored clean. This applies to unit AND integration tests. E2E tests MAY be written alongside UI code (not strictly red-first) because Playwright specs are often impossible to author before the page exists.

#### Scenario: A new endpoint is added

- GIVEN a new route `POST /api/v1/socios`
- WHEN work begins
- THEN a Vitest unit test for the request schema validation MUST be written and confirmed failing FIRST
- THEN a Vitest integration test for the route handler against a Testcontainer MUST be written and confirmed failing
- THEN production code is written until both tests pass
- THEN refactor without breaking either test

#### Scenario: A new page is added

- GIVEN a new React page at `/socios/:id`
- WHEN work begins
- THEN a Playwright E2E test for the happy path MAY be written after the page renders, before the form submission logic
- AND unit tests for page-local utilities MUST still be TDD

---

## B. Test Runners

### Requirement: Vitest For Unit And Integration, Playwright For E2E

Unit and integration tests MUST run under **Vitest**. End-to-end tests MUST run under **Playwright**. Jest and Mocha are forbidden.

#### Scenario: A developer runs all tests locally

- GIVEN a developer on Node 20 with pnpm installed
- WHEN they run `pnpm test`
- THEN Vitest MUST execute all unit + integration tests across every workspace package
- AND the run MUST complete in under 5 minutes on a developer laptop

#### Scenario: A developer runs E2E tests locally

- GIVEN the developer wants to verify a UI flow
- WHEN they run `pnpm test:e2e`
- THEN Playwright MUST launch in **headed** mode by default in dev
- AND `pnpm test:e2e:ci` MUST launch headless

### Requirement: Vitest Config Per Package + Shared Setup

Each workspace package that has tests MUST ship a `vitest.config.ts`. The repository root MUST ship a `vitest.workspace.ts` (or `vitest.config.ts` with `workspace`) that aggregates them. Shared setup files (`vitest.setup.ts`) live at the repo root and configure: timezone (`UTC`), fake timers helper, env-var loader for tests, and global mocks for `fetch` if used.

#### Scenario: A new package is added to the monorepo

- GIVEN `packages/<name>` is created
- WHEN it needs tests
- THEN it MUST include a `vitest.config.ts` extending `@athlos/vitest-config` (shared preset)
- AND the preset MUST provide: jsdom for component tests, node for backend, default coverage thresholds

### Requirement: Playwright Config Per App

Each frontend app (`apps/web`, future `apps/admin`) MUST ship a `playwright.config.ts` rooted in the app. The root `package.json` MUST expose `pnpm test:e2e` as a workspace-wide runner that invokes every app's Playwright suite sequentially.

---

## C. Coverage Requirements

### Requirement: Per-Line And Per-Branch Minimums

Every Vitest run MUST enforce a minimum of **80% lines** and **75% branches** per package, with a global floor of 80% lines / 75% branches across the monorepo. Coverage is measured by `@vitest/coverage-v8` (not Istanbul — V8 is faster and built-in).

#### Scenario: A PR drops a package below the floor

- GIVEN package `packages/api` has 79% line coverage after a change
- WHEN CI runs `vitest --coverage`
- THEN the coverage gate MUST fail
- AND the PR MUST be blocked from merge

### Requirement: Per-File Minimum With Critical-File Override

Every source file MUST meet **70% line coverage** individually. Files that contain business-critical logic (auth, payments, lineage, drift detection) MUST meet **90% line coverage** and are tagged in a `coverage.critical.json` manifest. Examples: `auth/login.ts`, `payments/create.ts`, `lineage/resolve.ts`, `drift/compare.ts`.

#### Scenario: A critical file drops to 85% coverage

- GIVEN `payments/create.ts` is in the critical manifest
- WHEN a PR leaves it at 85% line coverage
- THEN CI MUST fail with `coverage.critical.below-90`

### Requirement: Coverage Exclusions

Generated code (`**/*.gen.ts`, `**/migrations/**`, `**/schemas/generated/**`), configuration files (`*.config.ts`, `vitest.setup.ts`), and `**/*.test.ts` itself MUST be excluded from coverage. Exclusions are declared in `vitest.config.ts` `coverage.exclude`. Adding a new exclusion MUST be reviewed in PR.

---

## D. Unit Test Patterns

### Requirement: Real Dependencies For Pure Logic, Doubles For I/O

Unit tests MUST call real implementations of pure logic (formatters, validators, reducers, state machines) and MUST use test doubles only at I/O boundaries: database, HTTP, filesystem, clock, external services.

#### Scenario: Testing a Zod schema

- GIVEN `socioCreateSchema` in `validation/socio.ts`
- WHEN a unit test is written
- THEN it MUST call `socioCreateSchema.safeParse()` directly with no mocks
- AND it MUST assert on `success` / `error.issues`

#### Scenario: Testing a service that calls a repository

- GIVEN `pagosService.createPayment(input)` calls `cuentaCorrienteRepository` and `asientoRepository`
- WHEN a unit test is written for `pagosService` in isolation
- THEN the repositories MUST be replaced with **stubs** (return canned values, no behavior verification)
- AND the test MUST NOT use a Testcontainer — that is reserved for the integration test

### Requirement: Test Doubles Vocabulary

The team MUST use this vocabulary consistently:

| Double | Purpose | Verify? |
|--------|---------|---------|
| **Stub** | Returns canned data | No |
| **Mock** | Records calls for assertion | Yes |
| **Fake** | Working lightweight impl (e.g. in-memory queue) | No |
| **Spy** | Wraps a real impl, records calls | Optional |

#### Scenario: Choosing a double for a logger

- GIVEN a service writes to a logger
- WHEN the test wants to assert "warning was logged with field X"
- THEN it MUST use a **spy** or **mock** of the logger
- AND it MUST NOT use a stub (stubs can't be verified)

### Requirement: No Snapshot Tests For Business Logic

Snapshot tests (`toMatchSnapshot`) are forbidden for business logic, schemas, computed values, and API responses. They are permitted ONLY for static, intentional visual artifacts (icon SVGs, generated OpenAPI YAML).

#### Scenario: A developer considers snapshot for a DTO

- GIVEN `toSocioDTO(row)` returns a plain object
- WHEN writing a unit test
- THEN `toMatchSnapshot()` is forbidden
- AND the test MUST assert each field explicitly with `expect(dto).toEqual({...})`

---

## E. Integration Test Patterns

### Requirement: Testcontainers With Real PostgreSQL 16

Integration tests for repositories, services, and route handlers MUST use a real PostgreSQL 16 instance started by **Testcontainers** (`@testcontainers/postgresql` using the `postgres:16-alpine` image). In-memory databases (PGlite, SQLite) and Drizzle mocks are forbidden for these layers.

#### Scenario: A repository test needs the database

- GIVEN a test for `cuentaCorrienteRepository.findBySocio(42)`
- WHEN it runs
- THEN a Testcontainer MUST be started (or reused) with all 5 schemas migrated
- AND the test MUST insert seed data via SQL or a builder
- AND assert against real query results

### Requirement: Container Lifecycle And Reuse

A single Testcontainer MUST be started per test file (NOT per test) using a global `setup` file. Containers are reused across tests in the same file via `beforeAll` / `afterAll`. Different test files MAY share a container if Vitest workers are configured with `pool: 'forks', poolOptions: { forks: { singleFork: true } }` for slow suites; otherwise each file gets its own.

#### Scenario: A test file has 12 tests against the DB

- GIVEN 12 tests in `sociosRepository.test.ts`
- WHEN the file runs
- THEN `beforeAll` MUST start one Testcontainer
- AND each test MUST receive a clean schema (see "Cleanup" below)
- AND `afterAll` MUST stop the container

### Requirement: Cleanup Between Tests With Truncate

Each test MUST run against a clean schema. Cleanup uses `TRUNCATE <tables> RESTART IDENTITY CASCADE` executed inside a `beforeEach` hook on a dedicated test connection. Tests MUST NOT use shared connections for cleanup (would deadlock with the test under transaction).

#### Scenario: Two tests in the same file both insert socio #1

- GIVEN test 1 inserts socio id=1
- WHEN test 2 runs and queries for socio id=1
- THEN test 2 MUST see zero rows
- AND the cleanup between them MUST have truncated `socios.socio`

### Requirement: Test Data Builders

All integration test data MUST be created via **builders** (`@athlos/test-builders`) that return sane defaults overridable per field. Direct SQL inserts in tests are forbidden except for the seed fixtures described in the next requirement.

#### Scenario: A test needs a socio with a specific cuenta corriente balance

- GIVEN the test needs socio id=42 with balance 1500.00
- WHEN writing the test
- THEN it MUST call `aSocio().withId(42).withSaldo(1500).build()` and pass to the repository
- AND it MUST NOT write raw SQL inserts in the test body

### Requirement: Canonical Seed Fixtures

A small set of canonical fixtures (`fixtures/seed/*.ts`) exists for scenarios that span multiple tables (e.g. socio + cuenta_corriente + asiento). These are versioned and reviewed. Tests that need bespoke data SHOULD use builders; only cross-domain scenarios SHOULD add a new fixture.

---

## F. E2E Test Patterns

### Requirement: Playwright For Critical User Flows

E2E tests MUST cover the flows in this table, all implemented as Playwright specs. The list is the minimum — additions are encouraged.

| Flow | Spec file |
|------|-----------|
| Login → see dashboard | `auth/login.spec.ts` |
| Operator creates another operator + temp password → first login forces change | `admin/operator-onboarding.spec.ts` |
| Search socio → view detail → view cuenta corriente | `socios/detail.spec.ts` |
| Drill into a reconciliation drift alert → see source vs projection | `drift/alert-drilldown.spec.ts` |
| Mobile operator views degraded UI on narrow viewport | `responsive/mobile.spec.ts` |

#### Scenario: A new user flow is added without an E2E test

- GIVEN a new "issue a refund" UI flow ships
- WHEN the PR is reviewed
- THEN the reviewer MUST require a Playwright spec covering the happy path
- AND the spec MUST run in CI

### Requirement: Headless In CI, Headed In Dev, Artifacts On Failure

Playwright MUST run headless in CI (`headless: true`, `workers: 1` to avoid rate limits) and headed by default in dev (`headless: false`). On test failure, Playwright MUST capture: a screenshot (`test-failed-{n}.png`), a video of the failed run, and the page's `console.log` + `pageerror` output. Artifacts are uploaded as CI artifacts and stored for 14 days.

#### Scenario: An E2E test fails in CI

- GIVEN a Playwright test in `auth/login.spec.ts` fails on PR #123
- WHEN the CI run completes
- THEN a `playwright-report/` directory MUST be uploaded as a CI artifact
- AND the failure screenshot MUST be visible in the PR check details
- AND the developer MUST be able to download the trace

### Requirement: No Real External Services In E2E

E2E tests MUST NOT hit real WhatsApp, email, SMS, or legacy DBF endpoints. All externals are stubbed at the API boundary (see Section H). The frontend talks to the local API in tests; the API is configured to use stub adapters for externals.

---

## G. CI Integration

### Requirement: Tests Run On Every PR

Every pull request MUST trigger `.github/workflows/ci.yml` which runs, in order: `lint` → `typecheck` → `test` (Vitest with coverage) → `build` → `e2e` (Playwright). Each job MUST upload its results, and the PR cannot merge until all jobs pass. Branch protection MUST be configured to require the `ci / all-checks` status check.

#### Scenario: A PR has a typecheck failure

- GIVEN a PR introduces a TypeScript error
- WHEN the `typecheck` job runs
- THEN it MUST fail before `test` runs (fail-fast)
- AND the PR MUST show a red ✗ on the typecheck check

### Requirement: Required Checks List

The `branch protection` rule for `main` MUST require these checks to pass:

1. `ci / lint` — ESLint + Prettier check
2. `ci / typecheck` — `tsc --noEmit` across all packages
3. `ci / test` — Vitest with coverage gate
4. `ci / build` — production build for every app
5. `ci / e2e` — Playwright suite

#### Scenario: An admin tries to merge a red PR

- GIVEN a PR with `ci / test` failing
- WHEN "Merge" is clicked
- THEN GitHub MUST block the merge
- AND the admin MUST see "1 required check is failing"

### Requirement: Coverage Report Uploaded To PR

The `ci / test` job MUST upload the Vitest coverage report (`coverage/`) and a `vitest --reporter=json` summary as PR artifacts. A coverage comment MUST be posted to the PR by `vitest-coverage-report-action` showing per-file deltas vs `main`.

#### Scenario: A PR drops coverage on a critical file

- GIVEN `payments/create.ts` drops from 92% to 86% in the PR
- WHEN the coverage comment posts
- THEN it MUST highlight the file in red
- AND the comment MUST include a `git blame` link to the lines that lost coverage

### Requirement: Merge Strategy — Squash, Linear History Required

PRs MUST be merged via squash-merge to keep `main` linear. Commit messages MUST follow Conventional Commits. Force-pushes to `main` are forbidden; the branch protection rule enforces this.

---

## H. Mocking External Services

### Requirement: External Services Are Behind Adapter Interfaces

Every external integration (legacy DBF, WhatsApp, email, clock) MUST be accessed through a typed interface, with a real adapter for production and a stub adapter for tests. Adapters live in `packages/integrations/<name>/` and export both `RealXxxAdapter` and `StubXxxAdapter`.

#### Scenario: Production vs test wiring

- GIVEN `apps/api` boots in production
- WHEN the DI container assembles
- THEN it MUST use `RealLegacyDbfAdapter`, `RealWhatsAppAdapter`, `RealEmailAdapter`
- AND in test env (`NODE_ENV=test`) it MUST use the Stub variants

### Requirement: Legacy DBF Mocking

The legacy DBF adapter is mocked by replaying pre-recorded `.dbf` files shipped as test fixtures (`fixtures/legacy/<table>.dbf`). Tests MUST NOT use a live Windows share. If a scenario needs a DBF that does not exist as a fixture, the test MUST generate one from a JSON spec via a fixture builder (`buildDbf(table, rows)`), never hit the network.

#### Scenario: An import test needs CTACTE rows

- GIVEN a test imports CTACTE for socio 42
- WHEN it runs
- THEN it MUST use `aDbf('CTACTE').withRows([...]).build()` to produce a temp file
- AND the import service MUST be configured to read from that file path
- AND the test MUST NOT touch `\\ServidorGorriti\...`

### Requirement: WhatsApp Mocking

The WhatsApp adapter's stub MUST record every outbound message (`{to, body, sentAt}`) into an in-memory array exposed as `__whatsappStub.messages` for assertions. The stub MUST be deterministic and MUST NOT make network calls. Tests for WhatsApp-approval flows MUST assert on `__whatsappStub.messages[0].body` rather than scraping logs.

#### Scenario: An approval token is sent via WhatsApp

- GIVEN an operator triggers a sensitive action
- WHEN the action triggers an approval request
- THEN the stub MUST record one message
- AND the test MUST assert `messages[0].body` contains the approval URL

### Requirement: Email Mocking

The email adapter's stub MUST record every outbound message in `__emailStub.outbox` as `{to, subject, html, sentAt}`. The stub MUST be deterministic and MUST NOT make network calls. Tests for password reset, notifications, etc. MUST assert on `__emailStub.outbox`.

#### Scenario: A password reset email is sent

- GIVEN an operator requests a password reset
- WHEN the request handler runs
- THEN the stub MUST record one email
- AND the test MUST assert `outbox[0].to === operator.email` and `outbox[0].subject` matches a regex

### Requirement: Time And Clock Control

Tests that depend on time MUST use `@sinonjs/fake-timers` (or Vitest's `vi.useFakeTimers()`) installed in `vitest.setup.ts`. Real `Date.now()`, `new Date()`, and `setTimeout` MUST be replaced during time-sensitive tests. Production code that needs the current time SHOULD call a `clock.now()` helper so tests can stub the clock in one place rather than installing fake timers.

#### Scenario: A lockout window test needs to advance time

- GIVEN an operator has 4 failed logins
- WHEN the test advances the clock past the lockout window
- THEN it MUST call `vi.advanceTimersByTime(windowMs)`
- AND assert the next login is allowed

---

## Success Criteria

- [ ] `pnpm test` runs the full Vitest suite in under 5 minutes on a developer laptop
- [ ] `pnpm test:e2e` runs the full Playwright suite headless in under 10 minutes in CI
- [ ] Every package meets 80% line / 75% branch coverage; critical files meet 90%
- [ ] CI fails when any required check (lint, typecheck, test, build, e2e) fails
- [ ] Coverage delta is visible on every PR via a bot comment
- [ ] No test uses `\\ServidorGorriti\...`, real WhatsApp, or real email
- [ ] No snapshot tests exist for business logic, schemas, or DTOs
- [ ] All integration tests use Testcontainers, never mocks
- [ ] New code follows strict TDD: failing test first, then production, then refactor
