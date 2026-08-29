// One question, asked once.
//
// The plan is stored as submitted so a result can be explained later, and the
// three cost figures are kept apart on purpose: what it would have cost with no
// planner, what the plan expected, and what was actually spent.
table relokit_run {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id { table = "relokit_org" }
    int saved_query_id? { table = "relokit_saved_query" }
    // Set when a watch produced this run, pointing at the run it is compared to.
    int parent_run_id?
    text raw_query filters=trim
    json constraint_set
    json plan
    text plan_id filters=trim
    text registry_version filters=trim

    enum status {
      values = ["queued", "running", "partial", "complete", "failed", "rejected_over_budget"]
    }

    int naive_cost_units?=0
    int planned_cost_units?=0
    int actual_cost_units?=0
    int ceiling_cost_units?=0

    // live, cached_only or mixed. A watch run is mixed and usually costs a
    // fraction of the first run because most of its evidence has not expired.
    text mode? filters=trim

    // Monotonic, bumped on every write. The cursor for polling: a client passes
    // the last version it saw and is sent only what changed since.
    int version?=0

    timestamp started_at?
    timestamp finished_at?
    json error?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "org_id", op: "asc"}, {name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "parent_run_id", op: "asc"}]}
  ]
  guid = "T9vk51w91n5UpWCkvwJhFxjVi5A"
}
