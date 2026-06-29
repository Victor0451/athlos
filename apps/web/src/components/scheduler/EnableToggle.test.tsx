import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * EnableToggle component tests (TASK-034, PR 8c.1).
 *
 * `<EnableToggle>` is the enable/disable switch on the
 * `/admin/scheduler/<name>` detail page. Per the spec:
 *
 *   1. Renders a switch that mirrors the `enabled` prop
 *   2. Click toggles the switch + calls setSchedulerJobEnabled
 *   3. On success: parent receives `onToggled(newEnabled)` so it
 *      can refetch / update local state from the response
 *   4. On error: the switch reverts to the original `enabled`
 *      prop value + the parent receives `onError(message)`
 *   5. The switch is disabled while the PATCH is in flight
 *
 * Pure presentation — no router, no query state.
 */

const setSchedulerJobEnabledMock = vi.fn()
vi.mock('@/lib/api/scheduler', () => ({
  setSchedulerJobEnabled: (...args: unknown[]) => setSchedulerJobEnabledMock(...args),
}))

const onToggledMock = vi.fn()
const onErrorMock = vi.fn()
const { EnableToggle } = await import('./EnableToggle')

describe('EnableToggle', () => {
  beforeEach(() => {
    setSchedulerJobEnabledMock.mockReset()
    onToggledMock.mockReset()
    onErrorMock.mockReset()
  })

  it('renders a switch that is checked when enabled=true', () => {
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeChecked()
  })

  it('renders a switch that is unchecked when enabled=false', () => {
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled={false}
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeChecked()
  })

  it('renders the job name label for accessibility', () => {
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    expect(screen.getByText(/scheduled-import/i)).toBeInTheDocument()
  })

  it('calls setSchedulerJobEnabled with the new value when the switch is toggled', async () => {
    const user = userEvent.setup()
    setSchedulerJobEnabledMock.mockResolvedValueOnce({
      name: 'scheduled-import',
      cronExpr: '0 2 * * *',
      timezone: null,
      cadenceMinutes: 1440,
      enabled: false,
    })
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    await user.click(screen.getByRole('switch'))
    expect(setSchedulerJobEnabledMock).toHaveBeenCalledTimes(1)
    expect(setSchedulerJobEnabledMock).toHaveBeenCalledWith('scheduled-import', false)
  })

  it('fires onToggled(newEnabled) on success', async () => {
    const user = userEvent.setup()
    setSchedulerJobEnabledMock.mockResolvedValueOnce({
      name: 'scheduled-import',
      cronExpr: '0 2 * * *',
      timezone: null,
      cadenceMinutes: 1440,
      enabled: false,
    })
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    await user.click(screen.getByRole('switch'))
    await waitFor(() => {
      expect(onToggledMock).toHaveBeenCalledWith(false)
    })
  })

  it('fires onToggled(true) when re-enabling a disabled job', async () => {
    const user = userEvent.setup()
    setSchedulerJobEnabledMock.mockResolvedValueOnce({
      name: 'scheduled-import',
      cronExpr: '0 2 * * *',
      timezone: null,
      cadenceMinutes: 1440,
      enabled: true,
    })
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled={false}
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    await user.click(screen.getByRole('switch'))
    await waitFor(() => {
      expect(onToggledMock).toHaveBeenCalledWith(true)
    })
  })

  it('disables the switch while the PATCH is in flight', async () => {
    const user = userEvent.setup()
    let resolveToggle: (value: unknown) => void = () => {}
    setSchedulerJobEnabledMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveToggle = resolve
      }),
    )
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeDisabled()
    resolveToggle({
      name: 'scheduled-import',
      cronExpr: '0 2 * * *',
      timezone: null,
      cadenceMinutes: 1440,
      enabled: false,
    })
    await waitFor(() => {
      expect(onToggledMock).toHaveBeenCalled()
    })
  })

  it('fires onError on PATCH failure', async () => {
    const user = userEvent.setup()
    setSchedulerJobEnabledMock.mockRejectedValueOnce(new Error('server down'))
    render(
      <EnableToggle
        jobName="scheduled-import"
        enabled
        onToggled={onToggledMock}
        onError={onErrorMock}
      />,
    )
    await user.click(screen.getByRole('switch'))
    await waitFor(() => {
      expect(onErrorMock).toHaveBeenCalledTimes(1)
    })
    expect(onToggledMock).not.toHaveBeenCalled()
  })
})
