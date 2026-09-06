'use client'

import { useEffect, useRef } from 'react'
import type { DebtDetail } from '@/lib/api/dues'
import type { Socio } from '@/lib/api/socios'
import { collectionInlineStatusClass, collectionSectionClass } from './CollectionPrimitives'
import { DebtObligationList } from './DebtObligationList'
import { DebtSearch } from './DebtSearch'
import { mapDebtPresentation } from './debt-presentation'

export type { DebtDetail } from '@/lib/api/dues'
export type DebtPanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'not_found'
  | 'unavailable'
  | 'error'

type SocioOption = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>
type Props = {
  socio: SocioOption | null
  socios?: SocioOption[]
  status: DebtPanelStatus
  debt: DebtDetail | null
  error: string
  onSearch: (term: string) => Promise<void> | void
  onSelectSocio: (socio: SocioOption) => Promise<void> | void
}

export function DebtPanel({
  socio,
  socios = [],
  status,
  debt,
  error,
  onSearch,
  onSelectSocio,
}: Props) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const presentation = debt?.status === 'ready' ? mapDebtPresentation(debt) : null
  const message = error || statusMessage(status)
  const alert = Boolean(error || status === 'error' || status === 'unavailable')

  useEffect(() => {
    if (alert) statusRef.current?.focus()
  }, [alert, message])

  return (
    <section id="debt-title" aria-labelledby="debt-heading" className={collectionSectionClass}>
      <h2 id="debt-heading" className="font-display text-lg font-semibold text-ink-900">
        Detalle de deuda
      </h2>
      <DebtSearch
        socios={socios}
        selectedSocio={socio}
        onSearch={onSearch}
        onSelectSocio={onSelectSocio}
      />
      {message && (
        <p
          ref={statusRef}
          role={alert ? 'alert' : 'status'}
          aria-live={alert ? 'assertive' : 'polite'}
          tabIndex={alert ? -1 : undefined}
          className={collectionInlineStatusClass(alert ? 'error' : 'neutral')}
        >
          {message}
        </p>
      )}
      {socio && presentation && (
        <div
          aria-label={`Resumen de deuda de ${socio.apellido}, ${socio.nombre}`}
          className="space-y-3"
        >
          <div className="min-w-0 border border-ink-200 bg-surface-sunken p-4">
            <p className="font-body text-sm text-ink-700">
              Socio seleccionado: {socio.apellido}, {socio.nombre} · N.° {socio.numero_socio}
            </p>
            <p className="mt-2 font-display text-xl font-semibold text-ink-900">
              {presentation.total.label}: {presentation.total.value}
            </p>
          </div>
          <DebtObligationList obligations={presentation.obligations} />
        </div>
      )}
    </section>
  )
}

function statusMessage(status: DebtPanelStatus) {
  if (status === 'empty') return 'No hay deuda registrada todavía para este socio.'
  if (status === 'not_found') return 'No se encontró el detalle de deuda de este socio.'
  if (status === 'loading') return 'Cargando el detalle de deuda…'
  if (status === 'unavailable' || status === 'error')
    return 'El detalle de deuda no está disponible.'
  return ''
}
