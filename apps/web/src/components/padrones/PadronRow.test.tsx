import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * PadronRow component tests (TASK-028, PR 8b.3).
 *
 * `<PadronRow>` renders ONE member of a padron as a clickable
 * stacked-list card. Used by BOTH the `/padrones` list page and
 * the `/padrones/[id]` detail page so the row styling stays in
 * one place (Gorriti Premium tokens).
 *
 * Contract:
 *   - Renders apellido, nombre (in display font)
 *   - Renders numeroSocio (in mono, with "N° " prefix)
 *   - Renders DNI (in mono)
 *   - Renders the estado badge with the matching variant colour
 *     (activa = success, pendiente = warning, baja = danger)
 *   - The whole card is a button — clicking it navigates to
 *     `/socios/<socioId>` (drill-down to the member's profile)
 *
 * The componente is pure presentation — no data fetching, no
 * pagination. The page that owns the list is responsible for
 * mapping `PadronRow[]` → `<PadronRow>` elements.
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/padrones/NATACION-2026',
  useSearchParams: () => new URLSearchParams(),
}))

const { PadronRow } = await import('./PadronRow')

const SAMPLE_ROW = {
  inscripcionId: 'i-1',
  socioId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numeroSocio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  estado: 'activa' as const,
  fechaAlta: '2026-03-01',
  disciplinaCodigo: 'NATACION',
  disciplinaNombre: 'Natación',
  ejercicioAnio: 2026,
}

describe('PadronRow', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders apellido, nombre as the primary heading', () => {
    render(<PadronRow row={SAMPLE_ROW} />)
    expect(screen.getByText('García, Juan')).toBeInTheDocument()
  })

  it('renders the numeroSocio with the "N°" prefix (mono font)', () => {
    render(<PadronRow row={SAMPLE_ROW} />)
    expect(screen.getByText(/N°\s*00001/)).toBeInTheDocument()
  })

  it('renders the DNI', () => {
    render(<PadronRow row={SAMPLE_ROW} />)
    expect(screen.getByText('DNI 12345678')).toBeInTheDocument()
  })

  it('renders the estado badge with the right label for "activa"', () => {
    render(<PadronRow row={SAMPLE_ROW} />)
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('renders the estado badge with the right label for "pendiente"', () => {
    render(<PadronRow row={{ ...SAMPLE_ROW, estado: 'pendiente' }} />)
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('renders the estado badge with the right label for "baja"', () => {
    render(<PadronRow row={{ ...SAMPLE_ROW, estado: 'baja' }} />)
    expect(screen.getByText('Baja')).toBeInTheDocument()
  })

  it('navigates to /socios/<socioId> when the row is clicked', async () => {
    const user = userEvent.setup()
    render(<PadronRow row={SAMPLE_ROW} />)
    await user.click(screen.getByRole('button', { name: /garcía.*juan/i }))
    expect(pushMock).toHaveBeenCalledWith('/socios/' + SAMPLE_ROW.socioId)
  })

  it('exposes a stable test-id based on socioId for the list page', () => {
    render(<PadronRow row={SAMPLE_ROW} />)
    expect(screen.getByTestId(`padron-row-${SAMPLE_ROW.socioId}`)).toBeInTheDocument()
  })
})
