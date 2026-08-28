import type { Engine, SearchParams } from '@relokit/serpapi'

export interface Scenario {
  slug: string
  engine: Engine
  params: SearchParams
  /** What this recording is meant to settle. */
  question: string
}

/**
 * San Jose bounds, wide enough to hold every neighbourhood the demo query could
 * reach by bike from Santa Clara.
 */
const SAN_JOSE = { ne_lat: 37.45, ne_long: -121.75, sw_lat: 37.2, sw_long: -122.05 }

export const SCENARIOS: Record<string, Scenario> = {
  'san-jose-1bed': {
    slug: 'san-jose-1bed',
    engine: 'zillow',
    params: { ...SAN_JOSE, listing_status: 'For_Rent' },
    question:
      'Does the search response carry price, beds, coordinates and any amenity signal, or does in-unit laundry need a per-property detail call?',
  },
  'santa-clara-office': {
    slug: 'santa-clara-office',
    engine: 'google_maps',
    params: { q: '2788 San Tomas Expressway, Santa Clara, CA', type: 'search' },
    question: 'Does the commute destination geocode to a single unambiguous point?',
  },
  'san-jose-gyms': {
    slug: 'san-jose-gyms',
    engine: 'google_local',
    params: { q: 'gym', ll: '@37.3382,-121.8863,14z' },
    question: 'Are opening hours structured intervals or display strings?',
  },
}
