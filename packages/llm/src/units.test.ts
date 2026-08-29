import { describe, expect, it } from 'vitest'
import { clockSeconds, distanceMeters, durationSeconds, moneyCents, windowSide } from './units.ts'

describe('money', () => {
  it('reads the forms people write a rent in', () => {
    expect(moneyCents('Under $2,800')).toBe(280_000)
    expect(moneyCents('under 2800 dollars')).toBe(280_000)
    expect(moneyCents('$1,950/mo')).toBe(195_000)
    expect(moneyCents('$2.8k')).toBe(280_000)
  })

  it('finds nothing rather than guessing', () => {
    expect(moneyCents('one bedroom')).toBeNull()
  })
})

describe('duration', () => {
  it('reads a commute limit', () => {
    expect(durationSeconds('no more than 25 minutes by bike')).toBe(1500)
    expect(durationSeconds('45 min drive')).toBe(2700)
    expect(durationSeconds('an hour')).toBe(3600)
    expect(durationSeconds('1.5 hours')).toBe(5400)
  })

  it('adds the parts of a compound', () => {
    expect(durationSeconds('1 hour 20 minutes')).toBe(4800)
  })
})

describe('distance', () => {
  it('reads the forms people write a radius in', () => {
    expect(distanceMeters('gym within half a mile')).toBe(805)
    expect(distanceMeters('within 0.5 miles')).toBe(805)
    expect(distanceMeters('800m walk')).toBe(800)
    expect(distanceMeters('2 km')).toBe(2000)
  })

  it('returns a whole number of meters', () => {
    // The model answered 804.672, which the schema rejects and nobody wanted.
    expect(Number.isInteger(distanceMeters('half a mile'))).toBe(true)
  })
})

describe('clock', () => {
  it('reads a time of day into seconds since midnight', () => {
    expect(clockSeconds('open before 6am')).toBe(21_600)
    expect(clockSeconds('open past 10pm')).toBe(79_200)
    expect(clockSeconds('open until 10:30 pm')).toBe(81_000)
    expect(clockSeconds('after 18:30')).toBe(66_600)
  })

  it('puts midnight at the end of the day rather than the start', () => {
    expect(clockSeconds('open till midnight')).toBe(86_400)
    expect(clockSeconds('open at noon')).toBe(43_200)
  })

  it('does not accept an impossible clock', () => {
    expect(clockSeconds('13pm')).toBeNull()
    expect(clockSeconds('25:00')).toBeNull()
  })
})

describe('which end of the day', () => {
  it('reads the preposition, not the hour', () => {
    // The two phrases differ by one small word and the model got both backwards.
    expect(windowSide('gym open before 6am')).toBe('opens_by')
    expect(windowSide('grocery open past 10pm')).toBe('closes_after')
    expect(windowSide('open until 11pm')).toBe('closes_after')
    expect(windowSide('opens by 5am')).toBe('opens_by')
  })

  it('says nothing when the phrasing settles nothing', () => {
    expect(windowSide('gym nearby')).toBeNull()
  })
})
