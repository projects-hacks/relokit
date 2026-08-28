import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AreaSignalConstraint, ConstraintSet, ConstraintType } from './constraints.ts'
import { Capability, ParamRefPattern, ParamValue, Registry, paramRefs } from './capability.ts'
import { EvidenceRow } from './evidence.ts'

const demoQuery = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
    'utf8',
  ),
)

const capability = {
  capability_id: 'commute.directions.cluster',
  constraint_type: 'commute',
  provider: 'google_maps_directions',
  endpoint: 'google_maps:directions',
  granularity: 'cluster',
  cost_units: 1,
  latency_p50_ms: 2400,
  selectivity_prior: 0.35,
  observation_n: 0,
  ttl_seconds: 604800,
  coverage: 0.98,
  precedence: 2,
  enabled: true,
  max_fanout: 16,
  params_template: { start_coords: '$cluster.lat,$cluster.lng', travel_mode: 'bicycling' },
}

describe('constraint set', () => {
  it('accepts the canonical demo query', () => {
    const parsed = ConstraintSet.parse(demoQuery)
    expect(parsed.constraints).toHaveLength(6)
    expect(parsed.constraints.map((c) => c.type)).toEqual([
      'budget',
      'unit_attribute',
      'commute',
      'nearby_poi',
      'listing_feature',
      'nearby_poi',
    ])
  })

  it('keeps every value in canonical units', () => {
    const parsed = ConstraintSet.parse(demoQuery)
    const budget = parsed.constraints.find((c) => c.type === 'budget')
    const commute = parsed.constraints.find((c) => c.type === 'commute')
    expect(budget?.max_cents).toBe(280_000)
    expect(commute?.max_seconds).toBe(1500)
  })

  it('refuses a hard area signal, so a headline can never reject a home', () => {
    const hardSignal = {
      id: 'c9',
      type: 'area_signal',
      hardness: 'hard',
      weight: 0.5,
      source_text: 'quiet street',
      topic: 'noise',
      polarity: 'negative',
      lookback_days: 30,
    }
    expect(AreaSignalConstraint.safeParse(hardSignal).success).toBe(false)
  })

  it('refuses a constraint id outside the c<n> form', () => {
    const bad = structuredClone(demoQuery)
    bad.constraints[0].id = 'budget'
    expect(ConstraintSet.safeParse(bad).success).toBe(false)
  })
})

describe('capability', () => {
  it('accepts a well formed row', () => {
    expect(Capability.safeParse(capability).success).toBe(true)
  })

  it('reads selectivity_prior as the pass fraction', () => {
    // 0.35 on in_unit_laundry means 35 percent of listings HAVE it, not that 35
    // percent are eliminated. Every scoring decision depends on this direction.
    const row = Capability.parse({ ...capability, selectivity_prior: 0.35 })
    expect(1 - row.selectivity_prior).toBeCloseTo(0.65)
  })

  it('rejects a param ref outside the closed set', () => {
    expect(ParamValue.safeParse('$cluster.lat').success).toBe(true)
    expect(ParamValue.safeParse('$cluster.lat,$cluster.lng').success).toBe(true)
    expect(ParamValue.safeParse('$constraint.c3.max_seconds').success).toBe(true)
    expect(ParamValue.safeParse('$entity.address').success).toBe(false)
    expect(ParamValue.safeParse('$listing.id').success).toBe(false)
  })

  it('leaves ordinary strings alone', () => {
    expect(ParamValue.safeParse('bicycling').success).toBe(true)
  })
})

describe('evidence', () => {
  const row = {
    entity_id: 'zillow:12345',
    constraint_id: 'c3',
    constraint_type: 'commute',
    verdict: 'pass',
    value_canonical: 1080,
    display_value: '18 min',
    source: 'google_maps_directions',
    source_url: 'https://example.com/route',
    fetched_at_ms: 1756400000000,
    ttl_seconds: 604800,
    expires_at_ms: 1757004800000,
    confidence: 1,
    eval_state: 'evaluated',
    capability_id: 'commute.directions.entity',
    op_id: 'op_7',
  }

  it('accepts a fetched fact', () => {
    expect(EvidenceRow.safeParse(row).success).toBe(true)
  })

  it('carries a failed evaluation as unknown rather than as a rejection', () => {
    const failed = EvidenceRow.parse({
      ...row,
      verdict: 'unknown',
      eval_state: 'failed',
      value_canonical: null,
      display_value: 'could not verify',
      confidence: 0,
    })
    expect(failed.verdict).toBe('unknown')
    expect(failed.eval_state).toBe('failed')
  })

  it('carries a price range without collapsing it', () => {
    const range = EvidenceRow.parse({
      ...row,
      constraint_id: 'c1',
      constraint_type: 'budget',
      verdict: 'unknown',
      value_canonical: 275000,
      value_canonical_upper: 310000,
      display_value: '$2,750 to $3,100',
      confidence: 0.6,
      source: 'zillow',
    })
    expect(range.value_canonical_upper).toBe(310000)
  })
})

describe('registry seed', () => {
  const seed = JSON.parse(
    readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8'),
  )

  it('validates every row', () => {
    const parsed = Registry.parse(seed)
    expect(parsed.capabilities.length).toBeGreaterThan(0)
  })

  it('gives every capability a unique id', () => {
    const ids = seed.capabilities.map((c: { capability_id: string }) => c.capability_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prices native capabilities at zero and everything else above it', () => {
    for (const c of Registry.parse(seed).capabilities) {
      if (c.granularity === 'native') expect(c.cost_units).toBe(0)
      else expect(c.cost_units).toBeGreaterThan(0)
    }
  })

  it('covers every constraint type the parser can emit', () => {
    const answered = new Set(Registry.parse(seed).capabilities.map((c) => c.constraint_type))
    for (const type of ConstraintType.options) expect(answered).toContain(type)
  })

  it('keeps every param ref inside the closed set', () => {
    for (const c of Registry.parse(seed).capabilities) {
      for (const value of Object.values(c.params_template)) {
        for (const ref of paramRefs(value)) expect(ref).toMatch(ParamRefPattern)
      }
    }
  })

  it('resolves a source conflict by precedence, entity over cluster', () => {
    const rows = Registry.parse(seed).capabilities
    const cluster = rows.find((c) => c.capability_id === 'commute.directions.cluster')!
    const entity = rows.find((c) => c.capability_id === 'commute.directions.entity')!
    expect(entity.precedence).toBeLessThan(cluster.precedence)
  })
})
