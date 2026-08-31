'use client'

import type {
  CondonationDecisionInput,
  CondonationLifecycle,
  CondonationRequest,
  CondonationRequestInput,
} from '@/lib/api/condonation'
import type {
  DebtDetail,
  FullSelectionPaymentInput,
  FullSelectionPaymentResult,
} from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import { AgreementActions, type AgreementViewState } from './AgreementActions'
import type { AgreementDraft } from './AgreementForm'
import { CondonationActions } from './CondonationActions'
import { CondonationLifecycle as CondonationLifecyclePresenter } from './CondonationLifecycle'
import type { CommunityWorkDraft } from './CommunityWorkForm'
import { SettlementActions, type ReversalRequest } from './SettlementActions'

type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR'
type Props = {
  memberId: string
  debt: DebtDetail
  role: Role
  canSettle?: boolean
  canRequestCondonation?: boolean
  agreementsEnabled?: boolean
  agreementStates: Record<string, AgreementViewState>
  shifts?: CashShift[]
  lifecycle?: CondonationLifecycle[]
  onPayment?: (
    input: Omit<FullSelectionPaymentInput, 'socio_id'>,
  ) => Promise<FullSelectionPaymentResult & { replayed?: boolean }>
  onReverse?: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
  onCreateAgreement?: (
    obligationId: string,
    draft: AgreementDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onReviseAgreement?: (
    obligationId: string,
    agreementId: string,
    draft: AgreementDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onRecordCommunityWork?: (
    obligationId: string,
    agreementId: string,
    draft: CommunityWorkDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onRefreshAgreement?: (obligationId: string) => Promise<void> | void
  onRequestCondonation?: (input: CondonationRequestInput) => Promise<CondonationRequest>
  onDecideCondonation?: (id: string, input: CondonationDecisionInput) => Promise<CondonationRequest>
  onExecuteCondonation?: (item: CondonationLifecycle) => Promise<unknown>
  executionFeedback?: {
    id: string
    status:
      | 'idle'
      | 'executing'
      | 'replayed'
      | 'recoverable_error'
      | 'denied'
      | 'transactional_error'
  } | null
}

export function TreatmentWorkspace({
  memberId,
  debt,
  role,
  canSettle = false,
  canRequestCondonation = false,
  agreementsEnabled = false,
  agreementStates,
  shifts = [],
  lifecycle = [],
  onPayment,
  onReverse,
  onCreateAgreement,
  onReviseAgreement,
  onRecordCommunityWork,
  onRefreshAgreement,
  onRequestCondonation,
  onDecideCondonation,
  onExecuteCondonation,
  executionFeedback,
}: Props) {
  const pending = lifecycle.find((item) => item.state === 'pending')
  const agreementProps = (obligation: DebtDetail['obligations'][number]) => ({
    obligation,
    state: agreementStates[obligation.id] ?? { status: 'idle' as const, active: null },
    onCreate: (draft: AgreementDraft) => onCreateAgreement!(obligation.id, draft),
    ...(onReviseAgreement
      ? {
          onRevise: (id: string, draft: AgreementDraft) =>
            onReviseAgreement(obligation.id, id, draft),
        }
      : {}),
    ...(onRecordCommunityWork
      ? {
          onRecordCommunityWork: (id: string, draft: CommunityWorkDraft) =>
            onRecordCommunityWork(obligation.id, id, draft),
        }
      : {}),
    onRefresh: () => onRefreshAgreement!(obligation.id),
  })
  const agreementsAvailable = agreementsEnabled && onCreateAgreement && onRefreshAgreement
  return (
    <section aria-labelledby="treatment-workspace-title" className="space-y-4">
      <h2 id="treatment-workspace-title" className="text-lg font-semibold">
        Tratamientos de deuda
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="treatment-payment-title"
          className="space-y-3 rounded-lg border p-4"
        >
          <h3 id="treatment-payment-title">Pago</h3>
          <p>El pago reduce la deuda mediante una liquidación confirmada.</p>
          {canSettle && onPayment && onReverse ? (
            <SettlementActions
              debt={debt}
              shifts={shifts}
              onPayment={onPayment}
              onReverse={onReverse}
              headingLevel={4}
            />
          ) : (
            <p role="status">No tenés permiso para registrar pagos ni revertir liquidaciones.</p>
          )}
        </section>
        <section
          aria-labelledby="treatment-community-title"
          className="space-y-3 rounded-lg border p-4"
        >
          <h3 id="treatment-community-title">Trabajo comunitario</h3>
          <p>Solo reduce la deuda después de registrar un comando aceptado.</p>
          {agreementsAvailable ? (
            debt.obligations.map((obligation) => (
              <AgreementActions
                key={obligation.id}
                {...agreementProps(obligation)}
                treatment="community"
              />
            ))
          ) : (
            <p role="status">El flujo de trabajo comunitario no está habilitado.</p>
          )}
        </section>
        <section
          aria-labelledby="treatment-agreement-title"
          className="space-y-3 rounded-lg border p-4"
        >
          <h3 id="treatment-agreement-title">Acuerdo</h3>
          <p>Un acuerdo no reduce la deuda.</p>
          {agreementsAvailable ? (
            debt.obligations.map((obligation) => (
              <AgreementActions
                key={obligation.id}
                {...agreementProps(obligation)}
                treatment="agreement"
              />
            ))
          ) : (
            <p role="status">El flujo de acuerdos no está habilitado.</p>
          )}
        </section>
        <section
          aria-labelledby="treatment-condonation-title"
          className="space-y-3 rounded-lg border p-4"
        >
          <h3 id="treatment-condonation-title">Condonación</h3>
          <p>Solo reduce la deuda después de una ejecución aprobada.</p>
          {canRequestCondonation && onRequestCondonation && (
            <CondonationActions
              memberId={memberId}
              obligations={debt.obligations}
              canDecide={canSettle}
              {...(pending
                ? {
                    request: {
                      id: pending.id,
                      status: 'pending' as const,
                      expires_at: pending.expires_at,
                      decided_at: null,
                    },
                  }
                : {})}
              onRequest={onRequestCondonation}
              {...(onDecideCondonation ? { onDecision: onDecideCondonation } : {})}
              headingLevel={4}
            />
          )}
          {lifecycle.map((item) => (
            <CondonationLifecyclePresenter
              key={item.id}
              lifecycle={item}
              role={role}
              headingLevel={4}
              {...(executionFeedback?.id === item.id
                ? { actionStatus: executionFeedback.status }
                : {})}
              {...(canSettle && onExecuteCondonation
                ? { onExecute: () => onExecuteCondonation(item) }
                : {})}
            />
          ))}
        </section>
      </div>
    </section>
  )
}
