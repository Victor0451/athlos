# Review policy — `athlos-ctacte-security-reliability-remediation` / S0 / PR 1
#
# Bounded policy declaration for a trivial docs-only slice whose diff is
# spec deltas + focused TDD evidence (test + captured `pg_indexes`
# snapshot). No application runtime code changes; no DB migrations; no
# deploy / production access.

mode: ordinary_4r
tier: trivial-docs-only
risk: low
focus: reliability

# Deliberate deterministic classification: the diff is docs/evidence/test
# only, so the lens set is empty and the bounded correction budget is 0.
# Focused verification substitutes for 4R lenses (anchor PR 1 lesson).

required_initial_lenses: []

correction_budget_lines: 0

focused_verification:
  - command: "node scripts/check-spec-deltas.mjs"
    when: "always"
    note: "Validates shape of six delta specs (presence + RFC 2119 + Given/When/Then)."
  - command: "pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts"
    when: "ATHLOS_TEST_DATABASE_URL set"
    env: ATHLOS_TEST_DATABASE_URL
    note: "Disposable PostgreSQL lifecycle test (0031 → 0032 → 0033 → 0034 + ON CONFLICT inference)."
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
