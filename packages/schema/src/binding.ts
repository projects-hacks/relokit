import { z } from 'zod'
import type { Constraint, ConstraintType, TravelMode } from './constraints.ts'

/**
 * Access patterns.
 *
 * A source cannot always be queried freely. Google Directions cannot be asked
 * anything until it has a destination point, and that point only exists once
 * something has geocoded the address. In the query planning literature this is a
 * limited access pattern: a relation that can only be read when certain of its
 * variables are already bound, and a plan that respects those restrictions is
 * called feasible.
 *
 * That distinction matters here because a geocode eliminates no candidates at
 * all. Ranked purely on pruning power it scores zero and loses every comparison
 * it enters. It survives because without it nothing downstream can run.
 */

/** What a capability can require to be bound, or promise to bind. */
export const BindingKey = z.string()
export type BindingKey = string

export const BINDING_ENTITY = 'entity'
export const BINDING_CLUSTER = 'cluster'
export const BINDING_BOUNDS = 'stage.bounds'
/** Where the search happens. Named on the question, not on any one constraint. */
export const BINDING_ANCHOR = 'query.anchor_point'

/** A constraint field that no call can produce, e.g. `constraint.destination_point`. */
export function constraintBinding(field: string): BindingKey {
  return `constraint.${field}`
}

const TRAVEL_MODE_CODE: Record<TravelMode, number> = {
  drive: 0,
  bike: 1,
  walk: 2,
  transit: 3,
}

/**
 * The resolver contract.
 *
 * Every field here is readable from a parsed constraint with no API call, so a
 * `$constraint.<id>.<field>` ref naming one of them is bound from the start.
 * Anything else is a binding the plan has to produce first.
 *
 * Xano's resolver must implement exactly this. The reference implementation is
 * below and a test walks every registry template against it, so a typo in a
 * params_template fails here rather than as an empty response on Sunday.
 */
export function resolveConstraintField(
  constraint: Constraint,
  field: string,
): string | number | boolean | undefined {
  switch (constraint.type) {
    case 'budget':
      if (field === 'max_cents') return constraint.max_cents
      if (field === 'min_cents') return constraint.min_cents
      // Zillow prices in dollars. We store cents. Format at the edge, never before.
      if (field === 'max_dollars')
        return constraint.max_cents === undefined ? undefined : constraint.max_cents / 100
      if (field === 'min_dollars')
        return constraint.min_cents === undefined ? undefined : constraint.min_cents / 100
      return undefined

    case 'unit_attribute':
      if (field === 'attribute') return constraint.attribute
      if (field === 'min') return constraint.min
      if (field === 'max') return constraint.max
      return undefined

    case 'listing_feature':
      if (field === 'feature') return constraint.feature
      if (field === 'required') return constraint.required
      return undefined

    case 'commute':
      if (field === 'mode') return constraint.mode
      // Directions takes an integer for the mode, not the word.
      if (field === 'travel_mode_code') return TRAVEL_MODE_CODE[constraint.mode]
      if (field === 'max_seconds') return constraint.max_seconds
      if (field === 'depart_at') return constraint.depart_at
      if (field === 'destination_raw') return constraint.destination.raw
      // destination_point is deliberately absent. It is produced by a geocode.
      return undefined

    case 'proximity':
      if (field === 'place_raw') return constraint.place.raw
      if (field === 'radius_m') return constraint.radius_m
      return undefined

    case 'opening_hours':
      if (field === 'opens_by_s') return constraint.open_window.opens_by_s
      if (field === 'closes_after_s') return constraint.open_window.closes_after_s
      return undefined

    case 'nearby_poi':
      if (field === 'category') return constraint.category
      if (field === 'query') return constraint.query ?? constraint.category
      if (field === 'radius_m') return constraint.radius_m
      if (field === 'min_count') return constraint.min_count
      if (field === 'min_rating') return constraint.min_rating
      if (field === 'opens_by_s') return constraint.open_window?.opens_by_s
      if (field === 'closes_after_s') return constraint.open_window?.closes_after_s
      return undefined

    case 'area_signal':
      if (field === 'topic') return constraint.topic
      if (field === 'polarity') return constraint.polarity
      if (field === 'lookback_days') return constraint.lookback_days
      return undefined
  }
}

/** Fields the resolver can produce without a call, used to decide feasibility. */
export const FREE_CONSTRAINT_FIELDS: Record<ConstraintType, readonly string[]> = {
  candidate_source: [],
  search_area: [],
  budget: ['max_cents', 'min_cents', 'max_dollars', 'min_dollars'],
  unit_attribute: ['attribute', 'min', 'max'],
  listing_feature: ['feature', 'required'],
  commute: ['mode', 'travel_mode_code', 'max_seconds', 'depart_at', 'destination_raw'],
  proximity: ['place_raw', 'radius_m'],
  opening_hours: ['opens_by_s', 'closes_after_s'],
  nearby_poi: [
    'category',
    'query',
    'radius_m',
    'min_count',
    'min_rating',
    'opens_by_s',
    'closes_after_s',
  ],
  area_signal: ['topic', 'polarity', 'lookback_days'],
}

/**
 * The binding a ref depends on, or null when it is free from the start.
 * Requirements are read off the params template rather than declared by hand, so
 * a registry row cannot claim to need less than it uses.
 */
export function bindingForRef(ref: string, constraintType: ConstraintType): BindingKey | null {
  const [namespace, ...rest] = ref.replace(/^\$/, '').split('.')
  switch (namespace) {
    case 'query':
      // The place itself is on the question and needs nothing. Its coordinates
      // have to be found first.
      return rest[0] === 'anchor' ? null : BINDING_ANCHOR
    case 'entity':
      return BINDING_ENTITY
    case 'cluster':
      return BINDING_CLUSTER
    case 'stage':
      return `stage.${rest[0]}`
    case 'constraint': {
      const field = rest[1]
      if (!field) return null
      return FREE_CONSTRAINT_FIELDS[constraintType].includes(field)
        ? null
        : constraintBinding(field)
    }
    default:
      return null
  }
}
