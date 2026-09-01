import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, Registry, type Capability, type ObservationRow } from '@relokit/schema'
import { DECISIVE_THRESHOLD, applyObservations, regionKey } from './priors.ts'
import { plan } from './plan.ts'

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
  prior_basis: 'assumed',
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

const row = (over: Partial<ObservationRow> = {}): ObservationRow => ({
  capability_id: 'test.cap',
  region: 'san jose, ca',
  answered: 12,
  decisive: 12,
  passed: 6,
  ...over,
})

const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url), 'utf8'),
  ),
)

describe('the honesty ladder', () => {
  it('a place with enough decisive answers beats the global tally, which beats the guess', () => {
    const rows = [
      row({ region: 'san jose, ca', answered: 20, decisive: 10, passed: 2 }),
      row({ region: 'lisbon', answered: 10, decisive: 10, passed: 10 }),
    ]
    const [here] = applyObservations([cap()], rows, 'san jose, ca')
    expect(here).toMatchObject({
      selectivity_prior: 0.2,
      coverage: 0.5,
      prior_basis: 'measured_here',
      observation_n: 10,
    })
    // Same rows, a town neither of them mentions: everything pools.
    const [anywhere] = applyObservations([cap()], rows, 'austin')
    expect(anywhere).toMatchObject({
      selectivity_prior: 0.6,
      coverage: 0.67,
      prior_basis: 'measured',
      observation_n: 20,
    })
  })

  it('below the threshold the guess stands and says assumed', () => {
    const rows = [row({ decisive: DECISIVE_THRESHOLD - 1, passed: 0 })]
    // A stale stored n must not survive as if it backed the guess.
    const [kept] = applyObservations([cap({ observation_n: 20 })], rows, 'san jose, ca')
    expect(kept).toMatchObject({
      selectivity_prior: 0.35,
      coverage: 1,
      prior_basis: 'assumed',
      observation_n: 0,
    })
  })

  it('a measured pass rate of zero replaces the guess rather than vanishing', () => {
    const rows = [row({ answered: 12, decisive: 12, passed: 0 })]
    const measured = applyObservations([cap()], rows, 'san jose, ca')[0]!
    expect(measured.selectivity_prior).toBe(0)
    expect(measured.prior_basis).toBe('measured_here')
  })

  it('counts sum across runs before the ratio is taken', () => {
    const rows = [
      row({ answered: 2, decisive: 2, passed: 2 }),
      row({ answered: 18, decisive: 18, passed: 0 }),
    ]
    const summed = applyObservations([cap()], rows, 'san jose, ca')[0]!
    // 2 of 20, not the average of 100 percent and 0 percent.
    expect(summed.selectivity_prior).toBe(0.1)
    expect(summed.observation_n).toBe(20)
  })

  it('never mutates the registry it was given', () => {
    const original = cap()
    applyObservations([original], [row()], 'san jose, ca')
    expect(original.selectivity_prior).toBe(0.35)
    expect(original.prior_basis).toBe('assumed')
  })
})

describe('the region key', () => {
  it('recognises the same place written differently, without carrying it', () => {
    const key = regionKey(constraints)
    expect(regionKey({ ...constraints, search_anchor: { raw: '  San  Jose,  CA ' } })).toBe(key)
    // Rows travel to every reader, so the address itself must not be in them.
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(key).not.toContain('san jose')
    expect(regionKey({ ...constraints, search_anchor: { raw: 'Lisbon' } })).not.toBe(key)
  })

  it('no place named, or the reader\'s own location, never earns a regional number', () => {
    expect(regionKey({ ...constraints, search_anchor: undefined })).toBeNull()
    expect(regionKey({ ...constraints, search_anchor: { raw: 'your location' } })).toBeNull()
    const rows = [row({ region: null, answered: 40, decisive: 40, passed: 20 })]
    const pooled = applyObservations([cap()], rows, null)[0]!
    expect(pooled.prior_basis).toBe('measured')
  })
})

describe('the plan trace', () => {
  it('carries each substituted basis and n for the reader', () => {
    const seed = Registry.parse(
      JSON.parse(readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8')),
    )
    const rows = [
      row({
        capability_id: 'commute.directions.cluster',
        region: regionKey(constraints),
        answered: 12,
        decisive: 12,
        passed: 6,
      }),
    ]
    const planned = plan({
      constraints,
      registry: applyObservations(seed.capabilities, rows, regionKey(constraints)),
      registry_version: seed.registry_version,
      budget: { max_cost_units: 400, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
      now_ms: Date.parse('2026-08-28T12:00:00Z'),
    })
    const traced = planned.trace.candidates.find(
      (candidate) => candidate.capability_id === 'commute.directions.cluster',
    )
    expect(traced).toMatchObject({
      selectivity_prior: 0.5,
      prior_basis: 'measured_here',
      observation_n: 12,
    })
    const untouched = planned.trace.candidates.find(
      (candidate) => candidate.capability_id !== 'commute.directions.cluster',
    )
    expect(untouched).toMatchObject({ prior_basis: 'assumed', observation_n: 0 })
  })
})
