import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = import.meta.dirname
const routes = join(directory, '../../routes')
const specifier = './inscription-service.ts'
const importsCore = (value: string) => /(?:^|\/)inscription-service(?:\.ts)?$/.test(value)

describe('inscription service import boundary', () => {
  it('exports only core primitives and restricts consumers to the future facade', async () => {
    expect(Object.keys(await import(specifier)).sort()).toEqual(['applyCreate', 'applyTransition'])
    const consumers = readdirSync(directory)
      .filter((file) => file.endsWith('.ts') && file !== 'inscription-service.ts')
      .filter((file) => readFileSync(join(directory, file), 'utf8').includes(specifier))
      .sort()
    expect(consumers).toEqual([
      'inscription-command-service.ts',
      'inscription-lifecycle.postgres.integration.test.ts',
      'inscription-service.import-boundary.test.ts',
    ])
    const routeConsumers = readdirSync(routes, { recursive: true })
      .filter((file) => file.toString().endsWith('.ts'))
      .filter((file) =>
        [
          ...readFileSync(join(routes, file.toString()), 'utf8').matchAll(/from ['"]([^'"]+)/g),
        ].some((match) => importsCore(match[1]!)),
      )
    expect(routeConsumers).toEqual([])
    expect(importsCore('../modules/padrones/inscription-service.ts')).toBe(true)
    expect(importsCore('../modules/padrones/inscription-service')).toBe(true)
  })
})
