import { describe, expect, it } from 'vitest'
import { evaluateQa001Evidence } from './qa-001-gate.ts'

const expected = {
  revision: 'a640c35',
  environmentId: 'beta-athlos',
  candidateId: 'collections-09a',
}

function evidence() {
  return {
    revision: expected.revision,
    environment: { id: expected.environmentId, candidate: expected.candidateId },
    support: { automated: 'passed' },
    baseline: { precheck: 'supported', postcheck: 'supported' },
    assessment: { expectedRange: 'bounded', actualRange: 'bounded', replay: 'no duplicates' },
    payment: { full: 'passed', tender: 'CASH', physicalCash: 'matched' },
    reversal: { exact: 'passed' },
    treatments: {
      payment: 'passed',
      communityWork: 'passed',
      agreement: 'debt-neutral',
      condonation: 'passed',
    },
    approvals: { request: 'inert', rejection: 'inert', condonation: 'exactly-once' },
    rollback: { evidence: 'recorded' },
    acceptance: {
      acceptingUser: 'operator-reference',
      acceptorType: 'human',
      signOff: 'affirmative',
    },
  }
}

describe('QA-001 terminal completion gate', () => {
  it('keeps Collections and the exclusive P0 release blocked until complete live evidence and sign-off', () => {
    expect(evaluateQa001Evidence(evidence(), expected)).toEqual({
      collectionsComplete: true,
      p0Released: true,
      reasons: [],
    })

    for (const partial of [
      { ...evidence(), rollback: {} },
      {
        ...evidence(),
        acceptance: {
          acceptingUser: 'operator-reference',
          acceptorType: 'human',
          signOff: 'pending',
        },
      },
      { ...evidence(), revision: 'stale' },
      { ...evidence(), environment: { id: 'wrong', candidate: expected.candidateId } },
      { ...evidence(), approvals: { request: 'inert', rejection: 'inert', token: 'redacted' } },
      { ...evidence(), memberId: 'real-member' },
    ]) {
      expect(evaluateQa001Evidence(partial, expected)).toMatchObject({
        collectionsComplete: false,
        p0Released: false,
      })
    }
  })

  it('fails closed for bot or automated acceptor provenance', () => {
    for (const acceptorType of ['bot', 'automated']) {
      expect(
        evaluateQa001Evidence(
          {
            ...evidence(),
            acceptance: {
              acceptingUser: 'operator-reference',
              acceptorType,
              signOff: 'affirmative',
            },
          },
          expected,
        ),
      ).toMatchObject({ collectionsComplete: false, p0Released: false })
    }
  })

  it('releases only for explicit human affirmative acceptance with complete evidence', () => {
    expect(
      evaluateQa001Evidence({ ...evidence(), rollback: { evidence: 'pending' } }, expected),
    ).toMatchObject({ collectionsComplete: false, p0Released: false })

    expect(evaluateQa001Evidence(evidence(), expected)).toEqual({
      collectionsComplete: true,
      p0Released: true,
      reasons: [],
    })
  })
})
