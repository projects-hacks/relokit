//  Everything known about a run.
// 
//  Returned as facts rather than as an answer. Sorting listings into verified,
//  unverified and rejected is deterministic and the caller does it, with the same
//  code that decides it offline against recorded responses. Two implementations
//  of that would eventually disagree about what a rejection is.
// 
//  The spend is not left to the caller. actual_cost_units is maintained here as
//  calls are made, and the per status breakdown below is only how that total was
//  reached.
query runs verb=GET {
  api_group = "Relokit"

  input {
    text run_id filters=trim
    text org_key filters=trim
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org

    // to_int because a query parameter arrives as text and an int column will
    // not be searched with one.
    db.get relokit_run {
      field_name = "id"
      field_value = $input.run_id|to_int
    } as $run
  
    precondition ($run != null && $run.org_id == $org.id) {
      error_type = "notfound"
      error = "No such run for this org."
    }
  
    db.query relokit_run_op {
      where = $db.relokit_run_op.run_id == $run.id
      return = {type: "list"}
    } as $ops
  
    // What was actually spent, counted from the calls themselves. The column on
    // the run is a running convenience and cannot be trusted once calls of one
    // operation go out together.
    db.query relokit_run_op {
      where = $db.relokit_run_op.run_id == $run.id && $db.relokit_run_op.status == "ok"
      return = {type: "count"}
    } as $spent

    db.query relokit_evidence {
      where = $db.relokit_evidence.run_id == $run.id
      return = {type: "list"}
    } as $evidence
  
    db.query relokit_entity {
      where = $db.relokit_entity.org_id == $org.id
      return = {type: "list"}
    } as $entities
  }

  response = {
    run_id                                                                     : $run.id
    status                                                                     : $run.status
    version                                                                    : $run.version
    plan_id                                                                    : $run.plan_id
    entities                                                                   : $entities
    evidence                                                                   : $evidence
    "// One row per call"                                                      : ``
    "with how it was answered. A cache hit is a call this"                     : ``
    "// run did not repeat; a ledger hit is a fact an earlier question already": ``
    "// paid for. They are counted apart because they are different savings."  : ``
    ops                                                                        : $ops
    cost                                                                       : ```
      {
        naive_units  : $run.naive_cost_units
        planned_units: $run.planned_cost_units
        actual_units : $spent
        ceiling_units: $run.ceiling_cost_units
      }
      ```
  }

  guid = "ihhC_eaz41VGep9Uwg7lqLF1A2Q"
}
