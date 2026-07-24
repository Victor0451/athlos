# Proposal: Athlos Deploy Server Connectivity PR2 Recovery

## Intent

Continue the blocked PR2 slice from `athlos-deploy-server-connectivity` by adding only the remaining deployment-workflow hardening and operator-guidance tasks on a clean recovery change, with no server lifecycle mutations and no live runtime actions.

## Scope

### In Scope
- Add repository-only static contracts for the protected deploy workflow (`scripts/tests/deploy-workflow.test.bats`) and validate them through test workflow wiring.
- Split/adjust `.github/workflows/deploy.yml` into protected publish + deploy flow with immutable input handling, environment gate safety, and failure-closed behavior for PR2 slice.
- Update `.github/workflows/test.yml` to run new workflow contract tests and existing lint/static checks in a non-destructive way.
- Harden operator guidance in `docs/runbook.md` and `.env.example` for approvals, prerequisite ownership, temporary SSH material, and connectivity-only rollback boundaries.

### Out of Scope
- PR1 repository-only client hardening (`scripts/deploy/request.sh`, fake-SSH RED cases, compose image variable work).
- Server-side changes (Tailnet, SSH wrapper, host hardening), provisioning, or any live deployment.
- GitHub secret/configuration edits outside repository-only documentation and workflow review.
- Changes to compose topology, application readiness verification, or automatic image rollback.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `deployment-devops`: continue PR2 protective workflow gating, testability, and operator documentation without changing runtime mutation semantics.

## Approach

Keep the completed PR1 runtime-safe request client untouched. This change only adds the remaining PR2 protected-pipeline and guidance obligations: workflow contract tests, workflow execution hardening, test wiring, and documentation/validation guidance for administrators.

## Responsibilities

- **Repository:** owns static workflow contract checks, deploy workflow structure, test wiring, and runbook alignment.
- **Administrator:** keeps Tailnet/GitHub/process prerequisites preconfigured and verifies them outside this change through documented procedures.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `.github/workflows/deploy.yml` | Modified | Publish/deploy split guardrails and immutable input handling for PR2 slice. |
| `.github/workflows/test.yml` | Modified | Add workflow contract test + static checks. |
| `scripts/tests/deploy-workflow.test.bats` | Add | New RED/static workflow contract coverage. |
| `docs/runbook.md`, `.env.example` | Modified | PR2 operator guidance and responsibility boundaries. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope drift into PR1 or runtime behavior | Low | Keep PR1 files untouched; only PR2-listed tasks are active in this change. |
| Hidden assumptions about live state | Medium | Keep all tests repository-only; the workflow uses the restricted read-only preflight only when an approved future run executes. |

## Maintainer-Approved Scope Correction

PR2 is connectivity-only. It uses the PR1 `request.sh` client as the sole remote boundary: ephemeral `tag:ci` Tailnet join, temporary restricted SSH material with a pinned host key, immutable image handoff, real read-only preflight, then deploy request. It does not implement or claim application readiness verification or automatic image rollback. This correction supersedes stale recovery wording without changing the recorded prior evidence.

## Rollback Plan

Revert only the files in `.github/workflows/{deploy,test}.yml`, `scripts/tests/deploy-workflow.test.bats`, `docs/runbook.md`, and `.env.example`. This reverts the PR2 recovery layer without touching deploy client binaries, compose topology, or server configuration.

## Dependencies

- Clean PR1 base: `origin/main` commit `c1f2ab70c1dfc4010f0c1519e06c0bb472714e29`.
- Existing PR1 changes are present and not reimplemented.

## Success Criteria

- [ ] PR2 workflow contracts are codified in `scripts/tests/deploy-workflow.test.bats`.
- [ ] `.github/workflows/deploy.yml` exposes a protected deploy flow that performs no mutation before approval and named prerequisite checks.
- [ ] `.github/workflows/test.yml` runs contract tests and static checks as part of CI without introducing false positive live dependencies.
- [ ] `docs/runbook.md` and `.env.example` explicitly separate repo and administrator responsibilities, including no-deployment boundaries.
- [ ] No live GitHub runner actions beyond repository configuration/test checks are required to complete recovery planning evidence.
