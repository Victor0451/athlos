import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

/**
 * Local filesystem storage for `socio_attachments`.
 *
 * Contract (PR 8c.1, design §3 + spec §"Content-Addressed Storage
 * Layout With Atomic Rename"):
 *   - `saveStream(stream, { storagePath })` writes to
 *     `<baseDir>/.tmp/<uuid>.part`, then atomic-renames to the final
 *     `<baseDir>/<storagePath>`.
 *   - SHA-256 is computed inline over 64 KB chunks; peak in-memory
 *     footprint stays below 64 KB per spec.
 *   - `readStream(storagePath)` returns a Node `Readable` for the
 *     final file; the route layer attaches Content-Type / Disposition.
 *   - `unlink(storagePath)` removes a file (idempotent).
 *
 * The class is identifier-agnostic — `storagePath` is an arbitrary
 * string chosen by the caller. PR 8c.1 uses
 * `socios/<socioId>/<attachmentId>.<ext>` per row (per design).
 *
 * Env vars (read by the route layer, NOT here — keep this class pure):
 *   - `UPLOADS_DIR`        — default `/app/storage`
 *   - `MAX_FILE_SIZE_BYTES` — default `10485760`
 */

export interface SaveStreamOptions {
  /** Server-controlled relative path, e.g. `socios/<id>/<aid>.pdf`. */
  storagePath: string
  /** Declared MIME — kept on the result for logging; not used here. */
  mimeType: string
}

export interface SaveStreamResult {
  storagePath: string
  sha256: string
  sizeBytes: number
}

/**
 * Thrown when a stream exceeds the configured `maxBytes` cap.
 *
 * Surfaced as a typed error so the route layer can map it to
 * `413 PAYLOAD_TOO_LARGE` (per `api-design` delta).
 */
export class SizeLimitError extends Error {
  public override readonly name = 'SizeLimitError'
  public readonly limit: number
  public readonly observed: number
  constructor(limit: number, observed: number) {
    super(`Stream exceeded ${limit}-byte cap (observed ${observed})`)
    this.limit = limit
    this.observed = observed
  }
}

export interface LocalFileStorageOptions {
  baseDir: string
  maxBytes: number
}

/**
 * Read the env vars that govern `LocalFileStorage`. Centralised so
 * tests + prod use the same defaults.
 */
export function readStorageEnv(env: NodeJS.ProcessEnv = process.env): {
  baseDir: string
  maxBytes: number
} {
  const baseDir = env['UPLOADS_DIR'] ?? '/app/storage'
  const rawMax = env['MAX_FILE_SIZE_BYTES']
  const maxBytes = rawMax ? Number.parseInt(rawMax, 10) : 10 * 1024 * 1024
  return { baseDir, maxBytes: Number.isFinite(maxBytes) ? maxBytes : 10 * 1024 * 1024 }
}

export class LocalFileStorage {
  private readonly baseDir: string
  private readonly maxBytes: number

  constructor(opts: LocalFileStorageOptions) {
    this.baseDir = resolve(opts.baseDir)
    this.maxBytes = opts.maxBytes
  }

  /**
   * Stream `stream` to `<baseDir>/<storagePath>` via atomic rename.
   * Computes SHA-256 incrementally; throws `SizeLimitError` if the
   * stream exceeds `maxBytes`.
   */
  async saveStream(stream: Readable, opts: SaveStreamOptions): Promise<SaveStreamResult> {
    assertSafeStoragePath(opts.storagePath)

    const finalAbs = join(this.baseDir, opts.storagePath)
    const tmpName = `${randomUUID()}.part`
    const tmpAbs = join(this.baseDir, '.tmp', tmpName)

    await mkdir(dirname(tmpAbs), { recursive: true })
    await mkdir(dirname(finalAbs), { recursive: true })

    const hasher = createHash('sha256')
    let sizeBytes = 0
    const limit = this.maxBytes

    /**
     * Pass-through Transform: every chunk gets hashed + counted.
     * If the running total crosses `limit`, the Transform destroys
     * the pipeline with a SizeLimitError — pipeline propagates it
     * and the `catch` below cleans up the partial file.
     */
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb): void {
        sizeBytes += chunk.length
        if (sizeBytes > limit) {
          cb(new SizeLimitError(limit, sizeBytes))
          return
        }
        hasher.update(chunk)
        cb(null, chunk)
      },
    })

    try {
      await pipeline(stream, counter, createWriteStream(tmpAbs))
    } catch (err) {
      await rm(tmpAbs, { force: true })
      throw err
    }

    await rename(tmpAbs, finalAbs)

    // Tidy up the .tmp directory so a long-running server does not
    // accumulate empty parent directories. Best-effort: a failure here
    // does not block the upload — the next saveStream recreates the
    // dir on demand.
    await rm(dirname(tmpAbs), { recursive: true, force: true })

    return {
      storagePath: opts.storagePath,
      sha256: hasher.digest('hex'),
      sizeBytes,
    }
  }

  /**
   * Open a read stream for the previously-stored file. The caller is
   * responsible for setting Content-Type / Content-Disposition.
   */
  readStream(storagePath: string): ReadStream {
    assertSafeStoragePath(storagePath)
    return createReadStream(join(this.baseDir, storagePath))
  }

  /**
   * Remove the file. Idempotent — missing files resolve silently so
   * the rollback path (magic-byte rejection → delete file → delete
   * row) does not crash on a no-op.
   */
  async unlink(storagePath: string): Promise<void> {
    assertSafeStoragePath(storagePath)
    const abs = join(this.baseDir, storagePath)
    try {
      await stat(abs)
    } catch {
      return // already gone — no-op
    }
    await rm(abs, { force: true })
  }

  /** Test/diagnostics: the resolved absolute base dir. */
  getBaseDir(): string {
    return this.baseDir
  }
}

/**
 * Reject path-traversal attempts. `storagePath` must be a relative
 * path whose resolved form stays inside `<baseDir>`.
 */
function assertSafeStoragePath(storagePath: string): void {
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new Error('storagePath must be a non-empty string')
  }
  if (storagePath.includes('..')) {
    throw new Error(`storagePath must not contain '..': ${storagePath}`)
  }
  if (storagePath.includes('\\') || storagePath.startsWith('/')) {
    throw new Error(`storagePath must be a relative POSIX path: ${storagePath}`)
  }
  const resolved = resolve(storagePath)
  if (resolved.split(sep).includes('..')) {
    throw new Error(`storagePath escapes base dir: ${storagePath}`)
  }
}
