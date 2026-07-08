import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Socio detail page tests (TASK-021, PR 8b.1; second-slice: sectioned
 * layout + CtacteTab, PR 8b.2 second slice).
 *
 * The dynamic segment is read via `useParams()` from `next/navigation`,
 * which the test mocks to return `{ id: SAMPLE_SOCIO.id }`. We use
 * `useParams` (not `use(params)`) so the test doesn't need a
 * Suspense boundary — `useParams` is plain read from Next's router
 * context and works in jsdom.
 *
 * The CtacteTab child is exercised via the mocked `getCtacte` wrapper
 * — we keep the assertions on the page shell rather than the inner
 * tab (full CtacteTab coverage lives in `CtacteTab.test.tsx`).
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const useParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios/abc',
  useSearchParams: () => new URLSearchParams(),
  useParams: <T,>() => useParamsMock() as T,
}))

const getSocioMock = vi.fn()
const updateSocioMock = vi.fn()
const deleteSocioMock = vi.fn()
const listSocioNotesMock = vi.fn()
const createSocioNoteMock = vi.fn()
const updateSocioNoteMock = vi.fn()
const deleteSocioNoteMock = vi.fn()
const getSocioAuditMock = vi.fn()
// PR 8c.2 — Legajo tab. The page-level mock for `@/lib/api/socios`
// covers the notes + audit surface; attachments live in their own
// module (`@/lib/api/attachments`) so we mock that separately.
const listAttachmentsMock = vi.fn()

// PR 8b.7 — toast primitive. Mock `@/lib/notifications`
// synchronously (D8 + R4) so the page wires `notify` into the
// 3 page-level mutations without rendering a real <ToasterMount />.
const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock-1')
vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/lib/api/socios', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    getSocio: (...args: unknown[]) => getSocioMock(...args),
    createSocio: vi.fn(),
    updateSocio: (...args: unknown[]) => updateSocioMock(...args),
    deleteSocio: (...args: unknown[]) => deleteSocioMock(...args),
    listSocioNotes: (...args: unknown[]) => listSocioNotesMock(...args),
    createSocioNote: (...args: unknown[]) => createSocioNoteMock(...args),
    updateSocioNote: (...args: unknown[]) => updateSocioNoteMock(...args),
    deleteSocioNote: (...args: unknown[]) => deleteSocioNoteMock(...args),
    getSocioAudit: (...args: unknown[]) => getSocioAuditMock(...args),
  }
})
// The mock must export every name the page imports so partial mocks
// don't trip TS on the page side — hence `createSocio` is included
// even though the page itself doesn't call it directly (the test
// uses it as a "mutation hooks library" placeholder).

const getCtacteMock = vi.fn()
vi.mock('@/lib/api/ctacte', () => ({
  getCtacte: (...args: unknown[]) => getCtacteMock(...args),
  getMovimientos: vi.fn(),
}))

vi.mock('@/lib/api/attachments', () => ({
  listAttachments: (...args: unknown[]) => listAttachmentsMock(...args),
  deleteAttachment: vi.fn(),
  uploadAttachment: vi.fn(),
  getAttachment: vi.fn(),
  attachmentFileUrl: vi.fn(),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: SocioDetailPage } = await import('./page')

function makeAdminUser() {
  return {
    user: {
      operator_id: 'op-admin',
      role: 'ADMIN' as const,
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function makeOperadorUser() {
  return {
    user: {
      operator_id: 'op-1',
      role: 'OPERADOR' as const,
      username: 'operador',
      permissions: { can_reprint: false, can_anulate: false },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

const SAMPLE_SOCIO = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numero_socio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  fecha_alta: '2020-03-15',
  estado: 'activo' as const,
  categoria: 'TITULAR',
  direccion: 'Av. Siempre Viva 742',
  telefono: '+5491155555555',
  email: 'juan@example.com',
  created_at: '2020-03-15T12:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
  deleted_at: null,
}

const SAMPLE_CTACTE = {
  socioId: SAMPLE_SOCIO.id,
  saldo: '1500.00',
  saldo_calculado_at: '2026-06-29T12:00:00.000Z',
  movimientos: [],
  page: 1,
  limit: 20,
  total: 0,
  has_more: false,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SocioDetailPage />
    </QueryClientProvider>,
  )
}

describe('Socio detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useParamsMock.mockReset()
    useParamsMock.mockReturnValue({ id: SAMPLE_SOCIO.id })
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSocioMock.mockReset()
    getSocioMock.mockResolvedValue(SAMPLE_SOCIO)
    getCtacteMock.mockReset()
    getCtacteMock.mockResolvedValue(SAMPLE_CTACTE)
    listSocioNotesMock.mockReset()
    listSocioNotesMock.mockResolvedValue([])
    createSocioNoteMock.mockReset()
    updateSocioNoteMock.mockReset()
    deleteSocioNoteMock.mockReset()
    getSocioAuditMock.mockReset()
    getSocioAuditMock.mockResolvedValue([])
    listAttachmentsMock.mockReset()
    listAttachmentsMock.mockResolvedValue([])
    notifyMock.mockReset()
    notifyMock.mockReturnValue('toast-mock-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls getSocio with the dynamic segment id', async () => {
    renderPage()
    await waitFor(() => {
      expect(getSocioMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id)
    })
  })

  it('renders the socio name (apellido, nombre) and DNI in the header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/garcía.*juan/i)
    })
    expect(screen.getByText(/dni.*12345678/i)).toBeInTheDocument()
  })

  it('renders the estado badge with the right copy', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-estado')).toHaveTextContent('activo')
    })
  })

  it('renders the sectioned fields (Datos personales + Contacto)', async () => {
    renderPage()
    // Default tab is Datos personales.
    await waitFor(() => {
      expect(screen.getByTestId('socio-section-datos-personales')).toBeInTheDocument()
    })
    // Datos personales panel shows the legacy keys (numero_socio + fecha_alta)
    // + the flat field grid.
    expect(screen.getByTestId('socio-field-numero_socio')).toBeInTheDocument()
    expect(screen.getByText('00001')).toBeInTheDocument()
    expect(screen.getByTestId('socio-field-fecha_alta')).toBeInTheDocument()
    expect(screen.getByText('15/03/2020')).toBeInTheDocument()
    // Contacto panel is rendered only when its tab is active (tabs
    // are rendered lazily for performance — no reason to mount 3
    // query hooks on page load).
    expect(screen.queryByTestId('socio-section-contacto')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /contacto/i }))
    await waitFor(() => {
      expect(screen.getByTestId('socio-section-contacto')).toBeInTheDocument()
    })
    // The previously-flat grid still renders per-field testids.
    expect(screen.getByTestId('socio-field-email')).toBeInTheDocument()
    expect(screen.getByText('juan@example.com')).toBeInTheDocument()
    expect(screen.getByText('+5491155555555')).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', () => {
    getSocioMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('socio-detail-loading')).toBeInTheDocument()
  })

  it('renders a "Socio no encontrado" error state when the API rejects', async () => {
    // The apiFetch wrapper throws ApiError on !res.ok. The detail
    // page catches the error and renders the not-found copy.
    getSocioMock.mockRejectedValue(new Error('NOT_FOUND: socio no encontrado'))

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/socio no encontrado/i)).toBeInTheDocument()
    })
  })

  it('renders a "Volver al listado" button that calls router.back()', async () => {
    // After Slice B: the back control is a <button>, not a <Link> —
    // it calls router.back() so the user returns to whatever filtered
    // list they came from (preserves the search params in the URL).
    // No href: the button has no destination of its own.
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /volver/i })).not.toBeInTheDocument()
  })

  /* ── CtacteTab (PR 8b.2 second slice) ────────────────────────────── */

  it('renders the CtacteTab with the socio id', async () => {
    renderPage()
    // The CtacteTab mounts only when its tab is active — the tab
    // click triggers the query (lazy mount + lazy fetch).
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /cuenta corriente/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('tab', { name: /cuenta corriente/i }))
    await waitFor(() => {
      expect(getCtacteMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id, { limit: 20 })
    })
    // The tab component renders the saldo + an empty-state message
    // when there are no movimientos (matches the SAMPLE_CTACTE shape).
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-tab-saldo')).toBeInTheDocument()
    })
  })

  it('passes the dynamic segment id to the CtacteTab', async () => {
    const otherId = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'
    useParamsMock.mockReturnValue({ id: otherId })
    getCtacteMock.mockResolvedValueOnce({
      ...SAMPLE_CTACTE,
      socioId: otherId,
    })
    renderPage()
    // The CtacteTab is lazy-mounted: the tab click triggers the query.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /cuenta corriente/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('tab', { name: /cuenta corriente/i }))
    await waitFor(() => {
      expect(getCtacteMock).toHaveBeenCalledWith(otherId, { limit: 20 })
    })
  })

  /* ── Write surface (PR 8b.2) ─────────────────────────────────────── */

  it('renders Editar + Dar baja buttons when the user is ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-edit')).toBeInTheDocument()
    })
    expect(screen.getByTestId('socio-detail-delete')).toBeInTheDocument()
  })

  it('hides Editar + Eliminar buttons when the user is not ADMIN', async () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-back')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('socio-detail-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('socio-detail-delete')).not.toBeInTheDocument()
  })

  it('opens the edit modal when Editar is clicked, and submits the update', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    updateSocioMock.mockResolvedValueOnce(SAMPLE_SOCIO)
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-edit'))
    fireEvent.click(screen.getByTestId('socio-detail-edit'))

    // The edit modal contains the form
    expect(await screen.findByTestId('socio-edit-modal')).toBeInTheDocument()
    expect(screen.getByTestId('socio-form-edit')).toBeInTheDocument()

    // The form is pre-filled with the current socio (numero_socio + fecha_alta are read-only)
    expect((screen.getByTestId('socio-form-numero') as HTMLInputElement).value).toBe('00001')
    expect(screen.getByTestId('socio-form-numero')).toBeDisabled()
    expect(screen.getByTestId('socio-form-fecha-alta')).toBeDisabled()

    // Submit after editing a field. Because the form is pre-filled with
    // the existing socio, the onSubmit payload includes ALL fields, with
    // the changed telefono overriding the original. The backend's PATCH
    // accepts any subset, so this is a "full update" rather than a
    // "diff update" — acceptable behaviour for v1 (future PR can
    // implement diff-aware submission if needed).
    fireEvent.input(screen.getByTestId('socio-form-telefono'), {
      target: { value: '+5491100000000' },
    })
    fireEvent.click(screen.getByTestId('socio-edit-submit'))

    await waitFor(() => {
      // The form now strips the immutable legacy keys
      // (numero_socio + fecha_alta) before submitting to PATCH — the
      // backend's updateBodySchema is .strict() so a full-update
      // payload was being rejected with VALIDATION_ERROR. See
      // SocioForm.tsx → formValuesToUpdateInput.
      expect(updateSocioMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id, {
        nombre: 'Juan',
        apellido: 'García',
        dni: '12345678',
        estado: 'activo',
        categoria: 'TITULAR',
        email: 'juan@example.com',
        direccion: 'Av. Siempre Viva 742',
        telefono: '+5491100000000',
      })
    })
  })

  it('opens the delete confirmation modal, then calls deleteSocio + navigates to /socios', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    deleteSocioMock.mockResolvedValueOnce({
      ...SAMPLE_SOCIO,
      estado: 'baja',
      deleted_at: '2026-07-02T12:00:00.000Z',
    })
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-delete'))
    fireEvent.click(screen.getByTestId('socio-detail-delete'))

    // The delete confirmation modal appears
    expect(await screen.findByTestId('socio-delete-modal')).toBeInTheDocument()
    expect(screen.getByText(/dar de baja a/i)).toBeInTheDocument()

    // Cancel keeps the modal open... no actually, Cancel closes it
    fireEvent.click(screen.getByTestId('socio-delete-cancel'))
    await waitFor(() => {
      expect(screen.queryByTestId('socio-delete-modal')).not.toBeInTheDocument()
    })
    expect(deleteSocioMock).not.toHaveBeenCalled()

    // Re-open and confirm
    fireEvent.click(screen.getByTestId('socio-detail-delete'))
    fireEvent.click(await screen.findByTestId('socio-delete-confirm'))

    await waitFor(() => {
      expect(deleteSocioMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id)
      expect(pushMock).toHaveBeenCalledWith('/socios')
    })
  })

  /* ── PR 8c.2: Legajo tab wiring ───────────────────────────── */

  it('renders the Legajo tab in the tab list', async () => {
    renderPage()
    await waitFor(() => {
      // Tab is visible in the tablist (matches the AuditTab testid pattern).
      expect(screen.getByRole('tab', { name: /legajo/i })).toBeInTheDocument()
    })
  })

  it('clicking the Legajo tab renders the LegajoTab panel + section header', async () => {
    // The listAttachments mock is provided via the page test's existing
    // mock chain for `@/lib/api/socios`; for PR 8c.2 we also need to
    // add `listAttachments` to that mock. See the mock declaration
    // above for the patch.
    listAttachmentsMock.mockResolvedValueOnce([])
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /legajo/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('tab', { name: /legajo/i }))

    await waitFor(() => {
      expect(screen.getByTestId('socio-section-legajo')).toBeInTheDocument()
    })
    expect(screen.getByText(/legajo del socio/i)).toBeInTheDocument()
    // The upload component + empty state are part of the LegajoTab
    // surface — verify they show up once the panel is mounted.
    await waitFor(() => {
      expect(screen.getByTestId('attachment-upload-dropzone')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByTestId('legajo-tab-empty')).toBeInTheDocument()
    })
  })

  /* ── PR 8b.7: toast notifications on page-level mutations ─────── */

  it('fires notify("success", "Socio actualizado") on update success', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    updateSocioMock.mockResolvedValueOnce(SAMPLE_SOCIO)
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-edit'))
    fireEvent.click(screen.getByTestId('socio-detail-edit'))
    await screen.findByTestId('socio-edit-modal')
    fireEvent.click(screen.getByTestId('socio-edit-submit'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Socio actualizado')
    })
  })

  it('fires notify("error", "No se pudo actualizar el socio") on update failure', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    updateSocioMock.mockRejectedValueOnce(new Error('VALIDATION_ERROR: bad payload'))
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-edit'))
    fireEvent.click(screen.getByTestId('socio-detail-edit'))
    await screen.findByTestId('socio-edit-modal')
    fireEvent.click(screen.getByTestId('socio-edit-submit'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', 'No se pudo actualizar el socio')
    })
  })

  it('fires notify("success", "Socio dado de baja") + router.push on delete success', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    deleteSocioMock.mockResolvedValueOnce({
      ...SAMPLE_SOCIO,
      estado: 'baja',
      deleted_at: '2026-07-02T12:00:00.000Z',
    })
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-delete'))
    fireEvent.click(screen.getByTestId('socio-detail-delete'))
    fireEvent.click(await screen.findByTestId('socio-delete-confirm'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Socio dado de baja')
      expect(deleteSocioMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id)
      expect(pushMock).toHaveBeenCalledWith('/socios')
    })
  })

  it('fires notify("error", "No se pudo dar de baja el socio") + keeps inline deleteError on delete failure', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    deleteSocioMock.mockRejectedValueOnce(new Error('CONFLICT: socio in use'))
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-delete'))
    fireEvent.click(screen.getByTestId('socio-detail-delete'))
    fireEvent.click(await screen.findByTestId('socio-delete-confirm'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', 'No se pudo dar de baja el socio')
      expect(screen.getByTestId('socio-delete-error')).toBeInTheDocument()
    })
    // Modal stays open so the operator can retry or cancel.
    expect(screen.getByTestId('socio-delete-modal')).toBeInTheDocument()
    // No navigation on error.
    expect(pushMock).not.toHaveBeenCalledWith('/socios')
  })

  it('fires notify("success", "Socio reactivado") on reactivate success', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    getSocioMock.mockResolvedValue({ ...SAMPLE_SOCIO, estado: 'baja' })
    updateSocioMock.mockResolvedValueOnce({ ...SAMPLE_SOCIO, estado: 'activo' })
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-reactivate'))
    fireEvent.click(screen.getByTestId('socio-detail-reactivate'))
    fireEvent.click(await screen.findByTestId('socio-reactivate-confirm'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Socio reactivado')
    })
  })

  it('fires notify("error", "No se pudo reactivar el socio") on reactivate failure', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    getSocioMock.mockResolvedValue({ ...SAMPLE_SOCIO, estado: 'baja' })
    updateSocioMock.mockRejectedValueOnce(new Error('CONFLICT: already active'))
    renderPage()

    await waitFor(() => screen.getByTestId('socio-detail-reactivate'))
    fireEvent.click(screen.getByTestId('socio-detail-reactivate'))
    fireEvent.click(await screen.findByTestId('socio-reactivate-confirm'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', 'No se pudo reactivar el socio')
    })
  })

  /* ── PR 8d.2: Emitir Solicitud button (frontend) ──────────────
     The "Emitir Solicitud" button (PR 8d.2, task B.3) lives in
     the page header NEXT to the existing admin group, visible to
     ANY authenticated operator (not gated by `isAdmin` per the
     ui-design delta R7). It opens the server-rendered PDF in a
     new tab via the `<EmitirSolicitudButton>` component, which
     is the unit-tested surface in
     `components/socios/EmitirSolicitudButton.test.tsx`. Here we
     only pin the page-level wiring: rendered-in-header +
     visible-to-non-admins + disabled when the socio has no
     `direccion` (per the UI design delta gating). */

  it('renders the Emitir Solicitud button in the header next to the admin actions', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-emitir-solicitud')).toBeInTheDocument()
    })
  })

  it('shows the Emitir Solicitud button to non-ADMIN operators too', async () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-emitir-solicitud')).toBeInTheDocument()
    })
    // The ADMIN-gated edit/delete buttons stay hidden for a plain
    // operator; the Emitir button must NOT be gated by `isAdmin`
    // (per the ui-design delta R7).
    expect(screen.queryByTestId('socio-detail-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('socio-detail-delete')).not.toBeInTheDocument()
  })

  it('passes disabled=true to Emitir Solicitud when socio.direccion is empty', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    getSocioMock.mockResolvedValueOnce({ ...SAMPLE_SOCIO, direccion: '' })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socio-detail-emitir-solicitud')).toBeDisabled()
    })
  })
})
