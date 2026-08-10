import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Page from './page'

describe('PublicLandingPage', () => {
  it('describes Athlos as Club Atlético Gorriti private operational system', () => {
    render(<Page />)

    expect(
      screen.getByRole('heading', { name: /athlos para club atlético gorriti/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/sistema privado para la gestión del club/i)).toBeInTheDocument()
    expect(screen.getByText(/prioriza información confiable/i)).toBeInTheDocument()
  })

  it('offers sign-in as the only action and keeps operational data private', () => {
    render(<Page />)

    const signIn = screen.getByRole('link', { name: /iniciar sesión/i })
    expect(signIn).toHaveAttribute('href', '/login')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(
      screen.queryByText(/miembros|métricas|programador|estado del sistema/i),
    ).not.toBeInTheDocument()
  })
})
