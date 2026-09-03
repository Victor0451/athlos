'use client'

import { useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { CurrentUser } from '@/lib/auth'
import {
  GenerationPanel,
  type GenerationPanelStatus,
} from '@/components/collections/GenerationPanel'
import {
  createCollectionsIdempotencyStore,
  type CollectionsIdempotencyStore,
} from '@/lib/collections-idempotency'
import {
  DuesOperationError,
  generateDuesAssessments,
  planDuesGeneration,
  type DuesGenerationPlan,
  type DuesGenerationResult,
} from '@/lib/api/dues'

type Props = {
  period: string
  user: Pick<CurrentUser, 'operator_id'> & { role: 'ADMIN' | 'TESORERO' }
  onGoToCollections: () => void
}

export function CollectionsGenerationWorkspace({ period, user, onGoToCollections }: Props) {
  const [generationPlan, setGenerationPlan] = useState<DuesGenerationPlan | null>(null)
  const [generationResult, setGenerationResult] = useState<DuesGenerationResult | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationPanelStatus>('idle')
  const [generationError, setGenerationError] = useState('')
  const idempotency = useRef<CollectionsIdempotencyStore | null>(null)

  const planGeneration = async (rawPeriod: string) => {
    setGenerationStatus('planning')
    setGenerationPlan(null)
    setGenerationResult(null)
    setGenerationError('')
    try {
      const plan = await planDuesGeneration(rawPeriod)
      setGenerationPlan(plan)
      setGenerationStatus('ready')
      return plan
    } catch {
      setGenerationStatus('error')
      setGenerationError('No se pudo revisar la generación del período.')
      return null
    }
  }
  const generateDues = async ({
    period: rawPeriod,
    plan_fingerprint: fingerprint,
  }: {
    period: string
    plan_fingerprint: string
  }) => {
    if (!generationPlan || generationPlan.plan_fingerprint !== fingerprint) return
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = {
      operatorId: user.operator_id,
      action: 'generate-dues',
      draftFingerprint: JSON.stringify({ period: rawPeriod, planFingerprint: fingerprint }),
    }
    const key = idempotency.current.getOrCreate(input)
    setGenerationStatus('generating')
    setGenerationError('')
    try {
      const result = await generateDuesAssessments(rawPeriod, fingerprint, key)
      idempotency.current.complete(input)
      setGenerationResult(result)
      setGenerationStatus('generated')
    } catch (reason) {
      const conflict =
        (reason instanceof DuesOperationError && reason.kind === 'conflict') ||
        (reason instanceof ApiError && reason.status === 409)
      if (!conflict) {
        setGenerationStatus('error')
        setGenerationError('No se pudo generar las deudas. Intentá nuevamente.')
        return
      }
      idempotency.current.abandon(input)
      try {
        const refreshedPlan = await planDuesGeneration(rawPeriod)
        setGenerationPlan(refreshedPlan)
        setGenerationStatus('stale')
        setGenerationError('Los datos cambiaron. Revisá el plan actualizado antes de confirmar.')
      } catch {
        setGenerationPlan(null)
        setGenerationStatus('error')
        setGenerationError('No se pudo actualizar el plan de generación. Intentá nuevamente.')
      }
    }
  }

  return (
    <GenerationPanel
      period={period}
      plan={generationPlan}
      result={generationResult}
      status={generationStatus}
      error={generationError}
      onPlan={planGeneration}
      onGenerate={generateDues}
      onGoToCollections={onGoToCollections}
    />
  )
}
