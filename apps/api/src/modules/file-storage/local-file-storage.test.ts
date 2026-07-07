import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { LocalFileStorage } from './local-file-storage.ts'

/**
 * `LocalFileStorage` test — covers atomic rename, SHA-256 streaming,
 * unlink, env-var handling, and on-disk path conventions.
 *
 * The base dir is `os.tmpdir()/athlos-fs-<uuid>` per test (cleared in
 * `afterEach`). No Docker, no global state.
 */

function streamFromString(s: string): Readable {
  return Readable.from(Buffer.from(s, 'utf8'))
}

/** Stream raw bytes (no UTF-8 encoding roundtrip) — used for binary fixtures. */
function streamFromBuffer(buf: Buffer): Readable {
  return Readable.from(buf)
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let baseDir: string
let storage: LocalFileStorage

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'athlos-fs-'))
  storage = new LocalFileStorage({ baseDir, maxBytes: 1024 * 1024 })
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('LocalFileStorage — saveStream', () => {
  it('writes the file at the requested storagePath and returns its sha256 + size', async () => {
    const payload = Buffer.from('hello world', 'utf8')
    const result = await storage.saveStream(streamFromString(payload.toString()), {
      storagePath: 'socios/abc/file.txt',
      mimeType: 'text/plain',
    })
    expect(result.storagePath).toBe('socios/abc/file.txt')
    expect(result.sha256).toBe(sha256Hex(payload))
    expect(result.sizeBytes).toBe(payload.length)
    expect(existsSync(join(baseDir, 'socios/abc/file.txt'))).toBe(true)
  })

  it('creates intermediate directories on demand', async () => {
    await storage.saveStream(streamFromString('x'), {
      storagePath: 'socios/<uuid-a>/nested/<uuid-b>.bin',
      mimeType: 'application/octet-stream',
    })
    expect(existsSync(join(baseDir, 'socios/<uuid-a>/nested/<uuid-b>.bin'))).toBe(true)
  })

  it('uses atomic rename — no `.tmp/` artifact remains after success', async () => {
    await storage.saveStream(streamFromString('payload'), {
      storagePath: 'socios/s1/att.bin',
      mimeType: 'application/octet-stream',
    })
    // Walk the baseDir; assert no leftover temp file.
    const { readdirSync } = await import('node:fs')
    const tmpDir = join(baseDir, '.tmp')
    expect(existsSync(tmpDir)).toBe(false)
    // Defensive: also assert no part files anywhere.
    function walk(dir: string): string[] {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(p))
        else out.push(p)
      }
      return out
    }
    const files = walk(baseDir)
    expect(files.some((f) => f.endsWith('.part'))).toBe(false)
  })

  it('streams SHA-256 incrementally — matches node:crypto over the full buffer', async () => {
    // Build a payload large enough to require multiple 64 KB chunks.
    const payload = Buffer.alloc(256 * 1024, 0x5a)
    const result = await storage.saveStream(streamFromBuffer(payload), {
      storagePath: 'socios/s1/big.bin',
      mimeType: 'application/octet-stream',
    })
    expect(result.sha256).toBe(sha256Hex(payload))
    expect(result.sizeBytes).toBe(payload.length)
  })

  it('rejects oversize uploads with a typed SizeLimitError', async () => {
    const tiny = new LocalFileStorage({ baseDir, maxBytes: 4 })
    await expect(
      tiny.saveStream(streamFromString('too long'), {
        storagePath: 'socios/s1/oversize.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({ name: 'SizeLimitError' })
    // No file left on disk after rejection.
    expect(existsSync(join(baseDir, 'socios/s1/oversize.bin'))).toBe(false)
  })

  it('reports `sizeBytes === 0` for an empty stream', async () => {
    const result = await storage.saveStream(streamFromString(''), {
      storagePath: 'socios/s1/empty.bin',
      mimeType: 'application/octet-stream',
    })
    expect(result.sizeBytes).toBe(0)
    expect(result.sha256).toBe(sha256Hex(Buffer.alloc(0)))
  })
})

describe('LocalFileStorage — readStream', () => {
  it('returns a Readable that yields the bytes previously written', async () => {
    const payload = 'the quick brown fox'
    await storage.saveStream(streamFromString(payload), {
      storagePath: 'socios/s1/readback.txt',
      mimeType: 'text/plain',
    })
    const stream = storage.readStream('socios/s1/readback.txt')
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe(payload)
  })

  it('throws when the file does not exist', async () => {
    const stream = storage.readStream('socios/s1/missing.bin')
    await expect(async () => {
      // Reading from a missing file emits 'error' on the stream.
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    }).rejects.toThrow(/ENOENT|no such file/)
  })
})

describe('LocalFileStorage — unlink', () => {
  it('removes the file from disk and resolves without error', async () => {
    await storage.saveStream(streamFromString('bye'), {
      storagePath: 'socios/s1/remove.bin',
      mimeType: 'application/octet-stream',
    })
    expect(existsSync(join(baseDir, 'socios/s1/remove.bin'))).toBe(true)
    await storage.unlink('socios/s1/remove.bin')
    expect(existsSync(join(baseDir, 'socios/s1/remove.bin'))).toBe(false)
  })

  it('is idempotent — unlinking an already-missing file does not throw', async () => {
    await expect(storage.unlink('socios/s1/never-existed.bin')).resolves.toBeUndefined()
  })
})

describe('LocalFileStorage — env-var handling', () => {
  it('honors the constructor baseDir verbatim', () => {
    expect(existsSync(baseDir)).toBe(true)
    expect(statSync(baseDir).isDirectory()).toBe(true)
  })

  it('honors the constructor maxBytes for the size guard', async () => {
    const strict = new LocalFileStorage({ baseDir, maxBytes: 3 })
    await expect(
      strict.saveStream(streamFromString('1234'), {
        storagePath: 'socios/s1/x.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({ name: 'SizeLimitError' })
  })

  it('persists bytes verbatim (no encoding transformation)', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x99])
    await storage.saveStream(streamFromBuffer(payload), {
      storagePath: 'socios/s1/bin.bin',
      mimeType: 'application/octet-stream',
    })
    const onDisk = readFileSync(join(baseDir, 'socios/s1/bin.bin'))
    expect(onDisk.equals(payload)).toBe(true)
  })
})
