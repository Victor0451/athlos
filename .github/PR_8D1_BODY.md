Closes #N

> _Issue reference to be filled at PR open time._

## feat(api): socio form emit (solicitud-inscripcion) with puppeteer (PR 8d.1)

Backend implementation of the `athlos-socio-form-emit` SDD change (PR A). Server-renders the Gorriti `solicitud-inscripcion` PDF from `/socios/[id]` using puppeteer, pre-fills titular data, emits a `SOCIO_FORM_EMITTED` audit with SHA-256, and ships chromium in the runner stage of the Dockerfile. **No frontend changes** — the `EmitirSolicitudButton` + page wiring ship in PR 8d.2.

---

## SDD artifacts

- Proposal: [`openspec/changes/athlos-socio-form-emit/proposal.md`](../../blob/feat/socio-form-a/openspec/changes/athlos-socio-form-emit/proposal.md)
- Design: [`openspec/changes/athlos-socio-form-emit/design.md`](../../blob/feat/socio-form-a/openspec/changes/athlos-socio-form-emit/design.md)
- Tasks: [`openspec/changes/athlos-socio-form-emit/tasks.md`](../../blob/feat/socio-form-a/openspec/changes/athlos-socio-form-emit/tasks.md)
- Specs (1 NEW + 3 DELTAs): [`openspec/changes/athlos-socio-form-emit/specs/`](../../tree/feat/socio-form-a/openspec/changes/athlos-socio-form-emit/specs)

## Summary

- New `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` endpoint
  - Returns `application/pdf` with `Content-Disposition: inline; filename="..."`
  - Any authenticated operator (mirrors `/notes` + `/attachments` precedent — no role gate)
  - 404 SOCIO_NOT_FOUND when socio row absent, 401 missing JWT
- New `apps/api/src/modules/socios/forms/` module:
  - `semaphore.ts` — hand-rolled FIFO semaphore (closure-owned `acquire(fn)` → finally release, no manual `acquire`/`release` exposed)
  - `template-renderer.ts` — pure `{{var}}` substitution with HTML escape
  - `filename.ts` — NFD-strip + non-alphanumeric → `_` + UPPERCASE filename builder
  - `pdf-generator.ts` — puppeteer singleton wrapper (`--disable-dev-shm-usage --no-sandbox --disable-setuid-sandbox`)
  - `emit-form.ts` — orchestration: load socio → render → generate → SHA-256 → audit
  - `solicitud-inscripcion.template.ts` / `solicitud-inscripcion.styles.ts` / `logo.ts` — string constants (logo baked as base64 data-URI)
- Migration: `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` (hand-written, idempotent via `ADD COLUMN IF NOT EXISTS`)
- Drizzle schema widened: `socios.fecha_nacimiento DATE NULL`
- Audit action `SOCIO_FORM_EMITTED` added to `packages/audit/src/emitter.ts` const-map
- Dockerfile multi-stage: chromium + libs installed in RUNNER (not builder) — image size impact +~170 MB (one-time)
- ENV: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`, `PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"`

## Commits (8, work-unit split)

| #   | SHA           | Subject                                                                   | ~LoC     |
| --- | ------------- | ------------------------------------------------------------------------- | -------- |
| A.1 | `cb741f0`     | `feat(db+audit): add fecha_nacimiento column + SOCIO_FORM_EMITTED action` | +68 / −3 |
| A.2 | `a831e6b`     | `feat(api): add semaphore, template renderer, and filename helpers`       | +490     |
| A.3 | `0800912`     | `feat(api): add solicitud-inscripcion template, styles, and logo`         | +360     |
| A.4 | `9a02a38`     | `feat(api): add puppeteer pdf-generator with semaphore`                   | +885     |
| A.5 | `8dca4a8`     | `feat(api): add emit-form service with audit integration`                 | +450     |
| A.6 | `ed412eb`     | `feat(api): add GET socio form emit route`                                | +317     |
| A.7 | `72c6b73`     | `chore(deploy): multi-stage dockerfile for puppeteer chromium`            | +26      |
| A.8 | (this commit) | `docs(pr): add PR 8d.1 body for socio form emit backend`                  | +160     |

## Review summary

### `review-risk` (security)

- **Route auth** ✅ — `requireAuth()` preHandler enforced on the route; no role gate (matches `/notes` + `/attachments` precedent). 401 returned when `request.operator?.sub` is missing.
- **Filename injection** ✅ — `sanitizeApellido` (NFD-strip + `[^a-zA-Z0-9]+` → `_` + UPPERCASE) + `escapeFilename` (`["\r\n]` → `_`) form two layers of defence against header injection. Asserted end-to-end in `socio-forms.test.ts` (no CR/LF in `Content-Disposition`).
- **Audit metadata integrity** ✅ — exact 4-key shape (`socio_id`, `form_id`, `sha256`, `byte_size`) pinned by `emit-form.test.ts` and `emitter.test.ts`. SHA-256 verified as 64-char lowercase hex matching `crypto.createHash('sha256').update(pdf).digest('hex')` independently.
- **Semaphore correctness** ✅ — closure-owned `acquire(fn)` releases the slot in `finally` so a throw inside the task can NEVER leak the slot. Verified by `semaphore.test.ts` (6 tests: 3 concurrent, 4th waits, FIFO, finally on throw, no-leak after 20 sequential, capacity validation).
- **Migration safety** ✅ — `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is idempotent. NULL allowed so no backfill required. Apply runbook below.
- **Puppeteer launch args** ✅ — exact triple `['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']` per design §6.

### `review-reliability` (correctness)

- **Missing fechaNacimiento** ✅ — `emit-form.test.ts` covers NULL → blank render; the `..../..../......` dotted-line span stays visible.
- **Special chars in apellido** ✅ — `filename.test.ts` covers `Pérez → PEREZ`, `O'Brien → O_BRIEN`, `García López → GARCIA_LOPEZ`, empty, only-special-chars, leading/trailing `_`.
- **Concurrent emissions** ✅ — `pdf-generator.test.ts` drives 4 concurrent `generate()` calls with a blocking pdf mock and asserts peak in-flight = 3 + 4th completes successfully (FIFO + graceful backpressure).
- **Puppeteer launch failures** — wrapped by the error handler → 500. Not exercised explicitly (would require a real chromium + missing libs); the generator mock covers all behavioural paths.
- **Best-effort audit** ✅ — `emit-form.test.ts` asserts that an audit INSERT failure is `console.error`'d and the PDF response still returns 200 (the audit-events table is append-only and a missed row is recoverable from the operator session log).
- **Determinism** ✅ — SHA-256 of identical PDF bytes is identical (the route uses `crypto.createHash` on the in-memory buffer, never reads from disk).
- **Regression risk** — 394 baseline tests pass + 51 new tests added = 445 total. Zero pre-existing tests were modified.

### Warnings (logged, not blocking)

- Image size impact: +~170 MB (one-time). Chromium + libs added to RUNNER stage (not builder); the `apk add --no-cache` keeps the layer lean.
- Audit metadata shape is a free-form JSONB column — `audit-logger` spec delta pins the 4-key contract. Future actions must NOT reuse the same shape without re-pinning.
- `pdf-parse` would be the natural dep for a golden-file test, but it's NOT included in this PR (kept under 1000 LoC; the visual correctness is verified by manual smoke in prod + the deterministic substring assertions in the route test).
- The puppeteer browser lives in the API process memory (no separate worker) — memory pressure under high concurrent emission is bounded by the semaphore cap of 3.

### Verdict

- `review-risk`: **PASS** — 0 critical, 0 warnings requiring pre-merge fix
- `review-reliability`: **PASS** — 0 critical, 3 logged warnings

## `size:exception` note

This PR forecast ~1000 LoC (actual: see `git diff --stat origin/main..HEAD` in CI). The 8 work-unit commits are tightly coupled — the route layer is not useful without the service layer, the service layer is not useful without the renderer/filename/semaphore, etc. Splitting would require parallel maintenance of multiple incomplete features. User-approved `size:exception` (design §12 recommended this explicitly: "the 9 commits are tightly coupled … recommend NOT splitting").

## Pre-existing CI failures

Documented as out-of-scope per the same pattern as PR 8c.1 (`athlos-socio-legajo`):

- `gastos.test.ts:367` lint warning (`no-console`) — pre-existing, unrelated to this change.
- Labeler / Docker build smoke drift — pre-existing, unrelated to this change.

These do NOT block this PR. The maintainer merges with `--admin` if CI gates against them.

## Migration apply runbook (post-merge)

The migration `packages/db/drizzle/0030_socio_fecha_nacimiento.sql` is **NOT** applied in CI (drizzle pipeline is broken in prod per handover #253). Apply it post-merge via:

```bash
docker exec -i athlos-db-1 psql -U athlos -d athlos \
  < packages/db/drizzle/0030_socio_fecha_nacimiento.sql
```

Verify:

```sql
\d "socios"."socios"
-- expect a "fecha_nacimiento" column of type date, nullable
```

## Post-merge deploy steps

1. Apply the migration (command above).
2. Rebuild the API image: `docker compose build api`.
3. Recreate the API container: `docker compose up -d --force-recreate api`.
4. Smoke test the endpoint:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
     -H 'content-type: application/json' \
     -d '{"username":"…","password":"…"}' | jq -r .access_token)
   curl -s -o /tmp/solicitud.pdf \
     -H "authorization: Bearer $TOKEN" \
     http://localhost:3001/api/v1/socios/<socio-id>/forms/solicitud-inscripcion.pdf
   file /tmp/solicitud.pdf  # expect: PDF document, PDF version 1.7
   ```

## Out of scope for this PR

- Frontend `EmitirSolicitudButton` + page wiring → PR 8d.2 (depends on this PR merged).
- Other forms beyond `solicitud-inscripcion` — the module folder is structured to accept more later.
- PDF caching / `<iframe>` preview / backfill of `fecha_nacimiento` for existing socios.
- Deploy chore — out of scope; PR is code-only.

## Checklist

- [x] 8 work-unit commits, conventional commit messages
- [x] No `--no-verify`, no amend-after-push, no co-authored-by trailers
- [x] `pnpm --filter @athlos/api typecheck` clean
- [x] `pnpm --filter @athlos/db typecheck` clean
- [x] `pnpm --filter @athlos/audit typecheck` clean
- [x] `pnpm --filter @athlos/api lint` clean (1 pre-existing unrelated warning)
- [x] `pnpm --filter @athlos/audit test:run` — 7 passed
- [x] `pnpm --filter @athlos/api test:run` — 445 passed | 2 pre-existing skipped
- [x] `apps/web/**` untouched (frontend is PR 8d.2)
- [x] No production deploy / no docker container recreate / no PM2 restart
- [x] Migration apply OUT OF SCOPE (post-merge runbook in PR body)
