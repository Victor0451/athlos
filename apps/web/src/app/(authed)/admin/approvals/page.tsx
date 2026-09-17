'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CondonationLifecycle } from '@/components/collections/CondonationLifecycle'
import { CommunityWorkApprovalLifecycle } from '@/components/collections/CommunityWorkApprovalLifecycle'
import { CommunityWorkDecisionDialog } from '@/components/collections/CommunityWorkDecisionDialog'
import {
  CommunityWorkOperationError,
  listCommunityWorkQueue,
  type CommunityWorkQueueItem,
} from '@/lib/api/community-work-approval'
import {
  CondonationOperationError,
  listCondonationQueue,
  type CondonationQueueItem,
} from '@/lib/api/condonation'
import { CondonationDecisionDialog } from '@/components/collections/CondonationDecisionDialog'
import { useAuth } from '@/lib/use-auth'

const queueButtonClass =
  'min-h-11 rounded-md border border-ink-200 px-4 py-2 font-display text-sm font-semibold text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'
const errorMessage = (error: unknown) => {
  if (error instanceof CondonationOperationError) {
    if (error.kind === 'permission') return 'No tenés permisos para consultar esta bandeja.'
    if (error.kind === 'partial_data')
      return 'La bandeja recibió datos incompletos. Intentá recargarla.'
  }
  return 'No se pudo cargar la bandeja de condonaciones. Intentá nuevamente.'
}

const communityErrorMessage = (error: unknown) => {
  if (error instanceof CommunityWorkOperationError) {
    if (error.kind === 'permission') return 'No tenés permisos para consultar esta bandeja.'
    if (error.kind === 'partial_data')
      return 'La bandeja recibió datos incompletos. Intentá recargarla.'
  }
  return 'No se pudo cargar la bandeja de trabajo comunitario. Intentá nuevamente.'
}

/** The community queue is independent: its own cache, pagination, and errors. */
function CommunityApprovalsQueue({
  operatorId,
  role,
}: {
  operatorId: string
  role: 'ADMIN' | 'TESORERO'
}) {
  const [selected, setSelected] = useState<CommunityWorkQueueItem | null>(null)
  const queue = useInfiniteQuery({
    queryKey: ['community-work-queue', operatorId, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      pageParam === undefined
        ? listCommunityWorkQueue({ view: 'all' })
        : listCommunityWorkQueue({ view: 'all', cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    retry: false,
  })
  const rows = [
    ...new Map(
      queue.data?.pages
        .flatMap((page) => page?.items ?? [])
        .map((item) => [item.id.toLowerCase(), item]),
    ).values(),
  ]
  const denied =
    queue.error instanceof CommunityWorkOperationError && queue.error.kind === 'permission'
  useEffect(() => {
    if (denied) setSelected(null)
  }, [denied])
  const fatalError = queue.isError && (!queue.isFetchNextPageError || denied)
  const refresh = () => {
    void queue.refetch({ cancelRefetch: false })
  }

  return (
    <section
      aria-label="Bandeja de trabajo comunitario"
      className="space-y-4 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink-900">Trabajo comunitario</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={queue.isFetching}
          className={queueButtonClass}
        >
          Refrescar bandeja
        </button>
      </div>
      <p className="text-sm text-ink-500">
        Aprobar y ejecutar conserva la validación del servidor y requiere acciones explícitas. La
        deuda solo cambia con la ejecución confirmada.
      </p>
      {queue.isPending ? (
        <p aria-live="polite">Cargando solicitudes de trabajo comunitario…</p>
      ) : fatalError ? (
        <div role="alert" className="space-y-3">
          <p>{communityErrorMessage(queue.error)}</p>
          <button
            type="button"
            onClick={refresh}
            disabled={queue.isFetching}
            className={queueButtonClass}
          >
            Volver a intentar
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p>No hay solicitudes de trabajo comunitario para revisar.</p>
      ) : (
        <ol className="space-y-4">
          {rows.map((item) => (
            <li
              key={item.id}
              className="min-w-0 space-y-4 border-t border-ink-200 pt-4 [overflow-wrap:anywhere]"
            >
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {item.current_member.nombre} {item.current_member.apellido} · N.º{' '}
                {item.current_member.numero_socio}
              </h3>
              <p className="text-sm text-ink-500">Datos actuales del socio</p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Solicitó</dt>
                  <dd>{item.requester.username}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Contexto</dt>
                  <dd className="whitespace-pre-wrap">{item.context}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Motivo</dt>
                  <dd className="whitespace-pre-wrap">{item.reason}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Evidencia</dt>
                  <dd className="whitespace-pre-wrap">{item.evidence}</dd>
                </div>
              </dl>
              <CommunityWorkApprovalLifecycle lifecycle={item} role={role} headingLevel={4} />
              {item.state === 'pending' &&
                (item.requester.id.toLowerCase() === operatorId.toLowerCase() ? (
                  <p>Otro ADMIN o TESORERO debe decidir esta solicitud que enviaste vos.</p>
                ) : (
                  <button
                    type="button"
                    className={queueButtonClass}
                    onClick={() => setSelected(item)}
                  >
                    Revisar solicitud
                  </button>
                ))}
              {item.state === 'approved_awaiting_execution' &&
                (item.requester.id.toLowerCase() === operatorId.toLowerCase() ? (
                  <p>La persona que aprobó debe ejecutar este trabajo comunitario.</p>
                ) : (
                  <button
                    type="button"
                    className={queueButtonClass}
                    onClick={() => setSelected(item)}
                  >
                    Ejecutar trabajo comunitario
                  </button>
                ))}
            </li>
          ))}
        </ol>
      )}
      {queue.isFetchNextPageError && !fatalError && (
        <p role="alert">{communityErrorMessage(queue.error)}</p>
      )}
      {!fatalError && queue.hasNextPage && (
        <button
          type="button"
          className={queueButtonClass}
          disabled={queue.isFetching}
          onClick={() => void queue.fetchNextPage({ cancelRefetch: false })}
        >
          {queue.isFetchingNextPage
            ? 'Trayendo más…'
            : queue.isFetchNextPageError
              ? 'Reintentar la carga'
              : 'Traer más'}
        </button>
      )}
      {selected && !denied && (
        <CommunityWorkDecisionDialog
          key={selected.id}
          request={selected}
          operatorId={operatorId}
          role={role}
          onClose={() => setSelected(null)}
          onRefresh={refresh}
        />
      )}
    </section>
  )
}

/** The URL is shared with Treasury; generic token details remain ADMIN-only. */
export default function ApprovalsListPage() {
  const { user } = useAuth()
  if (!user?.operator_id || (user.role !== 'ADMIN' && user.role !== 'TESORERO')) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
        <div
          role="alert"
          data-testid="approvals-no-permission"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-1 text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN o TESORERO.
          </p>
        </div>
      </div>
    )
  }
  return (
    <ApprovalsQueue
      key={`${user.operator_id}:${user.role}`}
      operatorId={user.operator_id}
      role={user.role}
    />
  )
}

function ApprovalsQueue({ operatorId, role }: { operatorId: string; role: 'ADMIN' | 'TESORERO' }) {
  const router = useRouter()
  const [tokenInput, setTokenInput] = useState('')
  const [selected, setSelected] = useState<CondonationQueueItem | null>(null)
  const queue = useInfiniteQuery({
    queryKey: ['condonation-queue', operatorId, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      pageParam === undefined
        ? listCondonationQueue({ view: 'all' })
        : listCondonationQueue({ view: 'all', cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    retry: false,
  })
  const rows = [
    ...new Map(
      queue.data?.pages.flatMap((page) => page.items).map((item) => [item.id.toLowerCase(), item]),
    ).values(),
  ]
  const denied =
    queue.error instanceof CondonationOperationError && queue.error.kind === 'permission'
  useEffect(() => {
    if (denied) setSelected(null)
  }, [denied])
  const fatalError = queue.isError && (!queue.isFetchNextPageError || denied)
  const refresh = () => {
    void queue.refetch({ cancelRefetch: false })
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (trimmed.length === 0) return
    router.push(`/admin/approvals/${encodeURIComponent(trimmed)}`)
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
        <p className="mt-1 text-sm text-ink-500">
          Revisá y aplicá condonaciones autorizadas. Consultarlas nunca modifica la deuda.
        </p>
      </header>
      <section
        aria-label="Bandeja de condonaciones"
        className="space-y-4 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink-900">Condonaciones</h2>
          <button
            type="button"
            onClick={refresh}
            disabled={queue.isFetching}
            className={queueButtonClass}
          >
            Actualizar
          </button>
        </div>
        <p className="text-sm text-ink-500">
          Aprobar y aplicar conserva la validación del servidor y requiere una acción explícita. Las
          solicitudes ya aprobadas se pueden recuperar aquí.
        </p>
        {queue.isPending ? (
          <p role="status" aria-live="polite">
            Cargando condonaciones pendientes…
          </p>
        ) : fatalError ? (
          <div role="alert" className="space-y-3">
            <p>{errorMessage(queue.error)}</p>
            <button
              type="button"
              onClick={refresh}
              disabled={queue.isFetching}
              className={queueButtonClass}
            >
              Reintentar
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p>No hay condonaciones para revisar.</p>
        ) : (
          <ol className="space-y-4">
            {rows.map((item) => (
              <li
                key={item.id}
                className="min-w-0 space-y-4 border-t border-ink-200 pt-4 [overflow-wrap:anywhere]"
              >
                <h3 className="font-display text-lg font-semibold text-ink-900">
                  {item.current_member.nombre} {item.current_member.apellido} · N.º{' '}
                  {item.current_member.numero_socio}
                </h3>
                <p className="text-sm text-ink-500">Datos actuales del socio</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Solicitó</dt>
                    <dd>{item.requester.username}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Contexto</dt>
                    <dd className="whitespace-pre-wrap">{item.context}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Motivo</dt>
                    <dd className="whitespace-pre-wrap">{item.reason}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Evidencia</dt>
                    <dd className="whitespace-pre-wrap">{item.evidence}</dd>
                  </div>
                </dl>
                <CondonationLifecycle lifecycle={item} role={role} headingLevel={4} />
                {item.state === 'pending' &&
                  (item.requester.id.toLowerCase() === operatorId.toLowerCase() ? (
                    <p>Otro ADMIN o TESORERO debe decidir esta solicitud que enviaste vos.</p>
                  ) : (
                    <button
                      type="button"
                      className={queueButtonClass}
                      onClick={() => setSelected(item)}
                    >
                      Revisar solicitud
                    </button>
                  ))}
                {item.state === 'approved_awaiting_execution' &&
                  (item.requester.id.toLowerCase() === operatorId.toLowerCase() ? (
                    <p>La persona que aprobó debe aplicar esta condonación.</p>
                  ) : (
                    <button
                      type="button"
                      className={queueButtonClass}
                      onClick={() => setSelected(item)}
                    >
                      Aplicar condonación
                    </button>
                  ))}
              </li>
            ))}
          </ol>
        )}
        {queue.isFetchNextPageError && !fatalError && (
          <p role="alert">{errorMessage(queue.error)}</p>
        )}
        {!fatalError && queue.hasNextPage && (
          <button
            type="button"
            className={queueButtonClass}
            disabled={queue.isFetching}
            onClick={() => void queue.fetchNextPage({ cancelRefetch: false })}
          >
            {queue.isFetchingNextPage
              ? 'Cargando más…'
              : queue.isFetchNextPageError
                ? 'Reintentar cargar más'
                : 'Cargar más'}
          </button>
        )}
      </section>

      {selected && !denied && (
        <CondonationDecisionDialog
          key={selected.id}
          request={selected}
          operatorId={operatorId}
          role={role}
          onClose={() => setSelected(null)}
          onRefresh={refresh}
        />
      )}

      <CommunityApprovalsQueue operatorId={operatorId} role={role} />

      {role === 'ADMIN' && (
        <section
          aria-label="Abrir token específico"
          data-testid="approvals-deeplink"
          className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
        >
          <h2 className="font-display text-base font-semibold text-ink-900">
            Abrir un token específico
          </h2>
          <p className="mt-1 font-body text-sm text-ink-500">
            Si tiene un enlace de aprobación (de WhatsApp o correo electrónico), pegue el token aquí
            para abrir el detalle.
          </p>
          <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor="approvals-token-input" className="sr-only">
              Token de aprobación
            </label>
            <input
              id="approvals-token-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="token…"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              data-testid="approvals-token-input"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 font-mono text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="submit"
              disabled={tokenInput.trim().length === 0}
              data-testid="approvals-token-submit"
              className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Abrir
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
