// @vitest-environment jsdom
// Written with explicit React.createElement instead of JSX: this file gets executed by
// runners without the app's vite plugin-react config (automatic JSX runtime), and a classic
// JSX transform there compiles JSX to a `React` reference that its SSR pass fails to bind.
// Plain createElement calls are transform-agnostic and run everywhere. React 19 types put
// children inside the props object.
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from './Alert'

describe('Alert', () => {
  it('renders an error alert with role="alert"', () => {
    render(
      React.createElement(Alert, {
        tone: 'error',
        children: 'No se pudo registrar el movimiento.',
      }),
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('No se pudo registrar el movimiento.')
    expect(alert.querySelector('svg')).not.toBeNull()
  })

  it('renders a success alert with role="status"', () => {
    render(React.createElement(Alert, { tone: 'success', children: 'Turno cerrado.' }))
    expect(screen.getByRole('status')).toHaveTextContent('Turno cerrado.')
  })

  it('renders warnings with role="alert" and info with role="status"', () => {
    render(
      React.createElement(React.Fragment, {
        children: [
          React.createElement(Alert, {
            key: 'warning',
            tone: 'warning',
            children: 'La operación está confirmada, pero no se pudo actualizar.',
          }),
          React.createElement(Alert, {
            key: 'info',
            tone: 'info',
            children: 'El motivo es obligatorio si existe diferencia.',
          }),
        ],
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('no se pudo actualizar')
    expect(screen.getByRole('status')).toHaveTextContent('El motivo es obligatorio')
  })

  it('merges extra classes into the container', () => {
    render(React.createElement(Alert, { tone: 'error', className: 'mt-3', children: 'X' }))
    expect(screen.getByRole('alert')).toHaveClass('mt-3')
  })
})
