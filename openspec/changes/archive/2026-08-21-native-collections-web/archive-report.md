# Archive Report: Native Collections Web

## Outcome

The `native-collections-web` SDD change is archived after final verification passed. The archive is the terminal final-state record; earlier failed verification evidence remains preserved below as superseded history.

## Final Verification

- Verdict: PASS; 10/10 requirements and 17/17 scenarios compliant.
- PostgreSQL integration: 15/15 passed.
- Focused API: 35/35 passed.
- Focused Web: 27/27 passed.
- Enabled serial Playwright: 6 passed, 1 skipped, including unauthenticated `/socios` redirect coverage.
- Typecheck, lint, Prettier, and whitespace checks passed.
- Flags remain off by default.
- No CTACTE, cash, tender, close, reconciliation, implicit allocation, ledger mutation/deletion, or authorization expansion was added.

The final verify artifact is `evidence_revision: sha256:3ff8b88ba8dbdb1c72cebedff8dd14fbe5cc3d664eb53c7dd29e0eaa56c84af7` and is recorded in OpenSpec and Engram observation `#9139` (`sdd/native-collections-web/verify-report`).

## Remediation History

Two bounded remediations completed before the final verification, with no production-code changes:

1. Corrected two test expectations: UUID-backed row ordering is asserted by exact membership rather than request order, and paid non-cash community-work history remains visible with `PAID` status and zero total. Evidence revision: `sha256:97e1c8a9e35c37c577094f0b6e94576ad90067e2a221e346358ba5eac755aa36`.
2. Corrected E2E pricing interception for narrow journeys and added `/socios` redirect coverage. Evidence revision: `sha256:42be8719fe8ef4483585a421c1de2d234159fca4a52b8d4ece882371a6f49a1a`.

The earlier failed verification evidence `sha256:a4d39bbbfc348d365c494ce2caa55e3ca97d59d8a8dd751863d91a51b3e94fad` is superseded, not erased. The prior failure record is preserved in the cumulative apply-progress and Engram observation `#9154`; its failure state is historical and is not the final state.

No native attempt was acquired or settled. No commit, push, or pull request was performed.

## Specs Synced

| Domain | Action | Result |
|---|---|---|
| `native-collections-web` | Created | Full specification copied from the delta. |
| `dues-pricing-assessment` | Created | Full specification copied from the delta. |
| `debt-allocation-settlement` | Created | Full specification copied from the delta. |
| `web-frontend` | Updated | Added capability-aware Collections navigation and replaced the Protected Routing requirement while preserving all unrelated requirements. |

## Archive Contents

- `exploration.md`
- `proposal.md`
- `specs/` with all four delta specs
- `design.md`
- `tasks.md` — 12/12 tasks complete
- `apply-progress.md` — cumulative implementation and remediation history
- `verify-report.md` — final passing verification plus superseding context
- `archive-report.md`

## Artifact Traceability

Full Engram observations read for this archive: `#9072` proposal, `#9075` combined spec, `#9077` design, `#9081` tasks, `#9087` apply-progress, `#9139` final verify-report, `#9154` prior failed verification record, `#9137` first artifact-correction session record, and `#9156` second E2E-remediation session record. OpenSpec artifacts read from `openspec/changes/native-collections-web/` were `exploration.md`, `proposal.md`, all four delta specs, `design.md`, `tasks.md`, `apply-progress.md`, and `verify-report.md`.

## Mechanical Readback

The three new main-spec copies and the archive move were verified with `diff -r`; all produced empty output (no differences). The archive move used a pre-move recursive snapshot and removed the active source directory.
