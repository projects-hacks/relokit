import { bindingForRef, paramRefs } from '@relokit/schema'
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
import type { BindingKey } from '@relokit/schema'
import { closeDerived, isFeasible, requirementsOf } from './binding.ts'
import { SEED_REGION_CANDIDATES, eliminationPower, pagesFor, survivors } from './cardinality.ts'
import { boxAround, gridClusters, reachRadiusMeters, slackMeters, slackSeconds } from './cluster.ts'
import { bindSelf, mergeParams, stableHash } from './params.ts'
import { enabledByConstraintType, entitiesRequiringEvaluation } from './registry.ts'
import { compareCandidates, scoreCandidate, type Candidate } from './score.ts'

export const PLANNER_VERSION = '0.1.0'

const CANDIDATE_SOURCE: ConstraintType = 'candidate_source'
const SEARCH_AREA: ConstraintType = 'search_area'

/**
 * A thing capabilities compete to answer. Usually a user constraint, but the
 * candidate search is one too: it answers no constraint and yet it is the only
 * access path that binds `entity`, so it has to compete in the same fixpoint or
 * nothing that needs a listing can ever become feasible.
 */
interface Slot {
  id: string
  type: ConstraintType
  constraint: Constraint | null
}

interface Selection {
  slot: Slot
  byTier: Map<Tier, Candidate>
}

const SOURCE_SLOT: Slot = { id: 'source', type: CANDIDATE_SOURCE, constraint: null }
const AREA_SLOT: Slot = { id: 'area', type: SEARCH_AREA, constraint: null }

/**
 * Constraints in, execution plan out. Synchronous, total, and free of I/O, the
 * clock and randomness, so the same query always produces the same plan.
 */
export function plan(input: PlanInput): PlanResult {
  const { budget, registry } = input
  const constraints = input.constraints.constraints
  const index = enabledByConstraintType(registry, input.constraints.subject)
  const trace: CandidateTrace[] = []
  const decisions: { step: string; detail: string }[] = []
  const unsatisfied: UnsatisfiedConstraint[] = []

  const { bounds, clusters } = boundSearch(input, decisions)

  // The tiers below native are scored against the survivor count, and the
  // survivor count depends on which tiers were chosen. Native predicates break
  // the circle: they are free, always taken when enabled, and prune at the
  // source, so their effect can be worked out before anything is selected.
  // Only the ones this question actually asked for. A free predicate nobody
  // named prunes nothing, and counting it shrinks the estimate below the truth,
  // which is how the page budget ends up short.
  const asked = new Set<string>(constraints.map((constraint) => constraint.type))
  const natives = [...index.values()]
    .flat()
    .filter((c) => c.granularity === 'native' && asked.has(c.constraint_type))
  const afterNative = survivors(SEED_REGION_CANDIDATES, natives)

  const firstPass = select(constraints, index, trace, unsatisfied, {
    cluster_count: budget.cluster_count,
    cluster_input_entities: afterNative,
    entity_survivors: afterNative,
    max_cost_units: budget.max_cost_units,
  })
  const afterCluster = survivors(afterNative, chosen(firstPass, 'cluster'))
  decisions.push({
    step: 'cardinality',
    detail:
      afterCluster < afterNative
        ? `${SEED_REGION_CANDIDATES} candidates in the box, about ${afterNative} after the free predicates, about ${afterCluster} after cluster level pruning`
        : `${SEED_REGION_CANDIDATES} candidates in the box, about ${afterNative} after the free predicates, with nothing worth pruning at cluster level`,
  })

  const selections = select(constraints, index, trace, unsatisfied, {
    cluster_count: budget.cluster_count,
    cluster_input_entities: afterNative,
    entity_survivors: afterCluster,
    max_cost_units: budget.max_cost_units,
  })

  const stages = assemble(input, selections, afterNative, afterCluster, decisions)
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

/**
 * Selection is a feasibility fixpoint, not a tier walk.
 *
 * Each round takes only the capabilities whose required bindings are already
 * satisfied, keeps the best one per constraint per tier, and adds whatever they
 * bind. Repeat until nothing more unlocks.
 *
 * The ordering that used to be hardcoded falls out of this: a geocode is the
 * only thing feasible in round one, so it runs first because nothing else can,
 * not because it was written first. And an unaffordable capability simply never
 * binds, so everything downstream of it stays infeasible and is reported as
 * unbound rather than silently dropped.
 */
function select(
  constraints: Constraint[],
  index: Map<ConstraintType, Capability[]>,
  trace: CandidateTrace[],
  unsatisfied: UnsatisfiedConstraint[],
  ctx: {
    cluster_count: number
    /** Listings entering the cluster tier, which is what its payback is judged on. */
    cluster_input_entities: number
    entity_survivors: number
    max_cost_units: number
  },
): Selection[] {
  trace.length = 0
  unsatisfied.length = 0

  const slots: Slot[] = [
    AREA_SLOT,
    SOURCE_SLOT,
    ...constraints.map((constraint) => ({ id: constraint.id, type: constraint.type, constraint })),
  ]
  const bound = closeDerived(new Set<BindingKey>())
  const selections = new Map<string, Selection>()
  const considered = new Set<string>()
  let spent = 0

  let round = 0
  for (;;) {
    round += 1
    const feasible: { candidate: Candidate; slot: Slot }[] = []

    for (const slot of slots) {
      for (const capability of index.get(slot.type) ?? []) {
        const key = `${slot.id}:${capability.capability_id}`
        if (considered.has(key)) continue
        if (!isFeasible(requirementsOf(capability, slot.type), bound)) continue
        feasible.push({
          candidate: scoreCandidate(
            capability,
            slot.id,
            entitiesRequiringEvaluation(capability.granularity, ctx),
          ),
          slot,
        })
      }
    }
    if (feasible.length === 0) break

    feasible.sort((a, b) => compareCandidates(a.candidate, b.candidate))

    for (const { candidate, slot } of feasible) {
      considered.add(`${slot.id}:${candidate.capability.capability_id}`)

      const selection = selections.get(slot.id) ?? { slot, byTier: new Map() }
      if (selection.byTier.has(candidate.tier)) {
        trace.push(toTrace(candidate, 'lower_score'))
        continue
      }

      const invocations = entitiesRequiringEvaluation(candidate.tier, ctx) || 1
      const cost = candidate.capability.cost_units * invocations

      if (!paysForItself(candidate, cost, ctx)) {
        trace.push(toTrace(candidate, 'no_payback'))
        continue
      }

      if (spent + cost > ctx.max_cost_units) {
        trace.push(toTrace(candidate, 'over_budget'))
        continue
      }

      spent += cost
      selection.byTier.set(candidate.tier, candidate)
      selections.set(slot.id, selection)
      trace.push(toTrace(candidate, 'selected'))
      for (const produced of candidate.capability.produces) bound.add(produced)
    }

    closeDerived(bound)
    if (round > slots.length + DERIVED_ROUNDS_HEADROOM) break
  }

  for (const constraint of constraints) {
    const available = index.get(constraint.type) ?? []
    if (available.length === 0) {
      unsatisfied.push({ constraint_id: constraint.id, reason: 'no_capability' })
    } else if (!selections.has(constraint.id)) {
      const anyFeasible = available.some((c) =>
        isFeasible(requirementsOf(c, constraint.type), bound),
      )
      unsatisfied.push({
        constraint_id: constraint.id,
        reason: anyFeasible ? 'over_budget' : 'unbound',
      })
    }
  }

  return [...selections.values()]
}

/** A fixpoint over a two entry derivation map converges long before this. */
const DERIVED_ROUNDS_HEADROOM = 4

/**
 * Cluster work is an optimisation and has to earn its place. It answers about a
 * centroid rather than a listing, so it only helps when it removes more listings
 * than it costs calls, and a source that rules almost nothing out at that
 * granularity is worse than not asking.
 *
 * Entity work is not optional in the same way: it is where the verdict comes
 * from, not a shortcut to avoid work later.
 */
function paysForItself(
  candidate: Candidate,
  cost: number,
  ctx: { cluster_input_entities: number },
): boolean {
  if (candidate.tier !== 'cluster') return true
  const removed =
    ctx.cluster_input_entities *
    eliminationPower(candidate.capability.coverage, candidate.capability.selectivity_prior)
  return removed > cost
}

function assemble(
  input: PlanInput,
  selections: Selection[],
  afterNative: number,
  afterCluster: number,
  decisions: { step: string; detail: string }[],
): Stage[] {
  const stages: Stage[] = []
  const constraintSelections = selections.filter((s) => s.slot.constraint !== null)

  // The box has to exist before anything can be searched inside it, and two
  // things can produce one: the place being searched, and the place being
  // travelled to. Either is enough, which is what makes a question naming only
  // a town answerable. Requiring the commute was why "an apartment in Santa
  // Clara" returned nothing while reporting how efficient it had been.
  const areaSelection = selections.find((selection) => selection.slot.type === SEARCH_AREA)
  const areaCandidate = areaSelection?.byTier.get('region')
  const geocodes = [
    // An anchor that already carries its point, the reader's own location,
    // needs nobody to tell it where it is.
    ...(areaCandidate && !input.constraints.search_anchor?.point
      ? [op(areaCandidate, areaSelection!.slot, 0)]
      : []),
    ...constraintSelections.flatMap((selection) => {
      const region = selection.byTier.get('region')
      const constraint = selection.slot.constraint!
      if (!region) return []
      // Both kinds of place have to be found before the search, not after it:
      // one says how far anybody will travel, the other says how far from here
      // to look, and each of them decides the box the search is made in.
      if (constraint.type === 'commute')
        return constraint.destination.point ? [] : [op(region, selection.slot, 1)]
      if (constraint.type === 'proximity')
        return constraint.place.point ? [] : [op(region, selection.slot, 1)]
      return []
    }),
  ]
  if (geocodes.length > 0) {
    // Nothing has been found yet. The box is being built, not searched.
    stages.push(regionStage('bounds', stages.length, geocodes, 0, null))
  }

  // One search, with every free predicate pushed into it, over as many pages as
  // the estimate needs. The free predicates cut the page count as well as the
  // candidate count, so they pay for the search rather than only filtering it.
  const sourceSelection = selections.find((s) => s.slot.type === CANDIDATE_SOURCE)
  const source = sourceSelection?.byTier.get('region')?.capability
  if (source) {
    const natives = constraintSelections.flatMap((selection) => {
      const native = selection.byTier.get('native')
      return native ? [{ native, id: selection.slot.id }] : []
    })
    // A page budget, not a page count. Nothing knows how many pages there are
    // until the first response says so, and the estimate is usually wrong: the
    // free predicates take San Jose from twenty pages to one.
    const pageBudget = Math.min(source.max_fanout, pagesFor(afterNative))
    const params = mergeParams(
      source.params_template,
      ...natives.map((n) => bindSelf(n.native.capability.params_template, n.id)),
    )
    const requires = requirementsOf(source, CANDIDATE_SOURCE)
    const ops: Op[] = [
      {
        op_id: 'op_candidates',
        capability_id: source.capability_id,
        constraint_ids: [CANDIDATE_SOURCE, ...natives.map((n) => n.id)],
        provider: source.provider,
        endpoint: source.endpoint,
        params: { ...params, page: 1 } as Record<string, ParamValue>,
        requires,
        cost_units: source.cost_units,
        ttl_seconds: source.ttl_seconds,
        // Without candidates there is nothing to evaluate, so this one is fatal.
        on_error: 'abort' as const,
      },
    ]
    stages.push({
      stage_id: 'candidates',
      index: stages.length,
      tier: 'region',
      fanout: 'paged',
      ops,
      expected_entities: afterNative,
      estimated_cost_units: source.cost_units * pageBudget,
      estimated_latency_ms: source.latency_p50_ms * pageBudget,
      prune: null,
    })
    decisions.push({
      step: 'pushdown',
      detail: `${natives.length} predicates applied inside the search for nothing, budgeting ${pageBudget} page${pageBudget === 1 ? '' : 's'} rather than the ${pagesFor(SEED_REGION_CANDIDATES)} the unfiltered box would need`,
    })
  }

  // Region level signals that rank but never prune.
  const signals = constraintSelections.flatMap((selection) => {
    const region = selection.byTier.get('region')
    const type = selection.slot.constraint!.type
    if (!region || type === 'commute' || type === 'proximity') return []
    return [op(region, selection.slot, 0)]
  })
  if (signals.length > 0) {
    stages.push(regionStage('signals', stages.length, signals, afterNative, null))
  }

  const clusterOps: Op[] = []
  const clusterSlack: PruneSlack[] = []
  const clusterFails: string[] = []
  for (const selection of constraintSelections) {
    const candidate = selection.byTier.get('cluster')
    if (!candidate) continue
    const constraint = selection.slot.constraint!
    clusterOps.push(op(candidate, selection.slot, clusterOps.length))
    if (constraint.hardness === 'hard') {
      clusterFails.push(constraint.id)
      clusterSlack.push(slackFor(constraint))
    }
  }
  if (clusterOps.length > 0) {
    stages.push({
      stage_id: 'clusters',
      index: stages.length,
      tier: 'cluster',
      fanout: 'per_cluster',
      ops: clusterOps,
      expected_entities: afterCluster,
      estimated_cost_units: cost(clusterOps) * input.budget.cluster_count,
      estimated_latency_ms: Math.max(...clusterOps.map((o) => latency(o, input.registry))),
      prune: { on_fail: clusterFails, slack: clusterSlack },
    })
  }

  const entityOps: Op[] = []
  const entityFails: string[] = []
  const entityCaps: Capability[] = []
  let entityFanout = afterCluster
  for (const selection of constraintSelections) {
    const candidate = selection.byTier.get('entity')
    if (!candidate) continue
    entityOps.push(op(candidate, selection.slot, entityOps.length))
    entityCaps.push(candidate.capability)
    // A capability states how many times it may be invoked in one stage, and
    // planning past that is planning something that will not happen. Survivors
    // beyond the ceiling are left unverified rather than quietly evaluated.
    entityFanout = Math.min(entityFanout, candidate.capability.max_fanout)
    if (selection.slot.constraint!.hardness === 'hard') entityFails.push(selection.slot.id)
  }
  if (entityOps.length > 0) {
    stages.push({
      stage_id: 'exact',
      index: stages.length,
      tier: 'entity',
      fanout: 'per_entity',
      ops: entityOps,
      expected_entities: survivors(entityFanout, entityCaps),
      estimated_cost_units: cost(entityOps) * entityFanout,
      estimated_latency_ms: Math.max(...entityOps.map((o) => latency(o, input.registry))),
      prune: { on_fail: entityFails, slack: [] },
    })
  }

  return stages
}

function slackFor(constraint: Constraint): PruneSlack {
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

function op(candidate: Candidate, slot: Slot, ordinal: number): Op {
  const constraintId = slot.id
  return {
    op_id: `op_${candidate.capability.capability_id.replaceAll('.', '_')}_${ordinal}`,
    capability_id: candidate.capability.capability_id,
    constraint_ids: [constraintId],
    provider: candidate.capability.provider,
    endpoint: candidate.capability.endpoint,
    params: bindSelf(candidate.capability.params_template, constraintId),
    requires: requirementsOf(candidate.capability, slot.type),
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
  return new Set(selections.filter((s) => s.byTier.has('native')).map((s) => s.slot.type))
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
