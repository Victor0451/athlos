import type { InferInsertModel } from 'drizzle-orm'
import type { socios } from '@athlos/db/schema'
import { defaults } from '../defaults.ts'

/**
 * Insert shape for a `socios` row. Drizzle's `$inferInsert` makes every
 * column optional, but the schema marks several NOT NULL — we fill those
 * in the builder's constructor so callers don't have to.
 */
type SocioInsert = InferInsertModel<typeof socios>

/**
 * Fluent builder for `socios` rows. Each `withX(...)` returns the
 * builder so chains read top-to-bottom. The terminal `build()` returns
 * a plain object ready to pass to a repository or Drizzle `db.insert()`.
 *
 * Example:
 *   const socio = aSocio()
 *     .withNumeroSocio('0042')
 *     .withNombre('María')
 *     .withDni('33444555')
 *     .inactivo()
 *     .build()
 */
export class SocioBuilder {
  private readonly data: SocioInsert

  constructor() {
    this.data = {
      id: defaults.uuid(),
      numeroSocio: defaults.socio.numeroSocio,
      nombre: defaults.socio.nombre,
      apellido: defaults.socio.apellido,
      dni: defaults.socio.dni,
      fechaAlta: defaults.socio.fechaAlta,
      estado: defaults.socio.estado,
      categoria: defaults.socio.categoria,
      direccion: defaults.socio.direccion,
      telefono: defaults.socio.telefono,
      email: defaults.socio.email,
      createdAt: defaults.now(),
      updatedAt: defaults.now(),
    }
  }

  withId(id: string): this {
    this.data.id = id
    return this
  }

  withNumeroSocio(n: string): this {
    this.data.numeroSocio = n
    return this
  }

  withNombre(n: string): this {
    this.data.nombre = n
    return this
  }

  withApellido(a: string): this {
    this.data.apellido = a
    return this
  }

  withDni(d: string): this {
    this.data.dni = d
    return this
  }

  withFechaAlta(iso: string): this {
    this.data.fechaAlta = iso
    return this
  }

  withCategoria(c: string | null): this {
    this.data.categoria = c
    return this
  }

  withDireccion(d: string | null): this {
    this.data.direccion = d
    return this
  }

  withTelefono(t: string | null): this {
    this.data.telefono = t
    return this
  }

  withEmail(e: string | null): this {
    this.data.email = e
    return this
  }

  activo(): this {
    this.data.estado = 'activo'
    return this
  }

  inactivo(): this {
    this.data.estado = 'baja'
    return this
  }

  suspendido(): this {
    this.data.estado = 'suspendido'
    return this
  }

  softDeleted(): this {
    this.data.estado = 'baja'
    this.data.deletedAt = defaults.now()
    return this
  }

  build(): SocioInsert {
    return { ...this.data }
  }
}

export const aSocio = (): SocioBuilder => new SocioBuilder()
