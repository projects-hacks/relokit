import { z } from 'zod'
import { GeoPoint } from './units.ts'
import { ConstraintType } from './constraints.ts'
import { Provider } from './capability.ts'

export const Verdict = z.enum(['pass', 'fail', 'unknown'])

/**
 * Orthogonal to verdict. `failed` means we tried and the provider did not answer;
 * `skipped` means we never tried, usually because the field was absent or the
 * budget ran out.
 */
export const EvalState = z.enum(['evaluated', 'failed', 'skipped'])

/**
 * One fact about one entity, with its source and its expiry.
 *
 * The governing rule: an error can never reject a listing. Rejection requires
 * verdict 'fail' AND eval_state 'evaluated' on a hard constraint. Anything with
 * eval_state 'failed' goes to the unverified bucket.
 */
export const EvidenceRow = z.object({
  entity_id: z.string(),
  constraint_id: z.string(),
  constraint_type: ConstraintType,
  verdict: Verdict,
  /** Canonical units. Cents, seconds, meters. */
  value_canonical: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  /** Upper bound when the source gives a range, such as a multi-unit price band. */
  value_canonical_upper: z.number().optional(),
  /** Formatted for display. Never parsed back. */
  display_value: z.string(),
  source: Provider,
  source_url: z.string().nullable(),
  fetched_at_ms: z.number().int().positive(),
  ttl_seconds: z.number().int().positive(),
  /** Stored rather than computed so the ledger read-through can index on it. */
  expires_at_ms: z.number().int().positive(),
  /** Below 1 when the value was inferred rather than read directly. */
  confidence: z.number().min(0).max(1),
  eval_state: EvalState,
  /** Attribution back into the plan. The difference between a five minute and a
   * forty minute answer to "why was this rejected". */
  capability_id: z.string(),
  op_id: z.string(),
  /** Human readable, shown on the rejection card. */
  reason: z.string().optional(),
  /**
   * The place this fact is about, when it is about one.
   *
   * "0.4 mi to FNS Training Center" is a claim about somewhere, and until this
   * existed the somewhere was thrown away as soon as the distance was measured.
   * It is what lets a map show the gym rather than only the home.
   */
  about: z
    .object({
      label: z.string(),
      /**
       * destination  somewhere the journey ends
       * near         a place named in the question to be close to
       * poi          a kind of place that had to be found nearby
       * area         the place searched around
       *
       * They look alike on a map and mean different things, and one label over
       * all of them told people they were travelling to a supermarket they had
       * only asked to live near.
       */
      kind: z.enum(['destination', 'near', 'poi', 'area']),
      point: GeoPoint,
    })
    .optional(),
  /**
   * The way the journey actually goes, as the turn points the provider returned.
   *
   * A straight line between two places is not the trip, and drawing one invites
   * the reader to judge a distance nobody would travel. This is one point per
   * manoeuvre rather than a road-traced path, so it cuts corners, but it follows
   * the streets that produced the number beside it.
   */
  route: z.array(GeoPoint).optional(),
})

export type Verdict = z.infer<typeof Verdict>
export type EvalState = z.infer<typeof EvalState>
export type EvidenceRow = z.infer<typeof EvidenceRow>
