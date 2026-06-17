import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * TASK-066: packages/projection package skeleton
 *
 * RED phase: verify the package skeleton exists and the barrel
 * exports rebuildProjection + computeSaldo + DOMAIN_PROJECTION_TABLE.
 *
 * Path resolution uses import.meta.url (ESM-safe) so the tests work
 * regardless of where vitest is invoked from (monorepo root vs. package dir).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

describe('packages/projection', () => {
  it('package.json exists and has correct name + type', async () => {
    const fs = await import('node:fs/promises')
    const pkgPath = path.join(PACKAGE_ROOT, 'package.json')
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    expect(pkg.name).toBe('@athlos/projection')
    expect(pkg.type).toBe('module')
  })

  it('vitest.config.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const cfgPath = path.join(PACKAGE_ROOT, 'vitest.config.ts')
    await expect(fs.access(cfgPath)).resolves.not.toThrow()
  })

  it('src/index.ts barrel exports rebuildProjection, computeSaldo, DOMAIN_PROJECTION_TABLE', async () => {
    const fs = await import('node:fs/promises')
    const indexPath = path.join(PACKAGE_ROOT, 'src/index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('rebuildProjection')
    expect(content).toContain('computeSaldo')
    expect(content).toContain('DOMAIN_PROJECTION_TABLE')
  })

  it('src/rebuild.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const rebuildPath = path.join(PACKAGE_ROOT, 'src/rebuild.ts')
    await expect(fs.access(rebuildPath)).resolves.not.toThrow()
  })

  it('src/saldo.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const saldoPath = path.join(PACKAGE_ROOT, 'src/saldo.ts')
    await expect(fs.access(saldoPath)).resolves.not.toThrow()
  })
})
