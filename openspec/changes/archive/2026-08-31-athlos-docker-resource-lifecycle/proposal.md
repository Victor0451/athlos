# Proposal: Athlos Docker Resource Lifecycle

## Intent

Correct the root-class defect in disposable PostgreSQL ownership and teardown. Seven anonymous `PGDATA` volume leaks are proven: five from `athlos-recovery-test` and two from `athlos-candidate-timeout`. Those launches omitted `--rm`, and `docker rm -f` left volumes behind. This evidence proves only these seven leaks; it does not attribute the machine's broader Docker storage to Athlos.

## User and Operator Value

Developers and CI operators gain repeatable retries, cancellation, and recovery without accumulating Athlos-owned disposable resources or risking persistent data.

## Scope

### In Scope

- Establish one repository-owned, direct-Docker disposable PostgreSQL lifecycle.
- Apply stable lifecycle/owner labels and unique per-run identity to every owned resource.
- Await idempotent teardown on success, failure, timeout, SIGINT, and SIGTERM; explicitly remove owned volumes.
- Recover stale labeled resources on a later invocation after SIGKILL or host failure, without crossing owner boundaries.
- Route supported recovery, test, and CI callers through the lifecycle; correct repository-root resolution and implicated Vitest argument forwarding.
- Add resource-neutral proof for teardown, retries, concurrency, stale recovery, and safety exclusions.

### Out of Scope

- Global prune, broad storage attribution, or cleanup of unlabeled resources.
- Production/beta Compose resources, operator-created data, or unrelated Docker usage.
- Cleanup after untrappable failure without a later lifecycle invocation.

## Capabilities

### New Capabilities

- `disposable-postgres-lifecycle`: Owner-isolated creation, readiness, teardown, and stale recovery for disposable PostgreSQL resources.

### Modified Capabilities

- `testing-setup`: Disposable PostgreSQL test execution must be resource-neutral and preserve focused Vitest invocation.

## Approach and Responsibility Boundary

Repository code owns canonical identity, labels, root resolution, lifecycle operations, caller integration, and safety tests. Agents/runtimes must use that lifecycle, validate cwd/argument forwarding before retries, report bounded evidence, and never prune globally. Implementation details such as volume form, network use, and stale classification remain design decisions, but selectors must require repository ownership plus lifecycle class and preserve active owner isolation.

## Affected Areas

| Area                                                 | Impact                        |
| ---------------------------------------------------- | ----------------------------- |
| `scripts/recovery/`                                  | Use canonical lifecycle       |
| Root and `packages/db/` package scripts/test helpers | Route and forward correctly   |
| `.github/workflows/test.yml`                         | Exercise bounded lifecycle    |
| Lifecycle integration tests                          | Add resource-neutral evidence |
| `docker-compose*.yml`, deployment gates              | Explicitly unchanged          |

## Risks and Mitigations

- Incorrect selectors or stale policy could remove active resources; require combined labels, conservative classification, and cross-owner tests.
- Signal/Docker behavior varies by environment; keep teardown bounded, idempotent, and observable.
- Scope may exceed the 400-line review budget; tasks should preserve the four exploration slices and ask before apply if chaining is warranted.

## Rollback

Revert caller routing and lifecycle artifacts together, restoring prior commands without running cleanup against existing resources. Persistent and unlabeled resources remain untouched throughout rollback.

## Success Criteria

- [ ] Normal, failure, partial-startup, timeout, and cancellation paths await teardown and leave zero net labeled resources.
- [ ] A later run recovers only stale matching resources after untrappable failure.
- [ ] Concurrent owners cannot remove each other's resources.
- [ ] Persistent, Compose-managed, foreign-owner, and unlabeled resources are never removed.
- [ ] No global prune operation is introduced.
