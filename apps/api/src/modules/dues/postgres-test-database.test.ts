import { expect, it, vi } from 'vitest'
import { disposableCashDatabase } from './postgres-test-database.ts'

it('permits only generated cash database names and never interpolates unvalidated input', async () => {
  const query = vi.fn()
  await expect(
    disposableCashDatabase({ query }, 'athlos_cash_0123456789abcdef0123456789abcdef'),
  ).resolves.toBeUndefined()
  expect(query).toHaveBeenCalledWith(
    'CREATE DATABASE "athlos_cash_0123456789abcdef0123456789abcdef"',
  )
  await expect(
    disposableCashDatabase({ query }, 'athlos_cash_bad;DROP DATABASE postgres'),
  ).rejects.toThrow('unsafe disposable database name')
})
