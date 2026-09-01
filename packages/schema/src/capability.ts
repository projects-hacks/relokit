import { z } from 'zod'
import { Subject } from './subject.ts'
import { ConstraintType } from './constraints.ts'

export const Provider = z.enum([
  'zillow',
  'google_maps',
  'google_maps_directions',
  'google_local',
  'google_maps_reviews',
  'yelp',
  'google_news',
  /**
   * Not a provider. Facts established by arithmetic on coordinates already in
   * hand, which cost nothing and are attributed to nobody. A claim we worked out
   * ourselves must not be able to appear as one somebody answered.
   */
  'geometry',
])

/**
 * native  a predicate the provider already applies for free inside a search we
 *         were making anyway. Costs nothing.
 * region  one call covers the whole search area.
 * cluster one call per cluster centroid.
 * entity  one call per surviving entity. Always last.
 */
export const Granularity = z.enum(['native', 'region', 'cluster', 'entity'])

/**
 * A late-bound parameter. Xano resolves these at execution time against the
 * binding for the current op. The set is closed so the resolver is total, and
 * /run rejects any op carrying a ref outside it.
 */
export const ParamRefPattern =
  /^\$(query\.(anchor|anchor_point|subject_term)|entity\.(id|lat|lng)|cluster\.(id|lat|lng|radius_m)|(constraint|stage)\.[a-z0-9_]+\.[a-z0-9_]+)$/

/** Refs may be interpolated, because Directions wants "lat,lng" in one field. */
const REF_TOKEN = /\$[a-z_]+(?:\.[a-z0-9_]+)+/g

export function paramRefs(v: unknown): string[] {
  return typeof v === 'string' ? (v.match(REF_TOKEN) ?? []) : []
}

/**
 * Every ref token in a value must be a known ref. This is what lets Xano treat
 * the resolver as total: /run rejects the plan before an unknown ref can reach it.
 */
export const ParamValue = z
  .union([z.string(), z.number(), z.boolean()])
  .refine((v) => paramRefs(v).every((ref) => ParamRefPattern.test(ref)), {
    message: 'param ref is outside the closed set',
  })

/**
 * Where a capability's numbers come from: measured in this place, measured
 * somewhere, or still the registry's labelled guess. Nothing in between.
 */
export const PriorBasis = z.enum(['assumed', 'measured_here', 'measured'])

export const Capability = z.object({
  capability_id: z.string(),
  constraint_type: ConstraintType,
  provider: Provider,
  /** SerpApi engine plus purpose, e.g. "google_maps:directions". */
  endpoint: z.string(),
  granularity: Granularity,
  /** SerpApi calls per invocation. Zero for native. */
  cost_units: z.number().int().nonnegative(),
  latency_p50_ms: z.number().int().nonnegative(),
  /**
   * The fraction of candidates expected to PASS this capability, not the fraction
   * eliminated. 0.35 on in_unit_laundry means 35% of listings have it.
   */
  selectivity_prior: z.number().min(0).max(1),
  /** Decisive answers behind the numbers above when they are measured. */
  observation_n: z.number().int().nonnegative().default(0),
  /** Set at plan time by the observation ladder. Never stored. */
  prior_basis: PriorBasis.default('assumed'),
  ttl_seconds: z.number().int().positive(),
  /** Fraction of entities for which this returns a verdict other than unknown. */
  coverage: z.number().min(0).max(1),
  /** Tie-break, and conflict resolution when two sources disagree. Lower wins. */
  precedence: z.number().int(),
  enabled: z.boolean(),
  /** Hard ceiling on ops per stage. The first defence against runaway fan-out. */
  max_fanout: z.number().int().positive(),
  params_template: z.record(z.string(), ParamValue),
  /**
   * Bindings this capability makes available to later stages. A geocode produces
   * constraint.destination_point; a candidate search produces entity. What a
   * capability *requires* is not declared here, it is read off params_template,
   * so a row cannot claim to need less than it uses.
   */
  produces: z.array(z.string()).default([]),
  /**
   * Subjects a candidate source can produce. Empty on everything else, which
   * answers questions about candidates rather than making them.
   */
  subjects: z.array(Subject).default([]),
  notes: z.string().optional(),
})

export const Registry = z.object({
  registry_version: z.string(),
  capabilities: z.array(Capability).min(1),
})

export type Provider = z.infer<typeof Provider>
export type PriorBasis = z.infer<typeof PriorBasis>
export type Granularity = z.infer<typeof Granularity>
export type ParamValue = z.infer<typeof ParamValue>
export type Capability = z.infer<typeof Capability>
export type Registry = z.infer<typeof Registry>
