//  One fact about one listing, with where it came from and when it stops being
//  true.
// 
//  The index on (org_id, entity_id, constraint_type, expires_at) is the ledger
//  read-through, and it is the reason a second question about the same city is
//  cheap. Before spending a search the executor asks this table whether it
//  already knows the answer.
// 
//  verdict and eval_state are separate on purpose. A rejection needs verdict
//  fail AND eval_state evaluated: an error can never throw a home away, because
//  "we could not check" and "it does not qualify" are different answers.
table relokit_evidence {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id {
      table = "relokit_org"
    }
  
    int run_id? {
      table = "relokit_run"
    }
  
    text entity_id filters=trim
    text constraint_id filters=trim
    text constraint_type filters=trim
    enum verdict {
      values = ["pass", "fail", "unknown"]
    }
  
    enum eval_state {
      values = ["evaluated", "failed", "skipped"]
    }
  
    // Canonical units: cents, seconds, meters. Never a formatted string.
    decimal value_canonical?
  
    text value_text?
  
    // The top of a range, where the source gave a band rather than a number.
    decimal value_canonical_upper?
  
    // Formatted for reading. Never parsed back.
    text display_value filters=trim
  
    text source filters=trim
    text source_url?
    timestamp fetched_at?=now
    int ttl_seconds
  
    // Stored rather than computed, so the read-through can index on it.
    timestamp expires_at
  
    decimal confidence?=1
  
    // Attribution back into the plan. The difference between a five minute and
    // a forty minute answer to "why was this rejected".
    text capability_id filters=trim
  
    text op_id filters=trim
  
    // Lower wins. What settles a disagreement between two sources.
    int precedence?=1
  
    text reason?

    // The place a fact is about, when it is about one: the gym that was found,
    // or the far end of the journey. A proximity claim is a claim about
    // somewhere, and a map cannot show it otherwise.
    json about?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [
        {name: "org_id", op: "asc"}
        {name: "entity_id", op: "asc"}
        {name: "constraint_type", op: "asc"}
        {name: "expires_at", op: "desc"}
      ]
    }
    {
      type : "btree"
      field: [{name: "run_id", op: "asc"}, {name: "entity_id", op: "asc"}]
    }
  ]

  guid = "-2DGyOQvDghga5o_Fmuvf3VNYts"
}