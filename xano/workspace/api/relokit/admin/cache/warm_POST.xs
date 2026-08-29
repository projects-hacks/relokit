//  Loads a recorded provider answer into the cache.
// 
//  The demo query's responses are recorded in the repository, redacted and
//  committed, and this puts them where the executor will look. That is the
//  pre-warming a live demo needs, and it costs no searches at all.
// 
//  It is not a shortcut around the truth. fetched_at is the time the answer was
//  really recorded, so expiry is computed from when it was really learned and the
//  interface shows its real age. A recording older than its capability's TTL is
//  simply stale, and the executor will pay to ask again.
// 
//  The key is computed by the same function /op uses, so a warmed entry is found
//  under the key the executor will look for. Accepting a hash from the caller, or
//  computing it twice, is how the two silently stop agreeing.
query "admin/cache/warm" verb=POST {
  api_group = "Relokit"

  input {
    text admin_key filters=trim
    text endpoint filters=trim
    json params
    json raw_response
    int ttl_seconds
  
    // Milliseconds since the epoch, when the answer was actually recorded.
    // Xano stores a timestamp as epoch milliseconds, so this needs no
    // conversion filter and there is none that does it.
    int fetched_at_ms
  }

  stack {
    precondition ($env.relokit_admin_key != null) {
      error_type = "unauthorized"
      error = "Relokit has no admin key configured on this instance."
    }
  
    precondition ($input.admin_key == $env.relokit_admin_key) {
      error_type = "unauthorized"
      error = "Admin key missing or wrong."
    }
  
    function.run "Relokit/params_hash" {
      input = {endpoint: $input.endpoint, params: $input.params}
    } as $params_hash
  
    db.query relokit_provider_cache {
      where = $db.relokit_provider_cache.endpoint == $input.endpoint && $db.relokit_provider_cache.params_hash == $params_hash
      return = {type: "single"}
    } as $existing
  
    // Re-warming refreshes what is already there. An entry loaded under an
    // earlier lifetime keeps that lifetime otherwise, so raising a TTL in the
    // registry would have no effect on anything already stored and the cache
    // would stay expired with no way to say so.
    conditional {
      if ($existing != null) {
        db.edit relokit_provider_cache {
          field_name = "id"
          field_value = $existing.id
          data = {
            raw_response: $input.raw_response
            ttl_seconds : $input.ttl_seconds
            expires_at  : $input.fetched_at_ms + ($input.ttl_seconds * 1000)
          }
        }
      }
    }

    conditional {
      if ($existing == null) {
        db.add relokit_provider_cache {
          data = {
            created_at  : $input.fetched_at_ms
            endpoint    : $input.endpoint
            params_hash : $params_hash
            params      : $input.params
            raw_response: $input.raw_response
            ttl_seconds : $input.ttl_seconds
            expires_at  : ($input.fetched_at_ms + ($input.ttl_seconds * 1000))
            cost_units  : 1
          }
        }
      }
    }
  }

  response = {params_hash: $params_hash, warmed: ($existing == null)}
  guid = "2o4o9QPJFXdlA9NsdADBAkUrbKk"
}