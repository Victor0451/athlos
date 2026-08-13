import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'

const { replace, submitInquiry, getCurrentUser } = vi.hoisted(() => ({
  replace: vi.fn(),
  submitInquiry: vi.fn(),
  getCurrentUser: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/api/implementation-contact', () => ({ submitImplementationInquiry: submitInquiry }))

describe('PublicLandingPage', () => {
  beforeEach(() => {
    replace.mockReset()
    submitInquiry.mockReset()
    getCurrentUser.mockReturnValue(null)
  })

  it('positions Athlos first, provides the approved form and truthful privacy notice', async () => {
    const user = userEvent.setup()
    render(<Page />)

    expect(screen.getByRole('heading', { name: /athlos/i })).toBeInTheDocument()
    expect(screen.getByText(/club atlético gorriti.*edition/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /operator login/i })).toHaveAttribute('href', '/login')
    for (const label of 'Name|Organization|Role|Email|Primary problem|Phone|Message'.split('|')) {
      expect(screen.getByLabelText(new RegExp(label, 'i'))).toBeInTheDocument()
    }
    expect(
      screen.getByText(/does not persist inquiry content in its application or database/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/recipient mailbox retains the inquiry until manually deleted/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/member|revenue|operator metrics/i)).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('link', { name: /operator login/i })).toHaveFocus()
  })

  it('validates required fields, forwards a filled honeypot, and reports success', async () => {
    const user = userEvent.setup()
    submitInquiry.mockResolvedValue({ status: 'sent' })
    render(<Page />)
    await user.click(screen.getByRole('button', { name: /send inquiry/i }))
    expect(screen.getAllByRole('alert')).toHaveLength(5)

    await user.type(screen.getByLabelText(/name/i), 'Ada')
    await user.type(screen.getByLabelText(/organization/i), 'Club Example')
    await user.type(screen.getByLabelText(/role/i), 'Secretary')
    await user.type(screen.getByLabelText(/email/i), 'ada@example.test')
    await user.type(screen.getByLabelText(/primary problem/i), 'Need a clearer operating workflow')
    await user.type(document.querySelector('[name=website]')!, 'bot-filled')
    await user.click(screen.getByRole('button', { name: /send inquiry/i }))
    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1))
    expect(submitInquiry).toHaveBeenCalledWith({
      name: 'Ada',
      organization: 'Club Example',
      role: 'Secretary',
      email: 'ada@example.test',
      primaryProblem: 'Need a clearer operating workflow',
      website: 'bot-filled',
    })
    expect(screen.getByRole('status')).toHaveTextContent(/inquiry sent/i)
  })

  it('reports validation, rate-limit, and unavailable retry outcomes without duplicate submission', async () => {
    const user = userEvent.setup()
    let reject!: (reason: unknown) => void
    submitInquiry.mockReturnValue(new Promise((_, fail) => (reject = fail)))
    render(<Page />)
    for (const [label, value] of Object.entries({
      Name: 'Ada',
      Organization: 'Club',
      Role: 'Secretary',
      Email: 'ada@example.test',
      'Primary problem': 'Workflow',
    }))
      await user.type(screen.getByLabelText(new RegExp(label, 'i')), value)
    await user.click(screen.getByRole('button', { name: /send inquiry/i }))
    await user.click(screen.getByRole('button', { name: /sending/i }))
    expect(submitInquiry).toHaveBeenCalledTimes(1)
    reject(Object.assign(new Error('busy'), { status: 429 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many requests.*try again/i)
    submitInquiry.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }))
    await user.click(screen.getByRole('button', { name: /send inquiry/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/inquiry unavailable.*try again/i)
  })

  it('replaces the root route with the dashboard after authenticated hydration', async () => {
    getCurrentUser.mockReturnValue({ operator_id: 'operator-1' })
    render(<Page />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
  })
})
