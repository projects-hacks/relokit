import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Fixture } from './client.ts'

/**
 * These assertions freeze what the providers actually returned on 28 Aug 2026.
 * A response shape change shows up here as a red test rather than as empty pins
 * on the map three days later.
 */

const DIR = fileURLToPath(new URL('../../../fixtures/serpapi/', import.meta.url))

function load(prefix: string): Fixture {
  const name = readdirSync(DIR).find((f) => f.startsWith(prefix))
  if (!name) throw new Error(`no fixture starting with ${prefix}`)
  return JSON.parse(readFileSync(DIR + name, 'utf8')) as Fixture
}

function pct(records: Record<string, unknown>[], key: string): number {
  const n = records.filter((r) => r[key] !== undefined && r[key] !== null && r[key] !== '').length
  return Math.round((n / records.length) * 100)
}

describe('zillow rentals', () => {
  const unfiltered = load('zillow__san-jose-rentals__').body as any
  const filtered = load('zillow__san-jose-1bed__').body as any

  it('carries coordinates for nearly every listing, so clustering has something to work with', () => {
    expect(pct(unfiltered.organic_results, 'gps_coordinates')).toBe(100)
    expect(pct(filtered.organic_results, 'gps_coordinates')).toBeGreaterThanOrEqual(90)
  })

  it('prunes the pool by two orders of magnitude for free', () => {
    expect(unfiltered.search_information.total_results).toBeGreaterThan(3000)
    expect(filtered.search_information.total_results).toBeLessThan(200)
  })

  it('cuts the page count too, so the native predicates pay for the search as well', () => {
    expect(unfiltered.search_information.total_pages).toBeGreaterThan(10)
    expect(filtered.search_information.total_pages).toBe(1)
  })

  it('returns a price band rather than a price for multi-unit buildings', () => {
    const building = unfiltered.organic_results.find((r: any) => r.units)
    expect(building.units[0]).toHaveProperty('beds')
    expect(building.units[0].price).toMatch(/^\$[\d,]+\+?$/)
    // "$3,227+" is a floor, not a price. A budget cap above it settles nothing.
    expect(building.min_base_rent).toBeLessThan(building.max_base_rent)
  })

  it('never restates the amenity per listing, so laundry evidence is provider asserted', () => {
    const raw = JSON.stringify(filtered.organic_results).toLowerCase()
    expect(raw).not.toContain('in_unit_laundry')
  })
})

describe('google maps', () => {
  const office = load('google_maps__santa-clara-office__').body as any
  const gyms = load('google_maps__san-jose-gyms-maps__').body as any

  it('geocodes the commute destination to one point', () => {
    expect(office.place_results.gps_coordinates).toMatchObject({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    })
  })

  it('honours ll, which google_local did not', () => {
    for (const r of gyms.local_results) {
      expect(r.gps_coordinates.latitude).toBeGreaterThan(37.2)
      expect(r.gps_coordinates.latitude).toBeLessThan(37.5)
    }
  })

  it('carries opening hours per weekday, not only as a display string', () => {
    expect(pct(gyms.local_results, 'operating_hours')).toBe(100)
    for (const r of gyms.local_results) {
      expect(Object.keys(r.operating_hours)).toEqual(
        expect.arrayContaining(['monday', 'saturday', 'sunday']),
      )
    }
  })

  it('gives the hours parser three forms to handle', () => {
    const values: string[] = gyms.local_results.flatMap((r: any) =>
      Object.values(r.operating_hours),
    )
    expect(values).toContain('Open 24 hours')
    expect(values).toContain('Closed')
    expect(values.some((v) => /^\d+(:\d+)?\s[AP]M.\d+(:\d+)?\s[AP]M$/.test(v))).toBe(true)
  })

  it('separates the range with an en dash and a narrow no-break space', () => {
    // A parser written against ASCII space and hyphen matches nothing here and
    // every opening hours verdict comes back unknown.
    const values: string[] = gyms.local_results.flatMap((r: any) =>
      Object.values(r.operating_hours),
    )
    const range = values.find((v) => v.includes('AM') && v.includes('PM'))!
    expect(range).toContain('\u2013')
    expect(range).toContain('\u202f')
    expect(range).not.toContain('-')
  })

  it('closes some places at midnight, which is 86400 and not 0', () => {
    const values: string[] = gyms.local_results.flatMap((r: any) =>
      Object.values(r.operating_hours),
    )
    expect(values.some((v) => /\u2013\s*12\s?AM$/.test(v))).toBe(true)
  })
})

describe('google local', () => {
  it('answers for the wrong city, which is why nearby_poi uses google_maps', () => {
    const local = load('google_local__san-jose-gyms__').body as any
    const inArea = local.local_results.filter(
      (r: any) => r.gps_coordinates?.latitude > 37.2 && r.gps_coordinates?.latitude < 37.5,
    )
    expect(inArea.length).toBe(0)
  })
})
