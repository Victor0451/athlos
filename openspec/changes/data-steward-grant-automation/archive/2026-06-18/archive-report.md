# Archive Report: data-steward-grant-automation

**Change**: data-steward-grant-automation
**Date**: 2026-06-18
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ✅ ARCHIVED

## Summary

Slice B0 of deploy automation. Replaces the manual SQL grant block in `docs/runbook.md:26-43` with a typed CLI `pnpm ops:grant-data-steward`. Adds `OperatorsRepo.findByUsername()` repo method. Strict TDD applied (2 chains: operators + grant-data-steward). Single PR (#8) merged to main at v0.4.2. 464/464 tests pass.

## Capabilities modified (1 MODIFIED, 0 ADDED, 0 REMOVED, 0 RENAMED)

### `auth-login` (MODIFIED)
4 new scenarios added to existing `Permission Enforcement` requirement:
- Operator grant via CLI with username resolution
- CLI grant is idempotent (no duplicate audit on re-run)
- CLI exits 1 on unknown username
- CLI --json output shape is Zod-validated

Canonical `openspec/specs/auth-login/spec.md` synced during archive (this was an apply gap — the delta was merged but the canonical was not updated until archive).

## Commits (12 total)

| SHA | Subject |
|-----|---------|
| `eb95eba` | Merge pull request #8 from Victor0451/feat/data-steward-grant-automation |
| `51911c6` | chore(release): v0.4.2 |
| `3b32d96` | chore(verify): pre-closing verification passed |
| `f2a5580` | docs(runbook): reconcile docs/runbook.md — drop INSERT role_permissions block, add pnpm ops:grant-data-steward reference + deprecation comment |
| `b97a30d` | chore(root): mirror ops:grant-data-steward at root package.json |
| `7d82939` | chore(db): add grant:data-steward script + ./repositories/operators export to @athlos/db package.json |
| `6de657c` | refactor(db): extract Zod schema usage and clean up grant-data-steward.ts |
| `4040152` | feat(db): implement grant-data-steward.ts (GREEN phase — strict TDD) |
| `d8eb2ee` | feat(db): add grant-data-steward.schema.ts Zod schema for --json output |
| `b5460fb` | test(db): add grant-data-steward.test.ts (RED phase — strict TDD) |
| `f6683b1` | refactor(db): clean up OperatorsRepo after GREEN |
| `af9f66c` | feat(db): implement OperatorsRepo.findByUsername (GREEN phase — strict TDD) |
| `6f9d271` | test(db): add operators.test.ts for findByUsername (RED phase — strict TDD) |

## Strict TDD verification (both chains)

### Chain 1: OperatorsRepo.findByUsername
- RED: `6f9d271` — tests FAIL (operators module missing)
- GREEN: `af9f66c` — implementation, 4 cases PASS
- REFACTOR: `f6683b1` — no behavior change

### Chain 2: grant-data-steward
- RED: `b5460fb` — tests FAIL (script module missing)
- SUPPORT: `d8eb2ee` — Zod schema added
- GREEN: `4040152` — implementation, 10 cases PASS
- REFACTOR: `6de657c` — no behavior change; test mock cleanup

Final: 464/464 tests (was 450, +14 new: 4 repo + 10 script)

## 2-commit shape verified

- HEAD~1 (chore(verify)): 0.4.1 (no version bump)
- HEAD (chore(release)): 0.4.2
- 23 package.json files bumped
- [0.4.2] entry in CHANGELOG.md

## Out of scope (reaffirmed)

- Slice B1 (backup/restore/S3/env/compose) — separate future change
- Granting arbitrary permission_keys — only `data_steward` for v1
- DB-query-based operator discovery — use CLI args or env var
- Bulk CSV import — repeat --username flags suffice
- UI for grant management
- Auto-revoke
- MinIO / AWS S3 / IAM roles / deploy host

## Verification

- pnpm test:run: 464/464 pass
- pnpm lint: pass
- pnpm typecheck: pass
- 2-commit shape: pass (verified after cherry-pick reordering to remove duplicate refactor commit)

## Artifacts

- openspec/changes/data-steward-grant-automation/archive/2026-06-18/{proposal,design,tasks,archive-report}.md
- openspec/changes/data-steward-grant-automation/archive/2026-06-18/specs/auth-login/spec.md
- openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md (from explore-athlos-deploy-slice-b)
- openspec/specs/auth-login/spec.md (canonical, MODIFIED with 4 new scenarios)
- Engram topic sdd/data-steward-grant-automation/archive-report

## Next steps

The repo is at v0.4.2 with Slice B0 done. Operators can now run `pnpm ops:grant-data-steward --username <u>` instead of raw SQL; the CLI is idempotent and audited. Follow-up changes:
- Slice B1 — backup + restore + S3 (~320 LoC) — needs S3 bucket/region/credentials decisions
- Slice C — Dockerfile + entrypoint + compose (~280 LoC)
- Slice D — CI deploy workflow + db-destructive label gate (~250 LoC)
