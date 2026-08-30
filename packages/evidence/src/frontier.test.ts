import { describe, expect, it } from 'vitest'
import type { EvidenceRow, Place } from '@relokit/schema'
import { frontier } from './frontier.ts'

const place = (id: string, price: number | null, rating?: number): Place => ({
  entity_id: id,
  title: id,
  point: null,
  price_cents: price,
  price_cents_upper: null,
  attributes: rating === undefined ? {} : { rating },
  url: null,
  photo_url: null,
  photos: [],
})

const commute = (id: string, seconds: number | null): EvidenceRow => ({
  entity_id: id,
  constraint_id: 'c3',
  constraint_type: 'commute',
  verdict: 'pass',
  value_canonical: seconds,
  display_value: 'x',
  source: 'google_maps_directions',
  source_url: null,
  fetched_at_ms: 1,
  ttl_seconds: 60,
  expires_at_ms: 61_000,
  confidence: 1,
  eval_state: 'evaluated',
  capability_id: 'cap',
  op_id: 'op',
})

const entry = (id: string, seconds: number | null) => ({
  entity_id: id,
  evidence: seconds === null ? [] : [commute(id, seconds)],
})

describe('the efficient set', () => {
  it('calls a result beaten when another wins on one count and loses on none', () => {
    const standings = frontier(
      [entry('dear-and-far', 1800), entry('cheap-and-near', 900)],
      [place('dear-and-far', 300_000), place('cheap-and-near', 250_000)],
    )
    const beaten = standings.get('dear-and-far')!
    expect(beaten.status).toBe('beaten')
    expect(beaten.beaten_by).toMatchObject({ entity_id: 'cheap-and-near' })
    expect(beaten.beaten_by!.on).toEqual(['cheaper', 'quicker to reach'])
    expect(standings.get('cheap-and-near')!.status).toBe('efficient')
  })

  it('keeps a genuine trade-off on the frontier', () => {
    // Cheaper but slower against dearer but quicker: neither beats the other,
    // and calling either one worse would be the tool deciding for the reader.
    const standings = frontier(
      [entry('cheap-slow', 1800), entry('dear-quick', 900)],
      [place('cheap-slow', 250_000), place('dear-quick', 300_000)],
    )
    expect(standings.get('cheap-slow')!.status).toBe('efficient')
    expect(standings.get('dear-quick')!.status).toBe('efficient')
  })

  it('never calls a result with an unknown beaten', () => {
    // The one with no stated rent might be the cheapest of all. An absent
    // number is not evidence, so nothing may be concluded against it.
    const standings = frontier(
      [entry('no-rent', 1800), entry('known', 900)],
      [place('no-rent', null), place('known', 250_000)],
    )
    expect(standings.get('no-rent')!.status).toBe('efficient')
  })

  it('needs two measured dimensions before it says anything', () => {
    // On price alone the cheapest always "beats" the rest, which is a sort,
    // not a finding. Dominance only means something across dimensions.
    const standings = frontier(
      [entry('a', null), entry('b', null)],
      [place('a', 300_000), place('b', 250_000)],
    )
    expect(standings.get('a')!.status).toBe('efficient')
  })

  it('treats a higher rating as a win, not a loss', () => {
    const standings = frontier(
      [entry('loved', 900), entry('shrugged', 900)],
      [place('loved', 250_000, 4.8), place('shrugged', 250_000, 3.1)],
    )
    expect(standings.get('shrugged')!.status).toBe('beaten')
    expect(standings.get('shrugged')!.beaten_by!.on).toContain('better rated')
  })
})
