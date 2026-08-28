import { readFileSync } from 'node:fs'
import { ConstraintSet, Registry } from '@relokit/schema'
import { plan } from '@relokit/planner'

const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))
const constraints = ConstraintSet.parse(
  JSON.parse(readFileSync('fixtures/queries/relocation-san-jose.json', 'utf8')),
)
const r = plan({
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: { max_cost_units: 200, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
  now_ms: 1756400000000,
})
for (const s of r.stages) {
  console.log(
    `${s.index} ${s.stage_id.padEnd(11)} ${s.tier.padEnd(7)} ops=${String(s.ops.length).padStart(2)} cost=${String(s.estimated_cost_units).padStart(3)} -> ${s.expected_entities} entities`,
  )
  for (const o of s.ops) console.log(`      ${o.capability_id} [${o.constraint_ids.join(',')}]`)
}
console.log(
  '\ncost:',
  r.trace.naive_cost_units,
  'naive |',
  r.trace.pushdown_only_cost_units,
  'pushdown only |',
  r.trace.planned_cost_units,
  'planned',
)
console.log('unsatisfied:', r.unsatisfied)
console.log('\ndecisions:')
r.trace.decisions.forEach((d) => console.log(`  ${d.step}: ${d.detail}`))
