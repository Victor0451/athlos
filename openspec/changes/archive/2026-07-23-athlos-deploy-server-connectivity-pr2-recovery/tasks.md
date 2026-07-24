# Tasks: Athlos Deploy Server Connectivity PR2 Recovery

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 240–340 authored lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| PR2 Recovery | complete protected pipeline and operator guidance slice | PR 1 (single PR) | `bats scripts/tests/deploy-workflow.test.bats && actionlint .github/workflows/{deploy,test}.yml` | mocked repository-only assertions only; no live GitHub/Tailnet/SSH/server calls | `.github/workflows/{deploy,test}.yml`, `scripts/tests/deploy-workflow.test.bats`, `docs/runbook.md`, `.env.example` |

## Phase 2: RED Safety Contracts

- [x] 2.1 Add `scripts/tests/deploy-workflow.test.bats` with static checks for main-only trigger, production environment gate, `needs`, digest handoff expectations, fixed SSH target metadata, and fail-closed behavior.

## Phase 3: GREEN Repository Implementation

- [x] 3.3 Implement PR2 workflow hardening in `.github/workflows/deploy.yml`: publish/deploy split, approval gate ordering, ephemeral Tailnet join, temporary pinned SSH material, immutable flow constraints, and real restricted preflight before deploy.
- [x] 3.4 Update `.github/workflows/test.yml` to run the new deploy-workflow Bats test, shellcheck, and pinned actionlint while preserving existing behavior.

## Phase 4: Documentation and Proof

- [x] 4.1 Refresh `docs/runbook.md` and `.env.example` with connectivity-only operator guidance, secret-file handling, and explicit non-live boundaries for PR2.
- [x] 4.2 Run `actionlint .github/workflows/{deploy,test}.yml`, `bats scripts/tests/deploy-workflow.test.bats`, and relevant `shellcheck` checks; record outputs and confirm no live deployment connectivity was executed.

## Maintainer-Approved Scope Correction

- [x] Remove the inline SSH/Compose/readiness/rollback path and use only `request.sh preflight` then `request.sh deploy`.
- [x] Do not implement or claim application readiness verification or automatic image rollback in PR2.
