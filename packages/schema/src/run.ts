import { z } from 'zod'
import { GeoPoint } from './units.ts'
import { EvidenceRow } from './evidence.ts'
import { PlanTrace, Tier } from './plan.ts'

export const RunStatus = z.enum([
  'queued',
  'running',
  'partial',
  'complete',
  'failed',
  'rejected_over_budget',
])

/** Distinguished in the trace because they mean different things. A ledger hit
 * means we already knew this about this entity, possibly from another query;
 * a cache hit means we already made this exact call. */
export const OpStatus = z.enum([
  'pending',
  'claimed',
  'running',
  'ok',
  'error',
  'cache_hit',
  'ledger_hit',
  'skipped',
])

/** Anything a source can put on a map: a flat, a restaurant, a university. */
export const AttributeValue = z.union([z.string(), z.number(), z.boolean()])

export const Place = z.object({
  entity_id: z.string(),
  title: z.string(),
  /**
   * Null for the small share of listings the provider returns without
   * coordinates. They stay in the run and go unverified on anything positional,
   * because dropping them would be a silent answer to a question nobody asked.
   */
  point: GeoPoint.nullable(),
  price_cents: z.number().int().nullable(),
  price_cents_upper: z.number().int().nullable(),
  /**
   * Everything else the source knows: bedrooms, a star rating, a cuisine. Open
   * so a new kind of result needs no change here, and rendered through a table
   * of keys worth showing.
   */
  attributes: z.record(z.string(), AttributeValue).default({}),
  url: z.string().nullable(),
  photo_url: z.string().nullable(),
  /** More of the same listing, for anyone who wants to look before checking. */
  photos: z.array(z.string()).default([]),
})

export const StageProgress = z.object({
  stage_id: z.string(),
  index: z.number().int(),
  tier: Tier,
  status: z.enum(['planned', 'running', 'complete', 'failed']),
  ops_planned: z.number().int(),
  ops_executed: z.number().int(),
  ops_failed: z.number().int(),
  entities_in: z.number().int(),
  entities_out: z.number().int(),
  cost_units: z.number().int(),
})

export const CostTrace = z.object({
  naive_units: z.number().int(),
  planned_units: z.number().int(),
  actual_units: z.number().int(),
  calls_made: z.number().int(),
  by_status: z.record(OpStatus, z.number().int()),
})

export const RankedEntity = z.object({
  entity_id: z.string(),
  score: z.number(),
  evidence: z.array(EvidenceRow),
  explanation: z.string().optional(),
})

export const UnverifiedEntity = z.object({
  entity_id: z.string(),
  unknown_constraint_ids: z.array(z.string()),
  evidence: z.array(EvidenceRow),
})

export const RejectedEntity = z.object({
  entity_id: z.string(),
  failed_constraint_ids: z.array(z.string()),
  evidence: z.array(EvidenceRow),
})

/**
 * Three buckets, never two. An unknown is not a pass and it is not a rejection.
 */
export const RunResult = z.object({
  run_id: z.string(),
  status: RunStatus,
  plan_id: z.string(),
  /** Monotonic. The polling cursor for GET /run/{id}?since_version=N. */
  version: z.number().int(),
  plan_trace: PlanTrace,
  stages: z.array(StageProgress),
  entities: z.record(z.string(), Place),
  results: z.array(RankedEntity),
  unverified: z.array(UnverifiedEntity),
  rejections: z.array(RejectedEntity),
  cost: CostTrace,
})

export type RunStatus = z.infer<typeof RunStatus>
export type OpStatus = z.infer<typeof OpStatus>
/** A number a source recorded, or null if it recorded none. */
export function numberOf(place: { attributes: Record<string, AttributeValue> }, key: string) {
  const value = place.attributes[key]
  return typeof value === 'number' ? value : null
}

export type AttributeValue = z.infer<typeof AttributeValue>
export type Place = z.infer<typeof Place>
export type StageProgress = z.infer<typeof StageProgress>
export type CostTrace = z.infer<typeof CostTrace>
export type RankedEntity = z.infer<typeof RankedEntity>
export type UnverifiedEntity = z.infer<typeof UnverifiedEntity>
export type RejectedEntity = z.infer<typeof RejectedEntity>
export type RunResult = z.infer<typeof RunResult>
