import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * AuditTab tests (PR 8b.4 + PR 8b.5 B.3).
 *
 * Pins the rendering of the timeline + the diff formatter. The
 * `getSocioAudit()` mock covers the three SOCIO_* cases and
 * verifies the field-level diff markup.
 *
 * PR 8b.5 B.3 adds the operator-name lookup wiring: when the
 * `getOperatorNames` mock returns known operators, the actor pill
 * renders `username · ROLE`; when it returns `[]`, every actor
 * pill renders `Operador desconocido`.
 */

const getSocioAuditMock = vi.fn()
const getOperatorNamesMock = vi.fn()

vi.mock('@/lib/api/socios', () => ({
  NOTE_MAX_LENGTH: 4000,
  getSocioAudit: (...args: unknown[]) => getSocioAuditMock(...args),
  listSocioNotes: vi.fn(),
  createSocioNote: vi.fn(),
  updateSocioNote: vi.fn(),
  deleteSocioNote: vi.fn(),
  getSocio: vi.fn(),
  createSocio: vi.fn(),
  updateSocio: vi.fn(),
  deleteSocio: vi.fn(),
  getSocios: vi.fn(),
  getSociosAggregate: vi.fn(),
}))

vi.mock('@/lib/api/operators', () => ({
  // The mock factory must stay SYNCHRONOUS (design R4). `OPERATORS_QUERY_KEY`
  // is re-declared here because the real module is replaced wholesale by
  // vi.mock — if the production implementation drifts (e.g. adds a hash),
  // update this stub AND the real export in lockstep.
  OPERATORS_QUERY_KEY: (sortedIds: readonly string[]) =>
    ['operators', sortedIds.join(',')] as const,
  getOperatorNames: (...args: unknown[]) => getOperatorNamesMock(...args),
}))

const { AuditTab } = await import('./AuditTab')

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AuditTab socioId={SOCIO_ID} />
    </QueryClientProvider>,
  )
}

describe('AuditTab', () => {
  it('renders the empty state when there are no events', async () => {
    getSocioAuditMock.mockResolvedValueOnce([])
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-tab-empty')).toBeInTheDocument()
    })
  })

  it('renders one row per event with action + actor + timestamp', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-1',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_CREATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: null,
        new_value: { numero_socio: '00001', nombre: 'Juan', apellido: 'García' },
        source_ip: null,
        created_at: '2026-07-04T12:00:00.000Z',
      },
      {
        id: 'a-2',
        operator_id: null,
        action: 'JOB_FAILED',
        entity_type: 'job',
        entity_id: 'job-1',
        old_value: null,
        new_value: { reason: 'timeout' },
        source_ip: null,
        created_at: '2026-07-04T12:30:00.000Z',
      },
    ])
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-a-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('audit-event-a-2')).toBeInTheDocument()
    expect(screen.getByTestId('audit-event-action-a-1')).toHaveTextContent('Socio creado')
    // null operator_id (system event) renders "Operador desconocido"
    // (OperatorChip fallback, design D7 case 1).
    expect(screen.getByTestId('audit-event-actor-a-2')).toHaveTextContent(/Operador desconocido/i)
  })

  it('renders a per-field diff for SOCIO_UPDATED events', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-3',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_UPDATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: {
          id: SOCIO_ID,
          numero_socio: '00001',
          nombre: 'Juan',
          apellido: 'García',
          dni: '12345678',
          telefono: '+5491155555555',
          created_at: '2026-07-04T12:00:00.000Z',
          updated_at: '2026-07-04T12:00:00.000Z',
        },
        new_value: {
          id: SOCIO_ID,
          numero_socio: '00001',
          nombre: 'Juan',
          apellido: 'García',
          dni: '12345678',
          telefono: '+5491100000000',
          created_at: '2026-07-04T12:00:00.000Z',
          updated_at: '2026-07-04T12:30:00.000Z',
        },
        source_ip: null,
        created_at: '2026-07-04T12:30:00.000Z',
      },
    ])
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-diff')).toBeInTheDocument()
    })
    // Only the changed field surfaces — `updated_at` is skipped
    // (infrastructure metadata, see FIELD_DIFF_SKIP in the impl).
    expect(screen.getByTestId('audit-diff-field-telefono')).toBeInTheDocument()
    expect(screen.getByTestId('audit-diff-before-telefono')).toHaveTextContent('+5491155555555')
    expect(screen.getByTestId('audit-diff-after-telefono')).toHaveTextContent('+5491100000000')
    expect(screen.queryByTestId('audit-diff-field-id')).not.toBeInTheDocument()
    expect(screen.queryByTestId('audit-diff-field-updated_at')).not.toBeInTheDocument()
  })

  it('renders the note body for SOCIO_NOTE_CREATED events', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-4',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_NOTE_CREATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: null,
        new_value: { body: 'Llamó a las 14hs para renovar la cuota' },
        source_ip: null,
        created_at: '2026-07-04T12:00:00.000Z',
      },
    ])
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-a-4')).toBeInTheDocument()
    })
    expect(screen.getByTestId('audit-note-body')).toHaveTextContent(/llamó a las 14hs/i)
  })

  it('renders before/after blocks for SOCIO_NOTE_UPDATED events', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-5',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_NOTE_UPDATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: { body: 'versión vieja' },
        new_value: { body: 'versión nueva' },
        source_ip: null,
        created_at: '2026-07-04T12:00:00.000Z',
      },
    ])
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-a-5')).toBeInTheDocument()
    })
    expect(screen.getByTestId('audit-note-before')).toHaveTextContent('versión vieja')
    expect(screen.getByTestId('audit-note-after')).toHaveTextContent('versión nueva')
  })

  /* ── PR 8b.5 B.3: operator-name lookup wiring ────────────────────── */

  it('renders "username · ROLE" for an actor whose id is in the operator lookup', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-6',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_CREATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: null,
        new_value: { numero_socio: '00001', nombre: 'Juan', apellido: 'García' },
        source_ip: null,
        created_at: '2026-07-04T12:00:00.000Z',
      },
    ])
    getOperatorNamesMock.mockResolvedValueOnce([
      { id: OPERATOR_ID, username: 'vlongo', role: 'ADMIN' as const },
    ])

    renderTab()
    // Wait for the second query (operators) to settle, not just the
    // event row — the chip text flips from "Operador desconocido"
    // (pending/empty map) to "vlongo · ADMIN" once the lookup resolves.
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-actor-a-6')).toHaveTextContent('vlongo · ADMIN')
    })
  })

  it('renders "Operador desconocido" when the operator id is not in the lookup', async () => {
    getSocioAuditMock.mockResolvedValueOnce([
      {
        id: 'a-7',
        operator_id: OPERATOR_ID,
        action: 'SOCIO_CREATED',
        entity_type: 'socio',
        entity_id: SOCIO_ID,
        old_value: null,
        new_value: { numero_socio: '00001', nombre: 'Juan', apellido: 'García' },
        source_ip: null,
        created_at: '2026-07-04T12:00:00.000Z',
      },
    ])
    // Empty lookup → OperatorChip case 2: id missing from map
    // → fallback. Also covers the empty-map-while-pending case.
    getOperatorNamesMock.mockResolvedValueOnce([])

    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-a-7')).toBeInTheDocument()
    })
    // The fallback is the chip's "missing" branch — let the second
    // query settle first, then assert.
    await waitFor(() => {
      expect(screen.getByTestId('audit-event-actor-a-7')).toHaveTextContent('Operador desconocido')
    })
  })
})
