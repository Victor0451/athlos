'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { CreateSocioInput, Socio, UpdateSocioInput } from '@/lib/api/socios'

/**
 * SocioForm — shared create + edit form (PR 8b.2, 2026-07-02).
 *
 * RHF + Zod, mirroring the backend's `createBodySchema` validation
 * (`apps/api/src/routes/socios.ts:37`). Optional fields are converted
 * to `''` (empty string) in the form state, then dropped from the
 * submit payload — the apiFetch wrapper serialises `undefined` as
 * "not sent", matching the backend's `.optional()` semantics.
 *
 * Reused for:
 *   - Create flow (no `initialValue`)
 *   - Edit flow (pass `initialValue` = existing socio; `numero_socio`
 *     and `fecha_alta` are read-only because the backend marks them
 *     as immutable in `updateBodySchema`)
 *
 * Submit / cancel are controlled by the parent — the form just calls
 * `onSubmit(data)` with a `CreateSocioInput` shape. The parent wraps
 * it in a `useMutation` and feeds back the loading + error state via
 * props (no internal mutation here — keeps the form pure and easy
 * to test).
 */

const socioFormSchema = z.object({
  numero_socio: z.string().min(1, 'Requerido').max(20, 'Máx. 20 caracteres'),
  nombre: z.string().min(1, 'Requerido').max(80, 'Máx. 80 caracteres'),
  apellido: z.string().min(1, 'Requerido').max(80, 'Máx. 80 caracteres'),
  dni: z.string().regex(/^\d{7,8}$/, 'DNI debe tener 7 u 8 dígitos'),
  fecha_alta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe tener formato YYYY-MM-DD'),
  estado: z.enum(['activo', 'suspendido', 'baja']).optional(),
  // Optional fields: accept empty string from `<input>` (which is what
  // browsers send for empty fields) and treat as "not set". `.or(z.literal(''))`
  // lets the form clear a previously-set value without failing validation.
  categoria: z.string().max(40).optional().or(z.literal('')),
  direccion: z.string().max(200).optional().or(z.literal('')),
  telefono: z.string().max(40).optional().or(z.literal('')),
  email: z.string().email('Email inválido').max(120).optional().or(z.literal('')),
})

type SocioFormValues = z.infer<typeof socioFormSchema>

/**
 * Convert a Socio (snake_case wire) → form values. Empty strings for
 * nullable fields so the inputs show empty instead of "null".
 */
function socioToFormValues(socio: Partial<Socio>): SocioFormValues {
  return {
    numero_socio: socio.numero_socio ?? '',
    nombre: socio.nombre ?? '',
    apellido: socio.apellido ?? '',
    dni: socio.dni ?? '',
    fecha_alta: socio.fecha_alta ?? '',
    estado: (socio.estado ?? 'activo') as SocioFormValues['estado'],
    categoria: socio.categoria ?? '',
    direccion: socio.direccion ?? '',
    telefono: socio.telefono ?? '',
    email: socio.email ?? '',
  }
}

/**
 * Convert form values → CreateSocioInput. Strips empty strings for
 * optional fields so the apiFetch wrapper doesn't send `categoria=''`
 * (which the backend's Zod schema rejects via `.max(40)` ... actually
 * accepts empty string, but sending undefined is cleaner).
 */
function formValuesToInput(values: SocioFormValues): CreateSocioInput {
  const input: CreateSocioInput = {
    numero_socio: values.numero_socio,
    nombre: values.nombre,
    apellido: values.apellido,
    dni: values.dni,
    fecha_alta: values.fecha_alta,
  }
  if (values.estado) input.estado = values.estado
  if (values.categoria) input.categoria = values.categoria
  if (values.direccion) input.direccion = values.direccion
  if (values.telefono) input.telefono = values.telefono
  if (values.email) input.email = values.email
  return input
}

/**
 * `formValuesToUpdateInput` — strip the immutable legacy keys
 * (`numero_socio`, `fecha_alta`) before submitting to PATCH. The
 * backend's `updateBodySchema` is `.strict()` so any extra key is
 * a 400 VALIDATION_ERROR; the disabled inputs in the form still come
 * through RHF's value with the pre-filled data, but the server will
 * reject them. Hiding them client-side matches the server contract.
 */
function formValuesToUpdateInput(values: SocioFormValues): UpdateSocioInput {
  const input: UpdateSocioInput = {}
  if (values.nombre) input.nombre = values.nombre
  if (values.apellido) input.apellido = values.apellido
  if (values.dni) input.dni = values.dni
  if (values.estado) input.estado = values.estado
  if (values.categoria) input.categoria = values.categoria
  if (values.direccion) input.direccion = values.direccion
  if (values.telefono) input.telefono = values.telefono
  if (values.email) input.email = values.email
  return input
}

interface SocioFormProps {
  mode: 'create' | 'edit'
  /** Edit mode only. When set, the form is pre-filled and the two
   *  immutable fields (numero_socio, fecha_alta) are read-only. */
  initialValue?: Partial<Socio>
  /**
   * Create mode: receives a full `CreateSocioInput` (with the
   * immutable keys included — POST accepts them).
   * Edit mode: receives an `UpdateSocioInput` (without the
   * immutable keys — PATCH's strict schema would 400 if we sent
   * them). The form's submit handler picks the right helper per
   * `mode`.
   */
  onSubmit: (data: CreateSocioInput | UpdateSocioInput) => void
  onCancel: () => void
  isSubmitting: boolean
  /** Error from the parent (e.g., API 409 CONFLICT on duplicate
   *  numero_socio). Rendered above the submit button. */
  errorMessage?: string | undefined
  /**
   * Hide the default action buttons (Cancel + Submit). When true,
   * the parent renders its own (e.g., inside a sticky modal footer
   * that lives outside the form's scroll container). The form
   * keeps its <form> wrapper so external buttons can use the
   * `form="<id>"` attribute to submit. Default false.
   */
  hideActions?: boolean
}

const inputClass =
  'mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-300'

const labelClass = 'font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500'

const errorClass = 'mt-1 font-body text-xs text-danger'

export default function SocioForm({
  mode,
  initialValue,
  onSubmit,
  onCancel,
  isSubmitting,
  errorMessage,
  hideActions = false,
}: SocioFormProps) {
  const isEdit = mode === 'edit'
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SocioFormValues>({
    resolver: zodResolver(socioFormSchema),
    defaultValues: initialValue ? socioToFormValues(initialValue) : socioToFormValues({}),
    mode: 'onSubmit',
  })

  function onValidSubmit(values: SocioFormValues) {
    if (mode === 'edit') {
      onSubmit(formValuesToUpdateInput(values))
    } else {
      onSubmit(formValuesToInput(values))
    }
  }

  function onInvalidSubmit() {
    // RHF has already populated `errors`; we render them per field.
    // We keep this handler so RHF's `handleSubmit` still blocks the
    // submit when validation fails (otherwise it'd fire `onSubmit`).
    // The first-arg `errors` is typed by RHF as `FieldValues<T>` — we
    // don't need to read it here since the form re-renders with
    // `errors` from `formState` and shows each field's message below.
  }

  return (
    <form
      id={`socio-form-${mode}`}
      onSubmit={handleSubmit(onValidSubmit, onInvalidSubmit)}
      noValidate
      className="space-y-4"
      data-testid={`socio-form-${mode}`}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="socio-form-numero" className={labelClass}>
            N° Socio
          </label>
          <input
            id="socio-form-numero"
            type="text"
            maxLength={20}
            disabled={isEdit}
            aria-invalid={Boolean(errors.numero_socio)}
            aria-describedby={errors.numero_socio ? 'socio-form-numero-err' : undefined}
            className={inputClass}
            data-testid="socio-form-numero"
            {...register('numero_socio')}
          />
          {errors.numero_socio ? (
            <p id="socio-form-numero-err" className={errorClass} role="alert">
              {errors.numero_socio.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-dni" className={labelClass}>
            DNI
          </label>
          <input
            id="socio-form-dni"
            type="text"
            inputMode="numeric"
            maxLength={8}
            aria-invalid={Boolean(errors.dni)}
            aria-describedby={errors.dni ? 'socio-form-dni-err' : undefined}
            className={inputClass}
            data-testid="socio-form-dni"
            {...register('dni')}
          />
          {errors.dni ? (
            <p id="socio-form-dni-err" className={errorClass} role="alert">
              {errors.dni.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-apellido" className={labelClass}>
            Apellido
          </label>
          <input
            id="socio-form-apellido"
            type="text"
            maxLength={80}
            aria-invalid={Boolean(errors.apellido)}
            aria-describedby={errors.apellido ? 'socio-form-apellido-err' : undefined}
            className={inputClass}
            data-testid="socio-form-apellido"
            {...register('apellido')}
          />
          {errors.apellido ? (
            <p id="socio-form-apellido-err" className={errorClass} role="alert">
              {errors.apellido.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-nombre" className={labelClass}>
            Nombre
          </label>
          <input
            id="socio-form-nombre"
            type="text"
            maxLength={80}
            aria-invalid={Boolean(errors.nombre)}
            aria-describedby={errors.nombre ? 'socio-form-nombre-err' : undefined}
            className={inputClass}
            data-testid="socio-form-nombre"
            {...register('nombre')}
          />
          {errors.nombre ? (
            <p id="socio-form-nombre-err" className={errorClass} role="alert">
              {errors.nombre.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-fecha-alta" className={labelClass}>
            Fecha de alta
          </label>
          <input
            id="socio-form-fecha-alta"
            type="date"
            disabled={isEdit}
            aria-invalid={Boolean(errors.fecha_alta)}
            aria-describedby={errors.fecha_alta ? 'socio-form-fecha-alta-err' : undefined}
            className={inputClass}
            data-testid="socio-form-fecha-alta"
            {...register('fecha_alta')}
          />
          {errors.fecha_alta ? (
            <p id="socio-form-fecha-alta-err" className={errorClass} role="alert">
              {errors.fecha_alta.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-estado" className={labelClass}>
            Estado
          </label>
          <select
            id="socio-form-estado"
            aria-invalid={Boolean(errors.estado)}
            className={inputClass}
            data-testid="socio-form-estado"
            {...register('estado')}
          >
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="baja">Baja</option>
          </select>
        </div>

        <div>
          <label htmlFor="socio-form-categoria" className={labelClass}>
            Categoría
          </label>
          <input
            id="socio-form-categoria"
            type="text"
            maxLength={40}
            aria-invalid={Boolean(errors.categoria)}
            aria-describedby={errors.categoria ? 'socio-form-categoria-err' : undefined}
            className={inputClass}
            data-testid="socio-form-categoria"
            {...register('categoria')}
          />
          {errors.categoria ? (
            <p id="socio-form-categoria-err" className={errorClass} role="alert">
              {errors.categoria.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-email" className={labelClass}>
            Email
          </label>
          <input
            id="socio-form-email"
            type="email"
            maxLength={120}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'socio-form-email-err' : undefined}
            className={inputClass}
            data-testid="socio-form-email"
            {...register('email')}
          />
          {errors.email ? (
            <p id="socio-form-email-err" className={errorClass} role="alert">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="socio-form-direccion" className={labelClass}>
            Dirección
          </label>
          <input
            id="socio-form-direccion"
            type="text"
            maxLength={200}
            aria-invalid={Boolean(errors.direccion)}
            aria-describedby={errors.direccion ? 'socio-form-direccion-err' : undefined}
            className={inputClass}
            data-testid="socio-form-direccion"
            {...register('direccion')}
          />
          {errors.direccion ? (
            <p id="socio-form-direccion-err" className={errorClass} role="alert">
              {errors.direccion.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="socio-form-telefono" className={labelClass}>
            Teléfono
          </label>
          <input
            id="socio-form-telefono"
            type="tel"
            maxLength={40}
            aria-invalid={Boolean(errors.telefono)}
            aria-describedby={errors.telefono ? 'socio-form-telefono-err' : undefined}
            className={inputClass}
            data-testid="socio-form-telefono"
            {...register('telefono')}
          />
          {errors.telefono ? (
            <p id="socio-form-telefono-err" className={errorClass} role="alert">
              {errors.telefono.message}
            </p>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-sm text-danger"
          data-testid="socio-form-error"
        >
          {errorMessage}
        </p>
      ) : null}

      {hideActions ? null : (
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="socio-form-cancel"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="socio-form-submit"
          >
            {isSubmitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear socio'}
          </button>
        </div>
      )}
    </form>
  )
}
