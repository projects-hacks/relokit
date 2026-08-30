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
  it('fills in what the old shape never had, instead of taking the page down', () => {
    // Stored before the search grew past rentals: no subject on the question,
    // no attributes on the entities. This crashed the first render for anyone
    // who had used the app the day before.
    store.set(
      'relokit.last-run.v1',
      JSON.stringify({
        query: 'old question',
        at: 1,
        result: {
          buckets: { results: [], unverified: [], rejections: [] },
          constraint_set: { raw_query: 'old question', constraints: [] },
          entities: [{ entity_id: 'zillow:1', title: 'x' }],
        },
      }),
    )
    const remembered = recall()
    expect(remembered?.result.constraint_set.subject).toBe('rental')
    expect(remembered?.result.entities[0]?.attributes).toEqual({})
  })

  it('still refuses what was never an answer at all', () => {
    store.set('relokit.last-run.v1', JSON.stringify({ query: 'x', at: 1, result: {} }))
    expect(recall()).toBeNull()
  })

  it('round trips what it stored itself', () => {
    remember('q', {
      buckets: { results: [], unverified: [], rejections: [] },
      constraint_set: { raw_query: 'q', subject: 'gym', constraints: [] },
      entities: [],
    } as never)
    expect(recall()?.result.constraint_set.subject).toBe('gym')
  })
})
