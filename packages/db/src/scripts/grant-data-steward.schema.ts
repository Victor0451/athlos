import { z } from 'zod'

/**
 * Zod schema for the --json output of grant-data-steward.
 *
 * Shape: { granted: uuid[], alreadyGranted: uuid[], auditIds: uuid[] }
 *
 * All UUIDs validated with z.string().uuid().
 */
export const grantDataStewardOutputSchema = z.object({
  granted: z.array(z.string().uuid()),
  alreadyGranted: z.array(z.string().uuid()),
  auditIds: z.array(z.string().uuid()),
})

export type GrantDataStewardOutput = z.infer<typeof grantDataStewardOutputSchema>
