import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssessmentPreviewPanel } from './AssessmentPreviewPanel'

const socio = {
  id: 's-1',
  apellido: 'Gorriti',
  nombre: 'Ana',
  numero_socio: '42',
  fecha_alta: '2026-01-15',
}
// prettier-ignore
const preview = {
  socio_id: 's-1', from_period: '2026-01', through_period: '2026-02', executable: true,
  currency: 'ARS', fingerprint: 'abc123', issues: [], periods: [{ period: '2026-01', start: '2026-01-01', end: '2026-02-01', calendarDays: 31, existingObligationId: null, pendingAmountCents: 12500, components: [{ componentKey: 'base', kind: 'BASE' as const, eligibleFrom: '2026-01-01', eligibleTo: '2026-02-01', eligibleDays: 31, calendarDays: 31, segments: [], numerator: 12500, remainder: 0, amountCents: 12500, status: 'PENDING' as const }] }],
}
describe('AssessmentPreviewPanel', () => {
  it('renders an accessible itemized preview with the execution entry point', () => {
    render(
      <AssessmentPreviewPanel
        socio={socio}
        preview={preview}
        status="ready"
        onPreview={vi.fn()}
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: /vista previa de evaluación/i })).toBeInTheDocument()
    expect(screen.getByText(/Gorriti, Ana/)).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Período 2026-01' })).toBeInTheDocument()
    const components = screen.getByRole('list', { name: 'Componentes del período 2026-01' })
    const baseDues = within(components).getByRole('listitem')
    expect(baseDues).toHaveTextContent('Cuota base')
    expect(baseDues).toHaveTextContent('125.00 ARS')
    expect(screen.getByText('Total del período: 125.00 ARS')).toBeInTheDocument()
    expect(screen.getByText('Total del rango: 125.00 ARS')).toBeInTheDocument()
    expect(screen.getByLabelText('Desde')).toHaveClass('min-h-11')
    expect(screen.getByText('abc123')).toHaveClass('font-mono', 'break-all')
    expect(
      screen.getByRole('button', { name: 'Generar obligaciones del rango' }),
    ).toBeInTheDocument()
  })

  it('submits only a requested range and exposes loading, empty, blocked and error states', async () => {
    const user = userEvent.setup(),
      onPreview = vi.fn()
    const { rerender } = render(
      <AssessmentPreviewPanel
        socio={socio}
        preview={null}
        status="idle"
        onPreview={onPreview}
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
      />,
    )
    await user.clear(screen.getByLabelText('Desde'))
    await user.clear(screen.getByLabelText('Hasta'))
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
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/cargando/i)
    rerender(
      <AssessmentPreviewPanel
        socio={socio}
        preview={{ ...preview, periods: [] }}
        status="empty"
        onPreview={onPreview}
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
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
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
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
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/incompleta/i)
  })

  it('requires an explicit second confirmation with the preview fingerprint', async () => {
    const user = userEvent.setup(),
      onExecute = vi.fn()
    render(
      <AssessmentPreviewPanel
        socio={socio}
        preview={preview}
        status="ready"
        onPreview={vi.fn()}
        onExecute={onExecute}
        onConfigurePrices={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Generar obligaciones del rango' }))
    expect(onExecute).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirmar generación con esta huella' }))
    expect(onExecute).toHaveBeenCalledWith({
      socio_id: 's-1',
      from_period: '2026-01',
      through_period: '2026-02',
      preview_fingerprint: 'abc123',
    })
  })

  it('routes price gaps to the existing pricing configuration surface', async () => {
    const user = userEvent.setup(),
      onConfigurePrices = vi.fn()
    render(
      <AssessmentPreviewPanel
        socio={socio}
        preview={{
          ...preview,
          executable: false,
          issues: [
            {
              code: 'PRICE_GAP',
              componentKey: 'base',
              from: '2026-01-01',
              to: '2026-02-01',
              period: '2026-01',
            },
          ],
        }}
        status="blocked"
        onPreview={vi.fn()}
        onExecute={vi.fn()}
        onConfigurePrices={onConfigurePrices}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Configurar cuotas' }))
    expect(onConfigurePrices).toHaveBeenCalledOnce()
  })

  it('renders benefit components instead of the benefit empty state', () => {
    render(
      <AssessmentPreviewPanel
        socio={socio}
        preview={{
          ...preview,
          periods: [
            {
              ...preview.periods[0]!,
              components: [
                ...preview.periods[0]!.components,
                {
                  componentKey: 'benefit:approved',
                  kind: 'BENEFIT',
                  eligibleFrom: '2026-01-01',
                  eligibleTo: '2026-02-01',
                  eligibleDays: 31,
                  calendarDays: 31,
                  segments: [],
                  numerator: -2500,
                  remainder: 0,
                  amountCents: -2500,
                  status: 'PENDING',
                },
              ],
            },
          ],
        }}
        status="ready"
        onPreview={vi.fn()}
        onExecute={vi.fn()}
        onConfigurePrices={vi.fn()}
      />,
    )
    const benefits = screen.getByRole('list', { name: 'Beneficios del período 2026-01' })
    expect(benefits).toHaveTextContent('Beneficio aplicado · -25.00 ARS')
    expect(benefits).not.toHaveTextContent('No se informaron beneficios')
  })
})
