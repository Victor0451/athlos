'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { CurrentUser } from '@/lib/auth'
import { CollectionStatus } from '@/components/collections/CollectionStatus'
import { DebtPanel, type DebtPanelStatus } from '@/components/collections/DebtPanel'
import type { AgreementViewState } from '@/components/collections/AgreementActions'
import type { CommunityWorkDraft } from '@/components/collections/CommunityWorkForm'
import type { AgreementDraft } from '@/components/collections/AgreementForm'
import type { AllocationRequest, ReversalRequest } from '@/components/collections/SettlementActions'
import {
  GenerationPanel,
  type GenerationPanelStatus,
} from '@/components/collections/GenerationPanel'
import {
  PricingPanel,
  type DisciplinePanelState,
  type PricingPanelState,
} from '@/components/collections/PricingPanel'
import {
  createCommunityWorkEvidence,
  createDuesPrice,
  createDuesSettlement,
  createNegotiatedAgreement,
  generateDuesAssessments,
  getDebt,
  getDuesPrices,
  getObligationAgreements,
  reviseNegotiatedAgreement,
  revokeDuesPrice,
  reverseDuesSettlement,
  DuesOperationError,
  type DebtDetail,
  type DuesGenerationResult,
  type DuesPrice,
  type DuesPriceInput,
} from '@/lib/api/dues'
import { getDisciplinas, type DisciplinaOption } from '@/lib/api/padrones'
import { getSocios, type Socio } from '@/lib/api/socios'
import {
  createCollectionsIdempotencyStore,
  type CollectionsIdempotencyStore,
} from '@/lib/collections-idempotency'
import { useFeatureConfig } from '@/lib/features'
import { useAuth } from '@/lib/use-auth'

type DebtSocio = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>

export function canAccessCollections(
  user: Pick<CurrentUser, 'role'> | null,
  collectionsEnabled: boolean,
) {
  return collectionsEnabled && (user?.role === 'ADMIN' || user?.role === 'TESORERO')
}

const errorText = (_reason: unknown, fallback: string) => fallback
const pricingErrorState = (reason: unknown): PricingPanelState =>
  reason instanceof ApiError && reason.status === 409
    ? 'conflict'
    : reason instanceof ApiError && (reason.status === 404 || reason.status >= 500)
      ? 'unavailable'
      : 'error'
const generationErrorState = (reason: unknown): GenerationPanelStatus =>
  reason instanceof ApiError && reason.status === 409 ? 'conflict' : 'error'

export default function CollectionsPage() {
  const { user } = useAuth()
  const { collectionsEnabled, agreementsEnabled } = useFeatureConfig()
  const [period] = useState(() => new Date().toISOString().slice(0, 7))
  const [prices, setPrices] = useState<DuesPrice[]>([])
  const [pricingState, setPricingState] = useState<PricingPanelState>('loading')
  const [pricingError, setPricingError] = useState('')
  const [disciplines, setDisciplines] = useState<DisciplinaOption[]>([])
  const [disciplineState, setDisciplineState] = useState<DisciplinePanelState>('loading')
  const [disciplineError, setDisciplineError] = useState('')
  const [generationStatus, setGenerationStatus] = useState<GenerationPanelStatus>('idle')
  const [generationError, setGenerationError] = useState('')
  const [generationResult, setGenerationResult] = useState<DuesGenerationResult | null>(null)
  const [socios, setSocios] = useState<Socio[]>([])
  const [selectedSocio, setSelectedSocio] = useState<DebtSocio | null>(null)
  const [debt, setDebt] = useState<DebtDetail | null>(null)
  const [debtStatus, setDebtStatus] = useState<DebtPanelStatus>('idle')
  const [debtError, setDebtError] = useState('')
  const [agreementStates, setAgreementStates] = useState<Record<string, AgreementViewState>>({})
  const idempotency = useRef<CollectionsIdempotencyStore | null>(null)
  const authorized = canAccessCollections(user, collectionsEnabled)
  const agreementWorkflowEnabled = collectionsEnabled && agreementsEnabled

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
      setPricingError(errorText(reason, fallback))
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
  const generate = async (selectedPeriod: string) => {
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = {
      operatorId: user!.operator_id,
      action: 'generate-assessments',
      draftFingerprint: `period:${selectedPeriod}`,
    }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    setGenerationError('')
    setGenerationResult(null)
    setGenerationStatus('loading')
    try {
      const result = await generateDuesAssessments(selectedPeriod, key)
      idempotency.current.complete(input)
      setGenerationResult(result)
      setGenerationStatus(replayed ? 'replayed' : result.obligation_ids.length ? 'created' : 'zero')
    } catch (reason) {
      setGenerationError(
        errorText(reason, 'No se pudieron generar las deudas del período. Intentá nuevamente.'),
      )
      setGenerationStatus(generationErrorState(reason))
      throw reason
    }
  }
  const searchSocios = async (term: string) => {
    if (!term) return setSocios([])
    const result = await getSocios({ search: term, page: 1, limit: 20 })
    setSocios(result.items)
  }
  const selectSocio = async (socio: DebtSocio) => {
    setSelectedSocio(socio)
    setDebt(null)
    setDebtError('')
    setDebtStatus('loading')
    try {
      const result = await getDebt(socio.id)
      setDebt(result)
      setDebtStatus(result.status)
      if (agreementWorkflowEnabled && result.status === 'ready') await loadAgreements(result)
      else setAgreementStates({})
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        setDebtError('No se encontró el detalle de deuda de este socio.')
        setDebtStatus('not_found')
      } else if (reason instanceof ApiError && reason.status >= 500) {
        setDebtError('El detalle de deuda no está disponible.')
        setDebtStatus('unavailable')
      } else {
        setDebtError(errorText(reason, 'No se pudo cargar el detalle de deuda.'))
        setDebtStatus('error')
      }
    }
  }
  // prettier-ignore
  const refreshDebt=async()=>{if(!selectedSocio)return false;setDebtStatus('loading');try{const result=await getDebt(selectedSocio.id);setDebt(result);setDebtStatus(result.status);setDebtError('');return true}catch(reason){setDebtError(errorText(reason,'No se pudo actualizar el detalle de deuda.'));setDebtStatus('error');return false}}
  // prettier-ignore
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
  ) => {
    if (!user || !selectedSocio)
      throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = { operatorId: user.operator_id, action, draftFingerprint }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    try {
      const result = await request(key)
      idempotency.current.complete(input)
      if (!(await refreshDebt()))
        throw new DuesOperationError('unavailable', 'Debt refresh unavailable')
      return {
        ...result,
        replayed: Boolean((result as { replayed?: boolean }).replayed) || replayed,
      }
    } catch (reason) {
      if (reason instanceof DuesOperationError && reason.kind === 'conflict')
        idempotency.current.abandon(input)
      if (reason instanceof ApiError && reason.status === 409) {
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
  const allocate = (input: AllocationRequest) =>
    runSettlementMutation('allocate-settlement', JSON.stringify(input), (key) =>
      createDuesSettlement(
        {
          socio_id: selectedSocio!.id,
          kind: 'MONETARY',
          currency: debt?.currency ?? 'ARS',
          ...input,
        },
        key,
      ),
    )
  const reverse = (input: ReversalRequest) =>
    runSettlementMutation('reverse-settlement', JSON.stringify(input), (key) =>
      reverseDuesSettlement(input.settlement_id, { reason: input.reason }, key),
    )

  return (
    <main aria-labelledby="collections-title" className="space-y-6">
      <header>
        <h1 id="collections-title" className="font-display text-2xl font-bold text-ink-900">
          Cobranza
        </h1>
      </header>
      <section aria-labelledby="collections-workspace-title">
        <h2
          id="collections-workspace-title"
          className="font-display text-lg font-semibold text-ink-900"
        >
          Espacio de trabajo de cobranzas
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {user?.role === 'ADMIN' ? (
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
          ) : (
            <section aria-labelledby="pricing-readonly-title">
              <h3 id="pricing-readonly-title">Configuración de cuotas</h3>
              <p role="status">
                La administración de cuotas está disponible solo para operadores ADMIN.
              </p>
            </section>
          )}
          <GenerationPanel
            period={period}
            status={generationStatus}
            result={generationResult}
            error={generationError}
            onGenerate={generate}
          />
        </div>
      </section>
      <DebtPanel
        socio={selectedSocio}
        socios={socios}
        status={debtStatus}
        debt={debt}
        error={debtError}
        onSearch={searchSocios}
        onSelectSocio={selectSocio}
        onAllocate={allocate}
        onReverse={reverse}
        agreementsEnabled={agreementWorkflowEnabled}
        agreementStates={agreementStates}
        onCreateAgreement={createAgreement}
        onReviseAgreement={reviseAgreement}
        onRecordCommunityWork={createCommunityWork}
        onRefreshAgreement={refreshAgreement}
      />
    </main>
  )
}
