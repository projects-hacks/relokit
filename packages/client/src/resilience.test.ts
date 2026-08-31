import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ask, type Transport } from './index.ts'
import { withRetry, type RetryPolicy } from './retry.ts'

/**
 * What a stranger gets when the backend is having a bad minute.
 *
 * The hosted instance does not fail cleanly under a burst. The heaviest call
 * starts returning a gateway page while reads still answer, then everything
 * refuses for a few minutes, then it recovers. A run is dozens of calls, so it
 * meets that, and the question is only ever what the reader is left holding.
 *
 * These drive the whole of ask() against a backend behaving badly on purpose,
 * because every part of it passed its own tests while the page still said the
 * run had stopped.
 */
const seed = JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')) as {
  registry_version: string
  capabilities: unknown[]
}

const QUERY = 'restaurants in San Jose'

/** Enough of a place search for the planner to have something to do. */
const PARSED = JSON.stringify({
  subject: 'restaurant',
  location: 'San Jose',
  constraints: [],
})

const PLACES = {
  local_results: [
    {
      title: 'A Restaurant',
      place_id: 'p1',
      address: '1 First St',
      gps_coordinates: { latitude: 37.33, longitude: -121.88 },
      rating: 4.5,
    },
  ],
}

const GEOCODE = { place_results: { gps_coordinates: { latitude: 37.33, longitude: -121.88 } } }

/**
 * A backend that answers, and can be told to refuse particular calls: how many
 * times, and whether it ever relents.
 */
function backend(fail: Record<string, { times: number }> = {}) {
  const seen: string[] = []
  const left = new Map(Object.entries(fail).map(([path, f]) => [path, f.times]))

  const refuse = (path: string) => {
    const remaining = left.get(path) ?? 0
    if (remaining <= 0) return false
    left.set(path, remaining - 1)
    return true
  }

  // Wrapped the same way the real transport is, so these exercise the waiting
  // rather than a fake that quietly never fails twice.
  const transport: Transport = {
    async post(path, body, policy) {
      return withRetry(async () => {
        seen.push(path)
        if (refuse(path)) throw new Error(`${path} returned 502: <html>bad gateway</html>`)
        if (path === '/parse') {
          return {
            raw_text: PARSED,
            answered_by: 'test',
            registry: seed.capabilities,
            registry_version: seed.registry_version,
            budget: {
              max_cost_units: 200,
              max_stages: 6,
              cluster_count: 6,
              overshoot_factor: 1.3,
            },
          } as never
        }
        if (path === '/run') {
          return { run_id: 1, worst_case_units: 4, ceiling_cost_units: 200 } as never
        }
        if (path === '/op') {
          const capability = String((body as { capability_id?: string }).capability_id ?? '')
          return { body: capability.includes('geocode') ? GEOCODE : PLACES, from: 'cache' } as never
        }
        return {} as never
      }, policy) as Promise<Record<string, unknown>>
    },
    async get(path) {
      return withRetry(async () => {
        seen.push(path)
        if (refuse(path)) throw new Error(`${path} returned 503: <html>unavailable</html>`)
        return { ops: [{ status: 'cache_hit' }], cost: {} } as never
      }) as Promise<Record<string, unknown>>
    },
  }
  // No real waiting, so a failing run is still a fast test.
  return { transport, seen }
}

const impatient: RetryPolicy = { attempts: 4, base_ms: 0, cap_ms: 0, sleep: async () => {} }

describe('a run that meets a backend having a bad minute', () => {
  it('still answers when a call fails and the instance comes back', async () => {
    // Exactly what happened live: three gateway pages in the middle of a run.
    const { transport, seen } = backend({ '/op': { times: 3 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    // It asked again rather than giving up on that operation.
    expect(seen.filter((path) => path === '/op').length).toBeGreaterThan(3)
  })

  it('still answers when the answer cannot be filed', async () => {
    // Keeping the record is not what the reader asked for.
    const { transport } = backend({ '/ingest': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.problems.map((problem) => problem.op_id)).toContain('keeping')
  })

  it('says so, rather than pretending the filing worked', async () => {
    const { transport } = backend({ '/ingest': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.problems.find((problem) => problem.op_id === 'keeping')?.detail).toMatch(
      /could not be filed/,
    )
  })

  it('still answers when the tallies cannot be read back', async () => {
    const { transport } = backend({ '/runs': { times: 99 } })
    const result = await ask(transport, QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    // Falls back to what was counted here rather than showing a blank.
    expect(result.cost.naive_units).toBeGreaterThan(0)
  })

  it('stops when the question itself could never be answered', async () => {
    // Not everything is worth surviving: with no parse there is nothing to run.
    const { transport } = backend({ '/parse': { times: 99 } })
    await expect(ask(transport, QUERY, { retry: impatient })).rejects.toThrow(/502/)
  })
})
