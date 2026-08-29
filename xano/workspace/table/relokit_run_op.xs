// One call, or one call deliberately not made.
//
// Three things depend on this table. The cost trace is a count of these rows by
// status. The partial failure story is the error text kept beside the listings
// it could not answer for. And if fanning out inside a function stack turns out
// to be unusable, these rows become the work queue that workers claim from.
table relokit_run_op {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int run_id { table = "relokit_run" }
    int run_stage_id? { table = "relokit_run_stage" }
    text op_id filters=trim
    text capability_id filters=trim
    text endpoint filters=trim
    json resolved_params?
    // Identity of the call, so the same question is never paid for twice.
    text params_hash? filters=trim

    // ledger_hit and cache_hit are different savings and are counted apart. A
    // ledger hit means this fact about this listing was already known, possibly
    // from someone else's question. A cache hit means this exact call was
    // already made.
    enum status {
      values = ["pending", "claimed", "running", "ok", "error", "cache_hit", "ledger_hit", "skipped"]
    }

    int http_status?
    int cost_units?=0
    int latency_ms?
    text error?
    text claimed_by?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "run_id", op: "asc"}, {name: "status", op: "asc"}]}
    {type: "btree", field: [{name: "run_stage_id", op: "asc"}, {name: "status", op: "asc"}]}
  ]
  guid = "fUoQsE9ojdZeSjGIMOMrBrbKcgE"
}
