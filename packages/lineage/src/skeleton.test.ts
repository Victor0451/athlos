import { describe, it, expect } from 'vitest'

/**
 * TASK-062: packages/lineage package skeleton
 *
 * RED phase: verify the package skeleton exists and the barrel
 * exports queryLineage + verifyHash.
 *
 * NOTE: process.cwd() is packages/lineage when running via pnpm --filter.
 */

describe('packages/lineage', () => {
  it('package.json exists and has correct name + type', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    // process.cwd() is packages/lineage
    const pkgPath = path.join(process.cwd(), 'package.json')
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    expect(pkg.name).toBe('@athlos/lineage')
    expect(pkg.type).toBe('module')
  })

  it('vitest.config.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    // process.cwd() is packages/lineage
    const cfgPath = path.join(process.cwd(), 'vitest.config.ts')
    await expect(fs.access(cfgPath)).resolves.not.toThrow()
  })

  it('src/index.ts barrel exports queryLineage and verifyHash', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    // process.cwd() is packages/lineage
    const indexPath = path.join(process.cwd(), 'src/index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('queryLineage')
    expect(content).toContain('verifyHash')
  })

  it('src/query.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const queryPath = path.join(process.cwd(), 'src/query.ts')
    await expect(fs.access(queryPath)).resolves.not.toThrow()
  })

  it('src/verify.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const verifyPath = path.join(process.cwd(), 'src/verify.ts')
    await expect(fs.access(verifyPath)).resolves.not.toThrow()
  })
})
