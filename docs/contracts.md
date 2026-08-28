# Contracts

Four payloads cross the wire. Every shape below is defined in
`packages/schema/src` and validated by zod. Nothing else is a contract.

There is no intermediate service. The browser and the MCP server both import the
planner directly, and Xano is the only backend.

```
browser   POST /parse       ->  Xano calls the LLM
                            <-  { constraint_set, registry, registry_version, budget }

browser   plan()                pure, local, under 50ms. The plan trace renders here,
                                before any further network call.

browser   POST /run          -> { constraint_set, plan }
                                Xano re-prices the ops against its own registry
                            <-  { run_id, planned_cost_units, ceiling_cost_units }

browser   GET /run/{id}      -> ?since_version=N, polled at 700ms
                            <-  RunResult
```

## 1. POST /parse

Request:

```json
{
  "query": "Under $2,800, one bedroom, 25 minutes by bike to ...",
  "anchor": { "raw": "San Jose, CA" }
}
```

Response:

```json
{
  "constraint_set": { "...": "ConstraintSet" },
  "registry": [{ "...": "Capability" }],
  "registry_version": "2026-08-28.1",
  "budget": { "max_cost_units": 120, "max_stages": 6, "cluster_count": 12, "overshoot_factor": 1.3 }
}
```

The registry crosses the wire on every parse. Xano stays authoritative at runtime,
git stays authoritative in review, and `registry_version` is echoed into the plan
trace so an odd demo can be traced back to a registry edit.

Only enabled rows are returned, and `params_template` is stripped of anything that
could carry a secret. No provider key ever reaches the browser.

## 2. plan()

```ts
plan({ constraints, registry, registry_version, budget, now_ms }): PlanResult
```

Synchronous, total, no I/O. No `Date.now()`, no `Math.random()`. Every
non-deterministic input is passed in, so the same input gives a byte-identical
result. That is what makes the demo safe to run live.

## 3. POST /run

Request is `{ constraint_set, plan }`. Xano rejects with 409 and its own recomputed
cost when any of these hold:

- a `capability_id` is unknown or `enabled` is false
- `registry_version` does not match the current one
- a stage's fan-out exceeds that capability's `max_fanout`
- a param value carries a ref outside the closed set
- the recomputed cost exceeds `ceiling_cost_units`

The client's cost number is never trusted. What the UI displays after `/run`
returns is the server's number.

## 4. GET /run/{id}

Returns `RunResult`. Three buckets, never two:

| bucket       | rule                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| `results`    | every hard constraint has `verdict: pass` and `eval_state: evaluated`             |
| `unverified` | at least one hard constraint is `unknown`, `failed` or `skipped`, and none failed |
| `rejections` | at least one hard constraint has `verdict: fail` and `eval_state: evaluated`      |

An error can never reject a listing. `eval_state: failed` sends an entity to
unverified, not to rejections. This is the difference between a system that
answers honestly and one that quietly drops what it could not check.

`version` is monotonic. Pass the last one you saw as `since_version` and you get
only what changed.

## Param refs

A capability's `params_template` carries late-bound refs. The set is closed:

```
$entity.id      $entity.lat      $entity.lng
$cluster.id     $cluster.lat     $cluster.lng     $cluster.radius_m
$constraint.<constraint_id>.<field>
$stage.<stage_id>.<key>
```

Refs may be interpolated inside a string, because Directions wants `lat,lng` in a
single field: `"$cluster.lat,$cluster.lng"` is valid.

In the registry seed the constraint id is written as `self`. The planner rewrites
it to the real id when it emits the op, so one row serves every constraint of that
type.

Because the set is closed and `/run` rejects anything outside it, Xano's resolver
is a total function over about thirty lines. An unknown ref cannot reach runtime.

A ref also states a dependency. `$entity.lat` says this op cannot run until
listings exist. That is what the next two sections are about.

## The resolver contract

A `$constraint.<id>.<field>` ref names a field the resolver produces from the
parsed constraint. Some are read straight off it, some are derived. Xano must
implement exactly this list, and a test walks every registry template against the
reference implementation in `packages/schema/src/binding.ts`, so a typo fails in
CI rather than as an empty provider response.

| constraint        | fields                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `budget`          | `max_cents`, `min_cents`, `max_dollars`, `min_dollars`                                     |
| `unit_attribute`  | `attribute`, `min`, `max`                                                                  |
| `listing_feature` | `feature`, `required`                                                                      |
| `commute`         | `mode`, `travel_mode_code`, `max_seconds`, `depart_at`, `destination_raw`                  |
| `nearby_poi`      | `category`, `query`, `radius_m`, `min_count`, `min_rating`, `opens_by_s`, `closes_after_s` |
| `area_signal`     | `topic`, `polarity`, `lookback_days`                                                       |

Four of those are derived rather than stored, and each exists because a provider
wants a different shape than the one we keep:

| field                          | from                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `max_dollars`, `min_dollars`   | cents divided by 100, because Zillow prices in dollars                          |
| `travel_mode_code`             | `drive` 0, `bike` 1, `walk` 2, `transit` 3, because Directions takes an integer |
| `destination_raw`              | `destination.raw`                                                               |
| `query`                        | `query` if the parser set one, otherwise `category`                             |
| `opens_by_s`, `closes_after_s` | flattened out of `open_window`                                                  |

Storage stays canonical. Formatting happens here, at the edge, and nowhere else.

**`destination_point` is deliberately absent.** No amount of reading a constraint
produces a coordinate for an address. It is a binding the plan has to earn.

## Access patterns and feasible plans

Some sources cannot be read until something else has run. Directions needs a
destination point; anything per-listing needs a listing. In query planning terms
these are limited access patterns, and a plan that respects them is feasible.

This matters because a geocode eliminates no candidates. On pruning power alone
it scores zero and loses every comparison it enters, yet without it nothing
downstream can run at all.

So ordering is not only cost. A capability is schedulable once its required
bindings exist, and selection is a fixpoint: each round takes what is feasible,
keeps the best per constraint per tier, and adds whatever it binds.

Four bindings exist today:

| binding                        | produced by                                             |
| ------------------------------ | ------------------------------------------------------- |
| `constraint.destination_point` | `commute.geocode.region`                                |
| `entity`                       | `candidates.zillow.region`                              |
| `stage.bounds`                 | the planner, once `constraint.destination_point` exists |
| `cluster`                      | the planner, once `stage.bounds` and `entity` exist     |

A capability declares what it `produces`. What it **requires** is never declared:
it is read off its own `params_template`, so a row cannot claim to need less than
it uses.

Every op carries its `requires`. Xano re-derives them in `POST /run` and refuses
a plan whose stages are not ordered to satisfy them, because such a plan would
spend calls whose parameters resolve to nothing.
`infeasibleOps()` in `packages/planner/src/binding.ts` is the reference
implementation of that check.

An unaffordable producer is not silently dropped. It never binds, so everything
downstream stays infeasible and the constraint is reported as `unbound`. Losing
the search means losing the listings, and the plan says so.

## Canonical units

Cents, seconds, meters, and seconds since local midnight. Stored that way
everywhere, formatted only at render. `display_value` on an evidence row is for
display and is never parsed back.

Seconds of day may exceed 86400, so a shop closing at 2am is 93600 rather than 7200. A grocery "open past 10pm" is `closes_after_s: 79200`.
