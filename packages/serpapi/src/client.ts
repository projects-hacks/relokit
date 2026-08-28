import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Engine, SearchParams } from './engines.ts'
import { fixtureKey } from './key.ts'
import { redactBody, redactParams } from './redact.ts'

export type Mode = 'live' | 'record' | 'replay'

export interface Fixture {
  key: string
  engine: Engine
  params: SearchParams
  recorded_at_ms: number
  status: number
  body: unknown
}

export interface ClientOptions {
  mode?: Mode
  apiKey?: string
  fixtureDir?: string
  /** Readable prefix on the fixture filename, e.g. "san-jose-1bed". */
  slug?: string
}

const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/serpapi/', import.meta.url))

export function createClient(options: ClientOptions = {}) {
  const mode = options.mode ?? (process.env.RELOKIT_SERPAPI_MODE as Mode) ?? 'replay'
  const dir = options.fixtureDir ?? DEFAULT_FIXTURE_DIR

  async function search(engine: Engine, params: SearchParams, slug = options.slug) {
    const key = fixtureKey(engine, params, slug)
    const path = join(dir, `${key}.json`)

    if (mode === 'replay') return readFixture(path, engine, params, slug).body

    const apiKey = options.apiKey ?? process.env.SERPAPI_API_KEY
    if (!apiKey) throw new Error(`SERPAPI_API_KEY is required in ${mode} mode`)

    const url = new URL('https://serpapi.com/search.json')
    for (const [k, v] of Object.entries({ ...params, engine })) url.searchParams.set(k, String(v))
    url.searchParams.set('api_key', apiKey)

    const response = await fetch(url)
    const body = redactBody(await response.json())
    if (!response.ok) {
      throw new Error(`serpapi ${engine} returned ${response.status}: ${JSON.stringify(body)}`)
    }

    if (mode === 'record') {
      const fixture: Fixture = {
        key,
        engine,
        params: redactParams(params),
        recorded_at_ms: Date.now(),
        status: response.status,
        body,
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
    }

    return body
  }

  return { mode, search }
}

/**
 * A miss throws. It never falls through to a live call, because that is how a
 * test suite quietly spends a month of credits and nobody can say which test did it.
 */
function readFixture(
  path: string,
  engine: Engine,
  params: SearchParams,
  slug: string | undefined,
): Fixture {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture
  } catch {
    throw new Error(
      [
        `No fixture for ${engine} at ${path}`,
        `params: ${JSON.stringify(redactParams(params))}`,
        `Record it with: pnpm record ${slug ?? '<scenario>'}`,
      ].join('\n'),
    )
  }
}
