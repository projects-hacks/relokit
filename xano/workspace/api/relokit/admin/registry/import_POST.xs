//  The only write path to the capability registry.
// 
//  The registry is what makes the planner data rather than code: which source can
//  answer which constraint, at what granularity, cost and freshness. Change a row
//  and the plan changes, with no deploy.
// 
//  That only holds while the rows match what is in the repository. A row edited
//  by hand in the dashboard passes every test in git and quietly changes what the
//  demo does, so an import replaces a whole version at once and nothing else
//  writes here.
query "admin/registry/import" verb=POST {
  api_group = "Relokit"

  input {
    text admin_key filters=trim
    text registry_version filters=trim
    json capabilities
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
  
    precondition (($input.capabilities|count) > 0) {
      error = "A registry with no capabilities would answer nothing."
    }
  
    // Replace everything, not just this version. An earlier attempt replaced
    // only the matching version and older ones stayed behind, so the instance
    // held two registries at once and handed back a mixture labelled with one of
    // them. /run then refused plans for naming capabilities it could not find.
    //
    // The repository is the source of truth, so the instance holds exactly what
    // the repository last said and nothing else.
    db.query relokit_capability {
      return = {type: "list"}
    } as $existing
  
    foreach ($existing) {
      each as $old {
        db.del relokit_capability {
          field_name = "id"
          field_value = $old.id
        }
      }
    }
  
    foreach ($input.capabilities) {
      each as $capability {
        // Written out field by field rather than passed through. It is longer,
        // and it means a key the seed grew by accident cannot quietly land in
        // the table and start affecting plans.
        db.add relokit_capability {
          data = {
            created_at                                                         : "now"
            registry_version                                                   : $input.registry_version
            capability_id                                                      : $capability.capability_id
            constraint_type                                                    : $capability.constraint_type
            provider                                                           : $capability.provider
            endpoint                                                           : $capability.endpoint
            granularity                                                        : $capability.granularity
            cost_units                                                         : $capability.cost_units
            latency_p50_ms                                                     : $capability.latency_p50_ms
            selectivity_prior                                                  : $capability.selectivity_prior
            "// Read with a default. XanoScript raises on a key an object does": ``
            "// not have rather than answering null"                           : ``
            "and most capabilities have"                                       : ``
            "// never been observed."                                          : ``
            selectivity_observed                                               : $capability|get:"selectivity_observed":null
            observation_n                                                      : $capability|get:"observation_n":0
            ttl_seconds                                                        : $capability.ttl_seconds
            coverage                                                           : $capability.coverage
            precedence                                                         : $capability.precedence
            enabled                                                            : $capability.enabled
            max_fanout                                                         : $capability.max_fanout
            params_template                                                    : $capability.params_template
            produces                                                           : $capability.produces
            notes                                                              : $capability|get:"notes":null
          }
        }
      }
    }
  }

  response = {
    registry_version: $input.registry_version
    replaced        : $existing|count
    imported        : $input.capabilities|count
  }

  guid = "oCG2CBARHuCrJ9QWOnhaHLXJXaY"
}