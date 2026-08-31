# Tasks: Athlos Docker Resource Lifecycle

## Review Workload Forecast

| Field                   | Value                              |
| ----------------------- | ---------------------------------- |
| Estimated changed lines | 900–1,250 authored lines           |
| 400-line budget risk    | High                               |
| Chained PRs recommended | Yes                                |
| Suggested split         | PR 1 → PR 2 → PR 3 → PR 4          |
| Delivery strategy       | ask-on-risk → chained PRs approved |
| Chain strategy          | feature-branch-chain               |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Apply gate:** SATISFIED. The user selected chained PRs with `feature-branch-chain`. Apply one review slice at a time, beginning with PR 1.

### Suggested Work Units

| Unit | Goal                                  | Likely PR | Focused test command                                      | Runtime harness                   | Rollback boundary             |
| ---- | ------------------------------------- | --------- | --------------------------------------------------------- | --------------------------------- | ----------------------------- |
| 1    | Deterministic lifecycle + fake Docker | PR 1      | `bats scripts/tests/disposable-postgres.test.bats`        | Fake Docker only; no daemon       | new library and unit suite    |
| 2    | Caller/root/argv wiring               | PR 2      | `bats scripts/tests/disposable-postgres.test.bats`        | non-root focused selector capture | rehearsal and package scripts |
| 3    | Resilience/recovery                   | PR 3      | `bats scripts/tests/disposable-postgres.test.bats`        | fake signal/clock/proc matrix     | recovery/trap behavior        |
| 4    | Real-Docker neutrality + CI           | PR 4      | `bats scripts/tests/disposable-postgres.integration.bats` | label inventory before/after      | integration suite and CI job  |

## Phase 1: Deterministic Fake-Docker Lifecycle (PR 1)

Allowed surfaces: `scripts/lib/disposable-postgres.sh`, `scripts/tests/disposable-postgres.test.bats`.

- [x] 1.1 **RED** — create fake-Docker Bats cases for `run --caller SLUG -- COMMAND...`: immutable `<epoch>-<pid>-<16-lower-hex>` identity; deterministic container/`athlos-dp-pgdata-<run>` names; all required owner/lifecycle/run/caller/creation/machine/boot/pid/start labels; named PGDATA mount; dynamic `127.0.0.1::5432`; bounded 60s readiness.
- [x] 1.2 **GREEN** — implement direct-Docker lifecycle root API, label-safe argv arrays, port inspection, readiness polling, and NDJSON stderr `identity`/`created`; never interpolate consumer argv or expose credentials/global inventory.
- [x] 1.3 **TRIANGULATE** — add hostile caller/argv, whitespace/metacharacter, invalid-slug, Docker-subprocess failure, partial-create/readiness-failure, and dynamic-concurrency fixtures; assert safe rejection/no shell evaluation and exact owned cleanup.
- [x] 1.4 **REFACTOR** — centralize command/label construction without changing fake transcript. Evidence: `shellcheck scripts/lib/disposable-postgres.sh`; `bats scripts/tests/disposable-postgres.test.bats` pass; rollback only both Unit-1 files.

## Phase 2: Awaited Teardown and Caller Wiring (PR 2)

Allowed surfaces: Unit-1 files, `scripts/recovery/rehearse-postgres16.sh`, `package.json`, `packages/db/package.json`.

- [x] 2.1 **RED** — assert container then volume removal, scoped absence verification, idempotent absent members, consumer success/failure/timeout preservation, and owner+run identity in `teardown`/`absence` evidence; assert no `docker system prune`/unscoped remove.
- [x] 2.2 **GREEN** — await ordered idempotent teardown on EXIT and retain terminal outcomes; route rehearsal through lifecycle, removing fixed port/ad-hoc trap.
- [x] 2.3 **TRIANGULATE** — invoke wrapper outside root with spaced Vitest selector; assert root derives from `BASH_SOURCE` and argv is byte-for-byte forwarded. Add exact scripts: root `test:disposable-postgres` and `test:disposable-postgres:integration`; db `test:disposable-postgres`, each using `pnpm --` forwarding.
- [x] 2.4 **REFACTOR** — share wrapper invocation helpers. Evidence: ShellCheck + unit Bats pass; non-root capture passes; rollback routing/scripts only.

## Phase 3: Signals, Stale Recovery, and Retry (PR 3)

Allowed surfaces: Unit-1 files.

- [x] 3.1 **RED** — fixture INT/TERM (130/143), repeat cleanup, SIGKILL-later-recovery, six-hour boundary, live/dead/rebooted/malformed/foreign-machine/unreadable-proc owners, exclusions (production/beta/persistent/foreign/unlabeled), retry order, and active concurrent owner.
- [x] 3.2 **GREEN** — add nonrecursive traps; conservative same-machine stale classifier; recover only complete labels and proven-dead owners before creation; await attempt N reconciliation before N+1.
- [x] 3.3 **TRIANGULATE** — assert stale-decision outcome plus owner/run identity and no adoption/cross-owner deletion or prune.
- [x] 3.4 **REFACTOR** — isolate classifier/teardown helpers. Evidence: ShellCheck + Bats pass; rollback resilience helpers/tests only.

## Phase 4: Resource-Neutral Docker Proof and CI (PR 4)

Allowed surfaces: `scripts/tests/disposable-postgres.integration.bats`, `.github/workflows/test.yml`, Unit-1 library.

- [x] 4.1 **RED** — real-Docker Bats snapshots complete label-scoped inventory before/after success, failure, bounded candidate-timeout/retry, partial start, SIGKILL recovery, and concurrency; assert excluded resources unchanged.
- [x] 4.2 **GREEN** — implement integration harness skip without Docker unless `ATHLOS_REQUIRE_DOCKER=1`; CI sets it to `1`, installs Bats/ShellCheck, and adds a Docker integration job without changing existing PostgreSQL services.
- [x] 4.3 **TRIANGULATE** — assert finite deadline/bound, no next attempt before prior absence, final baseline equality, observability identity, and explicit no-prune transcript.
- [x] 4.4 **REFACTOR** — stabilize cleanup fixtures. Evidence: `bats scripts/tests/disposable-postgres.integration.bats`, `actionlint .github/workflows/test.yml`, and `pnpm test:run` pass; rollback integration/CI only.
