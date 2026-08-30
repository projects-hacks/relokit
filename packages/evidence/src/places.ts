import type {
  AreaSignalConstraint,
  EvidenceRow,
  GeoPoint,
  NearbyPoiConstraint,
  Weekday,
} from '@relokit/schema'
import { row, unknownRow, type MapperContext } from './context.ts'
import { distanceMeters, formatDistance } from './distance.ts'
import { parseOperatingHours, satisfiesWindow } from './hours.ts'

interface LocalResult {
  title?: string
  gps_coordinates?: { latitude: number; longitude: number }
  operating_hours?: Record<string, unknown>
  hours?: string
  rating?: number
  place_id?: string
}

export interface PlacesOptions {
  entity_id: string
  /** Where the radius is measured from: the listing, or a cluster centroid. */
  origin: GeoPoint
  /** Cluster radius, in meters, when the origin is a centroid rather than a listing. */
  slack_meters?: number
  /** Days to judge the opening window against when the constraint names none. */
  evaluation_days: Weekday[]
}

/**
 * Nearby places, from google_maps with type=search.
 *
 * A place has to be close enough and open at the right time. Distance is
 * straight line, which flatters everything slightly, so radii are meant to
 * overshoot. Hours come back per weekday and a string that will not parse is
 * reported as unknown rather than counted as shut.
 */
export function mapNearbyPlaces(
  body: unknown,
  constraint: NearbyPoiConstraint,
  context: MapperContext,
  options: PlacesOptions,
): EvidenceRow[] {
  const results = (body as { local_results?: LocalResult[] }).local_results ?? []
  const slack = options.slack_meters ?? 0

  const withDistance = results
    .filter((r) => r.gps_coordinates)
    .map((r) => ({
      result: r,
      meters: distanceMeters(options.origin, {
        lat: r.gps_coordinates!.latitude,
        lng: r.gps_coordinates!.longitude,
      }),
    }))
    .filter((r) => r.meters <= constraint.radius_m + slack)
    .sort((a, b) => a.meters - b.meters)

  if (withDistance.length === 0) {
    return [
      row(context, {
        entity_id: options.entity_id,
        constraint_id: constraint.id,
        constraint_type: 'nearby_poi',
        verdict: 'fail',
        value_canonical: null,
        display_value: `no ${constraint.category} within ${formatDistance(constraint.radius_m, context.distance_unit)}`,
        source_url: null,
        confidence: slack > 0 ? 0.7 : 1,
        eval_state: 'evaluated',
        reason:
          slack > 0
            ? 'Measured from the middle of the neighbourhood rather than from this address.'
            : undefined,
      }),
    ]
  }

  // A place inside the radius only counts if it is also open when it is wanted.
  const qualifying: {
    title: string
    meters: number
    hours: string
    place_id?: string
    point: GeoPoint
  }[] = []
  let sawUnknownHours = false

  for (const { result, meters } of withDistance) {
    if (constraint.min_rating !== undefined && (result.rating ?? 0) < constraint.min_rating) {
      continue
    }
    if (!constraint.open_window) {
      qualifying.push({
        title: result.title ?? 'unnamed',
        meters,
        hours: result.hours ?? '',
        point: { lat: result.gps_coordinates!.latitude, lng: result.gps_coordinates!.longitude },
        ...(result.place_id ? { place_id: result.place_id } : {}),
      })
      continue
    }
    const parsed = parseOperatingHours(result.operating_hours)
    const verdict = satisfiesWindow(parsed, constraint.open_window, options.evaluation_days)
    if (verdict === 'pass') {
      qualifying.push({
        title: result.title ?? 'unnamed',
        meters,
        hours: result.hours ?? '',
        point: { lat: result.gps_coordinates!.latitude, lng: result.gps_coordinates!.longitude },
        ...(result.place_id ? { place_id: result.place_id } : {}),
      })
    } else if (verdict === 'unknown') {
      sawUnknownHours = true
    }
  }

  const nearest = qualifying[0]
  const enough = qualifying.length >= constraint.min_count

  if (enough && nearest) {
    const outsideRadius = nearest.meters > constraint.radius_m
    return [
      row(context, {
        entity_id: options.entity_id,
        constraint_id: constraint.id,
        constraint_type: 'nearby_poi',
        // Inside the slack band but outside the radius proper is not settled
        // here. The listing is nearer or further than its centroid.
        verdict: outsideRadius ? 'unknown' : 'pass',
        value_canonical: nearest.meters,
        display_value: `${formatDistance(nearest.meters, context.distance_unit)} to ${nearest.title}`,
        // The place itself, so its hours and reviews can be read rather than
        // taken on trust.
        source_url: placeUrl(nearest.title, nearest.place_id),
        about: { label: nearest.title, kind: 'poi', point: nearest.point },
        confidence: slack > 0 ? 0.7 : 1,
        eval_state: 'evaluated',
        reason: outsideRadius
          ? 'Just outside, and measured from the middle of the neighbourhood rather than from this address.'
          : undefined,
      }),
    ]
  }

  if (sawUnknownHours) {
    return [
      unknownRow(
        context,
        options.entity_id,
        constraint,
        `found a ${constraint.category} nearby but could not read its opening hours`,
        'evaluated',
      ),
    ]
  }

  return [
    row(context, {
      entity_id: options.entity_id,
      constraint_id: constraint.id,
      constraint_type: 'nearby_poi',
      verdict: 'fail',
      value_canonical: withDistance[0]!.meters,
      display_value: `nearest ${constraint.category} is not open when you need it`,
      source_url: null,
      confidence: slack > 0 ? 0.7 : 1,
      eval_state: 'evaluated',
    }),
  ]
}

/**
 * The geocode is a binding rather than a fact, so it produces a point and no
 * evidence.
 *
 * People name places loosely. "2788 San Tomas Expressway" and "Santa Clara, CA"
 * both come back as a single place; "NVIDIA office" comes back as a list of
 * businesses, because that is a search rather than an address. Reading only the
 * single place meant a question naming a workplace produced no point, no search
 * bounds, and no results at all, without saying so.
 */
function placeUrl(title: string, placeId?: string): string {
  const query = encodeURIComponent(title)
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`
}

export function mapGeocode(body: unknown): { point: GeoPoint; title: string } | null {
  const parsed = body as {
    place_results?: { title?: string; gps_coordinates?: { latitude: number; longitude: number } }
    local_results?: { title?: string; gps_coordinates?: { latitude: number; longitude: number } }[]
  }

  const place = parsed.place_results
  if (place?.gps_coordinates) {
    return {
      point: { lat: place.gps_coordinates.latitude, lng: place.gps_coordinates.longitude },
      title: place.title ?? '',
    }
  }

  // The best match of a search. Not as exact as an address, and better than
  // refusing to answer where someone works.
  const first = parsed.local_results?.find((result) => result.gps_coordinates)
  if (first?.gps_coordinates) {
    return {
      point: { lat: first.gps_coordinates.latitude, lng: first.gps_coordinates.longitude },
      title: first.title ?? '',
    }
  }

  return null
}

interface NewsResult {
  title?: string
  iso_date?: string
  link?: string
  source?: { name?: string }
}

/**
 * Area signals rank and never prune, so this always returns a pass. What varies
 * is the count, which feeds the soft part of the score.
 */
export function mapAreaSignal(
  body: unknown,
  constraint: AreaSignalConstraint,
  context: MapperContext,
  options: { entity_id: string; now_ms: number },
): EvidenceRow[] {
  const results = (body as { news_results?: NewsResult[] }).news_results ?? []
  const cutoff = options.now_ms - constraint.lookback_days * 86_400 * 1000
  const recent = results.filter((r) => {
    const at = r.iso_date ? Date.parse(r.iso_date) : Number.NaN
    return Number.isFinite(at) && at >= cutoff
  })

  return [
    row(context, {
      entity_id: options.entity_id,
      constraint_id: constraint.id,
      constraint_type: 'area_signal',
      verdict: 'pass',
      value_canonical: recent.length,
      display_value: `${recent.length} ${constraint.topic} ${recent.length === 1 ? 'story' : 'stories'} in ${constraint.lookback_days} days`,
      source_url: recent[0]?.link ?? null,
      confidence: results.length === 0 ? 0.3 : 1,
      eval_state: 'evaluated',
    }),
  ]
}
