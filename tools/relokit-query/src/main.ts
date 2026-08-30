import { ask, httpTransport } from '@relokit/client'

/**
 * The whole question from a terminal. Same flow the browser runs, so what is
 * seen here and what is seen there cannot disagree.
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

const result = await ask(httpTransport(api, orgKey), query, {
  concurrency: Number(process.env.RELOKIT_CONCURRENCY ?? 1),
  onProgress: (event) => {
    if (event.kind === 'parsed') {
      console.log(`parsed by ${event.answered_by}, ${event.repairs.length} numbers re-read\n`)
      for (const c of event.constraint_set.constraints) {
        console.log(`  ${c.id} ${c.type.padEnd(16)}${c.inferred ? '~' : ' '} ${c.source_text}`)
      }
    }
    if (event.kind === 'planned') {
      console.log('\nplan')
      for (const stage of event.plan.stages) {
        console.log(
          `  ${stage.stage_id.padEnd(11)} ${stage.tier.padEnd(7)} ${stage.ops.length} ops, ~${stage.estimated_cost_units} searches`,
        )
      }
    }
    if (event.kind === 'accepted') {
      console.log(
        `\nrun ${event.run_id} accepted, priced at worst ${event.worst_case_units} against a ceiling of ${event.ceiling_cost_units}`,
      )
    }
    if (event.kind === 'stage') {
      console.log(`  ${event.stage_id.padEnd(11)} ${event.entities_in} -> ${event.entities_out}`)
    }
    if (event.kind === 'skipped') console.log(`  ${event.stage_id} skipped: ${event.reason}`)
  },
})

console.log(
  `\ncost: ${result.cost.naive_units} naive, ${result.cost.planned_units} planned, ${result.cost.actual_units} spent`,
)
console.log(
  `  ${result.cost.live} live, ${result.cost.cache_hits} already fetched, ${result.cost.ledger_hits} already known`,
)

for (const problem of result.problems) console.log(`  ! ${problem.op_id}: ${problem.detail}`)
for (const entry of result.unanswered) console.log(`  ! ${entry.constraint_id}: ${entry.reason}`)

const { results, unverified, rejections } = result.buckets
console.log(
  `\n${results.length} verified, ${unverified.length} unverified, ${rejections.length} rejected`,
)

for (const entry of results.slice(0, 4)) {
  const entity = result.entities.find((e) => e.entity_id === entry.entity_id)!
  console.log(`\n  ${entity.title.slice(0, 58)}`)
  for (const row of entry.evidence) console.log(`      ${row.constraint_id}  ${row.display_value}`)
}

for (const option of result.relaxations) {
  console.log(`\n  ${option.source_text} (now ${option.display_from})`)
  for (const step of option.steps) console.log(`      ${step.display_to} would add ${step.unlocks}`)
}
