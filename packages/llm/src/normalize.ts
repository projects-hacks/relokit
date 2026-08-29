import { Constraint, ConstraintSet, type ConstraintType } from '@relokit/schema'
import { clockSeconds, distanceMeters, durationSeconds, moneyCents, windowSide } from './units.ts'

/**
 * Repairs a parsed constraint set against the words it came from.
 *
 * The model decides what kind of constraint a phrase is. Every number is then
 * re-read from that phrase, and anything the phrase does not contain is marked
 * inferred so the interface can show it as an assumption rather than as
 * something the user asked for.
 */

export interface Repair {
  constraint_id: string
  field: string
  from: unknown
  to: unknown
  why: string
}

export interface NormalizeResult {
  constraint_set: ConstraintSet
  repairs: Repair[]
  dropped: { index: number; reason: string }[]
}

/** Used when the query names a category but no distance. Marked inferred. */
const DEFAULT_RADIUS_M: Partial<Record<string, number>> = {
  gym: 1200,
  grocery: 1600,
  cafe: 800,
  pharmacy: 1600,
  park: 1200,
  school: 2400,
  transit_stop: 800,
  restaurant: 1200,
}

const DEFAULT_LOOKBACK_DAYS = 30

export function normalizeConstraintSet(
  raw: unknown,
  query: string,
  meta: { query_id: string; parser_version: string; parsed_at_ms: number; tz?: string },
): NormalizeResult {
  const list = Array.isArray((raw as { constraints?: unknown }).constraints)
    ? (raw as { constraints: unknown[] }).constraints
    : []

  const repairs: Repair[] = []
  const dropped: { index: number; reason: string }[] = []
  const constraints: Constraint[] = []

  list.forEach((entry, index) => {
    const id = `c${constraints.length + 1}`
    const built = build(entry as Record<string, unknown>, id, repairs)
    if (!built) {
      dropped.push({ index, reason: 'the model produced something that is not a constraint' })
      return
    }
    const parsed = Constraint.safeParse(built)
    if (!parsed.success) {
      dropped.push({ index, reason: parsed.error.issues[0]?.message ?? 'failed validation' })
      return
    }
    constraints.push(parsed.data)
  })

  return {
    constraint_set: ConstraintSet.parse({
      query_id: meta.query_id,
      raw_query: query,
      locale: { tz: meta.tz ?? 'America/Los_Angeles', currency: 'USD' },
      constraints,
      parser_version: meta.parser_version,
      parsed_at_ms: meta.parsed_at_ms,
    }),
    repairs,
    dropped,
  }
}

function build(
  entry: Record<string, unknown>,
  id: string,
  repairs: Repair[],
): Record<string, unknown> | null {
  const type = entry.type as ConstraintType
  const span = typeof entry.source_text === 'string' ? entry.source_text : ''
  const base = {
    id,
    type,
    hardness: type === 'area_signal' ? 'soft' : ((entry.hardness as string) ?? 'hard'),
    weight: typeof entry.weight === 'number' ? Math.min(1, Math.max(0, entry.weight)) : 1,
    source_text: span,
    inferred: false,
  }

  const note = (field: string, from: unknown, to: unknown, why: string) => {
    if (from !== to) repairs.push({ constraint_id: id, field, from, to, why })
  }

  switch (type) {
    case 'budget': {
      const fromText = moneyCents(span)
      const value = fromText ?? (entry.max_cents as number | undefined)
      note(
        'max_cents',
        entry.max_cents,
        value,
        fromText === null ? 'no amount in the phrase' : 'read from the phrase',
      )
      return {
        ...base,
        inferred: fromText === null,
        basis: 'rent_monthly',
        includes_fees: false,
        ...(value === undefined ? {} : { max_cents: Math.round(value) }),
      }
    }

    case 'unit_attribute':
      return {
        ...base,
        attribute: entry.attribute ?? 'beds',
        ...(typeof entry.min === 'number' ? { min: Math.round(entry.min) } : {}),
        ...(typeof entry.max === 'number' ? { max: Math.round(entry.max) } : {}),
      }

    case 'listing_feature':
      return { ...base, feature: entry.feature, required: entry.required !== false }

    case 'commute': {
      const fromText = durationSeconds(span)
      const value = fromText ?? (entry.max_seconds as number | undefined)
      note('max_seconds', entry.max_seconds, value, 'read from the phrase')
      const destination = entry.destination
      const raw =
        typeof destination === 'string'
          ? destination
          : ((destination as { raw?: string } | undefined)?.raw ?? '')
      return {
        ...base,
        inferred: fromText === null,
        destination: { raw },
        mode: entry.mode ?? 'drive',
        ...(value === undefined ? {} : { max_seconds: Math.round(value) }),
      }
    }

    case 'nearby_poi': {
      const category = String(entry.category ?? 'cafe')
      const fromText = distanceMeters(span)
      const radius = fromText ?? DEFAULT_RADIUS_M[category] ?? 1200
      note(
        'radius_m',
        entry.radius_m,
        radius,
        fromText === null ? 'no distance in the phrase' : 'read from the phrase',
      )

      const window = openWindow(
        span,
        entry.open_window as Record<string, number> | undefined,
        id,
        repairs,
      )
      return {
        ...base,
        inferred: fromText === null,
        category,
        radius_m: Math.round(radius),
        min_count:
          typeof entry.min_count === 'number' ? Math.max(1, Math.round(entry.min_count)) : 1,
        ...(entry.query ? { query: entry.query } : {}),
        ...(window ? { open_window: window } : {}),
      }
    }

    case 'area_signal':
      return {
        ...base,
        hardness: 'soft',
        topic: entry.topic ?? 'noise',
        polarity: entry.polarity ?? 'negative',
        lookback_days:
          typeof entry.lookback_days === 'number' ? entry.lookback_days : DEFAULT_LOOKBACK_DAYS,
      }

    default:
      return null
  }
}

/**
 * The single most likely place for the model to be wrong, and the one the schema
 * cannot see. "Open before 6am" is a constraint on opening; "open past 10pm" is
 * a constraint on closing. Asked for both, the model filed each under the other
 * and read ten at night as ten in the morning.
 *
 * So the preposition picks the field and the clock picks the number, and the
 * model's answer is used only when the phrase settles neither.
 */
function openWindow(
  span: string,
  modelWindow: Record<string, number> | undefined,
  id: string,
  repairs: Repair[],
): Record<string, number> | undefined {
  if (!/\bopen|hours|24\b/i.test(span)) return undefined

  const side = windowSide(span)
  const seconds = clockSeconds(span)
  if (side === null || seconds === null) return modelWindow

  const field = side === 'opens_by' ? 'opens_by_s' : 'closes_after_s'
  const before = modelWindow ? JSON.stringify(modelWindow) : 'nothing'
  const after = JSON.stringify({ [field]: seconds })
  if (before !== after) {
    repairs.push({
      constraint_id: id,
      field: 'open_window',
      from: modelWindow,
      to: { [field]: seconds },
      why: `"${span.trim()}" constrains when it ${side === 'opens_by' ? 'opens' : 'closes'}`,
    })
  }
  return { [field]: seconds }
}
