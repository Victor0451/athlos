import { defaults } from '../defaults.ts'

/**
 * Insert shape for an `operators` row. The Drizzle table lands in PR 3a
 * (TASK-017 of the auth & RBAC work); for PR 10a the test-builders
 * package ships the builder ahead of the schema so route-handler tests
 * can import `aOperator()` from day one.
 *
 * Once `packages/db/src/schema/operators.ts` ships, replace this with
 * `InferInsertModel<typeof operators>` from `@athlos/db/schema/operators`.
 */
export interface OperatorInsert {
  id: string
  username: string
  passwordHash: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  canReprint: boolean
  canAnulate: boolean
  isActive: boolean
  failedLoginAttempts: number
  lockedUntil: Date | null
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

/**
 * Fluent builder for `operators` rows. Defaults match the auth-login
 * design (TASK-017 / PR 3a) so changing a default here should
 * stay in lockstep with the eventual schema.
 *
 * Example:
 *   const admin = aOperator()
 *     .withUsername('admin-test')
 *     .admin()
 *     .withCanAnulate(true)
 *     .build()
 */
export class OperatorBuilder {
  private readonly data: OperatorInsert

  constructor() {
    this.data = {
      id: defaults.uuid(),
      username: defaults.operator.username,
      passwordHash: defaults.operator.passwordHash,
      role: defaults.operator.role,
      canReprint: defaults.operator.canReprint,
      canAnulate: defaults.operator.canAnulate,
      isActive: defaults.operator.isActive,
      failedLoginAttempts: defaults.operator.failedLoginAttempts,
      lockedUntil: defaults.operator.lockedUntil,
      createdAt: defaults.now(),
      updatedAt: defaults.now(),
      lastLoginAt: null,
    }
  }

  withId(id: string): this {
    this.data.id = id
    return this
  }

  withUsername(u: string): this {
    this.data.username = u
    return this
  }

  withPasswordHash(hash: string): this {
    this.data.passwordHash = hash
    return this
  }

  withRole(role: OperatorInsert['role']): this {
    this.data.role = role
    return this
  }

  admin(): this {
    this.data.role = 'ADMIN'
    return this
  }

  tesorero(): this {
    this.data.role = 'TESORERO'
    return this
  }

  operador(): this {
    this.data.role = 'OPERADOR'
    return this
  }

  consulta(): this {
    this.data.role = 'CONSULTA'
    return this
  }

  withCanReprint(b: boolean): this {
    this.data.canReprint = b
    return this
  }

  withCanAnulate(b: boolean): this {
    this.data.canAnulate = b
    return this
  }

  active(): this {
    this.data.isActive = true
    return this
  }

  inactive(): this {
    this.data.isActive = false
    return this
  }

  withFailedAttempts(n: number): this {
    this.data.failedLoginAttempts = n
    return this
  }

  locked(): this {
    this.data.lockedUntil = new Date(defaults.now().getTime() + 15 * 60_000)
    return this
  }

  build(): OperatorInsert {
    return { ...this.data }
  }
}

export const aOperator = (): OperatorBuilder => new OperatorBuilder()
