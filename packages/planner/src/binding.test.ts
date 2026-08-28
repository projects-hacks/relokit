import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, Registry, type PlanInput } from '@relokit/schema'
import { closeDerived, infeasibleOps, requirementsOf } from './binding.ts'
import { plan } from './plan.ts'

const registry = Registry.parse(
  JSON.parse(readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8')),
)
const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
)
const input: PlanInput = {
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: { max_cost_units: 200, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
  now_ms: 1756400000000,
}
const capability = (id: string) => registry.capabilities.find((c) => c.capability_id === id)!

describe('requirements', () => {
  it('reads them off the params, so a row cannot understate what it needs', () => {
    expect(requirementsOf(capability('commute.geocode.region'), 'commute')).toEqual([])
    expect(requirementsOf(capability('commute.directions.cluster'), 'commute')).toEqual([
      'cluster',
      'constraint.destination_point',
    ])
    expect(requirementsOf(capability('commute.directions.entity'), 'commute')).toEqual([
      'constraint.destination_point',
      'entity',
    ])
    expect(requirementsOf(capability('candidates.zillow.region'), 'candidate_source')).toEqual([
      'stage.bounds',
    ])
  })
})

describe('derived bindings', () => {
  it('unlocks the box from a destination, and clusters from the box and the listings', () => {
    expect([...closeDerived(new Set())]).toEqual([])
    expect([...closeDerived(new Set(['constraint.destination_point']))]).toContain('stage.bounds')
    const all = closeDerived(new Set(['constraint.destination_point', 'entity']))
    expect([...all].sort()).toEqual([
      'cluster',
      'constraint.destination_point',
      'entity',
      'stage.bounds',
    ])
  })
})

describe('feasibility', () => {
  it('produces a plan whose every op can actually resolve its parameters', () => {
    expect(infeasibleOps(plan(input).stages, input.registry)).toEqual([])
  })

  it('catches a plan whose stages are in the wrong order', () => {
    const result = plan(input)
    const reversed = [...result.stages].reverse()
    const problems = infeasibleOps(reversed, input.registry)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.flatMap((p) => p.missing)).toContain('entity')
  })

  it('reports a constraint as unbound rather than emitting an op that cannot run', () => {
    // Take away the only thing that can turn an address into a point.
    const withoutGeocode = input.registry.filter(
      (c) => c.capability_id !== 'commute.geocode.region',
    )
    const result = plan({ ...input, registry: withoutGeocode })
    expect(result.unsatisfied).toContainEqual({ constraint_id: 'c3', reason: 'unbound' })
    expect(result.stages.flatMap((s) => s.ops).map((o) => o.capability_id)).not.toContain(
      'commute.directions.cluster',
    )
    expect(infeasibleOps(result.stages, withoutGeocode)).toEqual([])
  })

  it('keeps a prerequisite that eliminates nothing', () => {
    // The geocode scores zero on pruning power. It survives because without it
    // the commute rows never become feasible, not because of code ordering.
    const result = plan(input)
    const geocode = result.trace.candidates.find(
      (c) => c.capability_id === 'commute.geocode.region',
    )!
    expect(geocode.score).toBe(0)
    expect(geocode.chosen).toBe(true)
  })

  it('leaves everything downstream unbound when the search cannot be afforded', () => {
    // One unit buys the geocode and nothing else, so no listings are ever found.
    const result = plan({ ...input, budget: { ...input.budget, max_cost_units: 1 } })
    expect(result.stages.map((s) => s.stage_id)).toEqual(['bounds'])
    const reasons = Object.fromEntries(result.unsatisfied.map((u) => [u.constraint_id, u.reason]))
    expect(reasons.c4).toBe('unbound')
    expect(infeasibleOps(result.stages, input.registry)).toEqual([])
  })
})

describe('a signal that reads the candidate response', () => {
  // The demo query carries no area_signal, so nothing else exercises this path
  // and an enabled capability would sit unverified until Sunday.
  const withSignal = {
    ...constraints,
    constraints: [
      ...constraints.constraints,
      {
        id: 'c7',
        type: 'area_signal' as const,
        hardness: 'soft' as const,
        weight: 0.4,
        source_text: 'quiet street',
        inferred: false,
        topic: 'construction' as const,
        polarity: 'negative' as const,
        lookback_days: 30,
      },
    ],
  }
  const result = plan({ ...input, constraints: withSignal })

  it('waits for the listings, because that is where the region name comes from', () => {
    expect(requirementsOf(capability('area_signal.news.region'), 'area_signal')).toEqual([
      'stage.candidates',
    ])
    const order = result.stages.map((s) => s.stage_id)
    expect(order.indexOf('signals')).toBeGreaterThan(order.indexOf('candidates'))
    expect(infeasibleOps(result.stages, input.registry)).toEqual([])
  })

  it('never prunes, whatever it finds', () => {
    const signals = result.stages.find((s) => s.stage_id === 'signals')!
    expect(signals.prune).toBeNull()
  })

  it('goes unbound when there is no candidate search to name the region', () => {
    const withoutSource = input.registry.filter((c) => c.constraint_type !== 'candidate_source')
    const orphaned = plan({ ...input, constraints: withSignal, registry: withoutSource })
    expect(orphaned.unsatisfied).toContainEqual({ constraint_id: 'c7', reason: 'unbound' })
  })
})
