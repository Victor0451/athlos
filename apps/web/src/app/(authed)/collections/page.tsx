'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { CurrentUser } from '@/lib/auth'
import { CollectionStatus } from '@/components/collections/CollectionStatus'
import { collectionButtonClass } from '@/components/collections/CollectionPrimitives'
import { DebtPanel } from '@/components/collections/DebtPanel'
import { TreatmentWorkspace } from '@/components/collections/TreatmentWorkspace'
import type { AgreementViewState } from '@/components/collections/AgreementActions'
import type { CommunityWorkDraft } from '@/components/collections/CommunityWorkForm'
import type { AgreementDraft } from '@/components/collections/AgreementForm'
import { CollectionsGenerationWorkspace } from '@/components/collections/CollectionsGenerationWorkspace'
import {
  PricingPanel,
  type DisciplinePanelState,
  type PricingPanelState,
} from '@/components/collections/PricingPanel'
import {
  createCommunityWorkEvidence,
  createDuesPrice,
  createNegotiatedAgreement,
  getDuesPrices,
  getObligationAgreements,
  reviseNegotiatedAgreement,
  revokeDuesPrice,
  DuesOperationError,
  type DebtDetail,
  type DuesPrice,
  type DuesPriceInput,
} from '@/lib/api/dues'
import {
  createCondonationRequest,
  CondonationOperationError,
  decideCondonationRequest,
  executeCondonationRequest,
  listCondonationLifecycle,
  type CondonationDecisionInput,
  type CondonationLifecycle,
  type CondonationRequestInput,
} from '@/lib/api/condonation'
import { getDisciplinas, type DisciplinaOption } from '@/lib/api/padrones'
import { getSocios, type Socio } from '@/lib/api/socios'
import {
  createCollectionsIdempotencyStore,
  type CollectionsIdempotencyStore,
} from '@/lib/collections-idempotency'
import { useFeatureConfig } from '@/lib/features'
import { useAuth } from '@/lib/use-auth'
import { Modal } from '@/components/ui/Modal'
import {
  useCollectionsPayments,
  type DebtSocio,
} from '@/components/collections/useCollectionsPayments'

export function canAccessCollections(
  user: Pick<CurrentUser, 'role'> | null,
  collectionsEnabled: boolean,
) {
  return collectionsEnabled && ['ADMIN', 'TESORERO', 'OPERADOR'].includes(user?.role ?? '')
}

const errorText = (_reason: unknown, fallback: string) => fallback
const pricingErrorText = (reason: unknown) => {
  if (reason instanceof DuesOperationError)
    return reason.kind === 'validation'
      ? 'Revisá los datos y completá todos los campos obligatorios.'
      : reason.message
  if (reason instanceof ApiError) {
    if (reason.status === 409) return 'El intervalo de vigencia se superpone.'
    if (reason.status === 400) return 'Los datos enviados no son válidos.'
  }
  return null
}
const pricingErrorState = (reason: unknown): PricingPanelState =>
  reason instanceof DuesOperationError && reason.kind === 'validation'
    ? 'error'
    : reason instanceof ApiError && reason.status === 409
      ? 'conflict'
      : reason instanceof ApiError && (reason.status === 404 || reason.status >= 500)
        ? 'unavailable'
        : reason instanceof DuesOperationError && reason.kind === 'not_found'
          ? 'unavailable'
          : 'error'

export default function CollectionsPage() {
  const { user } = useAuth()
  const { collectionsEnabled, agreementsEnabled } = useFeatureConfig()
  const [period] = useState(() => new Date().toISOString().slice(0, 7))
  const [activeTab, setActiveTab] = useState<'collections' | 'generation'>('collections')
  const [pricingOpen, setPricingOpen] = useState(false)
  const [prices, setPrices] = useState<DuesPrice[]>([])
  const [pricingState, setPricingState] = useState<PricingPanelState>('loading')
  const [pricingError, setPricingError] = useState('')
  const [disciplines, setDisciplines] = useState<DisciplinaOption[]>([])
  const [disciplineState, setDisciplineState] = useState<DisciplinePanelState>('loading')
  const [disciplineError, setDisciplineError] = useState('')
  const [socios, setSocios] = useState<Socio[]>([])

  const [agreementStates, setAgreementStates] = useState<Record<string, AgreementViewState>>({})
  const [lifecycle, setLifecycle] = useState<CondonationLifecycle[]>([])
  const [lifecycleStatus, setLifecycleStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [executionFeedback, setExecutionFeedback] = useState<{
    id: string
    status:
      | 'idle'
      | 'executing'
      | 'replayed'
      | 'recoverable_error'
      | 'denied'
      | 'transactional_error'
  } | null>(null)
  const idempotency = useRef<CollectionsIdempotencyStore | null>(null)
  const pricingTrigger = useRef<HTMLButtonElement>(null)
  const restorePricingTrigger = useRef(false)
  const selectedMember = useRef<string | null>(null)
  const lifecycleLoad = useRef(0)
  const authorized = canAccessCollections(user, collectionsEnabled)
  const agreementWorkflowEnabled = collectionsEnabled && agreementsEnabled
  const canSettle = user?.role === 'ADMIN' || user?.role === 'TESORERO'
  const {
    debt,
    debtError,
    debtStatus,
    openShiftAvailability,
    openShifts,
    pay,
    refreshDebt,
    refreshPaymentContext,
    reverse,
    selectSocio: selectPaymentSocio,
    selectedSocio,
  } = useCollectionsPayments({ user, idempotency })
  const generationUser =
    user?.role === 'ADMIN' || user?.role === 'TESORERO'
      ? (user as Pick<CurrentUser, 'operator_id'> & { role: 'ADMIN' | 'TESORERO' })
      : null

  const loadPrices = async () => {
    const response = await getDuesPrices(period)
    setPrices(response.items)
    setPricingState(response.items.length ? 'ready' : 'empty')
  }
  const loadDisciplines = async () => {
    const response = await getDisciplinas()
    setDisciplines(response.items)
    setDisciplineState(response.items.length ? 'ready' : 'empty')
  }
  // prettier-ignore
  const agreementFailure = (reason:unknown, active:AgreementViewState['active']=null):AgreementViewState => { if (reason instanceof DuesOperationError) { const failures:Record<DuesOperationError['kind'],[AgreementViewState['status'],string]> = {validation:['error','Los datos del acuerdo no son válidos.'],permission:['permission','No tenés permiso para registrar o modificar acuerdos.'],conflict:['conflict','El acuerdo cambió. Revisá el acuerdo actualizado antes de volver a enviarlo.'],not_found:['unavailable','No se encontró el acuerdo. Actualizá el detalle e intentá nuevamente.'],partial_data:['partial_data','El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.'],unavailable:['unavailable','No se pudo cargar el acuerdo. Intentá nuevamente.']}; const [status,message]=failures[reason.kind]; return {status,active,message} } return {status:'unavailable',active,message:'No se pudo cargar el acuerdo. Intentá nuevamente.'} }
  const loadAgreement = async (obligationId: string) => {
    setAgreementStates((current) => ({
      ...current,
      [obligationId]: {
        status: 'loading',
        active: current[obligationId]?.active ?? null,
        revisions: current[obligationId]?.revisions ?? [],
      },
    }))
    try {
      const lineage = await getObligationAgreements(obligationId)
      setAgreementStates((current) => ({
        ...current,
        [obligationId]: {
          status: 'ready',
          active: lineage.active,
          revisions: lineage.revisions,
        },
      }))
    } catch (reason) {
      setAgreementStates((current) => ({
        ...current,
        [obligationId]: agreementFailure(reason, current[obligationId]?.active ?? null),
      }))
    }
  }
  const loadAgreements = async (detail: DebtDetail) => {
    const openObligations = detail.obligations.filter(({ status }) => status === 'OPEN')
    setAgreementStates(
      Object.fromEntries(
        openObligations.map(({ id }) => [id, { status: 'loading', active: null }]),
      ),
    )
    await Promise.all(openObligations.map(({ id }) => loadAgreement(id)))
  }

  useEffect(() => {
    if (pricingOpen) {
      document.querySelector<HTMLElement>('[role="dialog"] select')?.focus()
      return
    }
    if (restorePricingTrigger.current) {
      pricingTrigger.current?.focus()
      restorePricingTrigger.current = false
    }
  }, [pricingOpen])

  useEffect(() => {
    if (!pricingOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      restorePricingTrigger.current = true
      setPricingOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [pricingOpen])

  const closePricing = () => {
    restorePricingTrigger.current = true
    setPricingOpen(false)
  }

  useEffect(() => {
    if (!authorized) return
    let active = true
    setPricingState('loading')
    setPricingError('')
    void loadPrices().catch((reason: unknown) => {
      if (!active) return
      setPricingError(errorText(reason, 'No se pudieron cargar las cuotas.'))
      setPricingState(pricingErrorState(reason))
    })
    setDisciplineState('loading')
    setDisciplineError('')
    void loadDisciplines().catch((reason: unknown) => {
      if (!active) return
      setDisciplineError(errorText(reason, 'No se pudieron cargar las disciplinas.'))
      setDisciplineState('error')
    })
    return () => {
      active = false
    }
  }, [authorized, period])

  if (!collectionsEnabled)
    return (
      <CollectionStatus tone="error">La cobranza está deshabilitada actualmente.</CollectionStatus>
    )
  if (!authorized)
    return <CollectionStatus tone="error">No tenés permiso para usar la cobranza.</CollectionStatus>

  const runPriceAction = async (action: Promise<unknown>, fallback: string) => {
    setPricingState('loading')
    try {
      await action
      await loadPrices()
      setPricingError('')
      setPricingState('success')
    } catch (reason) {
      setPricingError(pricingErrorText(reason) ?? errorText(reason, fallback))
      setPricingState(pricingErrorState(reason))
      throw reason
    }
  }
  const createPrice = (input: DuesPriceInput) =>
    runPriceAction(
      createDuesPrice(input),
      'No se pudo guardar la cuota. Revisá los datos e intentá nuevamente.',
    )
  const revokePrice = (id: string, reason: string) =>
    runPriceAction(
      revokeDuesPrice(id, reason),
      'No se pudo dar de baja la cuota. Intentá nuevamente.',
    )
  const searchSocios = async (term: string) => {
    if (!term) return setSocios([])
    const result = await getSocios({ search: term, page: 1, limit: 20 })
    setSocios(result.items)
  }
  const selectSocio = async (socio: DebtSocio) => {
    selectedMember.current = socio.id
    setLifecycle([])
    setLifecycleStatus('loading')
    setExecutionFeedback(null)
    void refreshLifecycle(socio.id)
    const result = await selectPaymentSocio(socio)
    if (!result) return
    if (agreementWorkflowEnabled && result.status === 'ready') await loadAgreements(result)
    else setAgreementStates({})
  }
  const refreshLifecycle = async (memberId: string) => {
    if (selectedMember.current !== memberId) return []
    const load = ++lifecycleLoad.current
    setLifecycleStatus('loading')
    try {
      const { items } = await listCondonationLifecycle(memberId)
      if (load !== lifecycleLoad.current || selectedMember.current !== memberId) return []
      setLifecycle(items)
      setLifecycleStatus('ready')
      return items
    } catch {
      if (load === lifecycleLoad.current && selectedMember.current === memberId) {
        setLifecycle([])
        setLifecycleStatus('error')
      }
      return []
    }
  }
  const refreshAgreement = (obligationId: string) => loadAgreement(obligationId)
  const createAgreement = async (obligationId: string, draft: AgreementDraft) => {
    if (!user || !selectedSocio)
      throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = {
      operatorId: user.operator_id,
      action: `agreement-create:${obligationId}`,
      draftFingerprint: JSON.stringify({
        obligationId,
        narrative: draft.narrative.trim(),
        reason: draft.reason.trim(),
      }),
    }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    try {
      const result = await createNegotiatedAgreement(
        {
          socio_id: selectedSocio.id,
          obligation_id: obligationId,
          terms: { narrative: draft.narrative.trim() },
          reason: draft.reason.trim(),
        },
        key,
      )
      idempotency.current.complete(input)
      await loadAgreement(obligationId)
      return { ...result, replayed: result.replayed || replayed }
    } catch (reason) {
      if (reason instanceof DuesOperationError && reason.kind === 'conflict') {
        idempotency.current.abandon(input)
        await loadAgreement(obligationId)
        await refreshDebt()
      }
      throw reason
    }
  }
  const reviseAgreement = async (
    obligationId: string,
    agreementId: string,
    draft: AgreementDraft,
  ) => {
    if (!user || !selectedSocio)
      throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = {
      operatorId: user.operator_id,
      action: `agreement-revise:${agreementId}`,
      draftFingerprint: JSON.stringify({
        obligationId,
        agreementId,
        narrative: draft.narrative.trim(),
        reason: draft.reason.trim(),
      }),
    }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    try {
      const result = await reviseNegotiatedAgreement(
        agreementId,
        { terms: { narrative: draft.narrative.trim() }, reason: draft.reason.trim() },
        key,
      )
      idempotency.current.complete(input)
      await loadAgreement(obligationId)
      return { ...result, replayed: result.replayed || replayed }
    } catch (reason) {
      if (reason instanceof DuesOperationError && reason.kind === 'conflict') {
        idempotency.current.abandon(input)
        await loadAgreement(obligationId)
        await refreshDebt()
      }
      throw reason
    }
  }
  const runSettlementMutation = async <T extends object>(
    action: string,
    draftFingerprint: string,
    request: (key: string) => Promise<T>,
    retainOnConflict = false,
    refresh = refreshDebt,
  ) => {
    if (!user || !selectedSocio)
      throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = { operatorId: user.operator_id, action, draftFingerprint }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    try {
      const result = await request(key)
      if (!(await refresh()))
        throw new DuesOperationError('unavailable', 'Debt refresh unavailable')
      idempotency.current.complete(input)
      return {
        ...result,
        replayed: Boolean((result as { replayed?: boolean }).replayed) || replayed,
      }
    } catch (reason) {
      if (!retainOnConflict && reason instanceof DuesOperationError && reason.kind === 'conflict')
        idempotency.current.abandon(input)
      if (
        action === 'reverse-settlement' &&
        !retainOnConflict &&
        ((reason instanceof ApiError && reason.status === 409) ||
          (reason instanceof DuesOperationError && reason.kind === 'conflict'))
      ) {
        idempotency.current.abandon(input)
        await refreshDebt()
      }
      throw reason
    }
  }
  const createCommunityWork = (
    obligationId: string,
    agreementId: string,
    draft: CommunityWorkDraft,
  ) =>
    runSettlementMutation(
      `community-work:${agreementId}`,
      JSON.stringify({
        obligationId,
        agreementId,
        ...draft,
        evidence: draft.evidence.trim(),
        reason: draft.reason.trim(),
      }),
      (key) =>
        createCommunityWorkEvidence(
          {
            socio_id: selectedSocio!.id,
            obligation_id: obligationId,
            agreement_id: agreementId,
            amount_cents: draft.amountCents,
            evidence: { description: draft.evidence.trim() },
            reason: draft.reason.trim(),
          },
          key,
        ),
    )
  // prettier-ignore
  const condonation = <T extends object>(action: string, draft: object, request: (key: string) => Promise<T>) => {
    if (!user) throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = { operatorId: user.operator_id, action, draftFingerprint: JSON.stringify(draft) }
    const key = idempotency.current.getOrCreate(input)
    return request(key).then((result) => { idempotency.current!.complete(input); return result }).catch((reason) => { if (reason instanceof CondonationOperationError && reason.kind === 'conflict') idempotency.current!.abandon(input); throw reason })
  }
  const requestCondonation = (input: CondonationRequestInput) =>
    condonation('condonation-request', input, (key) => createCondonationRequest(input, key)).then(
      async (result) => {
        await refreshLifecycle(input.member_id)
        return result
      },
    )
  const decideCondonation = (id: string, input: CondonationDecisionInput) =>
    condonation(`condonation-decision:${id}`, input, (key) =>
      decideCondonationRequest(id, input, key),
    ).then(async (result) => {
      if (selectedSocio) await refreshLifecycle(selectedSocio.id)
      return result
    })
  const executeCondonation = async (id: string, executionId: string) => {
    if (!user || !selectedSocio || selectedMember.current !== selectedSocio.id || !canSettle)
      throw new DuesOperationError('permission', 'Authentication required')
    const memberId = selectedSocio.id
    const current = lifecycle.find(
      (item) =>
        item.id === id &&
        item.state === 'approved_awaiting_execution' &&
        item.execution_id === executionId,
    )
    if (!current) throw new CondonationOperationError('conflict')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = {
      operatorId: user.operator_id,
      action: `condonation-execution:${id}`,
      draftFingerprint: executionId,
    }
    const key = idempotency.current.getOrCreate(input)
    const result = await executeCondonationRequest(id, executionId, key)
    const refreshed = await refreshLifecycle(memberId)
    if (
      selectedMember.current !== memberId ||
      !refreshed.some(
        (item) => item.id === id && item.execution_id === executionId && item.state === 'executed',
      )
    )
      throw new CondonationOperationError('unavailable')
    if (!(await refreshDebt()))
      throw new DuesOperationError('unavailable', 'Debt refresh unavailable')
    idempotency.current.complete(input)
    return result
  }
  const presentExecution = async (item: CondonationLifecycle) => {
    setExecutionFeedback({ id: item.id, status: 'executing' })
    try {
      const result = await executeCondonation(item.id, item.execution_id!)
      setExecutionFeedback({
        id: item.id,
        status: result.status === 'replayed' ? 'replayed' : 'idle',
      })
      return result
    } catch (cause) {
      const kind = cause instanceof CondonationOperationError ? cause.kind : 'unavailable'
      setExecutionFeedback({
        id: item.id,
        status:
          kind === 'permission'
            ? 'denied'
            : kind === 'conflict'
              ? 'recoverable_error'
              : 'transactional_error',
      })
      throw cause
    }
  }

  return (
    <main
      aria-labelledby="collections-title"
      className="min-w-0 space-y-8 bg-surface-page p-4 sm:p-6"
    >
      <header className="space-y-2 border-b border-ink-200 pb-6">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Gestión operativa
        </p>
        <h1
          id="collections-title"
          className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl"
        >
          Cobranza
        </h1>
        <p className="max-w-2xl font-body text-sm leading-6 text-ink-500">
          Configurá las cuotas, revisá la generación del período y registrá los pagos desde un único
          lugar.
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
        <div role="tablist" aria-label="Secciones de cobranza" className="flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'collections'}
            onClick={() => setActiveTab('collections')}
            className={
              activeTab === 'collections'
                ? collectionButtonClass.primary
                : collectionButtonClass.secondary
            }
          >
            Cobranza
          </button>
          {generationUser && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'generation'}
              onClick={() => setActiveTab('generation')}
              className={
                activeTab === 'generation'
                  ? collectionButtonClass.primary
                  : collectionButtonClass.secondary
              }
            >
              Generación de deudas
            </button>
          )}
        </div>
        {user?.role === 'ADMIN' && (
          <button
            ref={pricingTrigger}
            type="button"
            onClick={() => setPricingOpen(true)}
            className={collectionButtonClass.secondary}
          >
            Configurar cuotas
          </button>
        )}
      </div>
      {activeTab === 'generation' && generationUser && (
        <CollectionsGenerationWorkspace
          period={period}
          user={generationUser}
          onGoToCollections={() => setActiveTab('collections')}
        />
      )}
      <Modal
        open={pricingOpen && user?.role === 'ADMIN'}
        title="Configuración de cuotas"
        footer={
          <button type="button" onClick={closePricing} className={collectionButtonClass.secondary}>
            Cancelar
          </button>
        }
      >
        <PricingPanel
          prices={prices}
          state={pricingState}
          error={pricingError}
          disciplines={disciplines}
          disciplineState={disciplineState}
          disciplineError={disciplineError}
          onCreate={createPrice}
          onRevoke={revokePrice}
        />
      </Modal>
      {activeTab === 'collections' && (
        <>
          <DebtPanel
            socio={selectedSocio}
            socios={socios}
            status={debtStatus}
            debt={debt}
            error={debtError}
            onSearch={searchSocios}
            onSelectSocio={selectSocio}
          />
          {selectedSocio && debt?.status === 'ready' && (
            <>
              {lifecycleStatus === 'loading' && (
                <p role="status" aria-label="Estado del historial de condonaciones">
                  Cargando historial de condonaciones.
                </p>
              )}
              {lifecycleStatus === 'ready' && !lifecycle.length && (
                <p role="status" aria-label="Estado del historial de condonaciones">
                  No hay solicitudes de condonación para este socio.
                </p>
              )}
              {lifecycleStatus === 'error' && (
                <div role="alert">
                  <p>No se pudo cargar el historial de condonaciones.</p>
                  <button type="button" onClick={() => void refreshLifecycle(selectedSocio.id)}>
                    Reintentar historial de condonaciones
                  </button>
                </div>
              )}
              <TreatmentWorkspace
                memberId={selectedSocio.id}
                debt={debt}
                role={user!.role as 'ADMIN' | 'TESORERO' | 'OPERADOR'}
                canSettle={canSettle}
                canRequestCondonation
                agreementsEnabled={agreementWorkflowEnabled}
                agreementStates={agreementStates}
                shifts={openShifts}
                shiftAvailability={openShiftAvailability}
                lifecycle={lifecycle}
                {...(canSettle ? { onPayment: pay, onReverse: reverse } : {})}
                onRefreshDebt={refreshPaymentContext}
                onCreateAgreement={createAgreement}
                onReviseAgreement={reviseAgreement}
                onRecordCommunityWork={createCommunityWork}
                onRefreshAgreement={refreshAgreement}
                onRequestCondonation={requestCondonation}
                onDecideCondonation={decideCondonation}
                onExecuteCondonation={presentExecution}
                executionFeedback={executionFeedback}
              />
            </>
          )}
        </>
      )}
    </main>
  )
}
