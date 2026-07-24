import { describe, expect, it } from 'vitest'
import { verifyPassword } from '@athlos/auth'
import {
  bootstrapAdministrator,
  parseBootstrapArgs,
  type BootstrapDatabase,
} from './bootstrap-admin.js'

type Audit = { action: string; metadata: Record<string, unknown> }

function makeDatabase(options: { recoverable?: boolean; failFirstAttempt?: boolean } = {}): {
  db: BootstrapDatabase
  audits: Audit[]
  administrators: { id: string; passwordHash: string }[]
  attempts: number
} {
  const audits: Audit[] = []
  const administrators: { id: string; passwordHash: string }[] = []
  let attempts = 0

  const db: BootstrapDatabase = {
    transaction: async (callback) => {
      attempts++
      if (options.failFirstAttempt && attempts === 1) {
        const error = Object.assign(new Error('serialization failure'), { code: '40001' })
        throw error
      }

      return callback({
        query: async (sql, values = []) => {
          if (sql.includes('FROM operators')) {
            return {
              rows: options.recoverable || administrators.length > 0 ? [{ id: 'existing' }] : [],
            }
          }
          if (sql.includes('INSERT INTO operators')) {
            const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            administrators.push({ id, passwordHash: String(values[1]) })
            return { rows: [{ id }] }
          }
          if (sql.includes('INSERT INTO audit_events')) {
            audits.push({
              action: String(values[0]),
              metadata: JSON.parse(String(values[1])) as Record<string, unknown>,
            })
            return { rows: [] }
          }
          return { rows: [] }
        },
      })
    },
  }

  return {
    db,
    audits,
    administrators,
    get attempts() {
      return attempts
    },
  }
}

describe('controlled administrator bootstrap', () => {
  it('refuses a recoverable operator and records a credential-free audit reason', async () => {
    const harness = makeDatabase({ recoverable: true })

    const result = await bootstrapAdministrator(
      { username: 'admin', approvalId: 'INC-42', password: 'never-record-this' },
      harness.db,
    )

    expect(result).toEqual({ outcome: 'refused', reason: 'recoverable_operator_exists' })
    expect(harness.administrators).toHaveLength(0)
    expect(harness.audits).toEqual([
      {
        action: 'ADMIN_BOOTSTRAP_REFUSED',
        metadata: { approvalId: 'INC-42', reason: 'recoverable_operator_exists' },
      },
    ])
    expect(JSON.stringify({ result, audits: harness.audits })).not.toContain('never-record-this')
  })

  it('requires approval and records the refusal before creating an administrator', async () => {
    const harness = makeDatabase()

    await expect(
      bootstrapAdministrator(
        { username: 'admin', approvalId: '', password: 'never-record-this' },
        harness.db,
      ),
    ).resolves.toEqual({ outcome: 'refused', reason: 'approval_required' })
    expect(harness.administrators).toHaveLength(0)
    expect(harness.audits).toEqual([
      { action: 'ADMIN_BOOTSTRAP_REFUSED', metadata: { reason: 'approval_required' } },
    ])
  })

  it('fails closed when the audit insert is unavailable', async () => {
    const database: BootstrapDatabase = {
      transaction: async (callback) =>
        callback({
          query: async (sql) => {
            if (sql.includes('FROM operators')) return { rows: [] }
            if (sql.includes('INSERT INTO operators')) {
              return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] }
            }
            if (sql.includes('INSERT INTO audit_events'))
              throw new Error('audit relation unavailable')
            return { rows: [] }
          },
        }),
    }

    await expect(
      bootstrapAdministrator(
        { username: 'admin', approvalId: 'INC-42', password: 'never-record-this' },
        database,
      ),
    ).rejects.toThrow('audit relation unavailable')
  })

  it('retries a serialization conflict and creates exactly one administrator with a redacted audit', async () => {
    const harness = makeDatabase({ failFirstAttempt: true })

    const result = await bootstrapAdministrator(
      { username: 'admin', approvalId: 'INC-42', password: 'never-record-this' },
      harness.db,
    )

    expect(result).toEqual({
      outcome: 'created',
      operatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    expect(harness.attempts).toBe(2)
    expect(harness.administrators).toHaveLength(1)
    expect(harness.administrators[0]?.passwordHash).not.toContain('never-record-this')
    await expect(
      verifyPassword('never-record-this', harness.administrators[0]!.passwordHash),
    ).resolves.toBe(true)
    expect(harness.audits).toEqual([
      { action: 'ADMIN_BOOTSTRAPPED', metadata: { approvalId: 'INC-42', outcome: 'created' } },
    ])
  })

  it('accepts only a password file descriptor and excludes credentials from parsed output', () => {
    expect(
      parseBootstrapArgs(['--username', 'admin', '--approval-id', 'INC-42', '--password-fd', '3']),
    ).toEqual({
      username: 'admin',
      approvalId: 'INC-42',
      passwordFd: 3,
    })
    expect(() =>
      parseBootstrapArgs(['--username', 'admin', '--password', 'never-record-this']),
    ).toThrow('unsupported argument: --password')
  })
})
