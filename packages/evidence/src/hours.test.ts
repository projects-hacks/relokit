import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDayHours, parseOperatingHours, satisfiesWindow } from './hours.ts'

const DIR = new URL('../../../fixtures/serpapi/', import.meta.url)
const gyms = JSON.parse(
  readFileSync(
    new URL(
      readdirSync(DIR).find((f) => f.startsWith('google_maps__san-jose-gyms-maps'))!,
      DIR,
    ),
    'utf8',
  ),
).body

const h = (hours: number, minutes = 0) => hours * 3600 + minutes * 60

describe('a single day', () => {
  it('reads the en dash and narrow no-break space google actually sends', () => {
    expect(parseDayHours('5 AM–9 PM')).toEqual({
      opens_s: h(5),
      closes_s: h(21),
    })
  })

  it('reads an ordinary hyphen and space too, since being strict buys nothing', () => {
    expect(parseDayHours('5 AM - 9 PM')).toEqual({ opens_s: h(5), closes_s: h(21) })
  })

  it('handles minutes', () => {
    expect(parseDayHours('5:30 AM–11:45 PM')).toEqual({
      opens_s: h(5, 30),
      closes_s: h(23, 45),
    })
  })

  it('treats a midnight close as the end of the day, not the start', () => {
    // "5 AM–12 AM" is a nineteen hour day. Reading it as 0 would make the place
    // look shut before it opened.
    expect(parseDayHours('5 AM–12 AM')).toEqual({
      opens_s: h(5),
      closes_s: h(24),
    })
  })

  it('carries a closing time past midnight beyond 86400', () => {
    expect(parseDayHours('5 PM–2 AM')).toEqual({
      opens_s: h(17),
      closes_s: h(26),
    })
  })

  it('reads noon and midnight opening correctly', () => {
    expect(parseDayHours('12 AM–9 PM')).toEqual({ opens_s: 0, closes_s: h(21) })
    expect(parseDayHours('12 PM–6 PM')).toEqual({ opens_s: h(12), closes_s: h(18) })
  })

  it('knows the two special forms', () => {
    expect(parseDayHours('Open 24 hours')).toEqual({ opens_s: 0, closes_s: h(24) })
    expect(parseDayHours('Closed')).toBe('closed')
  })

  it('says so rather than guessing when it cannot read the string', () => {
    expect(parseDayHours('Hours might differ')).toBe('unparsed')
    expect(parseDayHours('25 AM–9 PM')).toBe('unparsed')
    expect(parseDayHours('')).toBe('unparsed')
  })
})

describe('against the recorded gyms', () => {
  const results = gyms.local_results.map((r: { title: string; operating_hours: unknown }) => ({
    title: r.title,
    parsed: parseOperatingHours(r.operating_hours as Record<string, unknown>),
  }))

  it('reads every day of every gym google returned', () => {
    const values = results.flatMap((r: { parsed: object }) => Object.values(r.parsed))
    expect(values.length).toBeGreaterThan(100)
    expect(values.filter((v: unknown) => v === 'unparsed')).toHaveLength(0)
  })

  it('answers the demo constraint, a gym open before 6am', () => {
    const openEarly = results.filter(
      (r: { parsed: never }) => satisfiesWindow(r.parsed, { opens_by_s: h(6) }, ['tue']) === 'pass',
    )
    // Several San Jose gyms open at 5am or run around the clock.
    expect(openEarly.length).toBeGreaterThan(0)
    expect(openEarly.length).toBeLessThan(results.length)
  })
})

describe('the window verdict', () => {
  const weekdays = { mon: { opens_s: h(5), closes_s: h(23) } } as never
  const sunday = { sun: 'closed' } as never
  const partial = { mon: 'unparsed' } as never

  it('passes a gym that opens early enough', () => {
    expect(satisfiesWindow(weekdays, { opens_by_s: h(6) }, ['mon'])).toBe('pass')
  })

  it('fails a gym that opens too late', () => {
    expect(satisfiesWindow(weekdays, { opens_by_s: h(4) }, ['mon'])).toBe('fail')
  })

  it('fails a shop that shuts before the window ends', () => {
    expect(satisfiesWindow(weekdays, { closes_after_s: h(24) }, ['mon'])).toBe('fail')
  })

  it('passes a grocery open past 10pm', () => {
    expect(satisfiesWindow(weekdays, { closes_after_s: h(22) }, ['mon'])).toBe('pass')
  })

  it('fails a day the place is shut, which is a real answer', () => {
    expect(satisfiesWindow(sunday, { opens_by_s: h(6) }, ['sun'])).toBe('fail')
  })

  it('returns unknown when the string could not be read, never fail', () => {
    // Not knowing when a gym opens is a different answer from knowing it opens
    // too late, and only one of them should reject a home.
    expect(satisfiesWindow(partial, { opens_by_s: h(6) }, ['mon'])).toBe('unknown')
    expect(satisfiesWindow({}, { opens_by_s: h(6) }, ['mon'])).toBe('unknown')
  })

  it('uses the days the constraint named, not the day it happens to be', () => {
    const weekend = { sat: { opens_s: h(8), closes_s: h(12) } } as never
    expect(satisfiesWindow(weekend, { opens_by_s: h(6), days: ['sat'] }, ['mon'])).toBe('fail')
  })
})

describe('the shared meridiem form', () => {
  it('borrows the meridiem the opening time leaves out', () => {
    // Google writes "6–11 AM" rather than "6 AM–11 AM". Seven strings in one
    // sample of gyms take that form.
    expect(parseDayHours('6–11 AM')).toEqual({ opens_s: h(6), closes_s: h(11) })
    expect(parseDayHours('4–7 PM')).toEqual({ opens_s: h(16), closes_s: h(19) })
    expect(parseDayHours('6:30–8:30 AM')).toEqual({ opens_s: h(6, 30), closes_s: h(8, 30) })
  })

  it('still needs a meridiem somewhere', () => {
    expect(parseDayHours('6–11')).toBe('unparsed')
  })
})
