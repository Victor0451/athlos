'use client'

import { useState, type FormEvent } from 'react'
import {
  submitImplementationInquiry,
  type ImplementationInquiry,
} from '@/lib/api/implementation-contact'

const required = ['name', 'organization', 'role', 'email', 'primaryProblem'] as const
const labels: Record<Exclude<keyof ImplementationInquiry, 'website'>, string> = {
  name: 'Nombre',
  organization: 'Organización',
  role: 'Rol',
  email: 'Correo electrónico',
  primaryProblem: 'Problema principal',
  phone: 'Teléfono',
  message: 'Mensaje',
}
const initial = Object.fromEntries(
  Object.keys(labels).map((key) => [key, '']),
) as ImplementationInquiry

export function ImplementationContactForm() {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<string[]>([])
  const [state, setState] = useState<
    'idle' | 'submitting' | 'sent' | 'unavailable' | 'rate-limited'
  >('idle')
  const update = (key: keyof ImplementationInquiry, value: string) =>
    setValues({ ...values, [key]: value })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const missing = required.filter((key) => !values[key].trim())
    const invalidEmail = !/^\S+@\S+\.\S+$/.test(values.email)
    if (missing.length || invalidEmail) {
      setErrors(
        missing
          .map((key) => `${labels[key]} es obligatorio`)
          .concat(
            !missing.includes('email') && invalidEmail
              ? ['El correo electrónico debe tener un formato válido']
              : [],
          ),
      )
      setState('idle')
      return
    }
    setErrors([])
    setState('submitting')
    try {
      const { phone, message, ...requiredValues } = values
      await submitImplementationInquiry({
        ...requiredValues,
        website: String(new FormData(event.currentTarget).get('website') ?? ''),
        ...(phone ? { phone } : {}),
        ...(message ? { message } : {}),
      })
      setState('sent')
    } catch (error) {
      const failure = error as {
        status?: number
        details?: { details?: Array<{ message?: string }> }
      }
      if (failure.status === 400) {
        setErrors(
          failure.details?.details?.map((detail) => detail.message ?? 'Revise este campo') ?? [
            'Revise los campos indicados',
          ],
        )
        setState('idle')
      } else setState(failure.status === 429 ? 'rate-limited' : 'unavailable')
    }
  }
  return (
    <section
      id="implementation-contact"
      className="rounded-lg border border-ink-200 bg-surface p-5 sm:p-6"
    >
      <p className="font-mono text-xs uppercase tracking-widest text-accent">
        Consulta de implementación
      </p>
      <h2 className="mt-2 font-display text-2xl font-bold text-ink-900">
        Comience por el contexto de su organización
      </h2>
      <p className="mt-2 font-body text-sm text-ink-500">
        Cuéntenos qué necesita su club. Responderemos a través del canal de implementación
        configurado.
      </p>
      <form
        noValidate
        onSubmit={submit}
        className="mt-5 grid gap-4 sm:grid-cols-2"
        aria-label="Formulario de consulta de implementación"
      >
        {Object.entries(labels).map(([key, label]) => (
          <label
            key={key}
            className={key === 'primaryProblem' || key === 'message' ? 'sm:col-span-2' : ''}
          >
            <span className="font-body text-sm font-medium text-ink-700">
              {label}
              {required.includes(key as (typeof required)[number]) ? ' *' : ' (opcional)'}
            </span>
            {key === 'primaryProblem' || key === 'message' ? (
              <textarea
                value={values[key as keyof ImplementationInquiry] ?? ''}
                onChange={(e) => update(key as keyof ImplementationInquiry, e.target.value)}
                className="mt-1 min-h-24 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            ) : (
              <input
                type={key === 'email' ? 'email' : 'text'}
                value={values[key as keyof ImplementationInquiry] ?? ''}
                onChange={(e) => update(key as keyof ImplementationInquiry, e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            )}
          </label>
        ))}
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        {errors.map((error) => (
          <p key={error} role="alert" className="sm:col-span-2 text-sm text-danger">
            Error: {error}
          </p>
        ))}
        {state === 'sent' ? (
          <p role="status" className="sm:col-span-2 text-sm text-success">
            Consulta enviada. Nos pondremos en contacto.
          </p>
        ) : state !== 'idle' && state !== 'submitting' ? (
          <p role="alert" className="sm:col-span-2 text-sm text-danger">
            {state === 'rate-limited'
              ? 'Se recibieron demasiadas solicitudes. Intente nuevamente más tarde.'
              : 'No fue posible enviar la consulta. Intente nuevamente.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={state === 'submitting'}
          className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {state === 'submitting' ? 'Enviando consulta…' : 'Enviar consulta'}
        </button>
      </form>
      <p className="mt-5 border-t border-ink-200 pt-4 font-body text-xs text-ink-500">
        Athlos no conserva el contenido de la consulta en su aplicación ni en su base de datos. El
        buzón receptor conserva la consulta hasta que se elimina manualmente.
      </p>
    </section>
  )
}
