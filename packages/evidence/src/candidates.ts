import type {
  AttributeConstraint,
  Constraint,
  OpeningHoursConstraint,
  Place,
  Weekday,
} from '@relokit/schema'
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
  const measures = answered.filter((c): c is AttributeConstraint => c.type === 'attribute')

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

    // How well reviewed and how dear, from the same response. A place that
    // states neither is not a bad one, so it goes unknown rather than out.
    for (const constraint of measures) {
      const value = measureOf(result, constraint.measure)
      if (value === null) {
        evidence.push(
          unknownRow(
            context,
            `places:${id}`,
            constraint,
            `no ${WORD[constraint.measure]} was given`,
          ),
        )
        continue
      }
      const low = constraint.min !== undefined && value < constraint.min
      const high = constraint.max !== undefined && value > constraint.max
      evidence.push(
        row(context, {
          entity_id: `places:${id}`,
          constraint_id: constraint.id,
          constraint_type: 'attribute',
          verdict: low || high ? 'fail' : 'pass',
          value_canonical: value,
          display_value: said(constraint.measure, value),
          source_url: null,
          confidence: 1,
          eval_state: 'evaluated',
        }),
      )
    }

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

const WORD: Record<AttributeConstraint['measure'], string> = {
  rating: 'rating',
  reviews: 'review count',
  price_level: 'price',
}

/** Money signs are how a provider says price, and counting them is the number. */
function measureOf(result: LocalResult, measure: AttributeConstraint['measure']): number | null {
  if (measure === 'rating') return typeof result.rating === 'number' ? result.rating : null
  if (measure === 'reviews') return typeof result.reviews === 'number' ? result.reviews : null
  const signs = (result.price ?? '').match(/\$/g)
  return signs ? signs.length : null
}

function said(measure: AttributeConstraint['measure'], value: number): string {
  if (measure === 'rating') return `${value} out of 5`
  if (measure === 'reviews') return `${value.toLocaleString('en-US')} reviews`
  return '$'.repeat(Math.max(1, Math.round(value)))
}
