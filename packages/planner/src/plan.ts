import type {
  CandidateTrace,
  Capability,
  ClusterSpec,
  Constraint,
  ConstraintType,
  Op,
  ParamValue,
  PlanInput,
  PlanResult,
  PlanTrace,
  PruneSlack,
  Stage,
  Tier,
  UnsatisfiedConstraint,
} from '@relokit/schema'
import { SEED_REGION_CANDIDATES, pagesFor, survivors } from './cardinality.ts'
import { boxAround, gridClusters, reachRadiusMeters, slackMeters, slackSeconds } from './cluster.ts'
import { bindSelf, mergeParams, stableHash } from './params.ts'
import { enabledByConstraintType, entitiesRequiringEvaluation } from './registry.ts'
import { compareCandidates, scoreCandidate, type Candidate } from './score.ts'

export const PLANNER_VERSION = '0.1.0'

const CANDIDATE_SOURCE: ConstraintType = 'candidate_source'

interface Selection {
  constraint: Constraint
  byTier: Map<Tier, Candidate>
}

/**
 * Constraints in, execution plan out. Synchronous, total, and free of I/O, the
 * clock and randomness, so the same query always produces the same plan.
 */
export function plan(input: PlanInput): PlanResult {
  const { budget, registry } = input
  const constraints = input.constraints.constraints
  const index = enabledByConstraintType(registry)
  const trace: CandidateTrace[] = []
  const decisions: { step: string; detail: string }[] = []
  const unsatisfied: UnsatisfiedConstraint[] = []

  const { bounds, clusters } = boundSearch(input, decisions)

  // Two passes, because the entity tier is scored against the survivor count and
  // the survivor count is not known until the tiers above it have been chosen.
  const cheapSelections = select(constraints, index, trace, unsatisfied, {
    cluster_count: budget.cluster_count,
    entity_survivors: 0,
    tiers: ['native', 'region', 'cluster'],
  })
  const afterNative = survivors(SEED_REGION_CANDIDATES, chosen(cheapSelections, 'native'))
  const afterCluster = survivors(afterNative, chosen(cheapSelections, 'cluster'))
  decisions.push({
    step: 'cardinality',
    detail: `${SEED_REGION_CANDIDATES} candidates in the box, about ${afterNative} after the free predicates, about ${afterCluster} after cluster level pruning`,
  })

  const selections = select(constraints, index, trace, unsatisfied, {
    cluster_count: budget.cluster_count,
    entity_survivors: afterCluster,
    tiers: ['native', 'region', 'cluster', 'entity'],
  })

  const stages = assemble(input, selections, index, afterNative, afterCluster, decisions)
  const plannedCost = stages.reduce((sum, s) => sum + s.estimated_cost_units, 0)

  const planTrace: PlanTrace = {
    registry_version: input.registry_version,
    planner_version: PLANNER_VERSION,
    cardinality: {
      region_entities: SEED_REGION_CANDIDATES,
      cluster_count: budget.cluster_count,
      survivors_by_stage: Object.fromEntries(stages.map((s) => [s.stage_id, s.expected_entities])),
    },
    candidates: trace,
    decisions,
    naive_cost_units: naiveCost(constraints, registry, SEED_REGION_CANDIDATES),
    pushdown_only_cost_units: naiveCost(
      constraints,
      registry,
      afterNative,
      chosenNativeTypes(selections),
    ),
    planned_cost_units: plannedCost,
  }

  return {
    plan_id: stableHash([input.constraints, input.registry_version, budget, PLANNER_VERSION]),
    planner_version: PLANNER_VERSION,
    registry_version: input.registry_version,
    search_bounds: bounds,
    clusters,
    stages,
    unsatisfied,
    estimated_cost_units: plannedCost,
    estimated_latency_ms: stages.reduce((sum, s) => sum + s.estimated_latency_ms, 0),
    trace: planTrace,
  }
}

function boundSearch(input: PlanInput, decisions: { step: string; detail: string }[]) {
  const commutes = input.constraints.constraints.filter((c) => c.type === 'commute')
  const tightest = commutes.sort((a, b) => a.max_seconds - b.max_seconds)[0]
  if (!tightest?.destination.point) {
    decisions.push({
      step: 'bounds',
      detail: tightest
        ? 'destination is not geocoded yet, so the box is computed during the first stage'
        : 'no commute constraint, so the search is bounded by the stated location only',
    })
    return { bounds: null, clusters: [] as ClusterSpec[] }
  }
  const radius = reachRadiusMeters(
    tightest.mode,
    tightest.max_seconds,
    input.budget.overshoot_factor,
  )
  decisions.push({
    step: 'bounds',
    detail: `${Math.round(tightest.max_seconds / 60)} minutes by ${tightest.mode} is about ${(radius / 1000).toFixed(1)} km including overshoot`,
  })
  const bounds = boxAround(tightest.destination.point, radius)
  return { bounds, clusters: gridClusters(bounds, input.budget.cluster_count) }
}

function select(
  constraints: Constraint[],
  index: Map<ConstraintType, Capability[]>,
  trace: CandidateTrace[],
  unsatisfied: UnsatisfiedConstraint[],
  ctx: { cluster_count: number; entity_survivors: number; tiers: Tier[] },
): Selection[] {
  trace.length = 0
  unsatisfied.length = 0
  const selections: Selection[] = []

  for (const constraint of constraints) {
    const available = index.get(constraint.type) ?? []
    if (available.length === 0) {
      unsatisfied.push({ constraint_id: constraint.id, reason: 'no_capability' })
      continue
    }

    const scored = available
      .filter((c) => ctx.tiers.includes(c.granularity))
      .map((c) => scoreCandidate(c, constraint.id, entitiesRequiringEvaluation(c.granularity, ctx)))
      .sort(compareCandidates)

    const byTier = new Map<Tier, Candidate>()
    for (const candidate of scored) {
      const incumbent = byTier.get(candidate.tier)
      if (!incumbent) byTier.set(candidate.tier, candidate)
      trace.push(toTrace(candidate, incumbent ? 'lower_score' : 'selected'))
    }

    if (byTier.size === 0)
      unsatisfied.push({ constraint_id: constraint.id, reason: 'all_disabled' })
    else selections.push({ constraint, byTier })
  }

  return selections
}

function assemble(
  input: PlanInput,
  selections: Selection[],
  index: Map<ConstraintType, Capability[]>,
  afterNative: number,
  afterCluster: number,
  decisions: { step: string; detail: string }[],
): Stage[] {
  const stages: Stage[] = []
  let spent = 0

  const affordable = (cost: number) => spent + cost <= input.budget.max_cost_units

  // The box has to exist before anything can be searched inside it, so the
  // geocode is emitted before the budget is consulted. It scores zero, because
  // it eliminates nothing, and would lose every comparison it entered.
  const geocodes = selections
    .filter((s) => s.constraint.type === 'commute' && !s.constraint.destination.point)
    .flatMap((s) => {
      const region = s.byTier.get('region')
      return region ? [op(region, s.constraint.id, 0)] : []
    })
  if (geocodes.length > 0) {
    // Nothing has been found yet. The box is being built, not searched.
    stages.push(regionStage('bounds', stages.length, geocodes, 0, null))
    spent += cost(geocodes)
  }

  // One search, with every free predicate pushed into it, over as many pages as
  // the estimate needs. The free predicates cut the page count as well as the
  // candidate count, so they pay for the search rather than only filtering it.
  const source = (index.get(CANDIDATE_SOURCE) ?? [])[0]
  if (source) {
    const natives = selections.flatMap((s) => {
      const native = s.byTier.get('native')
      return native ? [{ candidate: native, constraint_id: s.constraint.id }] : []
    })
    const pages = pagesFor(afterNative)
    const params = mergeParams(
      source.params_template,
      ...natives.map((n) => bindSelf(n.candidate.capability.params_template, n.constraint_id)),
    )
    const ops: Op[] = Array.from({ length: pages }, (_, page) => ({
      op_id: `op_candidates_${page + 1}`,
      capability_id: source.capability_id,
      constraint_ids: [CANDIDATE_SOURCE, ...natives.map((n) => n.constraint_id)],
      provider: source.provider,
      endpoint: source.endpoint,
      params: { ...params, page: page + 1 } as Record<string, ParamValue>,
      cost_units: source.cost_units,
      ttl_seconds: source.ttl_seconds,
      on_error: 'abort' as const,
    }))
    stages.push(regionStage('candidates', stages.length, ops, afterNative, null))
    spent += cost(ops)
    decisions.push({
      step: 'pushdown',
      detail: `${natives.length} predicates applied inside the search for nothing, taking ${pages} page${pages === 1 ? '' : 's'} rather than ${pagesFor(SEED_REGION_CANDIDATES)}`,
    })
  }

  // Region level signals that rank but never prune.
  const signals = selections.flatMap((s) => {
    const region = s.byTier.get('region')
    if (!region || s.constraint.type === 'commute') return []
    return affordable(region.capability.cost_units) ? [op(region, s.constraint.id, 0)] : []
  })
  if (signals.length > 0) {
    stages.push(regionStage('signals', stages.length, signals, afterNative, null))
    spent += cost(signals)
  }

  const clusterOps: Op[] = []
  const clusterSlack: PruneSlack[] = []
  const clusterFails: string[] = []
  for (const selection of selections) {
    const candidate = selection.byTier.get('cluster')
    if (!candidate) continue
    const opCost = candidate.capability.cost_units * input.budget.cluster_count
    if (!affordable(opCost)) continue
    clusterOps.push(op(candidate, selection.constraint.id, clusterOps.length))
    if (selection.constraint.hardness === 'hard') {
      clusterFails.push(selection.constraint.id)
      clusterSlack.push(slackFor(selection.constraint, input.budget))
    }
  }
  if (clusterOps.length > 0) {
    const opsCost = clusterOps.reduce(
      (sum, o) => sum + o.cost_units * input.budget.cluster_count,
      0,
    )
    stages.push({
      stage_id: 'clusters',
      index: stages.length,
      tier: 'cluster',
      fanout: 'per_cluster',
      ops: clusterOps,
      expected_entities: afterCluster,
      estimated_cost_units: opsCost,
      estimated_latency_ms: Math.max(...clusterOps.map((o) => latency(o, input.registry))),
      prune: { on_fail: clusterFails, slack: clusterSlack },
    })
    spent += opsCost
  }

  const entityOps: Op[] = []
  const entityFails: string[] = []
  const entityCaps: Capability[] = []
  for (const selection of selections) {
    const candidate = selection.byTier.get('entity')
    if (!candidate) continue
    const opCost = candidate.capability.cost_units * afterCluster
    if (!affordable(opCost)) continue
    entityOps.push(op(candidate, selection.constraint.id, entityOps.length))
    entityCaps.push(candidate.capability)
    if (selection.constraint.hardness === 'hard') entityFails.push(selection.constraint.id)
  }
  if (entityOps.length > 0) {
    const opsCost = entityOps.reduce((sum, o) => sum + o.cost_units * afterCluster, 0)
    stages.push({
      stage_id: 'exact',
      index: stages.length,
      tier: 'entity',
      fanout: 'per_entity',
      ops: entityOps,
      expected_entities: survivors(afterCluster, entityCaps),
      estimated_cost_units: opsCost,
      estimated_latency_ms: Math.max(...entityOps.map((o) => latency(o, input.registry))),
      prune: { on_fail: entityFails, slack: [] },
    })
  }

  return stages
}

function slackFor(constraint: Constraint, budget: PlanInput['budget']): PruneSlack {
  // The cell radius is not known until the box is, so slack is expressed against
  // a nominal cell and Xano recomputes it from the real cluster radius.
  const nominalRadius = 800
  if (constraint.type === 'commute') {
    return {
      constraint_id: constraint.id,
      extra_seconds: slackSeconds(nominalRadius, constraint.mode),
    }
  }
  return { constraint_id: constraint.id, extra_meters: slackMeters(nominalRadius) }
}

function op(candidate: Candidate, constraintId: string, ordinal: number): Op {
  return {
    op_id: `op_${candidate.capability.capability_id.replaceAll('.', '_')}_${ordinal}`,
    capability_id: candidate.capability.capability_id,
    constraint_ids: [constraintId],
    provider: candidate.capability.provider,
    endpoint: candidate.capability.endpoint,
    params: bindSelf(candidate.capability.params_template, constraintId),
    cost_units: candidate.capability.cost_units,
    ttl_seconds: candidate.capability.ttl_seconds,
    // A provider failure writes unknown evidence and the run carries on. It never
    // rejects a listing and it never kills the run.
    on_error: 'unknown',
  }
}

function regionStage(
  stageId: string,
  index: number,
  ops: Op[],
  expectedEntities: number,
  prune: Stage['prune'],
): Stage {
  return {
    stage_id: stageId,
    index,
    tier: 'region',
    fanout: 'once',
    ops,
    expected_entities: expectedEntities,
    estimated_cost_units: cost(ops),
    estimated_latency_ms: 0,
    prune,
  }
}

function cost(ops: Op[]): number {
  return ops.reduce((sum, o) => sum + o.cost_units, 0)
}

function latency(o: Op, registry: Capability[]): number {
  return registry.find((c) => c.capability_id === o.capability_id)?.latency_p50_ms ?? 0
}

function chosen(selections: Selection[], tier: Tier): Capability[] {
  return selections.flatMap((s) => {
    const candidate = s.byTier.get(tier)
    return candidate ? [candidate.capability] : []
  })
}

function chosenNativeTypes(selections: Selection[]): Set<ConstraintType> {
  return new Set(selections.filter((s) => s.byTier.has('native')).map((s) => s.constraint.type))
}

/**
 * What this query would cost with no planner: every constraint checked one
 * listing at a time. Disabled rows count here, because the counterfactual is
 * "nobody chose", not "we chose not to".
 */
function naiveCost(
  constraints: Constraint[],
  registry: Capability[],
  candidates: number,
  pushedDown: Set<ConstraintType> = new Set(),
): number {
  let total = pagesFor(candidates)
  for (const constraint of constraints) {
    if (pushedDown.has(constraint.type)) continue
    const rows = registry.filter((c) => c.constraint_type === constraint.type)
    const perEntity = rows.find((c) => c.granularity === 'entity') ?? rows[0]
    total += (perEntity?.cost_units ?? 0) * candidates
  }
  return total
}

function toTrace(candidate: Candidate, reason: CandidateTrace['reason']): CandidateTrace {
  return {
    capability_id: candidate.capability.capability_id,
    constraint_id: candidate.constraint_id,
    tier: candidate.tier,
    selectivity_prior: candidate.capability.selectivity_prior,
    coverage: candidate.capability.coverage,
    cost_units: candidate.capability.cost_units,
    entities_requiring_evaluation: candidate.entities_requiring_evaluation,
    score: Number.isFinite(candidate.score) ? candidate.score : null,
    score_rounded: Number.isFinite(candidate.score) ? candidate.score_rounded : null,
    chosen: reason === 'selected',
    reason,
  }
}
