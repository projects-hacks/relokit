//  The capability registry. Which source can answer which constraint, at what
//  granularity, cost and freshness.
// 
//  This is the table that makes the planner data rather than code: adding a
//  garden is a row, and changing how the plan behaves is an import rather than a
//  deploy.
// 
//  Written only by POST /admin/registry/import, from xano/registry.seed.json in
//  the repository. Nothing edits these rows by hand. A row changed in the UI
//  passes every test in the repo and quietly changes the demo, which is a two
//  hour bug at the worst possible moment.
table relokit_capability {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    text capability_id filters=trim
    text registry_version filters=trim
    text constraint_type filters=trim
    text provider filters=trim
    text endpoint filters=trim
  
    // native, region, cluster or entity. Kept as text rather than an enum so a
    // new tier is a seed change and not a schema migration.
    text granularity filters=trim
  
    // Searches per invocation. Zero for a predicate the provider applies inside
    // a search we were making anyway.
    int cost_units
  
    int latency_p50_ms
  
    // The fraction expected to PASS, not the fraction eliminated. Getting this
    // direction backwards inverts every plan.
    decimal selectivity_prior
  
    int observation_n?
    int ttl_seconds
    decimal coverage
    int precedence
    bool enabled
  
    // Hard ceiling on invocations in one stage. The first defence against a
    // fan-out that empties the budget.
    int max_fanout
  
    json params_template
    json produces

    // Subjects a candidate source can produce. Empty on everything that answers
    // questions about candidates rather than making them.
    json subjects?
    text notes?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [
        {name: "registry_version", op: "asc"}
        {name: "constraint_type", op: "asc"}
      ]
    }
    {
      type : "btree|unique"
      field: [
        {name: "capability_id", op: "asc"}
        {name: "registry_version", op: "asc"}
      ]
    }
  ]

  guid = "SofwB0Wl4hxb4zeBXOtI6DFjpCs"
}