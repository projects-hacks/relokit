import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ConstraintSet,
  PlanResult,
  Registry,
  type Capability,
  type PlanInput,
} from '@relokit/schema'
import { PLANNER_VERSION, plan } from './plan.ts'

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

describe('plan', () => {
  const result = plan(input)

  it('returns a shape the wire contract accepts', () => {
    expect(() => PlanResult.parse(result)).not.toThrow()
  })

  it('is deterministic', () => {
    expect(JSON.stringify(plan(input))).toBe(JSON.stringify(result))
  })

  it('does not change when the registry rows arrive in another order', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let run = 0; run < 100; run++) {
      const rows = [...registry.capabilities]
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[rows[i], rows[j]] = [rows[j]!, rows[i]!]
      }
      expect(JSON.stringify(plan({ ...input, registry: rows }))).toBe(JSON.stringify(result))
    }
  })

  it('runs free predicates first and per entity work last', () => {
    // No signals stage here: the demo query carries no area_signal constraint.
    expect(result.stages.map((s) => s.stage_id)).toEqual([
      'bounds',
      'candidates',
      'clusters',
      'exact',
    ])
    expect(result.stages.map((s) => s.tier)).toEqual(['region', 'region', 'cluster', 'entity'])
  })

  it('pushes every free predicate into the one search', () => {
    const candidates = result.stages.find((s) => s.stage_id === 'candidates')!
    const params = candidates.ops[0]!.params
    expect(params.price).toBe('0,$constraint.c1.max_dollars')
    expect(params.beds).toBe('$constraint.c2.min,$constraint.c2.max')
    expect(params.amenities).toBe('$constraint.c5.feature')
    expect(candidates.estimated_cost_units).toBeLessThan(4)
  })

  it('rewrites self to the constraint the op is actually answering', () => {
    const ops = result.stages.flatMap((s) => s.ops)
    const raw = JSON.stringify(ops.map((o) => o.params))
    expect(raw).not.toContain('$constraint.self.')
    expect(raw).toContain('$constraint.c3.')
  })

  it('costs far less than checking every constraint on every listing', () => {
    const { naive_cost_units, pushdown_only_cost_units, planned_cost_units } = result.trace
    expect(planned_cost_units).toBeLessThan(pushdown_only_cost_units)
    expect(pushdown_only_cost_units).toBeLessThan(naive_cost_units)
  })

  it('prunes at cluster level only with slack', () => {
    const clusters = result.stages.find((s) => s.stage_id === 'clusters')!
    expect(clusters.prune!.on_fail).toContain('c3')
    const commuteSlack = clusters.prune!.slack.find((s) => s.constraint_id === 'c3')!
    expect(commuteSlack.extra_seconds).toBeGreaterThan(0)
    const poiSlack = clusters.prune!.slack.find((s) => s.constraint_id === 'c4')!
    expect(poiSlack.extra_meters).toBeGreaterThan(0)
  })

  it('never lets an error reject a listing', () => {
    const evaluations = result.stages
      .filter((s) => s.stage_id !== 'candidates')
      .flatMap((s) => s.ops)
    expect(evaluations.every((o) => o.on_error === 'unknown')).toBe(true)
  })

  it('explains why each capability won or lost', () => {
    const commute = result.trace.candidates.filter((c) => c.constraint_id === 'c3')
    expect(commute.map((c) => c.capability_id).sort()).toEqual([
      'commute.directions.cluster',
      'commute.directions.entity',
      'commute.geocode.region',
    ])
    // The geocode scores zero because it eliminates nothing. It is a
    // prerequisite rather than a filter, which is why the bounds stage is
    // emitted before the budget is consulted at all.
    const byId = Object.fromEntries(commute.map((c) => [c.capability_id, c]))
    expect(byId['commute.geocode.region']!.score).toBe(0)
    expect(byId['commute.directions.cluster']!.score).toBeGreaterThan(
      byId['commute.directions.entity']!.score!,
    )
  })
})

describe('unsatisfiable constraints', () => {
  it('keeps a constraint no capability can answer, rather than dropping it', () => {
    const withoutNews = input.registry.filter((c) => c.constraint_type !== 'area_signal')
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
          topic: 'noise' as const,
          polarity: 'negative' as const,
          lookback_days: 30,
        },
      ],
    }
    const result = plan({ ...input, constraints: withSignal, registry: withoutNews })
    expect(result.unsatisfied).toContainEqual({ constraint_id: 'c7', reason: 'no_capability' })
  })

  it('stops adding work once the budget is spent', () => {
    const result = plan({ ...input, budget: { ...input.budget, max_cost_units: 6 } })
    expect(result.estimated_cost_units).toBeLessThanOrEqual(6)
    expect(result.stages.some((s) => s.tier === 'entity')).toBe(false)
  })
})

describe('bounding box', () => {
  it('waits for the geocode when the destination has no coordinates', () => {
    expect(plan(input).search_bounds).toBeNull()
    expect(plan(input).stages[0]!.stage_id).toBe('bounds')
  })

  it('lays a grid once the destination is known', () => {
    const geocoded = {
      ...constraints,
      constraints: constraints.constraints.map((c) =>
        c.type === 'commute'
          ? { ...c, destination: { ...c.destination, point: { lat: 37.37268, lng: -121.96786 } } }
          : c,
      ),
    }
    const result = plan({ ...input, constraints: geocoded })
    expect(result.search_bounds).not.toBeNull()
    expect(result.clusters).toHaveLength(12)
    expect(result.clusters[0]!.radius_m).toBeGreaterThan(0)
    // 25 minutes at bike speed with overshoot is a few kilometres, not a few hundred metres.
    const spanKm = (result.search_bounds!.ne.lat - result.search_bounds!.sw.lat) * 111.32
    expect(spanKm).toBeGreaterThan(10)
    expect(spanKm).toBeLessThan(30)
  })
})

describe('plan identity', () => {
  it('changes when the registry version changes, so a row edit is traceable', () => {
    const other = plan({ ...input, registry_version: '2026-08-29.1' })
    expect(other.plan_id).not.toBe(plan(input).plan_id)
  })

  it('carries the planner version into the trace', () => {
    expect(plan(input).trace.planner_version).toBe(PLANNER_VERSION)
  })
})

describe('golden plan', () => {
  it('matches the committed snapshot for the demo query', async () => {
    // Any change to ordering, costing or op shape shows up here as a diff to
    // read rather than as a surprise on stage.
    await expect(JSON.stringify(plan(input), null, 2)).toMatchFileSnapshot(
      './__snapshots__/relocation-san-jose.plan.json',
    )
  })
})

describe('pagination', () => {
  const result = plan(input)
  const candidates = result.stages.find((s) => s.stage_id === 'candidates')!

  it('emits one op and a page budget, because the page count is data', () => {
    expect(candidates.ops).toHaveLength(1)
    expect(candidates.fanout).toBe('paged')
    expect(candidates.ops[0]!.params.page).toBe(1)
  })

  it('reserves budget for the pages the estimate expects', () => {
    expect(candidates.estimated_cost_units).toBeGreaterThan(candidates.ops[0]!.cost_units)
  })

  it('never budgets past the capability ceiling', () => {
    const source = input.registry.find((c) => c.capability_id === 'candidates.zillow.region')!
    expect(candidates.estimated_cost_units).toBeLessThanOrEqual(
      source.max_fanout * source.cost_units,
    )
  })

  it('caps the budget even when the estimate is far larger', () => {
    // Drop the free predicates and the box holds thousands of listings, which
    // would be a hundred pages if nothing bounded it.
    const noNatives = input.registry.filter((c) => c.granularity !== 'native')
    const wide = plan({ ...input, registry: noNatives })
    const stage = wide.stages.find((s) => s.stage_id === 'candidates')!
    expect(stage.estimated_cost_units).toBe(8)
  })
})
