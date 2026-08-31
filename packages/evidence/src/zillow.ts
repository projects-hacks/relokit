import type {
  BudgetConstraint,
  Constraint,
  EvidenceRow,
  ListingFeatureConstraint,
  Place,
  UnitAttributeConstraint,
} from '@relokit/schema'
import { numberOf } from '@relokit/schema'
import { row, unknownRow, type MapperContext, type MapperResult } from './context.ts'

/**
 * Zillow rental search.
 *
 * Four fifths of San Jose results are buildings rather than units. They carry no
 * price, no beds and no zpid, and instead list a band per bedroom count:
 *
 *   { building_name: "Lynhaven",
 *     units: [ { price: "$3,227+", beds: "1" }, { price: "$5,162+", beds: "2" } ] }
 *
 * So an entity is one bedroom count at one building, not one search result, and
 * a listing you can actually rent is a row in that array.
 */

interface ZillowResult {
  zpid?: string
  provider_listing_id?: string
  lot_id?: string | number
  title?: string
  link?: string
  thumbnail?: string
  price?: string
  extracted_price?: number
  beds?: number
  baths?: number
  building_name?: string
  units?: { price?: string; beds?: string }[]
  gps_coordinates?: { latitude: number; longitude: number }
  images?: string[]
}

export interface Price {
  cents: number
  /** True for "$2,495+", where the number is a floor and not the rent. */
  isFloor: boolean
}

export function parsePriceCents(raw: string | undefined): Price | null {
  if (!raw) return null
  const digits = raw.replace(/[^\d.]/g, '')
  if (digits === '') return null
  const dollars = Number(digits)
  if (!Number.isFinite(dollars)) return null
  return { cents: Math.round(dollars * 100), isFloor: raw.includes('+') }
}

export function mapZillowSearch(
  body: unknown,
  constraints: Constraint[],
  context: MapperContext,
  /** Constraints Zillow applied inside the search, which it does not restate. */
  pushedDown: string[] = [],
): MapperResult {
  const results = (body as { organic_results?: ZillowResult[] }).organic_results ?? []
  const entities: Place[] = []
  const evidence: EvidenceRow[] = []

  for (const result of results) {
    for (const entity of expand(result)) {
      entities.push(entity)
      for (const constraint of constraints) {
        evidence.push(...evaluate(entity, result, constraint, context, pushedDown))
      }
    }
  }

  return { entities, evidence }
}

/** One search result becomes one listing, or one listing per bedroom band. */
function expand(result: ZillowResult): Place[] {
  const point = result.gps_coordinates
    ? { lat: result.gps_coordinates.latitude, lng: result.gps_coordinates.longitude }
    : null
  const base = {
    title: result.title ?? result.building_name ?? 'Untitled listing',
    point,
    url: result.link ?? null,
    photo_url: result.thumbnail ?? null,
    // Enough to look at without carrying a whole gallery through the ledger.
    photos: (result.images ?? []).slice(0, 6),
  }

  if (!result.units || result.units.length === 0) {
    const price = parsePriceCents(result.price)
    return [
      {
        ...base,
        entity_id: `zillow:${result.zpid ?? result.provider_listing_id ?? result.link}`,
        price_cents: price?.cents ?? result.extracted_price ?? null,
        price_cents_upper: null,
        attributes: attrs({ beds: result.beds, baths: result.baths }),
      },
    ]
  }

  const building = result.provider_listing_id ?? result.lot_id ?? result.link
  return result.units.map((unit) => {
    const price = parsePriceCents(unit.price)
    const beds = unit.beds === undefined ? null : Number(unit.beds)
    return {
      ...base,
      entity_id: `zillow:${building}#${unit.beds ?? '?'}bed`,
      title: `${result.building_name ?? base.title}, ${unit.beds ?? '?'} bed`,
      price_cents: price?.cents ?? null,
      price_cents_upper: null,
      attributes: attrs({ beds: Number.isFinite(beds) ? beds : null }),
    }
  })
}

/** Keeps absent values out of the record rather than storing them as null. */
function attrs(values: Record<string, number | null | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>
}

function evaluate(
  entity: Place,
  result: ZillowResult,
  constraint: Constraint,
  context: MapperContext,
  pushedDown: string[],
): EvidenceRow[] {
  switch (constraint.type) {
    case 'budget':
      return [budgetRow(entity, result, constraint, context)]
    case 'unit_attribute':
      return [unitAttributeRow(entity, constraint, context)]
    case 'listing_feature':
      return [featureRow(entity, constraint, context, pushedDown)]
    default:
      return []
  }
}

function budgetRow(
  entity: Place,
  result: ZillowResult,
  constraint: BudgetConstraint,
  context: MapperContext,
): EvidenceRow {
  if (entity.price_cents === null) {
    return unknownRow(context, entity.entity_id, constraint, 'no price on the listing')
  }

  const raw = result.units
    ? result.units.find((u) => String(u.beds) === String(numberOf(entity, 'beds')))?.price
    : result.price
  const isFloor = parsePriceCents(raw)?.isFloor ?? false
  const max = constraint.max_cents
  const display = isFloor ? `from ${money(entity.price_cents)}` : money(entity.price_cents)

  // Over the cap even at the floor is a real rejection. Under it is not an
  // answer, because a floor says where the rent starts and not what it is.
  const verdict =
    max === undefined ? 'unknown' : entity.price_cents > max ? 'fail' : isFloor ? 'unknown' : 'pass'

  return row(context, {
    entity_id: entity.entity_id,
    constraint_id: constraint.id,
    constraint_type: 'budget',
    verdict,
    value_canonical: entity.price_cents,
    display_value: display,
    source_url: entity.url,
    confidence: isFloor ? 0.6 : 1,
    eval_state: 'evaluated',
    // A floor is the building's cheapest unit, not this one's rent. Saying
    // which of the two is known, and that the cheaper end is within reach, is
    // more use than repeating the number that is already on the card.
    reason:
      verdict === 'unknown' && isFloor
        ? max !== undefined && entity.price_cents <= max
          ? `Rents here start at ${money(entity.price_cents)}, under your ${money(max)}, but this unit’s own rent is not published.`
          : `${display}, so the rent for this unit is not stated`
        : undefined,
  })
}

function unitAttributeRow(
  entity: Place,
  constraint: UnitAttributeConstraint,
  context: MapperContext,
): EvidenceRow {
  if (constraint.attribute !== 'beds') {
    return unknownRow(context, entity.entity_id, constraint, 'only beds are read from search')
  }
  const beds = numberOf(entity, 'beds')
  if (beds === null) {
    return unknownRow(context, entity.entity_id, constraint, 'no bedroom count on the listing')
  }
  const tooFew = constraint.min !== undefined && beds < constraint.min
  const tooMany = constraint.max !== undefined && beds > constraint.max
  return row(context, {
    entity_id: entity.entity_id,
    constraint_id: constraint.id,
    constraint_type: 'unit_attribute',
    verdict: tooFew || tooMany ? 'fail' : 'pass',
    value_canonical: beds,
    display_value: `${beds} bed`,
    source_url: entity.url,
    confidence: 1,
    eval_state: 'evaluated',
  })
}

/**
 * Zillow applies the amenity filter but never restates it per listing, so this
 * is the provider's word rather than a fact read off the page. It passes at
 * reduced confidence and cites the search. Enabling the per-property capability
 * upgrades it to something directly read.
 */
function featureRow(
  entity: Place,
  constraint: ListingFeatureConstraint,
  context: MapperContext,
  pushedDown: string[],
): EvidenceRow {
  if (!pushedDown.includes(constraint.id)) {
    return unknownRow(context, entity.entity_id, constraint, 'not filtered on and not restated')
  }
  return row(context, {
    entity_id: entity.entity_id,
    constraint_id: constraint.id,
    constraint_type: 'listing_feature',
    verdict: 'pass',
    value_canonical: true,
    display_value: constraint.feature.replaceAll('_', ' '),
    source_url: entity.url,
    confidence: 0.8,
    eval_state: 'evaluated',
    reason: 'Zillow filtered the search for this, but does not restate it per listing',
  })
}

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`
}
