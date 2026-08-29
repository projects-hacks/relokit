// A question worth asking again.
//
// Watch re-runs these on a schedule. The point is not that re-running is
// possible but that it is nearly free: the evidence ledger still holds most of
// the answers, so the second run pays only for what expired.
table relokit_saved_query {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id { table = "relokit_org" }
    text name filters=trim
    text raw_query filters=trim
    json constraint_set
    bool watch_enabled?=false
    int watch_interval_minutes?=1440
    timestamp next_due_at?
    int last_run_id?
    text notify_email? filters=trim|lower
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "watch_enabled", op: "asc"}, {name: "next_due_at", op: "asc"}]}
  ]
  guid = "RUOPKi7z3oHNZS0Gin9zlEzFIjQ"
}
