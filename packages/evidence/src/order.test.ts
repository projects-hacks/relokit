import { describe, expect, it } from 'vitest'
import type { EvidenceRow, Place } from '@relokit/schema'
import { availableSorts, filterEntries, sortEntries, type Sortable } from './order.ts'

const home = (id: string, price: number | null, beds: number | null): Place => ({
  entity_id: id,
  title: id,
  point: { lat: 37.3, lng: -121.9 },
  price_cents: price,
  price_cents_upper: null,
  attributes: beds === null ? {} : { beds },
  url: null,
  photo_url: null,
  photos: [],
})

const fact = (
  entityId: string,
  type: EvidenceRow['constraint_type'],
  value: number | null,
): EvidenceRow => ({
  entity_id: entityId,
  constraint_id: 'c1',
  constraint_type: type,
  verdict: 'pass',
  value_canonical: value,
  display_value: String(value),
  source: 'zillow',
  source_url: null,
  fetched_at_ms: 1,
  ttl_seconds: 1,
  expires_at_ms: 2,
  confidence: 1,
  eval_state: 'evaluated',
  capability_id: 'x',
  op_id: 'op',
})

const entry = (id: string, evidence: EvidenceRow[] = [], score?: number): Sortable =>
  score === undefined ? { entity_id: id, evidence } : { entity_id: id, evidence, score }

describe('ordering', () => {
  const entities = [home('a', 300_000, 2), home('b', 200_000, 1), home('c', null, 1)]

  it('puts the cheapest first', () => {
    const sorted = sortEntries([entry('a'), entry('b'), entry('c')], entities, 'cheapest')
    expect(sorted.map((e) => e.entity_id)).toEqual(['b', 'a', 'c'])
  })

  it('sinks a home whose rent nobody could establish', () => {
    // Unknown is not cheap. Leading with it would be the list claiming something
    // the evidence does not say.
    const sorted = sortEntries([entry('c'), entry('b')], entities, 'cheapest')
    expect(sorted[sorted.length - 1]!.entity_id).toBe('c')
  })

  it('puts the shortest journey first', () => {
    const sorted = sortEntries(
      [
        entry('a', [fact('a', 'commute', 1800)]),
        entry('b', [fact('b', 'commute', 600)]),
        entry('c', []),
      ],
      entities,
      'quickest',
    )
    expect(sorted.map((e) => e.entity_id)).toEqual(['b', 'a', 'c'])
  })

  it('takes the best measurement when a home has several', () => {
    const sorted = sortEntries(
      [
        entry('a', [fact('a', 'commute', 1800), fact('a', 'commute', 500)]),
        entry('b', [fact('b', 'commute', 900)]),
      ],
      entities,
      'quickest',
    )
    expect(sorted[0]!.entity_id).toBe('a')
  })

  it('ranks by how comfortably a home clears its limits when asked for the best', () => {
    const sorted = sortEntries([entry('a', [], 0.2), entry('b', [], 0.9)], entities, 'best')
    expect(sorted[0]!.entity_id).toBe('b')
  })

  it('breaks a tie the same way every time', () => {
    const tied = [entry('b'), entry('a')]
    const once = sortEntries(tied, entities, 'best').map((e) => e.entity_id)
    const twice = sortEntries([...tied].reverse(), entities, 'best').map((e) => e.entity_id)
    expect(once).toEqual(twice)
  })

  it('leaves the caller’s array alone', () => {
    const original = [entry('a'), entry('b')]
    sortEntries(original, entities, 'cheapest')
    expect(original.map((e) => e.entity_id)).toEqual(['a', 'b'])
  })
})

describe('filtering', () => {
  const entities = [home('a', 300_000, 2), home('b', 200_000, 1), home('c', null, 1)]
  const entries = [entry('a'), entry('b'), entry('c')]

  it('drops a home whose stated rent is over the ceiling', () => {
    const kept = filterEntries(entries, entities, {
      max_price_cents: 250_000,
      beds: null,
      min_rating: null,
      q: '',
    })
    expect(kept.map((e) => e.entity_id)).toEqual(['b', 'c'])
  })

  it('keeps a home whose rent nobody stated', () => {
    // The filter narrows what is known. Hiding what is uncertain would quietly
    // drop the price-band buildings, which are a fifth of everything.
    const kept = filterEntries(entries, entities, {
      max_price_cents: 100,
      beds: null,
      min_rating: null,
      q: '',
    })
    expect(kept.map((e) => e.entity_id)).toEqual(['c'])
  })

  it('matches a bedroom count exactly', () => {
    const kept = filterEntries(entries, entities, {
      max_price_cents: null,
      beds: 1,
      min_rating: null,
      q: '',
    })
    expect(kept.map((e) => e.entity_id)).toEqual(['b', 'c'])
  })

  it('returns everything when nothing is asked', () => {
    const kept = filterEntries(entries, entities, {
      max_price_cents: null,
      beds: null,
      min_rating: null,
      q: '',
    })
    expect(kept).toHaveLength(3)
  })
})

describe('what is worth offering', () => {
  const priced = [home('a', 100_000, 1)]

  it('only offers an order it can actually compute', () => {
    const withCommute = [entry('a', [fact('a', 'commute', 60)])]
    expect(availableSorts(withCommute, priced, true)).toEqual(['best', 'cheapest', 'quickest'])
  })

  it('does not offer the best order where nothing was ranked', () => {
    // Nothing was asked, so nothing cleared anything more comfortably.
    expect(availableSorts([entry('a')], priced, false)).toEqual(['cheapest'])
  })

  it('offers neither price nor rating orders over results that have neither', () => {
    // Parks have no rent and often no stars. Offering cheapest over them is a
    // dial wired to nothing.
    const bare = [{ ...home('a', null, null), attributes: {} }]
    expect(availableSorts([entry('a')], bare, false)).toEqual([])
  })

  it('offers a rating order when the results are rated', () => {
    const rated = [{ ...home('a', null, null), attributes: { rating: 4.4 } }]
    expect(availableSorts([entry('a')], rated, false)).toEqual(['rated'])
  })
})
