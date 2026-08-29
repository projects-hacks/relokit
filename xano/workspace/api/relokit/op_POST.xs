//  Every paid call goes through here.
// 
//  The planner and the mappers run in the caller because they are deterministic
//  and cost nothing. This is the other half: the key, the money, and the memory.
//  The caller says which call it wants; whether that call is actually made is not
//  its decision.
// 
//  Three answers are possible and they are counted apart, because they mean
//  different things. A ledger hit means this fact about this listing is already
//  known and may have been learned answering somebody else's question. A cache
//  hit means this exact call was already made. Only a live answer costs anything.
// 
//  Driving the stage loop from the caller rather than from a function stack is
//  deliberate. The caller already holds the plan, so it can run a stage's ops
//  concurrently without a fan-out primitive, and the thing that must not be
//  client-side, which is the spending, is not.
query op verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
    text op_id filters=trim
    text capability_id filters=trim
    text endpoint filters=trim
  
    // Already resolved. The caller binds the refs; this does not interpret them.
    json params
  
    json constraint_ids
  
    // Who this op answers for. Empty for a region wide call that belongs to no
    // listing in particular.
    json entity_ids
  
    int ttl_seconds?=86400
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org
  
    db.get relokit_run {
      field_name = "id"
      field_value = $input.run_id
    } as $run
  
    precondition ($run != null && $run.org_id == $org.id) {
      error_type = "notfound"
      error = "No such run for this org."
    }
  
    // Identity of the call. Sorted so that a template written in a different
    // order is still recognised as the same question.
    function.run "Relokit/params_hash" {
      input = {endpoint: $input.endpoint, params: $input.params}
    } as $params_hash
  
    var $outcome {
      value = "live"
    }
  
    var $body {
      value = null
    }
  
    // Do we already know the answer for every listing this op is about? That is
    // a different question from whether we made this call, and it is the one
    // that makes a second query about the same city cheap.
    var $ledger_hit {
      value = false
    }
  
    conditional {
      if (($input.entity_ids|count) > 0) {
        db.query relokit_evidence {
          where = $db.relokit_evidence.org_id == $org.id && $db.relokit_evidence.expires_at > "now"
          return = {type: "list"}
        } as $fresh
      
        var $wanted {
          value = ($input.entity_ids|count) * ($input.constraint_ids|count)
        }
      
        var $covered {
          value = 0
        }
      
        foreach ($fresh) {
          each as $row {
            conditional {
              if (($input.entity_ids|contains:$row.entity_id) && ($input.constraint_ids|contains:$row.constraint_id)) {
                var $covered {
                  value = $covered + 1
                }
              }
            }
          }
        }
      
        conditional {
          if ($covered >= $wanted) {
            var $ledger_hit {
              value = true
            }
          
            var $outcome {
              value = "ledger_hit"
            }
          }
        }
      }
    }
  
    conditional {
      if ($ledger_hit == false) {
        db.query relokit_provider_cache {
          where = $db.relokit_provider_cache.endpoint == $input.endpoint && $db.relokit_provider_cache.params_hash == $params_hash && $db.relokit_provider_cache.expires_at > "now"
          return = {type: "single"}
        } as $cached
      
        conditional {
          if ($cached != null) {
            var $body {
              value = $cached.raw_response
            }
          
            var $outcome {
              value = "cache_hit"
            }
          }
        }
      }
    }
  
    conditional {
      if ($outcome == "live") {
        precondition ($env.serpapi_api_key != null) {
          error_type = "unauthorized"
          error = "No search key is configured on this instance."
        }
      
        // Refusing beats overspending. A run that stops here reports partial,
        // and its unevaluated listings are unverified rather than rejected.
        precondition ($run.actual_cost_units < $run.ceiling_cost_units) {
          error_type = "badrequest"
          error = "This run has reached the ceiling it was accepted on."
        }
      
        api.request {
          url = "https://serpapi.com/search.json"
          method = "GET"
          params = $input.params
            |set:"api_key":$env.serpapi_api_key
          headers = []|push:"Accept: application/json"
        } as $call
      
        var $body {
          value = $call.response.result
        }
      
        // An answer that has expired is still an answer that was stored, and a
        // call has one identity. Inserting a second row for the same call fails
        // on the unique index, which meant an expired entry blocked its own
        // refresh: the read-through missed, the call was paid for, and then the
        // write threw. The cache could never renew anything.
        db.query relokit_provider_cache {
          where = $db.relokit_provider_cache.endpoint == $input.endpoint && $db.relokit_provider_cache.params_hash == $params_hash
          return = {type: "single"}
        } as $stale

        conditional {
          if ($call.response.status == 200 && $stale != null) {
            db.edit relokit_provider_cache {
              field_name = "id"
              field_value = $stale.id
              data = {
                raw_response: $body
                ttl_seconds : $input.ttl_seconds
                expires_at  : "now"|add_secs_to_timestamp:$input.ttl_seconds
              }
            }
          }
        }

        conditional {
          if ($call.response.status == 200 && $stale == null) {
            db.add relokit_provider_cache {
              data = {
                created_at  : "now"
                endpoint    : $input.endpoint
                params_hash : $params_hash
                params      : $input.params
                raw_response: $body
                ttl_seconds : $input.ttl_seconds
                expires_at  : "now"|add_secs_to_timestamp:$input.ttl_seconds
                cost_units  : 1
              }
            }
          }
        }

        conditional {
          if ($call.response.status == 200) {
            db.edit relokit_run {
              field_name = "id"
              field_value = $run.id
              data = {
                actual_cost_units: ($run.actual_cost_units + 1)
                version          : ($run.version + 1)
                status           : "running"
              }
            }
          }
        }
      }
    }
  
    db.add relokit_run_op {
      data = {
        created_at     : "now"
        run_id         : $run.id
        op_id          : $input.op_id
        capability_id  : $input.capability_id
        endpoint       : $input.endpoint
        resolved_params: $input.params
        params_hash    : $params_hash
        status         : ($outcome == "live" ? "ok" : $outcome)
        cost_units     : ($outcome == "live" ? 1 : 0)
      }
    }
  }

  response = {
    from      : $outcome
    body      : $body
    cost_units: ($outcome == "live" ? 1 : 0)
  }

  guid = "ZgMw-_8CzcWY6xGkKMsuni-SRgY"
}