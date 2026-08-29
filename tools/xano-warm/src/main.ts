import { readFileSync, readdirSync } from 'node:fs'
import { Registry } from '@relokit/schema'

/**
 * Loads the recorded provider answers into the instance's cache.
 *
 * A demo should not depend on a live search quota, and these are real recorded
 * responses committed to the repository. Their true recorded time goes with
 * them, so anything older than its capability's TTL is stale and will be paid
 * for again rather than quietly served.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The checks below say what is missing.
}

const base = (process.env.XANO_INSTANCE_URL ?? '').replace(/\/+$/, '').replace(/\/workspace$/, '')
const api = `${base}/api:${process.env.XANO_API_GROUP ?? 'vZQqb3Je'}`
const adminKey = process.env.RELOKIT_ADMIN_KEY
if (!adminKey) {
  console.error('RELOKIT_ADMIN_KEY is not set')
  process.exit(1)
}

const registry = Registry.parse(JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')))

/** Which capability a recording belongs to, so it expires the way that source does. */
const ENDPOINT_BY_ENGINE: Record<string, string> = {
  zillow: 'zillow:search',
  zillow_property: 'zillow:property',
  google_maps: 'google_maps:search',
  google_maps_directions: 'google_maps_directions:route',
  google_local: 'google_local:search',
  google_news: 'google_news:search',
  yelp: 'yelp:search',
}

const ttlFor = (endpoint: string) =>
  registry.capabilities.find((c) => c.endpoint === endpoint)?.ttl_seconds ?? 86_400

const dir = 'fixtures/serpapi/'
let warmed = 0
let already = 0
let skipped = 0
const now = Date.now()

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const fixture = JSON.parse(readFileSync(dir + file, 'utf8')) as {
    engine: string
    params: Record<string, string | number | boolean>
    recorded_at_ms: number
    body: unknown
  }
  const endpoint = ENDPOINT_BY_ENGINE[fixture.engine]
  if (!endpoint) {
    skipped += 1
    continue
  }
  const ttl = ttlFor(endpoint)
  if (fixture.recorded_at_ms + ttl * 1000 < now) {
    // Already stale. Warming it would put an answer in the cache that the
    // executor is right to ignore.
    skipped += 1
    continue
  }

  const body = JSON.stringify({
    admin_key: adminKey,
    endpoint,
    params: { ...fixture.params, engine: fixture.engine },
    raw_response: fixture.body,
    ttl_seconds: ttl,
    fetched_at_ms: fixture.recorded_at_ms,
  })
  const result = await warm(file, body)
  result.warmed ? (warmed += 1) : (already += 1)
}

console.log(`${warmed} warmed, ${already} already there, ${skipped} skipped as stale or unknown`)

/**
 * A hundred recordings back to back is enough to be refused, and a partly warmed
 * cache is worse than a cold one because the gaps are invisible.
 */
async function warm(file: string, body: string): Promise<{ warmed: boolean }> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(`${api}/admin/cache/warm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(45_000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 160)}`)
      return JSON.parse(text)
    } catch (error) {
      if (attempt === 4) throw new Error(`warm ${file} failed: ${String(error)}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
    }
  }
  throw new Error('unreachable')
}
