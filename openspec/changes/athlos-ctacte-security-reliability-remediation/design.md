# Design: Athlos CTACTE Security and Reliability Remediation

## Decision summary

S4 is two stacked-to-main slices. **S4a** adds nullable `failure_reason` storage and repository/state semantics; it is safe to run alone and does not enable timeout HTTP behavior. **S4b**, based on S4a, adds one 30-second request deadline for owners and followers, abort-aware Puppeteer cleanup, `504 RENDER_TIMEOUT`, bounded telemetry, and removal of the comprobante route's unexpected-error-to-400 downgrade.

This supersedes only the earlier S4 statements that said “without new migrations” and “No new migration.” The rest of the remediation design remains unchanged. The proposal is minimally amended to remove the same conflict.

## Architecture decisions

| Topic | Decision | Why |
|---|---|---|
| Timeout classification | Persist `RENDER_TIMEOUT`; represent ordinary renderer failure with a null reason. | Terminal timeout replay and reclaimable ordinary failure cannot be inferred safely from `status = 'failed'` alone. |
| Delivery | Land S4a before S4b; each is a separate stacked-to-main review boundary below 400 authored changed lines. | The schema/state invariant is deployable and rollback-compatible before runtime starts writing the new reason. |
| Request versus lease time | A request gets one fixed 30-second deadline. The renewable lease remains 5 seconds with a heartbeat near one third of that duration. | The short lease preserves crashed-owner takeover; heartbeats do not extend the caller's deadline. |
| Cancellation | Use an `AbortController` and an always-observed render task. Do not treat `Promise.race` as cancellation. | Puppeteer work can settle after a timer; explicit page closure and late-settlement observation prevent leaks and unhandled rejections. |
| Timeout mutation | Only the active owner may persist terminal timeout, using an owner-conditional update. A follower timeout never mutates durable state. | This fences stale owners and prevents a waiting request from corrupting a healthy owner's lease. |
| HTTP errors | Use a typed timeout error for `504`; rethrow every unexpected renderer/repository error to Fastify's global redacted 5xx handler. | Contract failures stay explicit without leaking internal error details or converting server failures to `400`. |
| Metrics | Add one zero-label counter and increment only for a live owner/follower request deadline. | It is cardinality-safe and avoids counting persisted replay as a new incident. |

Existing non-S4 decisions remain: covered mutation/audit writes are atomic; durable caller keys do not use a time bucket; role and `can_reprint` gates remain at the route boundary; attachment cleanup compensates only the newly created file; actor and canonical payload remain part of comprobante replay identity.

## Schema and migration lifecycle (S4a)

### Exact schema contract

| Property | Value |
|---|---|
| Table | `tesoreria.ctacte_comprobante_retries` |
| Column | `failure_reason` |
| PostgreSQL/Drizzle type | `text` / `text('failure_reason')` |
| Nullability | Nullable |
| Default | SQL `DEFAULT NULL`; Drizzle has no `.notNull()` and no non-null application default |
| Allowed values | `NULL` or `'RENDER_TIMEOUT'` only |
| Check | `ctacte_comprobante_retries_failure_reason_check CHECK (failure_reason IS NULL OR failure_reason = 'RENDER_TIMEOUT')` |
| Existing-row backfill | Adding the nullable column produces `NULL` for every existing row, including `status = 'failed'`; no row is reclassified |

Add hand-written, idempotent migration `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql`, ordered after `0034`. It performs:

1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS failure_reason text DEFAULT NULL`.
2. A catalog-guarded `DO` block that adds the named check if absent.
3. `ALTER TABLE ... VALIDATE CONSTRAINT ...` so an unexpected pre-existing unsupported value fails rollout.

Like `0033` and `0034`, `0035` remains outside the repository's incomplete Drizzle production journal; the ordered hand-written migration/runbook path is authoritative. Update `packages/db/src/schema/tesoreria.ts` in the same slice so application types match the live schema. Apply and verify `0031 → 0032 → 0033 → 0034 → 0035` in order and apply `0035` twice in disposable PostgreSQL to prove idempotence.

The migration is additive and forward-only. Rolling back S4a or S4b reverts application code but leaves nullable `failure_reason` in place; the prior application ignores it. Never edit or reverse an applied migration. If the column must later be retired, use a new forward migration. This replaces the earlier design's “No new migration” statement without rewriting unrelated migration history.

## Durable state and repository contracts

Extend `LeaseClaim` with `{ kind: 'terminal-timeout' }` and make failure intent explicit:

```ts
type ComprobanteFailureReason = 'RENDER_TIMEOUT' | null

interface ComprobanteLeaseStore {
  claim(...): Promise<
    | { kind: 'owner' }
    | { kind: 'follower' }
    | { kind: 'complete'; result: RenderComprobanteResult }
    | { kind: 'terminal-timeout' }
    | { kind: 'conflict' }
  >
  heartbeat(key: string, owner: string, now: number, leaseMs: number): Promise<boolean>
  complete(key: string, owner: string, result: RenderComprobanteResult): Promise<boolean>
  failOrdinary(key: string, owner: string): Promise<boolean>
  failTimeout(key: string, owner: string): Promise<boolean>
}
```

Repository transitions are single conditional PostgreSQL updates:

- `failTimeout`: `rendering → failed`, sets `failure_reason = 'RENDER_TIMEOUT'`, clears lease fields, and succeeds only for the same `idempotency_key`, `status = 'rendering'`, and `lease_owner`.
- `failOrdinary`: `rendering → failed`, sets `failure_reason = NULL`, clears lease fields, and uses the same ownership predicate.
- `complete`: `rendering → complete`, writes the PDF result, clears lease fields and `failure_reason`, and uses the same ownership predicate.
- `heartbeat`: renews only the still-rendering row owned by the same owner.
- `claim`: checks fingerprint conflict before replay or reclaim. It returns `terminal-timeout` for `failed + RENDER_TIMEOUT`; it reclaims `failed + NULL` and stale `rendering`; it never reclaims terminal timeout. Completed replay and actor/payload conflict remain unchanged.

The PostgreSQL query and every in-memory/test stand-in implement the same transition table. S4a may expose and test `failTimeout` and terminal replay internally, but no route calls them until S4b.

### Ownership fencing and deadline races

`complete` and `failTimeout` compete on the same `status = 'rendering' AND lease_owner = owner` fence. Exactly one can win:

- If `failTimeout` updates the row, any late render completion gets `false`, cannot write bytes or emit the printed audit, and its rejection is observed by the timeout coordinator.
- If `complete` updates first, `failTimeout` gets `false`; the coordinator reads/claims the resulting state and returns the completed replay rather than overwriting it with failure.
- If ownership was lost to stale takeover, both the former owner's heartbeat/completion/failure updates return `false`; the former request must not publish a result.

The printed audit remains after successful durable `complete`; therefore a late, fenced completion never emits `CTACTE_COMPROBANTE_PRINTED`.

## Deadline and resource architecture (S4b)

Define `REQUEST_DEADLINE_MS = 30_000`, keep `LEASE_DURATION_MS = 5_000`, and derive `HEARTBEAT_MS` near `LEASE_DURATION_MS / 3`. Capture `requestDeadline = clock.now() + REQUEST_DEADLINE_MS` before the first claim. Polling, stale takeover, data loading, semaphore wait, HTML rendering, and PDF generation all consume this same budget; becoming owner does not reset it.

Use an injectable clock/timer seam (`now`, `sleep`, deadline scheduling) for deterministic tests. The owner path creates an `AbortController` and passes its signal through `generateOwnedComprobante` to `PdfGenerator.generate(html, { signal })`.

`PdfGenerator` handles cancellation at all resource boundaries:

1. Check the signal before waiting for and immediately after acquiring the semaphore slot.
2. After creating a Puppeteer page, register an abort listener that idempotently closes that page. Closing the page is the concrete cancellation mechanism for `setContent`/`page.pdf`; aborting a JavaScript promise alone is not.
3. Remove the listener, close an open page, and release the semaphore slot in `finally`, on success, failure, or abort.
4. The deadline coordinator attaches fulfillment and rejection handlers to the render task when it is created. On deadline it aborts, stops heartbeat renewal, and may return after the owner-conditional state transition, but the late task remains observed until its cleanup settles. A late fulfillment still passes through fenced `complete`; a late rejection cannot become unhandled.

An implementation may use a race to select the first outcome only if it also performs the abort, fencing, cleanup, and late-settlement observation above. `Promise.race` by itself is explicitly insufficient.

### Owner and follower boundaries

| Request role at deadline | Durable mutation | Response |
|---|---|---|
| Active owner | Stop heartbeat, abort render, then call owner-conditional `failTimeout`. Emit/count only if that transition wins. | `504 RENDER_TIMEOUT` when terminal failure wins; otherwise reconcile the winning complete/lost-owner state. |
| Follower of a healthy owner | None: do not change status, owner, lease expiry, result, or reason. | `504 RENDER_TIMEOUT`; the healthy owner continues. |
| Follower that observes a stale lease before 30s | Atomically reclaim as owner and heartbeat the short lease. | Render using only the remaining request budget. |
| Same-actor replay of stored terminal timeout | None; no reclaim or rerender. | `504 RENDER_TIMEOUT` with the new request's `request_id`. |
| Ordinary renderer failure | Owner-conditional `failOrdinary`, reason null. | Rethrow to global redacted 5xx; a later eligible request can reclaim. |

A live follower timeout is a timeout of that request's wait, not evidence that the owner's render failed. Heartbeats may renew many times inside 30 seconds, but never move `requestDeadline`. If a process crashes, heartbeats stop and another request can reclaim after the 5-second lease expires.

## Error, HTTP, logging, and metrics contracts

Introduce an internal typed `ComprobanteRenderTimeoutError` with `code = 'RENDER_TIMEOUT'`, `role: 'owner' | 'follower'`, and `live: boolean`. It carries no payload, SQL, browser, actor, or caller-key details.

The comprobante route maps only this type to:

```json
{
  "error": "RENDER_TIMEOUT",
  "message": "Comprobante rendering exceeded the 30-second deadline",
  "request_id": "<current Fastify request id>"
}
```

with status `504`. Existing `NOT_FOUND`, validation/cap, and conflict mappings stay intact. Any other renderer, lease-store, or unexpected error is rethrown and handled by the global Fastify error handler as redacted `5xx` (`INTERNAL_ERROR`); it is never converted to `400 VALIDATION_ERROR` and internal details never enter the response.

PR #56 already closes the analogous unexpected-error 5xx defect for payment/debit routes. S4b closes the still-present comprobante-route downgrade in `apps/api/src/routes/ctacte-mutations.ts`.

Add zero-label `ctacteComprobanteRenderTimeoutTotal` in `apps/api/src/plugins/metrics.ts` with Prometheus name `ctacte_comprobante_render_timeout_total`. For each live deadline returning `504`:

- Owner: emit exactly one warning with `event: 'ctacte_comprobante_render_failed'`, `error_code: 'RENDER_TIMEOUT'`, `request_id`, `actor_id`, `timeout_role: 'owner'`; increment once only after `failTimeout` wins.
- Follower: emit exactly one warning with `event: 'ctacte_comprobante_wait_timeout'`, the same error/correlation fields, and `timeout_role: 'follower'`; increment once. This log must not say the owner render failed.
- Persisted terminal replay: return the current request envelope but emit no live-timeout failure log and do not increment. Normal request/access logging plus `request_id` preserves correlation.
- Ordinary failure: rely on the global redacted error log (or a bounded non-timeout service log), never use `RENDER_TIMEOUT`, and do not increment.

The counter has no labels. Request ID, actor ID, caller key, fingerprint, socio ID, and role are log fields only, never metric labels.

## Data flow

```text
request → auth/validate → fixed request deadline → claim
  ├─ complete                     → replay PDF
  ├─ terminal-timeout             → 504 (no metric increment)
  ├─ conflict                     → 409
  ├─ follower
  │    ├─ owner completes         → replay PDF
  │    ├─ lease becomes stale     → reclaim as owner with remaining budget
  │    └─ request deadline        → 504 + follower log/counter; no DB mutation
  └─ owner → heartbeat short lease → abort-aware Puppeteer render
       ├─ complete wins fence      → persist bytes → audit → PDF
       ├─ ordinary error           → failed/null → global redacted 5xx
       └─ deadline
            ├─ failTimeout wins    → failed/RENDER_TIMEOUT → owner log/counter → 504
            └─ completion/loss wins→ reconcile persisted state; never overwrite
```

## Deterministic verification strategy

### S4a

- Migration test against disposable real PostgreSQL: create rows in `rendering`, `complete`, and `failed`; apply `0035` twice; assert column type/default/nullability, named check, all existing reasons null, unsupported reason rejected, and ordered `0031`–`0035` evidence.
- Real-PG lease tests with two independent clients: prove owner-only `failTimeout`, terminal replay without reclaim, ordinary null failure reclaim, stale rendering takeover, fingerprint conflict precedence, and completion-versus-timeout fencing.
- Shared in-memory store tests use the same transition table so unit tests cannot silently diverge from SQL.

### S4b

- Fake-clock tests start at a fixed instant and advance exactly to 29,999 ms and 30,000 ms. Cover timely owner success, owner timeout transition, follower timeout with zero writes, stale takeover within the request budget, terminal replay, ordinary rejection/reclaim, and completion/timeout race in both linearization orders. Assert timers and heartbeats are cleared and no unhandled rejection occurs after a late renderer resolve/reject.
- `PdfGenerator` tests use a mock browser/page: abort before semaphore acquisition, abort during `setContent`, abort during `page.pdf`, idempotent page close, slot release, and subsequent render success.
- Fastify inject tests assert standard `504` envelopes with the current request ID, live owner/follower log shape and one increment, persisted replay zero increment, and unexpected comprobante errors as redacted 5xx rather than 400.
- Real-PG deadline integration uses two stores/clients and a controlled renderer to prove a timed-out owner cannot publish late bytes and a healthy owner is not mutated by a follower timeout. Wall-clock duration is not used as an assertion; synchronization barriers control the race.

## File and review plan

### S4a — additive schema and state/replay semantics

**Dependency:** `origin/main` after the preceding remediation slices. **Expected authored change:** 280–360 lines. **Review boundary:** one standard reliability/risk-focused review, below 400 lines.

| File | Change |
|---|---|
| `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql` | Add nullable column and named check. |
| `packages/db/src/schema/tesoreria.ts` | Add nullable Drizzle field/check metadata. |
| `packages/db/src/ctacte-comprobante-failure-reason.integration.test.ts` | Prove migration idempotence, backfill/default/check/order. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | Add reason-aware claims and explicit ordinary/timeout repository transitions; no 30s runtime behavior. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts` | Prove terminal replay and ordinary/stale reclaim semantics. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` | Prove real-PG fencing and transitions. |
| `apps/api/src/test-standins/db.ts` | Keep the shared stand-in row/query behavior schema-compatible. |

**Rollback:** revert S4a application/schema declarations and tests, but retain applied `0035` in PostgreSQL. The older application ignores its nullable column. S4b cannot land or remain deployed without S4a.

### S4b — deadline, cancellation, HTTP, and observability

**Dependency:** S4a merged to `main`. **Expected authored change:** 320–390 lines. **Review boundary:** a separate high-risk resilience review because it touches Puppeteer/process cleanup, still below 400 lines.

| File | Change |
|---|---|
| `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | Add fixed owner/follower deadline coordinator, abort, heartbeat shutdown, and typed timeout outcomes. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.timeout.test.ts` | Fake-clock state, race, replay, and late-settlement tests. |
| `apps/api/src/modules/socios/forms/pdf-generator.ts` | Accept `AbortSignal`, close pages on abort, and always release resources. |
| `apps/api/src/modules/socios/forms/pdf-generator.test.ts` | Prove abort and cleanup paths. |
| `apps/api/src/routes/ctacte-mutations.ts` | Map typed timeout to standard 504; rethrow unexpected comprobante errors. |
| `apps/api/src/routes/ctacte-comprobante.timeout.test.ts` | Fastify envelope, redacted 5xx, logs, and metric assertions. |
| `apps/api/src/plugins/metrics.ts` | Register the zero-label timeout counter. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` | Add controlled late-completion/follower non-mutation proof. |

**Rollback:** revert S4b files together. S4a and `0035` remain safe and inert: ordinary failures continue with null reason and existing reclaim/stale-takeover behavior. If either slice approaches 400 authored lines, move only test-fixture refactoring into a prerequisite no-behavior slice; do not use a size exception or combine S4a/S4b.

## Rollout checklist

1. Apply and verify `0035`; confirm all existing `failure_reason` values are null and the named check is valid.
2. Deploy S4a and verify completed replay, ordinary failed reclaim, conflict, and stale takeover are unchanged.
3. Merge/deploy S4b only after S4a evidence is present.
4. Verify one live owner and one live follower timeout in controlled tests, counter exposition without labels, and persisted replay without another increment.
5. On S4b rollback, leave S4a/schema in place. On S4a application rollback, leave forward-only `0035` in place.

## Risks

| Risk | Mitigation |
|---|---|
| Chromium ignores promise-level timeout | Abort signal closes the concrete page; cleanup remains observed after response selection. |
| Late owner publishes after timeout | `complete` and `failTimeout` share the same owner/status fence; only one transition wins. |
| Heartbeat masks request timeout | Request deadline is fixed; heartbeat renews only the shorter lease. |
| Follower damages healthy work | Follower deadline has no durable mutation authority. |
| Existing failed rows become terminal | Additive column defaults/backfills to null; only explicit owner timeout writes `RENDER_TIMEOUT`. |
| Telemetry cardinality or double count | Zero-label counter; increment only on live deadline outcomes, never persisted replay. |
| Slice exceeds review budget | Separate S4a/S4b boundaries with explicit 280–360 and 320–390 line forecasts; extract fixture-only prerequisite if needed. |

## Amendment — S4b runtime/proof split (2026-07-21)

This amendment supersedes only the single-work-unit S4b review plan above. Base `cf1d3c15fcddf0e8c6164d82147e267a4075d7ca` already contains S4a, the timeout fixtures, CI #75, and isolated PostgreSQL harness #76. The current candidate is **479 authored app/test lines**: 287 tracked, 114 coordinator-test lines, and 78 route-test lines. There is no size exception; delivery is `auto-chain`, `feature-branch-chain`, as explicitly authorized because `.github/workflows/deploy.yml` deploys every push to `main`.

### Decision and merge order

| Slice | Base and finish | Exact files/behavior | Budget |
|---|---|---|---|
| **S4b-runtime** | Head `feat/ctacte-s4b-timeout-runtime`; PR base `feat/ctacte-s4b-timeout-complete`, both initially at `cf1d3c15fcddf0e8c6164d82147e267a4075d7ca`; finish with runtime behavior and its minimum safety coverage green. | Modify `ctacte-comprobante.ts`, `pdf-generator.ts`, `pdf-generator.test.ts`, `ctacte-mutations.ts`, and `metrics.ts`; create `ctacte-comprobante.timeout.test.ts`. This delivers the fixed owner/follower deadline, lease heartbeat/fencing, abort and observed cleanup, typed timeout, `504`, bounded logs/counter, and redacted unexpected 5xx. The 4 coordinator cases cover timely owner, exact owner deadline/late rejection, follower non-mutation/takeover, and terminal replay; the PDF suite directly covers semaphore/page cleanup. | **351 exact** = 237 tracked after excluding the 50-line PostgreSQL proof hunk + 114 coordinator test. Hard stop at 400. |
| **S4b-proof** | Head `test/ctacte-s4b-timeout-proof`, created from the tracker after the runtime child merge; PR base `feat/ctacte-s4b-timeout-complete`; finish when direct 5b.1/5b.7 evidence passes. | Create `routes/ctacte-comprobante.timeout.test.ts`; modify `ctacte-comprobante.timeout.test.ts` and `ctacte-comprobante.postgres.integration.test.ts`. Retain the existing 78 route lines and 50 PostgreSQL lines, then add direct fake-clock ordering/late-settlement cases and harness-backed actual follower-deadline plus late-owner printed-audit fencing. No production files. | **128 exact present**; **250–340 estimated final**. Stop before 400; missing evidence blocks closure rather than moving behavior or accepting an exception. |

Create tracker head `feat/ctacte-s4b-timeout-complete` from exact base `main@cf1d3c15fcddf0e8c6164d82147e267a4075d7ca`; its draft/no-merge tracker PR targets `main`. Review and merge the 351-line runtime child into the tracker, never `main`. Create proof from that tracker runtime-merge SHA, review its 250–340-line child diff against the tracker, then merge it into the tracker. If `main` advances, update the tracker with current `main` and rerun all evidence. Only after both child receipts, 5b.1/5b.7/5b.10 closure, and combined verification may the tracker PR become ready and merge once to `main`; that single complete merge is the only deployment-triggering event.

```text
main@cf1d3c15 ← tracker PR — head feat/ctacte-s4b-timeout-complete (draft/no-merge)
                       ↑ runtime child PR — head feat/ctacte-s4b-timeout-runtime (351)
                       ↑ proof child PR   — head test/ctacte-s4b-timeout-proof (250–340)
```

### Verification and rollback

**Runtime commands**

- `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.timeout.test.ts src/modules/socios/forms/pdf-generator.test.ts`
- `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.test.ts`
- `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts src/modules/socios/forms/ctacte-comprobante.postgres-harness.test.ts`
- `pnpm --filter @athlos/api typecheck` and `git diff --check`

**Proof commands**

- Run the timeout, PDF, route-timeout, PostgreSQL integration, and isolated-harness files together with `ATHLOS_TEST_DATABASE_URL`; retain exact test counts.
- Rerun typecheck and diff checks; route proof MUST assert unlabeled Prometheus exposition. Direct PostgreSQL proof MUST use bounded barriers, not elapsed-wall-clock assertions.

Before tracker integration, runtime rollback reverts its six paths and proof rollback removes only its route test and added coordinator/PostgreSQL hunks. Before the tracker reaches `main`, drop/revert proof then runtime inside the tracker with no deployment. After final integration, revert the single complete tracker merge; S4a, `0035`, fixtures, and harness remain intact.

### Threat matrix

| Boundary | Applicability | Safe/failure behavior and RED proof |
|---|---|---|
| Documentation-like paths | N/A — no executable-file classification. | None. |
| Git repository selection | N/A — no runtime Git integration. | None. |
| Commit state | N/A — no commit automation. | None. |
| Push state | N/A — no push automation. | None. |
| PR commands | N/A — no PR command composition. | None. |
| Puppeteer process/resource integration | Applicable. | Abort before/inside page work closes at most once, removes listeners, releases the semaphore, and observes late rejection; failure is bounded and never publishes fenced bytes/audit. Runtime PDF RED tests cover cleanup; proof adds both late-settlement orders and PostgreSQL printed-audit fencing. |

### Blocker

The split is design-complete, but S4b-proof content is not yet implemented. Current 4/4 timeout and 7/7 PostgreSQL integration+harness results are necessary but insufficient for direct 5b.1/5b.7 evidence; 5b.10 remains blocked.
