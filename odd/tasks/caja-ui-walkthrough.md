# Feature: caja-ui-walkthrough (local UI/UX walkthrough stack)

## Goal

`pnpm caja:ui` — one command that brings up the FULL local stack for UI/UX review of every
caja implementation: real disposable PostgreSQL (canonical chain applied), seeded demo data,
the real Fastify API, and the real Next.js web app, with known login credentials and a screen
map (which page belongs to which delivered implementation). Ctrl-C tears the whole stack down
(container included) via the disposable-postgres wrapper.

## Decisions

- Runner shape matches the maintainer-approved simulator pattern (`pnpm caja:sim`): one
  command, disposable by design, zero persistence.
- Reuses `createCanonicalHarness` for chain + seeds (same machinery as the tests and the
  simulator); seeds are re-applied on every run for a clean, predictable walkthrough state.
- Real login (no QA-mode shortcut): the setup seeds an operator with a real `hashPassword`
  hash so the UI/UX is exercised exactly as delivered, including the login screen.
- Orchestration lives in `scripts/caja-ui.sh` (bash, wrapped by `scripts/lib/disposable-postgres.sh
run --caller caja-ui`) because it supervises two dev servers and forwards signals; data setup
  lives in a tsx script following the `caja-sim.ts` precedent.
- Feature flags for the caja UI are forced on for the walkthrough (`DUES_CASH_ENABLED`,
  `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_AGREEMENTS_ENABLED`, `DUES_ASSESSMENT_ENABLED`);
  they default to false in production config, so this only affects the walkthrough stack.
- Dev-only JWT secrets are generated per run inside the script; nothing secret is committed.

## Tasks

- [x] T1: `apps/api/src/scripts/caja-ui-setup.ts` — apply canonical chain + seed walkthrough
      data (operator with real password hash, socios, obligations, gasto).
- [x] T2: `scripts/caja-ui.sh` — env wiring (DATABASE_URL/JWT/LEGACY_DB_PATH/flags for api and
      web), spawn api dev + web dev, healthchecks, print URLs + credentials + screen map,
      signal-safe child teardown.
- [x] T3: Wire `caja:ui` runner in root `package.json`.
- [x] T4: Verify: typecheck + eslint + prettier; full boot smoke — PG up, chain applied,
      `GET /health` 200, real login over HTTP returns tokens, web `/login` renders.
- [x] T5: Close: report screen map per implementation; commit pending maintainer decision.

## Verification evidence

- typecheck api+db, eslint (exit 0), prettier — clean on all changed files
- Full boot smoke (real ephemeral PG, single clean run): chain + seeds OK (operator
  `simulador`/ADMIN, 3 socios, 6 open obligations, 1 gasto), API `/health` 200, real login
  over HTTP → 200 with access/refresh tokens, login through the web proxy → 200, web
  `/login` → 200, `GET /me` with the token → `simulador` ADMIN, stack stable at +15s,
  teardown clean (children killed, container removed)
- Regression after touching `cash-scenario.ts` (helper exports): `pnpm test:cash-scenario`
  → 2/2 on real ephemeral PG; db harness vitest 15/15 (earlier, after the runtime fix)
- Pre-existing findings dispositioned (not candidate-caused): `container.ts:126` and
  `idempotency.ts:31` (defer — untouched files on main), gitleaks on
  `ctacte-comprobante.golden.test.ts` (false-positive — fixture `idempotencyKey` string,
  pre-existing b259c9d8)

## Incidents found during verification (fixed in this feature)

1. `packages/db/src/community-work-approval.harness.ts` used `__dirname`, which breaks under
   tsx/ESM — switched to `import.meta.dirname`, verified on BOTH runtimes (tsx smokes +
   vitest 15/15). Also guarded `new URL()` and the journal `JSON.parse` with descriptive
   errors.
2. Simulator lifecycle race: piped/script-mode REPL does not await one line's promise before
   evaluating the next, so teardown could race in-flight scenario work (PG deadlocks 40P01,
   missing relations 42P01). Fix: `inflight` promise chain; shutdown awaits it before
   `scenario.end()`.
3. Walkthrough setup wiped its own work: `harness.end()` runs `resetDatabase()`
   (DROP SCHEMA CASCADE) — the setup's `finally` called it on the way out, leaving the
   database empty behind a success banner (login 500, `job_runs` 42P01). Fix: close
   `harness.pool` only.
4. Period convention: `dues_generation_receipts_period_check` requires
   `period_start = 1st of month` and `period_end = start + 1 month` (exclusive) — seeds
   aligned; receipt FK requires a real operator (seed the operator first).
5. `IMPLEMENTATION_CONTACT_RECIPIENT` is required outside NODE_ENV=test — dev placeholder in
   the orchestrator.
6. Helper consolidation: `lastCanonicalIndex` + `withDatabaseName` now exported from
   `cash-scenario.ts` (dedupe — jscpd flagged the copies); the transient support module was
   removed.
7. Empty /tesoreria (maintainer feedback): the page lists cash shifts and none were seeded.
   The setup now seeds treasury state through the real `CashDeskService` (audit + idempotency
   rows match the shipped flow): one CLOSED `front-desk` shift with a balanced reconciliation
   that includes the seeded gasto as an EXPENSE tender, plus one OPEN `ventanilla-2` shift to
   operate live. Verified end-to-end: authenticated `GET /api/v1/treasury/shifts` returns 2
   shifts; shift detail returns the close with 1 movement; web renders /tesoreria (200).
8. Stale-stack trap: relaunching `caja:ui` while a previous stack still runs dies with a
   cryptic EADDRINUSE from `next dev`. The orchestrator now preflights both ports and exits
   with an actionable message.
9. Role boundary in seeds: the designed caja journey is the OPERADOR personal Caja, but the
   service gates expense inclusion and close behind finance roles (Units 3c/4a hide those
   actions from OPERADOR). The setup now seeds a second operator `cajero` (role O) who owns
   both demo shifts and opens them; the ADMIN performs the expense inclusion and the close,
   matching the shipped role boundaries. Verified: cajero login 200, own shifts 2 (1 OPEN +
   1 CLOSED), web /tesoreria 200.

10. Eligible-account picker friction (maintainer feedback): the picker searched by NAME only
    (typing a dotted code like 1.1.3.02 matched nothing), required clicking the button (no
    Enter) and gave no hint about what to type. Fixed: the client sends `code` for dotted-
    numeric queries and `name` otherwise (API matches both fuzzily, diacritics-insensitive),
    the form submits on Enter, and the input carries a placeholder + hint with examples.
    Covered by a new lib test (6/6) plus the existing picker/form tests (10/10).

11. MANUAL tender rejected from the UI (maintainer feedback): the shipped policy (service
    validation + 0072 DB `manual_reason_check`) requires a non-empty `reason` for every
    MANUAL tender, in addition to the account description — but the walkthrough form never
    sent `reason`, so every manual movement failed with VALIDATION_ERROR. Fixed in the form:
    the single human input is sent as both `description` and `reason` (label now
    "Descripción / motivo"); tests updated and extended (16/16 green). Verified end-to-end:
    manual EXPENSE 5.2.04 'Servicios luz sede' registered via the exact form payload (HTTP 201) and visible in the shift detail with account attribution. Noted during the smoke:
    collections settlements auto-attribute to 4.1.01 Cuotas sociales (Unit 7A behavior).

12. Open-shift movement list (maintainer feedback): the OPERADOR view only offered the load
    form — no way to see what had landed in the open shift (manual movements, included
    gastos, automatic production). Added `OpenShiftMovements`: a read-only list fed by the
    existing shift-detail endpoint (movements + expected CASH are U9-A additive fields the
    API already returns), rendered under the form and refetched after every confirmed
    command. Page/component suites 56/56 green; typecheck + prettier clean.

## UI/UX refactor (erpgw-inspired, requested by maintainer)

Maintainer provided 5 erpgw screenshots (`/run/media/vlongo/Archivos/fotos atlhos/`) showing
the legacy cash module UX: KPI cards row, Ingresos/Egresos columns with load buttons,
dropdown account picker with built-in search, and a close-confirmation summary. Delivered
in steps, each verified:

- **P1 — AccountCombobox** (`components/treasury/AccountCombobox.tsx`): select-like trigger
  that opens the full eligible-account list with an always-visible client-side search
  (diacritics-insensitive, matches code and name), keyboard navigation (arrows/Enter/Escape),
  click-outside close, aria listbox/option semantics. Replaces the old type-then-press-search
  picker (deleted with its tests). New lib fn `fetchAllEligibleAccounts` (one fetch, client
  filter) + `normalizedAccount` helper.
- **P2 — Load modals**: `ManualMovementForm` now renders inside the shared `Modal` with
  erpgw-style title ("Cargar Ingreso"/"Cargar Egreso"), footer submit via `form=` id
  association, and `initialDirection` from the button that opened it. `onDone` closes the
  modal after a confirmed record.
- **P3 — OperatorCashDashboard** (`components/treasury/OperatorCashDashboard.tsx`): color
  KPI row (Saldo Inicial, Ingresos en Efectivo, Egresos en Efectivo, Efectivo Esperado — the
  server-computed value), plus Ingresos (green; grouped Producción automática with subtotal
  - Ingresos manuales with subtotal) and Egresos (red; cuenta/descripción/importe) columns,
    with the load buttons in the column headers. Replaces `OpenShiftMovements` wholesale.
- Evidence: typecheck web OK; treasury suites 77/77 (page 19 + form 7 + combobox 8 +
  dashboard 6 + close-history + lib 6); full web suite previously 136 files/1237 tests green.
- Tooling note: `@vitest-environment jsdom` pragma + explicit React import added to the two
  new test files so they also run under runners that bypass `apps/web/vitest.config.mts`
  (plugin-react + jsdom live in that config).

- **P5 — Copy + jerarquía del listado** (feedback maintainer: "tengo que leerlo dos veces"):
  header del OPERADOR reescrito ("Tu turno del día: cobrá en cobranza, registrá ingresos y
  egresos, y dejá todo listo para el cierre."); el hint de formato de importes se movió al
  campo del modal; las filas de movimiento ahora son tarjetas estructuradas: título
  destacado (descripción o "Cobro de cuotas"/"Gasto incluido"), meta secundaria en gris
  (cuenta · método · hora) e importe alineado a la derecha con signo y color
  (+verde/−rojo). Egresos reutiliza la misma fila (jerarquía única).
- **P6 (entregado) — editar/eliminar movimientos manuales vía reversión append-only**:
  migración `0074_manual_tender_reversals` (columna `reverses_tender_id` + unique parcial →
  una reversión por movimiento), servicio `CashDeskService.reverseTender` (own-shift MANUAL,
  replay por caller_key, bloquea re-reversión y reversión de reversiones, auditoría), ruta
  `POST /api/v1/.../tenders/:tenderId/reverse`, lib `reverseCashTender`, botones
  Editar/Eliminar en filas MANUALES del dashboard, modal de eliminación con motivo
  (alertdialog), edición = reversión + modal prellenado (hook `onBeforeRecord` con ref
  once-per-open y tolerancia a 409 de reversión ya existente). Frontera de migración
  actualizada en 4 tests; `dues.test.ts` refactorizado a constantes SQL nombradas (los
  comentarios inline no suprimían al scanner). Evidencia: 330/330 tests db en PG real
  (cadena con 0074 aplica limpio), 77/77 tesorería web, tsc api/db/web OK, eslint 0, smoke
  e2e: crear 201 → reversar 201 (EXPENSE inverso) → segunda reversión 409 → detalle muestra
  ambos movimientos y el efectivo esperado intacto.

- **P6 fix UX — estados de reversión visibles**: el usuario no distinguía filas revertidas
  (botones sobre filas muertas → 409 "already reversed"; y la fila original parecía no haber
  cambiado tras editar). Fix aditivo: `detail()` expone `reverses_tender_id` + `reason` por
  movimiento (SELECT + DTO interno + payload público), decoder web los decodifica, y el
  dashboard deriva `reversedIds` del mismo payload: filas de reversión muestran su motivo
  como título + badge "Reversión", los originales revertidos muestran badge "Revertido", y
  ambos estados ocultan Editar/Eliminar (el servidor igual los rechazaría). Verificado en
  vivo: payload con markers correctos, 72/72 tesorería web, tsc api/web OK.

- **P6 fix UX 2 — listado sin filas fantasma**: feedback del usuario: ver originales +
  reversiones convive mal para un operador. El dashboard ahora excluye los pares revertidos
  del listado y de los subtotales (neto cero exacto, KPIs consistentes) y agrega un
  `<details>` plegable "N movimientos editados o eliminados en este turno" con el par
  (original → motivo) para auditoría. Test nuevo cubre: par oculto, KPIs intactos, resumen
  expandible. 73/73 tesorería web.

- **P7 — primitivo ui/Alert + feedback visual consistente**: feedback del usuario: los
  mensajes (errores de validación, resultados de comandos, resumen de reversiones) eran
  texto plano que se perdía. Nuevo primitivo `ui/Alert.tsx` (Gorriti: tonos
  error/success/info/warning con fondos `*-soft`, borde izquierdo de acento, ícono lucide,
  role ARIA por tono — alert para error/warning, status para success/info). Aplicado en:
  errores del ManualMovementForm, commandError/message/refreshWarning de la página de
  tesorería, error de carga del dashboard, y el resumen plegable de reversiones re-estilizado
  (card info con ícono History, badge de conteo, filas con Undo2 y motivo en negrita).
  137/137 tests, tsc OK. Convención futura: todo feedback de superficie usa `Alert`, nunca
  `<p role="alert">` suelto.

- **P8 — jerarquía visual del modal + combobox en portal (feedback con capturas)**:
  (a) form sin tarjeta interna ni título redundante; labels `font-medium ink-700`, inputs
  `ink-200`, hints `text-xs ink-500`;
  (b) eliminados los radios de dirección — la direción la implica el botón que abre el
  modal (`initialDirection`);
  (c) AccountCombobox: dropdown en **portal con fixed positioning** anclado al trigger
  (flip up si no hay lugar), re-anclado en scroll/resize, y cierre por pointerdown solo
  fuera de trigger Y panel (el scrollbar del propio panel no lo cierra). Lecciones: React
  propaga eventos de portal por el árbol React → handler duplicado panel+raíz dispara dos
  veces por tecla (solo en panel); `getByText` solo matchea nodos de texto directos.
  138/138 tests, tsc OK.

- **P8b — infra de tests a prueba de runners**: el check runner corre desde la raíz sin la
  config de la app → JSX clásico sin binding ("React is not defined"). Fix: `vitest.config.ts`
  raíz (jsx automatic + alias `@` → apps/web/src + setupFiles de la app), `cleanup()`
  explícito en `vitest.setup.ts` (runs sin globals acumulaban renders), y pragma
  `@vitest-environment jsdom` restaurado en ManualMovementForm/page tests. Verificado en
  AMBOS runners: 26/26 root, 138/138 app. Follow-up nuevo: Modal/CashCloseHistory tests
  siguen fallando desde root por requisitos propios (no editados esta sesión).

## Follow-ups (pre-existing, outside candidate scope)

- gitleaks `generic-api-key` matches `idempotencyKey`/`callerKey` fixture strings across
  pre-existing test files (ctacte-comprobante.golden, audit, ctacte-mutations, ...).
  False positives on test data; systemic fix is a repo-level `.gitleaksignore` or renaming
  the fixture fields — maintainer follow-up issue.
- `container.ts:126` (`as unknown as` without SAFETY comment) and `idempotency.ts:31`
  (returns `unknown`) — pre-existing style-rule hits on main, deferred this session.
- Housekeeping: 3 copies of `gentle-ai` in PATH; stale review lineages abandonable; branch
  `feat/caja-scenario-harness` still on origin.

## Rollback boundary

Remove `apps/api/src/scripts/caja-ui-setup.ts`, `scripts/caja-ui.sh`, and the `caja:ui` script
entry; no unrelated behavior touched.
