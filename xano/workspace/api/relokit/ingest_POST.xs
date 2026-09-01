//  Stores what a stage learned.
// 
//  The mapping from a provider's answer to a verdict lives in the caller, tested
//  against recorded responses, and there is one implementation of it. What lands
//  here is already canonical: cents, seconds, meters, and a verdict beside the
//  state it was reached in.
// 
//  Evidence is kept per fact rather than per run, with the expiry the capability
//  asked for. That is what makes the ledger a ledger: the next question about
//  this listing does not pay for what this one already learned.
query ingest verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
    json entities
    json evidence
    json observations?
    text region? filters=trim
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

    // What each capability did, as counts, filed once per run. First, before
    // the heavy loops below: writes survive an abort here (measured), so a
    // gateway that kills the filing mid-way still leaves the counts kept. The
    // unique index on (run_id, capability_id) makes a double filing impossible.
    conditional {
      if ($input.observations != null) {
        foreach ($input.observations) {
          each as $obs {
            db.add relokit_observation {
              data = {
                created_at      : "now"
                org_id          : $org.id
                run_id          : $run.id
                capability_id   : $obs.capability_id
                registry_version: $run.registry_version
                region          : $input.region
                answered        : $obs|get:"answered":0
                decisive        : $obs|get:"decisive":0
                passed          : $obs|get:"passed":0
              }
            }
          }
        }
      }
    }

    foreach ($input.entities) {
      each as $entity {
        db.query relokit_entity {
          where = $db.relokit_entity.org_id == $org.id && $db.relokit_entity.entity_id == $entity.entity_id
          return = {type: "single"}
        } as $known
      
        conditional {
          if ($known == null) {
            db.add relokit_entity {
              data = {
                created_at        : "now"
                org_id            : $org.id
                entity_id         : $entity.entity_id
                kind              : $entity|get:"kind":"listing"
                provider          : $entity|get:"provider":"zillow"
                lat               : $entity|get:"lat":null
                lng               : $entity|get:"lng":null
                address_normalized: $entity|get:"address_normalized":null
                display           : $entity|get:"display":null
                last_seen_at      : "now"
              }
            }
          }
        }
      
        conditional {
          if ($known != null) {
            db.edit relokit_entity {
              field_name = "id"
              field_value = $known.id
              data = {
                display     : $entity|get:"display":null
                last_seen_at: "now"
              }
            }
          }
        }
      }
    }
  
    foreach ($input.evidence) {
      each as $row {
        db.add relokit_evidence {
          data = {
            created_at           : "now"
            org_id               : $org.id
            run_id               : $run.id
            entity_id            : $row.entity_id
            constraint_id        : $row.constraint_id
            constraint_type      : $row.constraint_type
            verdict              : $row.verdict
            eval_state           : $row.eval_state
            value_canonical      : $row|get:"value_canonical":null
            value_text           : $row|get:"value_text":null
            value_canonical_upper: $row|get:"value_canonical_upper":null
            display_value        : $row.display_value
            source               : $row.source
            source_url           : $row|get:"source_url":null
            fetched_at           : "now"
            ttl_seconds          : $row.ttl_seconds
            expires_at           : "now"|add_secs_to_timestamp:$row.ttl_seconds
            confidence           : $row|get:"confidence":1
            capability_id        : $row.capability_id
            op_id                : $row.op_id
            precedence           : $row|get:"precedence":1
            reason               : $row|get:"reason":null
            about                : $row|get:"about":null
            route                : $row|get:"route":null
          }
        }
      }
    }
  
    // Only when something of the record arrived. The counts are filed in their
    // own small request, and a version that counted those would say a run had
    // changed when nothing about its answer had.
    var $version {
      value = $run.version
    }

    conditional {
      if (($input.entities|count) > 0 || ($input.evidence|count) > 0) {
        var $version {
          value = ($run.version + 1)
        }

        db.edit relokit_run {
          field_name = "id"
          field_value = $run.id
          data = {version: $version}
        }
      }
    }
  }

  response = {
    entities: $input.entities|count
    evidence: $input.evidence|count
    version : $version
  }

  guid = "zdzlySVf6aSZgcs0aC6cPOp-8iw"
}