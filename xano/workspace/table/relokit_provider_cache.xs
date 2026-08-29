// The raw answer to an exact call.
//
// Distinct from the evidence ledger, which remembers facts about listings. This
// remembers responses. A ledger hit saves a call across different questions; a
// cache hit saves one across repeats of the same call.
table relokit_provider_cache {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    text endpoint filters=trim
    // Parameters sorted and stripped of the key, so reordering a template does
    // not miss the cache and spend a search.
    text params_hash filters=trim
    json params?
    json raw_response
    int ttl_seconds
    timestamp expires_at
    int cost_units?=1
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "endpoint", op: "asc"}, {name: "params_hash", op: "asc"}]}
    {type: "btree", field: [{name: "expires_at", op: "asc"}]}
  ]
  guid = "8Z5HMve8ggEYHx4c86uWGLv_h2o"
}
