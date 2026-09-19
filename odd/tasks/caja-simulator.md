# Feature: caja-simulator (interactive CLI caja simulator)

## Goal

`pnpm caja:sim` — an interactive Node REPL over a real disposable PostgreSQL with the
canonical drizzle chain applied and a loaded `CashScenario`, so the maintainer can drive the
real cash services live (seeds, shifts, settlements, closes, assertions) and run named
demo/inspection scenarios. Non-interactive mode (`pnpm caja:sim <scenario>`) runs one named
scenario and exits.

## Decisions

- CLI REPL shape chosen by the maintainer (over HTTP-local and full visual stack).
- Built directly on the merged `createCashScenario()` harness (PR #543 / a879b794); no new
  provisioning logic — the simulator is a consumer of the harness.
- Lifetime: one sim invocation = one disposable PG container (via
  `scripts/lib/disposable-postgres.sh run --caller caja-sim`) + one scenario database inside
  it; both disappear when the console exits (`.exit`, Ctrl-D, or Ctrl-C). No cross-process
  persistence — disposable by design.
- Named scenarios mirror the merged test proofs: `close-flow`, `replay`, plus `status`
  (read-only state summary). Named scenarios print human-readable summaries.
- Script lives at `apps/api/src/scripts/caja-sim.ts` (tsx precedent: `qa-001-verify.ts`);
  runner wired in root `package.json` next to `test:cash-scenario`.
- Scenario DB name for psql is resolved via `SELECT current_database()` (no harness change).
- Docs: usage in the script header (repo precedent), no CHANGELOG entry (not per-PR
  convention lately).

## Tasks

- [x] T1: Implement `apps/api/src/scripts/caja-sim.ts` (provision, banner/help, REPL context
      `scenario`/`run`/`help`, named scenarios, teardown on exit, SIGINT-safe).
- [x] T2: Wire `caja:sim` runner in root `package.json`.
- [x] T3: Verify: typecheck + eslint + prettier; smoke `caja:sim close-flow` vs real PG;
      piped-stdin REPL smoke vs real PG.
- [x] T4: Close: report outcome and checks.

## Verification evidence

- `pnpm --filter @athlos/api typecheck` → clean; `pnpm --filter @athlos/db typecheck` → clean
- `pnpm exec eslint` on both changed sources → exit 0; prettier → clean
- `pnpm caja:sim close-flow` (non-interactive, real ephemeral PG) ×2 → close transfer 80.00
  pinned to 1.1.3.02, discrepancy {}, all assertions pass, teardown clean
- `printf "await run('replay')\nawait run('status')\n.exit\n" | pnpm caja:sim` → replay
  idempotent (same settlement id, caller-key count 1, allocations 1), no teardown race
- `printf "await run('close-flow')\n.exit\n" | pnpm caja:sim` → completes with exit racing the
  in-flight scenario (lifecycle fix verified)
- `community-work-approval.persistence.test.ts` under vitest → 15/15 pass (harness
  `import.meta.dirname` + guard changes verified on both runtimes)

## Incidents found during verification (fixed in this feature)

1. `packages/db/src/community-work-approval.harness.ts` used `__dirname`, which breaks under
   tsx/ESM (`__dirname is not defined`) — switched to `import.meta.dirname`, matching
   `cash-scenario.ts`. Also guarded `new URL()` and the journal `JSON.parse` with descriptive
   errors (same convention as the caja harness).
2. Simulator lifecycle race: piped/script-mode REPL does not await one line's promise before
   evaluating the next, so `.exit` (and therefore teardown with `DROP SCHEMA CASCADE`) could
   run while a named scenario was still in flight — observed as PG deadlocks (40P01) and
   missing relations (42P01) under concurrency. Fix: every `run()` invocation chains onto an
   `inflight` promise and `shutdown()` awaits it before `scenario.end()`.

## Rollback boundary

Remove `apps/api/src/scripts/caja-sim.ts`, the `caja:sim` script entry, and revert the
`community-work-approval.harness.ts` runtime path fix; no unrelated behavior touched.
