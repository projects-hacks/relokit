import {
  bucket,
  mapAreaSignal,
  mapDirections,
  mapGeocode,
  mapNearbyPlaces,
  mapZillowSearch,
  type Buckets,
  type MapperContext,
} from '@relokit/evidence'
import {
  boxAround,
  eliminationPower,
  gridClusters,
  reachRadiusMeters,
  refineClusters,
  slackMeters,
  slackSeconds,
} from '@relokit/planner'
import type {
  AreaSignalConstraint,
  Capability,
  ClusterSpec,
  CommuteConstraint,
  ConstraintSet,
  EvidenceRow,
  ListingSummary,
  NearbyPoiConstraint,
  Op,
  PlanResult,
  Stage,
  Weekday,
} from '@relokit/schema'
import type { Engine } from '@relokit/serpapi'
import { UnresolvedRef, resolveParams, type Bindings } from './resolve.ts'

export interface MissingFixture {
  op_id: string
  engine: Engine
  params: Record<string, string | number | boolean>
  /** What the transport actually said. Losing it turns every fault into the
   * same shrug, which is how a five hundred reads as "did not answer". */
  detail: string
}

export interface SkippedStage {
  stage_id: string
  reason: string
}

/** What a capability actually did, so the guessed priors can be replaced. */
export interface ObservedPrior {
  capability_id: string
  answered: number
  decisive: number
  passed: number
  coverage: number
  selectivity: number
}

export interface RunOutcome {
  buckets: Buckets
  /** Where the search was centred, once something has found it. */
  anchor_point: { lat: number; lng: number } | null
  observed: ObservedPrior[]
  skipped: SkippedStage[]
  entities: ListingSummary[]
  evidence: EvidenceRow[]
  missing: MissingFixture[]
  unresolved: { op_id: string; ref: string }[]
  calls: number
  stages: { stage_id: string; entities_in: number; entities_out: number; calls: number }[]
}

/**
 * How a call gets made. Against recorded responses it reads a file; against the
 * live backend it posts to /op, which decides whether the call happens at all.
 * The context is what /op needs to decide that: which listings the call is
 * about, and how long its answer stays true.
 */
export interface OpContext {
  op_id: string
  capability_id: string
  endpoint: string
  ttl_seconds: number
  constraint_ids: string[]
  entity_ids: string[]
}

type Search = (
  engine: Engine,
  params: Record<string, string | number | boolean>,
  context: OpContext,
) => Promise<unknown>

export async function replayRun(
  plan: PlanResult,
  constraints: ConstraintSet,
  registry: Capability[],
  search: Search,
  options: { now_ms: number; evaluation_days: Weekday[]; overshoot_factor: number },
): Promise<RunOutcome> {
  const outcome: RunOutcome = {
    buckets: { results: [], unverified: [], rejections: [] },
    anchor_point: null,
    observed: [],
    skipped: [],
    entities: [],
    evidence: [],
    missing: [],
    unresolved: [],
    calls: 0,
    stages: [],
  }

  const stageOutputs: Bindings['stage'] = {}
  const produced: Bindings['produced'] = {}
  let clusters: ClusterSpec[] = plan.clusters
  let surviving: ListingSummary[] = []

  for (const stage of plan.stages) {
    const before = surviving.length
    const callsBefore = outcome.calls

    const skip = shouldSkip(stage, surviving.length)
    if (skip) {
      outcome.skipped.push({ stage_id: stage.stage_id, reason: skip })
      outcome.stages.push({
        stage_id: stage.stage_id,
        entities_in: before,
        entities_out: before,
        calls: 0,
      })
      continue
    }

    for (const op of stage.ops) {
      await runOp(op, stage)
    }

    surviving = prune(stage, surviving, outcome.evidence)
    outcome.stages.push({
      stage_id: stage.stage_id,
      entities_in: before,
      entities_out: surviving.length,
      calls: outcome.calls - callsBefore,
    })
  }

  outcome.buckets = bucket(outcome.entities, outcome.evidence, constraints.constraints)
  outcome.observed = observePriors(outcome.evidence)
  return outcome

  /**
   * The plan sizes the cluster tier from an estimate made before any listing
   * existed. By the time it runs the real count is known, and a cluster call
   * only pays for itself if it removes a listing the entity tier would
   * otherwise have had to ask about.
   *
   * Twenty listings across six clusters cannot repay six calls, so the stage is
   * skipped and the trace says why. That is the plan estimating and the
   * executor measuring, the same rule that governs survivor counts.
   */
  function shouldSkip(stage: Stage, entities: number): string | null {
    if (stage.tier !== 'cluster' || entities === 0) return null
    const clusterCount = Math.min(clusters.length, entities)
    const entityOps = plan.stages.find((s) => s.tier === 'entity')?.ops.length ?? 0
    // What gets through every cluster predicate, so what the entity tier still
    // has to ask about.
    const throughput = stage.ops.reduce((fraction, op) => {
      const capability = registry.find((c) => c.capability_id === op.capability_id)
      if (!capability) return fraction
      return fraction * (1 - eliminationPower(capability.coverage, capability.selectivity_prior))
    }, 1)
    const saving = Math.round(entities * (1 - throughput)) * entityOps
    const cost = stage.ops.length * clusterCount
    if (saving > cost) return null
    return `${entities} listings across ${clusterCount} clusters would cost ${cost} calls to save about ${saving}`
  }

  async function runOp(op: Op, stage: Stage) {
    const targets: Bindings[] =
      stage.fanout === 'per_cluster'
        ? clusters.map((c) =>
            base({
              cluster: {
                id: c.cluster_id,
                lat: c.centroid.lat,
                lng: c.centroid.lng,
                radius_m: c.radius_m,
              },
            }),
          )
        : stage.fanout === 'per_entity'
          ? surviving
              .filter((e) => e.point)
              .map((e) =>
                base({ entity: { id: e.entity_id, lat: e.point!.lat, lng: e.point!.lng } }),
              )
          : [base({})]

    for (const bindings of targets) {
      let params: Record<string, string | number | boolean>
      try {
        params = resolveParams(op.params, bindings)
      } catch (error) {
        if (!(error instanceof UnresolvedRef)) throw error
        // The plan said this was feasible and it was not. Record it against the
        // listings rather than sending a request with a hole in it.
        outcome.unresolved.push({ op_id: op.op_id, ref: error.ref })
        recordFailure(op, bindings)
        continue
      }
      const engine = String(params.engine ?? 'zillow') as Engine
      let body: unknown
      try {
        body = await search(engine, params, {
          op_id: op.op_id,
          capability_id: op.capability_id,
          endpoint: op.endpoint,
          ttl_seconds: op.ttl_seconds,
          constraint_ids: op.constraint_ids,
          entity_ids: targetEntitiesSafe(bindings),
        })
        outcome.calls += 1
      } catch (error) {
        outcome.missing.push({
          op_id: op.op_id,
          engine,
          params,
          detail: error instanceof Error ? error.message : String(error),
        })
        recordFailure(op, bindings)
        continue
      }
      absorb(op, stage, bindings, body)
    }
  }

  function base(extra: Partial<Bindings>): Bindings {
    return {
      constraints: constraints.constraints,
      anchor: constraints.search_anchor?.raw ?? '',
      produced,
      stage: stageOutputs,
      ...extra,
    }
  }

  function context(op: Op): MapperContext {
    return {
      op_id: op.op_id,
      capability_id: op.capability_id,
      source: op.provider,
      fetched_at_ms: options.now_ms,
      ttl_seconds: op.ttl_seconds,
    }
  }

  function absorb(op: Op, stage: Stage, bindings: Bindings, body: unknown) {
    // The place being searched. A question naming only a town has no commute to
    // aim at, so this is the only thing that says where to look.
    if (op.capability_id === 'candidates.anchor.geocode') {
      const geocoded = mapGeocode(body)
      if (!geocoded) return
      produced['query.anchor_point'] = `${geocoded.point.lat},${geocoded.point.lng}`
      outcome.anchor_point = geocoded.point
      // A commute says how far someone will travel. Without one, a town sized
      // box, which is wide enough to hold the answer and narrow enough to search.
      if (!stageOutputs.bounds) setBounds(geocoded.point, DEFAULT_SEARCH_RADIUS_M)
      return
    }

    if (op.capability_id === 'commute.geocode.region') {
      const geocoded = mapGeocode(body)
      if (!geocoded) return
      const commute = constraints.constraints.find((c) => c.type === 'commute') as CommuteConstraint
      const radius = reachRadiusMeters(commute.mode, commute.max_seconds, options.overshoot_factor)
      const box = boxAround(geocoded.point, radius)
      // The geocode is declared to produce constraint.destination_point, and
      // Directions wants it as "lat,lng" in a single field.
      const commuteId = op.constraint_ids[0]
      if (commuteId) {
        produced[`constraint.${commuteId}.destination_point`] =
          `${geocoded.point.lat},${geocoded.point.lng}`
      }
      stageOutputs.bounds = {
        north: box.ne.lat,
        east: box.ne.lng,
        south: box.sw.lat,
        west: box.sw.lng,
        lat: geocoded.point.lat,
        lng: geocoded.point.lng,
      }
      // Entity coordinates do not exist yet, so the plan lays a grid over the
      // box. It is replaced with cells fitted to the listings as soon as there
      // are any: a grid across a 23 km box gives cells wide enough that the
      // slack swallows the whole constraint.
      clusters = gridClusters(box, plan.trace.cardinality.cluster_count)
      return
    }

    if (op.capability_id === 'candidates.zillow.region') {
      const pushedDown = op.constraint_ids.filter((id) => id !== 'candidate_source')
      const answered = constraints.constraints.filter((c) => pushedDown.includes(c.id))
      const mapped = mapZillowSearch(body, answered, context(op), pushedDown)
      outcome.entities.push(...mapped.entities)
      outcome.evidence.push(...mapped.evidence)
      surviving = outcome.entities
      const points = outcome.entities.filter((e) => e.point).map((e) => e.point!)
      if (points.length > 0) {
        clusters = refineClusters(points, plan.trace.cardinality.cluster_count)
      }
      const region = (body as { search_information?: { region?: { name?: string } } })
        .search_information?.region?.name
      if (region) stageOutputs.candidates = { region_name: region }
      return
    }

    const constraint = constraints.constraints.find((c) => c.id === op.constraint_ids[0])
    if (!constraint) return

    const entityIds = targetEntities(stage, bindings)

    if (constraint.type === 'commute') {
      const slack = bindings.cluster ? slackSeconds(bindings.cluster.radius_m, constraint.mode) : 0
      const destination = parsePoint(produced[`constraint.${constraint.id}.destination_point`])
      for (const entityId of entityIds) {
        const origin = bindings.cluster
          ? { lat: bindings.cluster.lat, lng: bindings.cluster.lng }
          : outcome.entities.find((e) => e.entity_id === entityId)?.point
        outcome.evidence.push(
          ...mapDirections(body, constraint, context(op), {
            entity_id: entityId,
            ...(origin ? { origin } : {}),
            ...(destination ? { destination, destination_label: constraint.destination.raw } : {}),
            ...(slack > 0 ? { slack_seconds: slack } : {}),
          }),
        )
      }
      return
    }

    if (constraint.type === 'nearby_poi') {
      for (const entityId of entityIds) {
        const entity = outcome.entities.find((e) => e.entity_id === entityId)
        const origin = bindings.cluster
          ? { lat: bindings.cluster.lat, lng: bindings.cluster.lng }
          : entity?.point
        if (!origin) continue
        outcome.evidence.push(
          ...mapNearbyPlaces(body, constraint, context(op), {
            entity_id: entityId,
            origin,
            evaluation_days: options.evaluation_days,
            ...(bindings.cluster ? { slack_meters: slackMeters(bindings.cluster.radius_m) } : {}),
          }),
        )
      }
      return
    }

    if (constraint.type === 'area_signal') {
      for (const entityId of entityIds) {
        outcome.evidence.push(
          ...mapAreaSignal(body, constraint as AreaSignalConstraint, context(op), {
            entity_id: entityId,
            now_ms: options.now_ms,
          }),
        )
      }
    }
  }

  /** A cluster answer applies to every surviving listing inside that cell. */
  function targetEntities(stage: Stage, bindings: Bindings): string[] {
    if (bindings.entity) return [bindings.entity.id]
    if (!bindings.cluster) return surviving.map((e) => e.entity_id)
    const cell = clusters.find((c) => c.cluster_id === bindings.cluster!.id)!
    return surviving
      .filter((e) => e.point && inCell(e.point, cell, clusters))
      .map((e) => e.entity_id)
  }

  function recordFailure(op: Op, bindings: Bindings) {
    const constraint = constraints.constraints.find((c) => c.id === op.constraint_ids[0])
    if (!constraint) return
    for (const entityId of targetEntitiesSafe(bindings)) {
      outcome.evidence.push({
        entity_id: entityId,
        constraint_id: constraint.id,
        constraint_type: constraint.type,
        verdict: 'unknown',
        value_canonical: null,
        display_value: 'could not verify',
        source: op.provider,
        source_url: null,
        fetched_at_ms: options.now_ms,
        ttl_seconds: op.ttl_seconds,
        expires_at_ms: options.now_ms + op.ttl_seconds * 1000,
        confidence: 0,
        eval_state: 'failed',
        capability_id: op.capability_id,
        op_id: op.op_id,
        reason: 'no response for this call',
      })
    }
  }

  function targetEntitiesSafe(bindings: Bindings): string[] {
    if (bindings.entity) return [bindings.entity.id]
    if (bindings.cluster) {
      const cell = clusters.find((c) => c.cluster_id === bindings.cluster!.id)
      if (!cell) return []
      return surviving
        .filter((e) => e.point && inCell(e.point, cell, clusters))
        .map((e) => e.entity_id)
    }
    return surviving.map((e) => e.entity_id)
  }

  function setBounds(centre: { lat: number; lng: number }, radiusMeters: number) {
    const box = boxAround(centre, radiusMeters)
    stageOutputs.bounds = {
      north: box.ne.lat,
      east: box.ne.lng,
      south: box.sw.lat,
      west: box.sw.lng,
      lat: centre.lat,
      lng: centre.lng,
    }
    // Entity coordinates do not exist yet, so the plan lays a grid over the box.
    // It is replaced with cells fitted to the listings as soon as there are any:
    // a grid across a 23 km box gives cells wide enough that the slack swallows
    // the whole constraint.
    clusters = gridClusters(box, plan.trace.cardinality.cluster_count)
  }
}

/** "lat,lng" back into a point, for building a link anyone can open. */
function parsePoint(value: string | number | undefined): { lat: number; lng: number } | undefined {
  if (typeof value !== 'string') return undefined
  const [lat, lng] = value.split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng! } : undefined
}

/** About the width of a town, when nobody said how far they would travel. */
const DEFAULT_SEARCH_RADIUS_M = 8000

/** Nearest centroid wins, so every listing belongs to exactly one cell. */
function inCell(
  point: { lat: number; lng: number },
  cell: ClusterSpec,
  clusters: ClusterSpec[],
): boolean {
  let nearest = cell
  let best = Number.POSITIVE_INFINITY
  for (const candidate of clusters) {
    const d = (candidate.centroid.lat - point.lat) ** 2 + (candidate.centroid.lng - point.lng) ** 2
    if (d < best) {
      best = d
      nearest = candidate
    }
  }
  return nearest.cluster_id === cell.cluster_id
}

function prune(
  stage: Stage,
  surviving: ListingSummary[],
  evidence: EvidenceRow[],
): ListingSummary[] {
  if (!stage.prune || stage.prune.on_fail.length === 0) return surviving
  const rejected = new Set(
    evidence
      .filter(
        (e) =>
          stage.prune!.on_fail.includes(e.constraint_id) &&
          e.verdict === 'fail' &&
          e.eval_state === 'evaluated',
      )
      .map((e) => e.entity_id),
  )
  return surviving.filter((e) => !rejected.has(e.entity_id))
}

/**
 * Priors in the registry are guesses. This is what the capabilities did on real
 * data, which is what replaces them.
 */
function observePriors(evidence: EvidenceRow[]): ObservedPrior[] {
  const tally = new Map<string, { answered: number; decisive: number; passed: number }>()
  for (const row of evidence) {
    const entry = tally.get(row.capability_id) ?? { answered: 0, decisive: 0, passed: 0 }
    entry.answered += 1
    if (row.eval_state === 'evaluated' && row.verdict !== 'unknown') {
      entry.decisive += 1
      if (row.verdict === 'pass') entry.passed += 1
    }
    tally.set(row.capability_id, entry)
  }
  return [...tally.entries()]
    .map(([capability_id, t]) => ({
      capability_id,
      ...t,
      coverage: round2(t.decisive / t.answered),
      selectivity: t.decisive === 0 ? 0 : round2(t.passed / t.decisive),
    }))
    .sort((a, b) => (a.capability_id < b.capability_id ? -1 : 1))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
