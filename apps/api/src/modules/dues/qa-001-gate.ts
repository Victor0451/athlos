export type Qa001Candidate = {
  revision: string
  environmentId: string
  candidateId: string
}

export type Qa001GateResult = {
  collectionsComplete: boolean
  p0Released: boolean
  reasons: string[]
}

type Evidence = Record<string, unknown>

/** Closed provenance: only an explicitly recorded human can accept a release. */
export type Qa001AcceptorType = 'human'

const pending = /^(pending|unknown|partial|not run)$/i

function record(value: unknown): value is Evidence {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, keys: string[], reasons: string[], path: string): value is Evidence {
  if (!record(value)) {
    reasons.push(`${path} is missing`)
    return false
  }
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    reasons.push(`${path} has unknown or partial fields`)
    return false
  }
  return true
}

function value(evidence: Evidence, key: string, reasons: string[], expected?: string): boolean {
  const candidate = evidence[key]
  if (typeof candidate !== 'string' || !candidate.trim() || pending.test(candidate)) {
    reasons.push(`${key} is missing or pending`)
    return false
  }
  if (expected && candidate !== expected) {
    reasons.push(`${key} does not match the candidate`)
    return false
  }
  return true
}

function fields(evidence: Evidence, keys: string[], reasons: string[], path: string): boolean {
  return exact(evidence, keys, reasons, path) && keys.every((key) => value(evidence, key, reasons))
}

/** Pure terminal gate: it parses supplied evidence only and never persists or executes finance work. */
export function evaluateQa001Evidence(input: unknown, candidate: Qa001Candidate): Qa001GateResult {
  const reasons: string[] = []
  const rootKeys = [
    'revision',
    'environment',
    'support',
    'baseline',
    'assessment',
    'payment',
    'reversal',
    'treatments',
    'approvals',
    'rollback',
    'acceptance',
  ]
  if (!exact(input, rootKeys, reasons, 'evidence')) return blocked(reasons)
  const evidence = input
  value(evidence, 'revision', reasons, candidate.revision)
  const environment = evidence.environment
  if (exact(environment, ['id', 'candidate'], reasons, 'environment')) {
    value(environment, 'id', reasons, candidate.environmentId)
    value(environment, 'candidate', reasons, candidate.candidateId)
  }
  const support = evidence.support
  if (exact(support, ['automated'], reasons, 'support'))
    value(support, 'automated', reasons, 'passed')
  const baseline = evidence.baseline
  if (record(baseline)) fields(baseline, ['precheck', 'postcheck'], reasons, 'baseline')
  else reasons.push('baseline is missing')
  const assessment = evidence.assessment
  if (record(assessment))
    fields(assessment, ['expectedRange', 'actualRange', 'replay'], reasons, 'assessment')
  else reasons.push('assessment is missing')
  const payment = evidence.payment
  if (exact(payment, ['full', 'tender', 'physicalCash'], reasons, 'payment')) {
    value(payment, 'full', reasons, 'passed')
    value(payment, 'tender', reasons, 'CASH')
    value(payment, 'physicalCash', reasons, 'matched')
  }
  const reversal = evidence.reversal
  if (exact(reversal, ['exact'], reasons, 'reversal')) value(reversal, 'exact', reasons, 'passed')
  const treatments = evidence.treatments
  if (record(treatments))
    fields(
      treatments,
      ['payment', 'communityWork', 'agreement', 'condonation'],
      reasons,
      'treatments',
    )
  else reasons.push('treatments is missing')
  const approvals = evidence.approvals
  if (record(approvals))
    fields(approvals, ['request', 'rejection', 'condonation'], reasons, 'approvals')
  else reasons.push('approvals is missing')
  const rollback = evidence.rollback
  if (exact(rollback, ['evidence'], reasons, 'rollback')) value(rollback, 'evidence', reasons)
  const acceptance = evidence.acceptance
  if (exact(acceptance, ['acceptingUser', 'acceptorType', 'signOff'], reasons, 'acceptance')) {
    value(acceptance, 'acceptingUser', reasons)
    value(acceptance, 'acceptorType', reasons, 'human')
    value(acceptance, 'signOff', reasons, 'affirmative')
  }
  return reasons.length
    ? blocked(reasons)
    : { collectionsComplete: true, p0Released: true, reasons: [] }
}

function blocked(reasons: string[]): Qa001GateResult {
  return { collectionsComplete: false, p0Released: false, reasons }
}
