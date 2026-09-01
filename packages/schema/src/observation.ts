import { z } from 'zod'

/**
 * What one capability actually did in one run, as raw counts. Counts sum
 * exactly across runs; stored ratios would have to be averaged, and a stored
 * zero would be indistinguishable from a default on the way through Xano.
 */
export const ObservationRow = z.object({
  capability_id: z.string(),
  /** Normalized anchor text, e.g. "san jose, ca". Null when no place was named. */
  region: z.string().nullable().default(null),
  answered: z.number().int().nonnegative(),
  decisive: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
})

export type ObservationRow = z.infer<typeof ObservationRow>
