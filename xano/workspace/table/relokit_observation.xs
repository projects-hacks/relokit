//  What each capability actually did in one run, as counts.
//
//  Append-only and never seeded: a row exists because a run happened, and a
//  registry import touches none of this. Counts rather than ratios, because
//  counts sum exactly across runs and a stored zero survives the |get
//  falsy-default idiom (0 and the default are the same value).
//
//  The reader turns these into priors on its own side; nothing here decides.
table relokit_observation {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id
    int run_id
    text capability_id filters=trim

    // Attribution only. Aggregation ignores it: a prior tweak does not change
    // what a provider did against real listings.
    text registry_version filters=trim

    // Normalized anchor text, e.g. "san jose, ca". Null when the question
    // named no place, or named the reader's own location.
    text region? filters=trim

    int answered
    int decisive
    int passed
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree|unique"
      field: [{name: "run_id", op: "asc"}, {name: "capability_id", op: "asc"}]
    }
  ]

  guid = "Observe4nRk8XwPq2mYtLcJb6dF"
}
