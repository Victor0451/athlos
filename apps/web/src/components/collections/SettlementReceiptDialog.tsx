'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { getSettlementDetail, type SettlementDetail } from '@/lib/api/settlement-detail'

type Props = {
  open: boolean
  onClose: () => void
  memberId: string
  settlementId: string
  actorId: string
  role: string
}
const tenders: Record<SettlementDetail['tender'], string> = {
  CASH: 'Efectivo',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  TRANSFER: 'Transferencia',
}
const money = (cents: number, currency: string) =>
  (cents / 100).toLocaleString('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
const registeredAt = (value: string) =>
  new Date(value).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Jujuy',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
function periodDate(value: string, exclusiveEnd = false) {
  const date = new Date(`${value}T00:00:00Z`)
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() - 1)
  return date.toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function SettlementReceiptDialog({
  open,
  onClose,
  memberId,
  settlementId,
  actorId,
  role,
}: Props) {
  const content = useRef<HTMLElement>(null)
  const printFrame = useRef<HTMLIFrameElement | null>(null)
  const printTimer = useRef<number | null>(null)
  const [printError, setPrintError] = useState(false)
  const allowed = Boolean(
    actorId && memberId && settlementId && ['ADMIN', 'TESORERO'].includes(role),
  )
  const query = useQuery({
    queryKey: ['settlement-receipt', actorId, role, memberId, settlementId],
    queryFn: () => getSettlementDetail(settlementId, memberId),
    enabled: open && allowed,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  const cleanupPrint = useCallback(function cleanup() {
    if (printTimer.current !== null) window.clearTimeout(printTimer.current)
    printTimer.current = null
    const frame = printFrame.current
    if (!frame) return
    frame.onload = null
    frame.contentWindow?.removeEventListener('afterprint', cleanup)
    frame.remove()
    printFrame.current = null
  }, [])
  useLayoutEffect(() => {
    setPrintError(false)
    return cleanupPrint
  }, [open, actorId, role, memberId, settlementId, cleanupPrint])

  const data = query.data
  const matches =
    data?.settlement_id === settlementId &&
    data.socio_id === memberId &&
    data.member.id === memberId
  const failed = query.isError || Boolean(data && !matches)
  const receipt = !query.isFetching && !failed && matches ? data : undefined

  function printReceipt() {
    if (!open || !allowed || !receipt || !content.current) return
    cleanupPrint()
    setPrintError(false)
    const frame = document.createElement('iframe')
    frame.dataset.testid = 'settlement-receipt-print'
    frame.title = 'Impresión de constancia de pago'
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;'
    const copy = content.current.cloneNode(true) as HTMLElement
    frame.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Constancia de pago no fiscal</title><style>
@page { size: A4; margin: 18mm; }
    body { font: 11pt/1.45 sans-serif; color: #172033; overflow-wrap: anywhere; }
    .receipt-header { display: flex; gap: 16px; align-items: center; border-bottom: 2px solid #172033; padding-bottom: 16px; }
    .receipt-logo { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
    .receipt-club { margin: 0; font-size: 12pt; font-weight: bold; }
    .receipt-title { margin: 4px 0 0; font-size: 18pt; }
    .receipt-operation { margin: 18px 0; padding: 12px; border: 1px solid #cbd5e1; }
    .receipt-operation p { margin: 4px 0; }
    h2, h3 { break-after: avoid; } h3 { margin: 18px 0 8px; }
    dl, tr, .receipt-total { break-inside: avoid; } dt { font-weight: bold; } dd { margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #cbd5e1; text-align: left; }
    th:last-child, td:last-child { text-align: right; }
    thead { display: table-header-group; }
    .receipt-total { margin-top: 20px; padding-top: 12px; border-top: 2px solid #172033; font-size: 16pt; font-weight: bold; }
    .receipt-warning { border-left: 4px solid #b91c1c; padding: 10px; font-weight: bold; }
    .receipt-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #cbd5e1; font-size: 10pt; }
    </style></head><body>${copy.outerHTML}</body></html>`
    const failPrint = () => {
      if (printFrame.current !== frame) return
      cleanupPrint()
      setPrintError(true)
    }
    frame.onload = () => {
      if (printFrame.current !== frame) return
      try {
        const child = frame.contentWindow
        // Frame load settles image requests, including failures: never print a missing logo.
        const logo = frame.contentDocument?.querySelector<HTMLImageElement>(
          '[data-receipt-logo="official"]',
        )
        if (!child || !logo?.complete || logo.naturalWidth <= 0)
          throw new Error('Official receipt logo unavailable')
        if (printTimer.current !== null) window.clearTimeout(printTimer.current)
        printTimer.current = null
        frame.onload = null
        child.addEventListener('afterprint', cleanupPrint, { once: true })
        child.print()
      } catch {
        failPrint()
      }
    }
    printFrame.current = frame
    printTimer.current = window.setTimeout(failPrint, 8000)
    document.body.appendChild(frame)
  }

  if (!open || !allowed) return null
  return (
    <Modal
      open
      size="md"
      title="Constancia de pago no fiscal"
      footer={
        <>
          <button
            type="button"
            className="min-h-11 rounded border px-3 py-2"
            disabled={!receipt}
            onClick={printReceipt}
          >
            Imprimir
          </button>
          <button type="button" className="min-h-11 rounded border px-3 py-2" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      {query.isFetching && <p role="status">Cargando constancia de pago…</p>}
      {failed && !query.isFetching && (
        <div role="alert">
          <p>No se pudo cargar la constancia de pago.</p>
          <button
            type="button"
            className="min-h-11 rounded border px-3 py-2"
            onClick={() => void query.refetch()}
          >
            Reintentar
          </button>
        </div>
      )}
      {printError && (
        <p role="alert">
          No se pudo abrir la impresión. Podés volver a intentarlo sin registrar otro pago.
        </p>
      )}
      {receipt && (
        <article ref={content} className="space-y-4 break-words text-ink-900">
          <header className="receipt-header flex items-center gap-4 border-b-2 border-ink-900 pb-4">
            <img
              src="/escudo.jpg"
              alt="Escudo de Club Atlético Gorriti"
              data-receipt-logo="official"
              width={64}
              height={64}
              className="receipt-logo h-16 w-16 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="receipt-club font-semibold">Club Atlético Gorriti</p>
              <h2 className="receipt-title text-xl font-bold">Constancia de pago no fiscal</h2>
            </div>
          </header>
          <section
            aria-label="Operación registrada"
            className="receipt-operation rounded border border-ink-200 p-3 text-sm"
          >
            <p>
              <strong>Referencia de operación:</strong>{' '}
              <span className="break-all font-mono">{receipt.settlement_id}</span>
            </p>
            <p>
              <strong>Fecha de registro (hora de Jujuy):</strong>{' '}
              {registeredAt(receipt.confirmed_at)}
            </p>
          </section>
          {receipt.reversal && (
            <p className="receipt-warning border-l-4 border-red-700 p-3">
              <strong>Pago revertido</strong>. Reversión {receipt.reversal.settlement_id},
              registrada el {registeredAt(receipt.reversal.confirmed_at)} (hora de Jujuy).
            </p>
          )}
          <h3 className="font-semibold">Datos actuales del socio</h3>
          <dl>
            <dt>Nombre actual</dt>
            <dd>
              {receipt.member.nombre} {receipt.member.apellido}
            </dd>
            <dt>N.º de socio actual</dt>
            <dd>{receipt.member.numero_socio}</dd>
            <dt>Medio de pago</dt>
            <dd>{tenders[receipt.tender]}</dd>
          </dl>
          <h3 className="font-semibold">Períodos e importes aplicados</h3>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-300">
                <th scope="col" className="p-2 text-left">
                  Período
                </th>
                <th scope="col" className="p-2 text-right">
                  Importe aplicado
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.allocations.map((item) => (
                <tr key={item.id} className="border-b border-ink-200">
                  <td className="p-2">
                    {periodDate(item.period_start)} al {periodDate(item.period_end, true)}
                  </td>
                  <td className="p-2 text-right">{money(item.amount_cents, receipt.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="receipt-total border-t-2 border-ink-900 pt-3 text-xl font-bold">
            Importe confirmado: {money(receipt.amount_cents, receipt.currency)}
          </p>
          <footer className="receipt-footer border-t border-ink-200 pt-3 text-sm">
            Constancia no fiscal. No válida como factura.
          </footer>
        </article>
      )}
    </Modal>
  )
}
