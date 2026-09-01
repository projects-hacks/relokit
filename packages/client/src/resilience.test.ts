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

/** A rental question, whose entity tier is what actually fans out. */
const RENTAL_QUERY = '2 bed in San Jose, 20 min bike to 1 First St'
const RENTAL_PARSED = JSON.stringify({
  subject: 'rental',
  location: 'San Jose',
  constraints: [
    {
      id: 'c1',
      type: 'commute',
      hardness: 'hard',
      weight: 1,
      source_text: '20 min bike to 1 First St',
      destination: { raw: '1 First St' },
      mode: 'bike',
      max_seconds: 1200,
    },
  ],
})
// Far enough apart that every home is its own cluster, so the cluster tier
// fans out and the group path actually carries something.
const ZILLOW = {
  organic_results: [1, 2, 3, 4].map((n) => ({
    zpid: String(n),
    title: `${n} Elm St`,
    price: '$2,000/mo',
    link: `https://x/${n}`,
    gps_coordinates: { latitude: 37.1 + n * 0.2, longitude: -121.9 + n * 0.15 },
  })),
}
const RIDE = { directions: [{ travel_mode: 'Cycling', duration: 900 }] }

function answerFor(capability: string): unknown {
  if (capability.includes('geocode')) return GEOCODE
  if (capability.includes('zillow')) return ZILLOW
  if (capability.includes('directions')) return RIDE
  return PLACES
}

/**
 * A backend that answers, and can be told to refuse particular calls: how many
 * times, and whether it ever relents.
 */
function backend(fail: Record<string, { times: number }> = {}, poison: number[] = []) {
  const seen: string[] = []
  const left = new Map(Object.entries(fail).map(([path, f]) => [path, f.times]))
  // The queue, as the instance holds it: jobs keyed by id, worked in polls.
  const queue = new Map<
    number,
    {
      call: { op_id?: string; capability_id?: string }
      status: string
      attempts: number
      answer?: { body: unknown }
    }
  >()
  let nextJob = 1

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
            raw_text: (body as { query?: string }).query === RENTAL_QUERY ? RENTAL_PARSED : PARSED,
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
          return { body: answerFor(capability), from: 'cache' } as never
        }
        if (path === '/jobs') {
          const calls = (body as { calls: { op_id?: string }[] }).calls
          const ids = calls.map((call) => {
            queue.set(nextJob, { call, status: 'pending', attempts: 0 })
            return nextJob++
          })
          return { job_ids: ids } as never
        }
        if (path === '/jobs/run') {
          let worked = 0
          for (const [id, job] of queue) {
            if (worked >= 4) break
            if (job.status !== 'pending' || job.attempts >= 2) continue
            job.attempts += 1
            worked += 1
            if (poison.includes(id)) continue
            job.answer = { body: answerFor(String(job.call.capability_id ?? '')) }
            job.status = 'done'
          }
          const pending = [...queue.values()].filter(
            (job) => job.status === 'pending' && job.attempts < 2,
          ).length
          return { worked, pending } as never
        }
        return {} as never
      }, policy) as Promise<Record<string, unknown>>
    },
    async get(path) {
      return withRetry(async () => {
        seen.push(path)
        if (refuse(path)) throw new Error(`${path} returned 503: <html>unavailable</html>`)
        if (path.startsWith('/jobs')) {
          return { jobs: [...queue.entries()].map(([id, job]) => ({ id, ...job })) } as never
        }
        return { ops: [{ status: 'cache_hit' }], cost: {} } as never
      }) as Promise<Record<string, unknown>>
    },
  }
  // No real waiting, so a failing run is still a fast test.
  return { transport, seen }
}

const impatient: RetryPolicy = { attempts: 4, base_ms: 0, cap_ms: 0, sleep: async () => {} }

describe('a run that meets a backend having a bad minute', () => {
  it('asks a metered call once, however badly it fails', async () => {
    // A search that fails after the provider answered has been paid for, so
    // asking again pays twice. Measured live: forty six planned, fifty spent.
    const { transport, seen } = backend({ '/op': { times: 1 } })
    const result = await ask(transport, QUERY)
    // Asked once and not repeated, so nothing is paid for twice.
    expect(seen.filter((path) => path === '/op')).toHaveLength(1)
    // The run still ends, and says what it could not do rather than stopping.
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('waits and asks again for the calls that cost nothing', async () => {
    // The parse is free to repeat, so a bad minute there is worth sitting out.
    const { transport, seen } = backend({ '/parse': { times: 2 } })
    await ask(transport, QUERY, { retry: impatient })
    expect(seen.filter((path) => path === '/parse').length).toBe(3)
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

describe('a stage handed to the queue', () => {
  it('one poisoned job fails alone; its neighbours keep their answers', async () => {
    // Job 2 dies on every attempt. It must come back as a problem on the
    // answer, not as a reason to re-ask the whole group.
    const { transport } = backend({}, [2])
    const result = await ask(transport, RENTAL_QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.problems.some((problem) => /could not settle/.test(problem.detail))).toBe(true)
    // The neighbours were answered: at least one home carries a measured ride.
    expect(
      result.evidence.some((row) => row.constraint_type === 'commute' && row.verdict !== 'unknown'),
    ).toBe(true)
  })

  it('a poll that dies loses nothing; the next one carries on', async () => {
    const { transport, seen } = backend({ '/jobs/run': { times: 1 } })
    const result = await ask(transport, RENTAL_QUERY, { retry: impatient })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(
      seen.filter((path) => path === '/jobs/run').length,
      `paths seen: ${JSON.stringify([...new Set(seen)])} | entities ${result.entities.length} | evidence kinds ${JSON.stringify([...new Set(result.evidence.map((r) => r.constraint_type))])}`,
    ).toBeGreaterThan(1)
  })
})
