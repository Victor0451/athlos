import { getTableName } from 'drizzle-orm'
import {
  accountHolderHistory,
  accountMemberships,
  legacyIdentityEvidence,
  memberIdentities,
  membershipAccounts,
} from './index.ts'
import { describe, expect, it } from 'vitest'

describe('socios legacy identity contracts', () => {
  it('exports the five additive identity tables through the schema barrel', () => {
    expect([
      getTableName(membershipAccounts),
      getTableName(memberIdentities),
      getTableName(accountMemberships),
      getTableName(accountHolderHistory),
      getTableName(legacyIdentityEvidence),
    ]).toEqual([
      'membership_accounts',
      'member_identities',
      'account_memberships',
      'account_holder_history',
      'legacy_identity_evidence',
    ])
  })

  it('keeps the future credential boundary opaque and nullable', () => {
    expect(memberIdentities.credentialRef.name).toBe('credential_ref')
    expect(memberIdentities.credentialRef.notNull).toBe(false)
  })
})
