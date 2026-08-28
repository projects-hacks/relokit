import { createClient } from '@relokit/serpapi'
import { AMENITY_TERMS, fieldCoverage, findRecords, termHits } from './coverage.ts'
import { SCENARIOS } from './scenarios.ts'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env. The client will complain if a key is actually needed.
}

const name = process.argv[2]
const scenario = name ? SCENARIOS[name] : undefined

if (!scenario) {
  console.error(`usage: pnpm record <scenario>\n\nscenarios:`)
  for (const [key, s] of Object.entries(SCENARIOS)) console.error(`  ${key}\n    ${s.question}`)
  process.exit(1)
}

const client = createClient({ mode: 'record', slug: scenario.slug })

console.log(`recording ${scenario.slug} (${scenario.engine})`)
console.log(`question: ${scenario.question}\n`)

const body = await client.search(scenario.engine, scenario.params)
const { path, records } = findRecords(body)

if (records.length === 0) {
  console.log('no records found in the response. inspect the fixture by hand.')
  process.exit(0)
}

console.log(`${records.length} records at ${path || '<root>'}\n`)
console.log('field coverage')
for (const { key, pct } of fieldCoverage(records)) {
  console.log(`  ${String(pct).padStart(3)}%  ${key}`)
}

console.log('\namenity terms anywhere in the response')
for (const { term, hits } of termHits(body, AMENITY_TERMS)) {
  console.log(`  ${String(hits).padStart(4)}  ${term}`)
}

console.log(
  '\nPost this to the team. It decides whether listing_feature is free or costs a call per listing.',
)
