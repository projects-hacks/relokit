// What one stage of a plan actually did.
//
// entities_out is measured rather than predicted, and it is what the map
// animates against. The plan's own estimate lives in the plan; this is the
// number that turned out to be true.
table relokit_run_stage {
  auth = false

  schema {
    int id
    int run_id { table = "relokit_run" }
    int stage_index
    text stage_id filters=trim
    text tier filters=trim

    enum status { values = ["planned", "running", "complete", "failed", "skipped"] }

    int ops_planned?=0
    int ops_executed?=0
    int ops_failed?=0
    int entities_in?=0
    int entities_out?=0
    int cost_units?=0
    // Set when the stage was not worth running, with the arithmetic that said so.
    text skip_reason?
    timestamp started_at?
    timestamp finished_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "run_id", op: "asc"}, {name: "stage_index", op: "asc"}]}
  ]
  guid = "9CMfDdzyFynYp4hoaXiXhjN6iGw"
}
