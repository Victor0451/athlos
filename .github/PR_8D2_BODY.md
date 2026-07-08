## feat(web): Emitir Solicitud button in /socios/[id] (PR 8d.2)

Closes #N

> _Issue reference to be filled at PR open time._

Frontend slice of the `athlos-socio-form-emit` SDD change. Adds the
"Emitir Solicitud" header button on `/socios/[id]` that opens the
server-rendered `solicitud-inscripcion.pdf` in a new tab. The backend

- route + audit were shipped in PR 8d.1 (merged at `c8c901e`).

---

## SDD artifacts

- Proposal: [`openspec/changes/athlos-socio-form-emit/proposal.md`](openspec/changes/athlos-socio-form-emit/proposal.md)
- Design: [`openspec/changes/athlos-socio-form-emit/design.md`](openspec/changes/athlos-socio-form-emit/design.md)
- Tasks: [`openspec/changes/athlos-socio-form-emit/tasks.md`](openspec/changes/athlos-socio-form-emit/tasks.md)
- Specs (1 NEW + 3 DELTAs): [`openspec/changes/athlos-socio-form-emit/specs/`](openspec/changes/athlos-socio-form-emit/specs/)
- PR 8d.1 (backend, MERGED): https://github.com/Victor0451/athlos/pull/20

## Summary

- New client wrapper `apps/web/src/lib/api/forms.ts` — `getFormUrl(socioId, formId)` returns `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/${formId}.pdf`, with safe handling of empty / trailing-slash env values.
- New component `apps/web/src/components/socios/EmitirSolicitudButton.tsx` — stateless, lucide `Printer` icon, secondary-variant styling matching `Editar` / `Dar baja`, opens the PDF in a new tab via `window.open(url, '_blank', 'noopener,noreferrer')` and fires a `notify('info', 'Generando PDF…')` toast so the operator gets immediate feedback while puppeteer renders on the server.
- Page wiring in `apps/web/src/app/(authed)/socios/[id]/page.tsx` — header action cluster split into two groups separated by a 1 px `ink-100` divider: "always visible" (`Emitir Solicitud`, any authenticated operator) + ADMIN-gated (`Editar`, `Dar baja` / `Reactivar`). Button is disabled when `socio.direccion` is empty per the ui-design delta R7.

## Commits (3 work units)

| #   | SHA prefix | Subject                                                   | Approx LoC |
| --- | ---------- | --------------------------------------------------------- | ---------- |
| B.1 | `0c39b48`  | `feat(web): add forms client wrapper`                     | +111       |
| B.2 | `cba5a16`  | `feat(web): add EmitirSolicitudButton component`          | +172       |
| B.3 | (this)     | `feat(web): wire Emitir Solicitud button on /socios/[id]` | +~30       |

**Total LoC**: well under the 400-line budget (no `size:exception`).

## Changes table

| File                                                            | Change                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/api/forms.ts`                                 | NEW — pure URL composer                                                                     |
| `apps/web/src/lib/api/forms.test.ts`                            | NEW — 4 tests (URL shape, trailing-slash, empty base, id passthrough)                       |
| `apps/web/src/components/socios/EmitirSolicitudButton.tsx`      | NEW — stateless button + Printer icon + window.open + toast                                 |
| `apps/web/src/components/socios/EmitirSolicitudButton.test.tsx` | NEW — 5 tests (render, window.open args, toast, disabled, id interpolation)                 |
| `apps/web/src/app/(authed)/socios/[id]/page.tsx`                | EDIT — header action cluster split + EmitirSolicitudButton wiring                           |
| `apps/web/src/app/(authed)/socios/[id]/page.test.tsx`           | EDIT — 3 new scenarios (header rendering, OPERADOR visibility, disabled-on-empty-direccion) |
| `.github/PR_8D2_BODY.md`                                        | NEW — this file                                                                             |

## Review summary (fresh-context, inline)

### `review-readability`

- `getFormUrl(socioId, formId)` — single responsibility, parameterised for future forms (locked to `SocioFormId` union so a typo fails TypeScript). Helper `readApiBaseUrl()` is private and named to reveal intent.
- `EmitirSolicitudButton` — stateless; JSDoc explains `window.open` rationale (defence against reverse-tabnabbing) AND the `disabled` semantics (visible-not-gone). Tailwind matches existing `Editar` / `Dar baja` literal classes (no new variants invented).
- Page wiring — comment block narrates the split ("always" + ADMIN-gated); divider is `aria-hidden` so screen readers don't announce an empty separator. Minimal diff: the existing `Editar` / `Reactivar` / `Dar baja` buttons are unchanged.

### `review-reliability`

- URL composition tests cover the four real-world configs: set base (80 % case), trailing slash misconfig, empty env (CI / dev without `.env.local`), and arbitrary socioId passthrough.
- Component tests cover the full click side-effect contract: `window.open` is called with the exact URL + `'_blank'` + `'noopener,noreferrer'`, `notify('info', /generando pdf/i)` fires, disabled button short-circuits both side effects (React suppresses click on disabled).
- Page tests cover header rendering for ADMIN + OPERADOR users (both should see the button), disabled prop passthrough when `socio.direccion === ''`.
- 610 tests pass after this slice (598 pre-existing + 12 new); zero pre-existing tests modified.
- Vitest mock discipline: ≤ 3 mocks per test file (`forms.ts` uses `vi.stubEnv`; `EmitirSolicitudButton` mocks `notify` + `window.open`; page test inherits existing `notify` mock). No CSS-class assertions; all behavioural.

### Warnings (logged, not blocking)

- Server PDF render takes ~1–3 s on the dev box (chromium cold launch). The `info` toast gives the operator immediate feedback; the actual PDF appears in the new tab when the server responds 200. No polling / progress indicator in v1 (per design).
- The toast copy is Spanish (`Generando PDF…`) matching the `athlos-toast-primitivo` audit-timeline copy style.
- Future form ids must extend the `SocioFormId` union in `forms.ts` + the contract of `getFormUrl`. The TS literal-union gate makes drift impossible by design.

## Test plan

- [x] `pnpm --filter @athlos/web test:run -- src/lib/api/forms.test.ts` — 4 / 4 pass
- [x] `pnpm --filter @athlos/web test:run -- src/components/socios/EmitirSolicitudButton.test.tsx` — 5 / 5 pass
- [x] `pnpm --filter @athlos/web test:run -- src/app/(authed)/socios/[id]/page.test.tsx` — 24 / 24 pass (21 pre-existing + 3 new)
- [x] `pnpm --filter @athlos/web test:run` (full suite) — 610 / 610 pass
- [x] `pnpm --filter @athlos/web typecheck` — clean
- [x] `pnpm --filter @athlos/web lint` — clean

## Pre-existing CI failures (unrelated)

The repo carries pre-existing CI failures that recur on every PR (same pattern as PR 8c.1 / PR 8d.1):

- `gastos.test.ts:367` lint warning
- labeler / dependency-review drift
- Docker build smoke `log_error`

None of these are introduced by PR 8d.2. Maintenance PR follow-up already tracked in the `athlos-socio-legajo` archive handoff (carry-over #1).

## Out of scope for this PR

- No backend changes — apps/api / packages/db / packages/audit untouched.
- No migration or docker deploy — those shipped in PR 8d.1.
- No rebuild / PM2 restart of the web container (the live `NEXT_PUBLIC_API_BASE_URL` is unchanged for this slice).
- No new `size:exception` — total LoC well under 400.

## Rollback

Reverting removes the new files + undoes the page.tsx edit. No state to migrate. Safe.

## SDD pre-merge checklist

- [x] All 3 PR B tasks (`B.1`–`B.3`) committed in order with conventional commit messages
- [x] No `--no-verify`; no amend
- [x] 1:1 source:test ratio on new files
- [x] 1:1+ ratio on edited file (`page.test.tsx` extended, not replaced)
- [x] `pnpm typecheck` + `pnpm lint` clean
- [x] Full web test suite green
- [x] PR title + body match the locked orchestrator contract
