import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getClubStatus = vi.fn()
vi.mock('@/lib/api/club-status', () => ({
  getClubStatus: (...args: unknown[]) => getClubStatus(...args),
}))

const { ClubStatusDashboard } = await import('./ClubStatusDashboard')

const status = {
  period: 'current-month' as const,
  generatedAt: '2026-08-12T00:00:00.000Z',
  membership: { active: 0 },
  freshness: [{ domain: 'socios', status: 'current', lastImportAt: '2026-08-11T00:00:00.000Z' }],
  unavailable: ['delinquency.count'],
  finance: { debits: '0.00', credits: '20.00', net: '-20.00' },
}

describe('ClubStatusDashboard', () => {
  beforeEach(() => getClubStatus.mockReset())

  it('requests the default period once and renders present real-zero fields without technical controls', async () => {
    getClubStatus.mockResolvedValue(status)
    render(<ClubStatusDashboard />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando estado del club')
    await waitFor(() => expect(screen.getByText('0 socios activos')).toBeInTheDocument())
    expect(getClubStatus).toHaveBeenCalledWith('current-month')
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.queryByText(/ejecutar|scheduler|evidence/i)).not.toBeInTheDocument()
  })

  it('requests only finance/activity period changes while retaining current state', async () => {
    getClubStatus.mockResolvedValue(status)
    render(<ClubStatusDashboard />)
    await screen.findByText('0 socios activos')
    fireEvent.change(screen.getByLabelText('Período financiero'), {
      target: { value: 'last-90-days' },
    })
    await waitFor(() => expect(getClubStatus).toHaveBeenLastCalledWith('last-90-days'))
    expect(screen.getByText('0 socios activos')).toBeInTheDocument()
  })

  it.each(['last-60-days', 'last-90-days'] as const)(
    'supports the %s period control',
    async (period) => {
      getClubStatus.mockResolvedValue(status)
      render(<ClubStatusDashboard />)
      await screen.findByText('0 socios activos')
      fireEvent.change(screen.getByLabelText('Período financiero'), { target: { value: period } })
      await waitFor(() => expect(getClubStatus).toHaveBeenLastCalledWith(period))
    },
  )

  it('omits unauthorized finance and renders operador workload plus consulta institutional status', async () => {
    getClubStatus.mockResolvedValueOnce({
      ...status,
      finance: undefined,
      unavailable: ['regularization.workload'],
    })
    const { unmount } = render(<ClubStatusDashboard />)
    await screen.findByText('Regularización no disponible')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    unmount()
    getClubStatus.mockResolvedValueOnce({
      ...status,
      finance: undefined,
      unavailable: ['systemState'],
    })
    render(<ClubStatusDashboard />)
    await screen.findByText('Estado institucional no disponible')
  })

  it('distinguishes unavailable, empty, request error, retry, and no false zero', async () => {
    getClubStatus.mockResolvedValueOnce({
      ...status,
      membership: { active: undefined },
      freshness: [],
      unavailable: ['membership.active'],
    })
    render(<ClubStatusDashboard />)
    await screen.findByText('Membresía no disponible')
    expect(screen.queryByText('0 socios activos')).not.toBeInTheDocument()
    getClubStatus.mockRejectedValueOnce(new Error('network'))
    fireEvent.change(screen.getByLabelText('Período financiero'), {
      target: { value: 'last-60-days' },
    })
    await screen.findByRole('alert')
    getClubStatus.mockResolvedValueOnce({ ...status, freshness: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('Sin fuentes de actualización disponibles')
  })

  it('uses labelled keyboard-operable controls and textual status within the shell container', async () => {
    getClubStatus.mockResolvedValue(status)
    render(
      <div data-mobile-drawer-background="true">
        <ClubStatusDashboard />
      </div>,
    )
    const control = screen.getByLabelText('Período financiero')
    control.focus()
    expect(control).toHaveFocus()
    await screen.findByText('Actualizado')
    expect(screen.getByTestId('club-status-dashboard')).toBeInTheDocument()
  })
})
