import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ToasterMount, notify } from './Toast'

/**
 * Toast primitive tests — wrapper around sonner that owns the
 * project's locked defaults (top-right, light, richColors, closeButton)
 * and stamps `role="status"` (success/info) or `role="alert"` (error)
 * on the rendered `<li>` via sonner's `classNames.toast` slot + a
 * DOM-touch `useEffect`.
 *
 * The contract these tests pin is the one enforced by spec
 * `toast-notifications/spec.md` (5 requirements, 18 scenarios) and
 * the ui-design delta. If a future change breaks any of these
 * assertions, the wrapper is no longer honouring the visual /
 * accessibility contract — treat it as a regression.
 *
 * Mocking strategy: we exercise the wrapper two ways:
 *   1. **Render path**: a real `<ToasterMount />` renders the sonner
 *      portal; the `<li>` appears with the correct role after our
 *      DOM-touch useEffect fires. Used for ARIA + mount contract.
 *   2. **Spy path**: a `vi.spyOn` on `sonner.toast.success/.error/.info`
 *      captures the `duration` / `classNames` / `description` / `id`
 *      forwarded by `notify()`. Used for the auto-dismiss duration
 *      contract (we don't try to drive sonner's internal timers here).
 *
 * Race-condition note: sonner's module-level store publishes new
 * toasts to its subscribers only at publish-time. If we call
 * `notify()` before the `<ToasterMount />` useEffect that registers
 * the subscriber has fired, the toast is added to the store but the
 * subscriber never sees it. The render-path tests therefore wait for
 * the toaster section (`Notifications alt+T` aria-label) to mount
 * before calling `notify()`.
 */

const SONNER_SECTION_LABEL = /Notifications/i

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Sonner renders into `document.body`; between tests we drop any
  // active toasts so each scenario starts from a clean DOM.
  act(() => {
    document.body.innerHTML = ''
  })
})

/** Mount <ToasterMount /> and wait for the sonner section to be in the DOM. */
async function mountToaster() {
  render(<ToasterMount />)
  await screen.findByLabelText(SONNER_SECTION_LABEL)
}

describe('ToasterMount', () => {
  it('mounts a sonner section inside document.body after first render', async () => {
    await mountToaster()
    expect(screen.getByLabelText(SONNER_SECTION_LABEL)).toBeInTheDocument()
  })

  it('does not render any toasts before notify() is called', async () => {
    await mountToaster()
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
  })
})

describe('notify() — render path (real sonner)', () => {
  beforeEach(async () => {
    await mountToaster()
  })

  it('returns a non-empty string id', () => {
    const id = notify('success', 'Hecho')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('renders a success toast with role="status" after the effect fires', async () => {
    act(() => {
      notify('success', 'Socio guardado')
    })
    const toastEl = await screen.findByRole('status')
    expect(toastEl).toBeInTheDocument()
    expect(toastEl).toHaveTextContent('Socio guardado')
  })

  it('renders an error toast with role="alert" after the effect fires', async () => {
    act(() => {
      notify('error', 'No se pudo guardar')
    })
    const toastEl = await screen.findByRole('alert')
    expect(toastEl).toBeInTheDocument()
    expect(toastEl).toHaveTextContent('No se pudo guardar')
  })

  it('renders an info toast with role="status" after the effect fires', async () => {
    act(() => {
      notify('info', 'Cargando…')
    })
    const toastEl = await screen.findByRole('status')
    expect(toastEl).toBeInTheDocument()
    expect(toastEl).toHaveTextContent('Cargando…')
  })

  it('passes the description through as the secondary line', async () => {
    act(() => {
      notify('success', 'Hecho', { description: 'Detalles abajo' })
    })
    const toastEl = await screen.findByRole('status')
    expect(toastEl).toHaveTextContent('Hecho')
    expect(toastEl).toHaveTextContent('Detalles abajo')
  })

  it('renders multiple concurrent toasts with the right roles', async () => {
    act(() => {
      notify('success', 'uno')
      notify('error', 'dos')
      notify('info', 'tres')
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(3)
    })
    expect(document.querySelectorAll('[data-sonner-toast][role="status"]').length).toBe(2)
    expect(document.querySelectorAll('[data-sonner-toast][role="alert"]').length).toBe(1)
  })
})

describe('notify() — contract path (spy on sonner)', () => {
  it('forwards success durationMs=4000 by default', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'success').mockReturnValue(1)
    notify('success', 'A')
    expect(spy).toHaveBeenCalledWith('A', expect.objectContaining({ duration: 4000 }))
  })

  it('forwards error durationMs=6000 by default', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'error').mockReturnValue(2)
    notify('error', 'B')
    expect(spy).toHaveBeenCalledWith('B', expect.objectContaining({ duration: 6000 }))
  })

  it('forwards info durationMs=4000 by default', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'info').mockReturnValue(3)
    notify('info', 'C')
    expect(spy).toHaveBeenCalledWith('C', expect.objectContaining({ duration: 4000 }))
  })

  it('honours an explicit durationMs override', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'success').mockReturnValue(4)
    notify('success', 'X', { durationMs: 1234 })
    expect(spy).toHaveBeenCalledWith('X', expect.objectContaining({ duration: 1234 }))
  })

  it('stamps the athlos-toast--<kind> class on the classNames.toast slot', async () => {
    const sonner = await import('sonner')
    const spySuccess = vi.spyOn(sonner.toast, 'success').mockReturnValue(5)
    const spyError = vi.spyOn(sonner.toast, 'error').mockReturnValue(6)
    const spyInfo = vi.spyOn(sonner.toast, 'info').mockReturnValue(7)

    notify('success', 'A')
    notify('error', 'B')
    notify('info', 'C')

    expect(spySuccess).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        classNames: expect.objectContaining({
          toast: expect.stringContaining('athlos-toast--success'),
        }),
      }),
    )
    expect(spyError).toHaveBeenCalledWith(
      'B',
      expect.objectContaining({
        classNames: expect.objectContaining({
          toast: expect.stringContaining('athlos-toast--error'),
        }),
      }),
    )
    expect(spyInfo).toHaveBeenCalledWith(
      'C',
      expect.objectContaining({
        classNames: expect.objectContaining({
          toast: expect.stringContaining('athlos-toast--info'),
        }),
      }),
    )
  })

  it('forwards description when provided', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'success').mockReturnValue(8)
    notify('success', 'A', { description: 'línea secundaria' })
    expect(spy).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ description: 'línea secundaria' }),
    )
  })

  it('forwards id when provided', async () => {
    const sonner = await import('sonner')
    const spy = vi.spyOn(sonner.toast, 'success').mockReturnValue(9)
    notify('success', 'A', { id: 'custom-id' })
    expect(spy).toHaveBeenCalledWith('A', expect.objectContaining({ id: 'custom-id' }))
  })

  it('returns a string id when sonner returns a number id', async () => {
    // The contract in the spec is `string`; sonner may return a
    // number depending on the version path. The wrapper coerces to
    // string so callers always get a stable shape.
    const sonner = await import('sonner')
    vi.spyOn(sonner.toast, 'success').mockReturnValue(42 as unknown as string)
    const id = notify('success', 'A')
    expect(typeof id).toBe('string')
    expect(id).toBe('42')
  })
})
