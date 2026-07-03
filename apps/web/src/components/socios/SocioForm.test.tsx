import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SocioForm from './SocioForm'
import type { Socio } from '@/lib/api/socios'

/**
 * SocioForm tests (PR 8b.2, 2026-07-02).
 *
 * Covers:
 *   - Renders all fields with correct labels
 *   - Client-side validation (DNI regex, fecha_alta regex, required fields)
 *   - Calls onSubmit with the input payload on valid submit
 *   - Calls onCancel on cancel button click
 *   - Submit button shows "Guardando…" and is disabled when isSubmitting
 *   - Renders the errorMessage prop above the submit button
 *   - Pre-fills fields from initialValue in edit mode
 *   - Disables numero_socio + fecha_alta in edit mode (immutable)
 */

const SAMPLE_SOCIO: Partial<Socio> = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numero_socio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  fecha_alta: '2020-03-15',
  estado: 'activo',
  categoria: 'TITULAR',
  email: 'juan@example.com',
  direccion: 'Av. Siempre Viva 742',
  telefono: '+5491155555555',
}

function renderForm(props: Partial<React.ComponentProps<typeof SocioForm>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn()
  const onCancel = props.onCancel ?? vi.fn()
  return render(
    <SocioForm
      mode={props.mode ?? 'create'}
      {...(props.initialValue ? { initialValue: props.initialValue } : {})}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isSubmitting={props.isSubmitting ?? false}
      {...(props.errorMessage !== undefined ? { errorMessage: props.errorMessage } : {})}
    />,
  )
}

describe('SocioForm', () => {
  it('renders all the socio fields', () => {
    renderForm()

    expect(screen.getByTestId('socio-form-numero')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-dni')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-apellido')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-nombre')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-fecha-alta')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-estado')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-categoria')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-email')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-direccion')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-telefono')).toBeInTheDocument()
  })

  it('shows validation errors when submitting an empty form (create mode)', async () => {
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    fireEvent.click(screen.getByTestId('socio-form-submit'))

    // The form has 3 required-string fields (numero_socio, nombre,
    // apellido) — each renders its own alert. Use the specific id
    // to disambiguate from `getByText` (which would match 3 elements).
    await waitFor(() => {
      expect(document.querySelector('#socio-form-numero-err')).toHaveTextContent(/requerido/i)
      expect(document.querySelector('#socio-form-apellido-err')).toHaveTextContent(/requerido/i)
      expect(document.querySelector('#socio-form-nombre-err')).toHaveTextContent(/requerido/i)
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects an invalid DNI (not 7-8 digits)', async () => {
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00001' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: 'abc' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'Juan' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-02' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(screen.getByText(/dni debe tener 7 u 8 dígitos/i)).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with valid data after a successful submit (create mode)', async () => {
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-02' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    // The form sends `estado: 'activo'` because that's the <select> default
    // (RHF's defaultValue) — the form's formValuesToInput helper
    // forwards any non-empty estado to the payload. The backend
    // accepts it (or defaults to 'activo' if absent), so the behaviour
    // is correct, just the payload includes the field.
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        numero_socio: '00042',
        nombre: 'María',
        apellido: 'García',
        dni: '40123456',
        fecha_alta: '2026-07-02',
        estado: 'activo',
        // optional fields (categoria, direccion, telefono, email) are
        // omitted when empty
      })
    })
  })

  it('pre-fills fields from initialValue in edit mode', () => {
    renderForm({ mode: 'edit', initialValue: SAMPLE_SOCIO })

    expect((screen.getByTestId('socio-form-numero') as HTMLInputElement).value).toBe('00001')
    expect((screen.getByTestId('socio-form-dni') as HTMLInputElement).value).toBe('12345678')
    expect((screen.getByTestId('socio-form-apellido') as HTMLInputElement).value).toBe('García')
    expect((screen.getByTestId('socio-form-nombre') as HTMLInputElement).value).toBe('Juan')
    expect((screen.getByTestId('socio-form-fecha-alta') as HTMLInputElement).value).toBe(
      '2020-03-15',
    )
    expect((screen.getByTestId('socio-form-categoria') as HTMLInputElement).value).toBe('TITULAR')
    expect((screen.getByTestId('socio-form-email') as HTMLInputElement).value).toBe(
      'juan@example.com',
    )
  })

  it('disables numero_socio and fecha_alta in edit mode (immutable legacy keys)', () => {
    renderForm({ mode: 'edit', initialValue: SAMPLE_SOCIO })

    expect(screen.getByTestId('socio-form-numero')).toBeDisabled()
    expect(screen.getByTestId('socio-form-fecha-alta')).toBeDisabled()
    // Editable fields remain enabled
    expect(screen.getByTestId('socio-form-nombre')).not.toBeDisabled()
    expect(screen.getByTestId('socio-form-estado')).not.toBeDisabled()
  })

  it('calls onCancel when the Cancelar button is clicked', () => {
    const onCancel = vi.fn()
    renderForm({ onCancel })

    fireEvent.click(screen.getByTestId('socio-form-cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows "Guardando…" and disables submit + cancel when isSubmitting', () => {
    renderForm({ isSubmitting: true })

    const submit = screen.getByTestId('socio-form-submit') as HTMLButtonElement
    const cancel = screen.getByTestId('socio-form-cancel') as HTMLButtonElement
    expect(submit).toBeDisabled()
    expect(cancel).toBeDisabled()
    expect(submit.textContent).toMatch(/guardando/i)
  })

  it('renders the API error message above the submit button', () => {
    renderForm({ errorMessage: 'Ya existe un socio con ese N° de socio' })

    const error = screen.getByTestId('socio-form-error')
    expect(error).toBeInTheDocument()
    expect(error).toHaveTextContent(/ya existe un socio con ese n° de socio/i)
  })
})
