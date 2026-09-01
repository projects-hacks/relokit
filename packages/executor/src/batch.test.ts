import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from '@relokit/planner'
import { createClient } from '@relokit/serpapi'
import { replayRun } from './run.ts'

/**
 * Sending calls over in groups must change how they travel and nothing else.
 *
 * The whole demo run, replayed twice against the recorded responses: once a
 * call at a time, once in groups of six with every third group refused. Same
 * places, same facts, same verdicts, or the batching has quietly become a
 * second executor.
 */
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

const options = { now_ms: NOW, evaluation_days: ['tue' as const], overshoot_factor: 1.3 }

describe('the demo run, one call at a time and in groups', () => {
  it('answers identically, even when groups keep failing', async () => {
    const client = createClient({ mode: 'replay' })
    const alone = await replayRun(
      planned,
      constraints,
      registry.capabilities,
      (engine, params) => client.search(engine, params),
      options,
    )

    const sizes: number[] = []
    let groups = 0
    const together = await replayRun(
      planned,
      constraints,
      registry.capabilities,
      (engine, params) => client.search(engine, params),
      {
        ...options,
        searchBatch: async (requests) => {
          groups += 1
          sizes.push(requests.length)
          // Every third group dies the way a gateway kills one: after the
          // fact, with the work done. The fallback must repeat it unharmed.
          if (groups % 3 === 0) throw new Error('/ops returned 502: <html>')
          return Promise.all(requests.map((r) => client.search(r.engine, r.params)))
        },
      },
    )

    expect(sizes.every((size) => size <= 6)).toBe(true)
    expect(groups).toBeGreaterThan(1)
    // The answer, not the transport, is what must not change.
    expect(together.entities.map((e) => e.entity_id)).toEqual(
      alone.entities.map((e) => e.entity_id),
    )
    expect(together.evidence.length).toBe(alone.evidence.length)
    expect(together.buckets.results.map((r) => r.entity_id)).toEqual(
      alone.buckets.results.map((r) => r.entity_id),
    )
    expect(together.buckets.rejections.length).toBe(alone.buckets.rejections.length)
  })
})
