import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCandidate, main, verifyEvidenceFile } from './qa-001-verify.ts'

const candidate = {
  revision: '38ba52eb',
  environmentId: 'beta-athlos',
  candidateId: 'collections-09a',
}

/** Mirrors the passing fixture in qa-001-smoke.test.ts, bound to `candidate`. */
function completeEvidence() {
  return {
    revision: candidate.revision,
    environment: { id: candidate.environmentId, candidate: candidate.candidateId },
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

async function evidenceFile(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qa001-verify-'))
  const path = join(dir, 'evidence.json')
  await writeFile(path, JSON.stringify(contents, null, 2), 'utf8')
  return path
}

describe('QA-001 live-run evidence verifier', () => {
  it('releases only when the evidence is complete and matches the independent candidate', async () => {
    const path = await evidenceFile(completeEvidence())

    await expect(verifyEvidenceFile(path, candidate)).resolves.toEqual({
      collectionsComplete: true,
      p0Released: true,
      reasons: [],
    })
  })

  it('stays blocked and names every unmet field for the shipped example record', async () => {
    // The example file that ships with the kit is deliberately un-runnable: every field a
    // live BETA run must produce is the literal string "pending", which the gate rejects.
    // This test is what keeps the kit fail-closed by construction — if someone fills the
    // example with plausible-looking placeholders instead of real evidence, it must not pass.
    const path = join(import.meta.dirname, '../../../../docs/qa-001-evidence.example.json')

    const result = await verifyEvidenceFile(path, candidate)

    expect(result).toMatchObject({ collectionsComplete: false, p0Released: false })
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons).toContain('revision is missing or pending')
    expect(result.reasons).toContain('physicalCash is missing or pending')
    expect(result.reasons).toContain('signOff is missing or pending')
  })

  it('reports only the first unmet field of each group, because the gate short-circuits', async () => {
    // fields() in qa-001-gate.ts ends in `keys.every(...)`, and Array.prototype.every stops
    // at the first false. So baseline, assessment, treatments and approvals each surface only
    // their first unmet field, while revision, environment, payment and acceptance are checked
    // with sequential value() calls and surface all of theirs — 16 reasons in total, not 23.
    //
    // Consequence for the live run: an operator must re-run the verifier after each round of
    // corrections rather than fixing everything in one pass. That is a property of the gate,
    // not of this script, so it is pinned here instead of papered over: if the gate ever starts
    // reporting exhaustively, this test fails and the change is noticed rather than silent.
    const path = join(import.meta.dirname, '../../../../docs/qa-001-evidence.example.json')

    const { reasons } = await verifyEvidenceFile(path, candidate)

    expect(reasons).toHaveLength(16)
    // Sequentially checked groups report every unmet field.
    for (const field of [
      'revision',
      'id',
      'candidate',
      'automated',
      'full',
      'tender',
      'physicalCash',
      'exact',
      'evidence',
      'acceptingUser',
      'acceptorType',
      'signOff',
    ])
      expect(reasons, `${field} should be reported`).toContain(`${field} is missing or pending`)
    // Short-circuited groups report only their first unmet field.
    for (const first of ['precheck', 'expectedRange', 'payment', 'request'])
      expect(reasons, `${first} should be reported`).toContain(`${first} is missing or pending`)
    for (const hidden of [
      'postcheck',
      'actualRange',
      'replay',
      'communityWork',
      'agreement',
      'rejection',
    ])
      expect(reasons, `${hidden} is masked by the short-circuit`).not.toContain(
        `${hidden} is missing or pending`,
      )
  })

  it('fails closed when the evidence revision is not the candidate under review', async () => {
    const path = await evidenceFile({ ...completeEvidence(), revision: 'stale000' })

    const result = await verifyEvidenceFile(path, candidate)

    expect(result.p0Released).toBe(false)
    expect(result.reasons).toContain('revision does not match the candidate')
  })

  it('fails closed when a human never signed off', async () => {
    const unsigned = completeEvidence()
    unsigned.acceptance = { ...unsigned.acceptance, acceptorType: 'human', signOff: 'pending' }
    const path = await evidenceFile(unsigned)

    const result = await verifyEvidenceFile(path, candidate)

    expect(result.p0Released).toBe(false)
    expect(result.reasons).toContain('signOff is missing or pending')
  })

  it('fails closed when acceptance claims automated provenance', async () => {
    const path = await evidenceFile({
      ...completeEvidence(),
      acceptance: {
        acceptingUser: 'ci-runner',
        acceptorType: 'automated',
        signOff: 'affirmative',
      },
    })

    const result = await verifyEvidenceFile(path, candidate)

    expect(result.p0Released).toBe(false)
    expect(result.reasons).toContain('acceptorType does not match the candidate')
  })

  it('rejects malformed JSON instead of treating it as empty evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa001-verify-'))
    const path = join(dir, 'broken.json')
    await writeFile(path, '{ "revision": ', 'utf8')

    await expect(verifyEvidenceFile(path, candidate)).rejects.toThrow(/parse/i)
  })

  it('rejects a missing file', async () => {
    await expect(
      verifyEvidenceFile('/nonexistent/qa-001-evidence.json', candidate),
    ).rejects.toThrow()
  })
})

describe('main exit codes', () => {
  const args = [
    '--revision',
    '38ba52eb',
    '--environment-id',
    'beta-athlos',
    '--candidate-id',
    'collections-09a',
  ]

  it('exits 1 while the evidence is blocked', async () => {
    const path = await evidenceFile({ ...completeEvidence(), rollback: {} })

    await expect(main([path, ...args])).resolves.toBe(1)
  })

  it('exits 0 only for released evidence', async () => {
    const path = await evidenceFile(completeEvidence())

    await expect(main([path, ...args])).resolves.toBe(0)
  })

  it('exits 2 on unusable arguments, without pretending the gate ran', async () => {
    await expect(main(['evidence.json'])).resolves.toBe(2)
  })
})

describe('buildCandidate', () => {
  it('reads the candidate identity from independent CLI arguments', () => {
    expect(
      buildCandidate([
        'evidence.json',
        '--revision',
        '38ba52eb',
        '--environment-id',
        'beta-athlos',
        '--candidate-id',
        'collections-09a',
      ]),
    ).toEqual(candidate)
  })

  it('refuses to run when any candidate field is absent', () => {
    // Without an independent candidate the verifier would compare the evidence against
    // itself, making the revision and environment checks vacuous.
    expect(() => buildCandidate(['evidence.json', '--revision', '38ba52eb'])).toThrow(
      /--environment-id/,
    )
    expect(() => buildCandidate(['evidence.json'])).toThrow(/--revision/)
  })

  it('refuses a pending or blank candidate field', () => {
    expect(() =>
      buildCandidate([
        'evidence.json',
        '--revision',
        'pending',
        '--environment-id',
        'beta-athlos',
        '--candidate-id',
        'collections-09a',
      ]),
    ).toThrow(/--revision/)
  })

  it('refuses when no evidence path is supplied', () => {
    expect(() =>
      buildCandidate([
        '--revision',
        '38ba52eb',
        '--environment-id',
        'beta-athlos',
        '--candidate-id',
        'collections-09a',
      ]),
    ).toThrow(/evidence/i)
  })
})
