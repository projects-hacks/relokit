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

Naive means evaluating every constraint on every candidate at entity granularity.
Put that definition on screen next to the number, or the comparison is marketing.

| naive                                | calls     |
| ------------------------------------ | --------- |
| Zillow search, 8 pages               | 8         |
| listing_feature detail, 312 listings | 312       |
| commute, 312 listings                | 312       |
| gym search, 312 listings             | 312       |
| grocery search, 312 listings         | 312       |
| area news, 312 listings              | 312       |
| **total**                            | **1,568** |

| planned                                                                                     | calls  | candidates after |
| ------------------------------------------------------------------------------------------- | ------ | ---------------- |
| region: geocode the office                                                                  | 1      |                  |
| region: Zillow search inside the box, with price, beds and keyword filters applied natively | 8      | 312              |
| native: budget, beds and laundry read out of that same response                             | 0      | 84               |
| region: area news over the surviving neighbourhoods, soft, ranks only                       | 3      | 84               |
| cluster: bike route from 12 centroids, prune with slack                                     | 12     | 19               |
| cluster: gym and grocery around the 5 surviving centroids                                   | 5      | 19               |
| entity: exact door to door route for the 18 that are left                                   | 18     | 4                |
| **total**                                                                                   | **47** | **4**            |

47 against 1,568, so 33 times fewer calls for the same answer.

Both numbers are computed from `PlanTrace` at runtime and rendered as whatever is
actually true for the query that just ran. Neither is hardcoded anywhere, and if
the real numbers come out different, the script changes rather than the code.

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

Priors are seeded by guesswork and labelled as such in the registry `notes`. After
each run the observed pass rate is written back to `selectivity_observed`, so the
numbers driving the ordering stop being invented.
