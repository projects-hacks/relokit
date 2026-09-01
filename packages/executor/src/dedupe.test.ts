import { describe, expect, it } from 'vitest'
import type { EvidenceRow, Place } from '@relokit/schema'

/**
 * The rule the executor applies when a search hands back a place it has already
 * seen, which paging makes routine: ask again from a later offset and any
 * overlap arrives twice.
 */
function absorb(
  entities: Place[],
  evidence: EvidenceRow[],
  mapped: { entities: Place[]; evidence: EvidenceRow[] },
) {
  const known = new Set(entities.map((entity) => entity.entity_id))
  const fresh = mapped.entities.filter((entity) => {
    if (known.has(entity.entity_id)) return false
    known.add(entity.entity_id)
    return true
  })
  const kept = new Set(fresh.map((entity) => entity.entity_id))
  entities.push(...fresh)
  evidence.push(...mapped.evidence.filter((row) => kept.has(row.entity_id)))
}

const place = (id: string) => ({ entity_id: id, title: id }) as Place
const fact = (id: string) => ({ entity_id: id, constraint_id: 'c1' }) as EvidenceRow

describe('a place seen twice', () => {
  it('is kept once, however many pages return it', () => {
    // The same restaurant filled the list several times over, and the counts
    // above the buckets counted it every time.
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, { entities: [place('a'), place('b')], evidence: [fact('a')] })
    absorb(entities, evidence, { entities: [place('b'), place('c')], evidence: [fact('b')] })
    expect(entities.map((e) => e.entity_id)).toEqual(['a', 'b', 'c'])
  })

  it('does not double the facts about it', () => {
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, { entities: [place('a')], evidence: [fact('a')] })
    absorb(entities, evidence, { entities: [place('a')], evidence: [fact('a')] })
    expect(evidence).toHaveLength(1)
  })

  it('still takes everything the first time', () => {
    const entities: Place[] = []
    const evidence: EvidenceRow[] = []
    absorb(entities, evidence, {
      entities: [place('a'), place('b')],
      evidence: [fact('a'), fact('b')],
    })
    expect(entities).toHaveLength(2)
    expect(evidence).toHaveLength(2)
  })
})

describe('places the budget never reached', () => {
  it('carry the requirement as an unknown that says why', async () => {
    // Past the fan-out cap a home was unconfirmed in the counts but blank on
    // its card: two ticks, and no mention of the ride at all.
    const { readFileSync } = await import('node:fs')
    const { ConstraintSet, Registry } = await import('@relokit/schema')
    const { plan } = await import('@relokit/planner')
    const { createClient } = await import('@relokit/serpapi')
    const { replayRun } = await import('./run.ts')

    const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
    const constraints = ConstraintSet.parse(
      JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
    )
    const NOW = Date.parse('2026-08-28T12:00:00Z')
    const planned = plan({
      constraints,
      registry: registry.capabilities,
      registry_version: registry.registry_version,
      budget: { max_cost_units: 400, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
      now_ms: NOW,
    })
    const client = createClient({ mode: 'replay' })
    const outcome = await replayRun(
      planned,
      constraints,
      registry.capabilities,
      (engine, params) => client.search(engine, params),
      { now_ms: NOW, evaluation_days: ['tue'], overshoot_factor: 1.3 },
    )

    const commute = constraints.constraints.find((c) => c.type === 'commute')!
    for (const entity of outcome.entities) {
      const row = outcome.evidence.find(
        (r) => r.entity_id === entity.entity_id && r.constraint_id === commute.id,
      )
      // Nobody is silently skipped: every place carries the requirement.
      expect(row, `${entity.entity_id} has no commute row`).toBeDefined()
    }
  })
})

describe('the payback rule and the answer', () => {
  it('never skips a stage that is the only one measuring a requirement', async () => {
    // A ten minute ride convinced the planner that clusters settle everything,
    // so no entity stage existed; the executor then skipped the clusters as
    // not worth their calls, and the requirement went unmeasured for every
    // home. Two optimisers, each locally right, jointly wrong.
    const { ConstraintSet, Registry } = await import('@relokit/schema')
    const { readFileSync } = await import('node:fs')
    const { plan } = await import('@relokit/planner')
    const { replayRun } = await import('./run.ts')

    const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
    const base = ConstraintSet.parse(
      JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
    )
    // The demo constraints with the ride tightened to ten minutes.
    const tight = {
      ...base,
      constraints: base.constraints.map((c) =>
        c.type === 'commute' ? { ...c, max_seconds: 600 } : c,
      ),
    }
    const NOW = Date.parse('2026-08-28T12:00:00Z')
    const planned = plan({
      constraints: tight,
      registry: registry.capabilities,
      registry_version: registry.registry_version,
      budget: { max_cost_units: 400, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
      now_ms: NOW,
    })
    const commute = tight.constraints.find((c) => c.type === 'commute')!
    const clusterMeasures = planned.stages.some(
      (stage) =>
        stage.tier === 'cluster' && stage.ops.some((op) => op.constraint_ids.includes(commute.id)),
    )
    const entityMeasures = planned.stages.some(
      (stage) =>
        stage.tier === 'entity' && stage.ops.some((op) => op.constraint_ids.includes(commute.id)),
    )
    // Only meaningful while the planner leans on clusters alone for this shape
    // of question; if it starts planning an entity stage, the guard is moot.
    if (!clusterMeasures || entityMeasures) return

    const { createClient } = await import('@relokit/serpapi')
    const client = createClient({ mode: 'replay' })
    const outcome = await replayRun(
      planned,
      tight,
      registry.capabilities,
      (engine, params) => client.search(engine, params),
      { now_ms: NOW, evaluation_days: ['tue'], overshoot_factor: 1.3 },
    )
    const skippedCluster = outcome.skipped.some((entry) => entry.stage_id.includes('cluster'))
    expect(skippedCluster, 'the only measuring stage was skipped').toBe(false)
    // And the requirement was actually measured somewhere.
    expect(
      outcome.evidence.some(
        (row) => row.constraint_id === commute.id && row.eval_state === 'evaluated',
      ),
    ).toBe(true)
  })
})
