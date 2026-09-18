# Caja — corte de caja (workflow del operador)

Decisión de diseño aprobada por el maintainer (4 respuestas):

1. **Un módulo único** para ADMIN/TESORERO/OPERADOR: mismo dashboard de caja propia; las
   diferencias son gates por acción (operador: movimientos + corte propio; finanzas:
   recuperación forzada + visión cruzada), no vistas separadas.
2. **Turno auto-gestionado**: desaparece "Abrir turno" del operador. El primer movimiento
   del período auto-abre el turno (idempotente).
3. **Saldo inicial del auto-open** = remanente del último corte: `counted − transfer`
   (clamped ≥ 0). Primer turno sin cierres previos: **0**.
4. **El cierre es un corte**: N veces al día. El operador declara **cuánto deja en cajón**
   (float para vuelto); lo excedente transfiere a 1.1.3.02 Valores a Depositar.
5. Lo no cerrado queda acumulado explícitamente en el turno abierto (ledger append-only);
   el próximo corte lo levanta. Vencimiento 24h + recuperación finanzas se mantiene como
   red de seguridad.

## Descubrimientos del código (ground truth)

- `close()` ya admite OPERADOR own-shift (`authorizeManualTender`); `forceClose` es
  finanzas-only. Falta la UI de cierre para el operador.
- Transfer actual: `if (computedCashCents > 0)` → INSERT `dues_cash_close_transfers` por
  el TOTAL computado (barrido completo) a cuenta fija `1.1.3.02`. Se cambia a
  `max(0, computed − drawerFloat)`.
- `CloseCashCommand` / `closeBody` (zod, strict) en routes/treasury.ts — agregar campo
  opcional `drawer_float_cents`.
- NO hace falta migración: el remanente del próximo turno se deriva de `counted_tenders`
  (jsonb del close) − `amount` (fila de transfer). Ambos persistidos.
- Validación float: `0 ≤ drawer_float ≤ counted.CASH`. Transfer = `max(0, computed − float)`.
  Próxima apertura = `max(0, counted − transferred)` (sobrante queda en cajón y abre el
  próximo período; faltante queda como deuda registrada y el cajón abre en 0).
- `ensureOpenShift` debe ser idempotente (caller_key + fingerprint como el resto) y usar el
  último desk_id del operador.
- Collections (producción) aterrizan como SETTLEMENT vía `recordTender` — el auto-open ahí
  también aplica (sin turno abierto → auto-abrir).

## Tareas

- [x] P9.1 Backend — `close()` con `drawerFloatCents` (validación + transfer parcial + audit metadata) y tests de la política (float 0 / parcial / > counted rechazado / sobrante). ✅ 331/331 PG real, tsc+eslint OK. De yapa: migración 0074 faltaba en las listas de 2 test files de integración (rompía `detail()`).
- [x] P9.2 Backend — `ensureOpenShift` idempotente (remanente del último corte, desk último, apertura 0 si no hay cierres) + ruta `POST /api/v1/treasury/shifts/ensure-open` + wiring en recordTender/includeExpense. ✅ 332/332 PG real. Nota: el wiring en recordTender no se necesita — la UI asegura el turno con ensure-open antes de operar (recordTender exige shiftId explícito y la UI siempre lo tiene tras ensure-open).
- [x] P9.3 Web — módulo unificado: una sola vista "Tu caja del día" para los tres roles; finanzas conserva sección de recuperación vencidos (cruzada) y fuerza cierre. ✅ 115/115 web, tsc OK. Auto-open al montar (ensure-open cuando no hay turno propio); "Abrir turno" eliminado (junto con P9.4: sin él nadie podía cerrar). page.test.tsx reescrito al flujo unificado (23 tests; useQuery mock con dispatch por queryKey).
- [x] P9.4 Web — modal "Cortar caja": esperado (server), contado, dejás en cajón (prefill esperado → por defecto no barre nada), transferencia en vivo, motivo obligatorio si hay discrepancia, float > contado rechazado en cliente. Recovery modal con contado propio (`recoveryCounted`). ✅
- [x] P9.5 Verificación — 332/332 integración PG, 115/115 web (23 de página), tsc api/web 0, eslint 0. Smoke e2e real: ensure-open #1 → movimiento → corte con float (discrepancia registrada, validación de motivo verificada) → ensure-open #2 → nuevo período, misma desk, apertura 0 por faltante (clamp ✓); camino feliz (remanente = float) cubierto por integración.

## Notas

- El close de turno vencido (force) no lleva float (finanzas decide; barrido completo).

## P10 — Endurecimiento UX del módulo (post-walkthrough Playwright)

Walkthrough con browser real (10+ capturas en /tmp/caja-ux/) contra el stack vivo; hallazgos y fixes:

- [x] CORS del stack: `caja-ui.sh` no exportaba `CORS_ORIGINS` (default solo `localhost:3000`); el browser entraba por `127.0.0.1:3000` → preflight sin ACAO, y los POST ejecutaban server-side sin que la página leyera respuesta (turno fantasma + "Preparando tu caja…" eterno). Fix: export ambas origins. ⚠️ Sin commitear aún.
- [x] Modal base: `onDismiss` opcional — Escape y click en backdrop cierran (guard por identidad DOM: portals no dismissan). Conectado en los 4 modales de caja; respetando `recoveryPending` en corte/movimiento.
- [x] Carga inicial fallida → Alert con "Reintentar" (antes texto muerto). Auto-open fallido → Alert "No se pudo preparar tu caja" con Reintentar; se oculta la línea optimista "Tu caja se abre sola…" cuando hay error.
- [x] Float del corte se re-clampa a `min(float, contado)` al editar el contado (antes quedaba el prefill y "Confirmar" se bloqueaba sin explicación). Verificado en vivo.
- [x] "Cortes del día" con jerarquía: tarjeta por corte (desk bold + fecha a la derecha, línea "Turno del {business_date} · folio {id.slice(0,8)}"), sin UUID crudo ni "(hora local)".
- [x] Form de movimiento: orden Descripción → Importe (vacío, no "0") → Método → Cuenta contable (con label visible + hint), texto guía coherente con el orden visual.
- [x] Sidebar "Cash desk" → "Caja" (i18n); botón "Cortar caja" nowrap en móvil.
- [ ] Pendiente de decisión: cuentas elegibles para movimientos de caja incluyen Plazo Fijo/FCI/Deudores (flag `eligible` del account chart, backend) — filtrar a equivalentes de efectivo es regla de negocio, requiere decisión del maintainer.
- [ ] Seed con `closed_at` raro ("05:59:55"): verificar display TZ con un corte real (el formatter usa `toLocaleString('es-AR')`; sospecha de timestamp horneado en el seed, no de display).

Verificación P10: 124/124 web (12 files), tsc 0, smoke Playwright en vivo (clamp, Escape, cortes, form, sidebar).

- La UI de "turno abierto/cerrado" desaparece del vocabulario del operador: "Tu caja del
  día" + cortes.
