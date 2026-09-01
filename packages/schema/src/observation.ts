import { z } from 'zod'

/**
 * What one capability actually did in one run, as raw counts. Counts sum
 * exactly across runs; stored ratios would have to be averaged, and a stored
 * zero would be indistinguishable from a default on the way through storage.
 *
 * The counts are checked against each other on the way in. Our executor cannot
 * produce a row where more answers were decisive than were given, but these
 * rows are served back to every reader, and one impossible row would divide by
 * a number it was never allowed to be.
 */
export const ObservationRow = z
  .object({
    capability_id: z.string(),
    /**
     * A hash of the place the question named, not the place itself. The rows
     * travel to every reader and the anchor is where somebody lives or works,
     * so what comes back has to be enough to match on and nothing more.
     */
    region: z.string().nullable().default(null),
    answered: z.number().int().nonnegative(),
    decisive: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
  })
  .refine((row) => row.decisive <= row.answered && row.passed <= row.decisive, {
    message: 'an observation counts more settled answers than it was given',
  })

export const ObservationRows = z.array(ObservationRow)

export type ObservationRow = z.infer<typeof ObservationRow>
export type ObservationRows = z.infer<typeof ObservationRows>
