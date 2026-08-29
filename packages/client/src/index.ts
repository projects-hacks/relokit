import { bucket, relaxations, type Buckets, type Relaxation } from '@relokit/evidence'
import { replayRun } from '@relokit/executor'
import { normalizeConstraintSet, PARSER_VERSION, type Repair } from '@relokit/llm'
import { plan } from '@relokit/planner'
import {
  PlanBudget,
  Registry,
  type ConstraintSet,
  type EvidenceRow,
  type ListingSummary,
  type PlanResult,
  type Weekday,
} from '@relokit/schema'

/**
 * The whole question, start to finish.
 *
 * One implementation, used by the command line and by the browser, because the
 * two disagreeing about what a rejection is would be worse than either being
 * wrong on its own.
 *
 * The split it follows: Xano parses, because it holds the model key, and Xano
 * makes every call, because it holds the search key and decides what is worth
 * spending. Everything here is deterministic and free, which is why it can run
 * next to the person asking.
 */
export interface Transport {
  post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>>
  get(path: string): Promise<Record<string, unknown>>
}

export interface AskProgress {
  (event: AskEvent): void
}

export type AskEvent =
  | { kind: 'parsed'; answered_by: string; constraint_set: ConstraintSet; repairs: Repair[] }
  | { kind: 'planned'; plan: PlanResult }
  | { kind: 'accepted'; run_id: number; worst_case_units: number; ceiling_cost_units: number }
  | { kind: 'stage'; stage_id: string; entities_in: number; entities_out: number; calls: number }
  | { kind: 'skipped'; stage_id: string; reason: string }

/** Something that stopped a call from happening, in words a person can act on. */
export interface Problem {
  op_id: string
  detail: string
}

export interface AskResult {
  run_id: number
  constraint_set: ConstraintSet
  repairs: Repair[]
  plan: PlanResult
  entities: ListingSummary[]
  evidence: EvidenceRow[]
  buckets: Buckets
  relaxations: Relaxation[]
  /** The place the question named, so a map can always show what was searched
   * around even when nothing else was asked for. */
  anchor: { label: string; point: { lat: number; lng: number } } | null
  /** Empty when everything ran. Never hidden: a run that found nothing has to
   * be able to say why, or it is just a confident blank page. */
  problems: Problem[]
  unanswered: { constraint_id: string; reason: string }[]
  cost: {
    naive_units: number
    planned_units: number
    actual_units: number
    live: number
    cache_hits: number
    ledger_hits: number
  }
}

export interface AskOptions {
  now_ms?: number
  evaluation_days?: Weekday[]
  onProgress?: AskProgress
}

export async function ask(
  transport: Transport,
  query: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const now = options.now_ms ?? Date.now()
  const report = options.onProgress ?? (() => {})

  const parsed = await transport.post('/parse', { query })
  const raw = readJson(String(parsed.raw_text))

  // The model names the kind of constraint and copies the words it came from.
  // Every number is read back out of those words here.
  let normalized
  try {
    normalized = normalizeConstraintSet(raw, query, {
      query_id: `q_${now}`,
      parser_version: PARSER_VERSION,
      parsed_at_ms: now,
    })
  } catch {
    // A reader should be told what could not be understood, not handed the
    // shape of the object that failed to validate.
    throw new Error(
      'That question could not be turned into anything to check. Try naming a place, and what has to be true about a home there.',
    )
  }
  const { constraint_set, repairs } = normalized
  report({ kind: 'parsed', answered_by: String(parsed.answered_by), constraint_set, repairs })

  const registry = Registry.parse({
    registry_version: parsed.registry_version,
    capabilities: parsed.registry,
  })

  const budget = PlanBudget.parse(parsed.budget)
  const planned = plan({
    constraints: constraint_set,
    registry: registry.capabilities,
    registry_version: registry.registry_version,
    budget,
    now_ms: now,
  })
  report({ kind: 'planned', plan: planned })

  const accepted = await transport.post('/run', { constraint_set, plan: planned })
  const runId = Number(accepted.run_id)
  report({
    kind: 'accepted',
    run_id: runId,
    worst_case_units: Number(accepted.worst_case_units),
    ceiling_cost_units: Number(accepted.ceiling_cost_units),
  })

  const outcome = await replayRun(
    planned,
    constraint_set,
    registry.capabilities,
    async (_engine, params, context) => {
      const answer = await transport.post('/op', {
        run_id: runId,
        op_id: context.op_id,
        capability_id: context.capability_id,
        endpoint: context.endpoint,
        ttl_seconds: context.ttl_seconds,
        constraint_ids: context.constraint_ids,
        entity_ids: context.entity_ids,
        params,
      })
      return answer.body
    },
    {
      now_ms: now,
      evaluation_days: options.evaluation_days ?? ['tue'],
      overshoot_factor: budget.overshoot_factor,
    },
  )

  for (const stage of outcome.stages) report({ kind: 'stage', ...stage })
  for (const skipped of outcome.skipped) report({ kind: 'skipped', ...skipped })

  await transport.post('/ingest', {
    run_id: runId,
    entities: outcome.entities.map((entity) => ({
      entity_id: entity.entity_id,
      kind: 'listing',
      provider: 'zillow',
      lat: entity.point?.lat ?? null,
      lng: entity.point?.lng ?? null,
      display: entity,
    })),
    evidence: outcome.evidence.map((row) => ({
      ...row,
      value_canonical: typeof row.value_canonical === 'number' ? row.value_canonical : null,
      value_text: typeof row.value_canonical === 'string' ? row.value_canonical : null,
    })),
  })

  const stored = (await transport.get(`/runs?run_id=${runId}`)) as {
    ops: { status: string }[]
    cost: { naive_units: number; planned_units: number; actual_units: number }
  }
  const tally = (status: string) => stored.ops.filter((o) => o.status === status).length

  const buckets = bucket(outcome.entities, outcome.evidence, constraint_set.constraints)

  return {
    run_id: runId,
    constraint_set,
    repairs,
    plan: planned,
    entities: outcome.entities,
    evidence: outcome.evidence,
    buckets,
    relaxations: relaxations(buckets, constraint_set.constraints),
    anchor:
      constraint_set.search_anchor && outcome.anchor_point
        ? { label: constraint_set.search_anchor.raw, point: outcome.anchor_point }
        : null,
    problems: [
      ...outcome.unresolved.map((entry) => ({
        op_id: entry.op_id,
        detail: `nothing had established ${entry.ref} by the time it was needed`,
      })),
      ...outcome.missing.map((entry) => ({
        op_id: entry.op_id,
        detail: entry.detail || `${entry.engine} did not answer`,
      })),
    ],
    unanswered: planned.unsatisfied.map((entry) => ({
      constraint_id: entry.constraint_id,
      reason: UNANSWERED[entry.reason] ?? entry.reason,
    })),
    cost: {
      naive_units: stored.cost.naive_units,
      planned_units: stored.cost.planned_units,
      actual_units: stored.cost.actual_units,
      live: tally('ok'),
      cache_hits: tally('cache_hit'),
      ledger_hits: tally('ledger_hit'),
    },
  }
}

/** Models fence their JSON however they like, so take the outermost braces. */
function readJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('the model did not return JSON')
  return JSON.parse(text.slice(start, end + 1))
}

/** Talks to a Relokit backend, adding the org key to everything. */
export function httpTransport(api: string, orgKey: string): Transport {
  return {
    async post(path, body) {
      const response = await fetch(`${api}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_key: orgKey, ...body }),
      })
      const text = await response.text()
      if (!response.ok)
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`)
      return JSON.parse(text)
    },
    async get(path) {
      const separator = path.includes('?') ? '&' : '?'
      const response = await fetch(`${api}${path}${separator}org_key=${encodeURIComponent(orgKey)}`)
      const text = await response.text()
      if (!response.ok)
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`)
      return JSON.parse(text)
    },
  }
}

/** Why a requirement could not be checked, said plainly. */
const UNANSWERED: Record<string, string> = {
  no_capability: 'nothing here knows how to check this',
  all_disabled: 'the only source that could check this is switched off',
  zero_coverage: 'the source that could check this never answers it',
  over_budget: 'checking this would have cost more than the run was allowed',
  unbound: 'it depends on something earlier that never arrived',
}
