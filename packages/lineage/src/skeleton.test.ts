import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * TASK-062: packages/lineage package skeleton
 *
 * RED phase: verify the package skeleton exists and the barrel
 * exports queryLineage + verifyHash.
 *
 * Path resolution uses import.meta.url (ESM-safe) so the tests work
 * regardless of where vitest is invoked from (monorepo root vs. package dir).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.join(__dirname, '..')

describe('packages/lineage', () => {
  it('package.json exists and has correct name + type', async () => {
    const fs = await import('node:fs/promises')
    const pkgPath = path.join(PACKAGE_ROOT, 'package.json')
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    expect(pkg.name).toBe('@athlos/lineage')
    expect(pkg.type).toBe('module')
  })

  it('vitest.config.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const cfgPath = path.join(PACKAGE_ROOT, 'vitest.config.ts')
    await expect(fs.access(cfgPath)).resolves.not.toThrow()
  })

  it('src/index.ts barrel exports queryLineage and verifyHash', async () => {
    const fs = await import('node:fs/promises')
    const indexPath = path.join(PACKAGE_ROOT, 'src/index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('queryLineage')
    expect(content).toContain('verifyHash')
  })

  it('src/query.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const queryPath = path.join(PACKAGE_ROOT, 'src/query.ts')
    await expect(fs.access(queryPath)).resolves.not.toThrow()
  })

  it('src/verify.ts exists', async () => {
    const fs = await import('node:fs/promises')
    const verifyPath = path.join(PACKAGE_ROOT, 'src/verify.ts')
    await expect(fs.access(verifyPath)).resolves.not.toThrow()
  })
})
