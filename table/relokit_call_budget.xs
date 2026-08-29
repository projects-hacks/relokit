//  What a tenant has spent in a window, against what they are allowed.
// 
//  Checked before a run is accepted and again between stages, so a plan that
//  turns out to be more expensive than it looked stops partway rather than
//  finishing the month's quota. A run that stops here reports partial: its
//  unevaluated listings are unverified, never rejected.
table relokit_call_budget {
  auth = false

  schema {
    int id
    int org_id {
      table = "relokit_org"
    }
  
    enum window {
      values = ["day", "month"]
    }
  
    timestamp window_start
    int cost_units_spent?
    int cost_units_cap
    timestamp updated_at?=now
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree|unique"
      field: [
        {name: "org_id", op: "asc"}
        {name: "window", op: "asc"}
        {name: "window_start", op: "asc"}
      ]
    }
  ]

  guid = "EOXxyHXklr6lp5oW5heugPLMn2s"
}