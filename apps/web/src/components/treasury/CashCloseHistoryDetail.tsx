'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { getCashShiftDetail, type CashShift } from '@/lib/api/treasury'
import { CashCloseSummary } from './CashCloseSummary'

export function CashCloseHistoryDetail({
  shift,
  actorId,
  role,
}: {
  shift: CashShift
  actorId?: string
  role?: string
}) {
  const [open, setOpen] = useState(false)
  const allowed = Boolean(actorId && (role === 'ADMIN' || role === 'TESORERO'))
  const detail = useQuery({
    queryKey: ['cash-shift-detail', actorId, role, shift.id],
    queryFn: () => getCashShiftDetail(shift.id),
    enabled: open && allowed,
    retry: false,
    refetchOnWindowFocus: false,
  })
  if (!allowed) return null
  return (
    <>
      <button
        type="button"
        className="mt-2 min-h-11 rounded border px-3 py-2"
        onClick={() => setOpen(true)}
      >
        Ver conciliación de {shift.desk_id}
      </button>
      <Modal
        open={open}
        size="md"
        title={`Conciliación del turno ${shift.desk_id}`}
        footer={
          <button
            type="button"
            className="min-h-11 rounded border px-3 py-2"
            onClick={() => setOpen(false)}
          >
            Cerrar detalle
          </button>
        }
      >
        {detail.isPending && <p role="status">Cargando conciliación histórica…</p>}
        {detail.isError && (
          <div role="alert">
            <p>No se pudo cargar la conciliación histórica.</p>
            <button
              type="button"
              className="min-h-11 rounded border px-3 py-2"
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
            >
              Reintentar
            </button>
          </div>
        )}
        {detail.data &&
          (detail.data.close ? (
            <CashCloseSummary close={detail.data.close} />
          ) : (
            <p role="status">El cierre no tiene una conciliación disponible.</p>
          ))}
      </Modal>
    </>
  )
}
