# Review policy — `athlos-ctacte-security-reliability-remediation` / S0 / PR 1
# Lineage: `athlos-ctacte-security-reliability-remediation-s0-pr1-deterministic-v3`
#
# Bounded policy declaration for a trivial docs-only slice whose diff is
# spec deltas + focused TDD evidence (test + captured `pg_indexes`
# snapshot + pgcrypto deterministic prerequisite RED proof). No
# application runtime code changes; no DB migrations; no deploy /
# production access.
#
# v3 lineage vs the v2 lineage (`...-s0-pr1-republish-v2`): the v2 lineage
# was never persisted in the v1 authoritative CAS, so v3 is a fresh lineage
# built on top of the v2 corrected candidate content (materialized
# byte-exactly) plus a single TDD-bounded correction (pgcrypto deterministic
# prerequisite, 59 authored lines).

mode: ordinary_4r
tier: trivial-docs-only
risk: low
focus: reliability

# Deliberate deterministic classification: the diff is docs/evidence/test
# only, so the lens set is empty and the bounded correction budget is 0.
# Focused verification substitutes for 4R lenses (anchor PR 1 lesson).
# The pgcrypto deterministic prerequisite RED proof is a focused TDD
# assertion (no lens required) — it verifies the ordering invariant
# `CREATE EXTENSION pgcrypto` BEFORE `CREATE TABLE … gen_random_uuid()`.

required_initial_lenses: []

correction_budget_lines: 0

focused_verification:
  - command: "pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts"
    when: "always"
    note: "Six per-capability `it()` blocks (one per delta) drive the `validate()` function inside the test file; this validates shape of six delta specs (presence + RFC 2119 + Given/When/Then) and is the canonical spec-delta checker for S0/PR 1. (There is no separate `scripts/check-spec-deltas.mjs`; the validator is colocated with the lifecycle test as a single vitest file per the v2 corrective batch.)"
  - command: "pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts"
    when: "ATHLOS_TEST_DATABASE_URL set"
    env: ATHLOS_TEST_DATABASE_URL
    note: "Disposable PostgreSQL lifecycle test (0031 → 0032 → 0033 → 0034 + ON CONFLICT inference) + pgcrypto deterministic prerequisite RED proof (12 tests total)."
  - command: "pnpm --filter @athlos/db exec tsc --noEmit"
    when: "always"
    note: "TypeScript strict typecheck for the new test file."

# Per-slice scope boundary — review should NOT flag content outside this
# list. Anything beyond is out-of-scope for S0/PR 1 (chained to main
# after S1 lands).
review_scope_paths:
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/proposal.md"
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/design.md"
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/tasks.md"
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/exploration.md"
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/specs/"
  - "openspec/changes/athlos-ctacte-security-reliability-remediation/reviews/"
  - "packages/db/src/s0-contracts-0034-lifecycle.test.ts"
  - "artifacts/"
