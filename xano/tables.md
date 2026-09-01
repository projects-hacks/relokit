# Xano tables

Xano is the only backend. There is no other server: the planner is a library that
runs in the browser and in the MCP server, and everything that touches a key, a
credit or a stored fact happens here.

## The one rule

`registry.seed.json` is the source of truth for the `capability` table. It is
imported by `POST /admin/registry/import`, which is the only write path. Nobody
edits capability rows in the Xano UI. A row changed by hand passes every test in
this repo and changes the demo, which is a two hour bug at the worst moment.

## Tables

### org

`id`, `name`, `api_key_hash`, `plan_tier`, `monthly_cost_units_cap`, `created_at`.

### user

`id`, `org_id` to org, `email`, `role` (owner or member), Xano auth password,
`created_at`.

### capability

The registry row from `packages/schema/src/capability.ts`, plus
`registry_version`. Unique on `(capability_id, registry_version)`.

`selectivity_prior` is the fraction expected to **pass**, not the fraction
eliminated. It is an engineering estimate and stays one: what runs measure lives
in `observation`, and the planner substitutes it there rather than here.

### observation

`id`, `created_at`, `org_id`, `run_id`, `capability_id`, `registry_version`,
`region`, and the counts `answered`, `decisive`, `passed`. Unique on
`(run_id, capability_id)`, which makes a double filing impossible.

Append-only. Nothing edits a row, nothing seeds one, and a registry import does
not touch the table, so a change to the estimates never erases what was measured.
Counts rather than ratios: counts sum exactly across runs, and a measured zero
survives storage where a ratio would be indistinguishable from a default.

`region` is a hash of the place the question named, not the place itself. The
rows are served back to every reader of `/parse`, and an anchor is where somebody
lives or works, so what travels is enough to recognise the same place twice and
nothing more. Null when no place was named or the anchor was the reader's own
location.

### saved_query

`id`, `org_id`, `user_id`, `name`, `raw_text`, `constraint_set` json, `plan_hash`,
`watch_enabled`, `watch_interval_minutes`, `next_due_at`, `last_run_id`,
`notify_email`.

### run

`id`, `org_id`, `saved_query_id`, `parent_run_id`, `raw_text`, `constraint_set`,
`plan`, `plan_hash`, `registry_version`, `status`, `naive_cost_units`,
`planned_cost_units`, `actual_cost_units`, `ceiling_cost_units`, `mode`,
`version`, `started_at`, `finished_at`, `error`.

`version` is monotonic and bumped on every write. It is the cursor for
`GET /run/{id}?since_version=N`, which is what makes 700ms polling cheap enough to
look like streaming.

### run_stage

`id`, `run_id`, `stage_index`, `stage_id`, `tier`, `status`, `ops_planned`,
`ops_executed`, `ops_failed`, `entities_in`, `entities_out`, `cost_units`,
`started_at`, `finished_at`.

`entities_out` is what the map animates against. It is measured, not predicted.

### run_op

`id`, `run_id`, `run_stage_id`, `op_id`, `capability_id`, `endpoint`,
`resolved_params`, `params_hash`, `status`, `http_status`, `cost_units`,
`latency_ms`, `error`, `provider_cache_id`.

Three features depend on this table: the cost trace, the partial failure story,
and the work queue if async invocation turns out to be unusable.

### entity

`id` (canonical), `org_id`, `kind` (listing or place), `provider`,
`provider_entity_id`, `lat`, `lng`, `address_normalized`, `display` json,
`first_seen_at`, `last_seen_at`. Unique on `(provider, provider_entity_id)`.

### evidence

The evidence row from `packages/schema/src/evidence.ts`, plus `id`, `run_id`,
`org_id`. Index on `(org_id, entity_id, constraint_type, expires_at_ms)`. That
index is the ledger read-through and it is the reason a second query about the
same city is cheap.

### provider_cache

`id`, `endpoint`, `params_hash`, `params`, `raw_response`, `fetched_at_ms`,
`ttl_seconds`, `expires_at_ms`, `cost_units`, `bytes`. Unique on
`(endpoint, params_hash)`.

A `ledger_hit` and a `cache_hit` are different things and the cost trace shows
them separately. A ledger hit means we already knew this fact about this listing,
possibly from a different query. A cache hit means we already made this exact call.

### call_budget

`id`, `org_id`, `window` (day or month), `window_start`, `cost_units_spent`,
`cost_units_cap`, `updated_at`.

### run_diff

`id`, `run_id`, `prev_run_id`, `entity_id`, `change_type`, `constraint_id`,
`before`, `after`, `created_at`.

Written by Watch. Change detection skips evidence that came from the ledger
unchanged, otherwise it reports changes to facts nobody re-fetched.

## Endpoints

| endpoint                      | does                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /parse`                 | Calls the LLM, validates the constraint set, returns it with the registry and a cost ceiling.                  |
| `POST /run`                   | Re-prices the submitted plan against this registry, rejects it if it costs more than the ceiling, enqueues it. |
| `GET /run/{id}`               | Run state, stages, three buckets, evidence, cost trace. Supports `since_version`.                              |
| `POST /admin/registry/import` | The only write path to `capability`.                                                                           |

`POST /run` never trusts the client's cost number. It walks the ops, looks each
`capability_id` up in its own table, rejects unknown or disabled capabilities, any
op whose stage fan-out exceeds that capability's `max_fanout`, any param ref
outside the closed set, and any plan whose recomputed cost is over the ceiling.
