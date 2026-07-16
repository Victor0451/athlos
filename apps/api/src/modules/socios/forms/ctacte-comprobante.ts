import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
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
  idempotencyKey?: string
  db: Db
  pdfGenerator: PdfGenerator
  /** Override the clock for tests. */
  now?: () => Date
  /** Test seam for deterministic replica and restart coverage. */
  leaseStore?: ComprobanteLeaseStore
  leaseDurationMs?: number
  heartbeatMs?: number
}

export interface RenderComprobanteResult {
  pdf: Buffer
  filename: string
  sha256: string
  byteSize: number
  movementCount: number
}

type LeaseClaim =
  | { kind: 'owner' }
  | { kind: 'follower' }
  | { kind: 'complete'; result: RenderComprobanteResult }

/** The durable state-machine boundary. Production uses PostgreSQL; tests share an equivalent store. */
export interface ComprobanteLeaseStore {
  claim(
    key: string,
    fingerprint: string,
    owner: string,
    now: number,
    leaseMs: number,
    retentionMs: number,
  ): Promise<LeaseClaim | { kind: 'conflict' }>
  heartbeat(key: string, owner: string, now: number, leaseMs: number): Promise<boolean>
  complete(key: string, owner: string, result: RenderComprobanteResult): Promise<boolean>
  fail(key: string, owner: string): Promise<boolean>
}

export async function renderComprobante(
  params: RenderComprobanteParams,
): Promise<RenderComprobanteResult> {
  if (!params.idempotencyKey)
    throw BusinessError(
      ErrorCode.VALIDATION_ERROR,
      'Idempotency-Key header must be 1–128 characters',
    )
  const retryKey = params.idempotencyKey
  const fingerprint = comprobanteRequestFingerprint(params)
  const store = params.leaseStore ?? createPostgresComprobanteLeaseStore(params.db)
  const owner = randomUUID()
  const leaseDurationMs = params.leaseDurationMs ?? 5_000
  const heartbeatMs = params.heartbeatMs ?? Math.max(100, Math.floor(leaseDurationMs / 3))
  const retentionMs = 24 * 60 * 60 * 1000
  const now = params.now ?? defaultNow

  for (let attempt = 0; ; attempt += 1) {
    const claim = await store.claim(
      retryKey,
      fingerprint,
      owner,
      now().valueOf(),
      leaseDurationMs,
      retentionMs,
    )
    if (claim.kind === 'conflict')
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency-Key was already used for a different comprobante request',
      )
    if (claim.kind === 'complete') return claim.result
    if (claim.kind === 'follower') {
      await delay(Math.min(250, 15 + attempt * 10))
      continue
    }

    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      heartbeat = setInterval(() => {
        void store.heartbeat(retryKey, owner, now().valueOf(), leaseDurationMs)
      }, heartbeatMs)
      return await generateOwnedComprobante(params, retryKey, owner, store)
    } catch (error) {
      await store.fail(retryKey, owner)
      throw error
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }
  }
}

async function generateOwnedComprobante(
  params: RenderComprobanteParams,
  retryKey: string,
  owner: string,
  store: ComprobanteLeaseStore,
): Promise<RenderComprobanteResult> {
  const socio = await findById(params.db, params.socioId)
  if (!socio) throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')

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

  const result = { pdf, filename, sha256, byteSize, movementCount: movements.length }
  if (!(await store.complete(retryKey, owner, result))) {
    throw new Error('Comprobante lease ownership was lost before completion')
  }

  await emitComprobantePrintedAudit(params.db, {
    operatorId: params.operatorId,
    socioId: socio.id,
    from: params.from,
    to: params.to,
    movementCount: movements.length,
    sha256,
    byteSize,
  })

  return result
}

export function createPostgresComprobanteLeaseStore(db: Db): ComprobanteLeaseStore {
  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => {
    const result = await db.execute(query)
    return (Array.isArray(result) ? result : result.rows) as unknown as T[]
  }
  return {
    async claim(key, fingerprint, owner, now, leaseMs, retentionMs) {
      const leaseExpiresAt = new Date(now + leaseMs)
      const expiresAt = new Date(now + retentionMs)
      await rows(sql`DELETE FROM tesoreria.ctacte_comprobante_retries
        WHERE idempotency_key = ${key} AND status = 'complete' AND expires_at <= ${new Date(now)}`)
      const inserted = await rows<{ idempotency_key: string }>(sql`
        INSERT INTO tesoreria.ctacte_comprobante_retries
          (idempotency_key, request_fingerprint, status, lease_owner, lease_expires_at, attempt_count, expires_at, updated_at)
        VALUES (${key}, ${fingerprint}, 'rendering', ${owner}, ${leaseExpiresAt}, 1, ${expiresAt}, now())
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`)
      if (inserted.length) return { kind: 'owner' }
      const reclaimed = await rows<{ idempotency_key: string }>(sql`
        UPDATE tesoreria.ctacte_comprobante_retries
        SET status = 'rendering', lease_owner = ${owner}, lease_expires_at = ${leaseExpiresAt},
            attempt_count = attempt_count + 1, updated_at = now()
        WHERE idempotency_key = ${key}
          AND request_fingerprint = ${fingerprint}
          AND (status = 'failed' OR (status = 'rendering' AND lease_expires_at <= ${new Date(now)}))
        RETURNING idempotency_key`)
      if (reclaimed.length) return { kind: 'owner' }
      const [existing] = await rows<{
        status: string
        request_fingerprint: string
        pdf_base64: string | null
        sha256: string | null
        byte_size: number | null
        filename: string | null
        movement_count: number | null
      }>(sql`
        SELECT status, request_fingerprint, pdf_base64, sha256, byte_size, filename, movement_count
        FROM tesoreria.ctacte_comprobante_retries WHERE idempotency_key = ${key}`)
      if (existing && existing.request_fingerprint !== fingerprint) return { kind: 'conflict' }
      if (
        existing?.status === 'complete' &&
        existing.pdf_base64 &&
        existing.sha256 &&
        existing.byte_size != null &&
        existing.filename
      ) {
        return {
          kind: 'complete',
          result: {
            pdf: Buffer.from(existing.pdf_base64, 'base64'),
            filename: existing.filename,
            sha256: existing.sha256,
            byteSize: existing.byte_size,
            movementCount: existing.movement_count ?? 0,
          },
        }
      }
      return { kind: 'follower' }
    },
    async heartbeat(key, owner, now, leaseMs) {
      const updated = await rows<{ idempotency_key: string }>(sql`
        UPDATE tesoreria.ctacte_comprobante_retries
        SET lease_expires_at = ${new Date(now + leaseMs)}, updated_at = now()
        WHERE idempotency_key = ${key} AND status = 'rendering' AND lease_owner = ${owner}
        RETURNING idempotency_key`)
      return updated.length === 1
    },
    async complete(key, owner, result) {
      const updated = await rows<{ idempotency_key: string }>(sql`
        UPDATE tesoreria.ctacte_comprobante_retries
        SET status = 'complete', pdf_base64 = ${result.pdf.toString('base64')}, sha256 = ${result.sha256},
            byte_size = ${result.byteSize}, filename = ${result.filename}, movement_count = ${result.movementCount},
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE idempotency_key = ${key} AND status = 'rendering' AND lease_owner = ${owner}
        RETURNING idempotency_key`)
      return updated.length === 1
    },
    async fail(key, owner) {
      const updated = await rows<{ idempotency_key: string }>(sql`
        UPDATE tesoreria.ctacte_comprobante_retries
        SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE idempotency_key = ${key} AND status = 'rendering' AND lease_owner = ${owner}
        RETURNING idempotency_key`)
      return updated.length === 1
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function comprobanteRequestFingerprint(params: RenderComprobanteParams): string {
  return createHash('sha256')
    .update(
      `comprobante|${params.operatorId}|${params.socioId}|${params.cuenta}|${params.from}|${params.to}`,
    )
    .digest('hex')
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
