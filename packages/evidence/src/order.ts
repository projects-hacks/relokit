import { numberOf, type EvidenceRow, type Place } from '@relokit/schema'

/**
 * Putting a list of homes in an order somebody asked for.
 *
 * Eighty homes in the order a provider happened to return them is not a result,
 * it is a pile. What people sort by when choosing somewhere to live is rent and
 * how long they will spend travelling, so those are the orders, and everything
 * is read from evidence already gathered rather than fetched again.
 */

export type SortKey = 'best' | 'cheapest' | 'quickest' | 'nearest' | 'rated'

export interface Sortable {
  entity_id: string
  evidence: EvidenceRow[]
  score?: number
}

export interface Filters {
  /** Inclusive ceiling in cents. A home with no stated rent is never excluded by
   * a price filter, because not knowing is not the same as being too dear. */
  max_price_cents: number | null
  beds: number | null
  /** A floor, and only ever a floor: an unrated place is not a bad one, so it
   * is never hidden by a rating filter. */
  min_rating: number | null
  /** Plain words matched against the name. */
  q: string
}

export const NO_FILTERS: Filters = { max_price_cents: null, beds: null, min_rating: null, q: '' }

export function sortEntries<T extends Sortable>(
  entries: T[],
  entities: Place[],
  key: SortKey,
): T[] {
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]))

  return [...entries].sort((a, b) => {
    const compared = compare(a, b, byId, key)
    // Stable and predictable when two homes tie, so the list does not reshuffle
    // itself between renders.
    return compared !== 0 ? compared : a.entity_id < b.entity_id ? -1 : 1
  })
}

function compare<T extends Sortable>(a: T, b: T, byId: Map<string, Place>, key: SortKey): number {
  if (key === 'best') return (b.score ?? 0) - (a.score ?? 0)
  if (key === 'cheapest') return lowestFirst(price(a, byId), price(b, byId))
  if (key === 'rated') return lowestFirst(negRating(a, byId), negRating(b, byId))
  if (key === 'quickest') return lowestFirst(travel(a), travel(b))
  return lowestFirst(distance(a), distance(b))
}

/**
 * Unknowns sink. A home whose rent nobody could establish is not the cheapest
 * one, and putting it first would be the list making a claim the evidence does
 * not support.
 */
function lowestFirst(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function price(entry: Sortable, byId: Map<string, Place>): number | null {
  return byId.get(entry.entity_id)?.price_cents ?? null
}

function travel(entry: Sortable): number | null {
  return smallest(entry.evidence, 'commute')
}

function negRating(entry: Sortable, byId: Map<string, Place>): number | null {
  const entity = byId.get(entry.entity_id)
  const rating = entity ? numberOf(entity, 'rating') : null
  return rating === null ? null : -rating
}

function distance(entry: Sortable): number | null {
  const near = smallest(entry.evidence, 'proximity')
  return near !== null ? near : smallest(entry.evidence, 'nearby_poi')
}

/** The best measurement of its kind on a home, ignoring anything unmeasured. */
function smallest(evidence: EvidenceRow[], type: EvidenceRow['constraint_type']): number | null {
  const values = evidence
    .filter((row) => row.constraint_type === type && typeof row.value_canonical === 'number')
    .map((row) => row.value_canonical as number)
  return values.length === 0 ? null : Math.min(...values)
}

export function filterEntries<T extends Sortable>(
  entries: T[],
  entities: Place[],
  filters: Filters,
): T[] {
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]))

  return entries.filter((entry) => {
    const entity = byId.get(entry.entity_id)
    if (!entity) return false

    // A stated rent above the ceiling is out. An unstated one stays: the filter
    // narrows what is known, it does not hide what is uncertain.
    if (
      filters.max_price_cents !== null &&
      entity.price_cents !== null &&
      entity.price_cents > filters.max_price_cents
    ) {
      return false
    }

    const beds = numberOf(entity, 'beds')
    if (filters.beds !== null && beds !== null && beds !== filters.beds) {
      return false
    }

    const rating = numberOf(entity, 'rating')
    if (filters.min_rating !== null && rating !== null && rating < filters.min_rating) {
      return false
    }

    if (filters.q !== '' && !entity.title.toLowerCase().includes(filters.q.toLowerCase())) {
      return false
    }

    return true
  })
}

/** What sorting is worth offering, given what was actually measured. */
export function availableSorts(
  entries: Sortable[],
  entities: Place[],
  hasScores: boolean,
): SortKey[] {
  const keys: SortKey[] = hasScores ? ['best'] : []
  const evidence = entries.flatMap((entry) => entry.evidence)
  if (entities.some((entity) => entity.price_cents !== null)) keys.push('cheapest')
  if (evidence.some((row) => row.constraint_type === 'commute')) keys.push('quickest')
  if (
    evidence.some(
      (row) => row.constraint_type === 'nearby_poi' || row.constraint_type === 'proximity',
    )
  ) {
    keys.push('nearest')
  }
  if (entities.some((entity) => numberOf(entity, 'rating') !== null)) keys.push('rated')
  return keys
}
