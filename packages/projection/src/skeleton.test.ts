import { describe, it, expect } from 'vitest'

/**
 * TASK-066: packages/projection package skeleton
 *
 * RED phase: verify the package skeleton exists and the barrel
 * exports rebuildProjection + computeSaldo + DOMAIN_PROJECTION_TABLE.
 */

describe('packages/projection', () => {
  it('package.json exists and has correct name + type', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const pkgPath = path.join(process.cwd(), 'package.json')
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    expect(pkg.name).toBe('@athlos/projection')
    expect(pkg.type).toBe('module')
  })

  it('vitest.config.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const cfgPath = path.join(process.cwd(), 'vitest.config.ts')
    await expect(fs.access(cfgPath)).resolves.not.toThrow()
  })

  it('src/index.ts barrel exports rebuildProjection, computeSaldo, DOMAIN_PROJECTION_TABLE', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const indexPath = path.join(process.cwd(), 'src/index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('rebuildProjection')
    expect(content).toContain('computeSaldo')
    expect(content).toContain('DOMAIN_PROJECTION_TABLE')
  })

  it('src/rebuild.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const rebuildPath = path.join(process.cwd(), 'src/rebuild.ts')
    await expect(fs.access(rebuildPath)).resolves.not.toThrow()
  })

  it('src/saldo.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const saldoPath = path.join(process.cwd(), 'src/saldo.ts')
    await expect(fs.access(saldoPath)).resolves.not.toThrow()
  })
})
