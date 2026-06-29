import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable, type ColumnDef } from './DataTable'

/**
 * DataTable tests (TASK-019, PR 8b.1).
 *
 * Generic table primitive used by the Socios list and (later) the
 * Ctacte movements + Padrones surfaces. The contract:
 *   - Renders a `<thead>` row per column with the column header text
 *   - Renders one `<tbody>` row per item in `data`
 *   - Custom cell render functions (`accessor: (row) => ReactNode`)
 *     produce the cell content — not just `String(row[col.key])`
 *   - Empty state shows when `data.length === 0` and `loading` is
 *     false (default message: "Sin resultados…")
 *   - Loading state shows a skeleton (5 pulse rows) when `loading`
 *   - `pagination.onPageChange` fires with the next/prev page index
 *     when the pagination buttons are clicked
 *
 * Visual styling is deliberately not asserted on (per Strict TDD's
 * implementation-detail-coupling rule). The test ids are the bridge
 * between behavior and the rendered DOM.
 */

interface Row {
  id: string
  name: string
  age: number
}

const COLUMNS: ColumnDef<Row>[] = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Nombre' },
  {
    key: 'age',
    header: 'Edad',
    accessor: (row) => `${row.age} años`,
  },
]

const DATA: Row[] = [
  { id: '1', name: 'Ana', age: 30 },
  { id: '2', name: 'Beto', age: 42 },
  { id: '3', name: 'Carla', age: 27 },
]

describe('DataTable', () => {
  it('renders one header cell per column', () => {
    render(<DataTable<Row> columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Edad' })).toBeInTheDocument()
  })

  it('renders one row per data item', () => {
    render(<DataTable<Row> columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + DATA.length) // header + data rows
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Beto')).toBeInTheDocument()
    expect(screen.getByText('Carla')).toBeInTheDocument()
  })

  it('uses the column accessor to render cell content', () => {
    render(<DataTable<Row> columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />)
    expect(screen.getByText('30 años')).toBeInTheDocument()
    expect(screen.getByText('42 años')).toBeInTheDocument()
    expect(screen.getByText('27 años')).toBeInTheDocument()
  })

  it('renders the row key column accessor when no accessor is provided', () => {
    // The "ID" column has no accessor — falls back to String(row[col.key])
    render(<DataTable<Row> columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the empty state when data is empty and loading is false', () => {
    render(<DataTable<Row> columns={COLUMNS} data={[]} rowKey={(r) => r.id} />)
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton when loading is true (and hides the empty state)', () => {
    render(<DataTable<Row> columns={COLUMNS} data={[]} loading rowKey={(r) => r.id} />)
    // queryByText returns null (no throw) when the element is absent —
    // appropriate for negative assertions like `not.toBeInTheDocument()`.
    expect(screen.queryByText(/sin resultados/i)).not.toBeInTheDocument()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders pagination controls when pagination is provided', () => {
    render(
      <DataTable<Row>
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        pagination={{
          page: 1,
          limit: 20,
          total: 42,
          onPageChange: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /anterior/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument()
    // Page indicator: "Página 1 de 3"
    expect(screen.getByText(/1.*de.*3/)).toBeInTheDocument()
  })

  it('calls onPageChange with the next page index when "Siguiente" is clicked', () => {
    const onPageChange = vi.fn()
    render(
      <DataTable<Row>
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        pagination={{ page: 2, limit: 20, total: 60, onPageChange }}
      />,
    )
    screen.getByRole('button', { name: /siguiente/i }).click()
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('calls onPageChange with the previous page index when "Anterior" is clicked', () => {
    const onPageChange = vi.fn()
    render(
      <DataTable<Row>
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        pagination={{ page: 2, limit: 20, total: 60, onPageChange }}
      />,
    )
    screen.getByRole('button', { name: /anterior/i }).click()
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('disables "Anterior" on page 1 and "Siguiente" on the last page', () => {
    const { rerender } = render(
      <DataTable<Row>
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        pagination={{
          page: 1,
          limit: 20,
          total: 60,
          onPageChange: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeEnabled()

    // Total=60, limit=20, page=3 = last page
    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        pagination={{
          page: 3,
          limit: 20,
          total: 60,
          onPageChange: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /anterior/i })).toBeEnabled()
  })
})
