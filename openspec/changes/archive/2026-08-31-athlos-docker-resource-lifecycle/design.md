# Design: Athlos Docker Resource Lifecycle

## Technical Approach

Create one Bash lifecycle boundary using direct Docker, an explicitly named volume, label-scoped inspection, dynamic loopback ports, and awaited teardown. Persistent Compose/deployment resources, GitHub-managed services, and unlabeled resources remain outside its selectors.

## Architecture Decisions

| Decision          | Choice and rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine            | Direct Docker, not Compose: one service needs exact ownership without persistent Compose coupling.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Storage/network   | Explicit `athlos-dp-pgdata-<run>`; never anonymous discovery. No custom network: the host-side consumer uses a Docker-assigned `127.0.0.1` port. Add one only for a future containerized peer.                                                                                                                                                                                                                                                                                                       |
| Identity          | Stable owner is `athlos`; run format is `<epoch>-<pid>-<16-lower-hex>`. Names derive from the run. Required labels on container and volume are `com.athlos.repository=athlos`, `com.athlos.lifecycle=disposable-postgres`, `com.athlos.run=<run>`, `com.athlos.caller=<validated-slug>`, `com.athlos.created-at=<epoch>`, `com.athlos.owner-machine=<sha256(machine-id)>`, `com.athlos.owner-boot=<sha256(boot-id)>`, `com.athlos.owner-pid=<pid>`, and `com.athlos.owner-start=<proc-start-ticks>`. |
| Staleness         | Recover only repository+lifecycle matches older than six hours whose same-machine owner is provably dead: same boot with absent/mismatched PID start, or different boot. Missing/malformed evidence, foreign machine, unreadable `/proc`, or live match is uncertain and untouched.                                                                                                                                                                                                                  |
| Signals/crashes   | EXIT performs teardown; INT/TERM retain 130/143, disable recursive traps, await cleanup, then exit. SIGKILL/parent crash waits for later stale recovery.                                                                                                                                                                                                                                                                                                                                             |
| Retry/concurrency | Recover before creation; await attempt N teardown before N+1. Unique names plus `-p 127.0.0.1::5432` and port inspection prevent collisions/adoption.                                                                                                                                                                                                                                                                                                                                                |
| Invocation        | Resolve root from `BASH_SOURCE`. Preserve argv with arrays and `"$@"`; pnpm uses `--` for unchanged focused Vitest arguments.                                                                                                                                                                                                                                                                                                                                                                        |

## Data Flow

```text
resolve root -> validate Docker -> classify/recover stale sets -> allocate identity
 -> create labeled volume -> run labeled container -> inspect port -> pg_isready poll
 -> consumer(argv unchanged) -> rm container -> rm volume -> verify absence -> exit
```

Readiness is bounded to 60 seconds. All post-identity failures use idempotent teardown: container, volume, optional network, then scoped absence verification; absent members succeed.

## Components and Requirement Traceability

| Requirement                      | Component                    | RED proof                                                                                                                               |
| -------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership; volume; boundary      | lifecycle script             | Fake-Docker Bats asserts names, labels, named mount, complete selectors, exclusions, and no prune.                                      |
| Teardown; partial start; signals | lifecycle state/traps        | Inject failure per step; repeat cleanup; assert INT/TERM status and command order.                                                      |
| Recovery/retry/concurrency       | classifier/coordinator       | Clock/`proc` fixtures cover live, dead, rebooted, malformed, foreign, age boundary; assert retry ordering.                              |
| Observable evidence              | NDJSON on stderr             | Assert `identity`, `created`, `stale-decision`, `teardown`, `absence` contain run/resource/outcome, never credentials/global inventory. |
| Root/argument forwarding         | wrapper plus package scripts | Invoke from non-root cwd with a spaced focused selector and capture exact Vitest argv.                                                  |
| Resource neutrality              | Docker integration Bats      | Snapshot complete label-scoped inventory before/after success, failure, timeout, crash recovery, and concurrent-owner cases.            |

## File Changes

| File                                                 | Action                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/disposable-postgres.sh`                 | Create lifecycle API (`run --caller SLUG -- COMMAND [ARG...]`) and recovery primitives.                       |
| `scripts/tests/disposable-postgres.test.bats`        | Create deterministic fake-Docker RED/unit suite.                                                              |
| `scripts/tests/disposable-postgres.integration.bats` | Create bounded real-Docker resource-neutral suite.                                                            |
| `scripts/recovery/rehearse-postgres16.sh`            | Route rehearsal through the lifecycle; remove fixed port/ad-hoc trap.                                         |
| `package.json`, `packages/db/package.json`           | Add canonical scripts with exact pnpm/Vitest forwarding.                                                      |
| `.github/workflows/test.yml`                         | Run shellcheck/unit tests and a Docker-required integration job. Existing PostgreSQL services stay unchanged. |

Integration skips explicitly without Docker unless `ATHLOS_REQUIRE_DOCKER=1`; CI sets `1` and fails unavailable. Unit tests never run Docker.

## Threat Matrix

| Boundary                 | Applicability                                            |
| ------------------------ | -------------------------------------------------------- |
| Documentation-like paths | N/A: no executable classification.                       |
| Git repository selection | N/A: root derives from script location; no Git selector. |
| Commit state             | N/A: no VCS mutation.                                    |
| Push state               | N/A: no push operation.                                  |
| PR commands              | N/A: no PR automation.                                   |

## Migration, Rollback, and Review Slices

No data migration or legacy-volume adoption. Keep each slice below 400 authored lines: (1) lifecycle/fake-Docker tests, (2) rehearsal/package routing/forwarding, (3) stale/signal/retry resilience, (4) real-Docker CI proof. Tests stay with behavior. Rollback reverts routing and lifecycle files together, runs no cleanup, and never touches persistent/beta resources.

## Open Questions

None.
