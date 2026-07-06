import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

/**
 * Modal component tests — covers the responsive contract.
 *
 * Key invariants:
 *   - Renders nothing when `open` is false.
 *   - Renders title in the sticky header (h2 with id).
 *   - Body region has `overflow-y-auto` (scrolls internally).
 *   - Footer region has `shrink-0` (action buttons never collapse).
 *   - Outer panel has `max-h-[calc(100vh-2rem)]` (never exceeds viewport).
 *   - `role` toggles between 'dialog' and 'alertdialog'.
 *   - `aria-describedby` is wired when descriptionId is provided.
 *   - Footer is omitted when `footer` prop is undefined.
 */

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} title="Hello">
        <p>body</p>
      </Modal>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the title in an h2 with an auto-generated id (aria-labelledby wiring)', () => {
    render(
      <Modal open={true} title="Editar socio">
        <p>body</p>
      </Modal>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: /editar socio/i })
    expect(heading).toBeInTheDocument()
    // The dialog has aria-labelledby pointing to the heading's id
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id)
  })

  it('uses role="alertdialog" + aria-describedby for destructive confirmations', () => {
    render(
      <Modal open={true} title="Dar baja al socio" role="alertdialog" descriptionId="desc-1">
        <p id="desc-1">¿Dar de baja?</p>
      </Modal>,
    )
    const alert = screen.getByRole('alertdialog')
    expect(alert).toHaveAttribute('aria-describedby', 'desc-1')
    expect(alert).toHaveAttribute('aria-modal', 'true')
  })

  it('renders the body content in a scrollable region', () => {
    render(
      <Modal open={true} title="Hello">
        <p data-testid="body-content">body content</p>
      </Modal>,
    )
    const body = screen.getByTestId('body-content').parentElement
    expect(body).toHaveClass('overflow-y-auto')
    expect(body).toHaveClass('flex-1')
  })

  it('renders the footer when provided, with shrink-0 so buttons never collapse', () => {
    render(
      <Modal open={true} title="Hello" footer={<button>Confirmar</button>} dataTestid="test-modal">
        <p>body</p>
      </Modal>,
    )
    const footer = screen.getByTestId('test-modal-footer')
    expect(footer).toBeInTheDocument()
    expect(footer).toHaveClass('shrink-0')
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument()
  })

  it('omits the footer when the footer prop is undefined', () => {
    render(
      <Modal open={true} title="Hello" dataTestid="test-modal">
        <p>body</p>
      </Modal>,
    )
    expect(screen.queryByTestId('test-modal-footer')).not.toBeInTheDocument()
  })

  it('caps the panel height so it never exceeds the viewport', () => {
    render(
      <Modal open={true} title="Hello" dataTestid="test-modal">
        <p>body</p>
      </Modal>,
    )
    // The outer dialog is the backdrop; the inner panel is the first
    // child div.
    const panel = screen.getByTestId('test-modal').firstElementChild as HTMLElement
    expect(panel).toHaveClass('max-h-[calc(100vh-2rem)]')
    expect(panel).toHaveClass('overflow-hidden')
    expect(panel).toHaveClass('flex')
    expect(panel).toHaveClass('flex-col')
  })

  it('applies the size variant to the panel max-width', () => {
    const { rerender } = render(
      <Modal open={true} title="A" size="sm" dataTestid="m">
        <p>x</p>
      </Modal>,
    )
    let panel = screen.getByTestId('m').firstElementChild as HTMLElement
    expect(panel).toHaveClass('max-w-sm')

    rerender(
      <Modal open={true} title="A" size="md" dataTestid="m">
        <p>x</p>
      </Modal>,
    )
    panel = screen.getByTestId('m').firstElementChild as HTMLElement
    expect(panel).toHaveClass('max-w-md')

    rerender(
      <Modal open={true} title="A" size="xl" dataTestid="m">
        <p>x</p>
      </Modal>,
    )
    panel = screen.getByTestId('m').firstElementChild as HTMLElement
    expect(panel).toHaveClass('max-w-2xl')
  })

  it('keeps the header sticky (shrink-0) so the title is always visible while the body scrolls', () => {
    render(
      <Modal open={true} title="Hello" dataTestid="m">
        <p>body</p>
      </Modal>,
    )
    const header = screen.getByRole('heading', { level: 2 }).closest('header')
    expect(header).toHaveClass('shrink-0')
  })

  it('exposes a footer button as a regular interactive element', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <Modal
        open={true}
        title="Confirmar"
        footer={
          <>
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit">Confirmar</button>
          </>
        }
      >
        <p>¿Seguro?</p>
      </Modal>,
    )
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
