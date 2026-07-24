# Apply Progress: Athlos Deploy Server Connectivity PR2 Recovery

## Runtime Binding

- Change ID: `athlos-deploy-server-connectivity-pr2-recovery`
- Candidate base: `origin/main` commit `c1f2ab70c1dfc4010f0c1519e06c0bb472714e29`
- Work unit: PR2 recovery (tasks 2.1, 3.3, 3.4, 4.1, 4.2)
- Runtime state: repository-only proof execution only; no live deploy, SSH, Tailnet, secret, or server lifecycle actions were run.

## PR1 Progress Imported

- PR1 is fully completed in the predecessor change `athlos-deploy-server-connectivity` and must **not** be re-executed in this recovery change:
  - [x] 2.2 Add `scripts/tests/deploy-request.test.bats` RED contract cases
  - [x] 2.3 Add preflight ordering and secret-redaction RED cases
  - [x] 3.1 Create `scripts/deploy/request.sh`
  - [x] 3.2 Update `docker-compose.yml` image variable handling

## Completed Tasks

- [x] 2.2 (from prior completed PR1 work)
- [x] 2.3 (from prior completed PR1 work)
- [x] 3.1 (from prior completed PR1 work)
- [x] 3.2 (from prior completed PR1 work)
- [x] 2.1 (PR2 contract test added)
- [x] 3.3 (PR2 deploy workflow hardening in `deploy.yml`)
- [x] 3.4 (PR2 workflow test/lint/ actionlint hooks in `test.yml`)
- [x] 4.1 (PR2 operator guidance updates in `docs/runbook.md` and `.env.example`)

## Remaining Work

- [x] 4.2 Run repository-only proof commands and record outputs

## Latest Proof Evidence

- `pnpm exec shellcheck scripts/deploy/request.sh scripts/tests/deploy-workflow.test.bats`
  - Exit code: 0
- `bats scripts/tests/deploy-workflow.test.bats`
  - Exit code: 0
- `bats scripts/tests/deploy-workflow.test.bats` (continuation fixes)
  - Added assertions for `latest` + `main-<short-sha>` tags and `tag:ci` pre-join marker
  - Exit code: 0
- `curl -sSL "https://github.com/rhysd/actionlint/releases/download/v1.7.5/actionlint_1.7.5_linux_amd64.tar.gz" -o /tmp/actionlint.tar.gz && tar -xzf /tmp/actionlint.tar.gz -C /tmp/actionlint actionlint && /tmp/actionlint/actionlint .github/workflows/deploy.yml .github/workflows/test.yml`
  - Exit code: 0
- `pnpm exec shellcheck scripts/tests/deploy-workflow.test.bats`
  - Exit code: 0

### TDD Cycle Evidence (Current Continuation)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `scripts/tests/deploy-workflow.test.bats` | Unit-like (static workflow contract) | ✅ 7/7 | ✅ Written | ✅ Passed | ➖ Single | ✅ None needed |
| 3.3 | `scripts/tests/deploy-workflow.test.bats` | Unit-like (static workflow contract) | ✅ 7/7 | ✅ Written | ✅ Passed | ➖ Single | ✅ None needed |

## Provenance Note

- The previous change recorded a blocked PR2 execution at `generation 6` due to a native runtime objective mismatch (`SDD runtime objective changed without an explicit reset`). This recovery starts from a clean, auditable basis without carrying forward active runtime state.

## Safety Guardrail

- This change is planning/setup-only for recoverability and does not include any live deployment commands, SSH/Tailnet calls, GitHub secret updates, commits, pushes, PR operations, or server lifecycle changes.

## TDD / Runtime Evidence (Current)

Implementation is completed for PR2 repository-only scope. Proof runbook commands were executed with no live deployment, SSH, Tailnet, secret, or server operations.

## Risks and Deviations

- No deviations from the scoped PR2 objective.

## Maintainer-Approved Scope Correction (2026-07-24)

- Superseding implementation scope: PR2 is connectivity-only. The workflow joins as ephemeral `tag:ci`, safely materializes the restricted key and pinned known-host file in the runner, invokes real `request.sh preflight`, then invokes `request.sh deploy` with the canonical immutable image and fixed target contract.
- Removed stale inline `appleboy` SSH, Compose, `/health/ready`, previous-tag, and automatic rollback behavior.
- Prior proof records above remain historical evidence for the earlier candidate and are not evidence of application readiness verification or automatic image rollback.
