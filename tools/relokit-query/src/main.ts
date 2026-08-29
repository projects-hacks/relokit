import { plan } from '@relokit/planner'
import { normalizeConstraintSet, PARSER_VERSION } from '@relokit/llm'
import { Registry, type Capability } from '@relokit/schema'

/**
 * The client flow, exactly as the browser will do it.
 *
 * Xano parses, because it holds the model key. The repair and the planner run
 * here, because they are deterministic and cost nothing. Xano then re-prices
 * the plan against its own registry before spending a search on it.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The checks below say what is missing.
}

const base = (process.env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
const api = `${base}/api:${process.env.XANO_API_GROUP ?? 'vZQqb3Je'}`
const orgKey = process.env.RELOKIT_ORG_KEY
if (!orgKey) {
  console.error('RELOKIT_ORG_KEY is not set. Run: pnpm xano:seed --create-org')
  process.exit(1)
}

const query = process.argv.slice(2).join(' ')
if (!query) {
  console.error('usage: pnpm ask "<a relocation question>"')
  process.exit(1)
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_key: orgKey, ...body }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

const parsed = await post('/parse', { query })
console.log(`parsed by ${parsed.answered_by}, registry ${parsed.registry_version}`)

const json = readJson(parsed.raw_text)
const { constraint_set, repairs, dropped } = normalizeConstraintSet(json, query, {
  query_id: `q_${Date.now()}`,
  parser_version: PARSER_VERSION,
  parsed_at_ms: Date.now(),
})

console.log(
  `\n${constraint_set.constraints.length} constraints, ${dropped.length} dropped, ${repairs.length} repaired`,
)
for (const c of constraint_set.constraints) {
  console.log(`  ${c.id} ${c.type.padEnd(16)}${c.inferred ? '~' : ' '} ${c.source_text}`)
}

const registry = Registry.parse({
  registry_version: parsed.registry_version,
  capabilities: parsed.registry as Capability[],
})

const result = plan({
  constraints: constraint_set,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: parsed.budget,
  now_ms: Date.now(),
})

console.log(`\nplan ${result.plan_id}`)
for (const stage of result.stages) {
  console.log(
    `  ${String(stage.index)} ${stage.stage_id.padEnd(11)} ${stage.tier.padEnd(7)} ${stage.ops.length} ops, ~${stage.estimated_cost_units} searches`,
  )
}
console.log(
  `  naive ${result.trace.naive_cost_units}, pushdown only ${result.trace.pushdown_only_cost_units}, planned ${result.trace.planned_cost_units}`,
)

const run = await post('/run', { constraint_set, plan: result })
console.log(`\nrun ${run.run_id} accepted`)
console.log(
  `  server priced the worst case at ${run.worst_case_units} against a ceiling of ${run.ceiling_cost_units}`,
)
console.log(`  the plan expects ${run.planned_cost_units}`)

/** Models fence their JSON however they like, so take the outermost braces. */
function readJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('the model did not return JSON')
  return JSON.parse(text.slice(start, end + 1))
}
