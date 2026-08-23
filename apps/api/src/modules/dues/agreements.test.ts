import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { AgreementService, decodeAgreementTerms } from './agreements.ts'
import type { AuditContext } from './service.ts'

// prettier-ignore
const context: AuditContext = { actorId: '00000000-0000-4000-8000-000000000001', role: 'ADMIN', permissions: ['dues:agreements'], sourceIp: '127.0.0.1', callerKey: 'agreement-1', requestFingerprint: 'a'.repeat(64), authorizationEvidence: { role: 'ADMIN' } }
// prettier-ignore
const db = () => ({ transaction: vi.fn(async (work: (value: unknown) => unknown) => work({})) }) as never
// prettier-ignore
const auditLog = () => { const records: AuditRecord[] = []; return { records, emit: vi.fn(async (_db: unknown, record: AuditRecord) => { records.push(record); return { inserted: true as const, id: `audit-${records.length}` } }) } }

const terms = (amountCents: number, installments = 3) => ({
  amountCents,
  installments: Array.from({ length: installments }, (_, index) => ({
    amountCents:
      index === installments - 1
        ? amountCents - Math.floor(amountCents / installments) * index
        : Math.floor(amountCents / installments),
    dueDate: `2026-08-${String(19 + index).padStart(2, '0')}`,
  })),
})

// prettier-ignore
it('creates a formal plan and reschedules it without rewriting the original terms', async () => {
  const audit = auditLog(), original = { id: 'agreement-1', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'INSTALLMENT' as const, status: 'ACTIVE' as const, revisionNumber: 1, termsVersion: 0, terms: terms(12_000), agreementDate: '2026-08-18', revisionOfAgreementId: null }
  const revisionTerms = terms(12_000, 4)
  const revision = { ...original, id: 'agreement-2', revisionNumber: 2, terms: revisionTerms, revisionOfAgreementId: original.id }
  const repository = { createAgreement: vi.fn().mockResolvedValue({ outcome: 'created', agreement: original }), rescheduleAgreement: vi.fn().mockResolvedValue({ outcome: 'created', agreement: revision }), reviseAgreement: vi.fn() }
  const service = new AgreementService(db(), { repository, audit: audit.emit, now: () => new Date('2026-08-18T20:00:00Z') })
  const first = await service.create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', kind: 'INSTALLMENT', terms: original.terms, reason: 'Approved plan' })
  const result = await service.reschedule({ ...context, agreementId: first.agreement.id, terms: revisionTerms, reason: 'Approved reschedule' })
  expect(first.outcome).toBe('created')
  expect(first.agreement.terms).toEqual(original.terms)
  expect(result.agreement.revisionOfAgreementId).toBe(first.agreement.id)
  expect(result.agreement.obligationId).toBe(original.obligationId)
  expect(result.agreement.revisionNumber).toBe(2)
  expect(repository.rescheduleAgreement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agreementId: first.agreement.id, terms: revisionTerms, reason: 'Approved reschedule' }))
  expect(audit.records.map(({ action }) => action)).toEqual([AuditAction.DUES_AGREEMENT_CREATED, AuditAction.DUES_AGREEMENT_REVISED])
})

it.each([
  [
    'amount must be positive',
    { ...terms(0), installments: [{ amountCents: 0, dueDate: '2026-08-19' }] },
  ],
  [
    'installment count must be bounded',
    {
      amountCents: 6100,
      installments: Array.from({ length: 61 }, (_, index) => ({
        amountCents: 100,
        dueDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
      })),
    },
  ],
  [
    'dates must be strictly increasing',
    {
      amountCents: 2000,
      installments: [
        { amountCents: 1000, dueDate: '2026-08-20' },
        { amountCents: 1000, dueDate: '2026-08-20' },
      ],
    },
  ],
  [
    'amounts must sum exactly',
    {
      amountCents: 2000,
      installments: [
        { amountCents: 999, dueDate: '2026-08-20' },
        { amountCents: 1000, dueDate: '2026-08-21' },
      ],
    },
  ],
  [
    'dates cannot precede the agreement date',
    { amountCents: 1000, installments: [{ amountCents: 1000, dueDate: '2026-08-17' }] },
  ],
])('rejects %s before persistence', async (_case, invalidTerms) => {
  const repository = {
    createAgreement: vi.fn(),
    rescheduleAgreement: vi.fn(),
    reviseAgreement: vi.fn(),
  }
  const service = new AgreementService(db(), {
    repository,
    audit: auditLog().emit,
    now: () => new Date('2026-08-18T20:00:00Z'),
  })
  await expect(
    service.create({
      ...context,
      socioId: 'socio-1',
      obligationId: 'obligation-1',
      kind: 'INSTALLMENT',
      terms: invalidTerms,
      reason: 'Invalid plan',
    }),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.createAgreement).not.toHaveBeenCalled()
})

// prettier-ignore
it('rejects agreement commands from unauthorized roles before persistence', async () => {
  const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn(), reviseAgreement: vi.fn() }
  const service = new AgreementService(db(), { repository, audit: auditLog().emit })
  await expect(service.create({ ...context, role: 'OPERADOR', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'SIMPLE', terms: terms(1, 1), reason: 'Denied' })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
  await expect(service.revise({ ...context, role: 'OPERADOR', agreementId: 'agreement-1', terms: { narrative: 'Denied revision.' }, reason: 'Denied' })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
  expect(repository.createAgreement).not.toHaveBeenCalled()
  expect(repository.reviseAgreement).not.toHaveBeenCalled()
})

// prettier-ignore
it('maps a closed-agreement reschedule conflict without creating a successor', async () => { const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { code: ErrorCode.CONFLICT })), reviseAgreement: vi.fn() }, service = new AgreementService(db(), { repository, audit: auditLog().emit, now: () => new Date('2026-08-18T20:00:00Z') }); await expect(service.reschedule({ ...context, agreementId: 'agreement-1', terms: terms(1, 1), reason: 'Late correction' })).rejects.toMatchObject({ code: ErrorCode.CONFLICT }); expect(repository.rescheduleAgreement).toHaveBeenCalledTimes(1); expect(repository.createAgreement).not.toHaveBeenCalled() })

const negotiatedTerms = (overrides: Record<string, unknown> = {}) => ({
  narrative: 'El socio regularizará la deuda en cuotas conversadas con secretaría.',
  ...overrides,
})
const expectInvalidTerms = (
  kind: 'SIMPLE' | 'INSTALLMENT' | 'NEGOTIATED',
  termsVersion: number,
  payload: unknown,
) => {
  try {
    decodeAgreementTerms(kind, termsVersion, payload as never, '2026-08-18')
    expect.unreachable('expected negotiated terms validation to fail')
  } catch (error) {
    expect(error).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  }
}

it('decodes supported versioned representations and fails closed on unsupported pairs', () => {
  expect(decodeAgreementTerms('INSTALLMENT', 0, terms(3_000, 1), '2026-08-18')).toMatchObject({
    kind: 'INSTALLMENT',
    termsVersion: 0,
  })
  expect(decodeAgreementTerms('NEGOTIATED', 1, negotiatedTerms(), '2026-08-18')).toEqual({
    kind: 'NEGOTIATED',
    termsVersion: 1,
    terms: negotiatedTerms(),
  })
  expectInvalidTerms('SIMPLE', 1, terms(3_000, 1))
  expectInvalidTerms('NEGOTIATED', 0, negotiatedTerms())
  expectInvalidTerms('NEGOTIATED', 2, negotiatedTerms())
})

it.each([
  ['missing narrative', {}],
  ['blank narrative', { narrative: '   ' }],
  ['oversized narrative', { narrative: 'x'.repeat(4001) }],
  ['unknown top-level field', { narrative: 'ok', category: 'work' }],
  [
    'commitment id must be a UUID',
    { narrative: 'ok', commitments: [{ id: 'bad', title: 'Action' }] },
  ],
  [
    'commitment title is required',
    { narrative: 'ok', commitments: [{ id: randomUUID(), title: '   ' }] },
  ],
  [
    'commitments are capped at 50',
    {
      narrative: 'ok',
      commitments: Array.from({ length: 51 }, () => ({ id: randomUUID(), title: 'Action' })),
    },
  ],
  [
    'commitment amount must be positive',
    { narrative: 'ok', commitments: [{ id: randomUUID(), title: 'Action', amountCents: 0 }] },
  ],
  [
    'commitment date must be valid',
    {
      narrative: 'ok',
      commitments: [{ id: randomUUID(), title: 'Action', dueDate: '2026-13-40' }],
    },
  ],
  [
    'commitment fields are bounded',
    { narrative: 'ok', commitments: [{ id: randomUUID(), title: 'Action', phase: 'one' }] },
  ],
  ['evidence fields are bounded', { narrative: 'ok', evidence: { badge: 'x' } }],
  [
    'evidence metadata is size bounded',
    { narrative: 'ok', evidence: { metadata: { blob: 'x'.repeat(8193) } } },
  ],
])('rejects negotiated terms with %s before persistence', (_label, payload) => {
  expectInvalidTerms('NEGOTIATED', 1, payload)
})

it('accepts negotiated terms with bounded commitments and evidence', () => {
  const termsValue = {
    narrative: 'Plan conversado en secretaría.',
    commitments: [
      {
        id: randomUUID(),
        title: 'Entrega inicial',
        description: 'Materiales acordados',
        dueDate: '2099-02-01',
        amountCents: 123_456,
        evidence: { note: 'Acta firmada', references: ['nota-1'], metadata: { mesa: 'ayuda' } },
      },
    ],
    evidence: { note: 'Acuerdo conversado' },
  }
  expect(decodeAgreementTerms('NEGOTIATED', 1, termsValue, '2026-08-18')).toEqual({
    kind: 'NEGOTIATED',
    termsVersion: 1,
    terms: termsValue,
  })
})

// prettier-ignore
it('creates a negotiated agreement and reports the claim outcome', async () => {
  const audit = auditLog(), agreement = { id: 'agreement-n1', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED' as const, status: 'ACTIVE' as const, revisionNumber: 1, termsVersion: 1, terms: negotiatedTerms(), agreementDate: '2026-08-18', revisionOfAgreementId: null }
  const repository = { createAgreement: vi.fn().mockResolvedValue({ outcome: 'created', agreement }), rescheduleAgreement: vi.fn(), reviseAgreement: vi.fn() }
  const service = new AgreementService(db(), { repository, audit: audit.emit, now: () => new Date('2026-08-18T20:00:00Z') })
  const result = await service.create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED', termsVersion: 1, terms: negotiatedTerms(), reason: 'Condiciones acordadas con el socio' })
  expect(result).toMatchObject({ outcome: 'created', agreement: expect.objectContaining({ id: 'agreement-n1', termsVersion: 1 }) })
  expect(repository.createAgreement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'NEGOTIATED', termsVersion: 1, terms: negotiatedTerms() }))
  expect(audit.records.map(({ action }) => action)).toEqual([AuditAction.DUES_AGREEMENT_CREATED])
})

// prettier-ignore
it('revises a negotiated agreement through the successor repository path', async () => {
  const audit = auditLog(), successor = { id: 'agreement-n2', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED' as const, status: 'ACTIVE' as const, revisionNumber: 2, termsVersion: 1, terms: negotiatedTerms({ narrative: 'Actualización.' }), agreementDate: '2026-08-18', revisionOfAgreementId: 'agreement-n1' }
  const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn(), reviseAgreement: vi.fn().mockResolvedValue({ outcome: 'created', agreement: successor }) }
  const service = new AgreementService(db(), { repository, audit: audit.emit, now: () => new Date('2026-08-18T20:00:00Z') })
  const result = await service.revise({ ...context, agreementId: 'agreement-n1', terms: successor.terms, reason: 'Renegociación' })
  expect(result).toMatchObject({ outcome: 'created', agreement: expect.objectContaining({ revisionNumber: 2, revisionOfAgreementId: 'agreement-n1' }) })
  expect(repository.reviseAgreement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agreementId: 'agreement-n1', terms: successor.terms }))
  expect(audit.records.map(({ action }) => action)).toEqual([AuditAction.DUES_AGREEMENT_REVISED])
})

// prettier-ignore
it('replays completed create and revise requests without extra audit', async () => {
  const audit = auditLog(), original = { id: 'agreement-n1', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED' as const, status: 'ACTIVE' as const, revisionNumber: 1, termsVersion: 1, terms: negotiatedTerms(), agreementDate: '2026-08-18', revisionOfAgreementId: null }, successor = { ...original, id: 'agreement-n2', revisionNumber: 2, terms: negotiatedTerms({ narrative: 'Actualización.' }), revisionOfAgreementId: original.id }
  const repository = { createAgreement: vi.fn().mockResolvedValue({ outcome: 'replayed', agreement: original }), rescheduleAgreement: vi.fn(), reviseAgreement: vi.fn().mockResolvedValue({ outcome: 'replayed', agreement: successor }) }
  const service = new AgreementService(db(), { repository, audit: audit.emit, now: () => new Date('2026-08-18T20:00:00Z') })
  const createReplay = await service.create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED', termsVersion: 1, terms: original.terms, reason: 'Retry' })
  const reviseReplay = await service.revise({ ...context, callerKey: 'agreement-2', agreementId: original.id, terms: successor.terms, reason: 'Retry revision' })
  expect(createReplay).toMatchObject({ outcome: 'replayed', agreement: expect.objectContaining({ id: original.id }) })
  expect(reviseReplay).toMatchObject({ outcome: 'replayed', agreement: expect.objectContaining({ id: successor.id }) })
  expect(audit.records).toHaveLength(0)
})

// prettier-ignore
it('validates negotiated mutations before persistence and surfaces repository conflicts', async () => {
  const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn().mockRejectedValue(Object.assign(new Error('cross'), { code: ErrorCode.CONFLICT })), reviseAgreement: vi.fn().mockRejectedValue(Object.assign(new Error('cross'), { code: ErrorCode.CONFLICT })) }
  const service = new AgreementService(db(), { repository, audit: auditLog().emit, now: () => new Date('2026-08-18T20:00:00Z') })
  await expect(service.revise({ ...context, agreementId: 'agreement-1', terms: terms(1, 1), reason: 'Wrong representation' })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.reviseAgreement).not.toHaveBeenCalled()
  await expect(service.create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', kind: 'NEGOTIATED', termsVersion: 1, terms: { narrative: '' }, reason: 'Denied' })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.createAgreement).not.toHaveBeenCalled()
  await expect(service.reschedule({ ...context, agreementId: 'agreement-n1', terms: terms(1, 1), reason: 'Legacy over negotiated' })).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  await expect(service.revise({ ...context, agreementId: 'agreement-1', terms: negotiatedTerms(), reason: 'Negotiated over legacy' })).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
})
