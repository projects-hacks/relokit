import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Registry, type Capability } from '@relokit/schema'
import { eliminationPower, passFraction, survivors } from './cardinality.ts'
import { compareCandidates, roundScore, scoreCandidate, scoreCapability } from './score.ts'
import { enabledByConstraintType, entitiesRequiringEvaluation } from './registry.ts'
import { boxAround, gridClusters, refineClusters } from './cluster.ts'

const seed = Registry.parse(
  JSON.parse(readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8')),
)

const cap = (over: Partial<Capability> = {}): Capability => ({
  capability_id: 'test.cap',
  constraint_type: 'commute',
  provider: 'google_maps_directions',
  endpoint: 'google_maps_directions:route',
  granularity: 'cluster',
  cost_units: 1,
  latency_p50_ms: 2400,
  selectivity_prior: 0.35,
  observation_n: 0,
  ttl_seconds: 604800,
  coverage: 1,
  precedence: 1,
  enabled: true,
  max_fanout: 16,
  params_template: {},
  produces: [],
  subjects: [],
  ...over,
})

describe('elimination power', () => {
  it('reads selectivity_prior as the pass fraction', () => {
    // 0.35 means 35 percent pass, so 65 percent are removed.
    expect(eliminationPower(1, 0.35)).toBeCloseTo(0.65)
  })

  it('discounts a source that often cannot answer', () => {
    // Eliminates 65 percent of what it covers, but only covers half the entities.
    expect(eliminationPower(0.5, 0.35)).toBeCloseTo(0.325)
  })

  it('lets an entity survive what a capability could not answer', () => {
    // An unknown is not a failure, so the uncovered half passes through.
    expect(passFraction(cap({ coverage: 0.5, selectivity_prior: 0 }))).toBeCloseTo(0.5)
  })

  it('does not let a native predicate leave unknowns behind', () => {
    // Zillow does not return the listings its own filter rejected, so coverage
    // says how much of the result we can cite, not how much survived.
    const native = cap({
      granularity: 'native',
      cost_units: 0,
      coverage: 0.8,
      selectivity_prior: 0.3,
    })
    expect(passFraction(native)).toBeCloseTo(0.3)
  })
})

describe('scoring', () => {
  it('prefers the capability that removes more per call', () => {
    const cheap = scoreCapability({
      selectivity_prior: 0.2,
      coverage: 1,
      cost_units: 1,
      entities_requiring_evaluation: 12,
    })
    const weak = scoreCapability({
      selectivity_prior: 0.9,
      coverage: 1,
      cost_units: 1,
      entities_requiring_evaluation: 12,
    })
    expect(cheap).toBeGreaterThan(weak)
  })

  it('penalises a capability that has to run per entity', () => {
    const inputs = { selectivity_prior: 0.35, coverage: 1, cost_units: 1 }
    const cluster = scoreCapability({ ...inputs, entities_requiring_evaluation: 12 })
    const entity = scoreCapability({ ...inputs, entities_requiring_evaluation: 56 })
    expect(cluster).toBeGreaterThan(entity)
  })

  it('does not divide by zero for a free predicate', () => {
    const free = scoreCapability({
      selectivity_prior: 0.3,
      coverage: 1,
      cost_units: 0,
      entities_requiring_evaluation: 0,
    })
    expect(free).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isSafeInteger(roundScore(free))).toBe(true)
  })
})

describe('ordering', () => {
  it('runs free predicates first and per entity work last', () => {
    const candidates = [
      scoreCandidate(cap({ capability_id: 'd', granularity: 'entity' }), 'c1', 56),
      scoreCandidate(cap({ capability_id: 'b', granularity: 'region' }), 'c2', 1),
      scoreCandidate(cap({ capability_id: 'a', granularity: 'native', cost_units: 0 }), 'c3', 0),
      scoreCandidate(cap({ capability_id: 'c', granularity: 'cluster' }), 'c4', 12),
    ].sort(compareCandidates)
    expect(candidates.map((c) => c.capability.capability_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('breaks an exact tie on precedence, then on id', () => {
    const tied = [
      scoreCandidate(cap({ capability_id: 'z', precedence: 1 }), 'c1', 12),
      scoreCandidate(cap({ capability_id: 'a', precedence: 2 }), 'c1', 12),
      scoreCandidate(cap({ capability_id: 'b', precedence: 1 }), 'c1', 12),
    ].sort(compareCandidates)
    expect(tied.map((c) => c.capability.capability_id)).toEqual(['b', 'z', 'a'])
  })

  it('orders identically however the registry rows arrive', () => {
    const rows = seed.capabilities.filter((c) => c.enabled && c.cost_units > 0)
    const order = (list: Capability[]) =>
      list
        .map((c) => scoreCandidate(c, 'c1', entitiesRequiringEvaluation(c.granularity, ctx)))
        .sort(compareCandidates)
        .map((c) => c.capability.capability_id)
    const ctx = { cluster_count: 12, entity_survivors: 56 }
    const expected = order(rows)

    let seedValue = 1
    const random = () => (seedValue = (seedValue * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let run = 0; run < 100; run++) {
      const shuffled = [...rows]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
      }
      expect(order(shuffled)).toEqual(expected)
    }
  })
})

describe('registry', () => {
  it('skips disabled rows', () => {
    const index = enabledByConstraintType(seed.capabilities)
    const poi = index.get('nearby_poi')!.map((c) => c.capability_id)
    expect(poi).toContain('nearby_poi.maps.cluster')
    expect(poi).not.toContain('nearby_poi.yelp.cluster')
  })

  it('counts invocations by tier', () => {
    const ctx = { cluster_count: 12, entity_survivors: 56 }
    expect(entitiesRequiringEvaluation('native', ctx)).toBe(0)
    expect(entitiesRequiringEvaluation('region', ctx)).toBe(1)
    expect(entitiesRequiringEvaluation('cluster', ctx)).toBe(12)
    expect(entitiesRequiringEvaluation('entity', ctx)).toBe(56)
  })

  it('estimates the survivors the free predicates leave behind', () => {
    // Only what a rental search can push down. A native predicate over a
    // restaurant's rating narrows nothing about a flat, and counting it here
    // made the estimate shrink whenever the vocabulary grew.
    const forRentals = new Set(['budget', 'unit_attribute', 'listing_feature'])
    const natives = seed.capabilities.filter(
      (c) => c.granularity === 'native' && c.enabled && forRentals.has(c.constraint_type),
    )
    // Priors are calibrated to the measured 4,517 rentals down to 56.
    expect(survivors(4517, natives)).toBeGreaterThan(30)
    expect(survivors(4517, natives)).toBeLessThan(80)
  })
})

describe('fitting clusters to the listings', () => {
  const points = [
    { lat: 37.3, lng: -121.9 },
    { lat: 37.301, lng: -121.901 },
    { lat: 37.302, lng: -121.899 },
    { lat: 37.4, lng: -121.8 },
    { lat: 37.401, lng: -121.801 },
  ]

  it('puts neighbours in the same cell', () => {
    const cells = refineClusters(points, 2)
    expect(cells).toHaveLength(2)
    const radii = cells.map((c) => c.radius_m)
    // Both groups are a couple of hundred metres across, not the fifteen
    // kilometres that separates them.
    expect(Math.max(...radii)).toBeLessThan(500)
  })

  it('gives a much tighter cell than a grid over the same area', () => {
    // A grid covers the box; listings occupy a small part of it, and a cell wide
    // enough to span the box forces slack larger than the constraint itself.
    const box = boxAround({ lat: 37.35, lng: -121.85 }, 8000)
    const grid = gridClusters(box, 2)
    const fitted = refineClusters(points, 2)
    expect(Math.max(...fitted.map((c) => c.radius_m))).toBeLessThan(
      Math.max(...grid.map((c) => c.radius_m)) / 5,
    )
  })

  it('is deterministic however the listings arrive', () => {
    const forwards = refineClusters(points, 2)
    const backwards = refineClusters([...points].reverse(), 2)
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards))
  })

  it('never asks for more cells than there are listings', () => {
    expect(refineClusters(points.slice(0, 2), 6)).toHaveLength(2)
    expect(refineClusters([], 6)).toHaveLength(0)
  })

  it('sizes each cell by its furthest listing, which is the error to allow for', () => {
    const cells = refineClusters(points, 1)
    expect(cells[0]!.radius_m).toBeGreaterThan(5_000)
  })
})
