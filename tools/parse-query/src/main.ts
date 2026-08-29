import { parseQuery } from '@relokit/llm/node'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env. The provider will say what is missing.
}

const query = process.argv.slice(2).join(' ')
if (!query) {
  console.error('usage: pnpm parse "<a relocation question>"')
  process.exit(1)
}

const result = await parseQuery(query, {
  query_id: 'q_cli',
  now_ms: Date.now(),
})

console.log(`${result.model}, ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}\n`)
for (const c of result.constraint_set.constraints) {
  const detail = JSON.stringify(c, (k, v) =>
    ['id', 'type', 'hardness', 'weight', 'source_text', 'inferred'].includes(k) ? undefined : v,
  )
  console.log(`  ${c.id} ${c.type.padEnd(16)}${c.inferred ? '~' : ' '} ${detail}`)
  console.log(`     from "${c.source_text}"`)
}
if (result.repairs.length > 0) {
  console.log('\nrepaired')
  for (const r of result.repairs) {
    console.log(
      `  ${r.constraint_id}.${r.field}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`,
    )
    console.log(`     ${r.why}`)
  }
}
if (result.dropped.length > 0) {
  console.log('\ndropped')
  for (const d of result.dropped) console.log(`  #${d.index}: ${d.reason}`)
}
