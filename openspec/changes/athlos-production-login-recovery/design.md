# Design: Athlos Production Login Recovery

## Technical Approach

Repository delivery tests recovery contracts; it never targets production. Operators follow this evidence flow:

```text
read-only inventory → verified backup → isolated-clone restore → migration rehearsal
→ schema/data/audit validation → explicit approval → future production operation → post-checks
```

Every failed gate aborts; production is not an SDD apply task.

## Architecture Decisions

| Option | Tradeoff | Decision and rationale |
|---|---|---|
| Run Drizzle history/reset | Fast, but the journal is incomplete and `0000` may collide with preserved `audit_events` | Reject. Add checksum-pinned, prerequisite-checked recovery SQL outside the normal journal; permit clone rehearsal only. |
| Versioned repair + evidence manifest | More work; preserves data | Choose. Emit redacted JSON with target fingerprint, checksums, relation/count/hash results, audit count, approval reference, and timestamps. |
| Seed credentials through argv/env | Simple but leaks through process/config surfaces | Reject. Bootstrap reads the raw password from an interactive/stdin file descriptor, hashes it in memory, and never prints or evidences it. |
| Transactional zero-operator bootstrap | Requires `audit_events`; safely retries | Choose. Under an advisory lock, insert one ADMIN and redacted audit event atomically; refuse when an operator is recoverable. |
| Proxy localhost fallback | Convenient locally; silently targets the wrong production process | Reject in production. Validate `API_INTERNAL_URL` once, redact URL credentials, preserve upstream responses (including 401), and return bounded 502 on transport failure. |
| Connectivity-only readiness | Cheap but reports false-ready | Reject. `/health` stays dependency-free; `/health/ready` runs a 2-second bounded DB and `to_regclass` critical-schema check, returning only `db/schema: ok|down`. |

## Data and Security Flow

`preflight` is read-only. `rehearse` accepts only an ephemeral harness or explicitly marked clone; target mismatch, missing approval, checksum drift, missing relations, protected-data mismatch, or decreased `audit_events` aborts. URLs and credentials never enter evidence. Post-checks prove readiness, scheduler access, direct/proxy invalid login as 401, then valid login.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/recovery/0001_auth_scheduler.sql` | Create | Idempotent, non-destructive repair with explicit prerequisites. |
| `packages/db/src/scripts/bootstrap-admin.ts`, `packages/db/src/scripts/*.test.ts`, `packages/db/package.json` | Create/modify | Transactional bootstrap contract, secret-safe input, audit evidence, focused tests. |
| `scripts/recovery/{preflight,rehearse,check-scope}.sh`, `scripts/recovery/evidence.schema.json`, `scripts/tests/recovery*.bats` | Create | Redacted gates, clone-only rehearsal, worktree scope enforcement, optional ephemeral PostgreSQL harness. |
| `apps/api/src/routes/health.ts`, `apps/api/src/routes/health.test.ts` | Modify | Liveness/readiness separation and critical-schema tests. |
| `apps/web/src/app/api/v1/[...path]/route.ts`, `route.test.ts` | Modify/create | Validated upstream, 401 passthrough, redacted bounded 502. |
| `Dockerfile.web`, `docker-compose.yml`, `.github/workflows/deploy.yml`, `.env.example` | Create/modify | Build/run web, inject `API_INTERNAL_URL=http://api:3001`, and gate deployment on readiness. |
| `docs/runbook.md` | Modify | Sequence, approval, evidence, rollback, and post-checks. |

## Testing Strategy

Vitest covers bootstrap idempotency/audit, readiness schema/timeout/liveness, and proxy configuration/401/transport failure. Bats proves no production write, redaction, gates, hostile arguments, and scope isolation. An optional PostgreSQL 16 harness restores a disposable clone, applies recovery twice, and compares schema, protected counts/hashes, and audit rows; apply never uses live coordinates.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: no executable-file classifier | Docs are never execution input | None |
| Git repository selection | Applicable | Canonical `git -C` root must equal the recovery worktree; reject relative/absolute selectors resolving elsewhere | Wrong cwd, relative selector, PR2 absolute path |
| Commit state | Applicable | Scope check inspects staged and unstaged names; empty index is valid; any PR2/recovery mixing fails | staged, `commit -a`-equivalent unstaged, empty index |
| Push state | N/A: no push automation | Manual delivery only | None |
| PR commands | N/A: no PR command composition | Manual PR creation only | None |

## Delivery, Rollback, and Risks

The checkout is dirty. Create sibling worktree `Athlos-worktrees/production-login-recovery` from reviewed `origin/main` (`c1f2ab7` observed), never dirty `c10c8c3`; revalidate first. PR2 stays in `Athlos-worktrees/pr2-recovery-finalize`; no shared staging, cherry-picks, reset/clean, or mixed candidate. Deliver PR2 first, then rebase configuration/docs onto reviewed main.

| Candidate | Forecast | Decision/order |
|---|---:|---|
| PR A: tooling + clone rehearsal + bootstrap | 450–600 | Over budget: split A1 recovery/evidence (300–380), then A2 bootstrap contract (220–300). |
| PR B: proxy + readiness + tests/docs | 420–550 | After PR2: split B1 readiness (140–220), then B2 proxy/Compose/deploy/docs (280–390). |
| Operator execution unit | N/A code lines | Outside code PRs; separately approved after all gates. |

Each slice carries tests and reverts independently. Code rollback reverts its slice/image; operational rollback restores the verified dump per the approved decision—never an unproven reverse migration. Risks are backup-age data loss, partial schema, audit loss, secret leakage, false readiness, wrong proxy topology, and PR2 contamination; checksum/count gates, redaction, readiness signals, isolated worktrees, and approval mitigate them.

## Open Questions

None blocking; the incident commander must name the future production approver and maintenance window before operator execution.
