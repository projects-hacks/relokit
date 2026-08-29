// Accepts a plan, or refuses it.
//
// The planner runs in the caller, which means a plan arriving here is a list of
// paid calls somebody else wrote. So it is re-priced against this instance's own
// registry before anything is spent, and the number the interface shows
// afterwards is the one computed here rather than the one that was submitted.
//
// The price taken is the worst case: every op at its capability's maximum
// fan-out. That is deliberately not an attempt to reproduce the planner's
// arithmetic. Reproducing it would mean trusting the same cardinality guesses
// the client used, whereas a worst case that fits under the ceiling is safe
// whatever those guesses were, and it enforces max_fanout as a side effect.
query run verb=POST {
  api_group = "Relokit"

  input {
    json constraint_set
    json plan
    int ceiling_cost_units?=200
  }

  stack {
    function.run "Relokit/require_org" as $org

    precondition ($input.plan.registry_version != null) {
      error = "The plan does not say which registry version it was built from."
    }

    db.query relokit_capability {
      where = $db.relokit_capability.registry_version == $input.plan.registry_version
      return = {type: "list"}
    } as $registry

    // A plan built from a registry this instance has never seen cannot be
    // priced, and pricing it against a different version would be a guess.
    precondition (($registry|count) > 0) {
      error = "This instance has no registry version " ~ $input.plan.registry_version
    }

    var $worst_case {
      value = 0
    }

    var $refused {
      value = []
    }

    foreach ($input.plan.stages) {
      each as $stage {
        foreach ($stage.ops) {
          each as $op {
            db.query relokit_capability {
              where = $db.relokit_capability.capability_id == $op.capability_id && $db.relokit_capability.registry_version == $input.plan.registry_version
              return = {type: "single"}
            } as $capability

            conditional {
              if ($capability == null) {
                var $refused {
                  value = $refused|array_push:($op.op_id ~ " names a capability this registry does not have: " ~ $op.capability_id)
                }
              }
            }

            conditional {
              if ($capability != null && $capability.enabled == false) {
                var $refused {
                  value = $refused|array_push:($op.op_id ~ " uses a capability that is switched off: " ~ $op.capability_id)
                }
              }
            }

            conditional {
              if ($capability != null) {
                var $worst_case {
                  value = $worst_case + ($capability.cost_units * $capability.max_fanout)
                }
              }
            }
          }
        }
      }
    }

    precondition (($refused|count) == 0) {
      error_type = "badrequest"
      error = "This plan was refused: " ~ ($refused|join:"; ")
    }

    // Refused rather than trimmed. Running the affordable half of a plan
    // produces an answer that looks complete and is not.
    precondition ($worst_case <= $input.ceiling_cost_units) {
      error_type = "badrequest"
      error = "This plan could cost " ~ $worst_case ~ " searches against a ceiling of " ~ $input.ceiling_cost_units
    }

    db.add relokit_run {
      data = {
        created_at        : "now"
        org_id            : $org.id
        raw_query         : $input.constraint_set.raw_query
        constraint_set    : $input.constraint_set
        plan              : $input.plan
        plan_id           : $input.plan.plan_id
        registry_version  : $input.plan.registry_version
        status            : "queued"
        naive_cost_units  : $input.plan.trace.naive_cost_units
        planned_cost_units: $input.plan.estimated_cost_units
        actual_cost_units : 0
        ceiling_cost_units: $input.ceiling_cost_units
        mode              : "live"
        version           : 1
      }
    } as $run

    foreach ($input.plan.stages) {
      each as $stage {
        db.add relokit_run_stage {
          data = {
            run_id      : $run.id
            stage_index : $stage.index
            stage_id    : $stage.stage_id
            tier        : $stage.tier
            status      : "planned"
            ops_planned : ($stage.ops|count)
            entities_in : 0
            entities_out: 0
            cost_units  : 0
          }
        }
      }
    }
  }

  response = {
    run_id            : $run.id
    status            : $run.status
    worst_case_units  : $worst_case
    ceiling_cost_units: $input.ceiling_cost_units
    planned_cost_units: $input.plan.estimated_cost_units
  }
  guid = "lj2O1_KdWFE9tsw3NTCMPI3vsC8"
}
