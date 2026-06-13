import { z } from 'zod'
import { operatorRoleSchema } from '../primitives.ts'

/**
 * Operator (admin user) resource schemas.
 *
 * `createOperadorSchema` matches the admin/operators POST contract
 * from PR 3b (TASK-022). The route layer enriches it with the
 * `created_by_operator_id` from `request.operator.sub` before the
 * service layer inserts the row. `updateOperadorSchema` is the
 * PATCH body — every field optional, at least one required (refine).
 *
 * Note: the password rules intentionally differ from the auth-login
 * password rules. Admin-created operators get a longer minimum (12
 * chars) because the admin is choosing a credential for a real
 * human, not typing one in a login form.
 */
export const createOperadorSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/, 'username must be lowercase alnum with . _ -'),
  password: z.string().min(12).max(200),
  role: operatorRoleSchema,
  can_reprint: z.boolean().optional(),
  can_anulate: z.boolean().optional(),
})

export const updateOperadorSchema = z
  .object({
    role: operatorRoleSchema.optional(),
    can_reprint: z.boolean().optional(),
    can_anulate: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be provided' })

export type CreateOperador = z.infer<typeof createOperadorSchema>
export type UpdateOperador = z.infer<typeof updateOperadorSchema>
