/** The SerpApi engines Relokit reads. Adding one is a registry row, not code. */
export const ENGINES = [
  'zillow',
  'zillow_property',
  'google_maps',
  'google_maps_directions',
  'google_local',
  'google_maps_reviews',
  'yelp',
  'google_news',
] as const

export type Engine = (typeof ENGINES)[number]

export type SearchParams = Record<string, string | number | boolean>
