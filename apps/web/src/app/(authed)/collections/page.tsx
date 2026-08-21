'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { CurrentUser } from '@/lib/auth'
import { CollectionStatus } from '@/components/collections/CollectionStatus'
import { DebtPanel, type DebtPanelStatus } from '@/components/collections/DebtPanel'
import type { AllocationRequest, ReversalRequest } from '@/components/collections/SettlementActions'
import {
  GenerationPanel,
  type GenerationPanelStatus,
} from '@/components/collections/GenerationPanel'
import { PricingPanel, type PricingPanelState } from '@/components/collections/PricingPanel'
import {
  createDuesPrice,
  createDuesSettlement,
  generateDuesAssessments,
  getDebt,
  getDuesPrices,
  revokeDuesPrice,
  reverseDuesSettlement,
  type DebtDetail,
  type DuesPrice,
  type DuesPriceInput,
} from '@/lib/api/dues'
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

const errorText = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback
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
  const { collectionsEnabled } = useFeatureConfig()
  const [period] = useState(() => new Date().toISOString().slice(0, 7))
  const [prices, setPrices] = useState<DuesPrice[]>([])
  const [pricingState, setPricingState] = useState<PricingPanelState>('loading')
  const [pricingError, setPricingError] = useState('')
  const [generationStatus, setGenerationStatus] = useState<GenerationPanelStatus>('idle')
  const [generationError, setGenerationError] = useState('')
  const [socios, setSocios] = useState<Socio[]>([])
  const [selectedSocio, setSelectedSocio] = useState<DebtSocio | null>(null)
  const [debt, setDebt] = useState<DebtDetail | null>(null)
  const [debtStatus, setDebtStatus] = useState<DebtPanelStatus>('idle')
  const [debtError, setDebtError] = useState('')
  const idempotency = useRef<CollectionsIdempotencyStore | null>(null)
  const authorized = canAccessCollections(user, collectionsEnabled)
  const loadPrices = async () => {
    const response = await getDuesPrices(period)
    setPrices(response.items)
    setPricingState(response.items.length ? 'ready' : 'empty')
  }

  useEffect(() => {
    if (!authorized) return
    let active = true
    setPricingState('loading')
    void loadPrices().catch((reason: unknown) => {
      if (!active) return
      setPricingError(errorText(reason, 'Unable to load pricing.'))
      setPricingState(pricingErrorState(reason))
    })
    return () => {
      active = false
    }
  }, [authorized, period])

  if (!collectionsEnabled)
    return <CollectionStatus tone="error">Collections is currently disabled.</CollectionStatus>
  if (!authorized)
    return (
      <CollectionStatus tone="error">
        You do not have permission to use Collections.
      </CollectionStatus>
    )

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
    runPriceAction(createDuesPrice(input), 'Unable to save price.')
  const revokePrice = async (id: string, reason: string) => {
    return runPriceAction(revokeDuesPrice(id, reason), 'Unable to revoke price.')
  }
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
    setGenerationStatus('loading')
    try {
      const result = await generateDuesAssessments(selectedPeriod, key)
      idempotency.current.complete(input)
      setGenerationStatus(replayed ? 'replayed' : result.obligation_ids.length ? 'created' : 'zero')
    } catch (reason) {
      setGenerationError(errorText(reason, 'Unable to generate obligations.'))
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
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        setDebtError('')
        setDebtStatus('not_found')
      } else if (reason instanceof ApiError && reason.status >= 500) {
        setDebtError('Debt detail is unavailable.')
        setDebtStatus('unavailable')
      } else {
        setDebtError(errorText(reason, 'Unable to load debt detail.'))
        setDebtStatus('error')
      }
    }
  }
  // prettier-ignore
  const refreshDebt=async()=>{if(!selectedSocio)return;setDebtStatus('loading');try{const result=await getDebt(selectedSocio.id);setDebt(result);setDebtStatus(result.status)}catch(reason){setDebtError(errorText(reason,'Unable to refresh debt detail.'));setDebtStatus('error')}}
  // prettier-ignore
  const runSettlementMutation=async(action:string,draftFingerprint:string,request:(key:string)=>Promise<unknown>)=>{if(!user||!selectedSocio)return;if(!idempotency.current)idempotency.current=createCollectionsIdempotencyStore();const input={operatorId:user.operator_id,action,draftFingerprint},replayed=Boolean(idempotency.current.peek(input)),key=idempotency.current.getOrCreate(input);try{await request(key);idempotency.current.complete(input);await refreshDebt();return{replayed}}catch(reason){if(reason instanceof ApiError&&reason.status===409){idempotency.current.abandon(input);await refreshDebt()}throw reason}}
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
      reverseDuesSettlement(
        input.settlement_id,
        { allocation_id: input.allocation_id, reason: input.reason },
        key,
      ),
    )

  return (
    <main aria-labelledby="collections-title" className="space-y-6">
      <header>
        <h1 id="collections-title" className="font-display text-2xl font-bold text-ink-900">
          Collections
        </h1>
      </header>
      <section aria-labelledby="collections-workspace-title">
        <h2
          id="collections-workspace-title"
          className="font-display text-lg font-semibold text-ink-900"
        >
          Collections workspace
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {user?.role === 'ADMIN' ? (
            <PricingPanel
              prices={prices}
              state={pricingState}
              error={pricingError}
              onCreate={createPrice}
              onRevoke={revokePrice}
            />
          ) : (
            <section aria-labelledby="pricing-readonly-title">
              <h3 id="pricing-readonly-title">Pricing</h3>
              <p role="status">Pricing administration is available to ADMIN operators only.</p>
            </section>
          )}
          <GenerationPanel
            period={period}
            status={generationStatus}
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
      />
    </main>
  )
}
