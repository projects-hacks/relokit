import type { Engine, SearchParams } from '@relokit/serpapi'

export interface Scenario {
  slug: string
  engine: Engine
  params: SearchParams
  /** What this recording is meant to settle. */
  question: string
}

/** Zillow takes map_bounds as north,east,south,west. Wide enough to hold every
 * neighbourhood the demo query could reach by bike from Santa Clara. */
const SAN_JOSE_BOUNDS = '37.45,-121.75,37.20,-122.05'

export const SCENARIOS: Record<string, Scenario> = {
  'san-jose-rentals': {
    slug: 'san-jose-rentals',
    engine: 'zillow',
    params: { status_type: 'rent', map_bounds: SAN_JOSE_BOUNDS },
    question: 'How large is the unfiltered candidate pool, and what fields does a listing carry?',
  },
  'san-jose-1bed': {
    slug: 'san-jose-1bed',
    engine: 'zillow',
    params: {
      status_type: 'rent',
      map_bounds: SAN_JOSE_BOUNDS,
      price: '0,2800',
      beds: '1,1',
      amenities: 'in_unit_laundry',
    },
    question:
      'How much do the free native predicates prune, and does the response restate the amenity per listing?',
  },
  'bike-to-office': {
    slug: 'bike-to-office',
    engine: 'google_maps_directions',
    params: {
      start_coords: '37.30997,-121.95059',
      end_coords: '37.3726799,-121.9678625',
      travel_mode: 1,
    },
    question:
      'Does travel_mode take the cycling integer, and where does the route duration in seconds live?',
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
  'san-jose-gyms-maps': {
    slug: 'san-jose-gyms-maps',
    engine: 'google_maps',
    params: { q: 'gym', ll: '@37.3382,-121.8863,14z', type: 'search' },
    question: 'Does google_maps honour ll, where google_local did not?',
  },
}
