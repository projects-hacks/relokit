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

interface DirectionsRoute {
  travel_mode?: string
  duration?: number
  distance?: number
  trips?: { details?: { gps_coordinates?: { latitude?: number; longitude?: number } }[] }[]
}

interface DirectionsBody {
  directions?: DirectionsRoute[]
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
  const matching = [...(parsed.directions ?? []), ...(parsed.durations ?? [])].filter(
    (route): route is DirectionsRoute =>
      route.travel_mode === label && typeof route.duration === 'number',
  )
  const durations = matching.map((route) => route.duration!)

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
  // Google answers twice: alternatives with turn by turn detail, and a summary
  // line per mode carrying only a total. The summary sometimes holds the
  // quickest number and never holds a shape, so the drawn line is the fastest
  // route that has one. It is the same journey by the same mode; where the two
  // disagree it is by a minute, and a line no one can draw is worse than a line
  // drawn from the next best alternative.
  const shape = shapeOf(
    (parsed.directions ?? [])
      .filter((candidate) => candidate.travel_mode === label)
      .sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity))[0],
  )
  // The provider marks manoeuvres, so the shape starts at the first turn and
  // stops at the last one. Drawn as is it floats between two places it never
  // touches; the ends of the journey are known here, so they anchor it.
  const route =
    shape && options.origin && options.destination
      ? [options.origin, ...shape, options.destination]
      : shape
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
      route,
      // The far end of the journey, so the map can name where this number was
      // measured to instead of drawing a line into unlabelled space.
      about:
        options.destination && options.destination_label
          ? {
              label: options.destination_label,
              kind: 'destination' as const,
              point: options.destination,
            }
          : undefined,
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

/**
 * The turn points of a route, in order.
 *
 * Two points describe a straight line and say nothing a connector did not
 * already say, so anything shorter than that is dropped rather than drawn.
 */
function shapeOf(route: DirectionsRoute | undefined): { lat: number; lng: number }[] | undefined {
  const points = (route?.trips ?? [])
    .flatMap((trip) => trip.details ?? [])
    .map((step) => step.gps_coordinates)
    .filter(
      (point): point is { latitude: number; longitude: number } =>
        typeof point?.latitude === 'number' && typeof point?.longitude === 'number',
    )
    .map((point) => ({ lat: point.latitude, lng: point.longitude }))

  return points.length > 2 ? points : undefined
}
