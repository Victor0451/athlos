import { getTableName } from 'drizzle-orm'
import {
  accountHolderHistory,
  accountMemberships,
  legacyIdentityEvidence,
  legacyMemberEvidenceResolutions,
  legacyMemberReviewState,
  memberIdentities,
  membershipAccounts,
} from './index.ts'
import { describe, expect, it } from 'vitest'

describe('socios legacy identity contracts', () => {
  it('exports additive identity tables and exception resolutions through the schema barrel', () => {
    expect([
      getTableName(membershipAccounts),
      getTableName(memberIdentities),
      getTableName(accountMemberships),
      getTableName(accountHolderHistory),
      getTableName(legacyIdentityEvidence),
      getTableName(legacyMemberEvidenceResolutions),
    ]).toEqual([
      'membership_accounts',
      'member_identities',
      'account_memberships',
      'account_holder_history',
      'legacy_identity_evidence',
      'legacy_member_evidence_resolutions',
    ])
  })

  it('keeps the Drizzle review-state enum aligned with migration 0043', () => {
    expect(legacyMemberReviewState.enumValues).toEqual([
      'validated',
      'unknown_type',
      'ambiguous_identity',
      'missing_identity',
    ])
  })

  it('keeps the future credential boundary opaque and nullable', () => {
    expect(memberIdentities.credentialRef.name).toBe('credential_ref')
    expect(memberIdentities.credentialRef.notNull).toBe(false)
  })
})
