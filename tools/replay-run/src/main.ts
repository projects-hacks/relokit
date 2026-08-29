import { readFileSync } from 'node:fs'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from '@relokit/planner'
import { createClient } from '@relokit/serpapi'
import { relaxations } from '@relokit/evidence'
import { replayRun } from '@relokit/executor'

/**
 * Runs the demo query end to end against recorded fixtures.
 *
 * Replay only. It cannot reach the network, so it cannot quietly become the
 * executor: that is Xano's job, and this exists to prove the contract works and
 * to give the Xano stack an output to match.
 */
const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
const constraints = ConstraintSet.parse(
  JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
)

const clusterCount = Number(process.env.RELOKIT_CLUSTERS ?? 12)
const result = plan({
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: {
    max_cost_units: 400,
    max_stages: 6,
    cluster_count: clusterCount,
    overshoot_factor: 1.3,
  },
  now_ms: Date.parse('2026-08-28T12:00:00Z'),
})

const client = createClient({ mode: 'replay' })
const outcome = await replayRun(
  result,
  constraints,
  registry.capabilities,
  (engine, params) => client.search(engine, params),
  {
    now_ms: Date.parse('2026-08-28T12:00:00Z'),
    evaluation_days: ['tue'],
    overshoot_factor: 1.3,
  },
)

console.log('stages')
for (const stage of outcome.stages) {
  console.log(
    `  ${stage.stage_id.padEnd(11)} ${String(stage.calls).padStart(3)} calls  ${stage.entities_in} -> ${stage.entities_out}`,
  )
}

console.log(
  `\n${outcome.calls} calls made, ${outcome.missing.length} without a fixture` +
    `  (planned ${result.trace.planned_cost_units}, naive ${result.trace.naive_cost_units})`,
)

const { results, unverified, rejections } = outcome.buckets
console.log(
  `\n${results.length} verified, ${unverified.length} unverified, ${rejections.length} rejected\n`,
)

for (const entry of results.slice(0, 5)) {
  const entity = outcome.entities.find((e) => e.entity_id === entry.entity_id)!
  console.log(`  ${entity.title.slice(0, 52)}  score ${entry.score.toFixed(3)}`)
  for (const evidence of entry.evidence) {
    console.log(
      `      ${evidence.constraint_id}  ${evidence.verdict.padEnd(7)} ${evidence.display_value}`,
    )
  }
}

if (rejections.length > 0) {
  console.log('\nrejected')
  for (const entry of rejections.slice(0, 4)) {
    const entity = outcome.entities.find((e) => e.entity_id === entry.entity_id)!
    const why = entry.evidence.find((e) => entry.failed_constraint_ids.includes(e.constraint_id))!
    console.log(`  ${entity.title.slice(0, 46)}  failed ${why.constraint_id}: ${why.display_value}`)
  }
}

const relax = relaxations(outcome.buckets, constraints.constraints)
if (relax.length > 0) {
  console.log('\nwhat one change would buy, at no further cost')
  for (const option of relax) {
    console.log(`  ${option.source_text}  (now ${option.display_from})`)
    for (const step of option.steps) {
      console.log(`      ${step.display_to.padEnd(10)} unlocks ${step.unlocks}`)
    }
  }
}

if (outcome.skipped.length > 0) {
  console.log('\nskipped')
  for (const stage of outcome.skipped) console.log(`  ${stage.stage_id}: ${stage.reason}`)
}

console.log('\nwhat each capability actually did')
console.log('  capability                       answered  decisive  coverage  selectivity')
for (const o of outcome.observed) {
  console.log(
    `  ${o.capability_id.padEnd(32)} ${String(o.answered).padStart(8)}  ${String(o.decisive).padStart(8)}  ${o.coverage.toFixed(2).padStart(8)}  ${o.selectivity.toFixed(2).padStart(11)}`,
  )
}

if (outcome.missing.length > 0) {
  const byEngine = new Map<string, number>()
  for (const miss of outcome.missing)
    byEngine.set(miss.engine, (byEngine.get(miss.engine) ?? 0) + 1)
  console.log('\nmissing fixtures')
  for (const [engine, count] of byEngine)
    console.log(`  ${count.toString().padStart(3)}  ${engine}`)
}
