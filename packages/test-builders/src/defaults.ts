import { randomUUID } from 'node:crypto'

/**
 * Deterministic defaults for every entity builder. Builders clone these
 * defaults on construction, so tests can call `.withX(...)` to override
 * only the fields they care about — the rest stays predictable across
 * runs and across test files.
 *
 * The `uuid()` and `now()` helpers use a *fixed* seed value (NOT
 * `randomUUID` / `new Date()`) so the same call site produces the same
 * output across runs. Tests that need fresh values call
 * `defaults.freshUuid()` / `defaults.freshNow()`.
 */
export const defaults = {
  /** Fixed UUID for reproducible test runs. */
  uuid: (): string => '00000000-0000-4000-8000-000000000001',

  /** A second fixed UUID, useful for FK references. */
  uuidB: (): string => '00000000-0000-4000-8000-000000000002',

  /** Fresh UUID for tests that explicitly need uniqueness. */
  freshUuid: (): string => randomUUID(),

  /** Fixed timestamp (Unix epoch in ms). */
  now: (): Date => new Date('2024-01-01T00:00:00.000Z'),

  /** Current time for tests that want a moving reference. */
  freshNow: (): Date => new Date(),

  socio: {
    numeroSocio: '0001',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '12345678',
    fechaAlta: '2024-01-01',
    estado: 'activo' as const,
    categoria: null,
    direccion: null,
    telefono: null,
    email: null,
  },

  operator: {
    username: 'op-test',
    /** bcrypt cost-12 hash of 'changeme'; rebuilt in PR 3a when login lands. */
    passwordHash: '$2b$12$placeholderplaceholderplaceholderplaceholder',
    role: 'OPERADOR' as const,
    canReprint: false,
    canAnulate: false,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
  },

  auditEvent: {
    action: 'SOCIO_UPDATED',
    entityType: 'socio',
    entityId: '00000000-0000-4000-8000-000000000001',
    oldValue: null,
    newValue: null,
    sourceIp: null,
    metadata: null,
    idempotencyKey: null,
  },
} as const
