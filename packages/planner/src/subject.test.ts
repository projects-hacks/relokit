import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from './plan.ts'

const registry = Registry.parse(
  JSON.parse(readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8')),
)

const set = (subject: string) =>
  ConstraintSet.parse({
    query_id: 'q',
    raw_query: 'somewhere in San Jose',
    subject,
    locale: { tz: 'America/Los_Angeles', currency: 'USD' },
    search_anchor: { raw: 'San Jose' },
    constraints: [],
    parser_version: 'parse.v1.md',
    parsed_at_ms: 1_756_400_000_000,
  })

const run = (subject: string) =>
  plan({
    constraints: set(subject),
    registry: registry.capabilities,
    registry_version: registry.registry_version,
    budget: { max_cost_units: 400, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
    now_ms: Date.parse('2026-08-30T12:00:00Z'),
  })

describe('what is being looked for', () => {
  it('plans a search when a source can produce the subject', () => {
    const ops = run('rental').stages.flatMap((stage) => stage.ops)
    expect(ops.some((op) => op.capability_id === 'candidates.zillow.region')).toBe(true)
  })

  it('will not answer with a source that produces something else', () => {
    // Zillow cannot produce restaurants, and no other source can yet, so the
    // plan has nothing to search with rather than searching for the wrong thing.
    const ops = run('restaurant').stages.flatMap((stage) => stage.ops)
    expect(ops.some((op) => op.capability_id === 'candidates.zillow.region')).toBe(false)
  })
})
