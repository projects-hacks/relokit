import { readFileSync } from 'node:fs'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from '@relokit/planner'
import { createClient, type Engine } from '@relokit/serpapi'
import { replayRun } from '@relokit/executor'

/**
 * Records whatever the demo run is missing, one stage at a time.
 *
 * Separate binary from the replay, and the only half that can spend a credit.
 * Runs dry unless told otherwise, because the bill is a function of the cluster
 * count and that is worth seeing before paying it.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env. Dry runs need no key.
}

const wet = process.argv.includes('--record')
// The same default as the replay. They disagreed at six against twelve, which
// gave the two tools different centroids and so different journeys, and a
// recorder that cannot satisfy the replayer records the wrong six things
// forever.
const clusters = Number(process.env.RELOKIT_CLUSTERS ?? 12)

const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
const constraints = ConstraintSet.parse(
  JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
)
const now = Date.parse('2026-08-28T12:00:00Z')

const result = plan({
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: { max_cost_units: 400, max_stages: 6, cluster_count: clusters, overshoot_factor: 1.3 },
  now_ms: now,
})

const replay = createClient({ mode: 'replay' })
const live = createClient({ mode: 'record', slug: 'demo' })

let recorded = 0
let reused = 0
const wouldRecord: { engine: Engine; params: Record<string, unknown> }[] = []

const search = async (engine: Engine, params: Record<string, string | number | boolean>) => {
  try {
    const body = await replay.search(engine, params)
    reused += 1
    return body
  } catch {
    if (!wet) {
      wouldRecord.push({ engine, params })
      throw new Error('dry run')
    }
    const body = await live.search(engine, params)
    recorded += 1
    return body
  }
}

const outcome = await replayRun(result, constraints, registry.capabilities, search, {
  now_ms: now,
  evaluation_days: ['tue'],
  overshoot_factor: 1.3,
})

console.log(`clusters ${clusters}  |  reused ${reused}  |  recorded ${recorded}`)

if (!wet) {
  const byEngine = new Map<string, number>()
  for (const call of wouldRecord) byEngine.set(call.engine, (byEngine.get(call.engine) ?? 0) + 1)
  console.log(`\nwould spend ${wouldRecord.length} searches:`)
  for (const [engine, count] of byEngine) console.log(`  ${String(count).padStart(3)}  ${engine}`)
  console.log('\nrun again with --record to record them')
} else {
  const { results, unverified, rejections } = outcome.buckets
  console.log(
    `${results.length} verified, ${unverified.length} unverified, ${rejections.length} rejected`,
  )
}
