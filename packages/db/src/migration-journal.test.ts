import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const drizzleDir = fileURLToPath(new URL('../drizzle/', import.meta.url))

describe('Drizzle migration journal', () => {
  it('registers every migration file once in numeric order', async () => {
    const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    const files = (await readdir(drizzleDir))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .map((file) => file.slice(0, -4))
      .sort()

    expect(journal.entries.map((entry) => entry.tag)).toEqual(files)
    expect(journal.entries.map((entry) => entry.idx)).toEqual(files.map((_, index) => index))
    expect(journal.entries.at(-1)?.tag).toBe('0061_dues_cash_settlement_reversal_expense')
    expect(
      journal.entries.findIndex((entry) => entry.tag === '0036_padrones_inscription_lifecycle'),
    ).toBeLessThan(
      journal.entries.findIndex(
        (entry) => entry.tag === '0059_collections_inscription_compatibility',
      ),
    )
  })
})
