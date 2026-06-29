import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * TriggerButton component tests (TASK-034, PR 8c.1).
 *
 * `<TriggerButton>` is the "Disparar ahora" button on the
 * `/admin/scheduler/<name>` detail page. Per the spec:
 *
 *   1. Click opens a confirmation dialog
 *   2. Dialog shows the job name + "Confirmar" / "Cancelar" buttons
 *   3. Confirm calls triggerSchedulerJob(name)
 *   4. On success: dialog closes + the parent's onTriggered() fires
 *      so the detail page can refetch the recent runs
 *   5. On 429: dialog stays open with the rate-limit message
 *   6. On any other error: dialog stays open with a generic error
 *   7. Button is disabled while the trigger is in flight
 *
 * Pure presentation — no router, no query state. The parent
 * (detail page) owns the data flow.
 */

const triggerSchedulerJobMock = vi.fn()
vi.mock('@/lib/api/scheduler', () => ({
  triggerSchedulerJob: (...args: unknown[]) => triggerSchedulerJobMock(...args),
}))

const onTriggeredMock = vi.fn()
const { TriggerButton } = await import('./TriggerButton')

describe('TriggerButton', () => {
  beforeEach(() => {
    triggerSchedulerJobMock.mockReset()
    onTriggeredMock.mockReset()
  })

  it('renders the "Disparar ahora" trigger button', () => {
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    expect(screen.getByRole('button', { name: /disparar ahora/i })).toBeInTheDocument()
  })

  it('opens a confirmation dialog when the button is clicked', async () => {
    const user = userEvent.setup()
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/scheduled-promotion/)).toBeInTheDocument()
  })

  it('renders Confirmar and Cancelar buttons in the dialog', async () => {
    const user = userEvent.setup()
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
  })

  it('does NOT call triggerSchedulerJob when Cancelar is clicked', async () => {
    const user = userEvent.setup()
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(triggerSchedulerJobMock).not.toHaveBeenCalled()
    expect(onTriggeredMock).not.toHaveBeenCalled()
  })

  it('calls triggerSchedulerJob(jobName) when Confirmar is clicked', async () => {
    const user = userEvent.setup()
    triggerSchedulerJobMock.mockResolvedValue({ jobRunId: 'run-new', status: 'pending' })
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(triggerSchedulerJobMock).toHaveBeenCalledTimes(1)
    expect(triggerSchedulerJobMock).toHaveBeenCalledWith('scheduled-promotion')
  })

  it('fires onTriggered on success and closes the dialog', async () => {
    const user = userEvent.setup()
    triggerSchedulerJobMock.mockResolvedValue({ jobRunId: 'run-new', status: 'pending' })
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => {
      expect(onTriggeredMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the 429 rate-limit message and keeps the dialog open on TOO_MANY_REQUESTS', async () => {
    const user = userEvent.setup()
    const rateLimited = Object.assign(new Error('TOO_MANY_REQUESTS: rate limit'), {
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      name: 'ApiError',
    })
    triggerSchedulerJobMock.mockRejectedValueOnce(rateLimited)
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/espera.*antes de volver/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onTriggeredMock).not.toHaveBeenCalled()
  })

  it('disables the confirm button while the request is in flight', async () => {
    const user = userEvent.setup()
    let resolveTrigger: (value: unknown) => void = () => {}
    triggerSchedulerJobMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTrigger = resolve
      }),
    )
    render(<TriggerButton jobName="scheduled-promotion" onTriggered={onTriggeredMock} />)
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByTestId('trigger-dialog-confirm'))

    // While in flight, the confirm button is disabled (the label
    // changes to 'Disparando…' so we locate it via test-id rather
    // than the accessible name).
    const confirmBtn = screen.getByTestId('trigger-dialog-confirm')
    expect(confirmBtn).toBeDisabled()

    resolveTrigger({ jobRunId: 'run-new', status: 'pending' })
    await waitFor(() => {
      expect(onTriggeredMock).toHaveBeenCalled()
    })
  })
})
