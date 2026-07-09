import { createHash } from 'node:crypto'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { Db } from '@athlos/db'
import { emitAudit } from '@athlos/audit'
import { findById } from '../repository.ts'
import { getMovementsForComprobante } from './ctacte-mutations.ts'
import type { PdfGenerator } from './pdf-generator.ts'
import {
  buildComprobanteFilename,
  buildComprobanteHtml,
  type ComprobanteMovementLite,
} from './ctacte-comprobante.template.ts'

/**
 * `ctacte-comprobante` glue (PR A1b.2 — athlos-ctacte-mutations).
 *
 * Sits between the route handler (`routes/ctacte-mutations.ts`) and the
 * template + service. Responsibilities:
 *
 *   1. Fetch the movimientos via `getMovementsForComprobante()` (cap-50
 *      enforced inside the service).
 *   2. Load the socio via `findById()` (404 path).
 *   3. Render the comprobante HTML via `buildComprobanteHtml()` from
 *      the sibling `ctacte-comprobante.template.ts` file.
 *   4. Render to PDF via the singleton `pdfGenerator.generate()`.
 *   5. Compute SHA-256 of the PDF bytes (no double-read).
 *   6. Emit `CTACTE_COMPROBANTE_PRINTED` audit (best-effort) with the
 *      7-key metadata shape pinned by the audit-logger spec delta.
 *   7. Return `{ pdf, filename, sha256, byteSize, movementCount }`.
 *
 * The `pdfGenerator` is injected so the route layer (and tests) can
 * share the singleton across requests.
 *
 * Best-effort audit emission matches the `emit-form.ts` precedent —
 * a failure here does NOT roll back the 200 + PDF response.
 */

export interface RenderComprobanteParams {
  socioId: string
  cuenta: string
  operatorId: string
  from: string
  to: string
  db: Db
  pdfGenerator: PdfGenerator
  /** Override the clock for tests. */
  now?: () => Date
}

export interface RenderComprobanteResult {
  pdf: Buffer
  filename: string
  sha256: string
  byteSize: number
  movementCount: number
}

export async function renderComprobante(
  params: RenderComprobanteParams,
): Promise<RenderComprobanteResult> {
  const socio = await findById(params.db, params.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }

  const movements = await getMovementsForComprobante({
    db: params.db,
    socioId: params.socioId,
    cuenta: params.cuenta,
    from: params.from,
    to: params.to,
  })

  const liteMovements: ComprobanteMovementLite[] = movements.map((m) => ({
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    monto: m.monto,
    concepto: m.concepto,
    motivo: m.motivo,
    saldo: m.saldo,
  }))

  const html = buildComprobanteHtml(
    liteMovements,
    {
      numeroSocio: socio.numeroSocio,
      apellido: socio.apellido,
      nombre: socio.nombre,
      dni: socio.dni,
    },
    {
      from: params.from,
      to: params.to,
      generatedAt: formatFechaEmision((params.now ?? defaultNow)()),
    },
  )

  const pdf = await params.pdfGenerator.generate(html)
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  const byteSize = pdf.byteLength

  const filename = buildComprobanteFilename({
    numeroSocio: socio.numeroSocio,
    from: params.from,
    to: params.to,
  })

  await emitComprobantePrintedAudit(params.db, {
    operatorId: params.operatorId,
    socioId: socio.id,
    from: params.from,
    to: params.to,
    movementCount: movements.length,
    sha256,
    byteSize,
  })

  return { pdf, filename, sha256, byteSize, movementCount: movements.length }
}

function formatFechaEmision(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getUTCFullYear())
  return `${dd}/${mm}/${yyyy}`
}

function defaultNow(): Date {
  return new Date()
}

/**
 * Best-effort audit emission with the 7-key metadata shape pinned by
 * the audit-logger spec delta:
 *   - socio_id          (the operator-facing socio UUID)
 *   - ctacte_id         (same UUID as socio_id for v1 — ctacte is
 *                        sibling-to-socio, not a separate parent)
 *   - from / to         (date range)
 *   - movement_count    (size of the date slice at the time of print)
 *   - sha256 / byte_size
 *
 * A failed emission becomes a `console.error` — the rendered PDF is
 * already in the caller's hands.
 */
async function emitComprobantePrintedAudit(
  db: Db,
  data: {
    operatorId: string
    socioId: string
    from: string
    to: string
    movementCount: number
    sha256: string
    byteSize: number
  },
): Promise<void> {
  try {
    await emitAudit(db, {
      operatorId: data.operatorId,
      action: 'CTACTE_COMPROBANTE_PRINTED',
      entityType: 'ctacte_comprobante',
      entityId: data.socioId,
      oldValue: null,
      newValue: null,
      sourceIp: null,
      payload: { id: data.socioId, sha256: data.sha256, byteSize: data.byteSize },
      metadata: {
        socio_id: data.socioId,
        ctacte_id: data.socioId,
        from: data.from,
        to: data.to,
        movement_count: data.movementCount,
        sha256: data.sha256,
        byte_size: data.byteSize,
      },
    })
  } catch (err) {
    console.error('[ctacte-comprobante] failed to emit CTACTE_COMPROBANTE_PRINTED', err)
  }
}
