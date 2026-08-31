# Exploration: Docker Resource Lifecycle for Athlos

## Problem Statement and Evidence Boundary

Seven anonymous `PGDATA` volume leaks are proven from external OpenCode retries:

- Five from `athlos-recovery-test`
- Two from `athlos-candidate-timeout`

All seven launches omitted `--rm`. Their cleanup used `docker rm -f` without `-v`, which removes containers but leaves anonymous volumes. Wrong working directories and ineffective Vitest argument forwarding also produced misleading failures and retries.

This establishes a disposable-test lifecycle defect, not a global Docker-storage attribution. Athlos cannot be attributed all 437 Docker volumes or 28 GB of snapshots. Persistent production and beta resources are explicitly out of scope.

## Current-State Lifecycle Inventory

| Surface                                         | Observed lifecycle behavior                                     | Gap                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scripts/recovery/rehearse-postgres16.sh`       | Uses `docker run --rm`                                          | No labels, durable owner identity, concurrency isolation, stale-resource recovery, or crash recovery |
| Test/recovery retry paths                       | Seven observed runs omitted `--rm`; cleanup used `docker rm -f` | Anonymous `PGDATA` volumes survive                                                                   |
| `package.json` and `packages/db/package.json`   | Known command entry points                                      | Must identify and route disposable PostgreSQL invocation consistently                                |
| `.github/workflows/test.yml`                    | Known CI test surface                                           | Must use the same bounded lifecycle and avoid accumulating resources                                 |
| `docker-compose.yml`, `docker-compose.beta.yml` | Persistent deployment surfaces                                  | Must not be swept by disposable-test cleanup                                                         |
| `scripts/deploy/server-gate.sh`                 | Deployment gate surface                                         | Must remain excluded from test-resource recovery                                                     |

No canonical local disposable-Postgres lifecycle currently exists.

## Root-Class Analysis

The root class is **container-centric cleanup for a workload that owns disposable volumes**.

Container deletion is not sufficient when Docker creates anonymous volumes. Retry failures amplify the leak because each retry can launch another resource set. The contributing failures are separate but related:

1. **Missing lifecycle ownership contract** — no canonical owner identity defines what Athlos may remove.
2. **Incomplete teardown semantics** — teardown removes containers but not their anonymous volumes.
3. **No concurrency isolation** — parallel runs can collide or make cleanup unsafe.
4. **No recovery protocol** — SIGKILL and host/process crashes bypass shell traps.
5. **Invocation defects** — wrong cwd and broken Vitest argument forwarding create false failures and unnecessary retries.

This should be fixed once at the lifecycle boundary, rather than adding cleanup patches to individual recovery or timeout scenarios.

## Alternatives

| Approach                                                  | Benefits                                                                                                        | Costs / risks                                                                                                         | Assessment                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Direct Docker lifecycle wrapper                           | Explicit container, network, and volume identity; straightforward labels; easy per-run naming; precise teardown | Requires a small shell lifecycle abstraction                                                                          | Recommended                                                        |
| Compose project per disposable run                        | Compose provides grouping and `down -v`; familiar for multi-service stacks                                      | Project-name isolation and safe stale recovery must still be designed; risks overlap with persistent Compose surfaces | Viable only if disposable topology becomes genuinely multi-service |
| Continue ad hoc `docker run` commands with improved flags | Small apparent change                                                                                           | Repeats lifecycle logic, misses future callers, no durable recovery protocol                                          | Reject                                                             |
| Global Docker prune / broad volume deletion               | Can reclaim unrelated storage                                                                                   | Unsafe; cannot distinguish Athlos-owned test data from production, beta, or other projects                            | Explicitly reject                                                  |

## Recommended Architecture

Introduce one repository-owned **disposable PostgreSQL lifecycle wrapper** and make all local/CI test and rehearsal callers use it.

The wrapper should use direct Docker and expose lifecycle operations conceptually equivalent to:

- create/start a uniquely identified disposable PostgreSQL resource set;
- wait for readiness;
- return only the connection details required by the caller;
- teardown the exact owned resource set;
- recover stale resources that prove they belong to the same disposable lifecycle class.

Direct Docker is preferred because this problem is fundamentally resource identity and teardown precision. It avoids coupling the disposable test lifecycle to `docker-compose.yml` or `docker-compose.beta.yml`, whose resources are persistent and excluded.

## Ownership, Labels, Identity, and Teardown

Every disposable resource must carry stable, queryable ownership metadata:

- lifecycle class, such as `athlos.lifecycle=disposable-postgres`;
- repository/application identity, such as `athlos.owner=athlos`;
- a generated per-run identifier;
- optional caller/scenario identity, such as recovery rehearsal or candidate timeout;
- creation timestamp or equivalent recovery metadata.

The per-run identifier must be included in every resource name and label. A run may remove only resources matching both the disposable lifecycle class and its own run identity during ordinary teardown.

Teardown semantics:

| Exit path                    | Required action                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Successful test/rehearsal    | Remove the owned container and its owned anonymous/named disposable volumes                       |
| Test failure / startup error | Run the same idempotent teardown                                                                  |
| Partial startup              | Record enough identity before starting dependent work, then tear down any created owned resources |
| SIGINT / SIGTERM             | Trap signals, preserve the original exit status where possible, and run bounded teardown          |
| SIGKILL / host crash         | Cannot be trapped; the next lifecycle invocation performs label-scoped stale recovery             |
| Repeated teardown            | Must be safe when resources are already absent                                                    |

`docker rm -f` alone is insufficient. The implementation must explicitly remove owned volumes or use Docker operations that prove their removal, without deleting resources outside the ownership boundary.

## Retries, Concurrency, and Crash Recovery

- Each retry receives a new run identifier; it must never adopt or remove another active run's resources.
- Parallel test processes must have unique container, network, and volume names derived from their run identifiers.
- A failed readiness check must invoke teardown before retrying.
- SIGINT and SIGTERM must use shell-level cleanup traps.
- SIGKILL recovery is deferred: a subsequent invocation lists only resources bearing the disposable lifecycle labels and removes only resources classified as stale by the defined policy.
- Stale recovery must not target unlabeled volumes, Compose resources, production/beta resources, or another currently active owner.
- The wrapper must run commands from a resolved repository root, not from an assumed caller cwd.
- Test command forwarding must be validated so scenario selectors reach Vitest rather than silently producing unrelated runs.

## Persistent-Data Exclusions

The following are non-goals and hard safety boundaries:

- no global `docker system prune`, `docker volume prune`, or equivalent broad cleanup;
- no deletion based only on a name prefix without required lifecycle labels;
- no management of `docker-compose.yml` or `docker-compose.beta.yml` persistent resources;
- no deletion of production, beta, operator-created, or unlabeled Docker data;
- no assertion that Athlos owns the broader 437-volume / 28 GB Docker state.

## Resource-Neutral Test Matrix

Tests should prove lifecycle behavior without leaving resources behind. Each test must use distinct owner/run identities and verify postcondition cleanup through label-scoped inspection.

| Scenario                       | Setup                                                                      | Expected evidence                                                              |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Normal success                 | Start disposable PostgreSQL; complete consumer action                      | Container and owned volume(s) absent afterward                                 |
| Consumer failure               | Force test/rehearsal failure after startup                                 | Teardown runs; owned resources absent                                          |
| Partial startup                | Fail readiness or startup after resource creation                          | Created owned resources absent                                                 |
| Recovery rehearsal             | Run the PostgreSQL 16 rehearsal path                                       | Uses canonical lifecycle; no owned resources remain                            |
| Candidate-timeout reproduction | Reproduce the timeout path that previously created two leaks               | Retry/timeout cleanup removes owned volume(s); no net labeled resources remain |
| Retry isolation                | Run repeated failed attempts                                               | Each run cleans its own resources; no accumulation                             |
| Concurrent owners              | Run two lifecycle instances with different run IDs                         | One owner cannot remove the other's active resources                           |
| SIGINT / SIGTERM               | Interrupt an active run                                                    | Trapped teardown removes only interrupted run resources                        |
| SIGKILL recovery               | Leave a labeled disposable resource by simulating untrappable termination  | Next invocation recovers only stale matching resources                         |
| Cross-owner safety             | Create labeled resources for another run and persistent/unlabeled fixtures | Current teardown and stale recovery leave them untouched                       |
| Cwd and argument forwarding    | Invoke from a non-root cwd and pass a focused Vitest selector              | Root resolution works; selector reaches the intended test command              |

## Repository Versus Agent/Runtime Responsibility

**Repository responsibility**

- Define and maintain the canonical disposable-Postgres lifecycle.
- Ensure scripts resolve the repository root.
- Ensure package scripts forward test arguments correctly.
- Label, isolate, and remove only repository-owned disposable resources.
- Provide tests for teardown, recovery, concurrency, and safety boundaries.

**Agent/runtime responsibility**

- Avoid retrying misleading failures without checking cwd and actual argument forwarding.
- Avoid launching ad hoc Docker resources outside the repository lifecycle.
- Report observed resource evidence accurately.
- Do not use global prune as remediation.

The repository can prevent future lifecycle leaks from its supported paths; it cannot retrospectively attribute or safely delete all Docker resources on a machine.

## Scope

- Establish one direct-Docker disposable PostgreSQL lifecycle abstraction.
- Route recovery/test callers through it.
- Add ownership labels, per-run identity, explicit volume teardown, and stale recovery.
- Correct repository-root handling and Vitest argument forwarding where implicated.
- Add resource-neutral lifecycle tests and CI coverage.

## Non-Goals

- Docker-wide cleanup or storage accounting.
- Changes to persistent production or beta Docker Compose deployments.
- Replacing all Docker usage in the repository.
- Guaranteeing cleanup after SIGKILL without a later recovery invocation.
- Claiming ownership of existing unlabeled Docker resources.

## Risks

- Incorrect label selectors could remove another active disposable run; cross-owner tests are mandatory.
- Aggressive stale-age policy could race with slow CI or local runs; stale classification needs a conservative, documented rule.
- Named-volume adoption may affect existing scripts; migration must preserve connection behavior.
- Shell signal handling differs across local shells and CI runners; SIGINT/SIGTERM tests must be bounded and reliable.
- Docker availability and permission differences can make lifecycle tests environment-sensitive.

## Open Questions

1. Which exact package scripts and test helpers currently launch PostgreSQL outside `rehearse-postgres16.sh`?
2. Does the disposable lifecycle need an isolated Docker network today, or only container/volume identity?
3. What conservative stale threshold and active-owner signal can distinguish abandoned resources from slow valid runs?
4. Which CI environment permits Docker integration coverage, and what fallback applies where Docker is unavailable?
5. Should the wrapper use anonymous volumes with explicit discovered removal, or explicitly named per-run disposable volumes for simpler ownership proof?

## Proposed Review Slices

1. **Lifecycle foundation** — repository-root resolution, generated run identity, labels, direct Docker create/start/readiness/teardown primitives.
2. **Caller migration** — recovery rehearsal and relevant package/test entry points use the canonical lifecycle; verify Vitest argument forwarding.
3. **Recovery and resilience** — signal traps, partial-startup cleanup, label-scoped stale recovery, retry/concurrency isolation.
4. **Proof and CI** — resource-neutral matrix, candidate-timeout reproduction, cross-owner safety, and CI integration where Docker is available.

## Ready for Proposal

Yes. The proposal should commit to a single root-class fix: a label-scoped, owner-isolated, direct-Docker disposable PostgreSQL lifecycle that explicitly removes its volumes and never targets persistent or unlabeled resources.
