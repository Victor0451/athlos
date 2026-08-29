import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssessmentPreviewPanel } from './AssessmentPreviewPanel'

const socio = { id: 's-1', apellido: 'Gorriti', nombre: 'Ana', numero_socio: '42' }
// prettier-ignore
const preview = {
  socio_id: 's-1', from_period: '2026-01', through_period: '2026-02', executable: true,
  currency: 'ARS', fingerprint: 'abc123', issues: [], periods: [{ period: '2026-01', start: '2026-01-01', end: '2026-02-01', calendarDays: 31, existingObligationId: null, pendingAmountCents: 12500, components: [{ componentKey: 'base', kind: 'BASE' as const, eligibleFrom: '2026-01-01', eligibleTo: '2026-02-01', eligibleDays: 31, calendarDays: 31, segments: [], numerator: 12500, remainder: 0, amountCents: 12500, status: 'PENDING' as const }] }],
}
describe('AssessmentPreviewPanel', () => {
  it('renders an accessible read-only itemized preview and never offers execution', () => {
    render(
      <AssessmentPreviewPanel socio={socio} preview={preview} status="ready" onPreview={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: /vista previa de evaluación/i })).toBeInTheDocument()
    expect(screen.getByText(/Gorriti, Ana/)).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Período 2026-01' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /componentes/i })).toHaveTextContent(
      'Cuota base: 125.00 ARS',
    )
    expect(screen.getByText('Total del período: 125.00 ARS')).toBeInTheDocument()
    expect(screen.getByText('Total del rango: 125.00 ARS')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /ejecutar|generar|confirmar|pagar|revertir/i }),
    ).not.toBeInTheDocument()
  })

  it('submits only a requested range and exposes loading, empty, blocked and error states', async () => {
    const user = userEvent.setup(),
      onPreview = vi.fn()
    const { rerender } = render(
      <AssessmentPreviewPanel socio={socio} preview={null} status="idle" onPreview={onPreview} />,
    )
    await user.type(screen.getByLabelText('Desde'), '2026-01')
    await user.type(screen.getByLabelText('Hasta'), '2026-02')
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))
    expect(onPreview).toHaveBeenCalledWith({
      socio_id: 's-1',
      from_period: '2026-01',
      through_period: '2026-02',
    })
    rerender(
      <AssessmentPreviewPanel
        socio={socio}
        preview={null}
        status="loading"
        onPreview={onPreview}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/cargando/i)
    rerender(
      <AssessmentPreviewPanel
        socio={socio}
        preview={{ ...preview, periods: [] }}
        status="empty"
        onPreview={onPreview}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/no hay períodos/i)
    rerender(
      <AssessmentPreviewPanel
        socio={socio}
        preview={{
          ...preview,
          executable: false,
          issues: [
            {
              code: 'PRICE_GAP' as const,
              componentKey: 'base',
              from: '2026-01-01',
              to: '2026-01-02',
              period: '2026-01',
            },
          ],
        }}
        status="blocked"
        onPreview={onPreview}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/PRICE_GAP/)
    rerender(
      <AssessmentPreviewPanel
        socio={socio}
        preview={null}
        status="error"
        error="La respuesta es incompleta."
        onPreview={onPreview}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/incompleta/i)
  })
})
