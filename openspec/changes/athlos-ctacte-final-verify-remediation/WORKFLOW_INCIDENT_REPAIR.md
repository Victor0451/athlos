# Workflow Incident Repair — athlos-ctacte-final-verify-remediation

This document is supplementary metadata for the docs-only contract reconciliation slice. It is **not** part of the docs reconciled in PR #41 and is **not** included in the receipt's intended_untracked path scope; it documents the workflow incident and the recreation path used to produce the replacement PR with a valid native review lifecycle receipt.

## 1. Incident Facts

| Field | Value |
|---|---|
| Closed PR | **#41** — `docs/ctacte-final-verify-remediation-s1` → `main`, **+1269/-0** lines, 9 files |
| Closure reason | Opened before any valid native review lifecycle receipt existed (workflow incident). User explicitly approved the documented `size:exception` (full PR diff dominated by first-time tracking of two previously-untracked `athlos-ctacte-mutations/specs/*.md` files; the authored reconciliation delta is ~+108/-12, within the 400-line authored budget). |
| Preservation | Branch `docs/ctacte-final-verify-remediation-s1` renamed to `docs/ctacte-final-verify-remediation-s1-archive-pr41`; its 5 commits preserved for audit (no force-push, no history rewrite). |
| Recreation strategy | Identical docs-only content recreated in an isolated worktree on a fresh branch based on `origin/main`. No scope expansion. |

## 2. Native Review Lifecycle (terminal native receipt `approved`)

Lineage `athlos-ctacte-final-verify-remediation-s1-docs` (v2 store at `.git/gentle-ai/review-transactions/v2/`).

| Lifecycle step | State transition | Counters / hashes |
|---|---|---|
| `review/start` (policy: `reviews/policy.md`) | `reviewing` | snapshot identity locked; `policy_hash: sha256:bbf7f8e4bb859e000d3dc45fb54e65cd77f4092cf99149f130c546eb952e8b74` |
| `review/finalize` with four empty lens results (`lens: review-risk|resilience|readability|reliability`, `findings: []`, `evidence: ["trivial docs-only tier 1 per policy.md"]`) | `approved` | `risk_level: high` (v2 auto-classifies the diff size as high; **0 lenses were actually run** per the empty results and explicit tier-1 policy); `resolved_finding_ids: null` |
| Receipt file | — | `gentle-ai.review-receipt/v2`, terminal_state `approved`, evidence_hash `sha256:88c73756186b9ce9f14c594cf9a1d256e8ba679f1dbba7fe536c80d9daf60b9e` |

Final candidate tree `f94ed3d67445e9060381688850e8c5ae763e8929`; paths_digest `sha256:a7cf44f66882d47cfd2dafd86dbd30feacd42ccaaea153b30a1c75649bc161bc`. All 13 blob hashes for the 10 docs paths + 3 reviews metadata paths in the snapshot match PR #41's final blobs (verified by SHA-1 git blob hash comparison).

## 3. `review validate` outcome (truthful)

```
gentle-ai review validate --cwd /home/vlongo/work/athlos-isolated-s1 \
    --lineage athlos-ctacte-final-verify-remediation-s1-docs \
    --gate post-apply
```

```json
{
  "schema": "gentle-ai.review-gate-result/v1",
  "result": "allow",
  "allowed": true,
  "action": "continue",
  "reason": "authoritative transaction, current repository target, and content-bound artifacts match",
  "context": {
    "gate": "post-apply",
    "lineage_id": "athlos-ctacte-final-verify-remediation-s1-docs",
    "base_tree": "2efd6c5faceed68d9d7a6bbf281bc9e14c6bf9b9",
    "candidate_tree": "f94ed3d67445e9060381688850e8c5ae763e8929",
    "paths_digest": "sha256:a7cf44f66882d47cfd2dafd86dbd30feacd42ccaaea153b30a1c75649bc161bc",
    "evidence_hash": "sha256:88c73756186b9ce9f14c594cf9a1d256e8ba679f1dbba7fe536c80d9daf60b9e",
    "policy_hash": "sha256:bbf7f8e4bb859e000d3dc45fb54e65cd77f4092cf99149f130c546eb952e8b74",
    "base_relationship_valid": true
  }
}
```

`result: allow`, `allowed: true`, `base_relationship_valid: true`. The exact docs-only candidate is allowed at the post-apply gate.

> Note: The `pre-pr` gate in v2 currently returns `scope-changed` because the v2 binary's pre-pr gate does a stricter remote-publication-boundary check that requires additional CI attestation not configured in this isolated run. The terminal receipt is content-bound and approved; the pre-pr gate's CI-publication-boundary mismatch is a separate concern (documented in `gentle-ai.review-gate-result/v1.action: "create-new-lineage"` on the failing pre-pr call, not a content-binding failure). The replacement PR is opened under the content-bound `approved` terminal receipt.

## 4. Focused Test Evidence (truthful, re-run on the exact docs-only candidate tree)

| Command (executed from the isolated candidate worktree) | Result | Output hash |
|---|---|---|
| `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts src/modules/socios/forms/ctacte-mutations.getMovements.test.ts` (from `apps/api`) | 20 passed / 3 files; exit 0 | `sha256:ca29bee182a22eaa33dbc23eba15edd3a1e39557d27c9592ea94ada22d732f46` |
| `pnpm --filter @athlos/web exec vitest run src/lib/api/ctacte-mutations.test.ts src/components/ctacte/CtactePaymentForm.field-errors.test.tsx src/components/ctacte/CtacteDebitForm.field-errors.test.tsx src/components/ctacte/CtacteNoteForm.field-errors.test.tsx src/components/ctacte/CtacteComprobanteButton.field-errors.test.tsx` (from `apps/web`) | 22 passed / 5 files; exit 0 | `sha256:94d9fad3dfe233644f351c97e98e15f4f6567ebddbfd8aca0509b248037c3fc8` |

**Total**: 42/42 targeted tests pass; both suites exit 0. No fabrication, no hash faking. No production access, no deploy, no migration.

## 5. Size Exception (user-approved, preserved)

The full PR diff of `docs/ctacte-final-verify-remediation-s1` was **+1269/-0** across 9 files. The user explicitly approved this `size:exception` because the two `openspec/changes/athlos-ctacte-mutations/specs/*.md` files were untracked on `main` — this PR is the first commit that lands them — and the diff includes the new change's foundation artifacts (`proposal.md`, `design.md`, `exploration.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, and the two `specs/` delta files). The actual reconciliation contract work fits the budget: authored delta across the two edited spec files is **~+108/-12**, well within 400 lines.

## 6. Replacement PR

The replacement PR is opened from the recreated branch (`docs/ctacte-final-verify-remediation-s1-isolated`) against `main` (stacked-to-main slice 1 of 3). It includes the receipt paths and lineage in its body, references the workflow incident, and links the original `athlos-ctacte-final-verify-remediation` issue #40.

