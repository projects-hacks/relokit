import {
  bucket,
  distanceMeters,
  formatDistance,
  mapAreaSignal,
  mapDirections,
  mapGeocode,
  mapNearbyPlaces,
  mapPlaceCandidates,
  mapZillowSearch,
  type Buckets,
  type MapperContext,
} from '@relokit/evidence'
import {
  boxAround,
  eliminationPower,
  gridClusters,
  floorSeconds,
  reachRadiusMeters,
  refineClusters,
  slackMeters,
  slackSeconds,
} from '@relokit/planner'
import type {
  BBox,
  ProximityConstraint,
  AreaSignalConstraint,
  Capability,
  ClusterSpec,
  CommuteConstraint,
  ConstraintSet,
  EvidenceRow,
  Place,
  NearbyPoiConstraint,
  Op,
  PlanResult,
  Stage,
  Weekday,
} from '@relokit/schema'
import type { Engine } from '@relokit/serpapi'
import { SUBJECT_TERMS } from '@relokit/schema'
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
  entities: Place[]
  evidence: EvidenceRow[]
  missing: MissingFixture[]
  unresolved: { op_id: string; ref: string }[]
  /**
   * Requirements that cannot all hold at once, found by measuring rather than by
   * searching. Two places further apart than their radii allow have no overlap,
   * and no amount of looking will produce one.
   */
  contradictions: { detail: string }[]
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
  options: {
    now_ms: number
    evaluation_days: Weekday[]
    overshoot_factor: number
    /** How many calls of one operation may be in the air at once. One is the
     * old behaviour and is what replaying from files wants, since there is no
     * latency to hide. */
    concurrency?: number
    /**
     * Called as each stage completes, with everything known so far. A run can
     * take minutes, and a page that shows nothing until the last call answers
     * reads as broken to anybody watching it; what is known already is an
     * honest thing to show.
     */
    onStage?: (partial: { stage_id: string; entities: Place[]; evidence: EvidenceRow[] }) => void
  },
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
    contradictions: [],
    calls: 0,
    stages: [],
  }

  const stageOutputs: Bindings['stage'] = {}
  const produced: Bindings['produced'] = {}
  let clusters: ClusterSpec[] = plan.clusters
  let surviving: Place[] = []
  // Places the question named, once each has been located.
  const placed: { constraint: ProximityConstraint; point: { lat: number; lng: number } }[] = []
  const droppedByPlace = new Set<string>()

  // Points handed in with the question, the reader's own location above all,
  // stand in for the geocodes that would otherwise have to find them.
  if (constraints.search_anchor?.point) {
    const point = constraints.search_anchor.point
    produced['query.anchor_point'] = `${point.lat},${point.lng}`
    outcome.anchor_point = point
    setBounds(point, constraints.search_anchor.radius_m ?? DEFAULT_SEARCH_RADIUS_M)
  }
  for (const constraint of constraints.constraints) {
    if (constraint.type === 'proximity' && constraint.place.point) {
      placed.push({ constraint, point: constraint.place.point })
      produced[`constraint.${constraint.id}.place_point`] =
        `${constraint.place.point.lat},${constraint.place.point.lng}`
    }
  }

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
    tightenBoundsToPlaces()
    // Asked before anything is searched for, because the answer is already
    // known: a search cannot find what geometry says is not there.
    noteContradictions()
    if (outcome.contradictions.length > 0) break

    surviving = withinAnchor(prune(stage, surviving, outcome.evidence))
    // Removed from the answer as well as from the pipeline. Filtering only what
    // gets asked about would leave the corners of the box unexamined and still
    // listed, which is the same wrong answer arrived at more cheaply.
    outcome.entities = withinAnchor(outcome.entities)
    surviving = rejectUnreachable(surviving)
    surviving = withinPlaces(surviving)
    outcome.entities = outcome.entities.filter((entity) =>
      surviving.length === 0 && placed.length === 0 ? true : !droppedByPlace.has(entity.entity_id),
    )
    outcome.stages.push({
      stage_id: stage.stage_id,
      entities_in: before,
      entities_out: surviving.length,
      calls: outcome.calls - callsBefore,
    })
    // Copies, so a listener holding a snapshot is not surprised by the next
    // stage growing it underneath them.
    options.onStage?.({
      stage_id: stage.stage_id,
      entities: [...outcome.entities],
      evidence: [...outcome.evidence],
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

    // One operation over thirty listings is thirty independent questions, and
    // asking them one at a time spent the whole run waiting. They go out
    // together; what comes back is applied in the order it was asked, so the
    // evidence a run produces does not depend on which answer arrived first.
    const answers = await inFlight(targets, options.concurrency ?? 1, async (bindings) => {
      let params: Record<string, string | number | boolean>
      try {
        params = resolveParams(op.params, bindings)
      } catch (error) {
        if (!(error instanceof UnresolvedRef)) throw error
        return { kind: 'unresolved' as const, bindings, ref: error.ref }
      }
      const engine = String(params.engine ?? 'zillow') as Engine
      try {
        const body = await search(engine, params, {
          op_id: op.op_id,
          capability_id: op.capability_id,
          endpoint: op.endpoint,
          ttl_seconds: op.ttl_seconds,
          constraint_ids: op.constraint_ids,
          entity_ids: targetEntitiesSafe(bindings),
        })
        return { kind: 'answered' as const, bindings, body }
      } catch (error) {
        return {
          kind: 'failed' as const,
          bindings,
          engine,
          params,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    })

    for (const answer of answers) {
      if (answer.kind === 'unresolved') {
        // The plan said this was feasible and it was not. Record it against the
        // listings rather than sending a request with a hole in it.
        outcome.unresolved.push({ op_id: op.op_id, ref: answer.ref })
        recordFailure(op, answer.bindings)
        continue
      }
      if (answer.kind === 'failed') {
        outcome.missing.push({
          op_id: op.op_id,
          engine: answer.engine,
          params: answer.params,
          detail: answer.detail,
        })
        recordFailure(op, answer.bindings)
        continue
      }
      outcome.calls += 1
      absorb(op, stage, answer.bindings, answer.body)
    }

    // The plan prices pages; this is where they are actually turned. Without it
    // every paged search stopped at page one, and half the inventory the run
    // had budgeted for was priced and never collected. The provider says how
    // many pages exist; the ceiling still governs the spend.
    if (stage.fanout === 'paged' && answers[0]?.kind === 'answered') {
      // Each engine turns pages its own way: Zillow numbers them and says how
      // many there are; a place search offsets by twenty and only says whether
      // more exist.
      const first = answers[0].body as {
        search_information?: { total_pages?: number }
        serpapi_pagination?: { next?: string }
      }
      const resolvedOnce = resolveParams(op.params, answers[0].bindings)
      const engine = String(resolvedOnce.engine ?? 'zillow')
      const pages =
        engine === 'zillow'
          ? Math.min(first.search_information?.total_pages ?? 1, MAX_SEARCH_PAGES)
          : first.serpapi_pagination?.next
            ? 2
            : 1
      for (let page = 2; page <= pages; page += 1) {
        try {
          const resolved = resolveParams(op.params, answers[0].bindings)
          const params =
            engine === 'zillow' ? { ...resolved, page } : { ...resolved, start: (page - 1) * 20 }
          const body = await search(String(resolved.engine ?? 'zillow') as Engine, params, {
            op_id: `${op.op_id}_p${page}`,
            capability_id: op.capability_id,
            endpoint: op.endpoint,
            ttl_seconds: op.ttl_seconds,
            constraint_ids: op.constraint_ids,
            entity_ids: [],
          })
          outcome.calls += 1
          absorb(op, stage, answers[0].bindings, body)
        } catch (error) {
          outcome.missing.push({
            op_id: `${op.op_id}_p${page}`,
            engine: 'zillow',
            params: {},
            detail: error instanceof Error ? error.message : String(error),
          })
          break
        }
      }
    }
  }

  /**
   * A radius is a circle and a search takes a box, so the box that holds the
   * circle also holds its corners. Two miles asked for is two and four tenths
   * delivered at the diagonal, which is not what anybody meant. The corners are
   * measured off here rather than asked about: the coordinates are already in
   * hand, so it costs nothing.
   */
  function withinAnchor(entities: Place[]): Place[] {
    const radius = constraints.search_anchor?.radius_m
    const centre = outcome.anchor_point
    if (!radius || !centre) return entities
    // A listing with no coordinates cannot be placed, and being unplaceable is
    // not grounds for removal.
    return entities.filter(
      (entity) => !entity.point || distanceMeters(centre, entity.point) <= radius,
    )
  }

  /**
   * Rules out what the shortest possible journey cannot reach.
   *
   * A route is never shorter than the straight line between its ends, and never
   * faster than the mode can go, so a listing whose straight line alone takes
   * longer than the limit can be rejected without asking anybody. The
   * coordinates are already here, so it is free, and it is a rejection rather
   * than a guess: it is arithmetic, and the reason says so.
   */
  function rejectUnreachable(entities: Place[]): Place[] {
    const commutes = constraints.constraints.filter(
      (c): c is CommuteConstraint => c.type === 'commute' && c.hardness === 'hard',
    )
    if (commutes.length === 0) return entities

    const settled = new Set(outcome.evidence.map((row) => `${row.entity_id}|${row.constraint_id}`))
    const out = new Set<string>()

    for (const commute of commutes) {
      const raw = produced[`constraint.${commute.id}.destination_point`]
      if (typeof raw !== 'string') continue
      const [lat, lng] = raw.split(',').map(Number)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      for (const entity of entities) {
        if (!entity.point) continue
        if (settled.has(`${entity.entity_id}|${commute.id}`)) continue
        const floor = floorSeconds(
          commute.mode,
          distanceMeters({ lat: lat!, lng: lng! }, entity.point),
        )
        if (floor <= commute.max_seconds) continue

        out.add(entity.entity_id)
        outcome.evidence.push({
          entity_id: entity.entity_id,
          constraint_id: commute.id,
          constraint_type: 'commute',
          verdict: 'fail',
          value_canonical: Math.round(floor),
          display_value: `at least ${Math.round(floor / 60)} min by ${commute.mode}`,
          source: 'geometry',
          source_url: null,
          confidence: 1,
          eval_state: 'evaluated',
          reason:
            'The straight line alone takes longer than the limit, and no road is shorter than that.',
          fetched_at_ms: options.now_ms,
          ttl_seconds: GEOMETRY_TTL_SECONDS,
          expires_at_ms: options.now_ms + GEOMETRY_TTL_SECONDS * 1000,
          capability_id: 'commute.geometry.entity',
          op_id: 'op_commute_geometry',
        })
      }
    }

    return entities.filter((entity) => !out.has(entity.entity_id))
  }

  /**
   * Measures every listing against every place the question named.
   *
   * The geocode was the only call any of this needed. A distance from a point to
   * a point is arithmetic, so having asked once where the university is, asking
   * how far each of two hundred homes sits from it costs nothing at all.
   */
  function withinPlaces(entities: Place[]): Place[] {
    if (placed.length === 0) return entities
    const kept: Place[] = []

    for (const entity of entities) {
      let out = false
      for (const { constraint, point } of placed) {
        if (!entity.point) continue
        if (
          outcome.evidence.some(
            (r) => r.entity_id === entity.entity_id && r.constraint_id === constraint.id,
          )
        )
          continue
        const meters = distanceMeters(point, entity.point)
        const within = meters <= constraint.radius_m
        if (!within) out = true
        outcome.evidence.push({
          entity_id: entity.entity_id,
          constraint_id: constraint.id,
          constraint_type: 'proximity',
          verdict: within ? 'pass' : 'fail',
          value_canonical: Math.round(meters),
          display_value: `${formatDistance(meters, constraints.locale.distance_unit)} from ${constraint.place.raw}`,
          source: 'geometry',
          source_url: null,
          confidence: 1,
          eval_state: 'evaluated',
          fetched_at_ms: options.now_ms,
          ttl_seconds: GEOMETRY_TTL_SECONDS,
          expires_at_ms: options.now_ms + GEOMETRY_TTL_SECONDS * 1000,
          capability_id: 'proximity.geometry.entity',
          op_id: `op_proximity_geometry_${constraint.id}`,
          about: { label: constraint.place.raw, kind: 'near', point },
        })
      }
      if (out) droppedByPlace.add(entity.entity_id)
      else kept.push(entity)
    }
    return kept
  }

  /**
   * Places that cannot all be satisfied at once.
   *
   * Two circles overlap only if their centres are closer than their radii added
   * together. When they are not, nothing exists that is inside both, and saying
   * so costs nothing and is a better answer than an empty list arrived at after
   * a search.
   */
  function noteContradictions() {
    const circles = [
      ...placed.map(({ constraint, point }) => ({
        label: constraint.place.raw,
        radius: constraint.radius_m,
        point,
      })),
      ...(constraints.search_anchor?.radius_m && outcome.anchor_point
        ? [
            {
              label: constraints.search_anchor.raw,
              radius: constraints.search_anchor.radius_m,
              point: outcome.anchor_point,
            },
          ]
        : []),
    ]

    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const a = circles[i]!
        const b = circles[j]!
        const apart = distanceMeters(a.point, b.point)
        if (apart <= a.radius + b.radius) continue
        outcome.contradictions.push({
          detail:
            `Nothing can be within ${formatDistance(a.radius, constraints.locale.distance_unit)} of ${a.label} and ` +
            `${formatDistance(b.radius, constraints.locale.distance_unit)} of ${b.label}: they are ` +
            `${formatDistance(apart, constraints.locale.distance_unit)} apart.`,
        })
      }
    }
  }

  /**
   * Every place named narrows where it is worth looking, so the box searched is
   * the overlap of theirs. It is never larger than any one of them and is often
   * very much smaller, which is the whole saving: one search instead of a
   * question asked of every home.
   */
  function tightenBoundsToPlaces() {
    if (placed.length === 0) return
    const boxes = placed.map(({ constraint, point }) => boxAround(point, constraint.radius_m))
    const north = Math.min(...boxes.map((b) => b.ne.lat))
    const east = Math.min(...boxes.map((b) => b.ne.lng))
    const south = Math.max(...boxes.map((b) => b.sw.lat))
    const west = Math.max(...boxes.map((b) => b.sw.lng))
    const current = stageOutputs.bounds

    stageOutputs.bounds = {
      north: current ? Math.min(Number(current.north), north) : north,
      east: current ? Math.min(Number(current.east), east) : east,
      south: current ? Math.max(Number(current.south), south) : south,
      west: current ? Math.max(Number(current.west), west) : west,
      lat: placed[0]!.point.lat,
      lng: placed[0]!.point.lng,
      zoom: '',
    }
    const b = stageOutputs.bounds
    b.zoom = zoomFor(Number(b.north), Number(b.south), Number(b.east), Number(b.west))
  }

  /**
   * How far in a place search should be looking.
   *
   * A search takes a centre and a zoom, not a box, and returns one screenful.
   * At the wide default that screenful spread fifteen kilometres for a question
   * about one mile, so nearly all of it was thrown away unread. The zoom follows
   * the box: ask about a mile and it looks at a mile.
   */
  function zoomFor(north: number, south: number, east: number, west: number): string {
    const height = (north - south) * 111_320
    const midpoint = ((north + south) / 2) * (Math.PI / 180)
    const width = (east - west) * 111_320 * Math.cos(midpoint)
    const span = Math.max(height, width, 200)
    return `${Math.min(18, Math.max(10, Math.round(13 + Math.log2(30_000 / span))))}z`
  }

  /**
   * A place is a place, however many times a search hands it back.
   *
   * Paging asks the same search again from a later offset, and a provider that
   * returns any overlap between pages was duplicating every place it repeated:
   * the same restaurant filled the list several times over, the counts above
   * the buckets were inflated, and narrowing to one result still showed the
   * wrong card, because two entries claimed the same identity.
   */
  function absorbCandidates(mapped: { entities: Place[]; evidence: EvidenceRow[] }) {
    const known = new Set(outcome.entities.map((entity) => entity.entity_id))
    const fresh = mapped.entities.filter((entity) => {
      if (known.has(entity.entity_id)) return false
      known.add(entity.entity_id)
      return true
    })
    const kept = new Set(fresh.map((entity) => entity.entity_id))
    outcome.entities.push(...fresh)
    // Evidence for a place already known was established the first time it was
    // seen, so keeping the second copy would double every fact about it.
    outcome.evidence.push(...mapped.evidence.filter((row) => kept.has(row.entity_id)))
  }

  function base(extra: Partial<Bindings>): Bindings {
    return {
      constraints: constraints.constraints,
      anchor: constraints.search_anchor?.raw ?? '',
      // The asker's own words where they gave them, since the kind of thing
      // alone loses every qualifier that decides which places are right.
      subject_term: constraints.subject_term ?? SUBJECT_TERMS[constraints.subject],
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
      distance_unit: constraints.locale.distance_unit,
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
      // A question that says how far to look is answered by looking that far.
      // Everything the search returns then satisfies it, and no home has to be
      // asked about individually.
      if (!stageOutputs.bounds) {
        setBounds(geocoded.point, constraints.search_anchor?.radius_m ?? DEFAULT_SEARCH_RADIUS_M)
      }
      return
    }

    if (op.capability_id === 'proximity.geocode.region') {
      const geocoded = mapGeocode(body)
      const constraint = constraints.constraints.find(
        (c): c is ProximityConstraint => c.type === 'proximity' && c.id === op.constraint_ids[0],
      )
      if (!geocoded || !constraint) return
      placed.push({ constraint, point: geocoded.point })
      produced[`constraint.${constraint.id}.place_point`] =
        `${geocoded.point.lat},${geocoded.point.lng}`
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
        zoom: zoomFor(box.ne.lat, box.sw.lat, box.ne.lng, box.sw.lng),
      }
      // Entity coordinates do not exist yet, so the plan lays a grid over the
      // box. It is replaced with cells fitted to the listings as soon as there
      // are any: a grid across a 23 km box gives cells wide enough that the
      // slack swallows the whole constraint.
      clusters = gridClusters(box, plan.trace.cardinality.cluster_count)
      return
    }

    if (op.capability_id === 'candidates.places.region') {
      const pushed = op.constraint_ids.filter((id) => id !== 'candidate_source')
      const mapped = mapPlaceCandidates(
        body,
        constraints.constraints.filter((c) => pushed.includes(c.id)),
        context(op),
        options.evaluation_days,
      )
      absorbCandidates(mapped)
      surviving = outcome.entities
      const points = outcome.entities.filter((e) => e.point).map((e) => e.point!)
      if (points.length > 0) {
        clusters = refineClusters(points, plan.trace.cardinality.cluster_count)
      }
      return
    }

    // Letting and selling are the same search against a different market.
    if (op.capability_id.startsWith('candidates.zillow.')) {
      const pushedDown = op.constraint_ids.filter((id) => id !== 'candidate_source')
      const answered = constraints.constraints.filter((c) => pushedDown.includes(c.id))
      const mapped = mapZillowSearch(body, answered, context(op), pushedDown)
      absorbCandidates(mapped)
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
      zoom: zoomFor(box.ne.lat, box.sw.lat, box.ne.lng, box.sw.lng),
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

/** Five pages is two hundred listings, which is a browse, not an answer. */
const MAX_SEARCH_PAGES = 5

/** Geometry does not go stale the way an opening time does. Coordinates move
 * only when a listing is re-published, and then it is a different run. */
const GEOMETRY_TTL_SECONDS = 30 * 24 * 60 * 60

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

function prune(stage: Stage, surviving: Place[], evidence: EvidenceRow[]): Place[] {
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

/**
 * Runs a bounded number of tasks at once and returns their results in the order
 * they were given, not the order they finished.
 *
 * Ordering is the whole point: a run that produced its evidence in whatever
 * order the network happened to answer would not be reproducible, and this
 * project's claim is that it is.
 */
async function inFlight<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  if (limit <= 1 || items.length <= 1) {
    const results: R[] = []
    for (const item of items) results.push(await task(item))
    return results
  }

  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
