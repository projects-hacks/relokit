import { afterEach, describe, expect, it } from 'vitest'
import { recall, remember } from './remember.ts'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
} as Storage

afterEach(() => store.clear())

describe('answers remembered by an older page', () => {
  const preSubject = {
    query: 'old question',
    at: 1,
    result: {
      buckets: { results: [], unverified: [], rejections: [] },
      // A complete answer as the page stored it before the search grew past
      // rentals: everything present except what did not exist yet.
      constraint_set: {
        query_id: 'q_old',
        raw_query: 'old question',
        locale: { tz: 'America/Los_Angeles', currency: 'USD' },
        constraints: [],
        parser_version: 'parse.v1.md',
        parsed_at_ms: 1_756_000_000_000,
      },
      entities: [
        {
          entity_id: 'zillow:1',
          title: 'x',
          point: null,
          price_cents: null,
          price_cents_upper: null,
          url: null,
          photo_url: null,
          photos: [],
        },
      ],
      evidence: [],
    },
  }

  it('fills in what the old shape never had, instead of taking the page down', () => {
    // This crashed the first render for anyone who had used the app the day
    // before: no subject on the question, no attribute record on the entities.
    store.set('relokit.last-run.v1', JSON.stringify(preSubject))
    const remembered = recall()
    expect(remembered?.result.constraint_set.subject).toBe('rental')
    expect(remembered?.result.entities[0]?.attributes).toEqual({})
  })

  it('lets go of anything that does not fit the contracts', () => {
    // Half an answer from some in-between version is not worth a crash.
    store.set(
      'relokit.last-run.v1',
      JSON.stringify({
        query: 'x',
        at: 1,
        result: {
          buckets: { results: [], unverified: [], rejections: [] },
          constraint_set: { raw_query: 'x', constraints: [] },
          entities: [{ entity_id: 'zillow:1' }],
          evidence: [],
        },
      }),
    )
    expect(recall()).toBeNull()
  })

  it('still refuses what was never an answer at all', () => {
    store.set('relokit.last-run.v1', JSON.stringify({ query: 'x', at: 1, result: {} }))
    expect(recall()).toBeNull()
  })

  it('round trips what it stored itself', () => {
    const result = JSON.parse(JSON.stringify(preSubject.result))
    result.constraint_set.subject = 'gym'
    remember('q', result as never)
    expect(recall()?.result.constraint_set.subject).toBe('gym')
  })
})
