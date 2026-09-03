import {
  collectionButtonClass,
  collectionInlineStatusClass,
} from '@/components/collections/CollectionPrimitives'
import type { DuesGenerationPlan } from '@/lib/api/dues'

type Props = {
  plan: DuesGenerationPlan
  isGenerating: boolean
  onConfirm: () => void
}

const memberStatus = { READY: 'Lista', REVIEW: 'Requiere revisión', CONFLICT: 'Con conflicto' }
const money = (cents: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(cents / 100)}`

export function GenerationPlanReview({ plan, isGenerating, onConfirm }: Props) {
  const confirmDisabled = !plan.can_generate || plan.summary.conflict_count > 0 || isGenerating

  return (
    <div className="space-y-4 border-t border-ink-200 pt-4">
      <div>
        <h3 className="font-display text-base font-semibold text-ink-900">
          Configuración aplicada
        </h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {plan.configurations.map((configuration, index) => (
            <li
              key={`${configuration.label}-${index}`}
              className="border border-ink-200 p-3 font-body text-sm text-ink-700"
            >
              <strong className="block text-ink-900">{configuration.label}</strong>
              <span>{money(configuration.amount_cents, plan.currency)}</span>
              <span className="block">{configuration.rule}</span>
              <span className="block">{configuration.validity}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de generación">
        <p className="border border-ink-200 p-3 font-body text-sm">
          <strong className="block text-lg">{plan.summary.ready_count}</strong>Listas ·{' '}
          {plan.summary.new_count} nuevas
        </p>
        <p className="border border-ink-200 p-3 font-body text-sm">
          <strong className="block text-lg">
            {money(plan.summary.estimated_new_total_cents, plan.currency)}
          </strong>
          Total estimado
        </p>
        <p className="border border-ink-200 p-3 font-body text-sm">
          <strong className="block text-lg">{plan.summary.review_count}</strong>Para revisar
        </p>
        <p className="border border-ink-200 p-3 font-body text-sm">
          <strong className="block text-lg">{plan.summary.conflict_count}</strong>Con conflicto
        </p>
      </div>
      <details className="border border-ink-200 p-3">
        <summary className="cursor-pointer font-display font-semibold">Ver resultados</summary>
        <ul className="mt-3 space-y-3">
          {plan.members.map((member) => (
            <li
              key={member.member_number}
              className="border-t border-ink-200 pt-3 font-body text-sm text-ink-700"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-ink-900">{member.name}</strong>
                <span>{memberStatus[member.status]}</span>
              </div>
              <p>Socio Nº {member.member_number}</p>
              <p>{member.summary}</p>
              <p>{money(member.net_cents, plan.currency)}</p>
              <ul className="list-disc pl-5">
                {member.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
      {!plan.can_generate && (
        <p role="alert" className={collectionInlineStatusClass('error')}>
          Este plan no puede confirmarse.
        </p>
      )}
      {plan.summary.conflict_count > 0 && (
        <p role="alert" className={collectionInlineStatusClass('error')}>
          Hay conflictos que requieren revisión antes de generar.
        </p>
      )}
      <button
        type="button"
        disabled={confirmDisabled}
        onClick={onConfirm}
        className={collectionButtonClass.primary}
      >
        Confirmar generación
      </button>
    </div>
  )
}
