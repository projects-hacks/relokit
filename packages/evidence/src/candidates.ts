import type { Constraint, OpeningHoursConstraint, Place, Weekday } from '@relokit/schema'
import { row, unknownRow, type MapperContext, type MapperResult } from './context.ts'
import { parseOperatingHours, satisfiesWindow } from './hours.ts'

interface LocalResult {
  title?: string
  place_id?: string
  data_id?: string
  gps_coordinates?: { latitude: number; longitude: number }
  operating_hours?: Record<string, unknown>
  rating?: number
  reviews?: number
  price?: string
  type?: string
  thumbnail?: string
  address?: string
  open_state?: string
  links?: { website?: string }
  website?: string
}

/**
 * Candidates from a place search, for everything that is not a home.
 *
 * The same response the proximity checks already read, taken as results in their
 * own right rather than as an answer about somewhere else.
 */
export function mapPlaceCandidates(
  body: unknown,
  answered: Constraint[],
  context: MapperContext,
  evaluationDays: Weekday[],
): MapperResult {
  const results = (body as { local_results?: LocalResult[] }).local_results ?? []
  const entities: Place[] = []
  const evidence: MapperResult['evidence'] = []
  const hours = answered.filter((c): c is OpeningHoursConstraint => c.type === 'opening_hours')

  for (const result of results) {
    const id = result.place_id ?? result.data_id ?? result.title
    if (!id || !result.title) continue

    entities.push({
      entity_id: `places:${id}`,
      title: result.address ? `${result.title}, ${result.address}` : result.title,
      point: result.gps_coordinates
        ? { lat: result.gps_coordinates.latitude, lng: result.gps_coordinates.longitude }
        : null,
      price_cents: null,
      price_cents_upper: null,
      attributes: {
        ...(typeof result.rating === 'number' ? { rating: result.rating } : {}),
        ...(typeof result.reviews === 'number' ? { reviews: result.reviews } : {}),
        ...(result.price ? { price_level: result.price } : {}),
        ...(result.type ? { cuisine: result.type } : {}),
        ...(result.open_state ? { open_now: !/closed/i.test(result.open_state) } : {}),
      },
      url: result.links?.website ?? result.website ?? null,
      photo_url: result.thumbnail ?? null,
      photos: result.thumbnail ? [result.thumbnail] : [],
    })

    // The same response carries the opening times, so asking again would be
    // paying twice for one answer.
    for (const constraint of hours) {
      const parsed = parseOperatingHours(result.operating_hours)
      if (Object.keys(parsed).length === 0) {
        evidence.push(unknownRow(context, `places:${id}`, constraint, 'no opening times came back'))
        continue
      }
      const verdict = satisfiesWindow(parsed, constraint.open_window, evaluationDays)
      evidence.push(
        row(context, {
          entity_id: `places:${id}`,
          constraint_id: constraint.id,
          constraint_type: 'opening_hours',
          verdict,
          value_canonical: null,
          display_value:
            verdict === 'pass'
              ? 'open when you need it'
              : verdict === 'fail'
                ? 'not open when you need it'
                : 'opening times unclear',
          source_url: null,
          confidence: 1,
          eval_state: verdict === 'unknown' ? 'failed' : 'evaluated',
        }),
      )
    }
  }

  return { entities, evidence }
}
