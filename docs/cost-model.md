# Cost model

Every fact costs a paid API call, so the backend's real job is deciding what not
to call. This document is the arithmetic behind that.

## The unit

One `cost_unit` is one SerpApi search. Native predicates cost zero because the
provider applies them inside a search we were making anyway.

## Ordering

Capabilities compete to answer a constraint. The winner is the one that eliminates
the most candidates per call:

```
score = ((1 - selectivity_prior) * coverage)
        ------------------------------------
        cost_units * entities_requiring_evaluation
```

`selectivity_prior` is the fraction expected to **pass**. A prior of 0.35 on
in-unit laundry means 35 percent of listings have it, so the term `1 - 0.35`
is the 65 percent it removes. Getting this direction backwards inverts every plan,
which is why it has its own test.

`coverage` discounts a capability that often answers `unknown`. A source that
eliminates aggressively but only answers for half the candidates is worth half as
much.

`entities_requiring_evaluation` is where granularity enters:

| tier    | entities requiring evaluation                              |
| ------- | ---------------------------------------------------------- |
| native  | 0. Not scored at all, emitted first, ordered by precedence |
| region  | 1                                                          |
| cluster | the cluster count                                          |
| entity  | the estimated survivor count from the previous stage       |

Ties break on rounded score, then `precedence`, then `capability_id`. The score is
compared as `Math.round(score * 1e9)` rather than with an epsilon, because an
epsilon comparator is not transitive and makes sort order undefined.

## Feasibility comes before cost

Cost only decides between capabilities that can actually run. A geocode removes
no candidates, so this formula scores it zero, and yet dropping it makes every
commute row unusable.

Selection is therefore a fixpoint over bindings rather than a sort. Each round
considers only the capabilities whose required bindings already exist, picks the
best one per constraint per tier, and adds whatever they bind. See the access
patterns section of [contracts.md](contracts.md).

The tier order below falls out of that rather than being imposed on it, which is
a useful check: the ordering we would have written by hand is the one the
bindings produce.

## Execution order

Free predicates, then region, then cluster, then entity. Never the reverse. The
entity tier is the only one that scales with the candidate count, so it runs last
against the smallest set that is still correct.

## Slack

Cluster evidence describes a centroid, not a listing. Pruning a whole cluster
because its centroid failed will reject listings that sit nearer the destination
than the centroid does.

Commute: prune only when

```
centroid_seconds - (radius_m / mode_speed_mps) > max_seconds
```

Proximity: prune only when

```
centroid_distance_m - radius_m > max_distance_m
```

Anything inside the slack band is not settled at cluster level. It goes to the
entity tier for an exact answer, or to the unverified bucket if the budget ran out.

Without this, a judge hovers a rejected pin and finds a 23 minute listing sitting
in the rejection list of a 25 minute query. That is the single worst thing that can
happen on camera.

## The bounding box is not an isochrone

There is no isochrone endpoint. What we have is a rectangle derived from a mode
speed:

```
radius_m = mode_speed_mps * max_seconds * overshoot_factor
```

Overshoot generously. Straight lines are not roads, and a prefilter that is too
tight discards the right answer before anything has looked at it. The later stages
prune; the box only bounds.

## Pages are a budget, not a count

Candidate generation costs one call per page and no one knows how many pages
there are until the first response says so. The plan therefore states a page
budget, capped by the capability's `max_fanout`, and the executor stops when the
provider runs out of pages or the budget does.

This is where the free predicates earn twice. The unfiltered San Jose box is 20
pages; with price, beds and laundry pushed into the same search it is one.

## Reading a duration

Directions returns route alternatives, and the first is not always the fastest.
From one San Jose building to the demo office it offers 34 minutes via S Monroe
St and 30 minutes via the creek trail, in that order.

The verdict takes the **minimum** duration across the routes returned for the
requested mode. The constraint asks whether the trip can be made in 25 minutes,
so any route that manages it answers the question. Reading the first route would
put a listing in the rejection list for a journey it does not have to make.

## Worked example

The canonical query: under $2,800, one bedroom, 25 minutes by bike to an office in
Santa Clara, gym within 805m open before 6am, in-unit laundry, grocery within
1600m open past 10pm. Six constraints, five sources.

These are measured, from `pnpm replay` against recorded responses, not estimates.

Naive means evaluating every constraint on every candidate at entity
granularity. Put that definition on screen next to the number, or the comparison
is marketing.

| naive                                                                    | calls      |
| ------------------------------------------------------------------------ | ---------- |
| enumerate the bounded box, 111 pages                                     | 111        |
| listing detail, commute, gym, grocery and news, on 4,517 candidates each | 18,068     |
| **total**                                                                | **18,179** |

| planned                                                           | calls  | candidates after |
| ----------------------------------------------------------------- | ------ | ---------------- |
| geocode the office                                                | 1      |                  |
| Zillow search with price, beds and laundry applied natively       | 1      | 20               |
| bike route from 6 cells fitted to the listings, pruned with slack | 6      | 11               |
| exact route, gym and grocery for each of the eleven that are left | 33     | 5                |
| **total**                                                         | **41** | **5**            |

41 against 18,179. One verified home, four unverified, fifteen rejected with a
reason, and the nearest miss is a listing 26 minutes away against a 25 minute
limit.

Both numbers are computed from `PlanTrace` at runtime and rendered as whatever is
true for the query that just ran. Neither is hardcoded, and if the real numbers
change the script changes rather than the code.

## Cells have to fit the listings

The first version laid a grid over the bounding box. Across a 23 km box six cells
are about 5 km wide, and a cell that wide forces twenty minutes of slack onto a
twenty five minute commute. Nothing could ever be ruled out, so the stage cost
eighteen calls and pruned nothing at all.

Listings sit in neighbourhoods rather than spread evenly, so fitting cells to
them is a different problem. It takes the median cell radius from 4,922 m to
1,673 m and the stage now removes about half the candidates.

The plan still emits a grid, because entity coordinates do not exist when it is
written. The executor replaces it as soon as there are listings to fit to.

## Work that cannot pay for itself

Cluster work is an optimisation and has to earn its place. A cluster call answers
about a centroid rather than a listing, so it only helps if it removes more
listings than it costs calls:

```
entities_entering_the_tier * elimination_power > cost_units * cluster_count
```

Measured over forty answers, proximity at cluster level has coverage 0.45 and
selectivity 0.94: slack leaves most answers undecided and nearly all the rest
pass. Twelve calls to remove about one listing. The planner drops it, the entity
tier still answers the constraint, and the run goes from 80 calls to 41 with an
identical result.

Commute at cluster level measures 0.80 and 0.44 once cells are fitted, so it
stays. The rule is about payback, not about which constraint it is.

Entity work is never dropped this way. It is where the verdict comes from rather
than a shortcut to avoid work later.

## Why the second query is cheaper

Evidence rows carry a TTL per source. A gym's opening hours are good for 30 days,
a typical-traffic bike route for 7, a listing price for 6 hours. Before spending a
call the executor asks the ledger whether it already knows the answer for that
entity and that constraint.

So a watch run of the same query the next morning costs about 6 units rather than
47: only the prices expired. The same is true of a different query about the same
city, which is why the cost per answer falls the longer the system runs.

## Estimates versus measurements

Everything above the entity tier is an estimate made before any call has returned.
Survivor counts are not knowable at plan time, so Xano reports the measured
`entities_out` per stage back into the run record and the UI renders those.

Priors start as engineering guesses, labelled as such in the registry `notes`, and
every run measures the truth: how many rows each capability answered, how many were
decisive, how many passed. The client files those counts with the run's evidence,
they land in an append-only observation table keyed by the normalized place the
question named, and every parse serves them back.

The next plan applies a strict ladder per capability: the measured ratios for this
place if it has at least ten decisive answers, the measured ratios across all
places if those reach ten, and otherwise the registry's guess, which says so. A
served number is a measurement with its n or an assumption; nothing in between,
and nothing is ever seeded to look measured. In a town no one has searched, the
first run plans on global measurements or labelled guesses and writes the first
rows; the second run there can already plan on numbers measured in that town.

Counts rather than ratios, because counts sum exactly across runs and a measured
zero survives the trip through storage. Registry imports never touch the
observation table, so a prior tweak does not reset what has been learned.

None of this can move a verdict. Priors decide only what is worth asking and in
what order; a listing is still only ever ruled out by an evaluated fail, and the
suite pins that inverted priors change the spend and never a bucket.

## Widening a number costs listings, not lookups

Raising a rent cap from $3,500 to $3,800 on an already answered question cost 34
searches, and it is worth being exact about where they went:

| capability                 | live | from the ledger |
| -------------------------- | ---: | --------------: |
| candidates.zillow.region   |    1 |               0 |
| commute.directions.cluster |    5 |               1 |
| commute.directions.entity  |   14 |              21 |
| nearby_poi.maps.entity     |   14 |              21 |

One of those is the search. The other 33 are homes between the old cap and the
new one, each needing its own journey and its own gym: real work about listings
nobody had seen yet, not the same work repeated. Meanwhile 42 of the 70 per
listing checks came back from the ledger, which is the reuse the design is for.

The reason to write this down is that it kills an appealing idea. Caching a
widened range so the second search reads from the first would save exactly one
call, because the search was never the expensive part. What costs is measuring
homes, and there is no way to measure a home nobody has measured yet.
