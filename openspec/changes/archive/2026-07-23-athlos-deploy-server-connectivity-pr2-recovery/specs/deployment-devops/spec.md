# Delta for Deployment/DevOps

## MODIFIED Requirements

### Requirement: CI/CD Pipeline

The system SHALL build and publish on `main`, but MUST deploy only from a protected job after Environment approval. The deploy job MUST join the Tailnet as ephemeral `tag:ci`, use an ACL limited to that target, and use a restricted SSH credential for `vlongo@100.78.95.34:2244`. It MUST validate approval, Tailnet identity and ACL, host key, credential, port, and administrator prerequisites before mutation; failures MUST be named and fail closed. Logs and artifacts MUST NOT reveal secret values. Repository and administrator prerequisites MUST be documented. Deployment MUST begin with connectivity and read-only preflight using an immutable image input. Compose topology, readiness semantics, and application rollback correctness remain out of scope; stale assumptions MUST NOT be used. Rollback for this change means reverting repository workflow/configuration/documentation only.

(Previously: every `main` push deployed through secret-host SSH and claimed readiness-based automatic image rollback.)

#### Scenario: Workflow file is `deploy.yml`
- GIVEN GitHub Actions is used
- WHEN `deploy.yml` is inspected
- THEN it SHALL sequence lint, test, build, push, and protected deploy; a stage failure MUST stop it

#### Scenario: Image publication
- GIVEN a commit is pushed to `main`
- WHEN build completes
- THEN it SHALL publish `ghcr.io/victor0451/athlos-api` using `GITHUB_TOKEN`, without deploying before approval

#### Scenario: Main-only trigger
- GIVEN a branch push
- WHEN the workflow is evaluated
- THEN it SHALL run only for `main`; other branches MUST NOT trigger it

#### Scenario: Registry organization
- GIVEN SHA `abc1234` is built
- WHEN publication completes
- THEN tags SHALL use `ghcr.io/victor0451/athlos-api`, never another organization

#### Scenario: Image tag set
- GIVEN a `main` build
- WHEN metadata is produced
- THEN `latest` and `main-<short-sha>` MUST exist; a matching release MAY add `vX.Y.Z`

#### Scenario: Protected approval gate
- GIVEN build and publish succeeded
- WHEN approval is absent, rejected, expired, or invalid
- THEN the deploy job MUST perform no Tailnet, SSH, or remote mutation

#### Scenario: Tailnet least privilege
- GIVEN protected approval is valid
- WHEN the GitHub-hosted deploy job starts
- THEN it MUST join as ephemeral `tag:ci` and reach the ACL-authorized target

#### Scenario: Pinned restricted SSH
- GIVEN Tailnet preflight passed
- WHEN SSH is invoked with immutable image input
- THEN it MUST verify the pinned host key and use a dedicated restricted key only for `vlongo@100.78.95.34:2244`

#### Scenario: Failed connectivity prerequisite
- GIVEN any identity, ACL, host key, key, port, or administrator prerequisite is missing or invalid
- WHEN preflight runs
- THEN it MUST emit a corrective diagnostic and stop before remote mutation

#### Scenario: Read-only preflight
- GIVEN every prerequisite is valid
- WHEN deployment is considered
- THEN connectivity and read-only preflight MUST precede the forced deployment command

#### Scenario: Secret-safe evidence
- GIVEN workflow diagnostics or artifacts are produced
- WHEN credentials or configuration are processed
- THEN secret values MUST NOT be logged, emitted, or retained in artifacts

#### Scenario: Responsibility audit
- GIVEN setup is reviewed
- WHEN repository and administrator responsibilities are compared
- THEN each prerequisite, owner, and validation evidence MUST be explicit and auditable

#### Scenario: Readiness and rollback boundary
- GIVEN mutation completes or fails
- WHEN readiness or rollback is evaluated
- THEN the workflow MUST NOT rely on stale compose/readiness assumptions or claim application rollback correctness

#### Scenario: Change rollback
- GIVEN this change must be withdrawn
- WHEN rollback is executed
- THEN operators MUST revert workflow, configuration, and documentation, not represent application rollback as solved

#### Scenario: Deployment concurrency
- GIVEN two `main` runs overlap
- WHEN the later run reaches deployment
- THEN it SHALL queue behind the first and MUST NOT cancel it mid-deploy

#### Scenario: Destructive-migration gate and labeler
- GIVEN a PR changes migrations or schema
- WHEN destructive-check and labeler workflows run
- THEN they SHALL retain their existing label, backup/override, and failure behavior
