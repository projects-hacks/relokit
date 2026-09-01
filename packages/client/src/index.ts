import { bucket, relaxations, type Buckets, type Relaxation } from '@relokit/evidence'
import { replayRun } from '@relokit/executor'
import { normalizeConstraintSet, PARSER_VERSION, type Repair } from '@relokit/llm'
import { NEAR_ME, anchorToHere } from './near.ts'
import {
  ONCE,
  PATIENT,
  Refused,
  Waiting,
  retryAfterMs,
  withRetry,
  worthRetrying,
  type RetryPolicy,
} from './retry.ts'
import { applyObservations, plan, regionKey } from '@relokit/planner'
import {
  ObservationRows,
  PlanBudget,
  Registry,
  type ConstraintSet,
  type EvidenceRow,
  type Place,
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
  /** A policy overrides the default waiting, for a call not safe to repeat. */
  post(
    path: string,
    body: Record<string, unknown>,
    policy?: RetryPolicy,
  ): Promise<Record<string, unknown>>
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
  /** Everything known so far, in the same shape as the final answer, so a page
   * can show it while the rest is still being checked. */
  | { kind: 'partial'; result: AskResult }

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
  entities: Place[]
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
  /** Calls of one operation to have in the air at once. */
  concurrency?: number
  now_ms?: number
  evaluation_days?: Weekday[]
  onProgress?: AskProgress
  /**
   * Ask the same question with a requirement changed.
   *
   * The parse still happens, because the registry and the budget come back with
   * it and it is answered from cache anyway, but these constraints are used
   * instead of the ones the model produced. That is what lets "twenty six
   * minutes would add one more" be a thing you can press.
   */
  constraints?: ConstraintSet
  /** Stops the run between calls. What was already fetched stays fetched. */
  signal?: AbortSignal
  /** The reader's own coordinates, when the question says near me. */
  here?: { lat: number; lng: number }
  /** How long to wait before asking a failing backend again. */
  retry?: RetryPolicy
}

export async function ask(
  transport: Transport,
  query: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const now = options.now_ms ?? Date.now()
  const report = options.onProgress ?? (() => {})
  const stopped = () => {
    if (options.signal?.aborted) throw new DOMException('The run was stopped.', 'AbortError')
  }
  stopped()

  const patience = options.retry
  const parsed = await transport.post('/parse', { query }, patience)
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
  const { constraint_set: parsedSet, repairs } = normalized
  let constraint_set = options.constraints ?? parsedSet
  if (options.here && NEAR_ME.test(query)) {
    constraint_set = anchorToHere(constraint_set, options.here)
  }
  report({ kind: 'parsed', answered_by: String(parsed.answered_by), constraint_set, repairs })

  const registry = Registry.parse({
    registry_version: parsed.registry_version,
    capabilities: parsed.registry,
  })

  // What past runs measured, turned into priors by the ladder. A malformed
  // learning payload costs the learning, never the search.
  let observed: ObservationRows = []
  try {
    observed = ObservationRows.parse(parsed.observations ?? [])
  } catch {
    observed = []
  }
  const region = regionKey(constraint_set)
  const capabilities = applyObservations(registry.capabilities, observed, region)

  const budget = PlanBudget.parse(parsed.budget)
  const planned = plan({
    constraints: constraint_set,
    registry: capabilities,
    registry_version: registry.registry_version,
    budget,
    now_ms: now,
  })
  report({ kind: 'planned', plan: planned })

  const accepted = await transport.post('/run', { constraint_set, plan: planned }, patience)
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
    capabilities,
    async (_engine, params, context) => {
      stopped()
      const answer = await transport.post(
        '/op',
        {
          run_id: runId,
          op_id: context.op_id,
          capability_id: context.capability_id,
          endpoint: context.endpoint,
          ttl_seconds: context.ttl_seconds,
          constraint_ids: context.constraint_ids,
          entity_ids: context.entity_ids,
          params,
        },
        // Asked once, whatever the rest of the run does.
        //
        // I thought a repeat was free here, because the cache the first attempt
        // fills would answer the second. Measured, it is not: a run of forty six
        // planned calls spent fifty real searches, because a call that fails
        // after the provider has answered has already been paid for, and asking
        // again pays for it twice. The upstream is metered and the failure is
        // already handled: the listings that call covered go unverified, which
        // is the answer this product is built to give.
        options.retry ?? ONCE,
      )
      return answer.body
    },
    {
      now_ms: now,
      evaluation_days: options.evaluation_days ?? ['tue'],
      overshoot_factor: budget.overshoot_factor,
      // One at a time. Measured against the live backend, six in flight left a
      // cache hit taking 26 seconds instead of 2.6 and the whole run slower:
      // the requests queue there rather than running alongside each other, so
      // asking for parallelism only moves the waiting.
      concurrency: options.concurrency ?? 1,
      // A whole stage handed to the queue in one request, then worked off by
      // short polls, four calls a turn. No connection is ever held open while
      // a provider thinks: a poll that dies loses nothing, the next one
      // carries on, and a job that kills two polls is passed over and comes
      // back as its own failure without taking its neighbours with it.
      searchBatch: async (requests) => {
        const queued = await transport.post(
          '/jobs',
          {
            run_id: runId,
            calls: requests.map((request) => ({
              op_id: request.context.op_id,
              capability_id: request.context.capability_id,
              endpoint: request.context.endpoint,
              ttl_seconds: request.context.ttl_seconds,
              constraint_ids: request.context.constraint_ids,
              entity_ids: request.context.entity_ids,
              params: request.params,
            })),
          },
          // Enqueued once: a repeat would queue every job twice.
          ONCE,
        )
        const ids = queued.job_ids as number[]
        if (!Array.isArray(ids) || ids.length !== requests.length) {
          throw new Error('/jobs queued a different number of calls than were handed over')
        }

        // Polls tolerate a bad minute; the queue holds the state, not the
        // connection. The cap is generous: a full stage at four jobs a turn,
        // with room for every job to fail twice.
        for (let turn = 0; turn < requests.length + 8; turn += 1) {
          stopped()
          const progress = await transport.post('/jobs/run', { run_id: runId })
          if (Number(progress.pending) === 0) break
        }

        const held = (await transport.get(`/jobs?run_id=${runId}`)) as unknown as {
          jobs: { id: number; status: string; answer?: { body?: unknown } }[]
        }
        const byId = new Map(held.jobs.map((job) => [job.id, job]))
        return ids.map((id) => {
          const job = byId.get(id)
          if (job?.status === 'done') return job.answer?.body
          return { batch_failed: 'passed over after two attempts; the source could not settle it' }
        })
      },
      // A stage travels whole: the polls are short regardless of how much
      // waits, so there is no reason to split the handover.
      groupSize: 24,
      // What is already known, after every stage. The relaxation offers wait
      // for the end, because half-checked failures make bad advice.
      onStage: (partial) => {
        const soFar = bucket(partial.entities, partial.evidence, constraint_set.constraints)
        report({
          kind: 'partial',
          result: {
            run_id: runId,
            constraint_set,
            repairs,
            plan: planned,
            entities: partial.entities,
            evidence: partial.evidence,
            buckets: soFar,
            relaxations: [],
            anchor: null,
            problems: [],
            unanswered: [],
            cost: {
              naive_units: planned.trace.naive_cost_units,
              planned_units: planned.trace.planned_cost_units,
              actual_units: 0,
              live: 0,
              cache_hits: 0,
              ledger_hits: 0,
            },
          },
        })
      },
    },
  )

  for (const stage of outcome.stages) report({ kind: 'stage', ...stage })
  for (const skipped of outcome.skipped) report({ kind: 'skipped', ...skipped })

  // In chunks, because the whole record of a big run in one request is what a
  // struggling gateway drops first. Each piece is additive, so partial
  // persistence degrades to fewer stored rows rather than a failed run.
  const entityRows = outcome.entities.map((entity) => ({
    entity_id: entity.entity_id,
    kind: 'listing',
    provider: 'zillow',
    lat: entity.point?.lat ?? null,
    lng: entity.point?.lng ?? null,
    display: entity,
  }))
  const evidenceRows = outcome.evidence.map((row) => ({
    ...row,
    value_canonical: typeof row.value_canonical === 'number' ? row.value_canonical : null,
    value_text: typeof row.value_canonical === 'string' ? row.value_canonical : null,
  }))
  const CHUNK = 60
  stopped()
  // Keeping the record is not what the reader asked for. The answer is already
  // in hand by this point, computed here from what came back, so a backend that
  // refuses the write costs a stored copy and a nightly comparison, not the
  // answer on screen. It is written down as a problem rather than swallowed.
  //
  // Not retried, either: a repeat would write every fact in the chunk a second
  // time, since only entities are checked before insert.
  const keeping: string[] = []
  // Counts of what each capability did, filed first and alone. The run's own
  // burst leaves the instance winded exactly when filing starts, and the big
  // chunks are what it drops; a small request lands where a heavy one dies,
  // so the learning is not chained to the least reliable call of the run.
  try {
    await transport.post(
      '/ingest',
      {
        run_id: runId,
        entities: [],
        evidence: [],
        region,
        observations: outcome.observed.map(({ capability_id, answered, decisive, passed }) => ({
          capability_id,
          answered,
          decisive,
          passed,
        })),
      },
      { attempts: 1, base_ms: 0, cap_ms: 0 },
    )
  } catch {
    // The next run measures the same things; a lost filing costs nothing.
  }
  for (let at = 0; at < Math.max(entityRows.length, evidenceRows.length, 1); at += CHUNK) {
    try {
      await transport.post(
        '/ingest',
        {
          run_id: runId,
          entities: entityRows.slice(at, at + CHUNK),
          evidence: evidenceRows.slice(at, at + CHUNK),
        },
        { attempts: 1, base_ms: 0, cap_ms: 0 },
      )
    } catch (error) {
      keeping.push(error instanceof Error ? error.message : String(error))
    }
  }

  // The tallies are a nicety; the spend the reader is shown comes back with
  // them, so falling back to what the executor counted is honest rather than
  // blank.
  type Stored = { ops: { status: string }[]; cost: Record<string, number> }
  let stored: Stored | null = null
  try {
    stored = (await transport.get(`/runs?run_id=${runId}`)) as unknown as Stored
  } catch {
    // Left as nothing, and the counts below fall back to what was measured here.
  }
  const tally = (status: string) =>
    stored ? stored.ops.filter((op) => op.status === status).length : 0

  const buckets = bucket(outcome.entities, outcome.evidence, constraint_set.constraints)

  return {
    run_id: runId,
    constraint_set,
    repairs,
    plan: planned,
    entities: outcome.entities,
    evidence: outcome.evidence,
    buckets,
    relaxations: relaxations(buckets, constraint_set.constraints, {
      distance_unit: constraint_set.locale.distance_unit,
    }),
    anchor:
      constraint_set.search_anchor && outcome.anchor_point
        ? { label: constraint_set.search_anchor.raw, point: outcome.anchor_point }
        : null,
    problems: [
      // Said first, because it explains an empty answer completely and nothing
      // below it will.
      ...outcome.contradictions.map((entry) => ({ op_id: 'requirements', detail: entry.detail })),
      ...outcome.unresolved.map((entry) => ({
        op_id: entry.op_id,
        detail: `nothing had established ${entry.ref} by the time it was needed`,
      })),
      ...outcome.missing.map((entry) => ({
        op_id: entry.op_id,
        detail: readable(entry.detail, entry.engine),
      })),
      // The answer stands; what failed was writing it down. Worth saying,
      // because it is why tracking this question would find nothing tonight.
      ...(keeping.length > 0
        ? [
            {
              op_id: 'keeping',
              // The cause rides along, because a filing that fails the same
              // way every night is invisible without it.
              detail: `This answer could not be filed, so tracking it would have nothing to compare against. Asking again will file it. (${keeping[0]})`,
            },
          ]
        : []),
    ],
    unanswered: planned.unsatisfied.map((entry) => ({
      constraint_id: entry.constraint_id,
      reason: UNANSWERED[entry.reason] ?? entry.reason,
    })),
    // The backend keeps the authoritative tally, and where it could not be
    // asked the plan and the run itself still know what was intended and what
    // was called. Better a number measured here than a blank where a number
    // belongs.
    cost: {
      naive_units: stored?.cost.naive_units ?? planned.trace.naive_cost_units,
      planned_units: stored?.cost.planned_units ?? planned.trace.planned_cost_units,
      actual_units: stored?.cost.actual_units ?? outcome.calls,
      live: stored ? tally('ok') : outcome.calls,
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
/**
 * Every call goes through the same waiting.
 *
 * Asking an operation again is safe for the budget, which is the only thing
 * that would make retrying dishonest: the first attempt fills the cache before
 * the gateway gives up on it, so a second attempt reads that cache, is recorded
 * as a cache hit rather than a search, and the ledger stays true.
 */
async function once(url: string, init: RequestInit | undefined, path: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    // Never reached the other end, so nothing happened there to repeat.
    throw new Error(`${path} could not be reached: ${(error as Error).message}`)
  }
  const text = await response.text()
  if (response.ok) return JSON.parse(text)

  const said = `${path} returned ${response.status}: ${text.slice(0, 300)}`
  if (!worthRetrying(response.status)) throw new Refused(said, response.status)
  const after = retryAfterMs(response.headers.get('retry-after'))
  throw after === null ? new Error(said) : new Waiting(said, after)
}

export function httpTransport(api: string, orgKey: string, policy = PATIENT): Transport {
  return {
    async post(path, body, override) {
      return withRetry(
        () =>
          once(
            `${api}${path}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              // Behind the proxy the key is added server side, so an empty one
              // is not sent at all rather than sent blank.
              body: JSON.stringify(orgKey ? { org_key: orgKey, ...body } : body),
            },
            path,
          ),
        override ?? policy,
      ) as Promise<Record<string, unknown>>
    },
    async get(path) {
      const separator = path.includes('?') ? '&' : '?'
      const suffix = orgKey ? `${separator}org_key=${encodeURIComponent(orgKey)}` : ''
      return withRetry(() => once(`${api}${path}${suffix}`, undefined, path), policy) as Promise<
        Record<string, unknown>
      >
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

/**
 * What a reader can do something about.
 *
 * A transport error is a wall of JSON with an HTTP code inside it. The two that
 * actually happen have plain names, and saying "the search allowance for this
 * month is used up" is the difference between a person knowing to wait and a
 * person thinking the product is broken.
 */
function readable(detail: string, engine: string): string {
  if (!detail) return `${engine} did not answer`
  // The queue writes its verdicts in plain words already; translating them
  // into "did not answer" would lose the only part worth reading.
  if (detail.includes('passed over')) return `${engine}: ${detail}`
  if (detail.includes('run out of searches') || detail.includes(' 429')) {
    return 'the search allowance for this month is used up, so nothing new could be looked up'
  }
  if (detail.includes(' 401') || detail.includes('unauthorized')) {
    return 'the search key on this instance was refused'
  }
  const refused = /refused this call with (\d+)/.exec(detail)
  if (refused) return `${engine} refused the request with ${refused[1]}`
  return `${engine} did not answer`
}

/** What changed since a question was last asked, and what asking again cost. */
export interface Change {
  entity_id: string
  change_type: 'entered_pass' | 'left_pass' | 'value_change' | 'verdict_flip'
  before: { price?: number } | null
  after: { price?: number } | null
}

export interface WatchState {
  watching: boolean
  due_at: number | null
  re_asked: number
  first_cost: number
  last_cost: number | null
  asked_at: number | null
  changes: Change[]
}

export async function readWatch(transport: Transport, runId: number): Promise<WatchState> {
  return (await transport.get(`/changes?run_id=${runId}`)) as unknown as WatchState
}

/**
 * Keep asking this question. There is no separate save: a question worth
 * watching is a question worth keeping, and asking someone to do both would be
 * asking twice.
 */
export async function setWatch(
  transport: Transport,
  runId: number,
  name: string,
  enabled: boolean,
): Promise<void> {
  await transport.post('/watch', { run_id: runId, name, enabled })
}

export { NEAR_ME, anchorToHere } from './near.ts'
