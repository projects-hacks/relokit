import { plan } from '@relokit/planner'
import { normalizeConstraintSet, PARSER_VERSION } from '@relokit/llm'
import { Registry, type Capability } from '@relokit/schema'
import { bucket, relaxations } from '@relokit/evidence'
import { replayRun } from '../../replay-run/src/run.ts'

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

async function get(path: string) {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${api}${path}${separator}org_key=${encodeURIComponent(orgKey!)}`
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** Models fence their JSON however they like, so take the outermost braces. */
function readJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('the model did not return JSON')
  return JSON.parse(text.slice(start, end + 1))
}

// The stage walk runs here because the plan is already here. Every call inside
// it goes to /op, which holds the key and decides whether the call is made at
// all, so nothing about the spending moves to the client.
const outcome = await replayRun(
  result,
  constraint_set,
  registry.capabilities,
  async (_engine, params, context) => {
    const answer = await post('/op', {
      run_id: run.run_id,
      op_id: context.op_id,
      capability_id: context.capability_id,
      endpoint: context.endpoint,
      ttl_seconds: context.ttl_seconds,
      constraint_ids: context.constraint_ids,
      entity_ids: context.entity_ids,
      params,
    })
    return answer.body
  },
  {
    now_ms: Date.now(),
    evaluation_days: ['tue'],
    overshoot_factor: parsed.budget.overshoot_factor,
  },
)

console.log('\nstages')
for (const stage of outcome.stages) {
  console.log(
    `  ${stage.stage_id.padEnd(11)} ${String(stage.calls).padStart(3)} ops  ${stage.entities_in} -> ${stage.entities_out}`,
  )
}
for (const skipped of outcome.skipped)
  console.log(`  ${skipped.stage_id} skipped: ${skipped.reason}`)

await post('/ingest', {
  run_id: run.run_id,
  entities: outcome.entities.map((entity) => ({
    entity_id: entity.entity_id,
    kind: 'listing',
    provider: 'zillow',
    lat: entity.point?.lat ?? null,
    lng: entity.point?.lng ?? null,
    display: entity,
  })),
  evidence: outcome.evidence.map((row) => ({
    ...row,
    value_canonical: typeof row.value_canonical === 'number' ? row.value_canonical : null,
    value_text: typeof row.value_canonical === 'string' ? row.value_canonical : null,
  })),
})

const stored = await get(`/runs?run_id=${run.run_id}`)
const byStatus = new Map<string, number>()
for (const op of stored.ops as { status: string }[]) {
  byStatus.set(op.status, (byStatus.get(op.status) ?? 0) + 1)
}
console.log(
  `\ncost: ${stored.cost.naive_units} naive, ${stored.cost.planned_units} planned, ` +
    `${stored.cost.actual_units} actually spent`,
)
console.log(
  `  ${byStatus.get('ok') ?? 0} live, ${byStatus.get('cache_hit') ?? 0} already fetched, ` +
    `${byStatus.get('ledger_hit') ?? 0} already known`,
)

const buckets = bucket(outcome.entities, outcome.evidence, constraint_set.constraints)
console.log(
  `\n${buckets.results.length} verified, ${buckets.unverified.length} unverified, ${buckets.rejections.length} rejected`,
)
for (const entry of buckets.results.slice(0, 4)) {
  const entity = outcome.entities.find((e) => e.entity_id === entry.entity_id)!
  console.log(`\n  ${entity.title.slice(0, 58)}`)
  for (const row of entry.evidence) console.log(`      ${row.constraint_id}  ${row.display_value}`)
}

for (const option of relaxations(buckets, constraint_set.constraints)) {
  console.log(`\n  ${option.source_text} (now ${option.display_from})`)
  for (const step of option.steps) console.log(`      ${step.display_to} would add ${step.unlocks}`)
}
