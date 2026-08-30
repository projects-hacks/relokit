import { z } from 'zod'
import { Subject } from './subject.ts'
import { Cents, Meters, PlaceRef, SecondsOfDay, Seconds, Weekday } from './units.ts'

export const ConstraintType = z.enum([
  /**
   * Not a user constraint. The registry join key for the operator that generates
   * candidates in the first place, which costs real calls (Zillow paginates) and
   * so has to appear in the cost trace. The parser never emits one.
   */
  'candidate_source',
  /**
   * Also not a user constraint. The join key for turning the place being
   * searched into somewhere a search can be bounded to. Separate from
   * candidate_source because both are region wide and one has to happen first.
   */
  'search_area',
  'budget',
  'unit_attribute',
  'listing_feature',
  'commute',
  /**
   * Within a stated distance of a place the question names by name. Not
   * nearby_poi, which is about a kind of place: one university is not another,
   * and answering "within 2 miles of the university" with a different school
   * down the road is how this went wrong before.
   */
  'proximity',
  /** When the thing being looked for is open. Not nearby_poi, which is about
   * somewhere else. */
  'opening_hours',
  'nearby_poi',
  'area_signal',
])

/**
 * hard: a `fail` verdict eliminates the entity.
 * soft: contributes to rank only, never eliminates.
 */
export const Hardness = z.enum(['hard', 'soft'])

const base = {
  /** Stable within a ConstraintSet. Assigned in parse order: c1, c2, ... */
  id: z.string().regex(/^c[0-9]+$/),
  hardness: Hardness,
  /** 0..1 rank contribution. Ignored when hardness is 'hard'. */
  weight: z.number().min(0).max(1),
  /** Verbatim span from the user's query. Drives the "what we understood" chips. */
  source_text: z.string(),
  /** True when the parser supplied a number the user never wrote. Rendered as editable. */
  inferred: z.boolean().default(false),
}

export const BudgetConstraint = z.object({
  ...base,
  type: z.literal('budget'),
  basis: z.literal('rent_monthly'),
  max_cents: Cents.optional(),
  min_cents: Cents.optional(),
  /** Always false in v1. Present so a fee-inclusive budget is not a schema change. */
  includes_fees: z.boolean().default(false),
})

export const UnitAttribute = z.enum(['beds', 'baths', 'sqft', 'home_type'])

export const UnitAttributeConstraint = z.object({
  ...base,
  type: z.literal('unit_attribute'),
  attribute: UnitAttribute,
  /** "1 bed" is min 1 max 1. "1+ bed" is min 1 only. */
  min: z.number().optional(),
  max: z.number().optional(),
  /** home_type only. */
  one_of: z.array(z.enum(['apartment', 'condo', 'townhouse', 'house'])).optional(),
})

export const ListingFeature = z.enum([
  'in_unit_laundry',
  'laundry_on_site',
  'parking',
  'pets_allowed',
  'air_conditioning',
  'dishwasher',
  'furnished',
])

export const ListingFeatureConstraint = z.object({
  ...base,
  type: z.literal('listing_feature'),
  feature: ListingFeature,
  required: z.boolean(),
})

export const TravelMode = z.enum(['bike', 'walk', 'transit', 'drive'])

export const CommuteConstraint = z.object({
  ...base,
  type: z.literal('commute'),
  destination: PlaceRef,
  mode: TravelMode,
  max_seconds: Seconds,
  /** Transit only. Ignored for other modes. */
  depart_at: SecondsOfDay.optional(),
})

export const PoiCategory = z.enum([
  'gym',
  'grocery',
  'cafe',
  'restaurant',
  'pharmacy',
  'park',
  'school',
  'transit_stop',
])

/**
 * Hours belong to the POI they describe. A standalone hours constraint would have
 * no referent and would need a join back to this one.
 */
export const OpenWindow = z.object({
  /** POI must open at or before this local time. "open before 6am" is 21600. */
  opens_by_s: SecondsOfDay.optional(),
  /** POI must close at or after this local time. "open past 10pm" is 79200. */
  closes_after_s: SecondsOfDay.optional(),
  /** Absent or empty means any day. */
  days: z.array(Weekday).optional(),
})

export const NearbyPoiConstraint = z.object({
  ...base,
  type: z.literal('nearby_poi'),
  category: PoiCategory,
  /** Free-text refinement passed through to the provider, e.g. "24 hour gym". */
  query: z.string().optional(),
  /** Straight-line radius, not travel time. */
  radius_m: Meters,
  min_count: z.number().int().positive().default(1),
  min_rating: z.number().min(0).max(5).optional(),
  open_window: OpenWindow.optional(),
})

/**
 * A named place and how far from it to be.
 *
 * Answered in two free halves: geocoding the place narrows the search box, and
 * every listing that comes back is then measured against it with coordinates
 * already in hand. Nothing is asked per home.
 */
export const ProximityConstraint = z.object({
  ...base,
  type: z.literal('proximity'),
  place: PlaceRef,
  radius_m: Meters,
})

export const OpeningHoursConstraint = z.object({
  ...base,
  type: z.literal('opening_hours'),
  open_window: OpenWindow,
})

export const AreaSignalTopic = z.enum(['construction', 'safety', 'noise', 'development', 'schools'])

/** Narrowed to soft on purpose. A news headline must never be able to reject a home. */
export const AreaSignalConstraint = z.object({
  ...base,
  type: z.literal('area_signal'),
  hardness: z.literal('soft'),
  topic: AreaSignalTopic,
  polarity: z.enum(['positive', 'negative']),
  lookback_days: z.number().int().positive(),
})

export const Constraint = z.discriminatedUnion('type', [
  BudgetConstraint,
  UnitAttributeConstraint,
  ListingFeatureConstraint,
  CommuteConstraint,
  ProximityConstraint,
  OpeningHoursConstraint,
  NearbyPoiConstraint,
  AreaSignalConstraint,
])

export const ConstraintSet = z.object({
  query_id: z.string(),
  raw_query: z.string(),
  /** What to look for. Decides which sources can produce candidates. */
  subject: Subject.default('rental'),
  locale: z.object({
    tz: z.string(),
    currency: z.literal('USD'),
    /** Distances are answered in the unit the question used. */
    distance_unit: z.enum(['mi', 'km']).default('mi'),
  }),
  /**
   * Search centre, and how far around it to look.
   *
   * A radius here is a bound on the search itself, not a fact about a home.
   * "Within two miles of the university" is answered by where we look, so every
   * listing that comes back satisfies it by construction and none of them need
   * asking about. Treating it as a per home question is both slower and wrong:
   * it sends a search for a nearby place of that kind, which finds a different
   * school down the road and reports the requirement met.
   */
  search_anchor: PlaceRef.extend({ radius_m: Meters.optional() }).optional(),
  /**
   * May be empty. "Apartments near the university" is a whole question, and the
   * place is the requirement. Insisting on one more than that rejected the most
   * ordinary thing anyone would type.
   */
  constraints: z.array(Constraint),
  /** Filename of the prompt that produced this, e.g. "parse.v1.md". */
  parser_version: z.string(),
  parsed_at_ms: z.number().int().positive(),
})

export type ConstraintType = z.infer<typeof ConstraintType>
export type Hardness = z.infer<typeof Hardness>
export type UnitAttribute = z.infer<typeof UnitAttribute>
export type ListingFeature = z.infer<typeof ListingFeature>
export type TravelMode = z.infer<typeof TravelMode>
export type PoiCategory = z.infer<typeof PoiCategory>
export type OpenWindow = z.infer<typeof OpenWindow>
export type AreaSignalTopic = z.infer<typeof AreaSignalTopic>
export type BudgetConstraint = z.infer<typeof BudgetConstraint>
export type UnitAttributeConstraint = z.infer<typeof UnitAttributeConstraint>
export type ListingFeatureConstraint = z.infer<typeof ListingFeatureConstraint>
export type CommuteConstraint = z.infer<typeof CommuteConstraint>
export type ProximityConstraint = z.infer<typeof ProximityConstraint>
export type OpeningHoursConstraint = z.infer<typeof OpeningHoursConstraint>
export type NearbyPoiConstraint = z.infer<typeof NearbyPoiConstraint>
export type AreaSignalConstraint = z.infer<typeof AreaSignalConstraint>
export type Constraint = z.infer<typeof Constraint>
export type ConstraintSet = z.infer<typeof ConstraintSet>
