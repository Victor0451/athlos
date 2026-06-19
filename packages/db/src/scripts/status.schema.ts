import { z } from 'zod'

/**
 * Zod schema for the --json output of migrate:status.
 *
 * Shape: { applied: string[], pending: string[], divergence: string[], exitCode: 0|1 }
 *
 * exitCode 2 (connection error) is handled separately by the CLI wrapper and
 * is not part of the normal status schema (connection errors bypass normal output).
 */
export const statusSchema = z.object({
  applied: z.array(z.string()),
  pending: z.array(z.string()),
  divergence: z.array(z.string()),
  exitCode: z.union([z.literal(0), z.literal(1)]),
})

export type StatusOutput = z.infer<typeof statusSchema>
