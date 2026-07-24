# Design: Athlos Deploy Server Connectivity PR2 Recovery

## Technical Approach

This recovery change picks up the blocked PR2 slice at the exact repository-only scope: workflow hardening, proof artifacts, and operator guidance. We do not change PR1 request-client behavior. The design for PR2 is to complete protected deploy control and documentation in `.github` workflows and docs, then validate with static + Bats coverage.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope for recovery | PR2 slice only | Maintains continuity with PR1 completion and avoids retrying runtime tasks already satisfied. |
| Workflow verification | Static contract test file (`scripts/tests/deploy-workflow.test.bats`) + actionlint | Gives deterministic, repository-only proof of deploy-gate structure without live services. |
| Recovery ordering | `deploy.yml` + `test.yml` before docs updates | Prevents documentation drifting from actual enforced workflow behavior. |

## Data Flow

`main` push → publish job → protected deploy job (approval required) → ephemeral `tag:ci` Tailnet join → temporary restricted SSH material → `request.sh preflight` → `request.sh deploy` with the immutable image handoff.

## File Changes

| File | Action | Description |
|---|---|---|
| `.github/workflows/deploy.yml` | Modify | Complete publish/deploy segmentation, protected environment behavior, and fail-closed validation boundaries. |
| `.github/workflows/test.yml` | Modify | Wire in new workflow contract Bats + existing shellcheck/actionlint checks. |
| `scripts/tests/deploy-workflow.test.bats` | Add | RED/static checks for workflow contract constraints and safety properties. |
| `docs/runbook.md` | Modify | Recover operator setup/validation checklist and explicit non-live boundaries. |
| `.env.example` | Modify | Update deploy prerequisite variables and rollback expectations for PR2 scope only. |

## Interfaces / Contracts

No new interfaces are introduced in code. We rely on the existing deploy request contract from PR1 and constrain enforcement only in workflow structure and docs.

```text
workflow_contract:
  publish job -> publish artifacts
  deploy job -> protected by production environment
  deploy job -> passes PR2 preflight preconditions before remote command intent
  preflight failure -> no mutation path
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Static | Workflow structure | actionlint, shellcheck, workflow-level YAML assertions |
| Unit-like | Bats contracts | `scripts/tests/deploy-workflow.test.bats` validates job names, needs, environment, and fail-closed rules |
| Runtime harness | Repository-only checks | No live commands run; future approved workflow runs use real restricted preflight before deploy |

## Threat Matrix

| Boundary | Applicable | Safe/failure behavior | Planned RED proof |
|---|---|---|---|
| Documentation-like paths | N/A | no executable classification | — |
| Git repository selection | N/A | no Git selector mutation | — |
| Commit state | N/A | no commit operation | — |
| Push state | N/A | no Git push | — |
| PR commands | N/A | no PR automation change | — |
| SSH process/remote command | N/A | existing PR1 client/SSH contract retained; PR2 only confirms workflow path requires prerequisite checks before mutation intent | PR2 runtime not exercised against live endpoints; only static contract checks are used |

## Migration / Rollout

Start from clean `origin/main` at `c1f2ab70c1dfc4010f0c1519e06c0bb472714e29` (PR1 merged state) and merge PR2 recovery only. No data migration, topology migration, or application rollback behavior is introduced in this change.

## Maintainer-Approved Scope Correction

The workflow has no inline SSH action, Compose command, readiness probe, or rollback sequence. `scripts/deploy/request.sh` is the only remote boundary. Application readiness verification and automatic image rollback remain separate work.

## Open Questions

- None.
