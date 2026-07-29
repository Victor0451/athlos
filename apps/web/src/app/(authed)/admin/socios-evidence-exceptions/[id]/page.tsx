'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import {
  confirmSociosEvidenceClosure,
  getSociosEvidenceException,
  previewSociosEvidenceClosure,
  resolveSociosEvidenceException,
  searchMemberOptions,
  searchMembershipTypeOptions,
  type EvidenceExceptionKind,
  type ClosurePreview,
} from '@/lib/api/socios-evidence-exceptions'

const KIND: Record<EvidenceExceptionKind, string> = {
  unknown_type: 'Tipo de afiliación sin identificar',
  ambiguous_identity: 'Identidad de socio ambigua',
}

const inputClass =
  'mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent'

export default function SociosEvidenceExceptionDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const client = useQueryClient()
  const [memberSearch, setMemberSearch] = useState('')
  const [typeSearch, setTypeSearch] = useState('')
  const [memberId, setMemberId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [success, setSuccess] = useState(false)
  const [closurePreview, setClosurePreview] = useState<ClosurePreview | null>(null)
  const [closurePending, setClosurePending] = useState(false)
  const [closureMessage, setClosureMessage] = useState<string | null>(null)
  const { user } = useAuth()
  const detail = useQuery({
    queryKey: ['socios-evidence-exception', id],
    queryFn: () => getSociosEvidenceException(id),
    enabled: id.length > 0,
    retry: 0,
  })
  const members = useQuery({
    queryKey: ['socios-evidence-members', memberSearch],
    queryFn: () => searchMemberOptions(memberSearch),
    enabled: memberSearch.trim().length >= 2,
  })
  const types = useQuery({
    queryKey: ['socios-evidence-types', typeSearch],
    queryFn: () => searchMembershipTypeOptions(typeSearch),
    enabled: typeSearch.trim().length >= 2,
  })
  const resolution = useMutation({
    mutationFn: () => {
      const evidence = detail.data!
      const key = crypto.randomUUID() // One opaque key per explicit confirmation attempt.
      return resolveSociosEvidenceException(
        id,
        {
          kind: evidence.kind,
          evidence_fingerprint: evidence.fingerprint,
          reason: reason.trim(),
          selected_member_id: evidence.known_member?.id ?? memberId,
          ...(needsType(evidence.kind, evidence.deterministic_type_candidate_source_row_id)
            ? { selected_type_candidate_source_row_id: typeId }
            : {}),
        },
        key,
      )
    },
    onSuccess: () => {
      setConfirming(false)
      setSuccess(true)
      void client.invalidateQueries({ queryKey: ['socios-evidence-exception', id] })
      void client.invalidateQueries({ queryKey: ['socios-evidence-exceptions'] })
    },
  })

  if (detail.isPending) return <State kind="status" message="Cargando excepción…" />
  if (detail.error instanceof ApiError && detail.error.status === 403)
    return <State kind="alert" message="No tenés permisos para revisar esta excepción." />
  if (detail.isError)
    return (
      <State
        kind="alert"
        message="No se pudo cargar la excepción. Actualizá e intentá nuevamente."
      />
    )
  const evidence = detail.data!
  const requireType = needsType(evidence.kind, evidence.deterministic_type_candidate_source_row_id)
  const knownMember = evidence.known_member
  const complete = (knownMember || memberId) && reason.trim() && (!requireType || typeId)
  const stale = resolution.error instanceof ApiError && resolution.error.status === 409

  async function prepareApplication() {
    if (!evidence.catalog_batch_id) return
    setClosurePending(true)
    setClosureMessage(null)
    try {
      setClosurePreview(
        await previewSociosEvidenceClosure({
          catalogBatchId: evidence.catalog_batch_id,
          sociosBatchId: evidence.socios_batch_id,
        }),
      )
    } catch {
      setClosureMessage(
        'No se pudo preparar la aplicación. Actualizá el detalle e intentá nuevamente.',
      )
    } finally {
      setClosurePending(false)
    }
  }

  async function confirmApplication() {
    if (!closurePreview || !evidence.catalog_batch_id) return
    setClosurePending(true)
    setClosureMessage(null)
    try {
      const { previewId, fingerprint, resolutionSetFingerprint } = closurePreview
      const result = await confirmSociosEvidenceClosure(
        {
          catalogBatchId: evidence.catalog_batch_id,
          sociosBatchId: evidence.socios_batch_id,
          previewId,
          fingerprint,
          resolutionSetFingerprint,
        },
        crypto.randomUUID(),
      )
      setClosurePreview(null)
      setClosureMessage(
        result.status === 'accepted'
          ? `Se programó una nueva ejecución (${result.jobRunId}). La ejecución original no cambió.`
          : result.status === 'replay'
            ? 'Esta confirmación ya fue procesada; no se programó una ejecución duplicada.'
            : result.status === 'cancelled'
              ? 'La confirmación fue cancelada; no se programó una ejecución. Prepará una nueva vista previa.'
              : 'No se programó una ejecución. Actualizá el detalle y prepará una nueva vista previa.',
      )
    } catch {
      setClosurePreview(null)
      setClosureMessage(
        'No se programó una ejecución. Actualizá el detalle y prepará una nueva vista previa.',
      )
    } finally {
      setClosurePending(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/socios-evidence-exceptions"
          className="text-sm text-accent hover:text-accent-hover"
        >
          ← Volver a excepciones
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink-900">Revisar excepción</h1>
      </header>
      <section className="grid gap-4 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-2">
        <Info label="Excepción" value={KIND[evidence.kind]} />
        <Info
          label="Referencia segura"
          value={`Evidencia ${evidence.fingerprint.slice(0, 12)}`}
          mono
        />
        <Info label="Tipo legado" value={evidence.legacy_type_code || 'Sin código informado'} />
        <Info
          label="Estado"
          value={
            evidence.current_resolution?.application_status === 'applied'
              ? 'Resolución aplicada'
              : evidence.status === 'resolved'
                ? 'Resolución registrada; pendiente de aplicación ADMIN'
                : 'Pendiente de resolución'
          }
        />
      </section>
      {success ? (
        <State
          kind="status"
          message="La resolución quedó registrada y está pendiente de aplicación ADMIN. No se reprocesó ningún dato."
        />
      ) : evidence.status === 'resolved' ? (
        <section className="rounded-lg border border-ink-100 bg-surface p-4">
          <p className="text-sm text-ink-700">
            Esta excepción ya tiene una resolución registrada
            {evidence.current_resolution?.application_status === 'applied'
              ? ' y aplicada.'
              : ' y pendiente de aplicación ADMIN.'}
          </p>
          {evidence.current_resolution?.application_status === 'pending_application' ? (
            user?.role === 'ADMIN' && evidence.catalog_batch_id ? (
              <>
                <button
                  type="button"
                  data-testid="prepare-application"
                  disabled={closurePending}
                  onClick={() => void prepareApplication()}
                  className="mt-4 rounded-md bg-night-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closurePending ? 'Preparando…' : 'Preparar aplicación'}
                </button>
                {closureMessage ? (
                  <p role="status" className="mt-3 text-sm text-ink-700">
                    {closureMessage}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-500">Pendiente de aplicación por un ADMIN.</p>
            )
          ) : null}
        </section>
      ) : (
        <section className="rounded-lg border border-ink-100 bg-surface p-4">
          <h2 className="font-display text-lg font-semibold text-ink-900">Registrar resolución</h2>
          <p className="mt-1 text-sm text-ink-500">
            Seleccioná registros existentes. No se muestran datos de origen ni identificadores
            internos.
          </p>
          {knownMember ? (
            <Info
              label="Miembro validado"
              value={`Socio ${knownMember.member_number} · ${knownMember.credential_ref ?? 'Sin credencial'} · ${knownMember.lifecycle_state}`}
            />
          ) : (
            <>
              <label className="mt-4 block text-sm text-ink-700">Miembro existente</label>
              <input
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value)
                  setMemberId('')
                }}
                className={inputClass}
                placeholder="Buscar por número o credencial"
              />
              <Options
                items={members.data?.items ?? []}
                loading={members.isFetching}
                selected={memberId}
                onSelect={setMemberId}
                member
              />
            </>
          )}
          {requireType ? (
            <>
              <label className="mt-4 block text-sm text-ink-700">Tipo de afiliación aplicado</label>
              <input
                value={typeSearch}
                onChange={(e) => {
                  setTypeSearch(e.target.value)
                  setTypeId('')
                }}
                className={inputClass}
                placeholder="Buscar por código, nombre o letra"
              />
              <Options
                items={types.data?.items ?? []}
                loading={types.isFetching}
                selected={typeId}
                onSelect={setTypeId}
              />
            </>
          ) : (
            <p className="mt-4 text-sm text-ink-500">
              El tipo aplicado ya tiene un candidato determinista; no requiere selección.
            </p>
          )}
          <label className="mt-4 block text-sm text-ink-700">Motivo</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            className={inputClass}
            placeholder="Explicá brevemente la verificación realizada."
          />
          <button
            type="button"
            disabled={!complete || resolution.isPending}
            onClick={() => setConfirming(true)}
            className="mt-4 rounded-md bg-night-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Registrar resolución
          </button>
          {stale ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              La evidencia cambió o ya fue resuelta. Actualizá el detalle antes de intentar
              nuevamente.
            </p>
          ) : null}
          {resolution.isError && !stale ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              No se pudo registrar la resolución. Revisá los datos e intentá nuevamente.
            </p>
          ) : null}
        </section>
      )}
      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-6">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Confirmar resolución
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              Se registrará la selección para aplicación ADMIN posterior. No reprocesa datos.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={resolution.isPending}
                className="rounded-md border border-ink-200 px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => resolution.mutate()}
                disabled={resolution.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
              >
                {resolution.isPending ? 'Registrando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {closurePreview ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-6">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Confirmar aplicación
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              Se programará una nueva ejecución; la ejecución original no cambia.
            </p>
            <dl className="mt-4 space-y-2 text-sm text-ink-700">
              <Info label="Lote Socios" value={evidence.socios_batch_id} mono />
              <Info label="Lote catálogo" value={evidence.catalog_batch_id!} mono />
              <Info label="Registros Socios" value={String(closurePreview.counts.socios)} />
              <Info label="Registros catálogo" value={String(closurePreview.counts.catalog)} />
              <Info label="Resoluciones" value={String(closurePreview.counts.resolutions)} />
            </dl>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={closurePending}
                onClick={() => setClosurePreview(null)}
                className="rounded-md border border-ink-200 px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="confirm-application"
                disabled={closurePending}
                onClick={() => void confirmApplication()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
              >
                {closurePending ? 'Confirmando…' : 'Confirmar aplicación'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function needsType(kind: EvidenceExceptionKind, candidate: string | null) {
  return kind === 'unknown_type' || candidate === null
}
function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">{label}</dt>
      <dd className={`mt-1 text-sm text-ink-900 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}
function State({ kind, message }: { kind: 'status' | 'alert'; message: string }) {
  return (
    <div
      role={kind}
      className="rounded-lg border border-ink-100 bg-surface p-6 text-center text-sm text-ink-700"
    >
      {message}
    </div>
  )
}
function Options({
  items,
  loading,
  selected,
  onSelect,
  member = false,
}: {
  items: Array<{
    id?: string
    source_row_id?: string
    member_number?: number
    credential_ref?: string | null
    lifecycle_state?: string
    code?: string
    name?: string
    letter?: string | null
  }>
  loading: boolean
  selected: string
  onSelect: (id: string) => void
  member?: boolean
}) {
  if (loading) return <p className="mt-2 text-sm text-ink-500">Buscando…</p>
  return (
    <div className="mt-2 space-y-1">
      {items.map((item) => {
        const id = member ? item.id! : item.source_row_id!
        const label = member
          ? `Socio ${item.member_number} · ${item.credential_ref ?? 'Sin credencial'} · ${item.lifecycle_state}`
          : `${item.code} · ${item.name} · ${item.letter ?? 'Sin letra'}`
        return (
          <button
            type="button"
            key={id}
            onClick={() => onSelect(id)}
            className={`block w-full rounded border px-3 py-2 text-left text-sm ${selected === id ? 'border-accent bg-accent/10' : 'border-ink-100'}`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
