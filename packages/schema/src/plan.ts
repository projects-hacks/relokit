import { z } from 'zod'
import { BBox, GeoPoint, Meters, Seconds } from './units.ts'
import { ConstraintSet } from './constraints.ts'
import { Capability, Granularity, ParamValue, Provider } from './capability.ts'

export const Tier = Granularity

export const PlanBudget = z.object({
  max_cost_units: z.number().int().positive(),
  max_stages: z.number().int().positive(),
  cluster_count: z.number().int().positive(),
  /** Inflation over the naive distance bound. Straight lines are not roads. */
  overshoot_factor: z.number().min(1),
})

export const PlanInput = z.object({
  constraints: ConstraintSet,
  /** Supplied by Xano from its capability table. Never hardcoded in the planner. */
  registry: z.array(Capability),
  registry_version: z.string(),
  budget: PlanBudget,
  now_ms: z.number().int().positive(),
})

export const Op = z.object({
  op_id: z.string(),
  capability_id: z.string(),
  /** Constraints this op produces evidence for. */
  constraint_ids: z.array(z.string()).min(1),
  provider: Provider,
  endpoint: z.string(),
  params: z.record(z.string(), ParamValue),
  cost_units: z.number().int().nonnegative(),
  ttl_seconds: z.number().int().positive(),
  /** 'unknown' writes unknown evidence and continues. 'abort' kills the run. */
  on_error: z.enum(['unknown', 'abort']),
})

/**
 * Cluster evidence describes a centroid, not a listing. Pruning without slack
 * rejects listings nearer the destination than their own centroid.
 */
export const PruneSlack = z.object({
  constraint_id: z.string(),
  extra_seconds: Seconds.optional(),
  extra_meters: Meters.optional(),
})

export const PruneRule = z.object({
  /** Hard constraint ids whose `fail` verdict eliminates the entity. */
  on_fail: z.array(z.string()),
  slack: z.array(PruneSlack).default([]),
})

export const Stage = z.object({
  stage_id: z.string(),
  index: z.number().int().nonnegative(),
  tier: Tier,
  fanout: z.enum(['once', 'per_cluster', 'per_entity']),
  /** Ops within a stage are independent and may run concurrently. */
  ops: z.array(Op),
  expected_entities: z.number().int().nonnegative(),
  estimated_cost_units: z.number().int().nonnegative(),
  estimated_latency_ms: z.number().int().nonnegative(),
  prune: PruneRule.nullable(),
})

export const ClusterSpec = z.object({
  cluster_id: z.string(),
  centroid: GeoPoint,
  radius_m: Meters,
})

export const UnsatisfiedConstraint = z.object({
  constraint_id: z.string(),
  reason: z.enum(['no_capability', 'all_disabled', 'zero_coverage', 'over_budget']),
})

export const CandidateTrace = z.object({
  capability_id: z.string(),
  constraint_id: z.string(),
  tier: Tier,
  selectivity_prior: z.number(),
  coverage: z.number(),
  cost_units: z.number(),
  entities_requiring_evaluation: z.number(),
  score: z.number(),
  score_rounded: z.number(),
  chosen: z.boolean(),
  reason: z.enum([
    'selected',
    'lower_score',
    'over_budget',
    'zero_coverage',
    'disabled',
    'no_matching_constraint',
  ]),
})

export const PlanTrace = z.object({
  registry_version: z.string(),
  planner_version: z.string(),
  cardinality: z.object({
    region_entities: z.number().int(),
    cluster_count: z.number().int(),
    survivors_by_stage: z.record(z.string(), z.number()),
  }),
  candidates: z.array(CandidateTrace),
  decisions: z.array(z.object({ step: z.string(), detail: z.string() })),
  /** Cost of evaluating every constraint on every candidate at entity granularity. */
  naive_cost_units: z.number().int().nonnegative(),
  planned_cost_units: z.number().int().nonnegative(),
})

export const PlanResult = z.object({
  /** Hash of constraint set, registry version, budget and planner version. */
  plan_id: z.string(),
  planner_version: z.string(),
  registry_version: z.string(),
  /** Bounds for the candidate search, from the tightest commute constraint. */
  search_bounds: BBox.nullable(),
  clusters: z.array(ClusterSpec),
  stages: z.array(Stage),
  /**
   * Constraints no capability can answer. These still exist and every entity gets
   * `unknown` for them. Dropping them silently is the failure the unknown verdict
   * exists to prevent.
   */
  unsatisfied: z.array(UnsatisfiedConstraint),
  estimated_cost_units: z.number().int().nonnegative(),
  estimated_latency_ms: z.number().int().nonnegative(),
  trace: PlanTrace,
})

export type Tier = z.infer<typeof Tier>
export type PlanBudget = z.infer<typeof PlanBudget>
export type PlanInput = z.infer<typeof PlanInput>
export type Op = z.infer<typeof Op>
export type PruneSlack = z.infer<typeof PruneSlack>
export type PruneRule = z.infer<typeof PruneRule>
export type Stage = z.infer<typeof Stage>
export type ClusterSpec = z.infer<typeof ClusterSpec>
export type UnsatisfiedConstraint = z.infer<typeof UnsatisfiedConstraint>
export type CandidateTrace = z.infer<typeof CandidateTrace>
export type PlanTrace = z.infer<typeof PlanTrace>
export type PlanResult = z.infer<typeof PlanResult>
