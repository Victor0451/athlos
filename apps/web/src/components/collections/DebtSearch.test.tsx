import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DebtSearch } from './DebtSearch'

const result = { id: 'socio-2', nombre: 'Luis', apellido: 'Pérez', numero_socio: '7' }

function search(overrides: Partial<React.ComponentProps<typeof DebtSearch>> = {}) {
  return (
    <DebtSearch
      socios={[]}
      selectedSocio={null}
      onSearch={vi.fn()}
      onSelectSocio={vi.fn()}
      {...overrides}
    />
  )
}

describe('DebtSearch', () => {
  it('keeps the entered term while reporting local async search progress and no results', async () => {
    let resolveSearch!: () => void
    render(
      search({
        onSearch: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveSearch = resolve
            }),
        ),
      }),
    )

    const input = screen.getByRole('searchbox', { name: /buscar socio/i })
    fireEvent.change(input, { target: { value: 'ana' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(input).toHaveValue('ana')
    expect(screen.getByRole('status')).toHaveTextContent(/buscando socios/i)

    resolveSearch()
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/no se encontraron socios/i),
    )
  })

  it('focuses a safe alert when searching fails', async () => {
    render(search({ onSearch: vi.fn().mockRejectedValue(new Error('sin conexión')) }))

    fireEvent.submit(screen.getByRole('search'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo buscar socios/i)
    expect(alert).toHaveFocus()
  })

  it('renders member results without exposing their opaque identifiers and selects the member', () => {
    const onSelectSocio = vi.fn()
    render(search({ socios: [result], onSelectSocio }))

    fireEvent.click(screen.getByRole('button', { name: /pérez, luis/i }))
    expect(onSelectSocio).toHaveBeenCalledWith(result)
    expect(screen.queryByText('socio-2')).not.toBeInTheDocument()
  })
})
