import { readFileSync } from 'node:fs'
import type { Transport } from './index.ts'
import { withRetry, type RetryPolicy } from './retry.ts'

/**
 * A backend for driving the whole of ask() offline: answers by capability, can
 * be told to refuse particular calls, holds a queue the way the instance does,
 * and keeps every posted body so a test can read what actually travelled.
 */
export const seed = JSON.parse(readFileSync('xano/registry.seed.json', 'utf8')) as {
  registry_version: string
  capabilities: { capability_id: string; selectivity_prior: number }[]
}

export const QUERY = 'restaurants in San Jose'

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
export const RENTAL_QUERY = '2 bed in San Jose, 20 min bike to 1 First St'
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
// fans out and the group path carries something, and near enough to the
// destination that the free geometric floor cannot settle the ride on its own.
// Spread them across a county and every home is rejected before a single
// direction is asked for, which quietly tests nothing.
const ZILLOW = {
  organic_results: [1, 2, 3, 4].map((n) => ({
    zpid: String(n),
    title: `${n} Elm St`,
    price: '$2,000/mo',
    link: `https://x/${n}`,
    gps_coordinates: { latitude: 37.3 + n * 0.02, longitude: -121.88 + n * 0.015 },
  })),
}
// Rides either side of the twenty minute limit, so verdicts really are mixed.
// A fixture where everything passes cannot tell a working rejection rule from
// a broken one: both answer the same.
//
// Keyed to where the ride starts rather than to the order calls arrive in. A
// counter would hand the same home a different answer once a plan reordered
// its calls, and a test for what priors cannot change must not itself change
// with them.
// The listings sit on a known ladder of latitudes, so each band gets its own
// answer and the mix is a property of the fixture rather than of a hash.
const RIDES = [900, 1500, 780, 1800]

function rideFrom(params: Record<string, unknown> | undefined): unknown {
  const lat = Number(String(params?.start_coords ?? '').split(',')[0])
  const band = Number.isFinite(lat) ? Math.round((lat - 37.32) / 0.02) : 0
  const duration = RIDES[Math.min(Math.max(band, 0), RIDES.length - 1)]
  return { directions: [{ travel_mode: 'Cycling', duration }] }
}

function answerFor(capability: string, params?: Record<string, unknown>): unknown {
  if (capability.includes('geocode')) return GEOCODE
  if (capability.includes('zillow')) return ZILLOW
  if (capability.includes('directions')) return rideFrom(params)
  return PLACES
}

export interface FakeExtra {
  /** Served on /parse, the way the instance serves observation rows. */
  observations?: unknown[]
  /** Replaces the seed registry served on /parse. */
  capabilities?: unknown[]
}

/**
 * Answers, and can be told to refuse particular calls: how many times, and
 * whether it ever relents.
 */
export function backend(
  fail: Record<string, { times: number }> = {},
  poison: number[] = [],
  extra: FakeExtra = {},
) {
  const seen: string[] = []
  const posts: { path: string; body: unknown }[] = []
  const left = new Map(Object.entries(fail).map(([path, f]) => [path, f.times]))
  // The queue, as the instance holds it: jobs keyed by id, worked in polls.
  const queue = new Map<
    number,
    {
      call: { op_id?: string; capability_id?: string; params?: Record<string, unknown> }
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
        posts.push({ path, body })
        if (refuse(path)) throw new Error(`${path} returned 502: <html>bad gateway</html>`)
        if (path === '/parse') {
          return {
            raw_text: (body as { query?: string }).query === RENTAL_QUERY ? RENTAL_PARSED : PARSED,
            answered_by: 'test',
            registry: extra.capabilities ?? seed.capabilities,
            registry_version: seed.registry_version,
            observations: extra.observations ?? [],
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
          const call = body as { capability_id?: string; params?: Record<string, unknown> }
          return {
            body: answerFor(String(call.capability_id ?? ''), call.params),
            from: 'cache',
          } as never
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
            job.answer = {
              body: answerFor(String(job.call.capability_id ?? ''), job.call.params),
            }
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
  return { transport, seen, posts }
}

export const impatient: RetryPolicy = { attempts: 4, base_ms: 0, cap_ms: 0, sleep: async () => {} }
