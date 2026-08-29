//  Asking one saved question again.
//
//  Separate from the schedule so the nightly run and a person pressing "check
//  now" are the same code. A watch nobody can start is a watch nobody can test.
//
//  It replays the search the question already produced, using the parameters
//  stored against that run, so it needs no planner and no resolver. Almost every
//  answer is still inside its lifetime, which is the point: asking again costs a
//  fraction of asking the first time, and the interface shows both numbers.
//
//  What it compares is what is on the market and what it costs. Turning a
//  provider's answer into a verdict on every requirement is deterministic work
//  that lives in one implementation beside the person asking, and a second copy
//  here would eventually disagree with the first. A home appearing,
//  disappearing, or changing price is the thing worth waking someone for, and it
//  is readable without any of that.
function "Relokit/watch_once" {
  input {
    int saved_query_id
  }

  stack {
    db.get relokit_saved_query {
      field_name = "id"
      field_value = $input.saved_query_id
    } as $saved

    precondition ($saved != null) {
      error_type = "notfound"
      error = "No such saved question."
    }

    db.get relokit_run {
      field_name = "id"
      field_value = $saved.last_run_id
    } as $parent

    precondition ($parent != null) {
      error_type = "notfound"
      error = "That question has no answer to compare against yet."
    }

    // The search that produced the candidates, with its parameters as they were
    // actually resolved. Replaying it needs no plan.
    db.query relokit_run_op {
      where = $db.relokit_run_op.run_id == $parent.id && $db.relokit_run_op.op_id == "op_candidates"
      return = {type: "single"}
    } as $search

    precondition ($search != null) {
      error = "That answer recorded no search to repeat."
    }

    db.add relokit_run {
      data = {
        created_at        : "now"
        org_id            : $saved.org_id
        saved_query_id    : $saved.id
        parent_run_id     : $parent.id
        raw_query         : $saved.raw_query
        constraint_set    : $saved.constraint_set
        plan              : $parent.plan
        plan_id           : $parent.plan_id
        registry_version  : $parent.registry_version
        status            : "running"
        naive_cost_units  : $parent.naive_cost_units
        planned_cost_units: $parent.planned_cost_units
        actual_cost_units : 0
        ceiling_cost_units: $parent.ceiling_cost_units
        mode              : "mixed"
        version           : 1
        started_at        : "now"
      }
    } as $child

    function.run "Relokit/execute_op" {
      input = {
        org_id        : $saved.org_id
        run_id        : $child.id
        op_id         : "op_candidates"
        capability_id : $search.capability_id
        endpoint      : $search.endpoint
        params        : $search.resolved_params
        constraint_ids: []
        entity_ids    : []
        ttl_seconds   : 172800
      }
    } as $fresh

    var $now_listings {
      value = {}
    }

    foreach ($fresh.body.organic_results) {
      each as $listing {
        var $listing_id {
          value = "zillow:" ~ ($listing|get:"provider_listing_id":($listing|get:"zpid":"?"))
        }

        // Held as an object rather than a bare number. Whether a home was here
        // last night is a question about the key, and a bare rent of zero reads
        // as absent to every way of asking that: four band listings priced at
        // zero were reported as arriving and leaving on the same night. An
        // object is never mistaken for nothing.
        var $now_listings {
          value = $now_listings|set:$listing_id:({}|set:"price":($listing|get:"extracted_price":($listing|get:"min_base_rent":0)))
        }
      }
    }

    var $was_listings {
      value = $saved|get:"last_listings":{}
    }

    var $was_ids {
      value = $was_listings|keys
    }

    var $now_ids {
      value = $now_listings|keys
    }

    // There is nothing to report against the first time a question is watched,
    // and announcing every home as new would be noise rather than news.
    conditional {
      if (($was_ids|count) > 0) {
        foreach ($now_ids) {
          each as $id {
            var $before {
              value = $was_listings|get:$id:null
            }

            var $after {
              value = $now_listings|get:$id:null
            }

            conditional {
              if ($before == null) {
                db.add relokit_run_diff {
                  data = {
                    created_at : "now"
                    run_id     : $child.id
                    prev_run_id: $parent.id
                    entity_id  : $id
                    change_type: "entered_pass"
                    after      : $after
                  }
                }
              }
            }

            conditional {
              if ($before != null && ($before|get:"price":0) != ($after|get:"price":0)) {
                db.add relokit_run_diff {
                  data = {
                    created_at : "now"
                    run_id     : $child.id
                    prev_run_id: $parent.id
                    entity_id  : $id
                    change_type: "value_change"
                    before     : $before
                    after      : $after
                  }
                }
              }
            }
          }
        }

        foreach ($was_ids) {
          each as $gone {
            var $still_here {
              value = $now_listings|get:$gone:null
            }

            conditional {
              if ($still_here == null) {
                db.add relokit_run_diff {
                  data = {
                    created_at : "now"
                    run_id     : $child.id
                    prev_run_id: $parent.id
                    entity_id  : $gone
                    change_type: "left_pass"
                    before     : ($was_listings|get:$gone:null)
                  }
                }
              }
            }
          }
        }
      }
    }

    db.edit relokit_run {
      field_name = "id"
      field_value = $child.id
      data = {status: "complete", finished_at: "now"}
    }

    db.edit relokit_saved_query {
      field_name = "id"
      field_value = $saved.id
      data = {
        last_listings: $now_listings
        next_due_at  : ("now"|add_secs_to_timestamp:($saved.watch_interval_minutes * 60))
      }
    }
  }

  response = {
    run_id  : $child.id
    listings: ($now_listings|keys|count)
    previous: ($was_ids|count)
    spent   : $fresh.cost_units
  }
  guid = "0qgGRnqCbjEmKr8r0GKcTvAiWLs"
}
