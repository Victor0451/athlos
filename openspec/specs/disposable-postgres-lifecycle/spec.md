# Disposable PostgreSQL Lifecycle Specification

## Purpose

Define safe, observable ownership, teardown, and recovery for repository-supported disposable PostgreSQL resources.

## Requirements

### Requirement: Deterministic Isolated Ownership

Each invocation MUST deterministically resolve a stable repository owner identity and assign one immutable, unique run identity before resource creation. Every owned container, volume, and optional network MUST have deterministic names from that identity and labels for repository owner, lifecycle class, run identity, and creation/recovery metadata.

#### Scenario: Owned resource creation

- GIVEN a supported disposable PostgreSQL invocation
- WHEN its resources are created
- THEN every resource MUST expose all required labels and its name MUST identify the same run
- AND another concurrent invocation MUST receive a distinct run identity and resource set

### Requirement: Explicit Disposable Volume Ownership

Supported paths MUST create explicitly owned disposable storage for PostgreSQL data and MUST NOT rely on an untracked anonymous `PGDATA` volume.

#### Scenario: PostgreSQL data storage is provisioned

- GIVEN a disposable PostgreSQL run
- WHEN PostgreSQL storage is created
- THEN the volume MUST be attributable to the run by identity and labels
- AND teardown evidence MUST identify that volume explicitly

### Requirement: Awaited Idempotent Teardown

The lifecycle MUST await exact teardown of its resource set before returning a terminal result. The same teardown MUST be idempotent after success, failure, timeout, cancellation, SIGINT, or SIGTERM, and MUST preserve the consumer result or signal outcome after cleanup.

#### Scenario: Trappable terminal paths

- GIVEN an owned run reaches success, failure, timeout, cancellation, SIGINT, or SIGTERM
- WHEN terminal handling begins
- THEN teardown MUST remove that run's container, volume, and optional network exactly
- AND no terminal result MUST be returned before teardown completes

#### Scenario: Teardown repeats

- GIVEN some or all resources are already absent
- WHEN teardown is invoked again
- THEN it MUST succeed without creating resources or widening its ownership selector

### Requirement: Partial-Startup Reconciliation

The lifecycle MUST record ownership before dependent startup and MUST reconcile every resource created before a startup or readiness failure.

#### Scenario: Startup fails after partial creation

- GIVEN only part of the owned resource set was created
- WHEN startup or readiness fails
- THEN teardown MUST remove every created member and tolerate every absent member

### Requirement: Conservative Recovery and Retry

Before creating another resource set, a retry or later invocation MUST reconcile matching prior resources. Recovery after SIGKILL or parent crash MUST require repository-owner and lifecycle labels, classify resources conservatively as stale, and MUST protect any active owner.

#### Scenario: Later invocation recovers an abandoned run

- GIVEN a prior labeled run is provably stale after SIGKILL or parent crash
- WHEN a later invocation performs recovery
- THEN it MUST remove only that stale resource set before creating its new set
- AND it MUST emit the classification and cleanup outcome

#### Scenario: Prior ownership is uncertain or active

- GIVEN a matching resource is active or lacks sufficient stale evidence
- WHEN recovery evaluates it
- THEN the resource MUST remain untouched
- AND the new invocation MUST NOT adopt or delete that owner's resources

### Requirement: Strict Cleanup Boundary

Ordinary teardown and recovery MUST NOT remove production, beta, persistent, foreign-owner, or unlabeled resources. They MUST NOT run an unscoped global prune.

#### Scenario: Mixed Docker resources exist

- GIVEN disposable resources coexist with excluded resources
- WHEN teardown or stale recovery runs
- THEN only resources matching the complete authorized ownership boundary MAY be removed
- AND production, beta, persistent, foreign-owner, and unlabeled resources MUST remain unchanged

### Requirement: Observable Lifecycle Evidence

Each lifecycle run MUST expose bounded evidence of identity, resource creation, stale decisions, teardown attempts, and final resource absence without claiming ownership of unrelated Docker state.

#### Scenario: Cleanup completes

- GIVEN lifecycle processing has finished
- WHEN evidence is inspected
- THEN it MUST correlate actions to owner and run identity
- AND it MUST show whether each owned resource was removed or already absent
