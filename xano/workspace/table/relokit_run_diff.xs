//  What changed between a watch run and the one before it.
// 
//  Change detection ignores evidence that came back unchanged from the ledger.
//  Reporting a change to a fact nobody re-fetched would be worse than reporting
//  nothing, because it would teach people to distrust the alerts.
table relokit_run_diff {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int run_id {
      table = "relokit_run"
    }
  
    int prev_run_id?
    text entity_id filters=trim
    enum change_type {
      values = ["entered_pass", "left_pass", "value_change", "verdict_flip"]
    }
  
    text constraint_id? filters=trim
    json before?
    json after?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "run_id", op: "asc"}]}
  ]

  guid = "R3BGfpSC5dKUpyCuR-kwLPmjvW0"
}