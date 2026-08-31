import {
  Constraint,
  ConstraintSet,
  Subject,
  measuresFromQuery,
  subjectFromQuery,
  termFromQuery,
  type ConstraintType,
} from '@relokit/schema'
import { clockSeconds, distanceMeters, durationSeconds, moneyCents, windowSide } from './units.ts'

/**
 * Repairs a parsed constraint set against the words it came from.
 *
 * The model decides what kind of constraint a phrase is. Every number is then
 * re-read from that phrase, and anything the phrase does not contain is marked
 * inferred so the interface can show it as an assumption rather than as
 * something the user asked for.
 */

/** The prompt that produced a constraint set, recorded on it so an answer can
 * always be traced back to the words that asked for it. */
export const PARSER_VERSION = 'parse.v1.md'

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

/**
 * How far "near" is, by how you are travelling. Used when someone says near the
 * office and gives no time, which is the ordinary way to say it. Marked
 * inferred, so the interface shows it as an assumption rather than a
 * requirement.
 */
const DEFAULT_COMMUTE_SECONDS: Record<string, number> = {
  walk: 900,
  bike: 1200,
  transit: 2400,
  drive: 1800,
}

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

  // What to look for. The model decides, and where it did not the noun the
  // question opens with does, because several of these words are also things a
  // home can be near.
  // The noun comes first. Asked for gyms, a model will still sometimes answer
  // rental, because a gym is also something a home can be near; the word the
  // sentence opens with is not ambiguous in that way.
  const stated = Subject.safeParse((raw as { subject?: unknown }).subject)
  const subject = subjectFromQuery(query) ?? (stated.success ? stated.data : null)
  // The model is asked for the wording too, and forgets: mexican restaurants
  // came back as plain restaurants. Read from the sentence when it does.
  const said = (raw as { subject_term?: unknown }).subject_term
  const term =
    subject === null
      ? null
      : (termFromQuery(query, subject) ??
        (typeof said === 'string' && said.trim() !== '' ? said.trim() : null))

  // How good and how dear, read off the sentence. The model is asked for these
  // as well; anything it found that is not already here is kept beside them.
  const measures = measuresFromQuery(query, (index) => `c${constraints.length + index + 1}`)
  for (const measure of measures) {
    if (!constraints.some((c) => c.type === 'attribute' && c.measure === measure.measure)) {
      constraints.push(measure)
    }
  }

  // A model with nowhere to put "cheap" files it as neighbourhood news, and the
  // same word then costs a search to answer badly as well as being answered
  // properly for nothing. Where the sentence has already been read, that
  // reading stands and the guess beside it goes.
  const claimed = new Set(measures.map((measure) => measure.source_text.toLowerCase()))
  for (let at = constraints.length - 1; at >= 0; at -= 1) {
    const constraint = constraints[at]!
    if (constraint.type !== 'attribute' && claimed.has(constraint.source_text.toLowerCase())) {
      constraints.splice(at, 1)
    }
  }

  // Whatever is being counted is not also a requirement of itself. A question
  // asking for gyms must not carry a constraint saying each gym needs a gym.
  // Where such a constraint carries opening times it is kept as those, because
  // dropping it would lose something the question asked for.
  const kept = constraints.flatMap((c): Constraint[] => {
    if (subject === null || c.type !== 'nearby_poi' || c.category !== subject) return [c]
    if (!c.open_window) return []
    return [
      {
        id: c.id,
        type: 'opening_hours',
        hardness: c.hardness,
        weight: c.weight,
        source_text: c.source_text,
        inferred: c.inferred,
        open_window: c.open_window,
      },
    ]
  })

  // A stated radius is both the bound on the search and a fact worth showing:
  // bounded silently, the reader cannot tell held-by-construction from dropped.
  // Models skip the constraint half however they are asked, so it is made here.
  const location =
    typeof (raw as { location?: unknown }).location === 'string'
      ? (raw as { location: string }).location.trim()
      : ''
  const stated_radius = (raw as { radius_m?: unknown }).radius_m
  if (
    location !== '' &&
    typeof stated_radius === 'number' &&
    stated_radius > 0 &&
    !kept.some((c) => c.type === 'proximity' && c.place.raw === location)
  ) {
    const phrase =
      /within\s+(?:a\s+)?[\w.]+\s*(?:miles?|mi|kilometers?|kilometres?|km|meters?|metres?)/i.exec(
        query,
      )?.[0]
    kept.push(
      Constraint.parse({
        id: `c${constraints.length + 1}`,
        type: 'proximity',
        hardness: 'hard',
        weight: 1,
        source_text: phrase ? `${phrase} of ${location}` : `near ${location}`,
        inferred: false,
        place: { raw: location },
        radius_m: Math.round(stated_radius),
      }),
    )
  }

  // Where to look. Without it there is nowhere to search, so it is taken from
  // the model, and failing that from wherever the person said they were
  // travelling to.
  const anchor =
    typeof (raw as { location?: unknown }).location === 'string' &&
    (raw as { location: string }).location.trim() !== ''
      ? (raw as { location: string }).location.trim()
      : (kept.find((c) => c.type === 'commute')?.destination.raw ?? '')

  return {
    constraint_set: ConstraintSet.parse({
      query_id: meta.query_id,
      raw_query: query,
      ...(subject === null ? {} : { subject }),
      ...(term === null ? {} : { subject_term: term }),
      locale: {
        tz: meta.tz ?? 'America/Los_Angeles',
        currency: 'USD',
        // Kilometres asked and no miles mentioned means kilometres answered.
        distance_unit:
          /\b(?:km|kilomet)/i.test(query) && !/\b(?:miles?|mi)\b/i.test(query) ? 'km' : 'mi',
      },
      ...(anchor === ''
        ? {}
        : {
            search_anchor: {
              raw: anchor,
              ...(typeof (raw as { radius_m?: unknown }).radius_m === 'number' &&
              (raw as { radius_m: number }).radius_m > 0
                ? { radius_m: (raw as { radius_m: number }).radius_m }
                : {}),
            },
          }),
      constraints: kept,
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

    case 'unit_attribute': {
      // "2 bed" is a number of bedrooms, not a floor to build on, and the
      // search wants both ends of the range. A model that gives only one end
      // meant the pair, and leaving the other absent left the provider's own
      // filter with a hole in it, which dropped the whole search.
      const min = typeof entry.min === 'number' ? Math.round(entry.min) : undefined
      const max = typeof entry.max === 'number' ? Math.round(entry.max) : undefined
      const both = min ?? max
      if (min === undefined && max !== undefined)
        note('min', entry.min, max, 'the other end of the range')
      if (max === undefined && min !== undefined)
        note('max', entry.max, min, 'the other end of the range')
      return {
        ...base,
        attribute: entry.attribute ?? 'beds',
        ...(both === undefined ? {} : { min: min ?? both, max: max ?? both }),
      }
    }

    case 'listing_feature':
      return { ...base, feature: entry.feature, required: entry.required !== false }

    case 'commute': {
      const mode = String(entry.mode ?? 'drive')
      const fromText = durationSeconds(span)
      // A commute with no time is not a broken constraint, it is how people
      // speak. Dropping it loses the most important thing in the question.
      const value =
        fromText ??
        (entry.max_seconds as number | undefined) ??
        DEFAULT_COMMUTE_SECONDS[mode] ??
        1800
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
        mode,
        max_seconds: Math.round(value),
      }
    }

    case 'proximity': {
      const place = entry.place
      const raw =
        typeof place === 'string' ? place : ((place as { raw?: string } | undefined)?.raw ?? '')
      // Without a place there is nothing to measure from, and a proximity
      // constraint that measures from nowhere is the bug this type exists to
      // prevent.
      if (raw === '') return null
      const fromText = distanceMeters(span)
      const radius = fromText ?? (entry.radius_m as number | undefined) ?? 1609
      note(
        'radius_m',
        entry.radius_m,
        radius,
        fromText === null ? 'no distance in the phrase' : 'read from the phrase',
      )
      return { ...base, inferred: fromText === null, place: { raw }, radius_m: Math.round(radius) }
    }

    case 'opening_hours': {
      const window = openWindow(
        span,
        entry.open_window as Record<string, number> | undefined,
        id,
        repairs,
      )
      if (!window) return null
      return { ...base, open_window: window }
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
