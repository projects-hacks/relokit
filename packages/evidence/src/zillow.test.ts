import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, type Constraint } from '@relokit/schema'
import { score } from './buckets.ts'
import { mapZillowSearch, parsePriceCents } from './zillow.ts'
import type { MapperContext } from './context.ts'

const DIR = new URL('../../../fixtures/serpapi/', import.meta.url)
const load = (prefix: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        readdirSync(DIR).find((f) => f.startsWith(prefix))!,
        DIR,
      ),
      'utf8',
    ),
  ).body

const filtered = load('zillow__san-jose-1bed__')
const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
).constraints

const native = constraints.filter((c) =>
  ['budget', 'unit_attribute', 'listing_feature'].includes(c.type),
)
const pushedDown = native.map((c) => c.id)

const context: MapperContext = {
  op_id: 'op_candidates',
  capability_id: 'candidates.zillow.region',
  source: 'zillow',
  fetched_at_ms: 1_756_400_000_000,
  ttl_seconds: 21_600,
}

const result = mapZillowSearch(filtered, native, context, pushedDown)
const byConstraint = (entityId: string, id: string) =>
  result.evidence.find((e) => e.entity_id === entityId && e.constraint_id === id)!

describe('price parsing', () => {
  it('keeps cents and notices a floor', () => {
    expect(parsePriceCents('$2,495+')).toEqual({ cents: 249_500, isFloor: true })
    expect(parsePriceCents('$4,800+/mo')).toEqual({ cents: 480_000, isFloor: true })
    expect(parsePriceCents('$2,750/mo')).toEqual({ cents: 275_000, isFloor: false })
    expect(parsePriceCents(undefined)).toBeNull()
  })
})

describe('entities', () => {
  it('expands a building into one listing per bedroom band', () => {
    // A search result is not a thing you can rent. A one bed at Lynhaven is.
    const unfiltered = load('zillow__san-jose-rentals__')
    const wide = mapZillowSearch(unfiltered, native, context, pushedDown)
    expect(wide.entities.length).toBeGreaterThan(unfiltered.organic_results.length)
    const multiBand = unfiltered.organic_results.find(
      (r: { units?: unknown[] }) => (r.units?.length ?? 0) > 1,
    )
    expect(multiBand).toBeDefined()
    expect(wide.entities.filter((e) => e.entity_id.endsWith('#2bed')).length).toBeGreaterThan(0)
  })

  it('leaves the count alone once the beds filter has done its work', () => {
    // Each building is down to a single band, so a band is the whole listing.
    expect(result.entities).toHaveLength(filtered.organic_results.length)
    expect(result.entities.filter((e) => e.entity_id.endsWith('#1bed')).length).toBe(8)
  })

  it('gives every listing a stable id', () => {
    const ids = result.entities.map((e) => e.entity_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps a listing the provider gave no coordinates for', () => {
    const withoutPoint = result.entities.filter((e) => e.point === null)
    // Five percent of the filtered set arrives without coordinates. Dropping
    // them would be a silent answer to a question nobody asked.
    expect(withoutPoint.length).toBeGreaterThan(0)
    expect(result.entities.length).toBeGreaterThan(withoutPoint.length * 5)
  })
})

describe('budget', () => {
  const under = result.entities.find(
    (e) => e.price_cents !== null && e.price_cents < 280_000 && !e.entity_id.includes('#'),
  )!
  const band = result.entities.find((e) => e.entity_id.includes('#'))!

  it('passes a stated rent under the cap', () => {
    const evidence = byConstraint(under.entity_id, 'c1')
    expect(evidence.verdict).toBe('pass')
    expect(evidence.confidence).toBe(1)
    expect(evidence.display_value).toMatch(/^\$[\d,]+$/)
  })

  it('refuses to call a starting price a rent', () => {
    // "$2,495+" against a $2,800 cap says where the rent begins, not what it is.
    const evidence = byConstraint(band.entity_id, 'c1')
    expect(evidence.verdict).toBe('unknown')
    expect(evidence.eval_state).toBe('evaluated')
    expect(evidence.confidence).toBe(0.6)
    expect(evidence.display_value).toMatch(/^from \$/)
    // Says which of the two numbers is known, and that the cheaper end is
    // within reach, rather than repeating the one already on the card.
    expect(evidence.reason).toContain('Rents here start at')
    expect(evidence.reason).toContain('not published')
  })

  it('still rejects a floor already above the cap', () => {
    const expensive = mapZillowSearch(
      { organic_results: [{ zpid: '1', price: '$3,900+/mo', link: 'x' }] },
      native,
      context,
      pushedDown,
    )
    expect(expensive.evidence.find((e) => e.constraint_id === 'c1')!.verdict).toBe('fail')
  })

  it('reports no price as unknown rather than as free', () => {
    const priceless = mapZillowSearch(
      { organic_results: [{ zpid: '2', link: 'x' }] },
      native,
      context,
      pushedDown,
    )
    const evidence = priceless.evidence.find((e) => e.constraint_id === 'c1')!
    expect(evidence.verdict).toBe('unknown')
    expect(evidence.value_canonical).toBeNull()
  })
})

describe('bedrooms', () => {
  it('reads the band bedroom count off the unit, not the building', () => {
    const band = result.entities.find((e) => e.entity_id.endsWith('#1bed'))!
    expect(band.attributes.beds).toBe(1)
    expect(byConstraint(band.entity_id, 'c2').verdict).toBe('pass')
  })

  it('fails a listing outside the range', () => {
    const twoBed = mapZillowSearch(
      { organic_results: [{ zpid: '3', beds: 3, price: '$2,000/mo', link: 'x' }] },
      native,
      context,
      pushedDown,
    )
    expect(twoBed.evidence.find((e) => e.constraint_id === 'c2')!.verdict).toBe('fail')
  })
})

describe('the amenity filter', () => {
  it('passes on the provider word, at reduced confidence, citing the search', () => {
    const evidence = byConstraint(result.entities[0]!.entity_id, 'c5')
    expect(evidence.verdict).toBe('pass')
    expect(evidence.confidence).toBe(0.8)
    expect(evidence.reason).toContain('does not restate')
  })

  it('says unknown when the filter was never applied', () => {
    const unfiltered = mapZillowSearch(filtered, native, context, [])
    const evidence = unfiltered.evidence.find((e) => e.constraint_id === 'c5')!
    expect(evidence.verdict).toBe('unknown')
    expect(evidence.eval_state).toBe('skipped')
  })
})

describe('every row', () => {
  it('carries provenance and an expiry', () => {
    for (const evidence of result.evidence) {
      expect(evidence.capability_id).toBe('candidates.zillow.region')
      expect(evidence.op_id).toBe('op_candidates')
      expect(evidence.expires_at_ms).toBe(context.fetched_at_ms + 21_600 * 1000)
    }
  })

  it('never reports a failure it did not actually evaluate', () => {
    const fails = result.evidence.filter((e) => e.verdict === 'fail')
    for (const evidence of fails) expect(evidence.eval_state).toBe('evaluated')
  })
})

describe('a building that publishes only its cheapest rent', () => {
  const set = (max: number) =>
    ConstraintSet.parse({
      query_id: 'q',
      raw_query: 'flats',
      locale: { tz: 'America/Los_Angeles', currency: 'USD', distance_unit: 'mi' },
      constraints: [
        {
          id: 'c1',
          type: 'budget',
          hardness: 'hard',
          weight: 1,
          source_text: 'budget',
          inferred: false,
          basis: 'rent_monthly',
          max_cents: max,
        },
      ],
      parser_version: 'parse.v1.md',
      parsed_at_ms: 1_756_000_000_000,
    })

  it('ranks a floor far below the cap above one that only just fits', () => {
    // Both are unknown, but one has room for a bigger unit and the other does not.
    const roomy = score(
      [{ constraint_id: 'c1', value_canonical: 195_000, verdict: 'unknown' } as never],
      set(380_000).constraints,
      1,
    )
    const tight = score(
      [{ constraint_id: 'c1', value_canonical: 370_000, verdict: 'unknown' } as never],
      set(380_000).constraints,
      1,
    )
    expect(roomy).toBeGreaterThan(tight)
  })
})
