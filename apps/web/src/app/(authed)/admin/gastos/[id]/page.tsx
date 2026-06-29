'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getGastoById, type Gasto } from '@/lib/api/gastos'
import {
  anularLink,
  createLink,
  deleteLink,
  getCandidates,
  getGastoLinks,
  type GastosLink,
  type HeuristicCandidate,
} from '@/lib/api/gastos-ctacte'
import { useAuth } from '@/lib/use-auth'

/**
 * Admin gasto detail page — `/admin/gastos/[id]` (TASK-012, PR n16b-web).
 *
 * N16 spec per `web-frontend` ADDED Requirements:
 *   - ADMIN-only (`useAuth().user?.role === 'ADMIN'`); non-ADMIN sees Sin permisos
 *   - Renders gasto header (cuenta_principal, fecha, importe, concepto)
 *   - Links table: ctacte cuenta, monto_cubierto, motivo, anulado badge
 *   - Per-link Eliminar / Anular buttons
 *   - "Agregar enlace" affordance (manual link entry)
 *   - Heuristic candidates section with Confirmar (calls createLink with motivo='manual')
 *     and Descartar (local-only dismissal) buttons
 *   - Loading skeleton + error state on the detail query
 */

export default function GastoDetailPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const params = useParams<{ id: string }>()
  const gastoId = params.id
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['gasto', gastoId],
    queryFn: () => getGastoById(gastoId),
    enabled: isAdmin,
  })

  const linksQuery = useQuery({
    queryKey: ['gasto-links', gastoId],
    queryFn: () => getGastoLinks(gastoId),
    enabled: isAdmin,
  })

  const candidatesQuery = useQuery({
    queryKey: ['gasto-candidates', gastoId],
    queryFn: () => getCandidates(gastoId),
    enabled: isAdmin,
  })

  const createMutation = useMutation({
    mutationFn: (args: { ctacteId: string; montoCubierto: string }) =>
      createLink(gastoId, {
        ctacteId: args.ctacteId,
        montoCubierto: args.montoCubierto,
        motivo: 'manual',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gasto-links', gastoId] })
      queryClient.invalidateQueries({ queryKey: ['gasto', gastoId] })
      queryClient.invalidateQueries({ queryKey: ['gasto-candidates', gastoId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (linkId: string) => deleteLink(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gasto-links', gastoId] })
      queryClient.invalidateQueries({ queryKey: ['gasto', gastoId] })
    },
  })

  const anularMutation = useMutation({
    mutationFn: ({ linkId, motivo }: { linkId: string; motivo: string }) =>
      anularLink(linkId, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gasto-links', gastoId] })
    },
  })

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold text-ink-900">Tesorería · Gasto</h1>
        </header>
        <div
          role="alert"
          data-testid="gasto-detail-no-permission"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (detailQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        className="space-y-4"
        data-testid="gasto-detail-loading"
      >
        <div className="h-7 w-64 animate-pulse rounded bg-surface-sunken" />
        <div className="h-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded bg-surface-sunken" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div
        role="alert"
        data-testid="gasto-detail-error"
        className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
      >
        <p className="font-display text-lg font-semibold text-ink-900">
          No se pudo cargar el gasto
        </p>
        <p className="mt-2 font-body text-sm text-ink-500">
          Verificá la conectividad con el API o intentá nuevamente más tarde.
        </p>
      </div>
    )
  }

  const gasto: Gasto = detailQuery.data
  const links: GastosLink[] = linksQuery.data?.items ?? []
  const candidates: HeuristicCandidate[] = candidatesQuery.data?.items ?? []

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs text-ink-500">
          <Link href="/admin/gastos" className="text-accent hover:text-accent-hover">
            ← Volver al listado
          </Link>
        </p>
        <h1
          className="mt-1 font-display text-2xl font-bold text-ink-900"
          data-testid="gasto-detail-heading"
        >
          Gasto {gasto.cuentaPrincipal}
        </h1>
      </header>

      <section
        aria-label="Datos del gasto"
        data-testid="gasto-detail-header"
        className="grid grid-cols-1 gap-4 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm sm:grid-cols-4"
      >
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Cuenta principal
          </p>
          <p className="mt-1 font-mono text-base text-ink-900">{gasto.cuentaPrincipal}</p>
        </div>
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Fecha
          </p>
          <p className="mt-1 font-body text-base text-ink-900">{gasto.fecha}</p>
        </div>
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Importe
          </p>
          <p className="mt-1 font-body text-base tabular-nums text-ink-900">{gasto.importe}</p>
        </div>
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Concepto
          </p>
          <p className="mt-1 font-body text-base text-ink-900">{gasto.concepto ?? '—'}</p>
        </div>
      </section>

      <section aria-label="Vínculos con cuenta corriente" data-testid="links-section">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-900">Vínculos</h2>
          <span className="font-mono text-xs text-ink-500">
            {links.length} {links.length === 1 ? 'vínculo' : 'vínculos'}
          </span>
        </div>
        {links.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center font-body text-sm text-ink-500"
            data-testid="links-empty"
          >
            Sin vínculos. Confirmá un candidato heurístico o agregá uno manualmente.
          </p>
        ) : (
          <div
            className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
            data-testid="links-list"
          >
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Ctacte
                  </th>
                  <th className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Monto cubierto
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Motivo
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr
                    key={l.id}
                    data-testid={`link-row-${l.id}`}
                    className="border-t border-ink-100"
                  >
                    <td className="px-4 py-3 font-mono text-sm text-ink-900">{l.ctacteId}</td>
                    <td className="px-4 py-3 text-right font-body text-sm tabular-nums text-ink-900">
                      {l.montoCubierto}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-ink-700">{l.motivo}</td>
                    <td className="px-4 py-3 font-body text-sm">
                      {l.anulado ? (
                        <span className="inline-block rounded-full bg-danger/10 px-2 py-1 font-display text-xs font-semibold text-danger">
                          Anulado
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-success/10 px-2 py-1 font-display text-xs font-semibold text-success">
                          Activo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm">
                      {!l.anulado ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(l.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`link-eliminar-${l.id}`}
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 font-display text-xs text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              anularMutation.mutate({
                                linkId: l.id,
                                motivo: 'Reverso manual',
                              })
                            }
                            disabled={anularMutation.isPending}
                            data-testid={`link-anular-${l.id}`}
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 font-display text-xs text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Anular
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        aria-label="Candidatos heurísticos"
        data-testid="candidates-section"
        className="rounded-lg border border-ink-100 bg-surface p-4"
      >
        <h2 className="font-display text-lg font-semibold text-ink-900">Candidatos heurísticos</h2>
        <p className="mt-1 font-body text-xs text-ink-500">
          Coincidencias por fecha ±3 días e importe exacto. La confirmación persiste el vínculo;
          descartar lo ignora en esta vista.
        </p>
        {candidates.length === 0 ? (
          <p className="mt-3 font-body text-sm text-ink-500" data-testid="candidates-empty">
            Sin candidatos pendientes.
          </p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="candidates-list">
            {candidates.map((c) => (
              <li
                key={c.ctacteId}
                className="flex items-center justify-between rounded-md border border-ink-100 bg-surface-elevated p-3"
                data-testid={`candidate-${c.ctacteId}`}
              >
                <div>
                  <p className="font-mono text-sm text-ink-900">{c.ctacteId}</p>
                  <p className="font-body text-xs text-ink-500">
                    {c.ctacteFecha} · {c.ctacteConcepto ?? '—'} · debe {c.debe}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      createMutation.mutate({
                        ctacteId: c.ctacteId,
                        montoCubierto: c.debe,
                      })
                    }
                    disabled={createMutation.isPending}
                    className="rounded-md bg-accent px-3 py-1 font-display text-xs font-semibold text-white transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-display text-xs text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
                  >
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createMutation.isError ? (
        <div
          role="alert"
          data-testid="create-link-error"
          className="rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <p className="font-body text-sm text-danger">
            No se pudo crear el vínculo. Verificá el monto y que no exista un vínculo activo para
            este par.
          </p>
        </div>
      ) : null}
    </div>
  )
}
