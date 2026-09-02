import { readFileSync, writeFileSync } from 'node:fs'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from '@relokit/planner'
import { createClient } from '@relokit/serpapi'
import { relaxations } from '@relokit/evidence'
import { replayRun } from '@relokit/executor'

/**
 * The demo run, serialised for the interface to restore.
 *
 * The whole answer computed from committed fixtures, written where the web app
 * can load it with no backend at all. This is the fallback for a demo where
 * nothing is reachable, and the fixture for walking every screen.
 */
const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
const constraints = ConstraintSet.parse(
  JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
)

const planned = plan({
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: { max_cost_units: 400, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
  now_ms: Date.parse('2026-08-28T12:00:00Z'),
})

const client = createClient({ mode: 'replay' })
const outcome = await replayRun(
  planned,
  constraints,
  registry.capabilities,
  (engine, params) => client.search(engine, params),
  { now_ms: Date.parse('2026-08-28T12:00:00Z'), evaluation_days: ['tue'], overshoot_factor: 1.3 },
)

const result = {
  run_id: 0,
  constraint_set: constraints,
  repairs: [],
  plan: planned,
  entities: outcome.entities,
  evidence: outcome.evidence,
  buckets: outcome.buckets,
  relaxations: relaxations(outcome.buckets, constraints.constraints),
  anchor: null,
  problems: [],
  unanswered: [],
  cost: {
    // Read off the plan rather than typed in, so the shipped demo cannot go on
    // claiming a number the planner has stopped producing.
    naive_units: planned.trace.naive_cost_units,
    planned_units: planned.trace.planned_cost_units,
    actual_units: outcome.calls,
    live: 0,
    cache_hits: outcome.calls,
    ledger_hits: 0,
  },
}

writeFileSync(
  'apps/web/public/demo-run.json',
  JSON.stringify({ query: constraints.raw_query, result }),
)
console.log(
  `wrote demo-run.json: ${result.entities.length} entities, ` +
    `${result.buckets.results.length}/${result.buckets.unverified.length}/${result.buckets.rejections.length} buckets`,
)
