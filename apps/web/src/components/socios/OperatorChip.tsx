import type { OperatorSummary } from '@/lib/api/operators'

/**
 * `<OperatorChip>` — stateless render helper that collapses every
 * actor resolution case into a single text fragment (PR 8b.5 of
 * `athlos-audit-operator-display`).
 *
 * Three runtime branches (per design D7 + §UI Rendering Details):
 *   1. operatorId === null           → "Operador desconocido"
 *   2. operators.has(operatorId)     → `${username} · ${roleLabel}`
 *      (covers both active and soft-deleted rows — the wire DTO
 *      does not expose `is_active`, so the chip cannot distinguish
 *      them per spec R3 / D7)
 *   3. operatorId !== null && !operators.has(operatorId) → "Operador desconocido"
 *
 * Username casing is preserved verbatim. No `toTitleCase`, no
 * `Capitalize` — the locked spec rule (`§UI Rendering Details`)
 * pins the username verbatim because the chip is a "snapshot of
 * who they were" and changing the casing would change the data
 * the user sees.
 *
 * Role labels are one-to-one with the backend `charToRole()` output
 * (see `apps/api/src/modules/operators/lookup.ts`). No translation,
 * no abbreviation.
 *
 * The component is intentionally decoupled from the data-fetching
 * concern: the parent (`AuditTab`, future `SocioNotesCard`) owns
 * the `useQuery` and passes a plain `Map<string, OperatorSummary>`.
 * That keeps this file purely a render helper, which makes the
 * test surface trivial and lets the parent share one fetch across
 * mounts.
 */

interface OperatorChipProps {
  /** UUID of the operator to render, or `null` for system events. */
  operatorId: string | null
  /** Operator summaries keyed by id. Empty during loading → fallback. */
  operators: Map<string, OperatorSummary>
}

export function OperatorChip({ operatorId, operators }: OperatorChipProps): React.ReactNode {
  if (operatorId === null || !operators.has(operatorId)) {
    return <span data-testid="operator-chip-unknown">Operador desconocido</span>
  }
  const operator = operators.get(operatorId)
  // Narrowed: the `has` check above guarantees `get` returns a value.
  if (!operator) return <span data-testid="operator-chip-unknown">Operador desconocido</span>
  return (
    <span data-testid="operator-chip-known">
      {operator.username} · {operator.role}
    </span>
  )
}
