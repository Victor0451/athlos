import { expect, it, vi } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { AgreementService } from './agreements.ts'
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
  const audit = auditLog(), original = { id: 'agreement-1', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'INSTALLMENT' as const, status: 'ACTIVE' as const, revisionNumber: 1, terms: terms(12_000), revisionOfAgreementId: null }
  const revisionTerms = terms(12_000, 4)
  const revision = { ...original, id: 'agreement-2', revisionNumber: 2, terms: revisionTerms, revisionOfAgreementId: original.id }
  const repository = { createAgreement: vi.fn().mockResolvedValue(original), rescheduleAgreement: vi.fn().mockResolvedValue(revision) }
  const service = new AgreementService(db(), { repository, audit: audit.emit, now: () => new Date('2026-08-18T20:00:00Z') })
  const first = await service.create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', kind: 'INSTALLMENT', terms: original.terms, reason: 'Approved plan' })
  const result = await service.reschedule({ ...context, agreementId: first.id, terms: revisionTerms, reason: 'Approved reschedule' })
  expect(first.terms).toEqual(original.terms)
  expect(result.revisionOfAgreementId).toBe(first.id)
  expect(result.obligationId).toBe(original.obligationId)
  expect(result.revisionNumber).toBe(2)
  expect(repository.rescheduleAgreement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agreementId: first.id, terms: revisionTerms, reason: 'Approved reschedule' }))
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
  const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn() }
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
  const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn() }
  const service = new AgreementService(db(), { repository, audit: auditLog().emit })
  await expect(service.create({ ...context, role: 'OPERADOR', socioId: 'socio-1', obligationId: 'obligation-1', kind: 'SIMPLE', terms: terms(1, 1), reason: 'Denied' })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
  expect(repository.createAgreement).not.toHaveBeenCalled()
})

// prettier-ignore
it('maps a closed-agreement reschedule conflict without creating a successor', async () => { const repository = { createAgreement: vi.fn(), rescheduleAgreement: vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { code: ErrorCode.CONFLICT })) }, service = new AgreementService(db(), { repository, audit: auditLog().emit, now: () => new Date('2026-08-18T20:00:00Z') }); await expect(service.reschedule({ ...context, agreementId: 'agreement-1', terms: terms(1, 1), reason: 'Late correction' })).rejects.toMatchObject({ code: ErrorCode.CONFLICT }); expect(repository.rescheduleAgreement).toHaveBeenCalledTimes(1); expect(repository.createAgreement).not.toHaveBeenCalled() })
