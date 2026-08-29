import { readFileSync } from 'node:fs'
import { Registry } from '@relokit/schema'
import { PARSER_VERSION, parsePrompt } from '@relokit/llm/node'

/**
 * Loads this repository into a Xano instance.
 *
 * The registry and the prompt are both data, and both live in git. This is how
 * they get to the instance, and it is the only way they should: a row edited by
 * hand passes every test here and quietly changes what the demo does.
 *
 * Run it as often as you like. The registry import replaces a whole version and
 * the prompt import overwrites by name, so there is no half applied state.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env. The checks below will say what is missing.
}

const base = (process.env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
const group = process.env.XANO_API_GROUP ?? 'vZQqb3Je'
const adminKey = process.env.RELOKIT_ADMIN_KEY

if (!base) fail('XANO_INSTANCE_URL is not set')
if (!adminKey)
  fail('RELOKIT_ADMIN_KEY is not set, and must match relokit_admin_key on the instance')

const api = `${base}/api:${group}`

/**
 * The key travels in the body rather than in an Authorization header. Xano's
 * $request_auth_token is its own token format and mangles anything else: a
 * sixty four character key arrives one character short.
 */
async function post(path: string, body: Record<string, unknown>, key: string) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, admin_key: key }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))

const imported = await post(
  '/admin/registry/import',
  { registry_version: registry.registry_version, capabilities: registry.capabilities },
  adminKey,
)
console.log(
  `registry ${imported.registry_version}: ${imported.imported} capabilities in, ${imported.replaced} replaced`,
)

const prompt = await post(
  '/admin/prompt/import',
  { version: PARSER_VERSION, body: parsePrompt(), model: 'mistralai/mistral-nemotron' },
  adminKey,
)
console.log(`prompt ${prompt.version}: ${prompt.replaced ? 'replaced' : 'created'}`)

if (process.argv.includes('--create-org')) {
  const org = await post(
    '/admin/org',
    { name: process.env.RELOKIT_ORG_NAME ?? 'Relokit demo' },
    adminKey,
  )
  console.log(
    `\norg ${org.org_id} created. Put this in .env as RELOKIT_ORG_KEY, it is not shown again:`,
  )
  console.log(`  ${org.api_key}`)
} else {
  console.log('\npass --create-org to mint an org key')
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
