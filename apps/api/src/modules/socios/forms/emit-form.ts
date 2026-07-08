import { createHash } from 'node:crypto'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { Db } from '@athlos/db'
import type { Socio } from '@athlos/db/schema'
import { emitAudit, AuditAction } from '@athlos/audit'
import { findById as findSocioById } from './../repository.ts'
import { buildFilename } from './filename.ts'
import {
  SOLICITUD_INSCRIPCION_DEFAULTS,
  SOLICITUD_INSCRIPCION_TEMPLATE,
  buildSolicitudVariables,
} from './solicitud-inscripcion.template.ts'
import { renderTemplate } from './template-renderer.ts'
import type { PdfGenerator } from './pdf-generator.ts'

/**
 * `emitForm` — orchestrates the full `solicitud-inscripcion` PDF flow:
 *
 *   1. Load socio via repository (with `fechaNacimiento`).
 *   2. Build the sanitized filename.
 *   3. Render the template (HTML-escaped) with the socio data.
 *   4. Generate the PDF via the singleton puppeteer wrapper.
 *   5. Compute SHA-256 of the PDF bytes (in the same pass — no
 *      double-read of the buffer).
 *   6. Emit `SOCIO_FORM_EMITTED` audit with exact 4-key metadata.
 *   7. Return `{ pdf, filename, sha256, byteSize }`.
 *
 * Audit emission is **best-effort**: a failure here is `console.error`'d
 * and swallowed so the PDF response still returns 200. The audit-events
 * table is append-only and a missed row is recoverable from the
 * operator's session log; the opposite (a 500 on a successful emission)
 * is the worse outcome.
 *
 * The `pdfGenerator` is injected so the route layer (and tests) can
 * share the singleton across requests. Production wires the singleton
 * once at `buildServer()` time.
 */

export interface EmitFormParams {
  socioId: string
  operatorId: string
  db: Db
  pdfGenerator: PdfGenerator
  /** Override the clock for tests; defaults to `new Date()`. */
  now?: () => Date
}

export interface EmitFormResult {
  pdf: Buffer
  filename: string
  sha256: string
  byteSize: number
}

export async function emitForm(params: EmitFormParams): Promise<EmitFormResult> {
  const socio = await findSocioById(params.db, params.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  const filename = buildFilename({
    numeroSocio: socio.numeroSocio,
    apellido: socio.apellido,
  })
  const html = renderTemplate(
    SOLICITUD_INSCRIPCION_TEMPLATE,
    buildSolicitudVariables({
      ...SOLICITUD_INSCRIPCION_DEFAULTS,
      titularNombre: `${socio.apellido}, ${socio.nombre}`,
      dni: socio.dni,
      fechaNacimiento: formatFechaNacimiento(socio.fechaNacimiento),
      numeroSocio: socio.numeroSocio,
      domicilioCalle: socio.direccion ?? '',
      domicilioTelefono: socio.telefono ?? '',
      email: socio.email ?? '',
      fechaEmision: formatFechaEmision((params.now ?? defaultNow)()),
    }),
  )
  const pdf = await params.pdfGenerator.generate(html)
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  const byteSize = pdf.byteLength

  await emitAuditBestEffort(params.db, {
    operatorId: params.operatorId,
    socioId: socio.id,
    sha256,
    byteSize,
  })

  return { pdf, filename, sha256, byteSize }
}

/**
 * Convert a Drizzle date column (`string` YYYY-MM-DD or `null`) to the
 * DD/MM/YYYY shape the form's `{{fecha_nacimiento}}` placeholder
 * expects. Returns empty string when the column is null so the
 * template's `<span class="dotted-line">{{fecha_nacimiento}}</span>`
 * renders blank with the dotted underline visible.
 */
function formatFechaNacimiento(value: string | null): string {
  if (!value) return ''
  // value is YYYY-MM-DD per the Drizzle `date('fecha_nacimiento')` shape
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Format the server `today` as DD/MM/YYYY for the FESCAG block. */
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
 * Emit `SOCIO_FORM_EMITTED` with the exact 4-key metadata shape
 * pinned by the audit-logger spec delta. Best-effort: a throw is
 * logged + swallowed so the PDF response still returns 200.
 */
async function emitAuditBestEffort(
  db: Db,
  data: { operatorId: string; socioId: string; sha256: string; byteSize: number },
): Promise<unknown> {
  try {
    return await emitAudit(db, {
      operatorId: data.operatorId,
      action: AuditAction.SOCIO_FORM_EMITTED,
      entityType: 'socio',
      entityId: data.socioId,
      oldValue: null,
      newValue: null,
      sourceIp: null,
      payload: { socioId: data.socioId, sha256: data.sha256, byteSize: data.byteSize },
      metadata: {
        socio_id: data.socioId,
        form_id: 'solicitud-inscripcion',
        sha256: data.sha256,
        byte_size: data.byteSize,
      },
    })
  } catch (err) {
    // Surface for ops but do not propagate — the PDF is already in the
    // caller's hands and we MUST NOT roll back a successful emission.
    console.error('[emit-form] failed to emit SOCIO_FORM_EMITTED audit_event', err)
    return undefined
  }
}

/**
 * Re-export `Socio` for callers that need the loaded row shape. Avoids
 * forcing them to import from `@athlos/db/schema` directly.
 */
export type { Socio }
