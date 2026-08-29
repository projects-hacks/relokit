import type { CommuteConstraint, EvidenceRow, TravelMode } from '@relokit/schema'
import { row, unknownRow, type MapperContext } from './context.ts'

/** Google's own words for a mode, in a URL anyone can open. */
const MODE_URL: Record<TravelMode, string> = {
  drive: 'driving',
  bike: 'bicycling',
  walk: 'walking',
  transit: 'transit',
}

const MODE_LABEL: Record<TravelMode, string> = {
  drive: 'Driving',
  bike: 'Cycling',
  walk: 'Walking',
  transit: 'Transit',
}

interface DirectionsBody {
  directions?: { travel_mode?: string; duration?: number; distance?: number }[]
  durations?: { travel_mode?: string; duration?: number }[]
}

export interface DirectionsOptions {
  entity_id: string
  /** Both ends, so the reader can open the same route and see it for themselves. */
  origin?: { lat: number; lng: number }
  destination?: { lat: number; lng: number }
  destination_label?: string
  /**
   * Set when the answer describes a cluster centroid rather than the listing.
   * Anything inside the slack band is not settled here and goes to the entity
   * tier, because a listing can sit nearer the destination than its centroid.
   */
  slack_seconds?: number
}

/**
 * Google returns route alternatives and the first is not the fastest: from one
 * San Jose building it offers 34 minutes via S Monroe St ahead of 30 via the
 * creek trail. The question is whether the trip can be made in the time allowed,
 * so any route that manages it answers yes and the verdict takes the minimum.
 */
export function mapDirections(
  body: unknown,
  constraint: CommuteConstraint,
  context: MapperContext,
  options: DirectionsOptions,
): EvidenceRow[] {
  const parsed = body as DirectionsBody
  const label = MODE_LABEL[constraint.mode]
  const durations = [...(parsed.directions ?? []), ...(parsed.durations ?? [])]
    .filter((r) => r.travel_mode === label && typeof r.duration === 'number')
    .map((r) => r.duration!)

  if (durations.length === 0) {
    return [
      unknownRow(
        context,
        options.entity_id,
        constraint,
        `no ${constraint.mode} route came back`,
        'failed',
      ),
    ]
  }

  const seconds = Math.min(...durations)
  const slack = options.slack_seconds ?? 0
  const overBySlack = seconds - slack > constraint.max_seconds
  const within = seconds <= constraint.max_seconds

  const verdict = overBySlack ? 'fail' : within ? 'pass' : 'unknown'

  return [
    row(context, {
      entity_id: options.entity_id,
      constraint_id: constraint.id,
      constraint_type: 'commute',
      verdict,
      value_canonical: seconds,
      display_value: `${Math.round(seconds / 60)} min by ${constraint.mode}`,
      // A claim about a journey should be openable. This is the same route, on
      // a map, for anyone who would rather see it than take our word.
      source_url:
        options.origin && options.destination
          ? `https://www.google.com/maps/dir/?api=1&origin=${options.origin.lat},${options.origin.lng}&destination=${options.destination.lat},${options.destination.lng}&travelmode=${MODE_URL[constraint.mode]}`
          : null,
      confidence: slack > 0 ? 0.7 : 1,
      eval_state: 'evaluated',
      // Only where the number alone does not explain itself. A rejection at
      // 42 minutes against a 25 minute limit needs no sentence; a result held
      // back because it was measured from the middle of a neighbourhood does.
      reason:
        verdict === 'unknown'
          ? 'Measured from the middle of the neighbourhood, and close enough to the limit that this home needs checking on its own.'
          : undefined,
    }),
  ]
}
