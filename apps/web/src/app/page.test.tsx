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

  it('presents Athlos as a product, provides the Spanish form, and states the privacy notice', async () => {
    const user = userEvent.setup()
    render(<Page />)

    expect(screen.getByRole('heading', { name: /athlos/i })).toBeInTheDocument()
    expect(screen.getByText(/edición actual/i)).toBeInTheDocument()
    expect(screen.getByText(/club atlético gorriti/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /acceso de operadores/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(
      screen.getByRole('heading', { name: /gestionar el padrón de socios/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /ordenar los tipos de afiliación/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /gestionar cuotas y cuenta corriente/i }),
    ).toBeInTheDocument()
    for (const label of 'Nombre|Organización|Rol|Correo electrónico|Problema principal|Teléfono|Mensaje'.split(
      '|',
    )) {
      expect(screen.getByLabelText(new RegExp(label, 'i'))).toBeInTheDocument()
    }
    expect(screen.getByText(/no conserva el contenido de la consulta/i)).toBeInTheDocument()
    expect(screen.getByText(/buzón receptor conserva la consulta/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/128 socios|134 socios|1200|950|revenue|operator metrics/i),
    ).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('link', { name: /acceso de operadores/i })).toHaveFocus()
  })

  it('validates required fields, forwards a filled honeypot, and reports success in Spanish', async () => {
    const user = userEvent.setup()
    submitInquiry.mockResolvedValue({ status: 'sent' })
    render(<Page />)
    await user.click(screen.getByRole('button', { name: /enviar consulta/i }))
    expect(screen.getAllByRole('alert')).toHaveLength(5)

    await user.type(screen.getByLabelText(/nombre/i), 'Ada')
    await user.type(screen.getByLabelText(/organización/i), 'Club Example')
    await user.type(screen.getByLabelText(/rol/i), 'Secretaría')
    await user.type(screen.getByLabelText(/correo electrónico/i), 'ada@example.test')
    await user.type(
      screen.getByLabelText(/problema principal/i),
      'Necesitamos un flujo operativo más claro',
    )
    await user.type(document.querySelector('[name=website]')!, 'bot-filled')
    await user.click(screen.getByRole('button', { name: /enviar consulta/i }))
    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1))
    expect(submitInquiry).toHaveBeenCalledWith({
      name: 'Ada',
      organization: 'Club Example',
      role: 'Secretaría',
      email: 'ada@example.test',
      primaryProblem: 'Necesitamos un flujo operativo más claro',
      website: 'bot-filled',
    })
    expect(screen.getByRole('status')).toHaveTextContent(/consulta enviada/i)
  })

  it('reports validation, rate-limit, and unavailable retry outcomes without duplicate submission', async () => {
    const user = userEvent.setup()
    let reject!: (reason: unknown) => void
    submitInquiry.mockReturnValue(new Promise((_, fail) => (reject = fail)))
    render(<Page />)
    for (const [label, value] of Object.entries({
      Nombre: 'Ada',
      Organización: 'Club',
      Rol: 'Secretaría',
      'Correo electrónico': 'ada@example.test',
      'Problema principal': 'Flujo operativo',
    }))
      await user.type(screen.getByLabelText(new RegExp(label, 'i')), value)
    await user.click(screen.getByRole('button', { name: /enviar consulta/i }))
    await user.click(screen.getByRole('button', { name: /enviando/i }))
    expect(submitInquiry).toHaveBeenCalledTimes(1)
    reject(Object.assign(new Error('busy'), { status: 429 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /demasiadas solicitudes.*nuevamente/i,
    )
    submitInquiry.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }))
    await user.click(screen.getByRole('button', { name: /enviar consulta/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no fue posible enviar.*nuevamente/i)
  })

  it('replaces the root route with the dashboard after authenticated hydration', async () => {
    getCurrentUser.mockReturnValue({ operator_id: 'operator-1' })
    render(<Page />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
  })
})
