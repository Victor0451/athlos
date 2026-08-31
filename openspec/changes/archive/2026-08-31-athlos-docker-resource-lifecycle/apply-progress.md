# Apply Progress: Athlos Docker Resource Lifecycle

## Work Unit

- Change: `athlos-docker-resource-lifecycle`
- Slice: PR 1 — Deterministic Fake-Docker Lifecycle
- Delivery: chained PR, `feature-branch-chain`; this child slice targets the feature/tracker branch and does not include PRs 2–4.
- Review budget: 225 authored lines across the two Unit-1 files (`scripts/lib/disposable-postgres.sh`: 102; `scripts/tests/disposable-postgres.test.bats`: 123), below 400.
- Runtime harness: fake Docker only; no Docker daemon was invoked.

## Completed Tasks

- [x] 1.1 RED — added deterministic fake-Docker lifecycle coverage for identity, names, labels, named PGDATA, loopback dynamic port mapping, readiness, and bounded evidence.
- [x] 1.2 GREEN — implemented the direct-Docker root API with Bash arrays, port inspection, readiness polling, and credential-free NDJSON evidence.
- [x] 1.3 TRIANGULATE — covered invalid callers, literal hostile argv, run/readiness failures, owned partial cleanup, and distinct concurrent identities.
- [x] 1.4 REFACTOR — kept labels in one array and partial cleanup in one helper; final Bats and ShellCheck checks pass.

Persisted checkbox updates: `tasks.md` 1.1–1.4 are marked `- [x]`.

## Files Changed

| File                                                                  | Action   | Description                                                                                                                       |
| --------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/disposable-postgres.sh`                                  | Created  | Direct-Docker disposable PostgreSQL lifecycle root API with deterministic injectable fixtures and partial-failure reconciliation. |
| `scripts/tests/disposable-postgres.test.bats`                         | Created  | Fake-Docker Bats suite that records argv safely and validates lifecycle behavior without Docker.                                  |
| `openspec/changes/athlos-docker-resource-lifecycle/tasks.md`          | Modified | Marked tasks 1.1–1.4 complete.                                                                                                    |
| `openspec/changes/athlos-docker-resource-lifecycle/apply-progress.md` | Created  | Cumulative PR-1 evidence.                                                                                                         |

## TDD Cycle Evidence

| Task | Layer                 | Safety Net                     | RED                                                                                                                                        | GREEN                                                                                                                   | TRIANGULATE                                                                                             | REFACTOR                                                                                                          |
| ---- | --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1.1  | Fake-Docker Bats unit | N/A (new files)                | `bats scripts/tests/disposable-postgres.test.bats` failed as expected with exit 127 before the library existed.                            | N/A — RED task                                                                                                          | Label, name, mount, port, and NDJSON assertions expanded to all required labels.                        | N/A — test-first task.                                                                                            |
| 1.2  | Fake-Docker Bats unit | N/A (new files)                | 1.1 RED was present and failing before library creation.                                                                                   | `bats scripts/tests/disposable-postgres.test.bats` passed: 1/1; `shellcheck scripts/lib/disposable-postgres.sh` passed. | The generalized implementation passed the later failure and concurrency cases.                          | Labels are one Bash array; cleanup is an idempotent helper.                                                       |
| 1.3  | Fake-Docker Bats unit | 1/1 passing after GREEN        | New hostile argv, invalid caller, Docker failure/readiness timeout, and concurrency cases were added before any further production change. | `bats scripts/tests/disposable-postgres.test.bats` passed: 4/4.                                                         | Different inputs exercise validation, argv preservation, partial cleanup, and identity differentiation. | No production edit needed: GREEN implementation already generalized safely.                                       |
| 1.4  | Fake-Docker Bats unit | 4/4 passing before final check | Approval coverage is the existing fake transcript suite.                                                                                   | `bats scripts/tests/disposable-postgres.test.bats` passed: 4/4.                                                         | Existing distinct identity and failure paths retained.                                                  | No additional source change needed: label construction and cleanup were already centralized; `shellcheck` passed. |

## Verification

| Command                                            | Result                                               |
| -------------------------------------------------- | ---------------------------------------------------- |
| `bats scripts/tests/disposable-postgres.test.bats` | PASS — 4/4 tests.                                    |
| `shellcheck scripts/lib/disposable-postgres.sh`    | PASS — exit 0.                                       |
| Real Docker                                        | Not run by design; this is a fake-Docker-only slice. |

## Work Unit Evidence

| Evidence          | Result                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test      | `bats scripts/tests/disposable-postgres.test.bats` — PASS, 4/4.                                                                                                |
| Runtime harness   | Fake Docker only — PASS. No Docker daemon was invoked, per slice constraint.                                                                                   |
| Rollback boundary | Revert only `scripts/lib/disposable-postgres.sh` and `scripts/tests/disposable-postgres.test.bats`; task/progress artifacts describe the same Unit-1 boundary. |

## Deviations and Blockers

- No design deviation within PR 1.
- No blocker. Success-path awaited teardown, signals, stale recovery, caller wiring, and real-Docker neutrality remain intentionally out of scope for PRs 2–4.
- No global prune, inventory query, cross-owner selector, or real Docker command was introduced/run.

## Remaining Tasks at PR 1 Completion

- [ ] 2.1 **RED** — assert container then volume removal, scoped absence verification, idempotent absent members, consumer success/failure/timeout preservation, and owner+run identity in `teardown`/`absence` evidence; assert no `docker system prune`/unscoped remove.
- [ ] 2.2 **GREEN** — await ordered idempotent teardown on EXIT and retain terminal outcomes; route rehearsal through lifecycle, removing fixed port/ad-hoc trap.
- [ ] 2.3 **TRIANGULATE** — invoke wrapper outside root with spaced Vitest selector; assert root derives from `BASH_SOURCE` and argv is byte-for-byte forwarded. Add exact scripts: root `test:disposable-postgres` and `test:disposable-postgres:integration`; db `test:disposable-postgres`, each using `pnpm --` forwarding.
- [ ] 2.4 **REFACTOR** — share wrapper invocation helpers. Evidence: ShellCheck + unit Bats pass; non-root capture passes; rollback routing/scripts only.
- [ ] 3.1 **RED** — fixture INT/TERM (130/143), repeat cleanup, SIGKILL-later-recovery, six-hour boundary, live/dead/rebooted/malformed/foreign-machine/unreadable-proc owners, exclusions (production/beta/persistent/foreign/unlabeled), retry order, and active concurrent owner.
- [ ] 3.2 **GREEN** — add nonrecursive traps; conservative same-machine stale classifier; recover only complete labels and proven-dead owners before creation; await attempt N reconciliation before N+1.
- [ ] 3.3 **TRIANGULATE** — assert stale-decision outcome plus owner/run identity and no adoption/cross-owner deletion or prune.
- [ ] 3.4 **REFACTOR** — isolate classifier/teardown helpers. Evidence: ShellCheck + Bats pass; rollback resilience helpers/tests only.
- [ ] 4.1 **RED** — real-Docker Bats snapshots complete label-scoped inventory before/after success, failure, bounded candidate-timeout/retry, partial start, SIGKILL recovery, and concurrency; assert excluded resources unchanged.
- [ ] 4.2 **GREEN** — implement integration harness skip without Docker unless `ATHLOS_REQUIRE_DOCKER=1`; CI sets it to `1`, installs Bats/ShellCheck, and adds a Docker integration job without changing existing PostgreSQL services.
- [ ] 4.3 **TRIANGULATE** — assert finite deadline/bound, no next attempt before prior absence, final baseline equality, observability identity, and explicit no-prune transcript.
- [ ] 4.4 **REFACTOR** — stabilize cleanup fixtures. Evidence: `bats scripts/tests/disposable-postgres.integration.bats`, `actionlint .github/workflows/test.yml`, and `pnpm test:run` pass; rollback integration/CI only.

## Structured Status Consumed

```yaml
schemaName: spec-driven
changeName: athlos-docker-resource-lifecycle
artifactStore: both
planningHome:
  root: openspec
  changesDir: openspec/changes
changeRoot: openspec/changes/athlos-docker-resource-lifecycle
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: done
  applyProgress: missing-at-start
  verifyReport: missing
  syncReport: missing
taskProgress:
  total: 16
  complete: 8
  remaining: 8
applyState: ready
dependencies:
  apply: ready
  verify: blocked
  sync: blocked
  archive: blocked
actionContext:
  mode: repo-local
  workspaceRoot: .
  allowedEditRoots:
    - scripts/lib/disposable-postgres.sh
    - scripts/tests/disposable-postgres.test.bats
    - openspec/changes/athlos-docker-resource-lifecycle/tasks.md
    - openspec/changes/athlos-docker-resource-lifecycle/apply-progress.md
  warnings:
    - Existing unrelated untracked files under .pi/ and openspec/changes/ were preserved.
nextRecommended: apply PR 3 only after a new runtime attempt is acquired
```

## PR 2 — Awaited Teardown and Caller Wiring

- Delivery: sequential child PR to the feature tracker; validated but uncommitted. No PR number or commit is claimed.
- Review budget: 179 authored lines.
- Completed tasks: 2.1 RED, 2.2 GREEN, 2.3 TRIANGULATE, and 2.4 REFACTOR.
- Changed files:
  - `scripts/lib/disposable-postgres.sh`
  - `scripts/tests/disposable-postgres.test.bats`
  - `scripts/recovery/rehearse-postgres16.sh`
  - `package.json`
  - `packages/db/package.json`

### Per-File Authored-Line Breakdown

| File                                          | Additions | Deletions | Authored total |
| --------------------------------------------- | --------: | --------: | -------------: |
| `package.json`                                |         2 |         0 |              2 |
| `packages/db/package.json`                    |         1 |         0 |              1 |
| `scripts/lib/disposable-postgres.sh`          |        49 |         7 |             56 |
| `scripts/recovery/rehearse-postgres16.sh`     |        16 |        17 |             33 |
| `scripts/tests/disposable-postgres.test.bats` |        81 |         6 |             87 |
| **Total**                                     |   **149** |    **30** |        **179** |

## PR 2 TDD Cycle Evidence

| Task | RED                                                                                                   | GREEN                                                                                                               | TRIANGULATE                                                                                                   | REFACTOR                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | The success/failure teardown test failed because there was no success-path removal or evidence.       | Exact awaited container→volume teardown, scoped absence verification, and status precedence passed.                 | Timeout, absent-member, and cleanup-failure cases passed.                                                     | Exact teardown and evidence handling were centralized without widening selectors.                                             |
| 2.2  | Terminal-path teardown coverage failed before EXIT and consumer cleanup existed.                      | A guarded EXIT trap plus awaited cleanup on startup and consumer paths passed.                                      | Consumer nonzero wins; cleanup failure wins only after a successful consumer; repeated cleanup is idempotent. | Shared guarded teardown prevents destructive double cleanup.                                                                  |
| 2.3  | The package-forwarding test failed with missing script (127), and the non-root root/argv test failed. | Root resolves from `BASH_SOURCE`; bounded endpoint variables are exported; rehearsal and root/db scripts are wired. | A non-root hostile/spaced selector reaches fake pnpm literally; pnpm `--` is preserved.                       | Shared root/argv arrays avoid string evaluation.                                                                              |
| 2.4  | Inherits the failing-to-green safety net from 2.1–2.3.                                                | Inherits the failing-to-green safety net from 2.1–2.3.                                                              | The final 9-case suite covers all new paths.                                                                  | Centralized teardown/root handling was followed by pinned formatting, ShellCheck, and diff-check with no behavior regression. |

## PR 2 Final Evidence

- `shfmt` (pinned): PASS.
- ShellCheck: PASS.
- Bats: PASS — 9/9.
- `bash -n`: PASS.
- JSON parse: PASS.
- Diff-check: PASS.
- Real Docker: not run; no real Docker was used.

## PR 2 Work Unit Evidence

| Evidence          | Result                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test      | Bats — PASS, 9/9.                                                                                                                                                                           |
| Runtime harness   | Fake Docker only — PASS; no real Docker was used.                                                                                                                                           |
| Rollback boundary | Revert only `scripts/lib/disposable-postgres.sh`, `scripts/tests/disposable-postgres.test.bats`, `scripts/recovery/rehearse-postgres16.sh`, `package.json`, and `packages/db/package.json`. |

## PR 3 — Signals, Stale Recovery, and Retry

- Delivery: sequential child PR to the feature tracker; verified from the PR3 worktree and not committed here.
- Baseline remediation: removed PR2 worktree-name coupling; the existing fake-Docker suite was restored to 9/9 before PR3 RED.
- Completed tasks: 3.1 RED, 3.2 GREEN, 3.3 TRIANGULATE, and 3.4 REFACTOR.
- Review budget: 296 authored lines across exactly two paths, within the <=400-line limit.

### PR 3 TDD Cycle Evidence

| Task            | Evidence                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 RED         | Recovery, signal, and fail-closed fixtures failed before resilience implementation. Coverage required INT/TERM, crash residue, complete labels, six-hour boundary and malformed/exclusion cases, plus simultaneous active owners. |
| 3.2 GREEN       | Complete correlated dual-label recovery passed with strict >6h handling, same-machine provably-dead classification, cleanup-failure gating, and recovery-before-create. Focused and full fake-Docker suites were green.           |
| 3.3 TRIANGULATE | Verified live, foreign, unreadable, boundary, malformed, production/beta/persistent/unlabeled exclusions; SIGKILL later recovery; simultaneous active owners; INT 130/TERM 143; and exact teardown order with final absence.      |
| 3.4 REFACTOR    | Separated helpers, retained nonrecursive traps, normalized with pinned shfmt, and passed static checks.                                                                                                                           |

### PR 3 Verified Scope and Evidence

| Path                                          | Additions | Deletions |
| --------------------------------------------- | --------: | --------: |
| `scripts/lib/disposable-postgres.sh`          |        72 |         7 |
| `scripts/tests/disposable-postgres.test.bats` |       212 |         5 |
| **Total**                                     |   **284** |    **12** |

- Total authored lines: 296; exactly two paths; <=400.
- `go run mvdan.cc/sh/v3/cmd/shfmt@v3.12.0 -d ...` — PASS.
- ShellCheck — PASS.
- Bats — PASS, 16/16.
- `bash -n` — PASS.
- `git diff --check` — PASS.
- Independent terminal verification: 0 CRITICAL, 0 WARNING, 0 SUGGESTION; tasks 3.1–3.4 accepted.
- No real Docker ran; PR4 owns real-Docker neutrality and CI.

## PR 4 — Real-Docker Neutrality and CI

- Delivery: PR #421 and tracker PR #417 are merged to `main`; tracker merge commit is `4f9261c78ede9fcd26d5733540defd8ff9cddafa`.
- Completed tasks: 4.1 RED, 4.2 GREEN, 4.3 TRIANGULATE, and 4.4 REFACTOR.
- Review budget: 240 authored lines across exactly two paths, within the <=400-line limit.

### PR 4 TDD Cycle Evidence

| Task            | Evidence                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 RED         | The integration file and CI gate were absent. Isolated CI then surfaced ShellCheck severity, timeout-evidence capture, a non-stale SIGKILL timestamp, a nonportable no-prune assertion, and weak persistent/foreign fixtures.                                                                          |
| 4.2 GREEN       | Added the real-Docker harness and isolated required-mode CI. Fixes were minimal, and each CI rerun advanced the same acceptance suite.                                                                                                                                                                 |
| 4.3 TRIANGULATE | Six scenarios cover success/failure; timeout → absence → retry; partial start plus injected teardown failure with exact fallback cleanup; old SIGKILL recovery; true concurrent owners; and distinct production/beta/persistent/foreign/unlabeled exclusions. Owner/run/no-prune evidence is asserted. |
| 4.4 REFACTOR    | `ATHLOS_REQUIRE_DOCKER=1` opt-in occurs before any local Docker call. Exact helpers were retained; formatting, lint, and actionlint passed.                                                                                                                                                            |

### PR 4 Final Scope and Verification

| Path                                                 | Additions | Deletions |
| ---------------------------------------------------- | --------: | --------: |
| `.github/workflows/test.yml`                         |        20 |         0 |
| `scripts/tests/disposable-postgres.integration.bats` |       220 |         0 |
| **Total**                                            |   **240** |     **0** |

- Total authored lines: 240; exactly two paths; <=400.
- Pinned shfmt 3.12: PASS.
- Bare integration ShellCheck: PASS; warning-level source + integration ShellCheck: PASS.
- actionlint 1.7.5: PASS.
- Fake Bats: PASS, 16/16.
- GitHub Actions run `33351089235`, job `99364461074`: required real-Docker Bats: PASS, 6/6, with baseline restoration.
- CI `pnpm test:run`: PASS; all eight PR checks are green.
- Final safe independent verification: 0 CRITICAL, 0 WARNING, 0 SUGGESTION; tasks 4.1–4.4 accepted; zero local Docker invocation.

### Operational Safety Discovery

- An earlier verifier violated Docker coordination. Resources were exact-cleaned, the dual-label inventory reached zero, a peer reconciled its baseline, and the harness now requires explicit opt-in before Docker detection. This incident is retained as operational safety evidence, not hidden.

## Current Status

- Completed: 16/16 tasks.
- Remaining apply tasks: none.
- Delivery is complete: tracker PR #417 is merged to `main` at `4f9261c78ede9fcd26d5733540defd8ff9cddafa`; PRs #418–#421 are merged and issue #416 is closed.
- Final evidence: all eight tracker checks succeeded, including fake Bats 16/16 and isolated real-Docker Bats 6/6 (run `33351089235`, job `99364461074`).
- Archive is ready. No archive blocker remains.
