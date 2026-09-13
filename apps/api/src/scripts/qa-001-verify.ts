import { readFile } from 'node:fs/promises'
import {
  evaluateQa001Evidence,
  type Qa001Candidate,
  type Qa001GateResult,
} from '../modules/dues/qa-001-gate.ts'

/**
 * QA-001 Collections terminal gate — live-run evidence verifier.
 *
 * `evaluateQa001Evidence` is a pure function with no caller outside its own smoke test: the
 * gate specified what complete evidence looks like, but nothing ever ran it against evidence
 * a human actually collected. This script is that caller. It adds no validation of its own —
 * every verdict comes from the gate itself, so the verifier cannot drift into reporting a
 * release the gate would refuse.
 *
 * Usage:
 *   pnpm --filter @athlos/api qa001:verify <evidence.json> \
 *     --revision <immutable revision> \
 *     --environment-id <non-secret BETA identity> \
 *     --candidate-id <release candidate identity>
 *
 * The candidate identity must be supplied here rather than read from the evidence file. The
 * gate compares `evidence.revision` against `candidate.revision` (and likewise for the
 * environment and candidate ids); sourcing both from one file would compare the evidence
 * against itself and make those three checks vacuous.
 *
 * A released verdict means the recorded evidence is complete and self-consistent. It is not
 * itself the acceptance: the acceptor is whoever signs the record, and this script only
 * reports whether that record satisfies the gate. Nothing here persists state or executes
 * financial work.
 *
 * Exit codes:
 *   0 — the gate released Collections and the exclusive P0 hold
 *   1 — the gate stayed blocked; every unmet field is printed
 *   2 — unusable arguments or unreadable/unparseable evidence; the gate never ran
 */

const pending = /^(pending|unknown|partial|not run)$/i

const USAGE = `Usage: pnpm --filter @athlos/api qa001:verify <evidence.json> \\
  --revision <immutable revision> \\
  --environment-id <non-secret BETA identity> \\
  --candidate-id <release candidate identity>`

/** The first non-flag argument, skipping each flag together with its value. */
export function evidencePath(argv: string[]): string | undefined {
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith('--')) {
      i += 1
      continue
    }
    positionals.push(arg)
  }
  return positionals[0]
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index < 0 ? undefined : argv[index + 1]
}

function requireFlag(argv: string[], name: string): string {
  const value = flagValue(argv, name)
  if (value === undefined || !value.trim())
    throw new Error(`${name} is required and must be a non-empty value.`)
  if (pending.test(value))
    throw new Error(
      `${name} must name the release candidate actually under review, not "${value}".`,
    )
  return value
}

/**
 * Validates the whole argument vector and returns the independent candidate identity.
 *
 * The evidence path is checked here too, on purpose: a run missing either half of the
 * comparison should fail once, early, with usage — not get as far as reading a file and
 * then report a confusing gate verdict.
 */
export function buildCandidate(argv: string[]): Qa001Candidate {
  const revision = requireFlag(argv, '--revision')
  const environmentId = requireFlag(argv, '--environment-id')
  const candidateId = requireFlag(argv, '--candidate-id')

  if (!evidencePath(argv))
    throw new Error('An evidence JSON path is required as the first argument.')

  return { revision, environmentId, candidateId }
}

/** Reads one evidence record and returns the gate's verdict for it, unmodified. */
export async function verifyEvidenceFile(
  path: string,
  candidate: Qa001Candidate,
): Promise<Qa001GateResult> {
  const raw = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `Cannot parse the QA-001 evidence JSON at ${path}: ${(cause as Error).message}`,
      { cause },
    )
  }
  return evaluateQa001Evidence(parsed, candidate)
}

export async function main(argv: string[]): Promise<number> {
  let candidate: Qa001Candidate
  let path: string
  try {
    candidate = buildCandidate(argv)
    path = evidencePath(argv) as string
  } catch (error) {
    console.error(`QA-001 verifier: ${(error as Error).message}`)
    console.error(USAGE)
    return 2
  }

  let result: Qa001GateResult
  try {
    result = await verifyEvidenceFile(path, candidate)
  } catch (error) {
    console.error(`QA-001 verifier: ${(error as Error).message}`)
    return 2
  }

  console.error('QA-001 Collections terminal gate')
  console.error(`  evidence:  ${path}`)
  console.error(
    `  candidate: revision=${candidate.revision} environment=${candidate.environmentId} ` +
      `id=${candidate.candidateId}`,
  )
  console.error('')

  if (result.p0Released) {
    console.error('RELEASED — the recorded evidence satisfies the gate.')
    console.error('  collectionsComplete: true   p0Released: true')
    console.error('')
    console.error(
      '  This verdict is about the record, not a substitute for it: preserve the signed\n' +
        '  evidence file. Corrections to financial facts go through the supported exact\n' +
        '  reversal only — never by editing a ledger or this record after the fact.',
    )
    return 0
  }

  console.error('BLOCKED — Collections incomplete, exclusive P0 gate held.')
  console.error(`  ${result.reasons.length} unmet field(s):`)
  for (const reason of result.reasons) console.error(`    - ${reason}`)
  console.error('')
  console.error(
    '  The gate short-circuits within baseline, assessment, treatments and approvals, so this\n' +
      '  list can hide further unmet fields behind the first one in each of those groups. Expect\n' +
      '  to re-run after each round of corrections. See docs/qa-001-run-checklist.md for what\n' +
      '  each field requires and for the full field list in one place.',
  )
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(`QA-001 verifier failed: ${(error as Error).message}`)
      process.exitCode = 2
    })
}
